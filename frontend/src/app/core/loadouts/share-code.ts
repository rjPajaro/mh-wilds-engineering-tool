import { ArtianConfig, PartBonus, REINFORCEMENT_TYPES } from '../artian/artian';
import { baseArmorId, isTranscendedId, transcendedId } from '../armor/transcend';
import { CustomTalismanConfig, isCustomTalismanId } from '../talismans/custom-talisman';
import { EQUIP_SLOTS, SavedBuild } from '../build/build';
import { ARMOR_KINDS, ARTIAN_ELEMENTS, GOGMA_DEVICES, REINFORCEMENT_LEVELS, WEAPON_KINDS } from '../models/game-data';
import { DamageSetup, LoadoutContent } from './loadout';

/**
 * Share codes: a LoadoutContent packed into a short, URL-safe string.
 *
 * Binary layout, base64url-encoded. Integers are unsigned varints; game ids are
 * signed, so they are zigzag-encoded. "opt" values are 0 for none, else value + 1.
 * Game ids (not list positions) are used so codes survive data updates.
 *
 *   u8      format version (3; 1 and 2 are still decoded)
 *   varint  weapon kind (index in WEAPON_KINDS)
 *   string  name
 *   weapon  u8 tag: 0 none | 1 game weapon: varint kind, zz game id | 2 custom Artian (block below)
 *   armor   5 x opt zz set id (ARMOR_KINDS order)
 *   talisman v1-2: opt zz game id, varint rank (only when present)
 *            v3+: u8 tag: 0 none | 1 game: zz game id, varint rank | 2 custom talisman (block below)
 *   decos   7 x (varint count, count x opt zz decoration id) (EQUIP_SLOTS order)
 *   setup   u8 flag; if 1: opt zz monster id, opt part index, u8 wounded, varint n, n x (string skill, u8 on)
 *   v2+     u8 transcended armor bits (bit i = ARMOR_KINDS[i])
 *
 * Custom Artian: varint kind, u8 tier, u8 rarity, opt element, u8 matching parts,
 * u8 part-bonus bits (1 = affinity), u8 device, varint n, n x u8 (type * 4 + level),
 * opt zz set skill, opt zz group skill, string name.
 *
 * Custom talisman: u8 rarity, varint n, n x (zz skill id, u8 level), varint m,
 * m x u8 (slot level * 2 + 1 if weapon slot), string name.
 *
 * Strings: varint byte length + UTF-8. Bump the version for incompatible changes
 * and keep decoding old versions.
 */
export const SHARE_CODE_VERSION = 3;

/** Id given to a decoded custom Artian; callers replace it with a real one. */
export const SHARED_ARTIAN_ID = 'custom:shared';
/** Id given to a decoded custom talisman; callers replace it with a real one. */
export const SHARED_TALISMAN_ID = 'custom:shared-talisman';

export class ShareCodeError extends Error {}

export function encodeShareCode(content: LoadoutContent): string {
  const w = new Writer();
  w.u8(SHARE_CODE_VERSION);
  w.varint(indexOf(WEAPON_KINDS, content.weaponKind));
  w.string(content.name);

  const { build, artian } = content;
  if (!build.weaponId) {
    w.u8(0);
  } else if (artian && build.weaponId === artian.id) {
    w.u8(2);
    writeArtian(w, artian);
  } else if (build.weaponId.startsWith('custom:')) {
    // Custom weapon without its config: nothing to share.
    w.u8(0);
  } else {
    const [kind, gameId] = splitLast(build.weaponId);
    w.u8(1);
    w.varint(indexOf(WEAPON_KINDS, kind));
    w.zz(Number(gameId));
  }

  for (const kind of ARMOR_KINDS) {
    const id = build.armor[kind];
    w.opt(id ? zigzag(Number(splitLast(baseArmorId(id))[0])) : null);
  }

  if (!build.talismanId) {
    w.u8(0);
  } else if (content.talisman && build.talismanId === content.talisman.id) {
    w.u8(2);
    writeTalisman(w, content.talisman);
  } else if (isCustomTalismanId(build.talismanId)) {
    // Custom talisman without its config: nothing to share.
    w.u8(0);
  } else {
    const [gameId, rank] = splitLast(build.talismanId);
    w.u8(1);
    w.zz(Number(gameId));
    w.varint(Number(rank));
  }

  for (const slot of EQUIP_SLOTS) {
    const list = build.decorations[slot] ?? [];
    w.varint(list.length);
    for (const id of list) w.opt(id === null ? null : zigzag(id));
  }

  const setup = content.setup;
  if (!setup || (!setup.monsterId && !Object.keys(setup.toggles).length && !setup.wounded)) {
    w.u8(0);
  } else {
    w.u8(1);
    w.opt(setup.monsterId ? zigzag(Number(setup.monsterId)) : null);
    w.opt(setup.partIndex ? Number(setup.partIndex) : null);
    w.u8(setup.wounded ? 1 : 0);
    const toggles = Object.entries(setup.toggles);
    w.varint(toggles.length);
    for (const [skill, on] of toggles) {
      w.string(skill);
      w.u8(on ? 1 : 0);
    }
  }
  w.u8(ARMOR_KINDS.reduce((bits, kind, i) => bits | (isTranscendedId(build.armor[kind] ?? '') ? 1 << i : 0), 0));
  return toBase64Url(w.bytes());
}

