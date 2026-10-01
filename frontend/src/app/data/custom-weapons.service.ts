import { computed, inject, Injectable, signal } from '@angular/core';
import { ArtianConfig, buildArtianWeapon, CUSTOM_PREFIX } from '../core/artian/artian';
import { Weapon, WeaponKind } from '../core/models/game-data';
import { GameDataService } from './game-data.service';

const STORAGE_KEY = 'mhwet.artians.v1';

/** User-built Artian / Gogma Artian weapons, persisted in localStorage. */
@Injectable({ providedIn: 'root' })
export class CustomWeaponsService {
  private readonly data = inject(GameDataService);

  readonly configs = signal<readonly ArtianConfig[]>(load());

  /** Built weapons by id; configs with errors are left out. */
  readonly weapons = computed(() => {
    const index = this.data.index();
    const map = new Map<string, Weapon>();
    if (!index) return map;
    for (const config of this.configs()) {
      const { weapon } = buildArtianWeapon(config, index);
      if (weapon) map.set(weapon.id, weapon);
    }
    return map;
  });

  weaponsOfKind(kind: WeaponKind): Weapon[] {
    return [...this.weapons().values()].filter((w) => w.kind === kind);
  }

  save(config: ArtianConfig): void {
    this.configs.update((list) => {
      const i = list.findIndex((c) => c.id === config.id);
      const next = i === -1 ? [...list, config] : list.map((c, j) => (j === i ? config : c));
      persist(next);
      return next;
    });
  }

  remove(id: string): void {
    this.configs.update((list) => {
      const next = list.filter((c) => c.id !== id);
      persist(next);
      return next;
    });
  }

  newId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

function load(): ArtianConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((c): c is ArtianConfig => typeof c?.id === 'string' && c.id.startsWith(CUSTOM_PREFIX)) : [];
  } catch {
    return [];
  }
}

function persist(configs: readonly ArtianConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
  } catch {
    // Storage unavailable (private mode, quota): keep working in memory.
  }
}
