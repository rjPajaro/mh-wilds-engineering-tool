import { ArtianConfig, newArtianConfig } from '../artian/artian';
import { emptySavedBuild } from '../build/build';
import { ARMOR_KINDS, ArmorSet, Decoration, Talisman, Weapon } from '../models/game-data';
import { LoadoutContent } from './loadout';
import { decodeShareCode, encodeShareCode, SHARED_ARTIAN_ID, SHARED_TALISMAN_ID, ShareCodeError } from './share-code';
import weapons from '../../../assets/data/weapons.json';
import armor from '../../../assets/data/armor.json';
import decorations from '../../../assets/data/decorations.json';
import talismans from '../../../assets/data/talismans.json';

const WEAPONS = weapons as unknown as Weapon[];
const ARMOR = (armor as unknown as ArmorSet[]).flatMap((s) => s.pieces);
const DECOS = decorations as unknown as Decoration[];
const TALISMANS = talismans as unknown as Talisman[];

function content(overrides: Partial<LoadoutContent> = {}): LoadoutContent {
  return { name: '', weaponKind: 'long-sword', build: emptySavedBuild(), artian: null, talisman: null, setup: null, ...overrides };
}

const roundTrip = (c: LoadoutContent) => decodeShareCode(encodeShareCode(c));

describe('share codes', () => {
  it('round-trips an empty build', () => {
    expect(roundTrip(content())).toEqual(content());
  });

  it('round-trips every weapon, armor piece, talisman and decoration in the game data', () => {
    for (const w of WEAPONS) {
      expect(roundTrip(content({ weaponKind: w.kind, build: { ...emptySavedBuild(), weaponId: w.id } })).build.weaponId).toBe(w.id);
    }
    for (const p of ARMOR) {
      expect(roundTrip(content({ build: { ...emptySavedBuild(), armor: { [p.kind]: p.id } } })).build.armor[p.kind]).toBe(p.id);
    }
    for (const t of TALISMANS) {
      expect(roundTrip(content({ build: { ...emptySavedBuild(), talismanId: t.id } })).build.talismanId).toBe(t.id);
    }
    const ids = DECOS.map((d) => d.id);
    const decoded = roundTrip(content({ build: { ...emptySavedBuild(), decorations: Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map((i) => [['weapon', 'head', 'chest', 'arms', 'waist', 'legs', 'talisman'][i], ids.slice(i * 3, i * 3 + 3)]),
    ) } }));
    expect(Object.values(decoded.build.decorations).flat()).toEqual(ids.slice(0, 21));
  });

  it('round-trips a full build with empty slots, a custom Gogma Artian and the damage setup', () => {
    const artian: ArtianConfig = {
      ...newArtianConfig('sword-shield', 'gogma', 'abc'),
      name: 'Kyrie Verd ✦ dragon',
      element: 'dragon',
      partBonuses: ['attack', 'affinity', 'attack'],
      device: 'element',
      reinforcements: [
        { type: 'attack', level: 'EX' },
        { type: 'attack', level: 'III' },
        { type: 'affinity', level: 'EX' },
        { type: 'sharpness', level: 'EX' },
        { type: 'element', level: 'II' },
      ],
      setSkillId: -1769550080,
      groupSkillId: 1998066176,
    };
    const full = content({
      name: 'Dragon SnS — Arkveld',
      weaponKind: 'sword-shield',
      build: {
        weaponId: artian.id,
        armor: Object.fromEntries(ARMOR_KINDS.map((k) => [k, k === 'arms' ? null : ARMOR.find((p) => p.kind === k)!.id])),
        talismanId: TALISMANS[10].id,
        decorations: { weapon: [DECOS[0].id, null, DECOS[1].id], head: [DECOS[2].id], legs: [] },
      },
      artian,
      setup: { monsterId: '-2003468672', partIndex: '0', wounded: true, toggles: { Agitator: true, 'Latent Power': false } },
    });

    const code = encodeShareCode(full);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(260);

    const decoded = decodeShareCode(code);
    expect(decoded.artian).toEqual({ ...artian, id: SHARED_ARTIAN_ID });
    expect(decoded.build.weaponId).toBe(SHARED_ARTIAN_ID);
    // Empty slots are left out (same as a fresh build).
    expect(decoded.build.armor).toEqual(Object.fromEntries(Object.entries(full.build.armor).filter(([, id]) => id)));
    expect(decoded.build.talismanId).toBe(full.build.talismanId);
    expect(decoded.build.decorations).toEqual({ weapon: [DECOS[0].id, null, DECOS[1].id], head: [DECOS[2].id] });
    expect(decoded.setup).toEqual(full.setup);
    expect(decoded.name).toBe(full.name);
  });

  it('drops a custom weapon whose config is not included', () => {
    expect(roundTrip(content({ build: { ...emptySavedBuild(), weaponId: 'custom:missing' } })).build.weaponId).toBeNull();
  });

  it.each([
    ['garbage', 'not a code!'],
    ['truncated', encodeShareCode(content({ name: 'hello', build: { ...emptySavedBuild(), weaponId: WEAPONS[0].id } })).slice(0, 6)],
    ['trailing bytes', encodeShareCode(content()) + 'AAAA'],
  ])('rejects %s input', (_, code) => {
    expect(() => decodeShareCode(code)).toThrow(ShareCodeError);
  });

  it('rejects codes from a newer format', () => {
    expect(() => decodeShareCode(toCode([4, 0, 0, 0]))).toThrow(/newer version/);
  });

  it('round-trips a custom talisman with its skills and slots', () => {
    const talisman = {
      id: 'custom:mine',
      name: 'WEX charm',
      rarity: 8,
      skills: [{ skillId: -1234, level: 2 }, { skillId: 99, level: 1 }],
      slots: [{ level: 3, accepts: 'armor' as const }, { level: 1, accepts: 'weapon' as const }],
    };
    const decoded = roundTrip(content({ build: { ...emptySavedBuild(), talismanId: talisman.id }, talisman }));
    expect(decoded.talisman).toEqual({ ...talisman, id: SHARED_TALISMAN_ID });
    expect(decoded.build.talismanId).toBe(SHARED_TALISMAN_ID);
    // Without its config a custom talisman cannot be shared.
    expect(roundTrip(content({ build: { ...emptySavedBuild(), talismanId: 'custom:gone' } })).build.talismanId).toBeNull();
  });

  it('round-trips transcended armor', () => {
    const build = { ...emptySavedBuild(), armor: { head: '-123:head:transcended', chest: '-456:chest', legs: '7:legs:transcended' } };
    expect(roundTrip(content({ build })).build.armor).toEqual(build.armor);
  });

  it('still decodes version 1 codes (no transcended byte)', () => {
    // Version 1, long sword, no name, no weapon, head with set id -123 (opt zz = varint 246),
    // four empty armor slots, no talisman, 7 empty decoration lists, no setup.
    const v1 = toCode([1, 0, 0, 0, 246, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(decodeShareCode(v1).build.armor).toEqual({ head: '-123:head' });
  });
});

function toCode(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
