// Shapes of the JSON files in src/assets/data, produced by scripts/import-data.mjs.
// All display strings are English. See docs/DATA.md for source-field mapping.

export type SkillId = number;

export interface SkillLevel {
  skillId: SkillId;
  level: number;
}

// ---------------------------------------------------------------- skills

/**
 * - `armor`: from armor, decorations for armor slots, and talismans.
 * - `weapon`: from weapons and decorations for weapon slots.
 * - `set`: armor set bonus; each piece contributes 1 point, ranks unlock at piece counts.
 * - `group`: armor group bonus; same mechanics as `set`, shared across several sets.
 */
export type SkillKind = 'armor' | 'weapon' | 'set' | 'group';

export interface SkillRank {
  level: number;
  description: string;
  /** Only on set/group skills, e.g. "Black Eclipse I". */
  name?: string;
  /** Only on set/group skills: pieces needed to unlock this rank. */
  piecesRequired?: number;
}

export interface Skill {
  id: SkillId;
  name: string;
  description: string;
  kind: SkillKind;
  icon: string;
  maxLevel: number;
  ranks: SkillRank[];
}

// ---------------------------------------------------------------- armor

export const ARMOR_KINDS = ['head', 'chest', 'arms', 'waist', 'legs'] as const;
export type ArmorKind = (typeof ARMOR_KINDS)[number];

export type ElementKind = 'fire' | 'water' | 'thunder' | 'ice' | 'dragon';
export type Resistances = Record<ElementKind, number>;

export interface ArmorPiece {
  /** `${setId}:${kind}` — pieces have no game id of their own. */
  id: string;
  setId: number;
  kind: ArmorKind;
  name: string;
  rarity: number;
  defense: { base: number; max: number };
  resistances: Resistances;
  /** Decoration slot levels (1-3). */
  slots: number[];
  skills: SkillLevel[];
  /** Hotlinked image URL (scripts/extract-thumbnails.mjs); absent when no source has one. */
  thumbnail?: string;
  /** Set on the transcended version made by core/armor/transcend.ts; never in the data. */
  transcended?: true;
}

export interface ArmorSet {
  id: number;
  name: string;
  rarity: number;
  setBonusSkillId: SkillId | null;
  groupBonusSkillId: SkillId | null;
  pieces: ArmorPiece[];
}

// ---------------------------------------------------------------- decorations / talismans

export type SlotTarget = 'weapon' | 'armor';

export interface Decoration {
  id: number;
  name: string;
  rarity: number;
  /** Minimum slot level this decoration fits in. */
  slotLevel: number;
  allowedOn: SlotTarget;
  skills: SkillLevel[];
  /** The decoration's in-game icon (scripts/extract-thumbnails.mjs). */
  thumbnail?: string;
}

export interface TalismanSlot {
  level: number;
  accepts: SlotTarget;
}

export interface Talisman {
  /** `${gameId}:${rank}` for craftable talismans; `custom:*` for user-entered ones. */
  id: string;
  name: string;
  rarity: number;
  /** Craftable talismans have no slots; random/custom ones may. */
  slots: TalismanSlot[];
  skills: SkillLevel[];
  /** Charm icon in the rarity's colour (scripts/extract-thumbnails.mjs). */
  thumbnail?: string;
}

// ---------------------------------------------------------------- weapons

export const WEAPON_KINDS = [
  'great-sword',
  'long-sword',
  'sword-shield',
  'dual-blades',
  'hammer',
  'hunting-horn',
  'lance',
  'gunlance',
  'switch-axe',
  'charge-blade',
  'insect-glaive',
  'bow',
  'heavy-bowgun',
  'light-bowgun',
] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];

export const SHARPNESS_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'white', 'purple'] as const;
export type SharpnessColor = (typeof SHARPNESS_COLORS)[number];

export type StatusKind = 'poison' | 'paralysis' | 'sleep' | 'blastblight';

export type WeaponSpecial =
  | { kind: 'element'; element: ElementKind; value: number; hidden: boolean }
  | { kind: 'status'; status: StatusKind; value: number; hidden: boolean };

export interface Ammo {
  kind: string;
  level: number;
  capacity: number;
  rapid: boolean;
}

interface WeaponBase {
  /** `${kind}:${gameId}` — game ids are only unique within a weapon kind. */
  id: string;
  gameId: number;
  name: string;
  rarity: number;
  /**
   * True raw attack. The game displays this multiplied by a weapon-class factor
   * (e.g. Great Sword 190 shows as 912); damage formulas use the true value.
   */
  attack: number;
  /** Percent, may be negative. */
  affinity: number;
  defense: number;
  slots: number[];
  specials: WeaponSpecial[];
  /**
   * Base sharpness in hits per color, indexed like SHARPNESS_COLORS.
   * null for ranged weapons.
   */
  sharpness: number[] | null;
  /**
   * Extra sharpness from Handicraft level 5, distributed over consecutive colors
   * starting at the base bar's top color. Always sums to 50 (10 per level).
   * Interpretation inferred from the data; verify in game.
   */
  handicraft: number[] | null;
  skills: SkillLevel[];
  series: string | null;
  previousId: string | null;
  artian: ArtianInfo | null;
  /** Hotlinked image URL (scripts/extract-thumbnails.mjs); absent when no source has one. */
  thumbnail?: string;
}

export const GOGMA_DEVICES = ['attack', 'affinity', 'element'] as const;
export type GogmaDevice = (typeof GOGMA_DEVICES)[number];

/**
 * Artian weapons (Artian I/II and the R8 named one) and Gogma Artians. The data
 * lists each Gogma Artian three times, once per production device; `groupId`
 * ties the three together. Artian element and reinforcements are not in the data.
 */
