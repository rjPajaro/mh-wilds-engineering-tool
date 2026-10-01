import { ArtianConfig } from '../artian/artian';
import { isSavedBuild, SavedBuild } from '../build/build';
import { WEAPON_KINDS, WeaponKind } from '../models/game-data';

/** Damage panel state: target and condition toggles. Ids are strings as stored by the UI. */
export interface DamageSetup {
  monsterId: string;
  partIndex: string;
  wounded: boolean;
  toggles: Record<string, boolean>;
}

/** Everything needed to recreate a build. Shared links and exports carry exactly this. */
export interface LoadoutContent {
  name: string;
  weaponKind: WeaponKind;
  build: SavedBuild;
  /**
   * The custom Artian the build's weapon refers to (build.weaponId === artian.id),
   * embedded so the loadout still works if the Artian is deleted, and so it can be
   * shared or exported on its own.
   */
  artian: ArtianConfig | null;
  setup: DamageSetup | null;
}

/** A named build saved in the browser. */
export interface Loadout extends LoadoutContent {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export function emptySetup(): DamageSetup {
  return { monsterId: '', partIndex: '', wounded: false, toggles: {} };
}

/**
 * True when two contents describe the same build and setup. Only content fields
 * count: the name and a Loadout's id/timestamps are ignored.
 */
export function sameContent(a: LoadoutContent, b: LoadoutContent): boolean {
  const pick = ({ weaponKind, build, artian, setup }: LoadoutContent) => ({ weaponKind, build, artian, setup });
  return canonical(pick(a)) === canonical(pick(b));
}

/** True when two Artian configs build the same weapon (the id is ignored). */
export function sameArtian(a: ArtianConfig, b: ArtianConfig): boolean {
  return canonical({ ...a, id: '' }) === canonical({ ...b, id: '' });
}

/** JSON with sorted keys and empty entries dropped, for order-insensitive comparison. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined && !(Array.isArray(x) && x.length === 0))
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  });
}

// ---------------------------------------------------------------- validation (storage / import)

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isDamageSetup(v: unknown): v is DamageSetup {
  return (
    isObject(v) &&
    typeof v['monsterId'] === 'string' &&
    typeof v['partIndex'] === 'string' &&
    typeof v['wounded'] === 'boolean' &&
    isObject(v['toggles']) &&
    Object.values(v['toggles']).every((x) => typeof x === 'boolean')
  );
}

export function isArtianConfig(v: unknown): v is ArtianConfig {
  return (
    isObject(v) &&
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    WEAPON_KINDS.includes(v['kind'] as WeaponKind) &&
    (v['tier'] === 'artian' || v['tier'] === 'gogma') &&
    Array.isArray(v['partBonuses']) &&
    Array.isArray(v['reinforcements'])
  );
}

export function isLoadoutContent(v: unknown): v is LoadoutContent {
  return (
    isObject(v) &&
    typeof v['name'] === 'string' &&
    WEAPON_KINDS.includes(v['weaponKind'] as WeaponKind) &&
    isSavedBuild(v['build']) &&
    (v['artian'] === null || isArtianConfig(v['artian'])) &&
    (v['setup'] === null || isDamageSetup(v['setup']))
  );
}

export function isLoadout(v: unknown): v is Loadout {
  return isLoadoutContent(v) && typeof (v as Loadout).id === 'string' && typeof (v as Loadout).createdAt === 'string';
}

// ---------------------------------------------------------------- export file

export const EXPORT_FORMAT = 'mhwilds-engineering-tool/loadouts';
export const EXPORT_VERSION = 1;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  loadouts: Loadout[];
  /** All saved Artians, so an export is a full backup of the Forge too. */
  artians: ArtianConfig[];
}

export function createExport(loadouts: readonly Loadout[], artians: readonly ArtianConfig[], now = new Date()): ExportFile {
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), loadouts: [...loadouts], artians: [...artians] };
}

export class ImportError extends Error {}

/** Parses and validates an export file. Invalid entries are skipped and counted. */
export function parseExport(text: string): { loadouts: Loadout[]; artians: ArtianConfig[]; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('The file is not valid JSON.');
  }
  if (!isObject(data) || data['format'] !== EXPORT_FORMAT) throw new ImportError('This is not a loadout export from this app.');
  if (typeof data['version'] !== 'number' || data['version'] > EXPORT_VERSION) {
    throw new ImportError('This export was made by a newer version of the app.');
  }
  const rawLoadouts = Array.isArray(data['loadouts']) ? data['loadouts'] : [];
  const rawArtians = Array.isArray(data['artians']) ? data['artians'] : [];
  const loadouts = rawLoadouts.filter(isLoadout);
  const artians = rawArtians.filter(isArtianConfig);
  return { loadouts, artians, skipped: rawLoadouts.length - loadouts.length + rawArtians.length - artians.length };
}
