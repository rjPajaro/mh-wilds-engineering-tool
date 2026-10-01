import { ArmorKind, ARMOR_KINDS, ArmorPiece, Decoration, SkillLevel, Talisman, TalismanSlot, Weapon } from '../models/game-data';

export type EquipSlot = 'weapon' | ArmorKind | 'talisman';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', ...ARMOR_KINDS, 'talisman'];

/** A set of equipped gear. Decorations are index-aligned with the owning equipment's slots. */
export interface Build {
  weapon: Weapon | null;
  armor: Partial<Record<ArmorKind, ArmorPiece | null>>;
  talisman: Talisman | null;
  decorations: Partial<Record<EquipSlot, readonly (Decoration | null)[]>>;
}

export function emptyBuild(): Build {
  return { weapon: null, armor: {}, talisman: null, decorations: {} };
}

/**
 * A build by ids only: what gets saved. Resolving against current data means a
 * saved build follows data updates and edits to custom weapons.
 */
export interface SavedBuild {
  weaponId: string | null;
  armor: Partial<Record<ArmorKind, string | null>>;
  talismanId: string | null;
  decorations: Partial<Record<EquipSlot, (number | null)[]>>;
}

export function emptySavedBuild(): SavedBuild {
  return { weaponId: null, armor: {}, talismanId: null, decorations: {} };
}

export interface BuildLookup {
  weapon(id: string): Weapon | undefined;
  armor(id: string): ArmorPiece | undefined;
  talisman(id: string): Talisman | undefined;
  decoration(id: number): Decoration | undefined;
}

/** Turns saved ids into gear. Ids that no longer exist resolve to empty slots. */
export function resolveBuild(saved: SavedBuild, lookup: BuildLookup): Build {
  const armor: Build['armor'] = {};
  for (const kind of ARMOR_KINDS) {
    const id = saved.armor[kind];
    armor[kind] = id ? (lookup.armor(id) ?? null) : null;
  }
  const decorations: Build['decorations'] = {};
  for (const slot of EQUIP_SLOTS) {
    const ids = saved.decorations[slot];
    if (ids) decorations[slot] = ids.map((id) => (id === null ? null : (lookup.decoration(id) ?? null)));
  }
  return {
    weapon: saved.weaponId ? (lookup.weapon(saved.weaponId) ?? null) : null,
    armor,
    talisman: saved.talismanId ? (lookup.talisman(saved.talismanId) ?? null) : null,
    decorations,
  };
}

/** Shape check for data read back from storage. */
export function isSavedBuild(value: unknown): value is SavedBuild {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const idOrNull = (x: unknown) => x === null || typeof x === 'string';
  return (
    idOrNull(v['weaponId']) &&
    idOrNull(v['talismanId']) &&
    typeof v['armor'] === 'object' && v['armor'] !== null &&
    Object.values(v['armor']).every(idOrNull) &&
    typeof v['decorations'] === 'object' && v['decorations'] !== null &&
    Object.values(v['decorations']).every((list) => Array.isArray(list) && list.every((d) => d === null || typeof d === 'number'))
  );
}

export interface EquippedItem {
  name: string;
  skills: SkillLevel[];
}

export function equippedItem(build: Build, slot: EquipSlot): EquippedItem | null {
  if (slot === 'weapon') return build.weapon;
  if (slot === 'talisman') return build.talisman;
  return build.armor[slot] ?? null;
}

/** Decoration slots offered by the item in `slot`, with what each slot accepts. */
export function slotsOf(build: Build, slot: EquipSlot): TalismanSlot[] {
  if (slot === 'weapon') return (build.weapon?.slots ?? []).map((level) => ({ level, accepts: 'weapon' }));
  if (slot === 'talisman') return build.talisman?.slots ?? [];
  return (build.armor[slot]?.slots ?? []).map((level) => ({ level, accepts: 'armor' }));
}

export type BuildIssue =
  | { kind: 'no-slot'; slot: EquipSlot; index: number; decoration: Decoration }
  | { kind: 'slot-too-small'; slot: EquipSlot; index: number; decoration: Decoration; slotLevel: number }
  | { kind: 'wrong-slot-type'; slot: EquipSlot; index: number; decoration: Decoration };

/** Returns every decoration that cannot legally sit where it was placed. */
export function validateDecorations(build: Build): BuildIssue[] {
  const issues: BuildIssue[] = [];
  for (const slot of EQUIP_SLOTS) {
    const slots = slotsOf(build, slot);
    (build.decorations[slot] ?? []).forEach((decoration, index) => {
      if (!decoration) return;
      const target = slots[index];
      if (!target) issues.push({ kind: 'no-slot', slot, index, decoration });
      else if (decoration.allowedOn !== target.accepts) issues.push({ kind: 'wrong-slot-type', slot, index, decoration });
      else if (decoration.slotLevel > target.level) {
        issues.push({ kind: 'slot-too-small', slot, index, decoration, slotLevel: target.level });
      }
    });
  }
  return issues;
}

export interface SkillSource {
  /** Where the points come from, for display ("Gore Helm α", "Attack Jewel [3]"). */
  label: string;
  slot: EquipSlot;
  skills: readonly SkillLevel[];
}

/** Gear and legally placed decorations, as skill sources. Illegal decorations are skipped. */
export function collectSkillSources(build: Build): SkillSource[] {
  const illegal = new Set(validateDecorations(build).map((i) => `${i.slot}:${i.index}`));
  const sources: SkillSource[] = [];
  for (const slot of EQUIP_SLOTS) {
    const item = equippedItem(build, slot);
    if (item) sources.push({ label: item.name, slot, skills: item.skills });
    (build.decorations[slot] ?? []).forEach((decoration, index) => {
      if (decoration && !illegal.has(`${slot}:${index}`)) {
        sources.push({ label: decoration.name, slot, skills: decoration.skills });
      }
    });
  }
  return sources;
}
