import { Skill } from '../models/game-data';
import {
  buildCustomTalisman,
  CustomTalismanConfig,
  isCustomTalismanConfig,
  newCustomTalisman,
  sameTalisman,
  talismanSummary,
  validateCustomTalisman,
} from './custom-talisman';

const skill = (id: number, name: string, maxLevel: number, kind: Skill['kind'] = 'armor'): Skill => ({
  id,
  name,
  description: '',
  kind,
  icon: '',
  maxLevel,
  ranks: [],
});
const SKILLS = new Map([
  [1, skill(1, 'Weakness Exploit', 5)],
  [2, skill(2, 'Agitator', 5)],
  [3, skill(3, 'Paralysis Attack', 3, 'weapon')],
  [4, skill(4, 'Gogmapocalypse', 4, 'set')],
]);

const config = (changes: Partial<CustomTalismanConfig> = {}): CustomTalismanConfig => ({
  ...newCustomTalisman('custom:t'),
  skills: [{ skillId: 1, level: 2 }],
  slots: [
    { level: 1, accepts: 'weapon' },
    { level: 3, accepts: 'armor' },
  ],
  ...changes,
});

const errors = (c: CustomTalismanConfig) => validateCustomTalisman(c, SKILLS).filter((i) => i.severity === 'error').map((i) => i.message);

describe('custom talismans', () => {
  it('builds a talisman named after its charm type, highest slot first', () => {
    expect(buildCustomTalisman(config(), SKILLS)).toEqual({
      id: 'custom:t',
      name: 'Golden Age Charm',
      rarity: 8,
      skills: [{ skillId: 1, level: 2 }],
      slots: [
        { level: 3, accepts: 'armor' },
        { level: 1, accepts: 'weapon' },
      ],
    });
    expect(buildCustomTalisman(config({ name: '  My charm ', rarity: 6 }), SKILLS)!.name).toBe('My charm');
  });

  it('rejects impossible talismans', () => {
    expect(errors(config())).toEqual([]);
    expect(errors(config({ rarity: 4 }))).toEqual(['Rarity 4 is not a charm rarity.']);
    expect(errors(config({ skills: [{ skillId: 1, level: 6 }] }))).toEqual(['Weakness Exploit goes from level 1 to 5.']);
    expect(errors(config({ skills: [{ skillId: 3, level: 3 }] }))).toEqual([]); // weapon skills are allowed
    expect(errors(config({ skills: [{ skillId: 4, level: 1 }] }))).toEqual(['Gogmapocalypse is not a skill talismans can have.']);
    expect(errors(config({ skills: [{ skillId: 1, level: 1 }, { skillId: 1, level: 2 }] }))).toEqual(['Weakness Exploit is listed twice.']);
    expect(errors(config({ slots: [{ level: 4, accepts: 'armor' }] }))).toEqual(['Slot levels go from 1 to 3.']);
    expect(
      errors(config({ skills: [1, 2, 1, 2].map((id, i) => ({ skillId: id + i * 10, level: 1 })) })).some((e) => e.includes('at most 3 skills')),
    ).toBe(true);
    expect(buildCustomTalisman(config({ rarity: 4 }), SKILLS)).toBeNull();
  });

  it('warns about an empty talisman', () => {
    expect(validateCustomTalisman(config({ skills: [], slots: [] }), SKILLS)).toEqual([
      { severity: 'warning', message: 'Add the skills and slots your talisman has.' },
    ]);
  });

  it('summarises skills and slots', () => {
    expect(talismanSummary(config({ skills: [{ skillId: 1, level: 2 }, { skillId: 2, level: 1 }] }), SKILLS)).toBe(
      'Weakness Exploit 2 · Agitator 1 · W1-3',
    );
  });

  it('compares talismans regardless of id and order', () => {
    const a = config({ skills: [{ skillId: 1, level: 2 }, { skillId: 2, level: 1 }] });
    const b = { ...a, id: 'custom:other', skills: [...a.skills].reverse(), slots: [...a.slots].reverse() };
    expect(sameTalisman(a, b)).toBe(true);
    expect(sameTalisman(a, { ...b, rarity: 7 })).toBe(false);
  });

  it('checks the stored shape', () => {
    expect(isCustomTalismanConfig(config())).toBe(true);
    expect(isCustomTalismanConfig({ ...config(), id: '1:1' })).toBe(false);
    expect(isCustomTalismanConfig({ ...config(), slots: [{ level: 1, accepts: 'leg' }] })).toBe(false);
  });
});
