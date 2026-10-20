import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ARMOR_KINDS, SlotTarget } from '../../core/models/game-data';
import { CharmResult } from '../../core/search/charm-search';
import { charmTypeName } from '../../core/talismans/custom-talisman';
import { ArmorSearchService } from '../../data/armor-search.service';
import { CHARM_RESULTS, CharmSearchService, CharmSearchSettings } from '../../data/charm-search.service';
import { GameDataService } from '../../data/game-data.service';
import { SearchProgress } from '../../shared/search-query/search-progress';
import { SearchQuery } from '../../shared/search-query/search-query';
import { CharmCard, CharmView } from './charm-card/charm-card';

/**
 * Pick a weapon and skills; find the appraised charms (random talismans from Glowing Stones)
 * that would let armor and jewels reach them, most likely first.
 */
@Component({
  selector: 'app-charm-search',
  imports: [SearchQuery, SearchProgress, CharmCard],
  templateUrl: './charm-search.html',
  styleUrl: './charm-search.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CharmSearch {
  private readonly data = inject(GameDataService);
  private readonly store = inject(CharmSearchService);
  private readonly armorSearch = inject(ArmorSearchService);
  private readonly router = inject(Router);

  protected readonly index = this.data.index;
  protected readonly loading = this.data.isLoading;
  protected readonly loadError = this.data.error;

  protected readonly settings = this.store.settings;
  protected readonly output = this.store.output;
  protected readonly running = this.store.running;
  protected readonly error = this.store.error;
  protected readonly stale = this.store.stale;
  protected readonly progress = this.store.progress;
  protected readonly maxResults = CHARM_RESULTS;
  protected readonly sheetUpdated = computed(() => this.index()?.files.talismanRolls.sheetUpdated ?? '');

  /** Armor Search has skills that differ from these: offer to copy them. */
  protected readonly armorSearchSkills = computed(() => {
    const theirs = this.armorSearch.settings().requirements;
    return theirs.length && JSON.stringify(theirs) !== JSON.stringify(this.settings().requirements) ? theirs.length : 0;
  });

  /** Charms saved during this visit, by result, so each is saved once. */
  private readonly saved = signal(new Map<CharmResult, string>());

  protected readonly views = computed<CharmView[]>(() => {
    const output = this.output();
    const index = this.index();
    if (!output || !index) return [];
    const weaponKind = this.store.searchedWeapon()?.kind ?? this.settings().weapon.kind;
    const saved = this.saved();
    const slotView = (slots: readonly { level: number; accepts: SlotTarget }[]) => slots.map((s) => ({ level: s.level, target: s.accepts }));
    return output.results.map((charm) => ({
      charm,
      // "At least": a higher roll works as well.
      skills: charm.skills.flatMap((s) => {
        const skill = index.skills.get(s.skillId);
        return skill ? [{ skill, level: s.level, orHigher: s.level < skill.maxLevel }] : [];
      }),
      slots: slotView(charm.slots),
      rarities: charm.rarities.map((r) => ({ rarity: r.rarity, name: charmTypeName(r.rarity), share: r.chance / charm.chance })),
      example: {
        name: charmTypeName(charm.example.rarity),
        rarity: charm.example.rarity,
        skills: charm.example.skills.map((s) => `${index.skills.get(s.skillId)?.name ?? '?'} ${s.level}`).join(' · '),
        slots: slotView(charm.example.slots),
      },
      jewels: (charm.set.decorations.talisman ?? []).flatMap((d) => (d ? [d.name] : [])),
      armor: ARMOR_KINDS.map((kind) => charm.set.armor[kind].name + (charm.set.armor[kind].transcended ? ' (T)' : '')),
      weaponKind,
      saved: saved.has(charm),
    }));
  });

  protected patch(changes: Partial<CharmSearchSettings>): void {
    this.store.patch(changes);
  }

  protected copyFromArmorSearch(): void {
    this.store.copyFromArmorSearch();
  }

  protected search(): void {
    this.store.search();
  }

  protected cancel(): void {
    this.store.cancel();
  }

  /** Saves the charm on the Talismans tab (once per result). */
  protected save(charm: CharmResult): string {
    const existing = this.saved().get(charm);
    if (existing) return existing;
    const id = this.store.saveCharm(charm);
    this.saved.update((m) => new Map(m).set(charm, id));
    return id;
  }

  /** Saves the charm, then shows sets with it on the Armor Search tab. */
  protected findSets(charm: CharmResult): void {
    this.store.findSets(charm, this.save(charm));
    void this.router.navigateByUrl('/search');
  }

  protected seconds(ms: number): string {
    return (ms / 1000).toFixed(ms < 10_000 ? 2 : 0);
  }

  protected percent(fraction: number): number {
    return Math.floor(fraction * 100);
  }
}
