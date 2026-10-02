import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { transcendedId } from '../core/armor/transcend';
import { EquipSlot } from '../core/build/build';
import { ARMOR_KINDS, ArmorKind, ArmorPiece, Decoration, Weapon, WEAPON_KINDS, WeaponKind } from '../core/models/game-data';
import { ArmorSearchInput, ArmorSearchOutput, ArmorSetRanking, ArmorSetResult, searchArmorSets, SkillRequirement } from '../core/search/armor-search';
import { isBoolean, isObject, persistedSignal } from '../shared/persisted-signal';
import { CurrentBuildService } from './current-build.service';
import { CustomWeaponsService } from './custom-weapons.service';
import { CustomTalismansService } from './custom-talismans.service';
import { GameDataService } from './game-data.service';

/** Which talismans the search may use: none, the user's own, or theirs plus every craftable one. */
export type TalismanPool = 'none' | 'mine' | 'all';

export interface SearchWeapon {
  kind: WeaponKind;
  /** A game or custom weapon id; null for no weapon. */
  id: string | null;
}

export interface ArmorSearchSettings {
  requirements: SkillRequirement[];
  /** Weapon for the search: its skills count and its slots take weapon jewels. id null = no weapon. */
  weapon: SearchWeapon;
  /** Use transcended versions of rarity 5+ armor. */
  transcended: boolean;
  talismans: TalismanPool;
  rankBy: ArmorSetRanking;
}

const DEFAULT_SETTINGS: ArmorSearchSettings = { requirements: [], weapon: { kind: 'long-sword', id: null }, transcended: false, talismans: 'all', rankBy: 'slots' };
export const MAX_RESULTS = 200;

function isSettings(v: unknown): v is ArmorSearchSettings {
  return (
    isObject(v) &&
    Array.isArray(v['requirements']) &&
    v['requirements'].every((r) => isObject(r) && typeof r['skillId'] === 'number' && typeof r['level'] === 'number') &&
    // Version 1 had a useWeapon flag instead; migrated on load.
    (isSearchWeapon(v['weapon']) || isBoolean(v['useWeapon'])) &&
    isBoolean(v['transcended']) &&
    ['none', 'mine', 'all'].includes(v['talismans'] as string) &&
    ['slots', 'defense'].includes(v['rankBy'] as string)
  );
}

function isSearchWeapon(v: unknown): v is SearchWeapon {
  return isObject(v) && WEAPON_KINDS.includes(v['kind'] as WeaponKind) && (v['id'] === null || typeof v['id'] === 'string');
}

/**
 * Armor set search state for the Armor Search tab. Lives at the root so the
 * results survive switching tabs. The search runs in a Web Worker (inline when
 * workers are unavailable, e.g. in tests).
 */
@Injectable({ providedIn: 'root' })
export class ArmorSearchService {
  private readonly data = inject(GameDataService);
  private readonly current = inject(CurrentBuildService);
  private readonly customTalismans = inject(CustomTalismansService);
  private readonly customWeapons = inject(CustomWeaponsService);

  readonly settings = persistedSignal<ArmorSearchSettings>('search.settings.v1', DEFAULT_SETTINGS, isSettings);
  readonly output = signal<ArmorSearchOutput | null>(null);
  readonly running = signal(false);
  readonly error = signal<string | null>(null);
  /** Settings the shown results were found with. */
  private readonly searched = signal<ArmorSearchSettings | null>(null);
  /** Weapon the shown results were found with. */
  readonly searchedWeapon = signal<Weapon | null>(null);
  /** Requirements the shown results were found with. */
  readonly searchedRequirements = computed(() => this.searched()?.requirements ?? []);
  /** True when the settings changed after the last search. */
  readonly stale = computed(() => {
    const searched = this.searched();
    return searched !== null && JSON.stringify(searched) !== JSON.stringify(this.settings());
  });

  private worker: Worker | null = null;
  private runId = 0;

