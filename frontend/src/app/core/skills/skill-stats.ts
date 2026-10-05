import { EffectValues, SKILL_EFFECTS, SkillEffect } from '../calc/skill-effects';
import { SHARPNESS_COLORS, Skill, WeaponKind } from '../models/game-data';
import { RESEARCHED_SKILL_VALUES, SkillLevelValues, skillLevelValues, StatRow } from './skill-values';

/**
 * A skill's numbers by stat and level, for the skill tooltip:
 *
 *            Lv 1   Lv 2   Lv 3
 *   Attack   +4     +8     +12
 *   Affinity +3%    +5%    +7%
 *
 * Where the numbers come from, first match wins:
 * 1. Researched values (skill-values.ts), for the weapon type.
 * 2. The damage calculator's skill table (skill-effects.ts): its numbers come from the
 *    game's skill text, split by stat, with the condition the calculator uses.
 * 3. Game text of the form "<stat> +<n>" on every level (e.g. "Weapon sharpness +10").
 * Anything else, and set and group bonuses, gets one line per level instead.
 */
export interface SkillStatTable {
  skill: Skill;
  /** Current level; 0 when the skill is not active (or below a set bonus's first rank). */
  level: number;
  /** Level numbers, in column order. */
  levels: number[];
  /** By stat, values index-aligned with `levels`; empty when the numbers do not split by stat. */
  rows: StatRow[];
  /** One line per level when there are no stat rows (set bonus ranks, other text). */
  lines: { level: number; label: string; text: string }[];
  /** When the effect applies, e.g. "Monster enraged". */
  condition?: string;
  note?: string;
  researched?: SkillLevelValues['researched'];
}

/** Calculator fields by stat, in display order. Element values are shown ×10, like the game. */
const FIELDS: readonly [keyof EffectValues, string, (v: number) => string][] = [
  ['attackFlat', 'Attack', (v) => `+${v}`],
  ['attackPct', 'Attack %', (v) => `+${v}%`],
  ['affinity', 'Affinity', (v) => `+${v}%`],
  ['critMultiplier', 'Crit damage', (v) => `×${v}`],
  ['critElement', 'Element on crits', (v) => `×${v}`],
  ['elementFlat', 'Element', (v) => `+${v * 10}`],
  ['elementPct', 'Element %', (v) => `+${v}%`],
  ['rawDamagePct', 'Raw damage', (v) => `+${v}%`],
];

/** "Weapon sharpness +10", "Fire attack +40", "Attack +5%". */
const SIMPLE_STAT = /^([A-Za-z][A-Za-z ]*?) ([+-]\d+(?:\.\d+)?%?)\.?$/;

export function skillStatTable(skill: Skill, level: number, weaponKind: WeaponKind | null): SkillStatTable {
  const base = { skill, level: Math.max(0, level), rows: [] as StatRow[], lines: [] as SkillStatTable['lines'] };

  if (skill.kind === 'set' || skill.kind === 'group') {
    return {
      ...base,
      levels: skill.ranks.map((r) => r.level),
      lines: skill.ranks.map((r) => ({
        level: r.level,
        label: `${r.name ?? `Rank ${r.level}`}${r.piecesRequired != null ? ` (${r.piecesRequired} pieces)` : ''}`,
        text: r.description,
      })),
    };
  }

  const levels = Array.from({ length: skill.maxLevel }, (_, i) => i + 1);
  const values = skillLevelValues(skill, weaponKind);
  const asLines = () => values.levels.map((l) => ({ level: l.level, label: `Lv ${l.level}`, text: l.text }));

  if (RESEARCHED_SKILL_VALUES[skill.name]) {
    const group = researchedGroup(skill, values);
    return { ...base, levels, rows: group?.stats ? [...group.stats] : [], lines: group?.stats ? [] : asLines(), note: values.researched?.note, researched: values.researched };
  }

  const effect = SKILL_EFFECTS[skill.name];
  if (effect) return { ...base, levels, rows: effectRows(effect, levels.length), condition: effectCondition(effect), note: effect.verified ? undefined : 'Numbers assumed: not in the game text.' };

  const simple = values.levels.map((l) => SIMPLE_STAT.exec(l.text));
  if (simple.length && simple.every((m) => m && m[1] === simple[0]![1])) {
    return { ...base, levels, rows: [{ stat: simple[0]![1], values: simple.map((m) => m![2]) }] };
  }
  return { ...base, levels, lines: asLines() };
}

/** The researched row for the weapon type that `values` was built for. */
function researchedGroup(skill: Skill, values: SkillLevelValues) {
  return RESEARCHED_SKILL_VALUES[skill.name].groups.find((g) => g.label === values.researched?.weapons);
}

function effectRows(effect: SkillEffect, count: number): StatRow[] {
  const at = (list: readonly EffectValues[], i: number) => list[Math.min(i, list.length - 1)];
  const rows: StatRow[] = FIELDS.filter(([field]) => effect.levels.some((v) => v[field] !== undefined)).map(([field, stat, format]) => ({
    stat,
    values: Array.from({ length: count }, (_, i) => {
      const v = at(effect.levels, i)[field];
      return v === undefined ? '' : format(v);
    }),
  }));
  if (effect.wound) {
    const wound = effect.wound;
    rows.push({ stat: 'Extra on wounds', values: Array.from({ length: count }, (_, i) => `+${at(wound, i).affinity ?? 0}%`) });
  }
  return rows;
}

function effectCondition(effect: SkillEffect): string | undefined {
  const c = effect.condition;
  const element = effect.element ? `${effect.element[0].toUpperCase()}${effect.element.slice(1)} weapons only` : undefined;
  const when =
    c.kind === 'toggle'
      ? c.label
      : c.kind === 'weak-point'
        ? 'Hitting a weak point (hitzone 45+)'
        : c.kind === 'low-sharpness'
          ? `Sharpness at or below ${c.maxColorIndex.map((i) => SHARPNESS_COLORS[i]).join(' / ')} (by level)`
          : undefined;
  return [when, element].filter(Boolean).join(' · ') || undefined;
}
