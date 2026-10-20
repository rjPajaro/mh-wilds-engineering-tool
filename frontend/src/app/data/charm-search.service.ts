import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Weapon } from '../core/models/game-data';
import { SkillRequirement } from '../core/search/armor-search';
import { CharmResult, CharmSearchInput, CharmSearchOutput, searchCharms } from '../core/search/charm-search';
import { isBoolean, isObject, persistedSignal } from '../shared/persisted-signal';
import { ArmorSearchService, isSearchWeapon, searchArmor, SearchWeapon } from './armor-search.service';
import { CustomTalismansService } from './custom-talismans.service';
import { CustomWeaponsService } from './custom-weapons.service';
import { GameDataService } from './game-data.service';
import { SearchRunner } from './search-runner';

export interface CharmSearchSettings {
  requirements: SkillRequirement[];
  /** Its skills count and its slots take weapon jewels. id null = no weapon. */
  weapon: SearchWeapon;
  /** Use transcended versions of rarity 5+ armor. */
  transcended: boolean;
}

const DEFAULT_SETTINGS: CharmSearchSettings = { requirements: [], weapon: { kind: 'long-sword', id: null }, transcended: false };
/** Charms listed, and the time limit (it runs one armor search per charm checked). */
export const CHARM_RESULTS = 20;
const TIME_LIMIT_MS = 60_000;

function isSettings(v: unknown): v is CharmSearchSettings {
  return (
    isObject(v) &&
    Array.isArray(v['requirements']) &&
    v['requirements'].every((r) => isObject(r) && typeof r['skillId'] === 'number' && typeof r['level'] === 'number') &&
    isSearchWeapon(v['weapon']) &&
    isBoolean(v['transcended'])
  );
}

/**
 * State of the Charm Search tab: appraised charms (random talismans) that would let armor reach
 * the requested skills. Root-provided so results survive switching tabs; runs in the armor
 * search worker.
 */
@Injectable({ providedIn: 'root' })
export class CharmSearchService {
  private readonly data = inject(GameDataService);
  private readonly customTalismans = inject(CustomTalismansService);
  private readonly customWeapons = inject(CustomWeaponsService);
  private readonly armorSearch = inject(ArmorSearchService);

  readonly settings = persistedSignal<CharmSearchSettings>('charms.settings.v1', DEFAULT_SETTINGS, isSettings);
  readonly output = signal<CharmSearchOutput | null>(null);
  private readonly runner = new SearchRunner<'charms'>();
  readonly running = this.runner.running;
  readonly error = this.runner.error;
  readonly progress = this.runner.progress;
  /** Settings the shown results were found with. */
  readonly searched = signal<CharmSearchSettings | null>(null);
  /** Weapon the shown results were found with. */
  readonly searchedWeapon = signal<Weapon | null>(null);
  /** True when the settings changed after the last search. */
  readonly stale = computed(() => {
    const searched = this.searched();
    return searched !== null && JSON.stringify(searched) !== JSON.stringify(this.settings());
  });

  /** The weapon the search uses; null when none is picked or the id no longer exists. */
  readonly weapon = computed<Weapon | null>(() => {
    const id = this.settings().weapon.id;
    if (!id) return null;
    return this.customWeapons.weapons().get(id) ?? this.data.index()?.weapons.get(id) ?? null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  patch(changes: Partial<CharmSearchSettings>): void {
    this.settings.update((s) => ({ ...s, ...changes }));
  }

  /** Copies the Armor Search tab's skills, weapon and transcended option. */
  copyFromArmorSearch(): void {
    const { requirements, weapon, transcended } = this.armorSearch.settings();
    this.patch({ requirements, weapon, transcended });
  }

  search(): void {
    const index = this.data.index();
    const settings = this.settings();
    if (!index || !settings.requirements.length) return;
    const input: CharmSearchInput = {
      requirements: settings.requirements,
      skills: index.files.skills,
      armor: searchArmor(index, settings.transcended),
      decorations: index.files.decorations,
      weapon: this.weapon(),
      rolls: index.files.talismanRolls,
      maxResults: CHARM_RESULTS,
      timeLimitMs: TIME_LIMIT_MS,
    };
    this.runner.run({ kind: 'charms', input }, () => searchCharms(input), (output) => {
      this.output.set(output as CharmSearchOutput);
      this.searched.set(settings);
      this.searchedWeapon.set(input.weapon);
    });
  }

  cancel(): void {
    this.runner.cancel();
  }

  /**
   * Saves a charm on the Talismans tab as its most likely roll (rarity, the requested skills it
   * has, slots; the other skills it rolls are unknown) and returns the talisman's id.
   */
  saveCharm(charm: CharmResult): string {
    const id = this.customTalismans.newId();
    this.customTalismans.save({
      id,
      name: '',
      rarity: charm.example.rarity,
      skills: charm.example.skills.map((s) => ({ ...s })),
      slots: charm.example.slots.map((s) => ({ ...s })),
    });
    return id;
  }

  /**
   * Saves the charm, then starts an Armor Search with the skills, weapon and armor this search
   * used and only that talisman, so a set with it can be equipped.
   */
  findSets(charm: CharmResult, savedId?: string): string {
    const id = savedId ?? this.saveCharm(charm);
    const searched = this.searched() ?? this.settings();
    this.armorSearch.patch({ requirements: searched.requirements, weapon: searched.weapon, transcended: searched.transcended });
    this.armorSearch.searchWithTalisman(id);
    return id;
  }
}
