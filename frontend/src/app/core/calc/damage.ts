import { ElementKind, Hitzones, StatusKind, Weapon, WeaponKind } from '../models/game-data';
import { ActiveSkill } from '../skills/skill-resolver';
import { sharpnessState, SharpnessState } from './sharpness';
import { EffectValues, FRENZY_SETS, SET_EFFECTS, SKILL_EFFECTS, SkillEffect, SPECIAL_SKILLS } from './skill-effects';

/** Not in the dataset; standard series values. */
export const BASE_CRIT_MULTIPLIER = 1.25;
export const NEGATIVE_CRIT_MULTIPLIER = 0.75;
/** Raw hitzone at or above which Weakness Exploit applies. Assumed (series convention). */
export const WEAK_POINT_HITZONE = 0.45;

export type HitzoneKind = 'slash' | 'blunt' | 'pierce';

/**
 * Most element a weapon reaches with skills, in true units: the larger of base + 400 and base x 2.3
 * (display units), all weapon types, since Title Update 4. Game8 (archives 500260) and Switchblade Gaming.
 */
export function elementCap(baseElement: number): number {
  return Math.max(baseElement + 40, baseElement * 2.3);
}

export interface DamageTarget {
  hitzones: Hitzones;
  wounded: boolean;
}

/** An item, meal or food skill bonus; with `toggle` it is a Damage panel condition keyed by `label`. */
export interface BuffEffect {
  label: string;
  values: EffectValues;
  toggle?: { label: string; defaultOn: boolean };
}

export interface DamageInput {
  weapon: Weapon;
  skills: readonly ActiveSkill[];
  /** On/off per condition key (skill name, or an extra toggle's key); missing entries use the default. */
  toggles?: Readonly<Record<string, boolean>>;
  target?: DamageTarget | null;
  /** Hitzone type to use instead of the weapon type's (e.g. a blunt move on a slash weapon). */
  hitzoneKind?: HitzoneKind;
  /** The target monster inflicts Frenzy (see FRENZY_MONSTERS). */
  targetInflictsFrenzy?: boolean;
  /** Bonuses from items and meals (see buffs.ts). */
  buffs?: readonly BuffEffect[];
}

export interface Contribution {
  label: string;
  value: number;
}

export interface Stats {
  attack: number;
  attackParts: Contribution[];
  /** Clamped to [-100, 100]. */
  affinity: number;
  affinityParts: Contribution[];
  critMultiplier: number;
  critElement: number;
  /** Element in true units after skills, at most `elementCap`; null for raw/status weapons. */
  element: number | null;
  elementParts: Contribution[];
  /** Highest element skills can reach (see elementCap); null for raw/status weapons. */
  elementCap: number | null;
  /** Skills would push element past the cap, so it was cut to the cap. */
  elementCapped: boolean;
  rawDamagePct: number;
  /** Expected crit factors folded into efr / efe (1 = no crit effect). */
  rawCrit: number;
  elementCrit: number;
  /** Expected raw per 100 MV against hitzone 100 (effective raw). */
  efr: number;
  /** Expected element against element hitzone 100. */
  efe: number;
}

export interface PerHit {
  hitzoneKind: HitzoneKind;
  rawHitzone: number;
  elementHitzone: number;
  weakPoint: boolean;
  /** Expected damage per 100 motion value. */
  raw: number;
  element: number;
  total: number;
}

export interface ConditionState {
  /** Key in `toggles`. */
  key: string;
  skill: string;
  label: string;
  on: boolean;
  /** Keys of other listed conditions that can't be on together with this one. */
  excludes: string[];
}

export interface DamageResult {
  sharpness: SharpnessState | null;
  elementKind: ElementKind | null;
  status: { kind: StatusKind; value: number } | null;
  /** Stats without a target: hitzone-dependent skills (Weakness Exploit) count as on a weak point, if their condition is on. */
  base: Stats;
  /** Stats and damage against the target, if one is set. */
  vsTarget: (Stats & { hit: PerHit }) | null;
  conditions: ConditionState[];
  /** Applied skills whose numbers were assumed rather than taken from game text. */
  assumed: string[];
  /** Active skills that may affect damage but are not modeled. */
  notModeled: string[];
  /** Active skills that can't trigger with this build and target, e.g. Antivirus without Frenzy. */
  noEffect: { skill: string; reason: string }[];
}

const BLUNT: readonly WeaponKind[] = ['hammer', 'hunting-horn'];
const RANGED: readonly WeaponKind[] = ['bow', 'light-bowgun', 'heavy-bowgun'];
const DAMAGE_ICONS = new Set(['attack', 'offense', 'affinity', 'element']);

const atLevel = (list: readonly EffectValues[], level: number) => list[Math.min(level, list.length) - 1];
const hasValues = (v: EffectValues) => Object.keys(v).length > 0;

