import { Skill } from '../models/game-data';
import { CATEGORY_OVERRIDES, SKILL_CATEGORIES, skillCategory } from './skill-categories';
import skillsJson from '../../../assets/data/skills.json';

const skills = skillsJson as unknown as Skill[];
const byName = (name: string) => skills.find((s) => s.name === name)!;

describe('skillCategory', () => {
  it('has an override for names that exist in the data only', () => {
    const names = new Set(skills.map((s) => s.name));
    expect(Object.keys(CATEGORY_OVERRIDES).filter((n) => !names.has(n))).toEqual([]);
  });

  it('maps every skill icon in the data to a category (no fallbacks)', () => {
    const fallback = skills.filter((s) => s.kind !== 'set' && s.kind !== 'group' && !(s.name in CATEGORY_OVERRIDES) && skillCategory(s) === 'utility' && s.icon !== 'utility');
    expect(fallback.map((s) => s.name)).toEqual([]);
  });

  it('files skills by what they do', () => {
    expect(skillCategory(byName('Attack Boost'))).toBe('attack');
    expect(skillCategory(byName('Agitator'))).toBe('attack');
    expect(skillCategory(byName('Weakness Exploit'))).toBe('affinity');
    expect(skillCategory(byName('Critical Boost'))).toBe('affinity');
    expect(skillCategory(byName('Fire Attack'))).toBe('element');
    expect(skillCategory(byName('Handicraft'))).toBe('sharpness');
    expect(skillCategory(byName('Evade Window'))).toBe('utility');
    expect(skillCategory(byName("Gore Magala's Tyranny"))).toBe('set');
    expect(skillCategory(byName('Lord\'s Soul'))).toBe('group');
  });

  it('leaves no category empty', () => {
    const used = new Set(skills.map(skillCategory));
    expect(SKILL_CATEGORIES.filter((c) => !used.has(c.id)).map((c) => c.id)).toEqual([]);
  });
});
