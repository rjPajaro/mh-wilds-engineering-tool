import {
  ARMOR_KINDS,
  ArmorKind,
  ArmorPiece,
  ArmorSet,
  Decoration,
  GameDataFiles,
  GogmaDevice,
  Monster,
  Skill,
  SkillId,
  Talisman,
  Weapon,
  WeaponKind,
} from '../models/game-data';
import { transcend } from '../armor/transcend';

/** Lookup tables over the raw data files. Pure TS so the worker and tests can use it. */
export interface GameIndex {
  readonly files: GameDataFiles;
  readonly skills: ReadonlyMap<SkillId, Skill>;
  readonly armorSets: ReadonlyMap<number, ArmorSet>;
  /** Every piece by id, including transcended versions (`<id>:transcended`). */
  readonly armorPieces: ReadonlyMap<string, ArmorPiece>;
  readonly armorByKind: Readonly<Record<ArmorKind, readonly ArmorPiece[]>>;
  readonly decorations: ReadonlyMap<number, Decoration>;
  readonly talismans: ReadonlyMap<string, Talisman>;
  readonly weapons: ReadonlyMap<string, Weapon>;
  readonly weaponsByKind: ReadonlyMap<WeaponKind, readonly Weapon[]>;
  /** Gogma Artian variants by `artian.groupId`, one weapon per device. */
  readonly gogmaGroups: ReadonlyMap<string, Readonly<Record<GogmaDevice, Weapon>>>;
  readonly monsters: ReadonlyMap<number, Monster>;
}

export function buildGameIndex(files: GameDataFiles): GameIndex {
  const armorPieces = files.armor.flatMap((set) => set.pieces);
  const armorByKind = Object.fromEntries(
    ARMOR_KINDS.map((kind) => [kind, armorPieces.filter((p) => p.kind === kind)]),
  ) as Record<ArmorKind, ArmorPiece[]>;

  const weaponsByKind = new Map<WeaponKind, Weapon[]>();
  const gogmaGroups = new Map<string, Partial<Record<GogmaDevice, Weapon>>>();
  for (const weapon of files.weapons) {
    const list = weaponsByKind.get(weapon.kind) ?? [];
    list.push(weapon);
    weaponsByKind.set(weapon.kind, list);
    if (weapon.artian?.tier === 'gogma') {
      const group = gogmaGroups.get(weapon.artian.groupId) ?? {};
      group[weapon.artian.device] = weapon;
      gogmaGroups.set(weapon.artian.groupId, group);
    }
  }

  return {
    files,
    skills: byId(files.skills),
    armorSets: byId(files.armor),
    armorPieces: byId([...armorPieces, ...armorPieces.map(transcend).filter((p) => p !== null)]),
    armorByKind,
    decorations: byId(files.decorations),
    talismans: byId(files.talismans),
    weapons: byId(files.weapons),
    weaponsByKind,
    // The importer guarantees every group has all three devices.
    gogmaGroups: gogmaGroups as Map<string, Record<GogmaDevice, Weapon>>,
    monsters: byId(files.monsters),
  };
}

function byId<K, T extends { id: K }>(items: readonly T[]): Map<K, T> {
  return new Map(items.map((item) => [item.id, item]));
}
