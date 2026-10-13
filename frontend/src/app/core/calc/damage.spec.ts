import { Hitzones, Skill, Weapon } from '../models/game-data';
import { ActiveSkill } from '../skills/skill-resolver';
import { LONG_SWORD } from '../testing/fixtures';
import { calculateDamage, elementCap, hitzoneKind } from './damage';
import { SET_EFFECTS, SKILL_EFFECTS } from './skill-effects';
import realSkills from '../../../assets/data/skills.json';

function active(name: string, level: number, icon = 'attack', kind: Skill['kind'] = 'weapon'): ActiveSkill {
  const skill: Skill = { id: 0, name, description: '', kind, icon, maxLevel: 5, ranks: [] };
  return { skill, points: level, level, wasted: 0, sources: [] };
}

// 200 attack, 10% affinity, white sharpness (top of [50 x6]), no element.
const RAW_SWORD: Weapon = { ...LONG_SWORD, skills: [], sharpness: [50, 50, 50, 50, 50, 50, 0], handicraft: [] };
const FIRE_SWORD: Weapon = { ...RAW_SWORD, specials: [{ kind: 'element', element: 'fire', value: 30, hidden: false }] };

const HZ = (slash: number, fire = 0): Hitzones => ({
  slash, blunt: slash, pierce: slash, fire, water: 0, thunder: 0, ice: 0, dragon: 0, stun: 0,
});

