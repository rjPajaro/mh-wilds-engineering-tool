import { Hitzones, Move, MoveData, Skill, Weapon, WEAPON_KINDS } from '../models/game-data';
import { ActiveSkill } from '../skills/skill-resolver';
import { LONG_SWORD } from '../testing/fixtures';
import { averageHit, calculateMoves, movesForWeapon } from './moves';
import movesJson from '../../../assets/data/moves.json';
import weaponsJson from '../../../assets/data/weapons.json';

// 200 attack, 0 affinity, white sharpness (raw ×1.32, element ×1.15), 30 fire.
const SWORD: Weapon = {
  ...LONG_SWORD,
  affinity: 0,
  skills: [],
  sharpness: [50, 50, 50, 50, 50, 50, 0],
  handicraft: [],
  specials: [{ kind: 'element', element: 'fire', value: 30, hidden: false }],
};
const EFR = 200 * 1.32;
const EFE = 30 * 1.15;

const HZ: Hitzones = { slash: 0.5, blunt: 0.4, pierce: 0.3, fire: 0.2, water: 0, thunder: 0, ice: 0, dragon: 0, stun: 0 };

const MOVES: Move[] = [
  { section: 'Combo', name: 'Overhead', variants: [{ hits: [80] }] },
  {
    section: 'Combo',
    name: 'Charged',
    elementModifier: 1.5,
    variants: [
      { label: 'LV 1', hits: [100] },
      { label: 'LV 2', hits: [10, 150], elementModifiers: [1, 2] },
    ],
  },
  { section: 'Combo', name: 'Tackle', damageType: 'blunt', elementModifier: 0, variants: [{ hits: [30] }] },
];

function active(name: string, level: number): ActiveSkill {
  const skill: Skill = { id: 0, name, description: '', kind: 'armor', icon: 'attack', maxLevel: 5, ranks: [] };
  return { skill, points: level, level, wasted: 0, sources: [] };
}

describe('calculateMoves', () => {
  const target = { hitzones: HZ, wounded: false };

  it('scales raw by motion value and adds element per hit', () => {
    const [overhead] = calculateMoves({ weapon: SWORD, skills: [], target }, MOVES);
    const raw = EFR * 0.8 * 0.5;
    const element = EFE * 1 * 0.2;
    expect(overhead.variants[0].raw).toBeCloseTo(raw, 6);
    expect(overhead.variants[0].element).toBeCloseTo(element, 6);
    expect(overhead.variants[0].total).toBeCloseTo(raw + element, 6);
    expect(overhead.damageType).toBe('slash');
  });

  it('uses move, variant and per-hit element modifiers', () => {
    const [, charged] = calculateMoves({ weapon: SWORD, skills: [], target }, MOVES);
    expect(charged.variants[0].element).toBeCloseTo(EFE * 1.5 * 0.2, 6);
    expect(charged.variants[1].perHit[0]).toBeCloseTo(EFR * 0.1 * 0.5 + EFE * 1 * 0.2, 6);
    expect(charged.variants[1].perHit[1]).toBeCloseTo(EFR * 1.5 * 0.5 + EFE * 2 * 0.2, 6);
    expect(charged.variants[1].total).toBeCloseTo(charged.variants[1].perHit[0] + charged.variants[1].perHit[1], 6);
  });

  it('uses the blunt hitzone for blunt moves and honors a zero element modifier', () => {
    const tackle = calculateMoves({ weapon: SWORD, skills: [], target }, MOVES)[2];
    expect(tackle.damageType).toBe('blunt');
    expect(tackle.variants[0].raw).toBeCloseTo(EFR * 0.3 * 0.4, 6);
    expect(tackle.variants[0].element).toBe(0);
  });

  it('checks Weakness Exploit against each move’s own hitzone', () => {
    // slash 50 is a weak point, blunt 40 is not.
    const weakSpot: Hitzones = { ...HZ, slash: 0.5, blunt: 0.4 };
    const results = calculateMoves({ weapon: SWORD, skills: [active('Weakness Exploit', 5)], target: { hitzones: weakSpot, wounded: false } }, MOVES);
    const critExpected = 1 + 0.3 * 0.25; // +30% affinity, base crit 1.25
    expect(results[0].variants[0].raw).toBeCloseTo(EFR * critExpected * 0.8 * 0.5, 6);
    expect(results[2].variants[0].raw).toBeCloseTo(EFR * 0.3 * 0.4, 6); // no WE on the blunt hit
    expect(results.map((r) => [r.affinity, r.rawHitzone, r.elementHitzone])).toEqual([
      [30, 0.5, 0.2],
      [30, 0.5, 0.2],
      [0, 0.4, 0.2],
    ]);
  });

  it('assumes hitzone 100 without a target', () => {
    const [overhead] = calculateMoves({ weapon: SWORD, skills: [] }, MOVES);
    expect(overhead.variants[0].raw).toBeCloseTo(EFR * 0.8, 6);
    expect(overhead.variants[0].element).toBeCloseTo(EFE, 6);
  });
});

