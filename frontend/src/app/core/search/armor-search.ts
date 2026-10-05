import { EquipSlot } from '../build/build';
import { ARMOR_KINDS, ArmorKind, ArmorPiece, Decoration, Skill, SkillId, SlotTarget, Talisman, Weapon } from '../models/game-data';

/**
 * Armor set search: finds armor + talisman + decorations that reach every
 * requested skill level, with the weapon fixed.
 *
 * 1. Each requested skill becomes a point target. Armor/weapon skills need
 *    `level` points; set/group skills need the pieces of the requested rank.
 * 2. Gear is reduced to what matters: its points on the requested skills and
 *    its slots. Items with the same profile collapse into one candidate (the
 *    others become alternatives), and dominated items are dropped.
 * 3. Depth-first over talisman, head, chest, arms, waist, legs. A branch is cut
 *    when even the best remaining gear, with the best jewel in every slot,
 *    cannot reach a target.
 * 4. At each full set an exact, memoized jewel search fills the remaining
 *    points, keeping the largest slots free.
 * 5. Every combination is tried (real data: ~100k sets in under a second for
 *    3 skills); only the best `maxResults` by `rankBy` are kept.
 *
 * Jewel supply is treated as unlimited.
 */

export interface SkillRequirement {
  skillId: SkillId;
  level: number;
}

export interface ArmorSearchInput {
  requirements: readonly SkillRequirement[];
  /** Definitions of at least the required skills. */
  skills: readonly Skill[];
  /** Pieces to choose from per kind. */
  armor: Readonly<Record<ArmorKind, readonly ArmorPiece[]>>;
  decorations: readonly Decoration[];
  /** Talismans to choose from; going without one is always allowed. */
  talismans: readonly Talisman[];
  /** Fixed weapon: its skills count and its slots take weapon jewels. */
  weapon: Weapon | null;
  /** How many of the best sets to return. */
  maxResults: number;
  rankBy: ArmorSetRanking;
  timeLimitMs?: number;
  /** Stop once this many sets are found (a feasibility check); the results are then not the best. */
  stopAfter?: number;
}

/**
 * - `slots`: most free slot space (larger slots first), then defense.
 * - `defense`: highest defense, then free slots.
 */
export type ArmorSetRanking = 'slots' | 'defense';

export interface ArmorSetResult {
  armor: Record<ArmorKind, ArmorPiece>;
  /** Other pieces with the same points on the requested skills and the same slots. */
  alternatives: Record<ArmorKind, ArmorPiece[]>;
  talisman: Talisman | null;
  /** Jewels index-aligned with each item's slots, like `Build.decorations`. */
  decorations: Partial<Record<EquipSlot, (Decoration | null)[]>>;
  /** Unused slot levels, highest first. */
  freeSlots: Record<SlotTarget, number[]>;
  /** Sum of the pieces' fully upgraded defense. */
  defense: number;
  /** Expected damage of a 100 MV hit; set by the highest-damage search (damage-search.ts). */
  damage?: number;
}

export interface ArmorSearchOutput {
  /** The best `maxResults` sets, best first. */
  results: ArmorSetResult[];
  /** Sets found in total. */
  found: number;
  /** True when the time limit ended the search before it tried every combination. */
  timedOut: boolean;
  elapsedMs: number;
  /** Upper bound on the requested skill points any set can reach (each capped at its need). */
  pointsBound?: number;
}

export const DEFAULT_TIME_LIMIT_MS = 30_000;

/** How far a search has got, for a progress bar. */
export interface SearchProgress {
  /** 0 to 1; an estimate. */
  fraction: number;
  /** What the search is doing, for display. */
  phase: string;
}

/** Progress is reported at most this often. */
export const PROGRESS_INTERVAL_MS = 100;

/** Points a requirement needs: the level, or for set/group skills the rank's piece count. */
export function requiredPoints(skill: Skill, level: number): number {
  const isBonus = skill.kind === 'set' || skill.kind === 'group';
  if (isBonus && skill.ranks.length && skill.ranks.every((r) => r.piecesRequired != null)) {
    const rank = skill.ranks.find((r) => r.level >= level) ?? skill.ranks.at(-1)!;
    return rank.piecesRequired!;
  }
  return Math.min(Math.max(level, 0), skill.maxLevel);
}

