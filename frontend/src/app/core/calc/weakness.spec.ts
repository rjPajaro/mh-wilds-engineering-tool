import { Monster } from '../models/game-data';
import { ratingText, weaknessRating, weaknessRatings } from './weakness';

const MONSTER: Monster = {
  id: 1,
  name: 'Test Wyvern',
  species: 'flying-wyvern',
  speciesName: 'Flying Wyvern',
  baseHealth: 10000,
  weaknesses: [
    { kind: 'element', element: 'dragon', level: 3 },
    { kind: 'element', element: 'thunder', level: 1, condition: 'More effective once the mantle is broken.' },
    { kind: 'status', status: 'paralysis', level: 2 },
    { kind: 'effect', effect: 'stun', level: 1 },
  ],
  resistances: [
    { kind: 'element', element: 'fire' },
    { kind: 'status', status: 'sleep' },
  ],
  parts: [],
};

describe('weaknessRating', () => {
  it('rates weaknesses by stars, resistances and neutral elements and statuses', () => {
    expect(weaknessRating(MONSTER, 'dragon')).toEqual({ kind: 'dragon', stars: 3, resisted: false, note: undefined });
    expect(weaknessRating(MONSTER, 'thunder').note).toBe('More effective once the mantle is broken.');
    expect(weaknessRating(MONSTER, 'paralysis').stars).toBe(2);
    expect(weaknessRating(MONSTER, 'fire')).toMatchObject({ stars: 0, resisted: true });
    expect(weaknessRating(MONSTER, 'sleep')).toMatchObject({ stars: 0, resisted: true });
    expect(weaknessRating(MONSTER, 'water')).toMatchObject({ stars: 0, resisted: false });
  });

  it('lists every element and status, and formats them', () => {
    const all = weaknessRatings(MONSTER);
    expect(all.map((r) => r.kind)).toEqual(['fire', 'water', 'thunder', 'ice', 'dragon', 'poison', 'paralysis', 'sleep', 'blastblight']);
    expect(all.map(ratingText)).toEqual(['resists', '—', '★☆☆', '—', '★★★', '—', '★★☆', 'resists', '—']);
  });
});
