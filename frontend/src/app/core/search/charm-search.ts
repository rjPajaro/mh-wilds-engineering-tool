import { Skill, SkillId, SkillLevel, SlotTarget, Talisman, TalismanRolls, TalismanSlot } from '../models/game-data';
import { charmTypeName } from '../talismans/custom-talisman';
import { ArmorSearchInput, ArmorSetResult, DEFAULT_TIME_LIMIT_MS, PROGRESS_INTERVAL_MS, requiredPoints, searchArmorSets, SearchProgress } from './armor-search';

/**
 * Charm search: which appraised (random) talismans would let armor reach the requested skills.
 *
 * 1. Every roll the tables allow (rarity -> pattern of skill groups -> slot layout) is reduced to
 *    what matters for this request: its points in the requested skills (capped at the need) and
 *    the slots that can hold a useful jewel. Rolls that reduce to the same thing are one profile;
 *    their chances add up.
 * 2. Each profile's chance is that of rolling it or anything better (more points, bigger slots).
 * 3. Profiles are checked by that chance, highest first, with the armor search (stop at the first
 *    set). A profile is skipped when it is no better than one already found impossible, or at least
 *    as good as one already listed (that one asks for less and is at least as likely).
 *
 * Chances are rough: the tables give the rarity chances and rarity 8's slot chances; patterns,
 * the other rarities' slot layouts and the skills in a group are assumed equally likely.
 */

export interface CharmSearchInput extends Omit<ArmorSearchInput, 'talismans' | 'maxResults' | 'rankBy' | 'stopAfter'> {
  rolls: TalismanRolls;
  /** How many charms to list. */
  maxResults: number;
}

/** One concrete roll: the requested skills it has (other skills don't matter) and its slots. */
export interface CharmRoll {
  rarity: number;
  skills: SkillLevel[];
  slots: TalismanSlot[];
  chance: number;
}

export interface CharmResult {
  /** Requested skills the charm needs; levels are capped at the requirement (a higher roll works too). */
  skills: SkillLevel[];
  /** Slots that matter (those that fit a useful jewel, capped at the largest one), highest first. */
  slots: TalismanSlot[];
  /** Rough chance per appraisal of a charm with at least these skills and slots (see the file comment). */
  chance: number;
  /** The same by rarity, most likely first. */
  rarities: { rarity: number; chance: number }[];
  /** The most likely roll behind this result. */
  example: CharmRoll;
  /** One armor set that reaches the skills with this charm (the first found, not the best). */
  set: ArmorSetResult;
}

export interface CharmSearchOutput {
  /** A set that reaches the skills with no talisman at all; then any charm works and `results` is empty. */
  withoutCharm: ArmorSetResult | null;
  results: CharmResult[];
  /** Distinct profiles the rolls reduce to. */
  candidates: number;
  /** Armor searches run. */
  checks: number;
  timedOut: boolean;
  elapsedMs: number;
}

interface Profile {
  key: string;
  points: number[];
  slots: TalismanSlot[];
  /** Chance of exactly this profile. */
  chance: number;
  byRarity: Map<number, number>;
  /** Chance of this profile or a better one, in total and by rarity. */
  atLeast: number;
  atLeastByRarity: Map<number, number>;
  example: CharmRoll;
}

/** A charm as a talisman the armor search can use. Id prefix `roll:`; never saved as is. */
export function charmTalisman(result: Pick<CharmResult, 'skills' | 'slots' | 'example'>): Talisman {
  return {
    id: `roll:${result.example.rarity}:${result.skills.map((s) => `${s.skillId}.${s.level}`).join(',')}:${slotText(result.slots)}`,
    name: charmTypeName(result.example.rarity),
    rarity: result.example.rarity,
    slots: result.slots.map((s) => ({ ...s })),
    skills: result.skills.map((s) => ({ ...s })),
  };
}

