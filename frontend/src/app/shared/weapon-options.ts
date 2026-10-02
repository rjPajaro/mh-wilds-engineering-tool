import { ArtianConfig, infusionLabel, isCustomWeapon } from '../core/artian/artian';
import { GameIndex } from '../core/data/game-index';
import { GOGMA_DEVICES, GogmaDevice, SkillId, Skill, SkillLevel, Weapon, WeaponKind } from '../core/models/game-data';
import { SelectOption } from './search-select/search-select';
import icons from '../../assets/data/icons.json';

// Weapon pickers shared by the Builder and the Armor Search tab.

export const DEVICE_LABELS: Record<GogmaDevice, string> = {
  attack: 'Attack',
  affinity: 'Affinity',
  element: 'Element',
};

/**
 * Weapons of one type: the user's saved Artians first, then game data. Each
 * game-data Gogma Artian appears once, keyed by its group id (see weaponOptionValue).
 */
export function weaponOptions(
  kind: WeaponKind,
  index: GameIndex | undefined,
  customWeapons: readonly Weapon[],
  configs: readonly ArtianConfig[],
): SelectOption[] {
  const byId = new Map(configs.map((c) => [c.id, c]));
  const options: SelectOption[] = customWeapons
    .filter((w) => w.kind === kind)
    .map((w) => {
      const config = byId.get(w.id)!;
      const tier = config.tier === 'gogma' ? `Gogma · ${DEVICE_LABELS[config.device]} device` : `Artian R${config.rarity}`;
      return {
        value: w.id,
        label: w.name,
        hint: [`My ${tier}`, infusionLabel(config), statText(w), specialText(w)].filter(Boolean).join(' · '),
        keywords: 'my custom artian',
        icon: equipmentIcon(w.kind, w.rarity),
      };
    });
  for (const w of index?.weaponsByKind.get(kind) ?? []) {
    if (w.artian?.tier !== 'gogma') {
      options.push({
        value: w.id,
        label: w.name,
        hint: [`R${w.rarity}`, w.artian ? 'Artian' : '', statText(w), specialText(w), skillsText(w.skills, index!.skills)]
          .filter(Boolean)
          .join(' · '),
        keywords: w.series ?? '',
        icon: equipmentIcon(w.kind, w.rarity),
      });
    } else if (w.artian.device === 'attack') {
      const group = index!.gogmaGroups.get(w.artian.groupId)!;
      options.push({
        value: w.artian.groupId,
        label: w.name,
        hint: [`R${w.rarity} · Gogma Artian`, ...GOGMA_DEVICES.map((d) => `${DEVICE_LABELS[d]} ${statText(group[d])}`)].join(' · '),
        keywords: 'artian',
        icon: equipmentIcon(w.kind, w.rarity),
      });
    }
  }
  return options;
}

/** The option that shows `weapon` in weaponOptions: a game Gogma Artian shows as its group. */
export function weaponOptionValue(weapon: Weapon | null | undefined): string {
  if (!weapon) return '';
  if (isCustomWeapon(weapon)) return weapon.id;
  return weapon.artian?.tier === 'gogma' ? weapon.artian.groupId : weapon.id;
}

/** The weapon id an option stands for; a Gogma group picks its attack device. */
export function weaponIdForOption(value: string, index: GameIndex): string | null {
  return value ? (index.gogmaGroups.get(value)?.attack.id ?? value) : null;
}

/** Device variants of a game Gogma Artian, or null for any other weapon (custom ones fix their device). */
export function gogmaGroupOf(weapon: Weapon | null | undefined, index: GameIndex | undefined): Readonly<Record<GogmaDevice, Weapon>> | null {
  if (!weapon || isCustomWeapon(weapon) || weapon.artian?.tier !== 'gogma') return null;
  return index?.gogmaGroups.get(weapon.artian.groupId) ?? null;
}

/** "Weakness Exploit 2, Agitator 1"; set/group bonuses only when `includeBonuses`. */
export function skillsText(skills: readonly SkillLevel[], skillMap: ReadonlyMap<SkillId, Skill> | undefined, includeBonuses = true): string {
  return skills
    .map(({ skillId, level }) => ({ skill: skillMap?.get(skillId), level }))
    .filter(({ skill }) => skill && (includeBonuses || (skill.kind !== 'set' && skill.kind !== 'group')))
    .map(({ skill, level }) => `${skill!.name} ${level}`)
    .join(', ');
}

export function statText(w: Weapon): string {
  return `${w.attack} atk${w.affinity ? ` ${w.affinity > 0 ? '+' : ''}${w.affinity}%` : ''}`;
}

export function specialText(w: Weapon): string {
  return w.specials
    .map((s) => `${s.hidden ? '(' : ''}${s.kind === 'element' ? s.element : s.status} ${s.value}${s.hidden ? ')' : ''}`)
    .join(' ');
}

/** In-game equipment type icon tinted for `rarity` (assets/data/icons.json, from the MH Wiki). */
export function equipmentIcon(kind: string, rarity: number | 'base'): string | undefined {
  return (icons.equipment as Record<string, Record<string, string>>)[kind]?.[rarity];
}
