import { EffectValues } from './skill-effects';

export interface BuffOption {
  id: string;
  name: string;
  attack?: number;
  defense?: number;
  /** Multiplies total defense (Adamant Pill). */
  defenseMultiplier?: number;
  /** Food skills the meal grants (shown only; not modeled). */
  foodSkills?: readonly string[];
}

/**
 * Items and meals that raise attack or defense. Options in one group don't stack
 * (the game keeps only one of them), so a group holds at most one choice.
 */
export interface BuffGroup {
  id: string;
  label: string;
  options: readonly BuffOption[];
  /** Selected when the user has not chosen (charms sit in the pouch all hunt). */
  defaultOption?: string;
}

/** Group id -> chosen option id; '' means none. */
export type BuffSelection = Readonly<Record<string, string>>;

/**
 * Values from game8's "Buffs Explained" (https://game8.co/games/Monster-Hunter-Wilds/archives/500092),
 * Armorcharm/Powercharm guide (https://game8.co/games/Monster-Hunter-Wilds/archives/503810) and the
 * Monster Hunter Wiki's Meals (MHWilds) page (https://monsterhunterwiki.org/wiki/Meals_(MHWilds)).
 */
export const BUFF_GROUPS: readonly BuffGroup[] = [
  { id: 'powercharm', label: 'Powercharm', options: [{ id: 'powercharm', name: 'Powercharm', attack: 6 }], defaultOption: 'powercharm' },
  { id: 'armorcharm', label: 'Armorcharm', options: [{ id: 'armorcharm', name: 'Armorcharm', defense: 12 }], defaultOption: 'armorcharm' },
  { id: 'demon-powder', label: 'Demon Powder', options: [{ id: 'demon-powder', name: 'Demon Powder', attack: 10 }] },
  { id: 'hardshell-powder', label: 'Hardshell Powder', options: [{ id: 'hardshell-powder', name: 'Hardshell Powder', defense: 20 }] },
  {
    id: 'meal',
    label: 'Meal',
    options: [
      { id: 'meat', name: 'Meat ration', attack: 2 },
      { id: 'fish', name: 'Fish ration', defense: 4 },
      { id: 'veggies', name: 'Veggie ration', defense: 2 },
      // Settlement and Grand Hub festival meals all give +5 attack / +10 defense; only their food skills differ.
      ...(
        [
          ['kunafa', 'Springy Kunafa Cuisine', ['Lucky Meal', 'Insurance Meal', 'Defender Meal (Hi)']],
          ['azuz', 'Hot Azuz Cuisine', ['Carver Meal', 'Insurance Meal', 'Tumbler Meal (Hi)']],
          ['sild', 'Fresh Sild Cuisine', ['Capture Pro Meal', 'Insurance Meal', 'Moxie Meal (Hi)']],
          ['suja', 'Colorful Suja Cuisine', ['Exploiter Meal', 'Insurance Meal', 'Caprice Meal (Hi)']],
          ['blossomdance', 'Blossomdance Sushi Meal', ['Defender Meal (Hi)', 'Gatherer Meal', 'Riser Meal']],
          ['flamefete', 'Flamefete Barbecue Meal', ['Swimmer Meal', 'Balanced Meal', 'Moxie Meal (Hi)']],
          ['dreamspell', 'Dreamspell Tea Time Stand', ['Insurance Meal', 'Medic Meal', 'Break-time Meal']],
          ['lumenhymn', 'Lumenhymn Ceremonial Platter', ['Insurance Meal', 'Immunizer Meal', 'Fortune Hunter Meal']],
          ['tonkotsu-ramen', 'Classic Tonkotsu Ramen', ['Extra Noodles Meal', 'Spicy Red Meal (Attack)', 'Sizzling Meal']],
          ['tonkotsu-free-ramen', '100% Tonkotsu-Free Ramen', ['Extra Noodles Meal', 'Spicy Red Meal (Energy)', 'Sizzling Meal']],
        ] as const
      ).map(([id, name, foodSkills]) => ({ id, name, attack: 5, defense: 10, foodSkills })),
    ],
  },
  {
    id: 'demondrug',
    label: 'Demondrug',
    options: [
      { id: 'demondrug', name: 'Demondrug', attack: 5 },
      { id: 'mega-demondrug', name: 'Mega Demondrug', attack: 7 },
    ],
  },
  {
    id: 'might',
    label: 'Might',
    options: [
      { id: 'might-seed', name: 'Might Seed', attack: 10 },
      { id: 'might-pill', name: 'Might Pill', attack: 25 },
    ],
  },
  {
    id: 'armorskin',
    label: 'Armorskin',
    options: [
      { id: 'armorskin', name: 'Armorskin', defense: 15 },
      { id: 'mega-armorskin', name: 'Mega Armorskin', defense: 25 },
    ],
  },
  {
    id: 'adamant',
    label: 'Adamant',
    options: [
      { id: 'adamant-seed', name: 'Adamant Seed', defense: 20 },
      { id: 'adamant-pill', name: 'Adamant Pill', defenseMultiplier: 1.3 },
    ],
  },
];

/** The chosen options, falling back to each group's default; unknown ids are ignored. */
export function activeBuffs(selection: BuffSelection): BuffOption[] {
  return BUFF_GROUPS.flatMap((g) => {
    const id = selection[g.id] ?? g.defaultOption ?? '';
    const option = g.options.find((o) => o.id === id);
    return option ? [option] : [];
  });
}

/** Attack buffs as damage-calculator contributions (flat attack, added after skill percentages). */
export function buffEffects(selection: BuffSelection): { label: string; values: EffectValues }[] {
  return activeBuffs(selection)
    .filter((b) => b.attack)
    .map((b) => ({ label: b.name, values: { attackFlat: b.attack } }));
}

/** Defense with buffs: flat bonuses are added, then the Adamant Pill multiplier applies (order assumed). */
export function buffedDefense(armorDefense: number, selection: BuffSelection): number {
  const buffs = activeBuffs(selection);
  const flat = buffs.reduce((sum, b) => sum + (b.defense ?? 0), 0);
  const multiplier = buffs.reduce((m, b) => m * (b.defenseMultiplier ?? 1), 1);
  return Math.floor((armorDefense + flat) * multiplier);
}
