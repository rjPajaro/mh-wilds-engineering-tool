import { Move, WeaponKind } from '../models/game-data';
import { MoveResult } from './moves';

/** One step of a combo: a move from moves.json and, for charge moves, which variant. */
export interface ComboStep {
  move: string;
  variant?: string;
}

export interface Combo {
  name: string;
  steps: readonly ComboStep[];
  source: string;
}

/**
 * The combo from pressing only the light attack button (Triangle / Y / left click),
 * without charging. Only weapon types with motion values in moves.json are listed;
 * the rest are added as their motion values become available.
 */
export const LIGHT_COMBOS: Partial<Record<WeaponKind, Combo>> = {
  'great-sword': {
    name: 'Overhead Slash → Strong Charged Slash → True Charged Slash (uncharged)',
    steps: [
      { move: 'Overhead Slash' },
      { move: 'Strong Charged Slash', variant: 'LV 0' },
      { move: 'True Charged Slash', variant: 'LV 0' },
    ],
    source: 'https://game8.co/games/Monster-Hunter-Wilds/archives/481586',
  },
  'sword-shield': {
    name: 'Chop → Side Slash → Diagonal Rising Slash → Diagonal Chop',
    steps: [{ move: 'Chop' }, { move: 'Side Slash' }, { move: 'Diagonal Rising Slash' }, { move: 'Diagonal Chop' }],
    source: 'https://monsterhunterwiki.org/wiki/MHWilds/Sword_and_Shield_Mechanics (Basic Combo)',
  },
  hammer: {
    name: 'Overhead Smash I → Overhead Smash II → Upswing',
    steps: [{ move: 'Overhead Smash' }, { move: 'Overhead Smash II' }, { move: 'Upswing' }],
    source: 'https://game8.co/games/Monster-Hunter-Wilds/archives/481955',
  },
};

export interface ComboDamage {
  combo: Combo;
  /** Expected damage of the whole combo (raw + element), crits averaged in. */
  total: number;
  raw: number;
  element: number;
  hits: number;
  /** total / hits. */
  perHit: number;
  /** Expected damage of each step. */
  steps: { move: string; variant?: string; damage: number }[];
}

/**
 * Damage of `combo` from per-move results (calculateMoves). Returns null if a step's
 * move or variant is missing, so a data change cannot silently drop part of a combo.
 */
export function comboDamage(combo: Combo, results: readonly MoveResult[]): ComboDamage | null {
  let raw = 0;
  let element = 0;
  let hits = 0;
  const steps: ComboDamage['steps'] = [];
  for (const step of combo.steps) {
    const move = results.find((r) => r.name === step.move);
    const variant = step.variant ? move?.variants.find((v) => v.label === step.variant) : move?.variants[0];
    if (!variant) return null;
    raw += variant.raw;
    element += variant.element;
    hits += variant.hits.length;
    steps.push({ move: step.move, ...(step.variant ? { variant: step.variant } : {}), damage: variant.total });
  }
  if (!hits) return null;
  return { combo, total: raw + element, raw, element, hits, perHit: (raw + element) / hits, steps };
}

/** Moves a combo needs, for checking the table against moves.json. */
export function missingComboMoves(combo: Combo, moves: readonly Move[]): string[] {
  return combo.steps
    .filter((s) => {
      const move = moves.find((m) => m.name === s.move);
      return !move || (s.variant !== undefined && !move.variants.some((v) => v.label === s.variant));
    })
    .map((s) => s.move + (s.variant ? ` [${s.variant}]` : ''));
}