/** "W1-1-1": weapon slots marked W, highest first. */
export function slotText(slots: readonly TalismanSlot[]): string {
  return slots.map((s) => `${s.accepts === 'weapon' ? 'W' : ''}${s.level}`).join('-');
}

export function searchCharms(input: CharmSearchInput, onProgress?: (progress: SearchProgress) => void): CharmSearchOutput {
  const started = Date.now();
  const deadline = started + (input.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS);
  const skillsById = new Map(input.skills.map((s) => [s.id, s]));
  const output = (partial: Partial<CharmSearchOutput>): CharmSearchOutput => ({
    withoutCharm: null,
    results: [],
    candidates: 0,
    checks: 0,
    timedOut: false,
    elapsedMs: Date.now() - started,
    ...partial,
  });
  if (!input.requirements.length) return output({});

  const armorInput = (talismans: Talisman[]): ArmorSearchInput => ({
    ...input,
    talismans,
    maxResults: 1,
    rankBy: 'slots',
    stopAfter: 1,
    timeLimitMs: Math.max(1, deadline - Date.now()),
  });

  const base = searchArmorSets(armorInput([]));
  if (base.results.length) return output({ withoutCharm: base.results[0], checks: 1 });
  if (base.timedOut) return output({ checks: 1, timedOut: true });

  const profiles = rollProfiles(input, skillsById);
  const infeasible: Profile[] = [];
  const found: { profile: Profile; result: CharmResult }[] = [];
  let checks = 1;
  let timedOut = false;
  let lastProgress = 0;

  for (const [i, profile] of profiles.entries()) {
    if (found.length >= input.maxResults) break;
    if (Date.now() >= deadline) {
      timedOut = true;
      break;
    }
    if (onProgress && Date.now() - lastProgress >= PROGRESS_INTERVAL_MS) {
      lastProgress = Date.now();
      onProgress({ fraction: Math.max(i / profiles.length, found.length / input.maxResults), phase: 'Checking charms' });
    }
    if (infeasible.some((p) => covers(p, profile))) continue;
    if (found.some((f) => covers(profile, f.profile))) continue;

    const result: Omit<CharmResult, 'set'> = {
      skills: profile.points.flatMap((level, j) => (level > 0 ? [{ skillId: input.requirements[j].skillId, level }] : [])),
      slots: profile.slots,
      chance: profile.atLeast,
      rarities: [...profile.atLeastByRarity].map(([rarity, chance]) => ({ rarity, chance })).sort((a, b) => b.chance - a.chance),
      example: profile.example,
    };
    const out = searchArmorSets(armorInput([charmTalisman(result)]));
    checks++;
    if (out.results.length) found.push({ profile, result: { ...result, set: out.results[0] } });
    else if (out.timedOut) {
      timedOut = true;
      break;
    } else infeasible.push(profile);
  }

  return output({ results: found.map((f) => f.result), candidates: profiles.length, checks, timedOut });
}

