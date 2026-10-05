import { Skill } from '../models/game-data';
import { skillStatTable } from './skill-stats';
import skillsJson from '../../../assets/data/skills.json';

const skills = skillsJson as unknown as Skill[];
const skill = (name: string) => skills.find((s) => s.name === name)!;
const rows = (name: string, level = 0, kind: Parameters<typeof skillStatTable>[2] = 'long-sword') =>
  Object.fromEntries(skillStatTable(skill(name), level, kind).rows.map((r) => [r.stat, r.values]));

describe('skillStatTable', () => {
  it("splits the calculator's skills by stat, with their condition", () => {
    const agitator = skillStatTable(skill('Agitator'), 3, 'long-sword');
    expect(agitator.levels).toEqual([1, 2, 3, 4, 5]);
    expect(rows('Agitator')).toEqual({
      Attack: ['+4', '+8', '+12', '+16', '+20'],
      Affinity: ['+3%', '+5%', '+7%', '+10%', '+15%'],
    });
    expect(agitator.condition).toBe('Monster enraged');
    expect(agitator.level).toBe(3);
  });

  it('leaves a level blank where it does not change a stat', () => {
    expect(rows('Attack Boost')).toEqual({ Attack: ['+3', '+5', '+7', '+8', '+9'], 'Attack %': ['', '', '', '+2%', '+4%'] });
  });

  it('shows element in display units and names element-only skills', () => {
    const fire = skillStatTable(skill('Fire Attack'), 1, 'long-sword');
    expect(rows('Fire Attack')).toEqual({ Element: ['+40', '+50', '+60'], 'Element %': ['', '+10%', '+20%'] });
    expect(fire.condition).toBe('Fire weapons only');
  });

  it('adds the wound bonus and the weak point condition for Weakness Exploit', () => {
    expect(rows('Weakness Exploit')['Extra on wounds']).toEqual(['+3%', '+5%', '+10%', '+15%', '+20%']);
    expect(skillStatTable(skill('Weakness Exploit'), 5, null).condition).toBe('Hitting a weak point (hitzone 45+)');
  });

  it('uses researched numbers for the weapon type, with their source', () => {
    expect(rows('Burst', 0, 'great-sword')).toEqual({ Attack: ['+10', '+12', '+14', '+16', '+18'], Element: ['+80', '+100', '+120', '+160', '+200'] });
    expect(rows('Burst', 0, 'bow')['Attack']).toEqual(['+6', '+7', '+8', '+9', '+10']);
    const burst = skillStatTable(skill('Burst'), 2, 'bow');
    expect(burst.researched).toMatchObject({ weapons: 'Bow, bowguns', confirmed: true });
    expect(burst.note).toContain('After 5 hits in a row');
    // Researched values win over the calculator's flat Critical Element numbers.
    expect(rows('Critical Element', 0, 'great-sword')['Element on crits']).toEqual(['×1.07 (approx.)', '×1.13 (approx.)', '×1.2']);
  });

  it('reads simple "<stat> +<n>" game text as a stat row', () => {
    expect(rows('Handicraft')).toEqual({ 'Weapon sharpness': ['+10', '+20', '+30', '+40', '+50'] });
  });

  it('falls back to one line per level for other text, and per rank for set bonuses', () => {
    const evade = skillStatTable(skill('Evade Window'), 2, null);
    expect(evade.rows).toEqual([]);
    expect(evade.lines[0]).toEqual({ level: 1, label: 'Lv 1', text: skill('Evade Window').ranks[0].description });

    const gore = skillStatTable(skill("Gore Magala's Tyranny"), 1, null);
    expect(gore.lines.map((l) => l.label)).toEqual(['Black Eclipse I (2 pieces)', 'Black Eclipse II (4 pieces)']);
    expect(gore.level).toBe(1);
  });
});
