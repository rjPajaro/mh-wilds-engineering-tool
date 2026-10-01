import { ElementKind, Hitzones, StatusKind, Weapon, WeaponKind } from '../models/game-data';
import { ActiveSkill } from '../skills/skill-resolver';
import { sharpnessState, SharpnessState } from './sharpness';
import { EffectValues, SKILL_EFFECTS, SkillEffect, SPECIAL_SKILLS } from './skill-effects';

/** Not in the dataset; standard series values. */
export const BASE_CRIT_MULTIPLIER = 1.25;
export const NEGATIVE_CRIT_MULTIPLIER = 0.75;
/** Raw hitzone at or above which Weakness Exploit applies. Assumed (series convention). */
export const WEAK_POINT_HITZONE = 0.45;

export type HitzoneKind = 'slash' | 'blunt' | 'pierce';

export interface DamageTarget {
  hitzones: Hitzones;
  wounded: boolean;
}

export interface DamageInput {
  weapon: Weapon;
  skills: readonly ActiveSkill[];
  /** On/off per toggle-condition skill name; missing entries use the skill's default. */
  toggles?: Readonly<Record<string, boolean>>;
  target?: DamageTarget | null;
  /** Hitzone type to use instead of the weapon type's (e.g. a blunt move on a slash weapon). */
  hitzoneKind?: HitzoneKind;
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
  /** Element in true units after skills; null for raw/status weapons. */
  element: number | null;
  elementParts: Contribution[];
  rawDamagePct: number;
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
  skill: string;
  label: string;
  on: boolean;
}

export interface DamageResult {
  sharpness: SharpnessState | null;
  elementKind: ElementKind | null;
  status: { kind: StatusKind; value: number } | null;
  /** Stats without target-dependent effects. */
  base: Stats;
  /** Stats and damage against the target, if one is set. */
  vsTarget: (Stats & { hit: PerHit }) | null;
  conditions: ConditionState[];
  /** Applied skills whose numbers were assumed rather than taken from game text. */
  assumed: string[];
  /** Active skills that may affect damage but are not modeled. */
  notModeled: string[];
}

const BLUNT: readonly WeaponKind[] = ['hammer', 'hunting-horn'];
const RANGED: readonly WeaponKind[] = ['bow', 'light-bowgun', 'heavy-bowgun'];
const DAMAGE_ICONS = new Set(['attack', 'offense', 'affinity', 'element']);

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
  const modeled: { name: string; level: number; effect: SkillEffect }[] = [];

  for (const active of skills) {
    if (active.level <= 0) continue;
    const name = active.skill.name;
    const effect = SKILL_EFFECTS[name];
    if (!effect) {
      const relevant = DAMAGE_ICONS.has(active.skill.icon) || active.skill.kind === 'set' || active.skill.kind === 'group';
      if (relevant && !SPECIAL_SKILLS.has(name)) notModeled.push(name);
      continue;
    }
    if (effect.element && effect.element !== elementKind) continue;
    if (effect.condition.kind === 'toggle') {
      conditions.push({ skill: name, label: effect.condition.label, on: toggles[name] ?? effect.condition.defaultOn });
    }
    if (!effect.verified) assumed.push(name);
    modeled.push({ name, level: active.level, effect });
  }

  const statsFor = (weakPoint: boolean, wounded: boolean): Stats => {
    const parts: { label: string; values: EffectValues }[] = [];
    for (const { name, level: lv, effect } of modeled) {
      const values = effect.levels[Math.min(lv, effect.levels.length) - 1];
      const c = effect.condition;
      const applies =
        c.kind === 'always' ||
        (c.kind === 'toggle' && (toggles[name] ?? c.defaultOn)) ||
        (c.kind === 'weak-point' && weakPoint) ||
        (c.kind === 'low-sharpness' && sharpness !== null && sharpness.top <= c.maxColorIndex[Math.min(lv, c.maxColorIndex.length) - 1]);
      if (!applies) continue;
      parts.push({ label: name, values });
      if (c.kind === 'weak-point' && wounded && effect.wound) {
        parts.push({ label: `${name} (wound)`, values: effect.wound[Math.min(lv, effect.wound.length) - 1] });
      }
    }
    return computeStats(weapon, elementSpecial?.value ?? null, sharpness, parts);
  };

  const base = statsFor(false, false);
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
  };
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
  const element = baseElement === null ? null : baseElement * (1 + elementPct / 100) + elementFlat;
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
    rawDamagePct,
    efr: attack * (sharpness?.raw ?? 1) * rawCrit * (1 + rawDamagePct / 100),
    efe: (element ?? 0) * (sharpness?.element ?? 1) * elementCrit,
  };
}
