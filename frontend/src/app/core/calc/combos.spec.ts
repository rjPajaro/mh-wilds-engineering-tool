import { MoveData, WeaponKind } from '../models/game-data';
import { LONG_SWORD } from '../testing/fixtures';
import { comboDamage, LIGHT_COMBOS, missingComboMoves } from './combos';
import { calculateMoves } from './moves';
import moves from '../../../assets/data/moves.json';

const MOVES = moves as unknown as MoveData;

describe('light combos', () => {
  it('only uses moves and charge levels that exist in the motion value data', () => {
    for (const [kind, combo] of Object.entries(LIGHT_COMBOS)) {
      const list = MOVES.weapons[kind as WeaponKind]?.moves;
      expect(list, kind).toBeDefined();
      expect(missingComboMoves(combo!, list!), kind).toEqual([]);
    }
  });

  it('sums the combo and averages it per hit', () => {
    const weapon = { ...LONG_SWORD, kind: 'sword-shield' as const, affinity: 0, skills: [], specials: [], sharpness: null, handicraft: null };
    const results = calculateMoves({ weapon, skills: [], toggles: {}, target: null }, MOVES.weapons['sword-shield']!.moves);
    const d = comboDamage(LIGHT_COMBOS['sword-shield']!, results)!;
    // 200 attack, no sharpness or crit: raw per hit = 200 x MV / 100. Chop 18, Side Slash 17,
    // Diagonal Rising Slash 24, Diagonal Chop 27 -> 4 hits, MV 86.
    expect(d.hits).toBe(4);
    expect(d.total).toBeCloseTo(200 * 0.86);
    expect(d.perHit).toBeCloseTo((200 * 0.86) / 4);
    expect(d.steps.map((s) => s.move)).toEqual(['Chop', 'Side Slash', 'Diagonal Rising Slash', 'Diagonal Chop']);
  });

  it('returns null when a step is missing', () => {
    expect(comboDamage({ name: 'x', steps: [{ move: 'Nope' }], source: '' }, [])).toBeNull();
  });
});
