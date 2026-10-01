import { Hitzones, Move, Skill, Weapon } from '../models/game-data';
import { ActiveSkill } from '../skills/skill-resolver';
import { LONG_SWORD } from '../testing/fixtures';
import { calculateMoves } from './moves';

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
