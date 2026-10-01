import { Hitzones, Skill, Weapon } from '../models/game-data';
import { ActiveSkill } from '../skills/skill-resolver';
import { LONG_SWORD } from '../testing/fixtures';
import { calculateDamage, hitzoneKind } from './damage';
import { SKILL_EFFECTS } from './skill-effects';
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
      { skill: 'Agitator', label: 'Monster enraged', on: true },
      { skill: 'Counterstrike', label: 'After knockback', on: false },
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

  it('applies Weakness Exploit only on weak points, plus wound bonus', () => {
    const skills = [active('Weakness Exploit', 5, 'attack', 'armor')];
    const weak = calculateDamage({ weapon: RAW_SWORD, skills, target: { hitzones: HZ(0.65), wounded: true } });
    expect(weak.base.affinity).toBe(10); // no target context
    expect(weak.vsTarget?.affinity).toBe(10 + 30 + 20);
    expect(weak.vsTarget?.hit.weakPoint).toBe(true);

    const hard = calculateDamage({ weapon: RAW_SWORD, skills, target: { hitzones: HZ(0.3), wounded: false } });
    expect(hard.vsTarget?.affinity).toBe(10);
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

  it('reports assumed and unmodeled skills', () => {
    const result = calculateDamage({
      weapon: FIRE_SWORD,
      skills: [active('Critical Element', 1), active('Burst', 3, 'offense', 'armor'), active('Evade Window', 5, 'utility', 'armor')],
    });
    expect(result.assumed).toEqual(['Critical Element']);
    expect(result.notModeled).toEqual(['Burst']); // Evade Window is not damage-related
  });

  it('picks hitzone type by weapon', () => {
    expect(hitzoneKind('hammer')).toBe('blunt');
    expect(hitzoneKind('bow')).toBe('pierce');
    expect(hitzoneKind('long-sword')).toBe('slash');
  });
});

describe('SKILL_EFFECTS', () => {
  const byName = new Map((realSkills as { name: string; maxLevel: number }[]).map((s) => [s.name, s]));

  it.each(Object.keys(SKILL_EFFECTS))('%s exists in game data with matching level count', (name) => {
    const skill = byName.get(name);
    expect(skill, `${name} not found in skills.json`).toBeDefined();
    expect(SKILL_EFFECTS[name].levels).toHaveLength(skill!.maxLevel);
  });
});