describe('averageHit', () => {
  const input = { weapon: SWORD, skills: [], toggles: {}, target: null };

  it('averages every hit of every move and charge level', () => {
    const avg = averageHit(calculateMoves(input, MOVES))!;
    // Hits: 80 | 100 | 10, 150 | 30 (blunt, no element) -> 5 hits, MV 370 in total.
    expect(avg.hits).toBe(5);
    expect(avg.moves).toBe(3);
    expect(avg.motionValue).toBeCloseTo(74);
    expect(avg.raw).toBeCloseTo((EFR * 3.7) / 5);
    // Element modifiers: 1 + 1.5 + (1 + 2) + 0.
    expect(avg.element).toBeCloseTo((EFE * 5.5) / 5);
    expect(avg.total).toBeCloseTo(avg.raw + avg.element);
  });

  it('leaves out riding, mounting and sneak attacks', () => {
    const extra: Move[] = [
      { section: 'Riding Attacks', name: 'Riding Attack', variants: [{ hits: [500] }] },
      { section: 'Mount', name: 'Mount Finisher', variants: [{ hits: [500] }] },
      { section: 'Sneaking', name: 'Sneak Attack', variants: [{ hits: [500] }] },
    ];
    expect(averageHit(calculateMoves(input, [...MOVES, ...extra]))!.hits).toBe(5);
    expect(averageHit(calculateMoves(input, extra))).toBeNull();
  });
});

describe('move flags', () => {
  // 10 affinity from LONG_SWORD's base would muddy the numbers; use 50 so crits clearly matter.
  const CRITTER: Weapon = { ...SWORD, affinity: 50 };
  const target = { hitzones: HZ, wounded: false };
  const crit = 1 + 0.5 * 0.25;

  it('takes crits out of moves that cannot crit', () => {
    const moves: Move[] = [
      { section: 'A', name: 'Normal', variants: [{ hits: [100] }] },
      { section: 'A', name: 'No crit', canCrit: false, variants: [{ hits: [100] }] },
    ];
    const [normal, noCrit] = calculateMoves({ weapon: CRITTER, skills: [], target }, moves);
    expect(normal.variants[0].raw).toBeCloseTo(EFR * crit * 0.5, 6);
    expect(noCrit.variants[0].raw).toBeCloseTo(EFR * 0.5, 6);
    expect(noCrit.variants[0].element).toBeCloseTo(EFE * 0.2, 6);
    expect(noCrit.affinity).toBe(0);
  });

  it('uses a fixed sharpness color instead of the weapon’s', () => {
    const moves: Move[] = [{ section: 'A', name: 'Green', fixedSharpness: 'green', variants: [{ hits: [100] }] }];
    const [green] = calculateMoves({ weapon: SWORD, skills: [], target }, moves);
    expect(green.variants[0].raw).toBeCloseTo(200 * 1.05 * 0.5, 6);
    expect(green.variants[0].element).toBeCloseTo(30 * 1.0 * 0.2, 6);
  });

  it('counts the raw hitzone as 100 for hitzone-ignoring moves, element still uses its hitzone', () => {
    const moves: Move[] = [{ section: 'A', name: 'Ignore', ignoresHitzone: true, variants: [{ hits: [100] }] }];
    const [ignore] = calculateMoves({ weapon: SWORD, skills: [], target }, moves);
    expect(ignore.rawHitzone).toBe(1);
    expect(ignore.variants[0].raw).toBeCloseTo(EFR, 6);
    expect(ignore.variants[0].element).toBeCloseTo(EFE * 0.2, 6);
  });

  it('adds fixed damage to the total and the average hit', () => {
    const moves: Move[] = [{ section: 'Shelling', name: 'Shell', elementModifier: 0, variants: [{ hits: [10], fixedDamage: 6 }] }];
    const results = calculateMoves({ weapon: SWORD, skills: [] }, moves);
    expect(results[0].variants[0].fixed).toBe(6);
    expect(results[0].variants[0].total).toBeCloseTo(EFR * 0.1 + 6, 6);
    expect(averageHit(results)!.total).toBeCloseTo(EFR * 0.1 + 6, 6);
  });

  it('leaves power clashes out of the average', () => {
    const moves: Move[] = [...MOVES, { section: 'Power Clash', name: 'Clash Finisher', variants: [{ hits: [500] }] }];
    expect(averageHit(calculateMoves({ weapon: SWORD, skills: [] }, moves))!.hits).toBe(5);
  });
});

