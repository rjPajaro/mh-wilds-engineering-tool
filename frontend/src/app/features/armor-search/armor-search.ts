import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { collectSkillSources, EquipSlot } from '../../core/build/build';
import { ARMOR_KINDS, Decoration, SlotTarget } from '../../core/models/game-data';
import { ArmorSetRanking, ArmorSetResult } from '../../core/search/armor-search';
import { resolveSkills } from '../../core/skills/skill-resolver';
import { ArmorSearchService, ArmorSearchSettings, MAX_RESULTS, TalismanPool, TOP_DAMAGE_RESULTS } from '../../data/armor-search.service';
import { DamageSettingsService } from '../../data/damage-settings.service';
import { GameDataService } from '../../data/game-data.service';
import { SearchProgress } from '../../shared/search-query/search-progress';
import { SearchQuery } from '../../shared/search-query/search-query';
import { equipmentIcon } from '../../shared/weapon-options';
import { ItemRow, ResultView, SetCard } from './set-card/set-card';

const PAGE = 20;

/** Pick a weapon and skills; find armor sets (with talisman and jewels) that reach them. */
@Component({
  selector: 'app-armor-search',
  imports: [SearchQuery, SearchProgress, SetCard],
  templateUrl: './armor-search.html',
  styleUrl: './armor-search.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArmorSearch {
  private readonly data = inject(GameDataService);
  private readonly store = inject(ArmorSearchService);
  private readonly damageSettings = inject(DamageSettingsService);
  private readonly router = inject(Router);

  protected readonly index = this.data.index;
  protected readonly loading = this.data.isLoading;
  protected readonly loadError = this.data.error;

  protected readonly settings = this.store.settings;
  protected readonly output = this.store.output;
  protected readonly running = this.store.running;
  protected readonly error = this.store.error;
  protected readonly stale = this.store.stale;
  protected readonly mode = this.store.mode;
  protected readonly progress = this.store.progress;
  /** Search the results column is about: the running one, else the one the results came from. */
  protected readonly shownMode = computed(() => this.progress()?.kind ?? (this.output() ? this.mode() : 'sets'));
  protected readonly topDamage = TOP_DAMAGE_RESULTS;
  protected readonly maxResults = MAX_RESULTS;
  protected readonly shown = signal(PAGE);
  protected readonly weapon = this.store.weapon;

  // ---------------------------------------------------------------- results

  /** Skill combinations the highest-damage search checked; 0 for a skill search. */
  protected readonly checks = computed(() => {
    const output = this.output();
    return output && 'checks' in output ? output.checks : 0;
  });

  /** What damage is measured against: the Damage panel's target part, or a neutral weak point. */
  protected readonly damageTarget = computed(() => {
    const monster = this.damageSettings.monster();
    const part = this.damageSettings.part();
    return monster && part ? `${monster.name} (${part.name})` : 'a neutral weak point (hitzone 100)';
  });

  protected readonly views = computed<ResultView[]>(() => {
    const output = this.output();
    const index = this.index();
    if (!output || !index) return [];
    const requested = new Set(this.store.searchedRequirements().map((r) => r.skillId));
    const weapon = this.store.searchedWeapon();
    return output.results.slice(0, this.shown()).map((result) => {
      const build = { weapon, armor: result.armor, talisman: result.talisman, decorations: result.decorations };
      const rows: ItemRow[] = [];
      const row = (slot: EquipSlot, name: string, slots: { level: number; accepts: SlotTarget }[], icon?: string, alternatives: string[] = []) => {
        const jewels = result.decorations[slot] ?? [];
        rows.push({
          slot,
          name,
          icon,
          alternatives,
          jewels: jewels.filter((d): d is Decoration => d !== null),
          free: slots.filter((_, i) => !jewels[i]).map((s) => ({ level: s.level, target: s.accepts })),
        });
      };
      if (weapon) {
        row('weapon', weapon.name, weapon.slots.map((level) => ({ level, accepts: 'weapon' as const })), equipmentIcon(weapon.kind, weapon.rarity));
      }
      for (const kind of ARMOR_KINDS) {
        const piece = result.armor[kind];
        row(
          kind,
          piece.name + (piece.transcended ? ' (T)' : ''),
          piece.slots.map((level) => ({ level, accepts: 'armor' as const })),
          equipmentIcon(kind, piece.rarity),
          result.alternatives[kind].map((p) => p.name),
        );
      }
      if (result.talisman) row('talisman', result.talisman.name, result.talisman.slots, result.talisman.thumbnail);

      const skills = resolveSkills(collectSkillSources(build), index.skills)
        .filter((s) => s.level > 0)
        .map((s) => ({
          name: s.rankName ?? s.skill.name,
          level: s.level,
          requested: requested.has(s.skill.id),
          skill: s.skill,
        }))
        .sort((a, b) => Number(b.requested) - Number(a.requested));
      return {
        result,
        weaponKind: weapon?.kind ?? this.settings().weapon.kind,
        rows,
        skills,
        freeSlots: [
          ...result.freeSlots.armor.map((level) => ({ level, target: 'armor' as const })),
          ...result.freeSlots.weapon.map((level) => ({ level, target: 'weapon' as const })),
        ],
      };
    });
  });

  // ---------------------------------------------------------------- actions

  protected patch(changes: Partial<ArmorSearchSettings>): void {
    this.store.patch(changes);
  }

  protected setTranscended(value: boolean): void {
    this.store.patch({ transcended: value });
  }

  protected setTalismans(value: string): void {
    this.store.patch({ talismans: value as TalismanPool });
  }

  protected setRankBy(value: string): void {
    this.store.patch({ rankBy: value as ArmorSetRanking });
    // Re-rank right away; the search takes well under a second for most requests.
    if (this.output() && this.mode() === 'sets' && !this.running()) this.search();
  }

  protected search(): void {
    this.shown.set(PAGE);
    this.store.search();
  }

  protected searchDamage(): void {
    this.shown.set(PAGE);
    this.store.searchDamage();
  }

  protected cancel(): void {
    this.store.cancel();
  }

  protected showMore(): void {
    this.shown.update((n) => n + PAGE);
  }

  protected equip(result: ArmorSetResult): void {
    this.store.equip(result);
    void this.router.navigateByUrl('/builder');
  }

  protected seconds(ms: number): string {
    return (ms / 1000).toFixed(ms < 10_000 ? 2 : 0);
  }

  protected percent(fraction: number): number {
    return Math.floor(fraction * 100);
  }
}
