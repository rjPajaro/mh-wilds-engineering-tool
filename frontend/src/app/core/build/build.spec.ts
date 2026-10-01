import { BuildLookup, emptySavedBuild, isSavedBuild, resolveBuild, SavedBuild } from './build';
import { EXPERT_JEWEL, gorePiece, LONG_SWORD, WEX_TALISMAN } from '../testing/fixtures';

const HEAD = gorePiece('head');

const lookup: BuildLookup = {
  weapon: (id) => (id === LONG_SWORD.id ? LONG_SWORD : undefined),
  armor: (id) => (id === HEAD.id ? HEAD : undefined),
  talisman: (id) => (id === WEX_TALISMAN.id ? WEX_TALISMAN : undefined),
  decoration: (id) => (id === EXPERT_JEWEL.id ? EXPERT_JEWEL : undefined),
};

describe('resolveBuild', () => {
  it('resolves saved ids into gear', () => {
    const saved: SavedBuild = {
      weaponId: LONG_SWORD.id,
      armor: { head: HEAD.id, chest: null },
      talismanId: WEX_TALISMAN.id,
      decorations: { head: [EXPERT_JEWEL.id, null] },
    };
    const build = resolveBuild(saved, lookup);
    expect(build.weapon).toBe(LONG_SWORD);
    expect(build.armor.head).toBe(HEAD);
    expect(build.armor.chest).toBeNull();
    expect(build.talisman).toBe(WEX_TALISMAN);
    expect(build.decorations.head).toEqual([EXPERT_JEWEL, null]);
  });

  it('turns ids that no longer exist into empty slots', () => {
    const build = resolveBuild(
      { weaponId: 'custom:deleted', armor: { legs: 'gone' }, talismanId: 'gone', decorations: { weapon: [999] } },
      lookup,
    );
    expect(build).toMatchObject({ weapon: null, talisman: null, armor: { legs: null }, decorations: { weapon: [null] } });
  });
});

describe('isSavedBuild', () => {
  it('accepts saved builds and rejects other shapes', () => {
    expect(isSavedBuild(emptySavedBuild())).toBe(true);
    expect(isSavedBuild({ weaponId: 'x', armor: { head: 'y' }, talismanId: null, decorations: { head: [1, null] } })).toBe(true);
    expect(isSavedBuild(null)).toBe(false);
    expect(isSavedBuild({ weaponId: 3, armor: {}, talismanId: null, decorations: {} })).toBe(false);
    expect(isSavedBuild({ weaponId: null, armor: {}, talismanId: null, decorations: { head: ['1'] } })).toBe(false);
  });
});
