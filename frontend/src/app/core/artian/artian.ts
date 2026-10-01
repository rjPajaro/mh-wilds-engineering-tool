import { GameIndex } from '../data/game-index';
import {
  ArtianData,
  ArtianElement,
  GogmaDevice,
  ReinforcementLevel,
  SkillId,
  SkillLevel,
  StatusKind,
  Weapon,
  WeaponKind,
  WeaponSpecial,
} from '../models/game-data';

export type PartBonus = 'attack' | 'affinity';
export const REINFORCEMENT_TYPES = ['attack', 'affinity', 'element', 'sharpness', 'ammo'] as const;
export type ReinforcementType = (typeof REINFORCEMENT_TYPES)[number];

export interface Reinforcement {
  type: ReinforcementType;
  level: ReinforcementLevel;
}

/** A user-built Artian or Gogma Artian weapon. */
export interface ArtianConfig {
  /** Always starts with `custom:`. */
  id: string;
  name: string;
  kind: WeaponKind;
  tier: 'artian' | 'gogma';
  /** Gogma Artians are always rarity 8. */
  rarity: 6 | 7 | 8;
  /** Element/status of the matching parts; null when all three parts differ. */
  element: ArtianElement | null;
  /** Parts sharing `element`: 2 gives the base value, 3 adds the infusion bonus. */
  matchingParts: 2 | 3;
  /** Artian bonus of each of the three parts. */
  partBonuses: readonly PartBonus[];
  /** Gogma only. */
  device: GogmaDevice;
  reinforcements: readonly Reinforcement[];
  /** Gogma only: the rolled set and group skills. */
  setSkillId: SkillId | null;
  groupSkillId: SkillId | null;
}

export interface ArtianIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface ArtianResult {
  /** null when the config has errors that prevent building a weapon. */
  weapon: Weapon | null;
  issues: ArtianIssue[];
}

export const CUSTOM_PREFIX = 'custom:';

export function isCustomWeapon(weapon: Pick<Weapon, 'id'> | null | undefined): boolean {
  return !!weapon?.id.startsWith(CUSTOM_PREFIX);
}

export function newArtianConfig(kind: WeaponKind, tier: 'artian' | 'gogma', id: string): ArtianConfig {
  return {
    id: `${CUSTOM_PREFIX}${id}`,
    name: '',
    kind,
    tier,
    rarity: 8,
    element: null,
    matchingParts: 3,
    partBonuses: ['attack', 'attack', 'attack'],
    device: 'attack',
    reinforcements: [],
    setSkillId: null,
    groupSkillId: null,
  };
}

const STATUS: Partial<Record<ArtianElement, StatusKind>> = {
  poison: 'poison',
  paralysis: 'paralysis',
  sleep: 'sleep',
  blast: 'blastblight',
};

/** The game-data weapon a config is built on: Artian of that rarity, or the Gogma device variant. */
export function artianBase(config: ArtianConfig, index: GameIndex): Weapon | undefined {
  const weapons = index.weaponsByKind.get(config.kind) ?? [];
  if (config.tier === 'artian') return weapons.find((w) => w.artian?.tier === 'artian' && w.rarity === config.rarity);
  return weapons.find((w) => w.artian?.tier === 'gogma' && w.artian.device === config.device);
}

/** Levels each reinforcement type can roll at, for this tier. */
export function allowedLevels(type: ReinforcementType, tier: 'artian' | 'gogma', data: ArtianData, kind: WeaponKind): ReinforcementLevel[] {
  if (tier === 'artian') return ['I'];
  const table = type === 'element' ? (data.reinforcement.element[kind] ?? {}) : data.reinforcement[type];
  return (Object.keys(table) as ReinforcementLevel[]).filter((l) => l in table);
}

/** Element/status value from the parts (true units), or null if the weapon has none. */
export function partsElementValue(config: ArtianConfig, data: ArtianData): number | null {
  const table = data.elements[config.kind];
  const pair = config.element && table ? table.values[config.element] : null;
  if (!pair || !table) return null;
  return pair[config.rarity === 8 ? 1 : 0] + (config.matchingParts === 3 ? table.infusionBonus : 0);
}