describe('movesForWeapon', () => {
  const ammoMove: Move = {
    section: 'Ammo',
    name: 'Normal Ammo',
    variants: [
      { label: 'LV 1', hits: [10], requires: { ammo: ['normal'], level: 1 } },
      { label: 'LV 2', hits: [15], requires: { ammo: ['normal'], level: 2 } },
      { label: 'LV 2, Rapid Fire', hits: [12], requires: { ammo: ['normal'], level: 2, rapid: true } },
    ],
  };
  const fireAmmo: Move = { section: 'Ammo', name: 'Element Ammo', variants: [{ label: 'LV 1', hits: [5], requires: { ammo: ['flaming', 'water'], level: 1 } }] };
  const plain: Move = { section: 'A', name: 'Melee', variants: [{ hits: [20] }] };

  it('keeps only ammo levels the bowgun carries, and Rapid Fire only when that ammo is rapid', () => {
    const bowgun = { ...LONG_SWORD, kind: 'light-bowgun', specialAmmo: null, ammo: [{ kind: 'normal', level: 2, capacity: 4, rapid: false }, { kind: 'water', level: 1, capacity: 3, rapid: false }] } as unknown as Weapon;
    const moves = movesForWeapon(bowgun, [ammoMove, fireAmmo, plain]);
    expect(moves.map((m) => [m.name, m.variants.map((v) => v.label)])).toEqual([
      ['Normal Ammo', ['LV 2']],
      ['Element Ammo', ['LV 1']],
      ['Melee', [undefined]],
    ]);
    const rapid = { ...bowgun, ammo: [{ kind: 'normal', level: 2, capacity: 4, rapid: true }] } as unknown as Weapon;
    expect(movesForWeapon(rapid, [ammoMove])[0].variants.map((v) => v.label)).toEqual(['LV 2', 'LV 2, Rapid Fire']);
  });

  it('matches gunlance shell type and level, and charge blade phial type', () => {
    const shell: Move = {
      section: 'Shelling',
      name: 'Shell',
      variants: [
        { label: 'LV 1', hits: [7], requires: { shell: ['normal', 'wide'], level: 1 } },
        { label: 'LV 2', hits: [8], requires: { shell: ['normal', 'wide'], level: 2 } },
      ],
    };
    const gunlance = { ...LONG_SWORD, kind: 'gunlance', shell: 'wide', shellLevel: 2 } as unknown as Weapon;
    expect(movesForWeapon(gunlance, [shell])[0].variants.map((v) => v.label)).toEqual(['LV 2']);
    expect(movesForWeapon({ ...gunlance, shell: 'long' } as Weapon, [shell])).toEqual([]);

    const phial = (p: 'impact' | 'element'): Move => ({ section: 'Phial Bursts', name: 'Phial Burst', variants: [{ hits: [5], requires: { phial: p } }] });
    const cb = { ...LONG_SWORD, kind: 'charge-blade', phial: 'element' } as unknown as Weapon;
    expect(movesForWeapon(cb, [phial('impact'), phial('element')]).map((m) => m.variants[0].requires?.phial)).toEqual(['element']);
  });
});

describe('moves.json', () => {
  const data = movesJson as unknown as MoveData;

  it('has motion values for every weapon type', () => {
    expect(Object.keys(data.weapons).sort()).toEqual([...WEAPON_KINDS].sort());
  });

  it('leaves every weapon in the game data with moves to calculate', () => {
    for (const weapon of weaponsJson as unknown as Weapon[]) {
      const moves = movesForWeapon(weapon, data.weapons[weapon.kind]!.moves);
      expect(averageHit(calculateMoves({ weapon, skills: [] }, moves)), weapon.id).not.toBeNull();
    }
  });

  it('gives every bowgun at least one ammo it can fire', () => {
    for (const weapon of (weaponsJson as unknown as Weapon[]).filter((w) => w.kind.endsWith('bowgun'))) {
      const ammo = movesForWeapon(weapon, data.weapons[weapon.kind]!.moves).filter((m) => m.section === 'Ammo');
      expect(ammo.length, weapon.id).toBeGreaterThan(0);
    }
  });
});
