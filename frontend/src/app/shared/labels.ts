import { WEAPON_KINDS, WeaponKind } from '../core/models/game-data';
import { SelectOption } from './search-select/search-select';

export function weaponKindLabel(kind: WeaponKind): string {
  return kind
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
    .replace('Sword Shield', 'Sword & Shield');
}

export const WEAPON_KIND_OPTIONS: readonly SelectOption[] = WEAPON_KINDS.map((kind) => ({
  value: kind,
  label: weaponKindLabel(kind),
}));

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
