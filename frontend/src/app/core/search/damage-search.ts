import { collectSkillSources } from '../build/build';
import { calculateDamage, DamageInput, DamageTarget } from '../calc/damage';
import { SET_EFFECTS, SKILL_EFFECTS, SPECIAL_SKILLS } from '../calc/skill-effects';
import { ARMOR_KINDS, ArmorKind, ArmorPiece, Skill, Talisman, Weapon } from '../models/game-data';
import { ActiveSkill, resolveSkills } from '../skills/skill-resolver';
import { ArmorSearchInput, ArmorSearchOutput, ArmorSetResult, DEFAULT_TIME_LIMIT_MS, PROGRESS_INTERVAL_MS, requiredPoints, searchArmorSets, SearchProgress, SkillRequirement } from './armor-search';

/**
 * Highest-damage search: finds the armor sets (with talisman and jewels) whose
 * skills give the most expected damage per hit, for a fixed weapon, target,
 * conditions and buffs (the Builder's Damage panel settings).
 *
 * 1. The damage skills that raise damage for this weapon and these settings
 *    become dimensions (Attack Boost, Weakness Exploit, Agitator, ...).
 * 2. Beam search over their levels: start at the must-have levels, raise one
 *    skill at a time to its next level that adds damage, check each candidate
 *    with the armor search (stopping at
 *    the first set found) and keep the `beamWidth` highest-damage reachable
 *    combinations each round, until nothing more is reachable.
 * 3. The best reachable combinations that no better one contains are searched
 *    in full (most free slots), and their sets are ranked by actual damage.
 *
 * The beam keeps several runners-up per round, so it is not limited to greedy
 * choices, but it is a heuristic: a combination it never reaches is not tried.
 * Feasibility is exact: the armor search either finds a set or proves none
 * exists (a check cut short by the time limit counts as unreachable).
 */

export interface DamageSearchInput extends Omit<ArmorSearchInput, 'weapon' | 'maxResults' | 'rankBy' | 'stopAfter'> {
  /** Must-have skills; damage skills are raised on top of them. */
  requirements: readonly SkillRequirement[];
  weapon: Weapon;
  toggles: DamageInput['toggles'];
  targetInflictsFrenzy?: boolean;
  buffs: DamageInput['buffs'];
  /** Null: a neutral weak point (every hitzone 100), so Weakness Exploit counts. */
  target: DamageTarget | null;
  maxResults: number;
  /** Reachable combinations kept per round. */
  beamWidth?: number;
}

export interface DamageSearchOutput extends ArmorSearchOutput {
  /** Skill-level combinations checked for a reachable set. */
  checks: number;
}

export const DEFAULT_BEAM_WIDTH = 24;
/** Neutral target when none is picked: weak point, element hitzone 100. */
export const NEUTRAL_TARGET: DamageTarget = {
  hitzones: { slash: 1, blunt: 1, pierce: 1, fire: 1, water: 1, thunder: 1, ice: 1, dragon: 1, stun: 1 },
  wounded: false,
};
/** Single checks stop here, so one hard case cannot use the whole budget. */
const CHECK_TIME_LIMIT_MS = 5_000;
/** Share of the progress bar for the beam search; the full searches for the results get the rest. */
const SEARCH_SHARE = 0.9;
/** Found sets tried before a full search. */
const MAX_WITNESSES = 8;
const EPSILON = 1e-9;

/** Expected damage of one 100 MV hit with these active skills (against the target, or a neutral weak point). */
export function damagePerHit(
  input: Pick<DamageSearchInput, 'weapon' | 'toggles' | 'buffs' | 'target' | 'targetInflictsFrenzy'>,
  skills: readonly ActiveSkill[],
): number {
  const result = calculateDamage({
    weapon: input.weapon,
    skills,
    toggles: input.toggles,
    buffs: input.buffs,
    target: input.target ?? NEUTRAL_TARGET,
    targetInflictsFrenzy: input.targetInflictsFrenzy,
  });
  return result.vsTarget!.hit.total;
}