// ---------------------------------------------------------------- internals

/** Slot counts: [armor 1, armor 2, armor 3, weapon 1, weapon 2, weapon 3]. */
type SlotCounts = number[];
const SLOT_INDICES = [0, 1, 2, 3, 4, 5];
const slotIndex = (target: SlotTarget, level: number) => (target === 'weapon' ? 3 : 0) + level - 1;

interface Candidate<T> {
  item: T;
  points: number[];
  slots: SlotCounts;
  alternatives: T[];
}

interface DecoOption {
  deco: Decoration;
  points: number[];
  target: SlotTarget;
}

interface DecoPlan {
  decos: Decoration[];
  free: SlotCounts;
}

/** `onProgress` gets the share of the search tree covered so far (an estimate: branches differ in size). */
export function searchArmorSets(input: ArmorSearchInput, onProgress?: (progress: SearchProgress) => void): ArmorSearchOutput {
  const started = Date.now();
  const deadline = started + (input.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS);
  const skillsById = new Map(input.skills.map((s) => [s.id, s]));

  const targets = mergeRequirements(input.requirements, skillsById);
  const ids = targets.map((t) => t.skillId);
  const need = targets.map((t) => t.points);
  const n = need.length;
  const empty = (): ArmorSearchOutput => ({ results: [], found: 0, timedOut: false, elapsedMs: Date.now() - started });
  if (!n) return empty();

  const project = (skills: readonly { skillId: SkillId; level: number }[]) => {
    const points = new Array<number>(n).fill(0);
    for (const s of skills) {
      const i = ids.indexOf(s.skillId);
      if (i >= 0) points[i] += s.level;
    }
    return points;
  };
  const slotCounts = (slots: readonly { level: number; accepts: SlotTarget }[]) => {
    const counts = new Array<number>(6).fill(0);
    for (const s of slots) if (s.level >= 1 && s.level <= 3) counts[slotIndex(s.accepts, s.level)]++;
    return counts;
  };

  // Jewels, projected on the requested skills; useless and dominated ones dropped.
  const decoOptions = pruneDecos(
    input.decorations
      .map((deco): DecoOption => ({ deco, points: project(deco.skills), target: deco.allowedOn }))
      .filter((d) => d.points.some((p) => p > 0)),
  );
  const decosBySkill = ids.map((_, i) => decoOptions.filter((d) => d.points[i] > 0).sort((a, b) => a.deco.slotLevel - b.deco.slotLevel));

  // Best jewel value per slot, for the pruning bounds.
  const perSlot = ids.map((_, i) =>
    SLOT_INDICES.map((s) => Math.max(0, ...decoOptions.filter((d) => fits(d, s)).map((d) => d.points[i]))),
  );
  const perSlotTotal = SLOT_INDICES.map((s) =>
    Math.max(0, ...decoOptions.filter((d) => fits(d, s)).map((d) => d.points.reduce((sum, p, i) => sum + Math.min(p, need[i]), 0))),
  );

  // Gear candidates per level of the search tree: talisman, then armor kinds.
  const rank = <T>(list: Candidate<T>[]) =>
    list.sort((a, b) => candidateScore(b, need) - candidateScore(a, need));
  const armorLevels = ARMOR_KINDS.map((kind) =>
    rank(
      pruneCandidates(
        input.armor[kind].map((piece) => ({
          item: piece,
          points: project(piece.skills),
          slots: slotCounts(piece.slots.map((level) => ({ level, accepts: 'armor' as const }))),
          alternatives: [],
        })),
        (a, b) => b.defense.max - a.defense.max,
      ),
    ),
  );
  const talismanLevel = rank(
    pruneCandidates<Talisman | null>(
      [
        { item: null, points: new Array<number>(n).fill(0), slots: new Array<number>(6).fill(0), alternatives: [] },
        ...input.talismans.map((t) => ({ item: t, points: project(t.skills), slots: slotCounts(t.slots), alternatives: [] })),
      ],
      // Keep "no talisman" over talismans that add nothing.
      (a, b) => Number(b === null) - Number(a === null),
    ),
  );
  const levels: Candidate<ArmorPiece | Talisman | null>[][] = [talismanLevel, ...armorLevels];
  const depth = levels.length;
  if (levels.some((l) => !l.length)) return empty();

  // Upper bounds of what levels k.. can still add, gear and jewels together.
  const value = (c: Candidate<unknown>, i: number) => c.points[i] + c.slots.reduce((sum, count, s) => sum + count * perSlot[i][s], 0);
  const total = (c: Candidate<unknown>) =>
    c.points.reduce((sum, p, i) => sum + Math.min(p, need[i]), 0) + c.slots.reduce((sum, count, s) => sum + count * perSlotTotal[s], 0);
  const remMax: number[][] = Array.from({ length: depth + 1 }, () => new Array<number>(n).fill(0));
  const remTotal = new Array<number>(depth + 1).fill(0);
  for (let k = depth - 1; k >= 0; k--) {
    for (let i = 0; i < n; i++) remMax[k][i] = remMax[k + 1][i] + Math.max(...levels[k].map((c) => value(c, i)));
    remTotal[k] = remTotal[k + 1] + Math.max(...levels[k].map(total));
  }
  const needTotal = need.reduce((a, b) => a + b, 0);

  const weaponSlots = slotCounts((input.weapon?.slots ?? []).map((level) => ({ level, accepts: 'weapon' as const })));
  const acc = input.weapon ? project(input.weapon.skills) : new Array<number>(n).fill(0);
  const slots = weaponSlots.slice();
  const chosen: Candidate<ArmorPiece | Talisman | null>[] = [];
  const pointsBound =
    acc.reduce((sum, p, i) => sum + Math.min(p, need[i]), 0) + slots.reduce((sum, count, s) => sum + count * perSlotTotal[s], 0) + remTotal[0];

  const memo = new Map<string, DecoPlan | null>();
  const solveDecos = (deficit: number[], free: SlotCounts): DecoPlan | null => {
    const i = deficit.findIndex((d) => d > 0);
    if (i < 0) return { decos: [], free };
    const key = `${deficit.join(',')}|${free.join(',')}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let best: DecoPlan | null = null;
    for (const option of decosBySkill[i]) {
      // Smallest free slot that fits: never worse than a larger one.
      let s = -1;
      for (let level = option.deco.slotLevel; level <= 3 && s < 0; level++) {
        if (free[slotIndex(option.target, level)] > 0) s = slotIndex(option.target, level);
      }
      if (s < 0) continue;
      const nextFree = free.slice();
      nextFree[s]--;
      const sub = solveDecos(
        deficit.map((d, j) => Math.max(0, d - option.points[j])),
        nextFree,
      );
      if (sub && (!best || freeScore(sub.free) > freeScore(best.free))) best = { decos: [option.deco, ...sub.decos], free: sub.free };
    }
    if (memo.size > 500_000) memo.clear();
    memo.set(key, best);
    return best;
  };

  // Best sets so far, unsorted; trimmed back to maxResults whenever it doubles.
  interface Found {
    chosen: Candidate<ArmorPiece | Talisman | null>[];
    decos: Decoration[];
    slotScore: number;
    defense: number;
  }
  const compare =
    input.rankBy === 'defense'
      ? (a: Found, b: Found) => b.defense - a.defense || b.slotScore - a.slotScore
      : (a: Found, b: Found) => b.slotScore - a.slotScore || b.defense - a.defense;
  const maxResults = Math.max(1, input.maxResults);
  let best: Found[] = [];
  let found = 0;
  let stopped = false;
  let enough = false;
  let nodes = 0;
  // Position in the first levels of the tree, for progress.
  const position = new Array<number>(depth).fill(0);
  const PROGRESS_LEVELS = Math.min(3, depth);
  let lastReport = Date.now();
  const report = () => {
    let fraction = 0;
    let width = 1;
    for (let k = 0; k < PROGRESS_LEVELS; k++) {
      width /= levels[k].length;
      fraction += position[k] * width;
    }
    onProgress!({ fraction, phase: 'Searching armor sets' });
  };

  const canStillReach = (k: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let reach = acc[i] + remMax[k][i];
      for (let s = 0; s < 6; s++) reach += slots[s] * perSlot[i][s];
      if (reach < need[i]) return false;
      sum += Math.min(acc[i], need[i]);
    }
    for (let s = 0; s < 6; s++) sum += slots[s] * perSlotTotal[s];
    return sum + remTotal[k] >= needTotal;
  };

  const visit = (k: number): void => {
    if (stopped || enough) return;
    if (++nodes % 2048 === 0) {
      const now = Date.now();
      if (now > deadline) {
        stopped = true;
        return;
      }
      if (onProgress && now - lastReport >= PROGRESS_INTERVAL_MS) {
        lastReport = now;
        report();
      }
    }
    if (!canStillReach(k)) return;
    if (k === depth) {
      const plan = solveDecos(
        need.map((p, i) => Math.max(0, p - acc[i])),
        slots.slice(),
      );
      if (plan) {
        found++;
        if (input.stopAfter && found >= input.stopAfter) enough = true;
        const defense = chosen.reduce((sum, c, i) => sum + (i > 0 ? (c.item as ArmorPiece).defense.max : 0), 0);
        best.push({ chosen: chosen.slice(), decos: plan.decos, slotScore: freeScore(plan.free), defense });
        if (best.length >= maxResults * 2) best = best.sort(compare).slice(0, maxResults);
      }
      return;
    }
    for (let j = 0; j < levels[k].length; j++) {
      const c = levels[k][j];
      position[k] = j;
      for (let i = 0; i < n; i++) acc[i] += c.points[i];
      for (let s = 0; s < 6; s++) slots[s] += c.slots[s];
      chosen.push(c);
      visit(k + 1);
      chosen.pop();
      for (let i = 0; i < n; i++) acc[i] -= c.points[i];
      for (let s = 0; s < 6; s++) slots[s] -= c.slots[s];
      if (stopped || enough) return;
    }
  };
  visit(0);

  return {
    results: best
      .sort(compare)
      .slice(0, maxResults)
      .map((f) => toResult(f.chosen, f.decos, input.weapon)),
    found,
    timedOut: stopped,
    elapsedMs: Date.now() - started,
    pointsBound,
  };
}

/** Combines duplicate requirements (highest wins) and drops unknown skills. */
function mergeRequirements(requirements: readonly SkillRequirement[], skills: ReadonlyMap<SkillId, Skill>) {
  const points = new Map<SkillId, number>();
  for (const r of requirements) {
    const skill = skills.get(r.skillId);
    if (!skill) continue;
    const p = requiredPoints(skill, r.level);
    if (p > 0) points.set(r.skillId, Math.max(points.get(r.skillId) ?? 0, p));
  }
  return [...points].map(([skillId, p]) => ({ skillId, points: p }));
}

function fits(d: DecoOption, s: number): boolean {
  const target: SlotTarget = s >= 3 ? 'weapon' : 'armor';
  return d.target === target && d.deco.slotLevel <= (s % 3) + 1;
}

/** Larger free slots first: one level 3 beats any number of level 2s. */
function freeScore(free: SlotCounts): number {
  return (free[2] + free[5]) * 10_000 + (free[1] + free[4]) * 100 + free[0] + free[3];
}

function candidateScore(c: Candidate<unknown>, need: number[]): number {
  const points = c.points.reduce((sum, p, i) => sum + Math.min(p, need[i]), 0);
  const slots = c.slots.reduce((sum, count, s) => sum + count * ((s % 3) + 1), 0);
  return points * 4 + slots;
}

/** Every slot of `a` is at least as large as the matching slot of `b` (per slot type). */
function slotsDominate(a: SlotCounts, b: SlotCounts): boolean {
  for (const offset of [0, 3]) {
    let ca = 0;
    let cb = 0;
    for (let level = 2; level >= 0; level--) {
      ca += a[offset + level];
      cb += b[offset + level];
      if (ca < cb) return false;
    }
  }
  return true;
}

function dominates(a: { points: number[]; slots: SlotCounts }, b: { points: number[]; slots: SlotCounts }): boolean {
  return a.points.every((p, i) => p >= b.points[i]) && slotsDominate(a.slots, b.slots);
}

/**
 * Collapses candidates with identical profiles (the best by `prefer` stays, the
 * rest become alternatives), then removes candidates another one dominates.
 */
function pruneCandidates<T>(list: Candidate<T>[], prefer: (a: T, b: T) => number): Candidate<T>[] {
  const groups = new Map<string, Candidate<T>[]>();
  for (const c of list) {
    const key = `${c.points.join(',')}|${c.slots.join(',')}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const unique = [...groups.values()].map((group) => {
    const [best, ...rest] = group.sort((a, b) => prefer(a.item, b.item));
    return { ...best, alternatives: rest.map((c) => c.item) };
  });
  return unique.filter((c) => !unique.some((other) => other !== c && dominates(other, c)));
}

/** Drops jewels another jewel beats: same slot type, no larger, at least the same points. */
function pruneDecos(list: DecoOption[]): DecoOption[] {
  const unique = new Map<string, DecoOption>();
  for (const d of list) {
    const key = `${d.target}|${d.deco.slotLevel}|${d.points.join(',')}`;
    const kept = unique.get(key);
    if (!kept || d.deco.rarity < kept.deco.rarity) unique.set(key, d);
  }
  const options = [...unique.values()];
  return options.filter(
    (d) =>
      !options.some(
        (o) =>
          o !== d &&
          o.target === d.target &&
          o.deco.slotLevel <= d.deco.slotLevel &&
          o.points.every((p, i) => p >= d.points[i]),
      ),
  );
}

function toResult(chosen: Candidate<ArmorPiece | Talisman | null>[], decos: Decoration[], weapon: Weapon | null): ArmorSetResult {
  const [talismanCandidate, ...armorCandidates] = chosen as [Candidate<Talisman | null>, ...Candidate<ArmorPiece>[]];
  const armor = {} as Record<ArmorKind, ArmorPiece>;
  const alternatives = {} as Record<ArmorKind, ArmorPiece[]>;
  ARMOR_KINDS.forEach((kind, i) => {
    armor[kind] = armorCandidates[i].item;
    alternatives[kind] = armorCandidates[i].alternatives;
  });
  const talisman = talismanCandidate.item;

  // Every concrete slot, then each jewel (largest first) into the smallest free one that fits.
  const slots: { owner: EquipSlot; index: number; level: number; target: SlotTarget }[] = [];
  const decorations: ArmorSetResult['decorations'] = {};
  const addSlots = (owner: EquipSlot, list: readonly { level: number; accepts: SlotTarget }[]) => {
    decorations[owner] = list.map(() => null);
    list.forEach((s, index) => slots.push({ owner, index, level: s.level, target: s.accepts }));
  };
  if (weapon) addSlots('weapon', weapon.slots.map((level) => ({ level, accepts: 'weapon' })));
  for (const kind of ARMOR_KINDS) addSlots(kind, armor[kind].slots.map((level) => ({ level, accepts: 'armor' })));
  if (talisman) addSlots('talisman', talisman.slots);

  const used = new Set<number>();
  for (const deco of [...decos].sort((a, b) => b.slotLevel - a.slotLevel)) {
    let pick = -1;
    slots.forEach((s, i) => {
      if (used.has(i) || s.target !== deco.allowedOn || s.level < deco.slotLevel) return;
      if (pick < 0 || s.level < slots[pick].level) pick = i;
    });
    // The pooled plan guarantees a fit; a miss would be a bug in the search.
    if (pick < 0) throw new Error(`No slot for ${deco.name}`);
    used.add(pick);
    decorations[slots[pick].owner]![slots[pick].index] = deco;
  }

  const freeSlots: Record<SlotTarget, number[]> = { armor: [], weapon: [] };
  slots.forEach((s, i) => {
    if (!used.has(i)) freeSlots[s.target].push(s.level);
  });
  freeSlots.armor.sort((a, b) => b - a);
  freeSlots.weapon.sort((a, b) => b - a);

  return {
    armor,
    alternatives,
    talisman,
    decorations,
    freeSlots,
    defense: ARMOR_KINDS.reduce((sum, kind) => sum + armor[kind].defense.max, 0),
  };
}
