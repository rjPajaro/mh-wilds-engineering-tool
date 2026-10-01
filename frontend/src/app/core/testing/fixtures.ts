// Small hand-built game data for unit tests, modeled on real entries.
import { ArmorKind, ArmorPiece, Decoration, Skill, SkillLevel, Talisman, Weapon } from '../models/game-data';

export const WEX: Skill = {
  id: 1, name: 'Weakness Exploit', description: '', kind: 'armor', icon: 'attack', maxLevel: 5,
  ranks: [1, 2, 3, 4, 5].map((level) => ({ level, description: '' })),
};
export const CRIT_ELEMENT: Skill = {
  id: 2, name: 'Critical Element', description: '', kind: 'weapon', icon: 'attack', maxLevel: 3,
  ranks: [1, 2, 3].map((level) => ({ level, description: '' })),
};
export const GORE_SET: Skill = {
  id: 3, name: "Gore Magala's Tyranny", description: '', kind: 'set', icon: 'set', maxLevel: 2,
  ranks: [
    { level: 1, description: '', name: 'Black Eclipse I', piecesRequired: 2 },
    { level: 2, description: '', name: 'Black Eclipse II', piecesRequired: 4 },
  ],
};
export const SCALING_GROUP: Skill = {
  id: 4, name: 'Scaling Prowess', description: '', kind: 'group', icon: 'group', maxLevel: 1,
  ranks: [{ level: 1, description: '', name: 'Master of the Fist', piecesRequired: 3 }],
};
export const EVADE_WINDOW: Skill = {
  id: 5, name: 'Evade Window', description: '', kind: 'armor', icon: 'evade', maxLevel: 5,
  ranks: [1, 2, 3, 4, 5].map((level) => ({ level, description: '' })),
};

export const SKILLS = new Map([WEX, CRIT_ELEMENT, GORE_SET, SCALING_GROUP, EVADE_WINDOW].map((s) => [s.id, s]));

const sl = (skillId: number, level: number): SkillLevel => ({ skillId, level });

export function gorePiece(kind: ArmorKind, extra: SkillLevel[] = [], slots: number[] = [3, 1]): ArmorPiece {
  return {
    id: `100:${kind}`, setId: 100, kind, name: `Gore ${kind} α`, rarity: 6,
    defense: { base: 50, max: 90 },
    resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
    slots,
    skills: [sl(GORE_SET.id, 1), sl(SCALING_GROUP.id, 1), ...extra],
  };
}

export function deco(id: number, name: string, slotLevel: number, allowedOn: 'weapon' | 'armor', skills: SkillLevel[]): Decoration {
  return { id, name, rarity: 5, slotLevel, allowedOn, skills };
}

export const EXPERT_JEWEL = deco(10, 'Expert Jewel [3]', 3, 'armor', [sl(WEX.id, 1)]);
export const EVASION_JEWEL = deco(11, 'Evasion Jewel [1]', 1, 'armor', [sl(EVADE_WINDOW.id, 1)]);
export const CRIT_EL_JEWEL = deco(12, 'Critical Element Jewel [3]', 3, 'weapon', [sl(CRIT_ELEMENT.id, 1)]);

export const LONG_SWORD: Weapon = {
  id: 'long-sword:1', gameId: 1, kind: 'long-sword', name: 'Test Blade', rarity: 8, attack: 200, affinity: 10, defense: 0,
  slots: [3, 2], specials: [], sharpness: [50, 50, 50, 50, 50, 50, 0], handicraft: [50],
  skills: [sl(CRIT_ELEMENT.id, 2)], series: null, previousId: null, artian: null,
};

export const WEX_TALISMAN: Talisman = { id: 't:1', name: 'Exploiter Charm II', rarity: 6, slots: [], skills: [sl(WEX.id, 2)] };

export { sl };
