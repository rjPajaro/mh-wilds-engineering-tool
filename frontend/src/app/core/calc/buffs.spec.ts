import { LONG_SWORD } from '../testing/fixtures';
import { activeBuffs, BUFF_GROUPS, buffedDefense, buffEffects } from './buffs';
import { calculateDamage } from './damage';

describe('buffs', () => {
  it('uses the charms by default and nothing else', () => {
    expect(activeBuffs({}).map((b) => b.name)).toEqual(['Powercharm', 'Armorcharm']);
    expect(activeBuffs({ powercharm: '', armorcharm: '' })).toEqual([]);
  });

  it('keeps one option per group and ignores unknown ids', () => {
    expect(activeBuffs({ powercharm: '', armorcharm: '', might: 'might-pill', demondrug: 'nope' }).map((b) => b.name)).toEqual(['Might Pill']);
  });

  it('has unique group and option ids', () => {
    const groups = BUFF_GROUPS.map((g) => g.id);
    expect(new Set(groups).size).toBe(groups.length);
    for (const g of BUFF_GROUPS) {
      const ids = g.options.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('adds attack buffs as flat attack after skill percentages', () => {
    const weapon = { ...LONG_SWORD, skills: [] };
    const selection = { meal: 'suja', demondrug: 'mega-demondrug', 'demon-powder': 'demon-powder' };
    const buffs = buffEffects(selection);
    expect(buffs.map((b) => b.values.attackFlat)).toEqual([6, 10, 5, 15, 7]); // 15: Caprice Meal (Hi), a condition (off)
    const base = calculateDamage({ weapon, skills: [] }).base.attack;
    const buffed = calculateDamage({ weapon, skills: [], buffs }).base;
    expect(buffed.attack).toBeCloseTo(base + 28);
    expect(buffed.attackParts.map((p) => p.label)).toEqual(['Powercharm', 'Demon Powder', 'Colorful Suja Cuisine', 'Mega Demondrug']);
  });

  it("adds a meal's damage food skill as a condition, off by default", () => {
    const weapon = { ...LONG_SWORD, skills: [] };
    const buffs = buffEffects({ powercharm: '', meal: 'suja' });
    expect(buffs.map((b) => b.label)).toEqual(['Colorful Suja Cuisine', 'Caprice Meal (Hi)']);

    const off = calculateDamage({ weapon, skills: [], buffs });
    expect(off.conditions).toEqual([
      { key: 'Caprice Meal (Hi)', skill: 'Caprice Meal (Hi)', label: 'Random attack boost active (10 s)', on: false, excludes: [] },
    ]);
    expect(off.base.attack).toBe(205);
    expect(calculateDamage({ weapon, skills: [], buffs, toggles: { 'Caprice Meal (Hi)': true } }).base.attack).toBe(220);
    expect(buffEffects({ powercharm: '', meal: 'kunafa' }).map((b) => b.label)).toEqual(['Springy Kunafa Cuisine']);
  });

  it('adds flat defense, then multiplies by the Adamant Pill', () => {
    expect(buffedDefense(500, {})).toBe(512);
    expect(buffedDefense(500, { armorskin: 'mega-armorskin', adamant: 'adamant-pill' })).toBe(Math.floor(537 * 1.3));
  });
});