export function hitzoneKind(kind: WeaponKind): HitzoneKind {
  if (BLUNT.includes(kind)) return 'blunt';
  if (RANGED.includes(kind)) return 'pierce';
  return 'slash';
}

export function calculateDamage(input: DamageInput): DamageResult {
  const { weapon, skills } = input;
  const toggles = input.toggles ?? {};
  const level = (name: string) => skills.find((s) => s.skill.name === name)?.level ?? 0;

  const sharpness = weapon.sharpness ? sharpnessState(weapon.sharpness, weapon.handicraft, level('Handicraft')) : null;
  const elementSpecial = weapon.specials.find((s) => s.kind === 'element');
  const statusSpecial = weapon.specials.find((s) => s.kind === 'status');
  const elementKind = elementSpecial?.kind === 'element' ? elementSpecial.element : null;

  const conditions: ConditionState[] = [];
  const assumed: string[] = [];
  const notModeled: string[] = [];
  const noEffect: DamageResult['noEffect'] = [];
  const frenzy = !!input.targetInflictsFrenzy || FRENZY_SETS.some((name) => level(name) > 0);
  const modeled: { name: string; level: number; effect: SkillEffect }[] = [];

  for (const active of skills) {
    if (active.level <= 0) continue;
    const name = active.skill.name;
    const effect = SKILL_EFFECTS[name] ?? SET_EFFECTS[name];
    if (!effect) {
      const relevant = DAMAGE_ICONS.has(active.skill.icon) || active.skill.kind === 'set' || active.skill.kind === 'group';
      if (relevant && !SPECIAL_SKILLS.has(name)) notModeled.push(name);
      continue;
    }
    if (effect.element && effect.element !== elementKind) continue;
    if (effect.weapons && !effect.weapons.includes(weapon.kind)) continue;
    if (effect.needsFrenzy && !frenzy) {
      noEffect.push({ skill: name, reason: 'nothing infects you with Frenzy' });
      continue;
    }
    if (effect.condition.kind === 'toggle' && hasValues(atLevel(effect.levels, active.level))) {
      const c = effect.condition;
      conditions.push({ key: name, skill: name, label: c.label, on: toggles[name] ?? c.defaultOn, excludes: [...(c.excludes ?? [])] });
    }
    if (effect.condition.kind === 'weak-point') {
      conditions.push({ key: name, skill: name, label: `Hitting a weak point (hitzone ${WEAK_POINT_HITZONE * 100}+)`, on: toggles[name] ?? true, excludes: [] });
    }
    for (const x of effect.extra ?? []) {
      if (hasValues(atLevel(x.levels, active.level))) conditions.push({ key: x.key, skill: name, label: x.label, on: toggles[x.key] ?? x.defaultOn, excludes: [] });
    }
    if (!effect.verified) assumed.push(name);
    modeled.push({ name, level: active.level, effect });
  }

  for (const b of input.buffs ?? []) {
    if (b.toggle) conditions.push({ key: b.label, skill: b.label, label: b.toggle.label, on: toggles[b.label] ?? b.toggle.defaultOn, excludes: [] });
  }
  resolveExclusions(conditions, toggles);
  const isOn = new Map(conditions.map((c) => [c.key, c.on]));

  const statsFor = (weakPoint: boolean, wounded: boolean): Stats => {
    const parts: { label: string; values: EffectValues }[] = (input.buffs ?? []).filter((b) => !b.toggle || isOn.get(b.label));
    for (const { name, level: lv, effect } of modeled) {
      for (const x of effect.extra ?? []) {
        if (isOn.get(x.key)) parts.push({ label: `${name} (${x.label})`, values: atLevel(x.levels, lv) });
      }
      const values = atLevel(effect.levels, lv);
      const c = effect.condition;
      const applies =
        c.kind === 'always' ||
        (c.kind === 'toggle' && isOn.get(name)) ||
        (c.kind === 'weak-point' && weakPoint && isOn.get(name)) ||
        (c.kind === 'low-sharpness' && sharpness !== null && sharpness.top <= c.maxColorIndex[Math.min(lv, c.maxColorIndex.length) - 1]);
      if (!applies) continue;
      parts.push({ label: name, values });
      if (c.kind === 'weak-point' && wounded && effect.wound) {
        parts.push({ label: `${name} (wound)`, values: effect.wound[Math.min(lv, effect.wound.length) - 1] });
      }
    }
    return computeStats(weapon, elementSpecial?.value ?? null, sharpness, parts);
  };

  const base = statsFor(true, false);
  let vsTarget: DamageResult['vsTarget'] = null;
  if (input.target) {
    const kind = input.hitzoneKind ?? hitzoneKind(weapon.kind);
    const rawHitzone = input.target.hitzones[kind];
    const elementHitzone = elementKind ? input.target.hitzones[elementKind] : 0;
    const weakPoint = rawHitzone >= WEAK_POINT_HITZONE;
    const stats = statsFor(weakPoint, input.target.wounded);
    const raw = stats.efr * rawHitzone;
    const element = stats.efe * elementHitzone;
    vsTarget = { ...stats, hit: { hitzoneKind: kind, rawHitzone, elementHitzone, weakPoint, raw, element, total: raw + element } };
  }

  return {
    sharpness,
    elementKind,
    status: statusSpecial?.kind === 'status' ? { kind: statusSpecial.status, value: statusSpecial.value } : null,
    base,
    vsTarget,
    conditions,
    assumed,
    notModeled,
    noEffect,
  };
}

