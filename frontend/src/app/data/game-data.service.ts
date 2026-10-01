import { computed, Injectable, resource } from '@angular/core';
import { buildGameIndex, GameIndex } from '../core/data/game-index';
import { GameDataFiles } from '../core/models/game-data';

const DATA_URL = 'assets/data';

const FILES: Record<keyof GameDataFiles, string> = {
  skills: 'skills.json',
  armor: 'armor.json',
  decorations: 'decorations.json',
  talismans: 'talismans.json',
  weapons: 'weapons.json',
  huntingHorn: 'hunting-horn.json',
  monsters: 'monsters.json',
  artian: 'artian.json',
  moves: 'moves.json',
};

/** Loads the static game data once and exposes it as indexed lookups. */
@Injectable({ providedIn: 'root' })
export class GameDataService {
  private readonly files = resource({ loader: () => loadFiles() });

  /** Indexed game data, or undefined while loading / on error. */
  readonly index = computed<GameIndex | undefined>(() =>
    // value() throws while the resource is in an error state; hasValue() guards it.
    this.files.hasValue() ? buildGameIndex(this.files.value()) : undefined,
  );
  readonly isLoading = this.files.isLoading;
  readonly error = this.files.error;
}

async function loadFiles(): Promise<GameDataFiles> {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, file]) => {
      const response = await fetch(`${DATA_URL}/${file}`);
      if (!response.ok) throw new Error(`Failed to load ${file}: ${response.status}`);
      return [key, await response.json()] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as GameDataFiles;
}
