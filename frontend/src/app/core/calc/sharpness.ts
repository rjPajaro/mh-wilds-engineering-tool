import { SHARPNESS_COLORS, SharpnessColor } from '../models/game-data';

/**
 * Sharpness multipliers, indexed like SHARPNESS_COLORS. Not in the dataset; these
 * are the long-standing series values (World/Rise) and still need checking against Wilds.
 */
export const SHARPNESS_RAW = [0.5, 0.75, 1.0, 1.05, 1.2, 1.32, 1.39] as const;
export const SHARPNESS_ELEMENT = [0.25, 0.5, 0.75, 1.0, 1.0625, 1.15, 1.25] as const;

/** Sharpness points added per Handicraft level. */
const HANDICRAFT_PER_LEVEL = 10;

export interface SharpnessState {
  /** Hits per color after Handicraft, indexed like SHARPNESS_COLORS. */
  bar: number[];
  /** Index of the highest color with hits. */
  top: number;
  color: SharpnessColor;
  raw: number;
  element: number;
}

/**
 * Applies Handicraft to a base bar. `handicraft` lists the extra hits Handicraft 5
 * can add per color, starting at the base bar's top color (see docs/DATA.md).
 */
export function applyHandicraft(base: readonly number[], handicraft: readonly number[] | null, level: number): number[] {
  const bar = [...base];
  let remaining = Math.max(0, level) * HANDICRAFT_PER_LEVEL;
  const start = topIndex(base);
  (handicraft ?? []).forEach((extra, i) => {
    const add = Math.min(extra, remaining);
    if (start + i < bar.length) bar[start + i] += add;
    remaining -= add;
  });
  return bar;
}

export function sharpnessState(base: readonly number[], handicraft: readonly number[] | null, level: number): SharpnessState {
  const bar = applyHandicraft(base, handicraft, level);
  const top = topIndex(bar);
  return { bar, top, color: SHARPNESS_COLORS[top], raw: SHARPNESS_RAW[top], element: SHARPNESS_ELEMENT[top] };
}

function topIndex(bar: readonly number[]): number {
  for (let i = bar.length - 1; i >= 0; i--) if (bar[i] > 0) return i;
  return 0;
}
