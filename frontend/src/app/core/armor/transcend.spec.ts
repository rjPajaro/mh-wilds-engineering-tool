import { ArmorPiece } from '../models/game-data';
import { baseArmorId, canTranscend, isTranscendedId, transcend, transcendedId } from './transcend';

function piece(rarity: number, slots: number[]): ArmorPiece {
  return {
    id: '-100:head',
    setId: -100,
    kind: 'head',
    name: 'Test Helm',
    rarity,
    defense: { base: 50, max: 80 },
    resistances: { fire: 0, water: 0, thunder: 0, ice: 0, dragon: 0 },
    slots,
    skills: [{ skillId: 1, level: 2 }],
  };
}

describe('transcend', () => {
  it('raises all three slot positions on rarity 5, filling empty ones with level 1', () => {
    expect(transcend(piece(5, [1, 1]))!.slots).toEqual([2, 2, 1]);
    expect(transcend(piece(5, []))!.slots).toEqual([1, 1, 1]);
    expect(transcend(piece(5, [3, 2, 1]))!.slots).toEqual([3, 3, 2]);
  });

  it('raises the first two slot positions on rarity 6, capped at level 3', () => {
    expect(transcend(piece(6, [3]))!.slots).toEqual([3, 1]); // game8's example: ③ - - -> ③ ① -
    expect(transcend(piece(6, [2, 1, 1]))!.slots).toEqual([3, 2, 1]);
  });

  it('keeps slots on rarity 7 and 8 and adds max defense per rarity', () => {
    expect(transcend(piece(7, [2]))).toMatchObject({ slots: [2], defense: { base: 50, max: 90 } });
    expect(transcend(piece(8, [3, 1]))).toMatchObject({ slots: [3, 1], defense: { base: 50, max: 88 } });
    expect(transcend(piece(5, []))!.defense).toEqual({ base: 50, max: 96 });
    expect(transcend(piece(6, []))!.defense).toEqual({ base: 50, max: 92 });
  });

  it('keeps name and skills, marks the piece and suffixes its id', () => {
    const t = transcend(piece(6, [1]))!;
    expect(t).toMatchObject({ id: '-100:head:transcended', name: 'Test Helm', transcended: true, skills: [{ skillId: 1, level: 2 }] });
    expect(transcend(t)).toBeNull(); // only once
  });

  it('does not apply to rarity 4 and below', () => {
    expect(canTranscend(piece(4, []))).toBe(false);
    expect(transcend(piece(4, [1]))).toBeNull();
    expect(canTranscend(piece(5, []))).toBe(true);
  });

  it('converts ids', () => {
    expect(transcendedId('-100:head')).toBe('-100:head:transcended');
    expect(transcendedId('-100:head:transcended')).toBe('-100:head:transcended');
    expect(baseArmorId('-100:head:transcended')).toBe('-100:head');
    expect(isTranscendedId('-100:head')).toBe(false);
  });
});