export function buildArtianWeapon(config: ArtianConfig, index: GameIndex): ArtianResult {
  const data = index.files.artian;
  const issues = validateArtian(config, index);
  const base = artianBase(config, index);
  if (!base || issues.some((i) => i.severity === 'error')) return { weapon: null, issues };

  const r = data.reinforcement;
  const count = (type: ReinforcementType) => config.reinforcements.filter((x) => x.type === type);
  const sum = (type: ReinforcementType, table: Partial<Record<ReinforcementLevel, number>>) =>
    count(type).reduce((total, x) => total + (table[x.level] ?? 0), 0);

  const attackParts = config.partBonuses.filter((b) => b === 'attack').length;
  const affinityParts = config.partBonuses.filter((b) => b === 'affinity').length;
  const attack = base.attack + attackParts * data.parts.attackBonus + sum('attack', r.attack);
  const affinity = base.affinity + affinityParts * data.parts.affinityBonus + sum('affinity', r.affinity);

  let specials: WeaponSpecial[] = [];
  const partsValue = partsElementValue(config, data);
  if (config.element && partsValue !== null) {
    const device = config.tier === 'gogma' ? data.gogmaDeviceElement[config.kind][config.device] : 0;
    const boosts = sum('element', r.element[config.kind] ?? {});
    const value = Math.max(0, round1(partsValue + device + boosts));
    const status = STATUS[config.element];
    specials = [
      status
        ? { kind: 'status', status, value, hidden: false }
        : { kind: 'element', element: config.element as Exclude<ArtianElement, keyof typeof STATUS>, value, hidden: false },
    ];
  }

  let sharpness = base.sharpness;
  if (sharpness) {
    // Sharpness boosts extend the bar's top color.
    const extra = count('sharpness').reduce(
      (total, x) => total + (x.level === 'I' && config.kind === 'insect-glaive' ? r.insectGlaiveSharpnessI : (r.sharpness[x.level] ?? 0)),
      0,
    );
    const top = sharpness.reduce((t, hits, i) => (hits > 0 ? i : t), 0);
    sharpness = sharpness.map((hits, i) => (i === top ? hits + extra : hits));
  }

  const skills: SkillLevel[] = [];
  if (config.tier === 'gogma') {
    for (const id of [config.setSkillId, config.groupSkillId]) if (id !== null) skills.push({ skillId: id, level: 1 });
  }

  const weapon = {
    ...base,
    id: config.id,
    name: config.name.trim() || base.name,
    attack,
    affinity,
    specials,
    sharpness,
    skills,
    previousId: null,
  } as Weapon;
  return { weapon, issues };
}

export function validateArtian(config: ArtianConfig, index: GameIndex): ArtianIssue[] {
  const data = index.files.artian;
  const issues: ArtianIssue[] = [];
  const error = (message: string) => issues.push({ severity: 'error', message });
  const base = artianBase(config, index);

  if (!base) error(`No ${config.tier === 'gogma' ? 'Gogma Artian' : `rarity ${config.rarity} Artian`} exists for this weapon type.`);
  if (config.tier === 'gogma' && config.rarity !== 8) error('Gogma Artians must be rarity 8.');
  if (config.partBonuses.length !== data.parts.count) error(`Pick a bonus for each of the ${data.parts.count} parts.`);
  if (config.reinforcements.length > data.reinforcement.slots) error(`At most ${data.reinforcement.slots} reinforcements.`);

  const hasElementValue = partsElementValue(config, data) !== null;
  if (config.element && !hasElementValue) {
    issues.push({
      severity: 'info',
      message: `${cap(config.element)} parts change ${config.kind === 'bow' ? 'coatings' : 'ammo'} on this weapon type; that is not modeled.`,
    });
  }

  for (const [i, x] of config.reinforcements.entries()) {
    const label = `Reinforcement ${i + 1} (${cap(x.type)} ${x.level})`;
    if (!allowedLevels(x.type, config.tier, data, config.kind).includes(x.level)) {
      error(`${label}: not a possible level for ${config.tier === 'gogma' ? 'Gogma Artians' : 'regular Artians'}.`);
    }
    if (x.type === 'element' && !hasElementValue) error(`${label}: needs an elemental or status weapon.`);
    if (x.type === 'sharpness' && base && !base.sharpness) error(`${label}: only melee weapons can roll sharpness.`);
    if (x.type === 'ammo' && config.kind !== 'light-bowgun' && config.kind !== 'heavy-bowgun') error(`${label}: only bowguns can roll ammo.`);
  }

  if (config.tier === 'gogma') {
    for (const type of new Set(config.reinforcements.filter((x) => x.level === 'EX').map((x) => x.type))) {
      const n = config.reinforcements.filter((x) => x.type === type && x.level === 'EX').length;
      if (n > data.reinforcement.maxSameEx) error(`At most ${data.reinforcement.maxSameEx} EX ${type} reinforcements.`);
    }
  } else {
    for (const [type, max] of Object.entries(data.reinforcement.artianLimits)) {
      const n = config.reinforcements.filter((x) => x.type === type).length;
      if (n > max) issues.push({ severity: 'warning', message: `${n} ${type} reinforcements; regular Artians have been seen with at most ${max}.` });
    }
  }
  return issues;
}

/** "Dragon Attack Infusion", "Water (2 parts) · 2 Atk / 1 Aff", "Non-elemental · 3 Atk". */
export function infusionLabel(config: Pick<ArtianConfig, 'element' | 'matchingParts' | 'partBonuses'>): string {
  const atk = config.partBonuses.filter((b) => b === 'attack').length;
  const aff = config.partBonuses.length - atk;
  const bonus = aff === 0 ? 'Attack' : atk === 0 ? 'Affinity' : `${atk} Atk / ${aff} Aff`;
  if (!config.element) return `Non-elemental · ${bonus}`;
  if (config.matchingParts === 3 && (atk === 0 || aff === 0)) return `${cap(config.element)} ${bonus} Infusion`;
  const parts = config.matchingParts === 3 ? 'Infusion' : '2 parts';
  return `${cap(config.element)} (${parts}) · ${bonus}`;
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
