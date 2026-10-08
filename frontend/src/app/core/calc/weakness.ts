import { ElementKind, Monster, MonsterAffinity, StatusKind } from '../models/game-data';

export type WeaknessKind = ElementKind | StatusKind;

export const WEAKNESS_KINDS: readonly WeaknessKind[] = ['fire', 'water', 'thunder', 'ice', 'dragon', 'poison', 'paralysis', 'sleep', 'blastblight'];

export const WEAKNESS_LABELS: Readonly<Record<WeaknessKind, string>> = {
  fire: 'Fire',
  water: 'Water',
  thunder: 'Thunder',
  ice: 'Ice',
  dragon: 'Dragon',
  poison: 'Poison',
  paralysis: 'Paralysis',
  sleep: 'Sleep',
  blastblight: 'Blast',
};

/** How well an element or status works on a monster, from the game's weakness stars. */
export interface WeaknessRating {
  kind: WeaknessKind;
  /** 1-3 weakness stars; 0 when not a weakness. */
  stars: number;
  /** Listed as a resistance (and not as a weakness). */
  resisted: boolean;
  /** When the rating applies, e.g. "More effective once the mantle is broken." */
  note?: string;
}

const matches = (a: MonsterAffinity, kind: WeaknessKind) => (a.kind === 'element' && a.element === kind) || (a.kind === 'status' && a.status === kind);

export function weaknessRating(monster: Monster, kind: WeaknessKind): WeaknessRating {
  const weak = monster.weaknesses.find((a) => matches(a, kind));
  const resisted = !weak && monster.resistances.some((a) => matches(a, kind));
  return { kind, stars: weak?.level ?? 0, resisted, note: weak?.condition };
}

export function weaknessRatings(monster: Monster): WeaknessRating[] {
  return WEAKNESS_KINDS.map((kind) => weaknessRating(monster, kind));
}

/** "★★☆", "resists" or "—" (neither weak nor resistant). */
export function ratingText(r: WeaknessRating): string {
  if (r.resisted) return 'resists';
  return r.stars ? '★'.repeat(r.stars) + '☆'.repeat(Math.max(0, 3 - r.stars)) : '—';
}