export type ArtianInfo = { tier: 'artian' } | { tier: 'gogma'; device: GogmaDevice; groupId: string };

export type Weapon =
  | (WeaponBase & {
      kind: Exclude<
        WeaponKind,
        'gunlance' | 'switch-axe' | 'charge-blade' | 'insect-glaive' | 'hunting-horn' | 'bow' | 'light-bowgun' | 'heavy-bowgun'
      >;
    })
  | (WeaponBase & { kind: 'gunlance'; shell: 'normal' | 'wide' | 'long'; shellLevel: number })
  | (WeaponBase & { kind: 'switch-axe'; phial: { kind: string; value?: number } })
  | (WeaponBase & { kind: 'charge-blade'; phial: 'impact' | 'element' })
  | (WeaponBase & { kind: 'insect-glaive'; kinsectLevel: number })
  | (WeaponBase & { kind: 'hunting-horn'; melodyId: number; echoWaveId: number; echoBubbleId: number })
  | (WeaponBase & { kind: 'bow'; coatings: string[] })
  | (WeaponBase & { kind: 'light-bowgun' | 'heavy-bowgun'; ammo: Ammo[]; specialAmmo: string | null });

export interface HuntingHornData {
  melodies: { id: number; notes: string[]; songIds: number[] }[];
  songs: { effectId: number; name: string; notes: string[] }[];
  echoBubbles: { id: number; kind: string; name: string }[];
  echoWaves: { id: number; kind: string; name: string }[];
}

// ---------------------------------------------------------------- monsters

export interface Hitzones {
  slash: number;
  blunt: number;
  /** Ranged (shot) hitzone. */
  pierce: number;
  fire: number;
  water: number;
  thunder: number;
  ice: number;
  dragon: number;
  stun: number;
}

export interface MonsterPart {
  part: string;
  name: string;
  /** Part break/sever HP; null for parts that cannot be broken (e.g. hide). */
  health: number | null;
  /** Fractions: 0.65 means a 65 hitzone. */
  hitzones: Hitzones;
}

export interface MonsterAffinity {
  kind: 'element' | 'status' | 'effect';
  element?: ElementKind;
  status?: string;
  effect?: string;
  /** Star rating 1-3 (weaknesses only). */
  level?: number;
  condition?: string;
}

export interface Monster {
  id: number;
  name: string;
  species: string;
  speciesName: string;
  /** Base HP before quest/rank multipliers (not in the dataset). */
  baseHealth: number;
  weaknesses: MonsterAffinity[];
  resistances: MonsterAffinity[];
  parts: MonsterPart[];
}

// ---------------------------------------------------------------- artian crafting
// From scripts/supplements/artian.json (researched; not in the game data).
// All element values here are true units.

export const ARTIAN_ELEMENTS = ['fire', 'water', 'thunder', 'ice', 'dragon', 'poison', 'paralysis', 'sleep', 'blast'] as const;
export type ArtianElement = (typeof ARTIAN_ELEMENTS)[number];

export const REINFORCEMENT_LEVELS = ['I', 'II', 'III', 'EX'] as const;
export type ReinforcementLevel = (typeof REINFORCEMENT_LEVELS)[number];
type LevelTable = Partial<Record<ReinforcementLevel, number>>;

export interface ArtianData {
  parts: { count: number; attackBonus: number; affinityBonus: number };
  /** null for weapon types whose parts change ammo instead of element (bowguns). */
  elements: Record<
    WeaponKind,
    {
      /** [rarity 6/7, rarity 8]; null when the element only changes coatings. */
      values: Record<ArtianElement, [number, number] | null>;
      /** Added when all three parts share the element. */
      infusionBonus: number;
    } | null
  >;
  reinforcement: {
    slots: number;
    maxSameEx: number;
    attack: LevelTable;
    affinity: LevelTable;
    sharpness: LevelTable;
    insectGlaiveSharpnessI: number;
    ammo: LevelTable;
    element: Record<WeaponKind, LevelTable | null>;
    artianLimits: Record<'attack' | 'affinity' | 'element' | 'sharpness' | 'ammo', number>;
  };
  gogmaDeviceElement: Record<WeaponKind, Record<GogmaDevice, number>>;
  sources: Record<string, string>;
}

// ---------------------------------------------------------------- moves
// From scripts/supplements/moves.json (Monster Hunter Wiki; see extract-wiki-moves.mjs).

export interface MoveVariant {
  /** Charge level or state, e.g. "LV 2", "Boosted"; absent for single-variant moves. */
  label?: string;
  /** Motion value of each hit. */
  hits: number[];
  elementModifier?: number;
  statusModifier?: number;
  /** Per-hit modifiers when hits differ (same length as `hits`). */
  elementModifiers?: number[];
  statusModifiers?: number[];
}

export interface Move {
  section: string;
  name: string;
  /** Hitzone used; defaults to the weapon type's. */
  damageType?: 'slash' | 'blunt';
  /** Applies to every variant unless the variant has its own. Default 1. */
  elementModifier?: number;
  statusModifier?: number;
  /** Source caveats, e.g. variable hit counts. */
  notes?: string[];
  variants: MoveVariant[];
}

export interface MoveData {
  /** Date the motion values were extracted. */
  extracted: string;
  /** Only weapon types with published motion values are present. */
  weapons: Partial<Record<WeaponKind, { source: string; moves: Move[] }>>;
}

// ---------------------------------------------------------------- bundle

export interface GameDataFiles {
  skills: Skill[];
  armor: ArmorSet[];
  decorations: Decoration[];
  talismans: Talisman[];
  weapons: Weapon[];
  huntingHorn: HuntingHornData;
  monsters: Monster[];
  artian: ArtianData;
  moves: MoveData;
}