export function decodeShareCode(code: string): LoadoutContent {
  let r: Reader;
  try {
    r = new Reader(fromBase64Url(code.trim()));
  } catch {
    throw new ShareCodeError('This share link is not valid.');
  }
  try {
    const version = r.u8();
    if (version > SHARE_CODE_VERSION) throw new ShareCodeError('This link was made by a newer version of the app.');
    if (version < 1) throw new ShareCodeError('This share link is not valid.');

    const weaponKind = pick(WEAPON_KINDS, r.varint());
    const name = r.string();
    const build: SavedBuild = { weaponId: null, armor: {}, talismanId: null, decorations: {} };
    let artian: ArtianConfig | null = null;

    const tag = r.u8();
    if (tag === 1) {
      const kind = pick(WEAPON_KINDS, r.varint());
      build.weaponId = `${kind}:${r.zz()}`;
    } else if (tag === 2) {
      artian = readArtian(r);
      build.weaponId = artian.id;
    } else if (tag !== 0) {
      throw new ShareCodeError('This share link is not valid.');
    }

    for (const kind of ARMOR_KINDS) {
      const id = r.opt();
      if (id !== null) build.armor[kind] = `${unzigzag(id)}:${kind}`;
    }

    let talisman: CustomTalismanConfig | null = null;
    if (version < 3) {
      const id = r.opt();
      if (id !== null) build.talismanId = `${unzigzag(id)}:${r.varint()}`;
    } else {
      const tag = r.u8();
      if (tag === 1) {
        const gameId = r.zz();
        build.talismanId = `${gameId}:${r.varint()}`;
      } else if (tag === 2) {
        talisman = readTalisman(r);
        build.talismanId = talisman.id;
      } else if (tag !== 0) {
        throw new ShareCodeError('This share link is not valid.');
      }
    }

    for (const slot of EQUIP_SLOTS) {
      const count = r.varint();
      if (count > 10) throw new ShareCodeError('This share link is not valid.');
      if (count) build.decorations[slot] = Array.from({ length: count }, () => {
        const id = r.opt();
        return id === null ? null : unzigzag(id);
      });
    }

    let setup: DamageSetup | null = null;
    if (r.u8() === 1) {
      const monster = r.opt();
      const part = r.opt();
      const wounded = r.u8() === 1;
      const toggles: Record<string, boolean> = {};
      const n = r.varint();
      for (let i = 0; i < n; i++) toggles[r.string()] = r.u8() === 1;
      setup = {
        monsterId: monster === null ? '' : String(unzigzag(monster)),
        partIndex: part === null ? '' : String(part),
        wounded,
        toggles,
      };
    }
    if (version >= 2) {
      const bits = r.u8();
      ARMOR_KINDS.forEach((kind, i) => {
        const id = build.armor[kind];
        if (id && bits & (1 << i)) build.armor[kind] = transcendedId(id);
      });
    }
    if (!r.done()) throw new ShareCodeError('This share link is not valid.');
    return { name, weaponKind, build, artian, talisman, setup };
  } catch (e) {
    if (e instanceof ShareCodeError) throw e;
    throw new ShareCodeError('This share link is not valid or was cut off.');
  }
}

function writeArtian(w: Writer, a: ArtianConfig): void {
  w.varint(indexOf(WEAPON_KINDS, a.kind));
  w.u8(a.tier === 'gogma' ? 1 : 0);
  w.u8(a.rarity);
  w.opt(a.element ? indexOf(ARTIAN_ELEMENTS, a.element) : null);
  w.u8(a.matchingParts);
  w.u8(a.partBonuses.reduce((bits, b, i) => bits | (b === 'affinity' ? 1 << i : 0), 0));
  w.u8(indexOf(GOGMA_DEVICES, a.device));
  w.varint(a.reinforcements.length);
  for (const x of a.reinforcements) w.u8(indexOf(REINFORCEMENT_TYPES, x.type) * 4 + indexOf(REINFORCEMENT_LEVELS, x.level));
  w.opt(a.setSkillId === null ? null : zigzag(a.setSkillId));
  w.opt(a.groupSkillId === null ? null : zigzag(a.groupSkillId));
  w.string(a.name);
}

