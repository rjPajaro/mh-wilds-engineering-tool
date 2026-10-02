import { computed, inject, Injectable } from '@angular/core';
import { ArtianConfig } from '../core/artian/artian';
import { emptySavedBuild } from '../core/build/build';
import {
  createExport,
  DamageSetup,
  isLoadout,
  Loadout,
  LoadoutContent,
  parseExport,
  sameArtian,
  sameContent,
} from '../core/loadouts/loadout';
import { decodeShareCode, encodeShareCode } from '../core/loadouts/share-code';
import { CustomTalismanConfig, sameTalisman } from '../core/talismans/custom-talisman';
import { isString, persistedSignal } from '../shared/persisted-signal';
import { CurrentBuildService } from './current-build.service';
import { CustomTalismansService } from './custom-talismans.service';
import { CustomWeaponsService } from './custom-weapons.service';
import { DamageSettingsService } from './damage-settings.service';

/** Query parameter that carries a share code: #/builder?b=<code> */
export const SHARE_PARAM = 'b';

/** Named builds ("loadouts") saved in the browser, plus share links and JSON export/import. */
@Injectable({ providedIn: 'root' })
export class LoadoutsService {
  private readonly current = inject(CurrentBuildService);
  private readonly settings = inject(DamageSettingsService);
  private readonly artians = inject(CustomWeaponsService);
  private readonly talismans = inject(CustomTalismansService);

  readonly loadouts = persistedSignal<Loadout[]>('loadouts.v1', [], (v) => Array.isArray(v) && v.every(isLoadout));
  /** The loadout the current build was loaded from or last saved to; '' for none. */
  readonly activeId = persistedSignal('loadouts.active.v1', '', isString);
  readonly active = computed(() => this.loadouts().find((l) => l.id === this.activeId()) ?? null);

  /** The current build, setup and its custom Artian / talisman, as loadout content. */
  readonly currentContent = computed<LoadoutContent>(() => {
    const build = this.current.saved();
    return {
      name: this.active()?.name ?? '',
      weaponKind: this.current.weaponKind(),
      build,
      artian: this.artians.configs().find((c) => c.id === build.weaponId) ?? null,
      talisman: this.talismans.configs().find((c) => c.id === build.talismanId) ?? null,
      setup: this.currentSetup(),
    };
  });

  /** True when the current build differs from the active loadout (or there is none). */
  readonly dirty = computed(() => {
    const active = this.active();
    return !active || !sameContent(this.currentContent(), active);
  });

  /**
   * Work that loading something else would lose: changes to the active loadout,
   * or a non-empty build that was never saved.
   */
  readonly unsaved = computed(() => {
    if (this.active()) return this.dirty();
    const b = this.current.saved();
    return !!b.weaponId || !!b.talismanId || Object.values(b.armor).some(Boolean);
  });

  // ------------------------------------------------------------ saving

  saveAs(name: string): Loadout {
    const now = new Date().toISOString();
    const loadout: Loadout = { ...this.currentContent(), name: name.trim() || 'Untitled build', id: this.newId(), createdAt: now, updatedAt: now };
    this.loadouts.update((list) => [...list, loadout]);
    this.activeId.set(loadout.id);
    return loadout;
  }

  /** Overwrites the active loadout with the current build. */
  save(): void {
    const active = this.active();
    if (!active) return;
    const updated: Loadout = { ...active, ...this.currentContent(), name: active.name, updatedAt: new Date().toISOString() };
    this.loadouts.update((list) => list.map((l) => (l.id === active.id ? updated : l)));
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.loadouts.update((list) => list.map((l) => (l.id === id ? { ...l, name: trimmed, updatedAt: new Date().toISOString() } : l)));
  }

  remove(id: string): void {
    this.loadouts.update((list) => list.filter((l) => l.id !== id));
    if (this.activeId() === id) this.activeId.set('');
  }

  /** Replaces the current build with a saved loadout. */
  load(id: string): void {
    const loadout = this.loadouts().find((l) => l.id === id);
    if (!loadout) return;
    // A local loadout refers to its Artian by id. Keep the Forge's (possibly
    // edited) version; restore the saved copy only if it was deleted.
    if (loadout.artian && !this.artians.configs().some((c) => c.id === loadout.artian!.id)) this.artians.save(loadout.artian);
    // Same for its custom talisman.
    if (loadout.talisman && !this.talismans.configs().some((c) => c.id === loadout.talisman!.id)) this.talismans.save(loadout.talisman);
    this.apply(loadout);
    this.activeId.set(id);
  }

  /** Starts a fresh, unsaved build. */
  detach(): void {
    this.activeId.set('');
  }

  /** Clears the equipment and starts a new, unsaved build. Keeps the weapon type and damage setup. */
  newBuild(): void {
    this.current.saved.set(emptySavedBuild());
    this.detach();
  }

  // ------------------------------------------------------------ sharing

  shareCode(): string {
    return encodeShareCode(this.currentContent());
  }

