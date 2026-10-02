import { Skill, SkillId, SkillLevel, SlotTarget, Talisman, TalismanSlot } from '../models/game-data';

/**
 * Talismans the player rolled (appraised Unknown / Historical / Secret / Golden Age
 * Charms). The game data has these charms without skills, so the player enters
 * what theirs has.
 */
export interface CustomTalismanConfig {
  /** Always starts with `custom:`. */
  id: string;
  /** Optional; the charm type's name is used when empty. */
  name: string;
  rarity: number;
  skills: SkillLevel[];
  slots: TalismanSlot[];
}

/** The randomly rolled charm types in the game data, by rarity. */
export const CHARM_TYPES: readonly { rarity: number; name: string }[] = [
  { rarity: 5, name: 'Unknown Charm' },
  { rarity: 6, name: 'Historical Charm' },
  { rarity: 7, name: 'Secret Charm' },
  { rarity: 8, name: 'Golden Age Charm' },
];

export const MAX_TALISMAN_SKILLS = 3;
export const MAX_TALISMAN_SLOTS = 3;
const MAX_SLOT_LEVEL = 3;
export const CUSTOM_TALISMAN_PREFIX = 'custom:';

export function newCustomTalisman(id: string): CustomTalismanConfig {
  return { id, name: '', rarity: 8, skills: [], slots: [] };
}

export function charmTypeName(rarity: number): string {
  return CHARM_TYPES.find((t) => t.rarity === rarity)?.name ?? 'Custom Charm';
}

export function isCustomTalismanId(id: string | null | undefined): boolean {
  return !!id?.startsWith(CUSTOM_TALISMAN_PREFIX);
}

export interface TalismanIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** Problems that make the talisman impossible (errors) or worth a second look (warnings). */
export function validateCustomTalisman(config: CustomTalismanConfig, skills: ReadonlyMap<SkillId, Skill>): TalismanIssue[] {
  const issues: TalismanIssue[] = [];
  const error = (message: string) => issues.push({ severity: 'error', message });
  if (!CHARM_TYPES.some((t) => t.rarity === config.rarity)) error(`Rarity ${config.rarity} is not a charm rarity.`);
  if (config.skills.length > MAX_TALISMAN_SKILLS) error(`A talisman has at most ${MAX_TALISMAN_SKILLS} skills.`);
  if (config.slots.length > MAX_TALISMAN_SLOTS) error(`A talisman has at most ${MAX_TALISMAN_SLOTS} slots.`);
  const seen = new Set<SkillId>();
  for (const s of config.skills) {
    const skill = skills.get(s.skillId);
    if (!skill) {
      error('Unknown skill.');
      continue;
    }
    if (seen.has(s.skillId)) error(`${skill.name} is listed twice.`);
    seen.add(s.skillId);
    // Rolled charms can have armor and weapon skills (e.g. Paralysis Attack), never set/group bonuses.
    if (skill.kind !== 'armor' && skill.kind !== 'weapon') error(`${skill.name} is not a skill talismans can have.`);
    if (!Number.isInteger(s.level) || s.level < 1 || s.level > skill.maxLevel) error(`${skill.name} goes from level 1 to ${skill.maxLevel}.`);
  }
  for (const slot of config.slots) {
    if (!Number.isInteger(slot.level) || slot.level < 1 || slot.level > MAX_SLOT_LEVEL) error('Slot levels go from 1 to 3.');
  }
  if (!config.skills.length && !config.slots.length) issues.push({ severity: 'warning', message: 'Add the skills and slots your talisman has.' });
  return issues;
}

/** The talisman as the builder uses it, or null when the config has errors. */
export function buildCustomTalisman(config: CustomTalismanConfig, skills: ReadonlyMap<SkillId, Skill>): Talisman | null {
  if (validateCustomTalisman(config, skills).some((i) => i.severity === 'error')) return null;
  return {
    id: config.id,
    name: config.name.trim() || charmTypeName(config.rarity),
    rarity: config.rarity,
    // Highest slot first, like the game lists them.
    slots: [...config.slots].sort((a, b) => b.level - a.level),
    skills: config.skills.map((s) => ({ ...s })),
  };
}

/** "Weakness Exploit 2 · Agitator 1 · 3-1" style summary (W marks weapon slots). */
export function talismanSummary(config: CustomTalismanConfig, skills: ReadonlyMap<SkillId, Skill>): string {
  const skillText = config.skills.map((s) => `${skills.get(s.skillId)?.name ?? '?'} ${s.level}`);
  const slotText = config.slots.length ? [config.slots.map((s) => `${s.accepts === 'weapon' ? 'W' : ''}${s.level}`).join('-')] : [];
  return [...skillText, ...slotText].join(' · ');
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSlotTarget = (v: unknown): v is SlotTarget => v === 'weapon' || v === 'armor';

/** Shape check for storage and imports; game rules are checked by validateCustomTalisman. */
export function isCustomTalismanConfig(v: unknown): v is CustomTalismanConfig {
  return (
    isObject(v) &&
    typeof v['id'] === 'string' &&
    v['id'].startsWith(CUSTOM_TALISMAN_PREFIX) &&
    typeof v['name'] === 'string' &&
    typeof v['rarity'] === 'number' &&
    Array.isArray(v['skills']) &&
    v['skills'].every((s) => isObject(s) && typeof s['skillId'] === 'number' && typeof s['level'] === 'number') &&
    Array.isArray(v['slots']) &&
    v['slots'].every((s) => isObject(s) && typeof s['level'] === 'number' && isSlotTarget(s['accepts']))
  );
}

/** True when two configs describe the same talisman (the id is ignored). */
export function sameTalisman(a: CustomTalismanConfig, b: CustomTalismanConfig): boolean {
  const key = (c: CustomTalismanConfig) =>
    JSON.stringify([
      c.name.trim(),
      c.rarity,
      [...c.skills].map((s) => [s.skillId, s.level]).sort(),
      [...c.slots].map((s) => [s.level, s.accepts]).sort(),
    ]);
  return key(a) === key(b);
}
