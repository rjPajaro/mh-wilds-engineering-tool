import { Build, collectSkillSources, SkillSource } from '../build/build';
import { Skill, SkillId, SkillKind } from '../models/game-data';

export interface ActiveSkill {
  skill: Skill;
  /** Raw points summed over all sources (piece count for set/group skills). */
  points: number;
  /** Effective level; 0 means a set/group bonus below its first threshold. */
  level: number;
  /** Points beyond what the highest reachable level needs. */
  wasted: number;
  /** Rank name for set/group skills ("Black Eclipse II"). */
  rankName?: string;
  /** Pieces needed for the next set/group rank, if any. */
  nextThreshold?: number;
  sources: { label: string; points: number }[];
}

const KIND_ORDER: Record<SkillKind, number> = { weapon: 0, armor: 1, set: 2, group: 3 };

/**
 * Sums skill points from every source and converts them to effective levels.
 *
 * - armor/weapon skills: level = min(points, maxLevel).
 * - set/group skills: every piece carries 1 point; level = highest rank whose
 *   `piecesRequired` is met. Entries below the first threshold are returned with
 *   level 0 so the UI can show progress.
 *
 * Unknown skill ids are ignored. Result order: active first, then weapon, armor,
 * set, group; within a kind by level desc, then name.
 */
export function resolveSkills(sources: readonly SkillSource[], skills: ReadonlyMap<SkillId, Skill>): ActiveSkill[] {
  const totals = new Map<SkillId, ActiveSkill>();

  for (const source of sources) {
    for (const { skillId, level } of source.skills) {
      const skill = skills.get(skillId);
      if (!skill || level <= 0) continue;
      let entry = totals.get(skillId);
      if (!entry) {
        entry = { skill, points: 0, level: 0, wasted: 0, sources: [] };
        totals.set(skillId, entry);
      }
      entry.points += level;
      entry.sources.push({ label: source.label, points: level });
    }
  }

  for (const entry of totals.values()) applyLevel(entry);

  return [...totals.values()].sort(
    (a, b) =>
      Number(b.level > 0) - Number(a.level > 0) ||
      KIND_ORDER[a.skill.kind] - KIND_ORDER[b.skill.kind] ||
      b.level - a.level ||
      a.skill.name.localeCompare(b.skill.name),
  );
}

function applyLevel(entry: ActiveSkill): void {
  const { skill, points } = entry;
  const isBonus = skill.kind === 'set' || skill.kind === 'group';

  if (!isBonus || skill.ranks.some((r) => r.piecesRequired == null)) {
    entry.level = Math.min(points, skill.maxLevel);
    entry.wasted = Math.max(0, points - skill.maxLevel);
    return;
  }

  const reached = skill.ranks.filter((r) => r.piecesRequired! <= points);
  const top = reached.at(-1);
  entry.level = top?.level ?? 0;
  entry.rankName = top?.name;
  entry.nextThreshold = skill.ranks.find((r) => r.piecesRequired! > points)?.piecesRequired;
  const maxRequired = skill.ranks.at(-1)!.piecesRequired!;
  entry.wasted = Math.max(0, points - maxRequired);
}

/** Convenience: active skills for a build. */
export function resolveBuildSkills(build: Build, skills: ReadonlyMap<SkillId, Skill>): ActiveSkill[] {
  return resolveSkills(collectSkillSources(build), skills);
}

/** Effective level of one skill in a resolved list (0 if absent). */
export function skillLevel(resolved: readonly ActiveSkill[], skillId: SkillId): number {
  return resolved.find((s) => s.skill.id === skillId)?.level ?? 0;
}