  /** Full link to the current build, e.g. https://…/#/builder?b=<code> */
  shareUrl(base: Pick<Location, 'origin' | 'pathname'> = location): string {
    return `${base.origin}${base.pathname}#/builder?${SHARE_PARAM}=${this.shareCode()}`;
  }

  /** Decodes a share code (throws ShareCodeError for invalid ones). */
  decode(code: string): LoadoutContent {
    return decodeShareCode(code);
  }

  /** Loads shared content into the Builder as an unsaved build. */
  loadShared(content: LoadoutContent): void {
    this.apply(this.adopt(content));
    this.activeId.set('');
  }

  /** Saves shared content as a new loadout without changing the current build. */
  saveShared(content: LoadoutContent): Loadout {
    const adopted = this.adopt(content);
    const now = new Date().toISOString();
    const loadout: Loadout = { ...adopted, name: adopted.name.trim() || 'Shared build', id: this.newId(), createdAt: now, updatedAt: now };
    this.loadouts.update((list) => [...list, loadout]);
    return loadout;
  }

  // ------------------------------------------------------------ export / import

  exportJson(): string {
    return JSON.stringify(createExport(this.loadouts(), this.artians.configs(), this.talismans.configs()), null, 2);
  }

  /** Adds the loadouts, Artians and talismans from an export file. Throws ImportError for bad files. */
  importJson(text: string): { loadouts: number; artians: number; talismans: number; skipped: number } {
    const file = parseExport(text);
    const artiansBefore = this.artians.configs().length;
    const talismansBefore = this.talismans.configs().length;
    // Artians and talismans first, so loadouts can be pointed at the saved copies.
    const idMap = new Map<string, string>();
    for (const artian of file.artians) idMap.set(artian.id, this.ensureArtian(artian).id);
    for (const talisman of file.talismans) idMap.set(talisman.id, this.ensureTalisman(talisman).id);

    const existingIds = new Set(this.loadouts().map((l) => l.id));
    const added = file.loadouts.map((l) => {
      const adopted = this.adopt(l, idMap);
      return { ...l, ...adopted, id: existingIds.has(l.id) ? this.newId() : l.id };
    });
    this.loadouts.update((list) => [...list, ...added]);
    return {
      loadouts: added.length,
      artians: this.artians.configs().length - artiansBefore,
      talismans: this.talismans.configs().length - talismansBefore,
      skipped: file.skipped,
    };
  }

  // ------------------------------------------------------------ internals

  private currentSetup(): DamageSetup {
    return {
      monsterId: this.settings.monsterId(),
      partIndex: this.settings.partIndex(),
      wounded: this.settings.wounded(),
      toggles: this.settings.toggles(),
    };
  }

  private apply(content: LoadoutContent): void {
    this.current.weaponKind.set(content.weaponKind);
    this.current.saved.set(structuredClone(content.build));
    if (content.setup) {
      this.settings.monsterId.set(content.setup.monsterId);
      this.settings.partIndex.set(content.setup.partIndex);
      this.settings.wounded.set(content.setup.wounded);
      this.settings.toggles.set({ ...content.setup.toggles });
    }
  }

  /** Content from outside brings its own Artian and talisman; see adoptArtian. */
  private adopt(content: LoadoutContent, idMap?: Map<string, string>): LoadoutContent {
    return this.adoptTalisman(this.adoptArtian(content, idMap), idMap);
  }

  /**
   * Content from outside (a share link or import) brings its own Artian. Reuse an
   * identical one already in the Forge, otherwise add it with a fresh id, and point
   * the build at it.
   */
  private adoptArtian(content: LoadoutContent, idMap?: Map<string, string>): LoadoutContent {
    if (!content.artian) return content;
    const mapped = idMap?.get(content.artian.id);
    const artian = mapped ? this.artians.configs().find((c) => c.id === mapped)! : this.ensureArtian(content.artian);
    const build = content.build.weaponId === content.artian.id ? { ...content.build, weaponId: artian.id } : content.build;
    return { ...content, artian, build };
  }

  private ensureArtian(config: ArtianConfig): ArtianConfig {
    const existing = this.artians.configs().find((c) => sameArtian(c, config));
    if (existing) return existing;
    const added = { ...structuredClone(config), id: `custom:${this.artians.newId()}` };
    this.artians.save(added);
    return added;
  }

  /** Like adoptArtian, for the build's custom talisman. */
  private adoptTalisman(content: LoadoutContent, idMap?: Map<string, string>): LoadoutContent {
    if (!content.talisman) return content;
    const mapped = idMap?.get(content.talisman.id);
    const talisman = mapped ? this.talismans.configs().find((c) => c.id === mapped)! : this.ensureTalisman(content.talisman);
    const build = content.build.talismanId === content.talisman.id ? { ...content.build, talismanId: talisman.id } : content.build;
    return { ...content, talisman, build };
  }

  private ensureTalisman(config: CustomTalismanConfig): CustomTalismanConfig {
    const existing = this.talismans.configs().find((c) => sameTalisman(c, config));
    if (existing) return existing;
    const added = { ...structuredClone(config), id: this.talismans.newId() };
    this.talismans.save(added);
    return added;
  }

  private newId(): string {
    return this.artians.newId();
  }
}
