import { Move, MoveRequirement, MoveVariant, SHARPNESS_COLORS, SharpnessColor, Weapon } from '../models/game-data';
import { calculateDamage, DamageInput, HitzoneKind, hitzoneKind } from './damage';

export interface MoveVariantResult {
  label?: string;
  /** Motion value of each hit. */
  hits: number[];
  /** Expected damage of each hit (raw + element), crits averaged in. */
  perHit: number[];
  raw: number;
  element: number;
  /** Fixed damage (Gunlance shell fire): no attack, skills or hitzones. */
  fixed: number;
  total: number;
}

export interface MoveResult {
  section: string;
  name: string;
  damageType: HitzoneKind;
  /** Effective affinity for this move's hitzone (Weakness Exploit depends on it); 0 for moves that can't crit. */
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
 * Per move: `fixedSharpness` replaces the weapon's sharpness, `canCrit: false` takes
 * the crit factors out, and `ignoresHitzone` counts the raw hitzone as 100.
 * Pass moves through movesForWeapon first to drop ammo/shells/phials the weapon lacks.
 */
export function calculateMoves(input: DamageInput, moves: readonly Move[]): MoveResult[] {
  const statsByKey = new Map<string, { stats: HitStats; rawCrit: number; elementCrit: number }>();
  const statsFor = (type: HitzoneKind, sharpness: SharpnessColor | undefined) => {
    const key = `${type}|${sharpness ?? ''}`;
    let entry = statsByKey.get(key);
    if (!entry) {
      const weapon = sharpness ? { ...input.weapon, sharpness: fixedBar(sharpness), handicraft: null } : input.weapon;
      const r = calculateDamage({ ...input, weapon, hitzoneKind: type });
      const s = r.vsTarget ?? r.base;
      const stats = {
        efr: s.efr,
        efe: s.efe,
        affinity: s.affinity,
        rawHitzone: r.vsTarget?.hit.rawHitzone ?? 1,
        elementHitzone: r.vsTarget ? r.vsTarget.hit.elementHitzone : r.elementKind ? 1 : 0,
      };
      statsByKey.set(key, (entry = { stats, rawCrit: s.rawCrit, elementCrit: s.elementCrit }));
    }
    return entry;
  };

  const defaultType = hitzoneKind(input.weapon.kind);
  return moves.map((move) => {
    const damageType = move.damageType ?? defaultType;
    const entry = statsFor(damageType, move.fixedSharpness);
    let stats = entry.stats;
    if (move.canCrit === false) stats = { ...stats, efr: stats.efr / entry.rawCrit, efe: stats.efe / entry.elementCrit, affinity: 0 };
    if (move.ignoresHitzone) stats = { ...stats, rawHitzone: 1 };
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

/** A sharpness bar that is all one color, so calculateDamage uses that color's multipliers. */
function fixedBar(color: SharpnessColor): number[] {
  return SHARPNESS_COLORS.map((c) => (c === color ? 10 : 0));
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
  const fixed = v.fixedDamage ?? 0;
  return { ...(v.label ? { label: v.label } : {}), hits: v.hits, perHit, raw, element, fixed, total: raw + element + fixed };
}

/**
 * The moves `weapon` can use: variants that need ammo, a shell type/level or a phial the
 * weapon lacks are dropped, and moves left without variants with them.
 */
export function movesForWeapon(weapon: Weapon, moves: readonly Move[]): Move[] {
  const out: Move[] = [];
  for (const move of moves) {
    const variants = move.variants.filter((v) => !v.requires || meetsRequirement(weapon, v.requires));
    if (variants.length) out.push(variants.length === move.variants.length ? move : { ...move, variants });
  }
  return out;
}

function meetsRequirement(weapon: Weapon, r: MoveRequirement): boolean {
  if (r.ammo) {
    const ammo = 'ammo' in weapon ? weapon.ammo : [];
    return ammo.some((a) => r.ammo!.includes(a.kind) && (r.level === undefined || a.level === r.level) && (!r.rapid || a.rapid));
  }
  if (r.shell) return weapon.kind === 'gunlance' && r.shell.includes(weapon.shell) && (r.level === undefined || weapon.shellLevel === r.level);
  if (r.phial) return weapon.kind === 'charge-blade' && weapon.phial === r.phial;
  return true;
}

export interface AverageHit {
  /** Expected damage of an average hit (raw + element + fixed). */
  total: number;
  raw: number;
  element: number;
  /** Average motion value of the hits counted. */
  motionValue: number;
  hits: number;
  moves: number;
}

/** Riding, mounting, sneak attacks and power clashes are not part of normal fighting, so they are left out of the average. */
const OUT_OF_COMBAT = /riding|mount|sneak|clash/i;

/**
 * The average hit across a weapon's move list: every hit of every move and
 * charge level/state counts once. Returns null when there are no moves.
 */
export function averageHit(results: readonly MoveResult[]): AverageHit | null {
  let hits = 0;
  let raw = 0;
  let element = 0;
  let fixed = 0;
  let motion = 0;
  let moves = 0;
  for (const move of results) {
    if (OUT_OF_COMBAT.test(move.section)) continue;
    moves++;
    for (const v of move.variants) {
      hits += v.hits.length;
      raw += v.raw;
      element += v.element;
      fixed += v.fixed;
      motion += v.hits.reduce((a, b) => a + b, 0);
    }
  }
  if (!hits) return null;
  return { total: (raw + element + fixed) / hits, raw: raw / hits, element: element / hits, motionValue: motion / hits, hits, moves };
}