describe('calculateDamage', () => {
  it('computes effective raw from attack, sharpness and affinity', () => {
    const { base, sharpness } = calculateDamage({ weapon: RAW_SWORD, skills: [] });
    expect(sharpness?.color).toBe('white');
    expect(base.attack).toBe(200);
    expect(base.affinity).toBe(10);
    // 200 * 1.32 * (1 + 0.10 * 0.25)
    expect(base.efr).toBeCloseTo(270.6, 5);
    expect(base.efe).toBe(0);
  });

  it('applies Attack Boost percent to base attack, then flat', () => {
    const { base } = calculateDamage({ weapon: RAW_SWORD, skills: [active('Attack Boost', 5)] });
    expect(base.attack).toBeCloseTo(200 * 1.04 + 9, 5);
    expect(base.attackParts).toEqual([{ label: 'Attack Boost', value: 17 }]);
  });

  it('uses Critical Boost and clamps affinity to 100', () => {
    const { base } = calculateDamage({
      weapon: { ...RAW_SWORD, affinity: 90 },
      skills: [active('Critical Eye', 5), active('Critical Boost', 5)],
    });
    expect(base.affinity).toBe(100);
    expect(base.critMultiplier).toBe(1.4);
    expect(base.efr).toBeCloseTo(200 * 1.32 * 1.4, 5);
  });

  it('reduces damage with negative affinity', () => {
    const { base } = calculateDamage({ weapon: { ...RAW_SWORD, affinity: -20 }, skills: [] });
    expect(base.efr).toBeCloseTo(200 * 1.32 * (1 - 0.2 * 0.25), 5);
  });

  it('respects toggles and their defaults', () => {
    const skills = [active('Agitator', 5, 'offense', 'armor'), active('Counterstrike', 3, 'attack', 'armor')];
    const defaults = calculateDamage({ weapon: RAW_SWORD, skills });
    expect(defaults.conditions).toEqual([
      { key: 'Agitator', skill: 'Agitator', label: 'Monster enraged', on: true, excludes: [] },
      { key: 'Counterstrike', skill: 'Counterstrike', label: 'After knockback', on: false, excludes: [] },
    ]);
    expect(defaults.base.attack).toBe(220);
    expect(defaults.base.affinity).toBe(25);

    const flipped = calculateDamage({ weapon: RAW_SWORD, skills, toggles: { Agitator: false, Counterstrike: true } });
    expect(flipped.base.attack).toBe(225);
    expect(flipped.base.affinity).toBe(10);
  });

  it('applies element skills only to the matching element, in true units', () => {
    const skills = [active('Fire Attack', 3, 'element'), active('Ice Attack', 3, 'element')];
    const { base, elementKind } = calculateDamage({ weapon: FIRE_SWORD, skills });
    expect(elementKind).toBe('fire');
    expect(base.element).toBeCloseTo(30 * 1.2 + 6, 5);
    expect(base.elementParts.map((p) => p.label)).toEqual(['Fire Attack']);
    expect(base.efe).toBeCloseTo(42 * 1.15, 5); // white element sharpness, no crit element
  });

  it('caps element at the larger of base + 400 and base x 2.3 (display units)', () => {
    expect(elementCap(10)).toBe(50); // 100 -> 500
    expect(elementCap(50)).toBeCloseTo(115, 9); // 500 -> 1150
    const normal = calculateDamage({ weapon: FIRE_SWORD, skills: [active('Fire Attack', 3, 'element')] }).base;
    expect(normal.elementCap).toBeCloseTo(70, 9);
    expect(normal.elementCapped).toBe(false);

    const capped = calculateDamage({ weapon: FIRE_SWORD, skills: [], buffs: [{ label: 'Test', values: { elementFlat: 100 } }] }).base;
    expect(capped.element).toBeCloseTo(70, 9);
    expect(capped.elementCapped).toBe(true);
    expect(capped.efe).toBeCloseTo(70 * 1.15, 9);
    expect(calculateDamage({ weapon: RAW_SWORD, skills: [] }).base).toMatchObject({ elementCap: null, elementCapped: false });
  });

  it('applies status skills only to the matching status, capped like element after Coalescence', () => {
    const PARA_SWORD: Weapon = { ...RAW_SWORD, specials: [{ kind: 'status', status: 'paralysis', value: 20, hidden: false }] };
    const skills = [active('Paralysis Attack', 3, 'element'), active('Poison Attack', 3, 'element')];
    const { base } = calculateDamage({ weapon: PARA_SWORD, skills });
    expect(base.status).toBeCloseTo(20 * 1.2 + 5, 9); // 200 -> 290 display (Game8 test)
    expect(base.statusParts.map((p) => p.label)).toEqual(['Paralysis Attack']);
    expect(base.statusCap).toBeCloseTo(60, 9);
    expect(base.statusCapped).toBe(false);
    expect(base.element).toBeNull();
    expect(calculateDamage({ weapon: FIRE_SWORD, skills }).base).toMatchObject({ status: null, statusParts: [], elementParts: [] });

    const withCoalescence = calculateDamage({ weapon: PARA_SWORD, skills: [...skills, active('Coalescence', 3, 'element', 'armor')], toggles: { Coalescence: true } }).base;
    expect(withCoalescence.statusDamagePct).toBe(15);
    expect(withCoalescence.status).toBeCloseTo(29 * 1.15, 9);

    const capped = calculateDamage({ weapon: PARA_SWORD, skills, buffs: [{ label: 'Test', values: { statusFlat: 40 } }] }).base;
    expect(capped.status).toBeCloseTo(60, 9);
    expect(capped.statusCapped).toBe(true);
  });

  it('applies guard skills only to weapons that can guard', () => {
    const skills = [active('Offensive Guard', 3)];
    const toggles = { 'Offensive Guard': true };
    const bow = calculateDamage({ weapon: { ...RAW_SWORD, kind: 'bow', coatings: [] }, skills, toggles });
    expect(bow.base.attack).toBe(200);
    expect(bow.conditions).toEqual([]);
    const lance = calculateDamage({ weapon: { ...RAW_SWORD, kind: 'lance' }, skills, toggles });
    expect(lance.base.attack).toBeCloseTo(230, 5);
  });

  it('applies Weakness Exploit only on weak points, plus wound bonus', () => {
    const skills = [active('Weakness Exploit', 5, 'attack', 'armor')];
    const weak = calculateDamage({ weapon: RAW_SWORD, skills, target: { hitzones: HZ(0.65), wounded: true } });
    expect(weak.base.affinity).toBe(10 + 30); // no target: a weak point
    expect(weak.vsTarget?.affinity).toBe(10 + 30 + 20);
    expect(weak.vsTarget?.hit.weakPoint).toBe(true);

    const hard = calculateDamage({ weapon: RAW_SWORD, skills, target: { hitzones: HZ(0.3), wounded: false } });
    expect(hard.vsTarget?.affinity).toBe(10);
  });

  it('turns Weakness Exploit off with its condition', () => {
    const skills = [active('Weakness Exploit', 5, 'attack', 'armor')];
    const on = calculateDamage({ weapon: RAW_SWORD, skills });
    expect(on.conditions).toEqual([
      { key: 'Weakness Exploit', skill: 'Weakness Exploit', label: 'Hitting a weak point (hitzone 45+)', on: true, excludes: [] },
    ]);
    const toggles = { 'Weakness Exploit': false };
    expect(calculateDamage({ weapon: RAW_SWORD, skills, toggles }).base.affinity).toBe(10);
    const target = { hitzones: HZ(0.65), wounded: true };
    expect(calculateDamage({ weapon: RAW_SWORD, skills, toggles, target }).vsTarget?.affinity).toBe(10);
  });

  it('computes damage per 100 MV against the target hitzones', () => {
    const { vsTarget } = calculateDamage({ weapon: FIRE_SWORD, skills: [], target: { hitzones: HZ(0.65, 0.2), wounded: false } });
    const raw = 200 * 1.32 * (1 + 0.1 * 0.25) * 0.65;
    const element = 30 * 1.15 * 0.2;
    expect(vsTarget?.hit).toMatchObject({ hitzoneKind: 'slash', rawHitzone: 0.65, elementHitzone: 0.2 });
    expect(vsTarget?.hit.raw).toBeCloseTo(raw, 5);
    expect(vsTarget?.hit.element).toBeCloseTo(element, 5);
    expect(vsTarget?.hit.total).toBeCloseTo(raw + element, 5);
  });

  it('applies Bludgeoner only at low sharpness', () => {
    const skills = [active('Bludgeoner', 3, 'handicraft')];
    const green = { ...RAW_SWORD, sharpness: [50, 50, 50, 50, 0, 0, 0] };
    expect(calculateDamage({ weapon: green, skills }).base.rawDamagePct).toBe(10);
    expect(calculateDamage({ weapon: RAW_SWORD, skills }).base.rawDamagePct).toBe(0);
  });

  it('applies Coalescence to element before the cap, by weapon type, when toggled', () => {
    const skills = [active('Coalescence', 3, 'element', 'armor')];
    const off = calculateDamage({ weapon: FIRE_SWORD, skills });
    expect(off.conditions).toEqual([
      { key: 'Coalescence', skill: 'Coalescence', label: 'After recovering from a blight or ailment', on: false, excludes: [] },
    ]);
    expect(off.base.elementDamagePct).toBe(0);

    const on = calculateDamage({ weapon: FIRE_SWORD, skills, toggles: { Coalescence: true } });
    expect(on.base.elementDamagePct).toBe(15);
    expect(on.base.elementDamageParts).toEqual([{ label: 'Coalescence', value: 15 }]);
    expect(on.base.element).toBeCloseTo(off.base.element! * 1.15, 9);
    expect(on.base.efe).toBeCloseTo(off.base.efe * 1.15, 5);
    expect(on.base.efr).toBe(off.base.efr);

    const hammer = calculateDamage({ weapon: { ...FIRE_SWORD, kind: 'hammer' }, skills, toggles: { Coalescence: true } });
    expect(hammer.base.elementDamagePct).toBe(30);
    expect(calculateDamage({ weapon: RAW_SWORD, skills, toggles: { Coalescence: true } }).base.efe).toBe(0);
  });

  it('caps element after Coalescence when several element sources stack', () => {
    // Base 430 (display): cap 430 x 2.3 = 989. Dragon Attack 3, Burst 5, Gogmapocalypse 2 = 885, x1.2 Coalescence = 1062.
    const weapon: Weapon = { ...FIRE_SWORD, kind: 'charge-blade', phial: 'impact', specials: [{ kind: 'element' as const, element: 'fire' as const, value: 43, hidden: false }] };
    const skills = [
      active('Fire Attack', 3, 'element'),
      active('Burst', 5, 'offense', 'armor'),
      active('Gogmapocalypse', 2, 'element', 'set'),
      active('Coalescence', 2, 'element', 'armor'),
    ];
    const { base } = calculateDamage({ weapon, skills, toggles: { Coalescence: true } });
    expect(base.elementCap).toBeCloseTo(98.9, 9);
    expect(base.element).toBeCloseTo(98.9, 9);
    expect(base.elementCapped).toBe(true);
    const noCoalescence = calculateDamage({ weapon, skills }).base;
    expect(noCoalescence.element).toBeCloseTo(88.5, 9);
    expect(noCoalescence.elementCapped).toBe(false);
  });

  it('applies Burst attack and element by weapon type, on by default', () => {
    const skills = [active('Burst', 5, 'offense', 'armor')];
    const plain = calculateDamage({ weapon: FIRE_SWORD, skills: [] });
    const on = calculateDamage({ weapon: FIRE_SWORD, skills });
    expect(on.conditions).toEqual([{ key: 'Burst', skill: 'Burst', label: 'After 5 hits in a row', on: true, excludes: [] }]);
    expect(on.base.attackParts).toContainEqual({ label: 'Burst', value: 18 });
    expect(on.base.elementParts).toContainEqual({ label: 'Burst', value: 14 });

    const off = calculateDamage({ weapon: FIRE_SWORD, skills, toggles: { Burst: false } });
    expect(off.base.attack).toBe(plain.base.attack);

    const greatSword = calculateDamage({ weapon: { ...FIRE_SWORD, kind: 'great-sword' }, skills });
    expect(greatSword.base.elementParts).toContainEqual({ label: 'Burst', value: 20 });
    const bow = calculateDamage({ weapon: { ...FIRE_SWORD, kind: 'bow', coatings: [] }, skills });
    expect(bow.base.attackParts).toContainEqual({ label: 'Burst', value: 10 });
  });

  it('reports assumed and unmodeled skills', () => {
    const result = calculateDamage({
      weapon: FIRE_SWORD,
      skills: [active('Critical Element', 1), active('Flayer', 3, 'offense', 'armor'), active('Evade Window', 5, 'utility', 'armor')],
    });
    expect(result.assumed).toEqual(['Critical Element']);
    expect(result.notModeled).toEqual(['Flayer']); // Evade Window is not damage-related
  });

  it('never applies Peak Performance together with Resentment or Heroics', () => {
    const skills = [active('Peak Performance', 5, 'attack', 'armor'), active('Resentment', 5, 'attack', 'armor'), active('Heroics', 5, 'attack', 'armor')];
    const defaults = calculateDamage({ weapon: RAW_SWORD, skills });
    expect(defaults.conditions.map((c) => [c.key, c.on, c.excludes])).toEqual([
      ['Peak Performance', true, ['Resentment', 'Heroics']],
      ['Resentment', false, ['Peak Performance']],
      ['Heroics', false, ['Peak Performance']],
    ]);
    expect(defaults.base.attack).toBe(220); // Peak Performance only

    // Switching on Resentment (or Heroics) wins over Peak Performance's default; those two stack.
    const red = calculateDamage({ weapon: RAW_SWORD, skills, toggles: { Resentment: true, Heroics: true } });
    expect(red.conditions.map((c) => c.on)).toEqual([false, true, true]);
    expect(red.base.attack).toBeCloseTo(200 * 1.3 + 25, 5);
  });

  it('applies Antivirus only with a Frenzy source', () => {
    const antivirus = active('Antivirus', 3, 'affinity', 'armor');
    const none = calculateDamage({ weapon: RAW_SWORD, skills: [antivirus] });
    expect(none.base.affinity).toBe(10);
    expect(none.conditions).toEqual([]);
    expect(none.noEffect).toEqual([{ skill: 'Antivirus', reason: 'nothing infects you with Frenzy' }]);

    const gore = calculateDamage({ weapon: RAW_SWORD, skills: [antivirus, active("Gore Magala's Tyranny", 1, 'set', 'set')] });
    expect(gore.base.affinity).toBe(20);
    expect(gore.noEffect).toEqual([]);
    expect(calculateDamage({ weapon: RAW_SWORD, skills: [antivirus], targetInflictsFrenzy: true }).base.affinity).toBe(20);
  });

  it('toggles set bonuses, including extra toggles, only at ranks that do something', () => {
    const gore = (level: number) => active("Gore Magala's Tyranny", level, 'set', 'set');
    expect(calculateDamage({ weapon: RAW_SWORD, skills: [gore(1)] }).conditions).toEqual([]);

    const four = calculateDamage({ weapon: RAW_SWORD, skills: [gore(2)] });
    expect(four.conditions.map((c) => [c.key, c.on])).toEqual([
      ["Gore Magala's Tyranny", true],
      ["Gore Magala's Tyranny: overcome", false],
    ]);
    expect(four.base.attack).toBe(210);
    expect(four.notModeled).toEqual([]);

    const overcome = calculateDamage({ weapon: RAW_SWORD, skills: [gore(2)], toggles: { "Gore Magala's Tyranny: overcome": true } });
    expect(overcome.base.attack).toBe(215);
    const off = calculateDamage({ weapon: RAW_SWORD, skills: [gore(2)], toggles: { "Gore Magala's Tyranny": false } });
    expect(off.base.attack).toBe(200);
  });

  it('applies Gogmapocalypse element boost while enraged', () => {
    const skills = [active('Gogmapocalypse', 2, 'set', 'set')];
    expect(calculateDamage({ weapon: FIRE_SWORD, skills }).base.element).toBeCloseTo(30 * 1.3 + 4, 5);
    expect(calculateDamage({ weapon: FIRE_SWORD, skills, toggles: { Gogmapocalypse: false } }).base.element).toBe(30);
  });

  it('picks hitzone type by weapon', () => {
    expect(hitzoneKind('hammer')).toBe('blunt');
    expect(hitzoneKind('bow')).toBe('pierce');
    expect(hitzoneKind('long-sword')).toBe('slash');
  });
});

describe('SKILL_EFFECTS', () => {
  const byName = new Map((realSkills as { name: string; maxLevel: number }[]).map((s) => [s.name, s]));

  const all = { ...SKILL_EFFECTS, ...SET_EFFECTS };

  it.each(Object.keys(all))('%s exists in game data with matching level count', (name) => {
    const skill = byName.get(name);
    expect(skill, `${name} not found in skills.json`).toBeDefined();
    expect(all[name].levels).toHaveLength(skill!.maxLevel);
    for (const x of all[name].extra ?? []) expect(x.levels).toHaveLength(skill!.maxLevel);
  });
});
