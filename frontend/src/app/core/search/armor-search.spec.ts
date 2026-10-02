import { Build } from '../build/build';
import { ARMOR_KINDS, ArmorKind, ArmorPiece } from '../models/game-data';
import { resolveBuildSkills, skillLevel } from '../skills/skill-resolver';
import {
  CRIT_EL_JEWEL,
  CRIT_ELEMENT,
  EVADE_WINDOW,
  EVASION_JEWEL,
  EXPERT_JEWEL,
  GORE_SET,
  gorePiece,
  LONG_SWORD,
  SKILLS,
  sl,
  WEX,
  WEX_TALISMAN,
} from '../testing/fixtures';
import { ArmorSearchInput, ArmorSetResult, requiredPoints, searchArmorSets } from './armor-search';

function wexPiece(kind: ArmorKind, slots: number[] = [1], suffix = ''): ArmorPiece {
  return {
    ...gorePiece(kind, [], slots),
    id: `200:${kind}${suffix}`,
    setId: 200,
    name: `Wex ${kind}${suffix}`,
    skills: [sl(WEX.id, 1)],
    defense: { base: 40, max: 80 },
  };
}

function pool(...makers: ((kind: ArmorKind) => ArmorPiece)[]): Record<ArmorKind, ArmorPiece[]> {
  return Object.fromEntries(ARMOR_KINDS.map((kind) => [kind, makers.map((m) => m(kind))])) as Record<ArmorKind, ArmorPiece[]>;
}

function input(overrides: Partial<ArmorSearchInput>): ArmorSearchInput {
  return {
    requirements: [],
    skills: [...SKILLS.values()],
    armor: pool((k) => gorePiece(k), (k) => wexPiece(k)),
    decorations: [EXPERT_JEWEL, EVASION_JEWEL, CRIT_EL_JEWEL],
    talismans: [],
    weapon: null,
    maxResults: 100,
    rankBy: 'slots',
    ...overrides,
  };
}

function asBuild(result: ArmorSetResult, weapon = input({}).weapon): Build {
  return { weapon, armor: result.armor, talisman: result.talisman, decorations: result.decorations };
}

describe('requiredPoints', () => {
  it('is the level for armor skills and the rank piece count for set bonuses', () => {
    expect(requiredPoints(WEX, 3)).toBe(3);
    expect(requiredPoints(WEX, 9)).toBe(5);
    expect(requiredPoints(GORE_SET, 1)).toBe(2);
    expect(requiredPoints(GORE_SET, 2)).toBe(4);
  });
});

describe('searchArmorSets', () => {
  it('returns only sets that reach every requested level', () => {
    const out = searchArmorSets(input({ requirements: [{ skillId: WEX.id, level: 5 }, { skillId: GORE_SET.id, level: 1 }] }));
    expect(out.timedOut).toBe(false);
    expect(out.results.length).toBeGreaterThan(0);
    for (const result of out.results) {
      const skills = resolveBuildSkills(asBuild(result), SKILLS);
      expect(skillLevel(skills, WEX.id)).toBe(5);
      expect(skillLevel(skills, GORE_SET.id)).toBeGreaterThanOrEqual(1);
    }
  });

  it('needs four set pieces for a rank II set bonus', () => {
    const out = searchArmorSets(input({ requirements: [{ skillId: GORE_SET.id, level: 2 }] }));
    expect(out.results.length).toBeGreaterThan(0);
    for (const result of out.results) {
      expect(ARMOR_KINDS.filter((k) => result.armor[k].setId === 100).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('fills weapon skills with weapon jewels in the weapon slots', () => {
    const out = searchArmorSets(input({ requirements: [{ skillId: CRIT_ELEMENT.id, level: 3 }], weapon: LONG_SWORD }));
    const [first] = out.results;
    expect(first.decorations.weapon).toEqual([CRIT_EL_JEWEL, null]);
    expect(first.freeSlots.weapon).toEqual([2]);
    expect(skillLevel(resolveBuildSkills(asBuild(first, LONG_SWORD), SKILLS), CRIT_ELEMENT.id)).toBe(3);
  });

  it('returns nothing when the levels cannot be reached', () => {
    const out = searchArmorSets(
      input({ requirements: [{ skillId: WEX.id, level: 5 }], armor: pool((k) => gorePiece(k, [], [])), decorations: [] }),
    );
    expect(out.results).toEqual([]);
    expect(out.timedOut).toBe(false);
  });

  it('uses a talisman when it helps', () => {
    const out = searchArmorSets(
      input({ requirements: [{ skillId: WEX.id, level: 2 }], armor: pool((k) => gorePiece(k, [], [])), decorations: [], talismans: [WEX_TALISMAN] }),
    );
    expect(out.results).toHaveLength(1);
    expect(out.results[0].talisman).toBe(WEX_TALISMAN);
  });

  it('puts jewels in the smallest slots that fit, keeping large slots free', () => {
    const out = searchArmorSets(input({ requirements: [{ skillId: EVADE_WINDOW.id, level: 2 }], armor: pool((k) => gorePiece(k)) }));
    const [result] = out.results;
    expect(result.freeSlots.armor.filter((l) => l === 3)).toHaveLength(5);
    expect(result.freeSlots.armor.filter((l) => l === 1)).toHaveLength(3);
  });

  it('lists pieces with the same skills and slots as alternatives instead of separate results', () => {
    const out = searchArmorSets(
      input({ requirements: [{ skillId: WEX.id, level: 5 }], armor: pool((k) => wexPiece(k), (k) => wexPiece(k, [1], ' B')), decorations: [] }),
    );
    expect(out.results).toHaveLength(1);
    expect(out.results[0].alternatives.head.map((p) => p.name)).toEqual(['Wex head B']);
  });

  it('drops pieces that another piece beats on points and slots', () => {
    const out = searchArmorSets(
      input({ requirements: [{ skillId: WEX.id, level: 5 }], armor: pool((k) => wexPiece(k, [3]), (k) => wexPiece(k, [1], ' small')), decorations: [] }),
    );
    expect(out.results).toHaveLength(1);
    expect(out.results[0].armor.head.slots).toEqual([3]);
  });

  it('returns the best sets up to the limit and counts every set found', () => {
    const armor = pool((k) => gorePiece(k), (k) => wexPiece(k, [3, 3]));
    const out = searchArmorSets(input({ requirements: [{ skillId: GORE_SET.id, level: 1 }], armor, maxResults: 2 }));
    expect(out.results).toHaveLength(2);
    // Two Gore pieces at least: C(5,2) + C(5,3) + C(5,4) + C(5,5) = 26 sets.
    expect(out.found).toBe(26);
    // Most slot space: exactly two Gore pieces (their [3, 1] loses to the Wex [3, 3]).
    for (const result of out.results) expect(ARMOR_KINDS.filter((k) => result.armor[k].setId === 100)).toHaveLength(2);
  });

  it('ranks by defense when asked', () => {
    const armor = pool((k) => gorePiece(k), (k) => wexPiece(k, [3, 3]));
    const out = searchArmorSets(input({ requirements: [{ skillId: GORE_SET.id, level: 1 }], armor, maxResults: 1, rankBy: 'defense' }));
    // Gore pieces have more defense (90 vs 80): all five.
    expect(out.results[0].defense).toBe(450);
  });
});