export function searchDamageSets(input: DamageSearchInput, onProgress?: (progress: SearchProgress) => void): DamageSearchOutput {
  const started = Date.now();
  const deadline = started + (input.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS);
  const remaining = () => deadline - Date.now();
  let timedOut = false;
  let checks = 0;

  const skillsByName = new Map(input.skills.map((s) => [s.name, s]));
  const userLevel = (skill: Skill) => Math.max(0, ...input.requirements.filter((r) => r.skillId === skill.id).map((r) => r.level));
  const weaponLevel = (skill: Skill) => input.weapon.skills.filter((s) => s.skillId === skill.id).reduce((sum, s) => sum + s.level, 0);

  // Damage skills as dimensions; the lower bound is what the user asks for or the weapon gives anyway.
  const candidates = [...Object.keys(SKILL_EFFECTS), ...SPECIAL_SKILLS]
    .map((name) => skillsByName.get(name))
    .filter((s): s is Skill => !!s && (s.kind === 'armor' || s.kind === 'weapon'))
    .map((skill) => ({ skill, lb: Math.min(skill.maxLevel, Math.max(userLevel(skill), weaponLevel(skill))) }));

  // Required set/group bonuses are in every result, so they count for damage and enable other skills (Antivirus needs Frenzy).
  const bonuses: ActiveSkill[] = input.skills
    .filter((s) => (s.kind === 'set' || s.kind === 'group') && SET_EFFECTS[s.name] !== undefined && userLevel(s) > 0)
    .map((skill) => ({ skill, points: userLevel(skill), level: userLevel(skill), wasted: 0, sources: [] }));
  const active = (dims: readonly Skill[], levels: readonly number[]): ActiveSkill[] => [
    ...bonuses,
    ...dims.flatMap((skill, i) => (levels[i] > 0 ? [{ skill, points: levels[i], level: levels[i], wasted: 0, sources: [] }] : [])),
  ];
  const allLb = candidates.map((c) => c.lb);
  const baseDamage = damagePerHit(input, active(candidates.map((c) => c.skill), allLb));
  // Keep only skills that add damage on their own at max level.
  const kept = candidates.filter((c, i) => {
    if (c.lb >= c.skill.maxLevel) return false;
    const levels = allLb.slice();
    levels[i] = c.skill.maxLevel;
    return damagePerHit(input, active(candidates.map((d) => d.skill), levels)) > baseDamage + EPSILON;
  });
  // Skills already at their must-have level that are not dimensions still count for damage.
  const fixed = candidates.filter((c) => !kept.includes(c) && c.lb > 0);
  const dims = [...kept.map((c) => c.skill), ...fixed.map((c) => c.skill)];
  const n = kept.length;
  const lb = kept.map((c) => c.lb);
  const cap = kept.map((c) => c.skill.maxLevel);

  const scores = new Map<string, number>();
  const key = (v: readonly number[]) => v.join(',');
  const score = (v: readonly number[]) => {
    const k = key(v);
    let s = scores.get(k);
    if (s === undefined) {
      s = damagePerHit(input, active(dims, [...v, ...fixed.map((c) => c.lb)]));
      scores.set(k, s);
    }
    return s;
  };

  const requirementsFor = (v: readonly number[]): SkillRequirement[] => [
    ...input.requirements,
    ...kept.flatMap((c, i) => (v[i] > c.lb ? [{ skillId: c.skill.id, level: v[i] }] : [])),
  ];
  const searchInput = (v: readonly number[], extra: Partial<ArmorSearchInput>): ArmorSearchInput => ({
    requirements: requirementsFor(v),
    skills: input.skills,
    armor: input.armor,
    decorations: input.decorations,
    talismans: input.talismans,
    weapon: input.weapon,
    maxResults: 1,
    rankBy: 'slots',
    ...extra,
  });

  // Reachability is downward closed: below a reachable combination is reachable, above an unreachable one is not.
  const leq = (a: readonly number[], b: readonly number[]) => a.every((x, i) => x <= b[i]);
  const reachable: number[][] = [];
  const unreachable: number[][] = [];
  // Armor + talisman of sets found so far, newest first. Neighboring combinations often fit
  // on one of them with other jewels, which is far quicker to check than a full search.
  // Set by the beam search so a slow check still moves the progress bar.
  let onCheckProgress = (_fraction: number) => {};
  const witnesses: { armor: Record<ArmorKind, readonly ArmorPiece[]>; talismans: Talisman[] }[] = [];
  const fitsWitness = (v: number[]) =>
    witnesses.some((w) => searchArmorSets(searchInput(v, { armor: w.armor, talismans: w.talismans, stopAfter: 1 })).found > 0);
  const feasible = (v: number[]): boolean => {
    if (reachable.some((r) => leq(v, r))) return true;
    if (unreachable.some((u) => leq(u, v))) return false;
    checks++;
    // An empty requirement list finds nothing; the bare weapon always works then.
    if (!requirementsFor(v).length || fitsWitness(v)) {
      reachable.push(v);
      return true;
    }
    const out = searchArmorSets(
      searchInput(v, { stopAfter: 1, timeLimitMs: Math.max(1, Math.min(remaining(), CHECK_TIME_LIMIT_MS)) }),
      (p) => onCheckProgress(p.fraction),
    );
    const set = out.results[0];
    if (set) {
      reachable.push(v);
      const armor = Object.fromEntries(ARMOR_KINDS.map((kind) => [kind, [set.armor[kind]]])) as Record<ArmorKind, ArmorPiece[]>;
      witnesses.unshift({ armor, talismans: set.talisman ? [set.talisman] : [] });
      witnesses.splice(MAX_WITNESSES);
      return true;
    }
    if (out.timedOut) timedOut = true;
    unreachable.push(v);
    return false;
  };

  const empty = (): DamageSearchOutput => ({ results: [], found: 0, timedOut, elapsedMs: Date.now() - started, checks });
  if (!feasible(lb)) return empty();

  // Progress: how deep the beam has gone, against an upper bound on the levels any set can add
  // (the armor search's total-points bound). Later rounds are much slower (checks near the limit
  // of what the armor allows), so the depth fraction is squared.
  const skillsById = new Map(input.skills.map((s) => [s.id, s]));
  const otherPoints = input.requirements
    .filter((r) => !kept.some((c) => c.skill.id === r.skillId) && skillsById.has(r.skillId))
    .reduce((total, r) => total + requiredPoints(skillsById.get(r.skillId)!, r.level), 0);
  const bound = searchArmorSets(searchInput(cap, { stopAfter: 1, timeLimitMs: 1 })).pointsBound ?? 0;
  const maxDepth = Math.max(1, Math.min(sum(cap) - sum(lb), bound - otherPoints - sum(lb)));
  let lastReport = 0;
  let shown = 0;
  const report = (fraction: number, phase: string, force = false) => {
    // Never backwards: a later candidate can sit shallower than an earlier one.
    shown = Math.min(1, Math.max(shown, fraction));
    if (!onProgress || (!force && Date.now() - lastReport < PROGRESS_INTERVAL_MS)) return;
    lastReport = Date.now();
    onProgress({ fraction: shown, phase });
  };
  let depth = 0;
  const reportDepth = (d: number) => report(SEARCH_SHARE * Math.min(1, d / maxDepth) ** 2, 'Raising damage skills');
  // A check in progress counts toward the next level.
  onCheckProgress = (fraction) => reportDepth(depth + fraction);
  reportDepth(0);

  // Beam search over levels.
  const width = Math.max(1, input.beamWidth ?? DEFAULT_BEAM_WIDTH);
  const pool = new Map<string, number[]>([[key(lb), lb]]);
  const tried = new Set<string>([key(lb)]);
  let beam: number[][] = [lb];
  while (beam.length) {
    const next = new Map<string, number[]>();
    for (const v of beam) {
      // Each skill goes to its next level that adds damage: Handicraft can need several
      // levels before the sharpness bar reaches the next color.
      for (let i = 0; i < n; i++) {
        const w = v.slice();
        do w[i]++;
        while (w[i] < cap[i] && score(w) <= score(v) + EPSILON);
        if (w[i] <= cap[i] && score(w) > score(v) + EPSILON && !tried.has(key(w))) next.set(key(w), w);
      }
    }
    const ordered = [...next.values()].sort((a, b) => score(b) - score(a) || sum(a) - sum(b));
    beam = [];
    for (const v of ordered) {
      if (beam.length >= width) break;
      if (remaining() <= 0) {
        timedOut = true;
        break;
      }
      tried.add(key(v));
      if (feasible(v)) {
        beam.push(v);
        pool.set(key(v), v);
        depth = Math.max(depth, sum(v) - sum(lb));
        reportDepth(depth);
      }
    }
  }

  // Drop levels that add nothing (e.g. affinity past 100%), then the combinations a better one contains.
  const normalize = (v: readonly number[]) => {
    const w = v.slice();
    const target = score(w);
    for (let i = 0; i < n; i++) {
      while (w[i] > lb[i]) {
        w[i]--;
        if (score(w) < target - EPSILON) {
          w[i]++;
          break;
        }
      }
    }
    return w;
  };
  const distinct = new Map<string, number[]>();
  for (const v of pool.values()) {
    const w = normalize(v);
    distinct.set(key(w), w);
  }
  const ordered = [...distinct.values()].sort((a, b) => score(b) - score(a) || sum(a) - sum(b));
  const picks: number[][] = [];
  for (const v of ordered) if (!picks.some((p) => leq(v, p))) picks.push(v);

  // Full searches for the picks, best first, until there are enough different armor + talisman combinations.
  // Each search lists its sets by free slots; a combination keeps its first (highest-damage) jewels.
  const results: ArmorSetResult[] = [];
  const signatures = new Set<string>();
  const maxResults = Math.max(1, input.maxResults);
  for (const v of picks) {
    if (results.length >= maxResults) break;
    if (remaining() <= 0) {
      timedOut = true;
      break;
    }
    // Nothing to reach (no must-haves, no damage skill reachable): nothing to show.
    if (!requirementsFor(v).length) continue;
    const done = Math.min(results.length, maxResults);
    const out = searchArmorSets(searchInput(v, { maxResults, timeLimitMs: Math.min(remaining(), CHECK_TIME_LIMIT_MS) }), (p) =>
      report(SEARCH_SHARE + ((1 - SEARCH_SHARE) * (done + p.fraction)) / maxResults, 'Finding the best sets'),
    );
    for (const set of out.results) {
      const signature = setSignature(set);
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      const build = { weapon: input.weapon, armor: set.armor, talisman: set.talisman, decorations: set.decorations };
      results.push({ ...set, damage: damagePerHit(input, resolveSkills(collectSkillSources(build), skillsById)) });
    }
  }
  // Stable: equal damage keeps the free-slot order.
  results.sort((a, b) => b.damage! - a.damage!);
  results.splice(maxResults);
  report(1, 'Done', true);

  return { results, found: pool.size, timedOut, elapsedMs: Date.now() - started, checks };
}

function sum(v: readonly number[]): number {
  return v.reduce((a, b) => a + b, 0);
}

/** Armor and talisman; jewels alone do not make a different build. */
function setSignature(set: ArmorSetResult): string {
  return [...Object.values(set.armor).map((p) => p.id), set.talisman?.id ?? ''].join('|');
}

