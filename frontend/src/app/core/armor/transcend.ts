import { ArmorPiece } from '../models/game-data';

/**
 * Armor Transcending (Title Update 4, HR 100+). Not in the game data; rules from
 * https://game8.co/games/Monster-Hunter-Wilds/archives/571459:
 *
 * - Rarity 5: +1 level to all three slot positions, +8 upgrade levels (+16 defense).
 * - Rarity 6: +1 level to the first two slot positions, +6 levels (+12 defense).
 * - Rarity 7: no slot change, +5 levels (+10 defense).
 * - Rarity 8: no slot change, +4 levels (+8 defense).
 * - Rarity 4 and below cannot be transcended.
 *
 * An empty position counts as level 0, so it becomes a level 1 slot
 * (rarity 6 "③ - -" becomes "③ ① -"). Slots cap at level 3. Defense is added to
 * the fully upgraded (max) value; base defense is unchanged.
 */
const RULES: Record<number, { slotPositions: number; extraDefense: number }> = {
  5: { slotPositions: 3, extraDefense: 16 },
  6: { slotPositions: 2, extraDefense: 12 },
  7: { slotPositions: 0, extraDefense: 10 },
  8: { slotPositions: 0, extraDefense: 8 },
};

/** A transcended piece's id is its normal id plus this suffix. */
export const TRANSCENDED_SUFFIX = ':transcended';

const MAX_SLOTS = 3;
const MAX_SLOT_LEVEL = 3;

export function canTranscend(piece: Pick<ArmorPiece, 'rarity'>): boolean {
  return piece.rarity in RULES;
}

export function isTranscendedId(id: string): boolean {
  return id.endsWith(TRANSCENDED_SUFFIX);
}

/** The untranscended piece's id. */
export function baseArmorId(id: string): string {
  return isTranscendedId(id) ? id.slice(0, -TRANSCENDED_SUFFIX.length) : id;
}

export function transcendedId(id: string): string {
  return baseArmorId(id) + TRANSCENDED_SUFFIX;
}

/** The transcended version of `piece`, or null if its rarity cannot be transcended. */
export function transcend(piece: ArmorPiece): ArmorPiece | null {
  const rule = RULES[piece.rarity];
  if (!rule || piece.transcended) return null;
  const positions = Array.from({ length: MAX_SLOTS }, (_, i) => piece.slots[i] ?? 0);
  const slots = positions
    .map((level, i) => (i < rule.slotPositions ? Math.min(level + 1, MAX_SLOT_LEVEL) : level))
    .filter((level) => level > 0);
  return {
    ...piece,
    id: transcendedId(piece.id),
    slots,
    defense: { base: piece.defense.base, max: piece.defense.max + rule.extraDefense },
    transcended: true,
  };
}
