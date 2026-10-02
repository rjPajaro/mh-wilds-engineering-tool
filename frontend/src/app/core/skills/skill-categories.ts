import { Skill } from '../models/game-data';

/**
 * Skill categories for pickers. Based on each skill's in-game icon (`Skill.icon`),
 * with overrides where the icon files a skill away from what it does, judged from
 * its description: Weakness Exploit has the attack icon but only raises affinity.
 */
export const SKILL_CATEGORIES = [
  { id: 'attack', label: 'Attack' },
  { id: 'affinity', label: 'Affinity' },
  { id: 'element', label: 'Element & status' },
  { id: 'offense', label: 'Other offense' },
  { id: 'sharpness', label: 'Sharpness' },
  { id: 'ranged', label: 'Ranged' },
  { id: 'defense', label: 'Defense & resistances' },
  { id: 'survival', label: 'Health & stamina' },
  { id: 'utility', label: 'Mobility & utility' },
  { id: 'items', label: 'Items & gathering' },
  { id: 'set', label: 'Set bonuses' },
  { id: 'group', label: 'Group bonuses' },
] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number]['id'];

const BY_ICON: Record<string, SkillCategory> = {
  attack: 'attack',
  affinity: 'affinity',
  element: 'element',
  offense: 'offense',
  handicraft: 'sharpness',
  ranged: 'ranged',
  defense: 'defense',
  health: 'survival',
  stamina: 'survival',
  utility: 'utility',
  item: 'items',
  gathering: 'items',
};

/** By English name; a test checks every name still exists in the data. */
export const CATEGORY_OVERRIDES: Readonly<Record<string, SkillCategory>> = {
  // Icon "attack" or "offense", but the effect is affinity.
  'Weakness Exploit': 'affinity',
  'Maximum Might': 'affinity',
  'Latent Power': 'affinity',
  Antivirus: 'affinity',
  // Icon "offense", but the main effect is attack.
  Agitator: 'attack',
  Burst: 'attack',
  Heroics: 'attack',
  Foray: 'attack',
  'Self-Improvement': 'attack',
  // Element effects filed under attack/offense.
  Coalescence: 'element',
  'Elemental Absorption': 'element',
  'Convert Element': 'element',
  'Speed Sharpening': 'sharpness',
  Guard: 'defense',
  'Guard Up': 'defense',
};

export function skillCategory(skill: Pick<Skill, 'name' | 'kind' | 'icon'>): SkillCategory {
  if (skill.kind === 'set' || skill.kind === 'group') return skill.kind;
  return CATEGORY_OVERRIDES[skill.name] ?? BY_ICON[skill.icon] ?? 'utility';
}
