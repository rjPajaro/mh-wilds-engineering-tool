import { Move, MoveVariant } from '../models/game-data';
import { calculateDamage, DamageInput, HitzoneKind, hitzoneKind } from './damage';

export interface MoveVariantResult {
  label?: string;
  /** Motion value of each hit. */
  hits: number[];
  /** Expected damage of each hit (raw + element), crits averaged in. */
  perHit: number[];
  raw: number;
  element: number;
  total: number;
}

export interface MoveResult {
  section: string;
  name: string;
  damageType: HitzoneKind;
  /** Effective affinity for this move's hitzone (Weakness Exploit depends on it). */
  affinity: number;
  /** Hitzones used, as fractions (1 = 100 when there is no target). */
  rawHitzone: number;
  elementHitzone: number;
  notes: string[];
  variants: MoveVariantResult[];
}

interface HitStats {
  efr: number;
  efe: number;
  affinity: number;
  rawHitzone: number;
  elementHitzone: number;
}

/**
 * Expected damage of every move against the input's target, crits averaged in:
 *
 *   raw hit     = effective raw     × MV / 100 × raw hitzone
 *   element hit = effective element × element modifier × element hitzone
 *
 * Element damage does not scale with motion value; each move has its own element
 * modifier instead. Without a target both hitzones count as 100.
 * Effective raw/element come from calculateDamage, so skills, conditions,
 * sharpness and Weakness Exploit (per the move's hitzone) all apply.
 */
export function calculateMoves(input: DamageInput, moves: readonly Move[]): MoveResult[] {
  const statsByType = new Map<HitzoneKind, HitStats>();
  const statsFor = (type: HitzoneKind): HitStats => {
    let stats = statsByType.get(type);
    if (!stats) {
      const r = calculateDamage({ ...input, hitzoneKind: type });
      const s = r.vsTarget ?? r.base;
      stats = {
        efr: s.efr,
        efe: s.efe,
        affinity: s.affinity,
        rawHitzone: r.vsTarget?.hit.rawHitzone ?? 1,
        elementHitzone: r.vsTarget ? r.vsTarget.hit.elementHitzone : r.elementKind ? 1 : 0,
      };
      statsByType.set(type, stats);
    }
    return stats;
  };

  const defaultType = hitzoneKind(input.weapon.kind);
  return moves.map((move) => {
    const damageType = move.damageType ?? defaultType;
    const stats = statsFor(damageType);
    return {
      section: move.section,
      name: move.name,
      damageType,
      affinity: stats.affinity,
      rawHitzone: stats.rawHitzone,
      elementHitzone: stats.elementHitzone,
      notes: move.notes ?? [],
      variants: move.variants.map((v) => variantDamage(move, v, stats)),
    };
  });
}

function variantDamage(move: Move, v: MoveVariant, s: HitStats): MoveVariantResult {
  let raw = 0;
  let element = 0;
  const perHit = v.hits.map((mv, i) => {
    const modifier = v.elementModifiers?.[i] ?? v.elementModifier ?? move.elementModifier ?? 1;
    const r = (s.efr * mv * s.rawHitzone) / 100;
    const e = s.efe * modifier * s.elementHitzone;
    raw += r;
    element += e;
    return r + e;
  });
  return { ...(v.label ? { label: v.label } : {}), hits: v.hits, perHit, raw, element, total: raw + element };
}
