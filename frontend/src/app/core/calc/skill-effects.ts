import { ElementKind, WeaponKind } from '../models/game-data';

/** Per-level stat changes. Element values are in true units (in-game display ÷ 10). */
export interface EffectValues {
  attackFlat?: number;
  /** Percent of the weapon's base attack. */
  attackPct?: number;
  affinity?: number;
  /** Critical hit damage multiplier, replacing the base 1.25. */
  critMultiplier?: number;
  /** Element multiplier on critical hits, replacing the base 1.0. */
  critElement?: number;
  elementFlat?: number;
  elementPct?: number;
  /** Multiplies final raw damage (Bludgeoner). */
  rawDamagePct?: number;
}

/**
 * - `always`: applies whenever the skill is active.
 * - `toggle`: depends on hunt state (enraged, full health, ...); the user decides.
 * - `weak-point`: applies when the target hitzone is a weak point.
 * - `low-sharpness`: applies at or below the given sharpness color index.
 */
export type EffectCondition =
  | { kind: 'always' }
  /** `excludes`: condition keys that can't hold at the same time (checked both ways). */
  | { kind: 'toggle'; label: string; defaultOn: boolean; excludes?: readonly string[] }
  | { kind: 'weak-point' }
  | { kind: 'low-sharpness'; maxColorIndex: readonly number[] };

/** Another on/off part of the same skill, toggled on its own (keyed by `key`). */
export interface ExtraToggle {
  key: string;
  label: string;
  defaultOn: boolean;
  /** Index = skill level - 1. */
  levels: readonly EffectValues[];
}

export interface SkillEffect {
  condition: EffectCondition;
  /** Index = skill level - 1. */
  levels: readonly EffectValues[];
  /** Only applies to weapons with this element. */
  element?: ElementKind;
  /** Only applies to these weapon types. */
  weapons?: readonly WeaponKind[];
  /** Extra values when the target is wounded (Weakness Exploit). */
  wound?: readonly EffectValues[];
  extra?: readonly ExtraToggle[];
  /** Only does something when you can get Frenzy (see FRENZY_SETS, FRENZY_MONSTERS). */
  needsFrenzy?: boolean;
  /** false when the numbers are not in the game's skill text and were assumed. */
  verified: boolean;
}

const always = { kind: 'always' } as const;
const toggle = (label: string, defaultOn = true, excludes?: readonly string[]) => ({ kind: 'toggle', label, defaultOn, excludes }) as const;
const atk = (...v: number[]) => v.map((attackFlat) => ({ attackFlat }));
const aff = (...v: number[]) => v.map((affinity) => ({ affinity }));
const pct = (...v: number[]) => v.map((attackPct) => ({ attackPct }));

/** Weapons that can perfect guard. */
const GUARD_WEAPONS: readonly WeaponKind[] = ['great-sword', 'sword-shield', 'lance', 'gunlance', 'charge-blade'];

const elementAttack = (element: ElementKind): SkillEffect => ({
  condition: always,
  element,
  // Skill text: +40 / +10% +50 / +20% +60 (display units).
  levels: [{ elementFlat: 4 }, { elementPct: 10, elementFlat: 5 }, { elementPct: 20, elementFlat: 6 }],
  verified: true,
});

/**
 * Damage-relevant skills keyed by English skill name. Numbers come from the
 * skill rank descriptions in Skill.json unless `verified` is false.
 * Skills not listed here are reported as "not modeled".
 */
export const SKILL_EFFECTS: Readonly<Record<string, SkillEffect>> = {
  'Attack Boost': {
    condition: always,
    levels: [{ attackFlat: 3 }, { attackFlat: 5 }, { attackFlat: 7 }, { attackPct: 2, attackFlat: 8 }, { attackPct: 4, attackFlat: 9 }],
    verified: true,
  },
  'Critical Eye': { condition: always, levels: aff(4, 8, 12, 16, 20), verified: true },
  'Critical Boost': {
    condition: always,
    levels: [1.28, 1.31, 1.34, 1.37, 1.4].map((critMultiplier) => ({ critMultiplier })),
    verified: true,
  },
  'Critical Element': {
    condition: always,
    // Skill text only says "slightly / greatly increases".
    levels: [1.05, 1.1, 1.15].map((critElement) => ({ critElement })),
    verified: false,
  },
  'Weakness Exploit': {
    condition: { kind: 'weak-point' },
    levels: aff(5, 10, 15, 20, 30),
    wound: aff(3, 5, 10, 15, 20),
    verified: true,
  },
  'Fire Attack': elementAttack('fire'),
  'Water Attack': elementAttack('water'),
  'Thunder Attack': elementAttack('thunder'),
  'Ice Attack': elementAttack('ice'),
  'Dragon Attack': elementAttack('dragon'),
  Agitator: {
    condition: toggle('Monster enraged'),
    levels: [
      { attackFlat: 4, affinity: 3 },
      { attackFlat: 8, affinity: 5 },
      { attackFlat: 12, affinity: 7 },
      { attackFlat: 16, affinity: 10 },
      { attackFlat: 20, affinity: 15 },
    ],
    verified: true,
  },
  'Maximum Might': { condition: toggle('Stamina full'), levels: aff(10, 20, 30), verified: true },
  'Latent Power': { condition: toggle('Latent Power active', false), levels: aff(10, 20, 30, 40, 50), verified: true },
  'Peak Performance': { condition: toggle('Health full', true, ['Resentment', 'Heroics']), levels: atk(3, 6, 10, 15, 20), verified: true },
  Resentment: { condition: toggle('Red health'), levels: atk(5, 10, 15, 20, 25), verified: true },
  Counterstrike: { condition: toggle('After knockback', false), levels: atk(10, 15, 25), verified: true },
  'Adrenaline Rush': { condition: toggle('After perfect evade', false), levels: atk(10, 15, 20, 25, 30), verified: true },
  Foray: {
    condition: toggle('Monster poisoned/paralyzed', false),
    levels: [
      { attackFlat: 6 },
      { attackFlat: 8, affinity: 5 },
      { attackFlat: 10, affinity: 10 },
      { attackFlat: 12, affinity: 15 },
      { attackFlat: 15, affinity: 20 },
    ],
    verified: true,
  },
  Heroics: { condition: toggle('Health ≤ 35%', false), levels: pct(0, 5, 5, 10, 30), verified: true },
  'Offensive Guard': { condition: toggle('After perfect guard', false), levels: pct(5, 10, 15), weapons: GUARD_WEAPONS, verified: true },
  Ambush: { condition: toggle('After sneak attack', false), levels: pct(5, 10, 15), verified: true },
  Antivirus: { condition: toggle('Frenzy cured'), levels: aff(3, 6, 10), needsFrenzy: true, verified: true },
  'Slicked Blade': { condition: toggle('Wet', false), levels: aff(3, 6, 9), verified: true },
  'Critical Draw': { condition: toggle('Draw attacks', false), levels: aff(50, 75, 100), verified: true },
  'Punishing Draw': { condition: toggle('Draw attacks', false), levels: atk(3, 5, 7), verified: true },
  Bludgeoner: {
    // Yellow or lower for levels 1-2, green or lower for level 3.
    condition: { kind: 'low-sharpness', maxColorIndex: [2, 2, 3] },
    levels: [5, 10, 10].map((rawDamagePct) => ({ rawDamagePct })),
    verified: true,
  },
};