/**
 * Makes `excludes` symmetric over the listed conditions, then turns off conditions that clash with
 * one already on. Explicitly switched-on toggles win over defaults; otherwise list order wins.
 */
function resolveExclusions(conditions: ConditionState[], toggles: Readonly<Record<string, boolean>>): void {
  const declared = new Map(conditions.map((c) => [c.key, c.excludes]));
  for (const c of conditions) {
    c.excludes = conditions
      .filter((o) => o !== c && (declared.get(c.key)!.includes(o.key) || declared.get(o.key)!.includes(c.key)))
      .map((o) => o.key);
  }
  const kept = new Set<string>();
  const order = [...conditions.filter((c) => toggles[c.key] === true), ...conditions.filter((c) => toggles[c.key] !== true)];
  for (const c of order) {
    if (!c.on) continue;
    if (c.excludes.some((k) => kept.has(k))) c.on = false;
    else kept.add(c.key);
  }
}

function computeStats(
  weapon: Weapon,
  baseElement: number | null,
  sharpness: SharpnessState | null,
  parts: readonly { label: string; values: EffectValues }[],
): Stats {
  const attackParts: Contribution[] = [];
  const affinityParts: Contribution[] = [];
  const elementParts: Contribution[] = [];
  let attackPct = 0;
  let attackFlat = 0;
  let affinity = weapon.affinity;
  let critMultiplier = BASE_CRIT_MULTIPLIER;
  let critElement = 1;
  let elementPct = 0;
  let elementFlat = 0;
  let rawDamagePct = 0;

  for (const { label, values: v } of parts) {
    if (v.attackPct || v.attackFlat) {
      const gain = (weapon.attack * (v.attackPct ?? 0)) / 100 + (v.attackFlat ?? 0);
      attackParts.push({ label, value: gain });
      attackPct += v.attackPct ?? 0;
      attackFlat += v.attackFlat ?? 0;
    }
    if (v.affinity) {
      affinityParts.push({ label, value: v.affinity });
      affinity += v.affinity;
    }
    if (v.critMultiplier) critMultiplier = Math.max(critMultiplier, v.critMultiplier);
    if (v.critElement) critElement = Math.max(critElement, v.critElement);
    if (baseElement !== null && (v.elementPct || v.elementFlat)) {
      elementParts.push({ label, value: (baseElement * (v.elementPct ?? 0)) / 100 + (v.elementFlat ?? 0) });
      elementPct += v.elementPct ?? 0;
      elementFlat += v.elementFlat ?? 0;
    }
    rawDamagePct += v.rawDamagePct ?? 0;
  }

  // Percentages scale the weapon's base value; flat bonuses are added after.
  const attack = weapon.attack * (1 + attackPct / 100) + attackFlat;
  const uncapped = baseElement === null ? null : baseElement * (1 + elementPct / 100) + elementFlat;
  const cap = baseElement === null ? null : elementCap(baseElement);
  const element = uncapped === null || cap === null ? null : Math.min(uncapped, cap);
  const clamped = Math.max(-100, Math.min(100, affinity));
  const p = clamped / 100;
  const rawCrit = p >= 0 ? 1 + p * (critMultiplier - 1) : 1 + -p * (NEGATIVE_CRIT_MULTIPLIER - 1);
  const elementCrit = p > 0 ? 1 + p * (critElement - 1) : 1;

  return {
    attack,
    attackParts,
    affinity: clamped,
    affinityParts,
    critMultiplier,
    critElement,
    element,
    elementParts,
    elementCap: cap,
    elementCapped: uncapped !== null && cap !== null && uncapped > cap + 1e-9,
    rawDamagePct,
    rawCrit,
    elementCrit,
    efr: attack * (sharpness?.raw ?? 1) * rawCrit * (1 + rawDamagePct / 100),
    efe: (element ?? 0) * (sharpness?.element ?? 1) * elementCrit,
  };
}
