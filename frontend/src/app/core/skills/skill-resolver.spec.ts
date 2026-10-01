import { Build, collectSkillSources, emptyBuild, validateDecorations } from '../build/build';
import {
  CRIT_EL_JEWEL,
  CRIT_ELEMENT,
  EVADE_WINDOW,
  EVASION_JEWEL,
  EXPERT_JEWEL,
  GORE_SET,
  gorePiece,
  LONG_SWORD,
  SCALING_GROUP,
  SKILLS,
  sl,
  WEX,
  WEX_TALISMAN,
} from '../testing/fixtures';
import { resolveBuildSkills, resolveSkills, skillLevel } from './skill-resolver';

describe('resolveSkills', () => {
  it('returns nothing for an empty build', () => {
    expect(resolveBuildSkills(emptyBuild(), SKILLS)).toEqual([]);
  });

  it('sums points across sources and records where they came from', () => {
    const result = resolveSkills(
      [
        { label: 'A', slot: 'head', skills: [sl(WEX.id, 2)] },
        { label: 'B', slot: 'chest', skills: [sl(WEX.id, 1)] },
      ],
      SKILLS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ points: 3, level: 3, wasted: 0 });
    expect(result[0].sources).toEqual([
      { label: 'A', points: 2 },
      { label: 'B', points: 1 },
    ]);
  });

  it('caps armor skills at max level and reports wasted points', () => {
    const [wex] = resolveSkills([{ label: 'A', slot: 'head', skills: [sl(WEX.id, 7)] }], SKILLS);
    expect(wex).toMatchObject({ points: 7, level: 5, wasted: 2 });
  });

  it('ignores unknown skill ids and zero levels', () => {
    const result = resolveSkills([{ label: 'A', slot: 'head', skills: [sl(999, 3), sl(WEX.id, 0)] }], SKILLS);
    expect(result).toEqual([]);
  });

  it.each([
    [1, 0, undefined, 2],
    [2, 1, 'Black Eclipse I', 4],
    [3, 1, 'Black Eclipse I', 4],
    [4, 2, 'Black Eclipse II', undefined],
    [5, 2, 'Black Eclipse II', undefined],
  ])('set bonus with %i piece(s) is level %i', (pieces, level, rankName, nextThreshold) => {
    const sources = Array.from({ length: pieces }, (_, i) => ({ label: `p${i}`, slot: 'head' as const, skills: [sl(GORE_SET.id, 1)] }));
    const [entry] = resolveSkills(sources, SKILLS);
    expect(entry).toMatchObject({ points: pieces, level, rankName, nextThreshold, wasted: pieces === 5 ? 1 : 0 });
  });

  it('sorts active skills first, then by kind, level and name', () => {
    const result = resolveSkills(
      [
        { label: 'a', slot: 'head', skills: [sl(GORE_SET.id, 1), sl(EVADE_WINDOW.id, 1), sl(WEX.id, 3)] },
        { label: 'b', slot: 'weapon', skills: [sl(CRIT_ELEMENT.id, 1)] },
      ],
      SKILLS,
    );
    expect(result.map((s) => s.skill.name)).toEqual([
      'Critical Element',
      'Weakness Exploit',
      'Evade Window',
      "Gore Magala's Tyranny", // 1 piece: inactive, sorted last
    ]);
  });
});

describe('resolveBuildSkills', () => {
  function fullGoreBuild(): Build {
    return {
      weapon: LONG_SWORD,
      armor: {
        head: gorePiece('head', [sl(EVADE_WINDOW.id, 2)]),
        chest: gorePiece('chest', [sl(EVADE_WINDOW.id, 2)]),
        arms: gorePiece('arms'),
        waist: gorePiece('waist'),
        legs: null,
      },
      talisman: WEX_TALISMAN,
      decorations: {
        weapon: [CRIT_EL_JEWEL],
        head: [EXPERT_JEWEL, EVASION_JEWEL],
        chest: [EXPERT_JEWEL],
      },
    };
  }

  it('combines weapon, armor, talisman and decorations', () => {
    const skills = resolveBuildSkills(fullGoreBuild(), SKILLS);
    expect(skillLevel(skills, CRIT_ELEMENT.id)).toBe(3); // 2 weapon + 1 jewel
    expect(skillLevel(skills, WEX.id)).toBe(4); // 2 talisman + 2 jewels
    expect(skillLevel(skills, EVADE_WINDOW.id)).toBe(5); // 2 + 2 + 1 jewel
    expect(skillLevel(skills, GORE_SET.id)).toBe(2); // 4 pieces
    expect(skillLevel(skills, SCALING_GROUP.id)).toBe(1); // 4 pieces >= 3
  });

  it('skips decorations that do not fit and reports them', () => {
    const build = fullGoreBuild();
    build.decorations = {
      weapon: [EXPERT_JEWEL], // armor jewel in weapon slot
      head: [null, EXPERT_JEWEL], // size 3 jewel in size 1 slot
      chest: [EXPERT_JEWEL, EVASION_JEWEL, EVASION_JEWEL], // only 2 slots
    };
    expect(validateDecorations(build).map((i) => [i.kind, i.slot, i.index])).toEqual([
      ['wrong-slot-type', 'weapon', 0],
      ['slot-too-small', 'head', 1],
      ['no-slot', 'chest', 2],
    ]);

    const labels = collectSkillSources(build).map((s) => s.label);
    expect(labels.filter((l) => l === EXPERT_JEWEL.name)).toHaveLength(1); // only chest[0]
    expect(labels.filter((l) => l === EVASION_JEWEL.name)).toHaveLength(1); // only chest[1]
  });

  it('allows a smaller decoration in a larger slot', () => {
    const build = fullGoreBuild();
    build.decorations = { chest: [EVASION_JEWEL] }; // size 1 jewel in size 3 slot
    expect(validateDecorations(build)).toEqual([]);
  });

  it('uses talisman slots with their declared slot type', () => {
    const build = emptyBuild();
    build.talisman = { ...WEX_TALISMAN, slots: [{ level: 3, accepts: 'weapon' }] };
    build.decorations = { talisman: [CRIT_EL_JEWEL] };
    expect(validateDecorations(build)).toEqual([]);
    expect(skillLevel(resolveBuildSkills(build, SKILLS), CRIT_ELEMENT.id)).toBe(1);
  });
});