/** Every roll reduced to the requested skills and useful slots, merged, most likely first. */
function rollProfiles(input: CharmSearchInput, skillsById: ReadonlyMap<SkillId, Skill>): Profile[] {
  const ids = input.requirements.map((r) => r.skillId);
  const need = input.requirements.map((r) => {
    const skill = skillsById.get(r.skillId);
    return skill ? requiredPoints(skill, r.level) : 0;
  });

  // Largest slot worth having per type: the biggest jewel with a requested skill.
  const maxUseful: Record<SlotTarget, number> = { armor: 0, weapon: 0 };
  for (const d of input.decorations) {
    if (d.skills.some((s) => ids.includes(s.skillId))) maxUseful[d.allowedOn] = Math.max(maxUseful[d.allowedOn], d.slotLevel);
  }
  const usefulSlots = (slots: readonly TalismanSlot[]) =>
    slots
      .filter((s) => maxUseful[s.accepts] > 0)
      .map((s) => ({ level: Math.min(s.level, maxUseful[s.accepts]), accepts: s.accepts }))
      .sort((a, b) => Number(a.accepts === 'armor') - Number(b.accepts === 'armor') || b.level - a.level);

  const profiles = new Map<string, Profile>();
  const r8 = input.rolls.rarity8SlotChances;
  for (const [rarityText, { chance: rarityChance, patterns }] of Object.entries(input.rolls.rarities)) {
    const rarity = Number(rarityText);
    for (const pattern of patterns) {
      const layouts =
        rarity === 8 && r8.length
          ? r8.map((l) => ({ slots: l.slots, chance: l.chance }))
          : pattern.slots.map((slots) => ({ slots, chance: 1 / pattern.slots.length }));
      for (const pick of skillPicks(pattern.groups, input.rolls.groups, ids)) {
        for (const layout of layouts) {
          const chance = (rarityChance / patterns.length) * layout.chance * pick.chance;
          if (chance <= 0) continue;
          const points = ids.map((id, i) => Math.min(need[i], pick.skills.find((s) => s.skillId === id)?.level ?? 0));
          const slots = usefulSlots(layout.slots);
          if (!slots.length && points.every((p) => p === 0)) continue;
          const key = `${points.join(',')}|${slotText(slots)}`;
          let profile = profiles.get(key);
          if (!profile) {
            profile = { key, points, slots, chance: 0, byRarity: new Map(), atLeast: 0, atLeastByRarity: new Map(), example: { rarity, skills: pick.skills, slots: layout.slots, chance } };
            profiles.set(key, profile);
          }
          profile.chance += chance;
          profile.byRarity.set(rarity, (profile.byRarity.get(rarity) ?? 0) + chance);
          if (chance > profile.example.chance) profile.example = { rarity, skills: pick.skills, slots: layout.slots, chance };
        }
      }
    }
  }
  const list = [...profiles.values()];
  for (const p of list) {
    for (const q of list) {
      if (!covers(q, p)) continue;
      p.atLeast += q.chance;
      for (const [rarity, chance] of q.byRarity) p.atLeastByRarity.set(rarity, (p.atLeastByRarity.get(rarity) ?? 0) + chance);
    }
  }
  return list.sort((a, b) => b.atLeast - a.atLeast);
}

/**
 * Ways to fill a pattern's groups, as far as the requested skills go: each position is one of the
 * group's requested skills, or "something else". A charm never has the same skill twice.
 */
function skillPicks(groups: readonly number[], table: TalismanRolls['groups'], ids: readonly SkillId[]): { skills: SkillLevel[]; chance: number }[] {
  let picks: { skills: SkillLevel[]; chance: number }[] = [{ skills: [], chance: 1 }];
  for (const group of groups) {
    const entries = table[group] ?? [];
    if (!entries.length) return [];
    const wanted = entries.filter((e) => ids.includes(e.skillId));
    const other = (entries.length - wanted.length) / entries.length;
    picks = picks.flatMap((p) => [
      ...(other > 0 ? [{ skills: p.skills, chance: p.chance * other }] : []),
      ...wanted
        .filter((e) => !p.skills.some((s) => s.skillId === e.skillId))
        .map((e) => ({ skills: [...p.skills, { skillId: e.skillId, level: e.level }], chance: p.chance / entries.length })),
    ]);
  }
  return picks;
}

/** True when `a` is at least as good as `b`: as many points in every skill, and slots that hold b's jewels. */
function covers(a: Profile, b: Profile): boolean {
  return a.points.every((p, i) => p >= b.points[i]) && slotsCover(a.slots, b.slots);
}

function slotsCover(a: readonly TalismanSlot[], b: readonly TalismanSlot[]): boolean {
  for (const target of ['armor', 'weapon'] as const) {
    const big = a.filter((s) => s.accepts === target).map((s) => s.level).sort((x, y) => y - x);
    const small = b.filter((s) => s.accepts === target).map((s) => s.level).sort((x, y) => y - x);
    if (small.length > big.length || small.some((level, i) => level > big[i])) return false;
  }
  return true;
}
