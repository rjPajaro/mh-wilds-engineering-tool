import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { transcendedId } from '../core/armor/transcend';
import { EquipSlot } from '../core/build/build';
import { ARMOR_KINDS, ArmorKind, ArmorPiece, Decoration, Weapon, WEAPON_KINDS, WeaponKind } from '../core/models/game-data';
import {
  ArmorSearchInput,
  ArmorSearchOutput,
  ArmorSetRanking,
  ArmorSetResult,
  DEFAULT_TIME_LIMIT_MS,
  searchArmorSets,
  SearchProgress,
  SkillRequirement,
} from '../core/search/armor-search';
import { DamageSearchOutput, searchDamageSets } from '../core/search/damage-search';
import type { ArmorSearchMessage, ArmorSearchRequest } from '../features/armor-search/armor-search.worker';
import { isBoolean, isObject, persistedSignal } from '../shared/persisted-signal';
import { CurrentBuildService } from './current-build.service';
import { CustomWeaponsService } from './custom-weapons.service';
import { CustomTalismansService } from './custom-talismans.service';
import { DamageSettingsService } from './damage-settings.service';
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
/** Sets the highest-damage search returns. */
export const TOP_DAMAGE_RESULTS = 5;
/** The highest-damage search runs many armor searches; it gets more time than one. */
const DAMAGE_TIME_LIMIT_MS = 60_000;

/** Which search the shown results come from: skill levels (ranked by rankBy) or highest damage. */
export type SearchMode = 'sets' | 'damage';

/** A running search's progress, for the progress bar. */
export interface SearchProgressView {
  kind: SearchMode;
  /** 0 to 1; an estimate. */
  fraction: number;
  phase: string;
  elapsedMs: number;
  /**
   * Estimated time left: elapsed time scaled by the share still to do, capped by the
   * time limit. Null until there is enough to go on.
   */
  remainingMs: number | null;
}

/** The time-left estimate waits for this much progress and time. */
const ESTIMATE_AFTER_FRACTION = 0.05;
const ESTIMATE_AFTER_MS = 1_000;
const TICK_MS = 250;

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
  private readonly damageSettings = inject(DamageSettingsService);

  readonly settings = persistedSignal<ArmorSearchSettings>('search.settings.v1', DEFAULT_SETTINGS, isSettings);
  readonly output = signal<ArmorSearchOutput | DamageSearchOutput | null>(null);
  /** Search the shown results come from. */
  readonly mode = signal<SearchMode>('sets');
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
  private ticker: ReturnType<typeof setInterval> | null = null;
  private readonly runInfo = signal<{ kind: SearchMode; startedAt: number; timeLimitMs: number } | null>(null);
  private readonly latest = signal<SearchProgress | null>(null);
  /** Ticks while a search runs so elapsed time and the estimate stay current between messages. */
  private readonly now = signal(Date.now());

  /** Progress of the running search; null when none runs. */
  readonly progress = computed<SearchProgressView | null>(() => {
    const info = this.runInfo();
    if (!this.running() || !info) return null;
    const latest = this.latest();
    const fraction = latest?.fraction ?? 0;
    const elapsedMs = Math.max(0, this.now() - info.startedAt);
    const estimate =
      fraction >= ESTIMATE_AFTER_FRACTION && elapsedMs >= ESTIMATE_AFTER_MS ? (elapsedMs * (1 - fraction)) / fraction : null;
    return {
      kind: info.kind,
      fraction,
      phase: latest?.phase ?? 'Starting',
      elapsedMs,
      remainingMs: estimate === null ? null : Math.max(0, Math.min(estimate, info.timeLimitMs - elapsedMs)),
    };
  });

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

  /** Sets that reach the requested skills, ranked by `rankBy`. */
  search(): void {
    const input = this.buildInput();
    if (input) this.run({ kind: 'sets', input });
  }

  /**
   * The highest-damage sets for the picked weapon: damage skills raised on top of
   * the requested ones, scored with the Builder's Damage panel target, conditions
   * and buffs. Needs a weapon; the requested skills may be empty.
   */
  searchDamage(): void {
    const base = this.buildInput(true);
    const weapon = base?.weapon;
    if (!base || !weapon) return;
    this.run({
      kind: 'damage',
      input: {
        requirements: base.requirements,
        skills: base.skills,
        armor: base.armor,
        decorations: base.decorations,
        talismans: base.talismans,
        weapon,
        toggles: this.damageSettings.toggles(),
        buffs: this.damageSettings.buffEffects(),
        target: this.damageSettings.target(),
        targetInflictsFrenzy: this.damageSettings.inflictsFrenzy(),
        maxResults: TOP_DAMAGE_RESULTS,
        timeLimitMs: DAMAGE_TIME_LIMIT_MS,
      },
    });
  }

  private run(request: ArmorSearchRequest): void {
    const input = request.input;
    this.cancel();
    const id = ++this.runId;
    const settings = this.settings();
    this.running.set(true);
    this.error.set(null);
    this.latest.set(null);
    this.now.set(Date.now());
    this.runInfo.set({ kind: request.kind, startedAt: Date.now(), timeLimitMs: input.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS });
    this.ticker = setInterval(() => this.now.set(Date.now()), TICK_MS);
    const done = (output: ArmorSearchOutput | null, error?: string) => {
      if (id !== this.runId) return;
      this.stop();
      if (output) {
        this.output.set(output);
        this.mode.set(request.kind);
        this.searched.set(settings);
        this.searchedWeapon.set(input.weapon);
      } else {
        this.error.set(error ?? 'The search failed.');
      }
    };

    if (typeof Worker === 'undefined') {
      setTimeout(() => {
        try {
          done(request.kind === 'damage' ? searchDamageSets(request.input) : searchArmorSets(request.input));
        } catch (e) {
          done(null, String(e));
        }
      });
      return;
    }
    this.worker = new Worker(new URL('../features/armor-search/armor-search.worker', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<ArmorSearchMessage>) => {
      if (data.type === 'done') done(data.output);
      else if (id === this.runId) {
        this.latest.set(data.progress);
        this.now.set(Date.now());
      }
    };
    this.worker.onerror = (event) => done(null, event.message);
    this.worker.postMessage(request);
  }

  cancel(): void {
    this.runId++;
    this.stop();
  }

  private stop(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
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

  /** Search input from the settings; null without data, or without requirements unless `allowEmpty`. */
  private buildInput(allowEmpty = false): ArmorSearchInput | null {
    const index = this.data.index();
    const settings = this.settings();
    if (!index || (!allowEmpty && !settings.requirements.length)) return null;

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
