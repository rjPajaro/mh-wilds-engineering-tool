import { Skill } from '../models/game-data';
import { levelEffect, RESEARCHED_SKILL_VALUES, skillLevelValues, sourceText } from './skill-values';
import skillsJson from '../../../assets/data/skills.json';

const skills = skillsJson as unknown as Skill[];
const skill = (name: string) => skills.find((s) => s.name === name)!;

describe('RESEARCHED_SKILL_VALUES', () => {
  it('names skills that exist, with one value per level for every weapon row', () => {
    for (const [name, values] of Object.entries(RESEARCHED_SKILL_VALUES)) {
      const s = skill(name);
      expect(s, name).toBeDefined();
      for (const group of values.groups) expect(group.levels, `${name} (${group.label})`).toHaveLength(s.maxLevel);
      expect(values.groups.filter((g) => g.kinds === 'other').length, name).toBeLessThanOrEqual(1);
      expect(values.sources.length, name).toBeGreaterThan(0);
    }
  });

  it('only covers skills whose game text has no numbers', () => {
    for (const name of Object.keys(RESEARCHED_SKILL_VALUES)) {
      expect(skill(name).ranks.every((r) => /\d/.test(r.description)), name).toBe(false);
    }
  });
});

describe('skillLevelValues', () => {
  it('gives Burst numbers for the weapon type', () => {
    const at5 = (kind: Parameters<typeof skillLevelValues>[1]) => skillLevelValues(skill('Burst'), kind).levels[4].text;
    expect(at5('long-sword')).toBe('Attack +18, element +140');
    expect(at5('great-sword')).toBe('Attack +18, element +200');
    expect(at5('dual-blades')).toBe('Attack +18, element +120');
    expect(at5('bow')).toBe('Attack +10, element +120');
    const burst = skillLevelValues(skill('Burst'), 'hammer');
    expect(burst.levels.map((l) => l.level)).toEqual([1, 2, 3, 4, 5]);
    expect(burst.researched).toMatchObject({ weapons: 'Other weapons', varies: false, confirmed: true });
  });

  it('says when the numbers vary and no weapon type is given', () => {
    expect(skillLevelValues(skill('Burst'), null).researched).toMatchObject({ weapons: 'Other weapons', varies: true });
    // Charge Master's "other" row has no charged attacks; without a weapon it shows Great Sword.
    expect(skillLevelValues(skill('Charge Master'), null).researched!.weapons).toBe('Great Sword');
    expect(skillLevelValues(skill('Flayer'), null).researched!.varies).toBe(false);
  });

  it("uses the game's own text when it has numbers", () => {
    const attack = skillLevelValues(skill('Attack Boost'), 'long-sword');
    expect(attack.researched).toBeUndefined();
    expect(attack.numeric).toBe(true);
    expect(attack.levels[0]).toEqual({ level: 1, text: 'Attack +3' });
  });

  it('gives the effect of one level, with set bonus ranks and nothing below level 1', () => {
    expect(levelEffect(skill('Burst'), 5, 'long-sword')).toMatchObject({ text: 'Attack +18, element +140', researched: { confirmed: true } });
    expect(levelEffect(skill('Attack Boost'), 4, 'long-sword')).toEqual({ text: 'Attack +2% Bonus: +8', researched: undefined });
    expect(levelEffect(skill('Evade Window'), 3, 'long-sword')).toBeNull();
    expect(levelEffect(skill('Burst'), 0, 'long-sword')).toBeNull();
    const gore = skill("Gore Magala's Tyranny");
    expect(levelEffect(gore, 2, null)).toEqual({ text: gore.ranks[1].description });
  });

  it('names the sources, and says when they are not confirmed', () => {
    expect(sourceText(skillLevelValues(skill('Burst'), null).researched!)).toBe('Game8 + Fextralife');
    expect(sourceText(skillLevelValues(skill('Flayer'), null).researched!)).toBe('Game8 (one source)');
    expect(sourceText(skillLevelValues(skill('Charge Master'), null).researched!)).toBe('Game8 + Fextralife (sources differ)');
  });

  it('flags skills without numbers anywhere', () => {
    expect(skillLevelValues(skill('Convert Element'), 'long-sword').numeric).toBe(false);
  });
});
