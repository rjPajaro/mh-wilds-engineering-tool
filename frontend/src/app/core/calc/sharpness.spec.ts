import { applyHandicraft, sharpnessState } from './sharpness';

describe('sharpness', () => {
  // Hope Edge I: tops out at green, Handicraft adds [green +0, blue +50].
  const HOPE_EDGE = [50, 60, 40, 50, 0, 0, 0];

  it('uses the top color of the base bar without Handicraft', () => {
    expect(sharpnessState(HOPE_EDGE, [0, 50], 0)).toMatchObject({ color: 'green', top: 3, raw: 1.05, element: 1.0 });
  });

  it('fills Handicraft colors in order, 10 per level', () => {
    expect(applyHandicraft(HOPE_EDGE, [0, 50], 2)).toEqual([50, 60, 40, 50, 20, 0, 0]);
    expect(sharpnessState(HOPE_EDGE, [0, 50], 5)).toMatchObject({ color: 'blue', raw: 1.2 });
  });

  it('spreads across several colors starting at the top color', () => {
    // Top is blue; Handicraft gives blue +10, white +40.
    const base = [30, 50, 70, 60, 80, 0, 0];
    expect(applyHandicraft(base, [10, 40], 1)).toEqual([30, 50, 70, 60, 90, 0, 0]);
    expect(applyHandicraft(base, [10, 40], 3)).toEqual([30, 50, 70, 60, 90, 20, 0]);
    expect(sharpnessState(base, [10, 40], 3).color).toBe('white');
  });

  it('handles weapons without Handicraft data', () => {
    expect(applyHandicraft([10, 0, 0, 0, 0, 0, 0], null, 5)).toEqual([10, 0, 0, 0, 0, 0, 0]);
  });
});