function readArtian(r: Reader): ArtianConfig {
  const kind = pick(WEAPON_KINDS, r.varint());
  const tier = r.u8() === 1 ? 'gogma' : 'artian';
  const rarity = r.u8();
  if (rarity < 6 || rarity > 8) throw new ShareCodeError('This share link is not valid.');
  const element = r.opt();
  const matching = r.u8();
  const bits = r.u8();
  const device = pick(GOGMA_DEVICES, r.u8());
  const n = r.varint();
  if (n > 5) throw new ShareCodeError('This share link is not valid.');
  const reinforcements = Array.from({ length: n }, () => {
    const v = r.u8();
    return { type: pick(REINFORCEMENT_TYPES, v >> 2), level: pick(REINFORCEMENT_LEVELS, v & 3) };
  });
  const set = r.opt();
  const group = r.opt();
  return {
    id: SHARED_ARTIAN_ID,
    name: r.string(),
    kind,
    tier,
    rarity: rarity as ArtianConfig['rarity'],
    element: element === null ? null : pick(ARTIAN_ELEMENTS, element),
    matchingParts: matching === 2 ? 2 : 3,
    partBonuses: [0, 1, 2].map((i): PartBonus => (bits & (1 << i) ? 'affinity' : 'attack')),
    device,
    reinforcements,
    setSkillId: set === null ? null : unzigzag(set),
    groupSkillId: group === null ? null : unzigzag(group),
  };
}

function writeTalisman(w: Writer, t: CustomTalismanConfig): void {
  w.u8(t.rarity);
  w.varint(t.skills.length);
  for (const s of t.skills) {
    w.zz(s.skillId);
    w.u8(s.level);
  }
  w.varint(t.slots.length);
  for (const s of t.slots) w.u8(s.level * 2 + (s.accepts === 'weapon' ? 1 : 0));
  w.string(t.name);
}

function readTalisman(r: Reader): CustomTalismanConfig {
  const rarity = r.u8();
  const n = r.varint();
  if (n > 5) throw new ShareCodeError('This share link is not valid.');
  const skills = Array.from({ length: n }, () => {
    const skillId = r.zz();
    return { skillId, level: r.u8() };
  });
  const m = r.varint();
  if (m > 5) throw new ShareCodeError('This share link is not valid.');
  const slots = Array.from({ length: m }, () => {
    const v = r.u8();
    return { level: v >> 1, accepts: v & 1 ? ('weapon' as const) : ('armor' as const) };
  });
  return { id: SHARED_TALISMAN_ID, name: r.string(), rarity, skills, slots };
}

// ---------------------------------------------------------------- helpers

/** "a:b:c" -> ["a:b", "c"]; game ids can be negative, so split on the last colon. */
function splitLast(id: string): [string, string] {
  const i = id.lastIndexOf(':');
  return [id.slice(0, i), id.slice(i + 1)];
}

function indexOf<T>(list: readonly T[], value: T): number {
  const i = list.indexOf(value);
  if (i === -1) throw new ShareCodeError(`Cannot share unknown value "${String(value)}".`);
  return i;
}

function pick<T>(list: readonly T[], i: number): T {
  if (i < 0 || i >= list.length) throw new ShareCodeError('This share link is not valid.');
  return list[i];
}

const zigzag = (n: number): number => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzigzag = (n: number): number => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

class Writer {
  private readonly out: number[] = [];
  u8(n: number): void {
    this.out.push(n & 0xff);
  }
  varint(n: number): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new ShareCodeError(`Cannot encode ${n}.`);
    while (n >= 0x80) {
      this.out.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    this.out.push(n);
  }
  zz(n: number): void {
    this.varint(zigzag(n));
  }
  opt(n: number | null): void {
    this.varint(n === null ? 0 : n + 1);
  }
  string(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.varint(bytes.length);
    this.out.push(...bytes);
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

class Reader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}
  u8(): number {
    if (this.pos >= this.buf.length) throw new RangeError('end of data');
    return this.buf[this.pos++];
  }
  varint(): number {
    let n = 0;
    let scale = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8();
      n += (b & 0x7f) * scale;
      if (b < 0x80) return n;
      scale *= 0x80;
    }
    throw new RangeError('varint too long');
  }
  zz(): number {
    return unzigzag(this.varint());
  }
  opt(): number | null {
    const v = this.varint();
    return v === 0 ? null : v - 1;
  }
  string(): string {
    const len = this.varint();
    if (this.pos + len > this.buf.length) throw new RangeError('end of data');
    const s = new TextDecoder('utf-8', { fatal: true }).decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  done(): boolean {
    return this.pos === this.buf.length;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('bad characters');
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
