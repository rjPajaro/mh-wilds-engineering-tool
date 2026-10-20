import { LONG_SWORD } from '../testing/fixtures';
import { CUSTOM_BUFF_FIELDS, CUSTOM_BUFF_PRESETS, customBuffEffects, customBuffFromPreset, customBuffValues, isCustomBuffList, newCustomBuff } from './custom-buffs';
import { calculateDamage } from './damage';

describe('custom buffs', () => {
  const buff = (name: string, values: object, enabled = true) => ({ ...newCustomBuff(name), name, enabled, values });

  it('converts entered values to calculator values, element from display units', () => {
    expect(
      customBuffValues(buff('All', { attackFlat: 5, attackPct: 10, affinity: 15, critBonus: 5, elementFlat: 120, elementPct: 10, rawMultiplier: 20, elementMultiplier: 25 })),
    ).toEqual({ attackFlat: 5, attackPct: 10, affinity: 15, critBonus: 5, elementFlat: 12, elementPct: 10, rawDamagePct: 20, elementFinalPct: 25 });
  });

  it('skips disabled and empty buffs, and labels blank or repeated names', () => {
    const effects = customBuffEffects([
      buff('Off', { attackFlat: 10 }, false),
      buff('Empty', {}),
      buff('', { affinity: 10 }),
      buff('Song', { attackPct: 10 }),
      buff('Song', { affinity: 5 }),
    ]);
    expect(effects.map((e) => e.label)).toEqual(['Custom buff', 'Song', 'Song (2)']);
    expect(effects.every((e) => !e.toggle)).toBe(true);
  });

  it('accepts only well-formed stored lists', () => {
    expect(isCustomBuffList([])).toBe(true);
    expect(isCustomBuffList([buff('Song', { attackFlat: 10 })])).toBe(true);
    expect(isCustomBuffList({})).toBe(false);
    expect(isCustomBuffList([{ ...buff('x', {}), enabled: 'yes' }])).toBe(false);
    expect(isCustomBuffList([buff('x', { unknown: 1 })])).toBe(false);
    expect(isCustomBuffList([buff('x', { attackFlat: '10' })])).toBe(false);
  });

  it('has unique field keys', () => {
    const keys = CUSTOM_BUFF_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has presets with unique ids, valid values and names', () => {
    const ids = CUSTOM_BUFF_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const made = CUSTOM_BUFF_PRESETS.map((p, i) => customBuffFromPreset(String(i), p));
    expect(isCustomBuffList(made)).toBe(true);
    expect(customBuffEffects(made)).toHaveLength(CUSTOM_BUFF_PRESETS.length); // every preset changes something
  });

  it('copies preset values so editing the buff leaves the preset alone', () => {
    const preset = CUSTOM_BUFF_PRESETS.find((p) => p.id === 'corrupted-mantle-2')!;
    const made = customBuffFromPreset('x', preset);
    expect(made).toEqual({ id: 'x', name: 'Corrupted Mantle, after consecutive hits', enabled: true, values: { affinity: 10, attackPct: 4.5 } });
    made.values.affinity = 99;
    expect(preset.values.affinity).toBe(10);
  });

  it('feeds the damage calculator like any other buff', () => {
    const weapon = { ...LONG_SWORD, skills: [] };
    const buffs = customBuffEffects([buff('Song', { attackPct: 10, attackFlat: 5, affinity: 20 })]);
    const base = calculateDamage({ weapon, skills: [], buffs }).base;
    expect(base.attack).toBeCloseTo(200 * 1.1 + 5, 9);
    expect(base.affinity).toBe(30);
    expect(base.attackParts).toEqual([{ label: 'Song', value: 25 }]);
  });
});
