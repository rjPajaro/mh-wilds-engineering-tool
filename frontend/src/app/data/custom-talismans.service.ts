import { computed, inject, Injectable } from '@angular/core';
import { Talisman } from '../core/models/game-data';
import { buildCustomTalisman, CustomTalismanConfig, isCustomTalismanConfig } from '../core/talismans/custom-talisman';
import { persistedSignal } from '../shared/persisted-signal';
import icons from '../../assets/data/icons.json';
import { GameDataService } from './game-data.service';

const CHARM_ICONS: Record<string, string> = icons.charms;

/** Talismans the player rolled and entered, persisted in localStorage. */
@Injectable({ providedIn: 'root' })
export class CustomTalismansService {
  private readonly data = inject(GameDataService);

  readonly configs = persistedSignal<readonly CustomTalismanConfig[]>('talismans.v1', [], (v) => Array.isArray(v) && v.every(isCustomTalismanConfig));

  /** Built talismans by id; configs with errors are left out. */
  readonly talismans = computed(() => {
    const skills = this.data.index()?.skills;
    const map = new Map<string, Talisman>();
    if (!skills) return map;
    for (const config of this.configs()) {
      const talisman = buildCustomTalisman(config, skills);
      if (talisman) map.set(talisman.id, { ...talisman, thumbnail: CHARM_ICONS[talisman.rarity] });
    }
    return map;
  });

  save(config: CustomTalismanConfig): void {
    this.configs.update((list) => {
      const i = list.findIndex((c) => c.id === config.id);
      return i === -1 ? [...list, config] : list.map((c, j) => (j === i ? config : c));
    });
  }

  remove(id: string): void {
    this.configs.update((list) => list.filter((c) => c.id !== id));
  }

  newId(): string {
    const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return `custom:${random}`;
  }
}