const festival: SkillEffect = { condition: toggle('During the festival', false), levels: [{}, { attackPct: 9 }], verified: false };

/**
 * Set and group bonuses, toggled in the Damage panel. Level = set bonus rank (2 / 4 pieces).
 * Only Doshaguma, Xu Wu and Ebony Odogaron state numbers in the game text; the rest come from
 * https://lescarnetsdelawycademie.fr/set-skills-wilds/, and Gore Magala and Gogmapocalypse also from
 * Game8 (archives 502179, 571422). Not modeled: extra-damage procs (Rathalos, Nu Udra, Leviathan's
 * thunder) and Dark Arts (element % differs by weapon).
 */
export const SET_EFFECTS: Readonly<Record<string, SkillEffect>> = {
  "Gore Magala's Tyranny": {
    condition: toggle('Infected with Frenzy (or overcome)'),
    levels: [{}, { attackFlat: 10 }],
    extra: [{ key: "Gore Magala's Tyranny: overcome", label: 'Frenzy overcome', defaultOn: false, levels: [{}, { attackFlat: 5 }] }],
    verified: false,
  },
  Gogmapocalypse: {
    condition: toggle('Monster enraged'),
    // Game8: element x1.2 + 20 / x1.3 + 40 (display units).
    levels: [{ elementPct: 20, elementFlat: 2 }, { elementPct: 30, elementFlat: 4 }],
    verified: false,
  },
  "Doshaguma's Might": { condition: toggle('After a Power Clash or Offset', false), levels: atk(10, 25), verified: true },
  "Xu Wu's Vigor": { condition: toggle('After eating meat', false), levels: atk(15, 30), verified: true },
  "Ebony Odogaron's Power": { condition: toggle('Burst active', false), levels: atk(8, 18), verified: true },
  "Jin Dahaad's Revolt": { condition: toggle('After escaping a bind or Power Clash', false), levels: atk(25, 50), verified: false },
  "Leviathan's Fury": { condition: toggle('After thunder buildup', false), levels: aff(15, 15), verified: false },
  "Seregios's Tenacity": { condition: toggle('Adrenaline Rush re-triggered', false), levels: [{}, { attackPct: 4 }], verified: false },
  'Omega Resonance': {
    condition: toggle('Remote Resonance', false),
    levels: atk(10, 20),
    extra: [{ key: 'Omega Resonance: local', label: 'Local Resonance', defaultOn: false, levels: aff(20, 40) }],
    verified: false,
  },
  "Blangonga's Spirit": { condition: toggle('After the To Victory! gesture', false), levels: atk(3, 6), verified: false },
  'Blossomdance Prayer': festival,
  'Flamefete Prayer': festival,
  'Dreamspell Prayer': festival,
  'Lumenhymn Prayer': festival,
  "Lord's Soul": { condition: toggle('Before surviving a lethal hit'), levels: pct(5), verified: false },
  "Lord's Fury": { condition: toggle('Afflicted by an ailment', false), levels: atk(10), verified: false },
  "Lord's Favor": { condition: toggle('After affecting allies (e.g. Melody Effects)', false), levels: atk(10), verified: false },
  'Fortifying Pelt': { condition: toggle('After fainting', false), levels: atk(10), verified: false },
  'Buttery Leathercraft': { condition: toggle('After sliding', false), levels: aff(30), verified: false },
};

/** Set bonuses that infect you with Frenzy (from rank 1). */
export const FRENZY_SETS: readonly string[] = ["Gore Magala's Tyranny"];
/** Monsters whose attacks inflict Frenzy. */
export const FRENZY_MONSTERS: ReadonlySet<string> = new Set(['Gore Magala']);

/** Skills with effects handled elsewhere in the calculator. */
export const SPECIAL_SKILLS = new Set(['Handicraft']);