  /** The weapon the search uses; null when none is picked or the id no longer exists. */
  readonly weapon = computed<Weapon | null>(() => {
    const id = this.settings().weapon.id;
    if (!id) return null;
    return this.customWeapons.weapons().get(id) ?? this.data.index()?.weapons.get(id) ?? null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
    // Version 1 settings: useWeapon meant "the Builder's weapon".
    const old = this.settings() as Partial<ArmorSearchSettings> & { useWeapon?: boolean };
    if (!isSearchWeapon(old.weapon)) {
      const { useWeapon, ...rest } = old;
      this.settings.set({
        ...DEFAULT_SETTINGS,
        ...rest,
        weapon: { kind: this.current.weaponKind(), id: useWeapon ? this.current.saved().weaponId : null },
      });
    }
  }

  patch(changes: Partial<ArmorSearchSettings>): void {
    this.settings.update((s) => ({ ...s, ...changes }));
  }

  search(): void {
    const input = this.buildInput();
    if (!input) return;
    this.cancel();
    const id = ++this.runId;
    const settings = this.settings();
    this.running.set(true);
    this.error.set(null);
    const done = (output: ArmorSearchOutput | null, error?: string) => {
      if (id !== this.runId) return;
      this.worker?.terminate();
      this.worker = null;
      this.running.set(false);
      if (output) {
        this.output.set(output);
        this.searched.set(settings);
        this.searchedWeapon.set(input.weapon);
      } else {
        this.error.set(error ?? 'The search failed.');
      }
    };

    if (typeof Worker === 'undefined') {
      setTimeout(() => {
        try {
          done(searchArmorSets(input));
        } catch (e) {
          done(null, String(e));
        }
      });
      return;
    }
    this.worker = new Worker(new URL('../features/armor-search/armor-search.worker', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<ArmorSearchOutput>) => done(data);
    this.worker.onerror = (event) => done(null, event.message);
    this.worker.postMessage(input);
  }

  cancel(): void {
    this.runId++;
    this.worker?.terminate();
    this.worker = null;
    this.running.set(false);
  }

  /**
   * Puts a found set in the Builder, with the searched weapon if there was one
   * (no weapon leaves the Builder's alone). Jewels of the Builder's own weapon
   * are replaced only when the set uses weapon slots. A set without a talisman
   * keeps the current one (it can only add skills).
   */
  equip(result: ArmorSetResult): void {
    const ids = (list: readonly (Decoration | null)[] | undefined) => (list ?? []).map((d) => d?.id ?? null);
    const weapon = this.searchedWeapon();
    if (weapon) this.current.weaponKind.set(weapon.kind);
    this.current.saved.update((b) => {
      const decorations: Partial<Record<EquipSlot, (number | null)[]>> = { ...b.decorations };
      const armor: Partial<Record<ArmorKind, string | null>> = {};
      for (const kind of ARMOR_KINDS) {
        armor[kind] = result.armor[kind].id;
        decorations[kind] = ids(result.decorations[kind]);
      }
      if (result.talisman) decorations.talisman = ids(result.decorations.talisman);
      const weaponChanges = !!weapon && weapon.id !== b.weaponId;
      if (weaponChanges || result.decorations.weapon?.some((d) => d)) decorations.weapon = ids(result.decorations.weapon);
      return {
        ...b,
        weaponId: weaponChanges ? weapon.id : b.weaponId,
        armor,
        talismanId: result.talisman?.id ?? b.talismanId,
        decorations,
      };
    });
  }

  private buildInput(): ArmorSearchInput | null {
    const index = this.data.index();
    const settings = this.settings();
    if (!index || !settings.requirements.length) return null;

    const armor = {} as Record<ArmorKind, ArmorPiece[]>;
    for (const kind of ARMOR_KINDS) {
      armor[kind] = index.armorByKind[kind].map((p) => (settings.transcended ? (index.armorPieces.get(transcendedId(p.id)) ?? p) : p));
    }
    const mine = [...this.customTalismans.talismans().values()];
    const talismans = settings.talismans === 'none' ? [] : settings.talismans === 'mine' ? mine : [...mine, ...index.files.talismans];

    return {
      requirements: settings.requirements,
      skills: index.files.skills,
      armor,
      decorations: index.files.decorations,
      talismans,
      weapon: this.weapon(),
      maxResults: MAX_RESULTS,
      rankBy: settings.rankBy,
    };
  }
}
