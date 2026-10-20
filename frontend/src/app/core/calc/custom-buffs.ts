import { BuffEffect } from './damage';
import { EffectValues } from './skill-effects';

/**
 * A buff whose numbers the user types in: Hunting Horn songs, weapon modes (Demon Mode), ammo and
 * coatings, anything the calculator doesn't list. Element is entered in display units (as in game).
 */
export interface CustomBuff {
  id: string;
  name: string;
  enabled: boolean;
  values: Partial<Record<CustomBuffField, number>>;
}

export type CustomBuffField = 'attackFlat' | 'attackPct' | 'affinity' | 'critBonus' | 'elementFlat' | 'elementPct' | 'rawMultiplier' | 'elementMultiplier';

export interface CustomBuffFieldInfo {
  key: CustomBuffField;
  label: string;
  hint: string;
}

/** Input fields, in display order. */
export const CUSTOM_BUFF_FIELDS: readonly CustomBuffFieldInfo[] = [
  { key: 'attackFlat', label: 'Attack', hint: 'Flat attack, added after percentages (like Powercharm)' },
  { key: 'attackPct', label: 'Attack %', hint: "Percent of the weapon's base attack (like Attack Boost)" },
  { key: 'affinity', label: 'Affinity %', hint: 'Affinity points' },
  { key: 'critBonus', label: 'Crit dmg %', hint: 'Added to the crit multiplier: 5 turns ×1.25 into ×1.30' },
  { key: 'elementFlat', label: 'Element', hint: 'Flat element in display units (as shown in game); counts toward the element cap' },
  { key: 'elementPct', label: 'Element %', hint: "Percent of the weapon's base element; counts toward the element cap" },
  { key: 'rawMultiplier', label: 'Raw dmg %', hint: 'Multiplies final raw damage: 10 = ×1.1 (weapon modes, ammo, coatings)' },
  { key: 'elementMultiplier', label: 'Elem dmg %', hint: 'Multiplies final element damage, after the element cap: 10 = ×1.1' },
];

const FIELD_KEYS = new Set<string>(CUSTOM_BUFF_FIELDS.map((f) => f.key));

/** A ready-made custom buff; adding one copies its values, which stay editable. */
export interface CustomBuffPreset {
  id: string;
  group: string;
  name: string;
  values: CustomBuff['values'];
}

/**
 * Sourced values only. "Raw Attack +x%" is read as a percent of base attack (like Attack Boost) and
 * "Element +x%" as a percent of base element (counts toward the cap): assumed, the sources don't say.
 * - Hunting Horn: game8 "Hunting Horn Songs and Effects" (https://game8.co/games/Monster-Hunter-Wilds/archives/500352,
 *   updated July 2025). Tier 2 = the song performed twice, or Encore.
 * - Corrupted Mantle: game8 "How to Use Corrupted Mantle" (https://game8.co/games/Monster-Hunter-Wilds/archives/503131),
 *   Title Update 1 values: +5% affinity; after consecutive hits +10% affinity and +4.5% attack.
 * Left out for lack of a reliable current source: Demon Mode / Demon Boost, bow coatings, Evasion Mantle.
 */
export const CUSTOM_BUFF_PRESETS: readonly CustomBuffPreset[] = [
  { id: 'hh-attack-s-1', group: 'Hunting Horn', name: 'Attack Up (S)', values: { attackPct: 2.7 } },
  { id: 'hh-attack-s-2', group: 'Hunting Horn', name: 'Attack Up (S), tier 2', values: { attackPct: 4.5 } },
  { id: 'hh-attack-l-1', group: 'Hunting Horn', name: 'Attack Up (L)', values: { attackPct: 4.5 } },
  { id: 'hh-attack-l-2', group: 'Hunting Horn', name: 'Attack Up (L), tier 2', values: { attackPct: 10 } },
  { id: 'hh-attack-defense-1', group: 'Hunting Horn', name: 'Attack/Defense Up', values: { attackPct: 2.7 } },
  { id: 'hh-attack-defense-2', group: 'Hunting Horn', name: 'Attack/Defense Up, tier 2', values: { attackPct: 4.5 } },
  { id: 'hh-self-improvement-2', group: 'Hunting Horn', name: 'Self-Improvement, tier 2 (horn user)', values: { attackPct: 20 } },
  { id: 'hh-affinity', group: 'Hunting Horn', name: 'Affinity Up/Health Recovery', values: { affinity: 15 } },
  { id: 'hh-element-1', group: 'Hunting Horn', name: 'Elem Attack Boost', values: { elementPct: 8 } },
  { id: 'hh-element-2', group: 'Hunting Horn', name: 'Elem Attack Boost, tier 2', values: { elementPct: 10 } },
  { id: 'hh-echo-attack-affinity', group: 'Hunting Horn', name: 'Echo Bubble: Attack & Affinity Up', values: { attackPct: 10, affinity: 25 } },
  { id: 'corrupted-mantle-1', group: 'Mantle', name: 'Corrupted Mantle', values: { affinity: 5 } },
  { id: 'corrupted-mantle-2', group: 'Mantle', name: 'Corrupted Mantle, after consecutive hits', values: { affinity: 10, attackPct: 4.5 } },
];

/** A new enabled custom buff with the preset's name and values. */
export function customBuffFromPreset(id: string, preset: CustomBuffPreset): CustomBuff {
  return { id, name: preset.name, enabled: true, values: { ...preset.values } };
}

/** Element is entered ×10 like the game shows it; the calculator works in true units. */
const ELEMENT_DISPLAY_SCALE = 10;

export function newCustomBuff(id: string): CustomBuff {
  return { id, name: '', enabled: true, values: {} };
}

/** A stored value is a list of custom buffs (used to reject corrupt localStorage entries). */
export function isCustomBuffList(v: unknown): v is CustomBuff[] {
  return (
    Array.isArray(v) &&
    v.every(
      (b) =>
        typeof b === 'object' &&
        b !== null &&
        typeof b.id === 'string' &&
        typeof b.name === 'string' &&
        typeof b.enabled === 'boolean' &&
        typeof b.values === 'object' &&
        b.values !== null &&
        Object.entries(b.values).every(([k, n]) => FIELD_KEYS.has(k) && typeof n === 'number' && Number.isFinite(n)),
    )
  );
}

/** The buff's values as calculator inputs. */
export function customBuffValues(buff: CustomBuff): EffectValues {
  const v = buff.values;
  const out: EffectValues = {};
  if (v.attackFlat) out.attackFlat = v.attackFlat;
  if (v.attackPct) out.attackPct = v.attackPct;
  if (v.affinity) out.affinity = v.affinity;
  if (v.critBonus) out.critBonus = v.critBonus;
  if (v.elementFlat) out.elementFlat = v.elementFlat / ELEMENT_DISPLAY_SCALE;
  if (v.elementPct) out.elementPct = v.elementPct;
  if (v.rawMultiplier) out.rawDamagePct = v.rawMultiplier;
  if (v.elementMultiplier) out.elementFinalPct = v.elementMultiplier;
  return out;
}

/** Enabled buffs with any value, labeled by name ("Custom buff" when blank; repeated names numbered). */
export function customBuffEffects(buffs: readonly CustomBuff[]): BuffEffect[] {
  const seen = new Map<string, number>();
  return buffs.flatMap((b) => {
    const values = customBuffValues(b);
    if (!b.enabled || Object.keys(values).length === 0) return [];
    const name = b.name.trim() || 'Custom buff';
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return [{ label: n > 1 ? `${name} (${n})` : name, values }];
  });
}
