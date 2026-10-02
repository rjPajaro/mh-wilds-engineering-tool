import { computed, inject, Injectable } from '@angular/core';
import { Build, emptySavedBuild, isSavedBuild, resolveBuild, SavedBuild } from '../core/build/build';
import { WEAPON_KINDS, WeaponKind } from '../core/models/game-data';
import { persistedSignal } from '../shared/persisted-signal';
import { CustomTalismansService } from './custom-talismans.service';
import { CustomWeaponsService } from './custom-weapons.service';
import { GameDataService } from './game-data.service';

const NO_LOOKUP = { weapon: () => undefined, armor: () => undefined, talisman: () => undefined, decoration: () => undefined };

/**
 * The build being edited in the Builder, persisted across reloads. Stored as ids
 * and resolved against current data, so it restores once the data loads and
 * follows edits to custom Artians.
 */
@Injectable({ providedIn: 'root' })
export class CurrentBuildService {
  private readonly data = inject(GameDataService);
  private readonly customWeapons = inject(CustomWeaponsService);
  private readonly customTalismans = inject(CustomTalismansService);

  readonly weaponKind = persistedSignal<WeaponKind>('builder.weaponKind.v1', 'long-sword', (v) => WEAPON_KINDS.includes(v as WeaponKind));
  readonly saved = persistedSignal<SavedBuild>('builder.build.v1', emptySavedBuild(), isSavedBuild);

  readonly build = computed<Build>(() => {
    const index = this.data.index();
    if (!index) return resolveBuild(emptySavedBuild(), NO_LOOKUP);
    const custom = this.customWeapons.weapons();
    const customTalismans = this.customTalismans.talismans();
    return resolveBuild(this.saved(), {
      weapon: (id) => custom.get(id) ?? index.weapons.get(id),
      armor: (id) => index.armorPieces.get(id),
      talisman: (id) => customTalismans.get(id) ?? index.talismans.get(id),
      decoration: (id) => index.decorations.get(id),
    });
  });
}
