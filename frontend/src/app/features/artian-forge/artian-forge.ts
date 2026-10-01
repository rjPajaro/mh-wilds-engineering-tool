import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  allowedLevels,
  ArtianConfig,
  buildArtianWeapon,
  infusionLabel,
  newArtianConfig,
  PartBonus,
  Reinforcement,
  REINFORCEMENT_TYPES,
  ReinforcementType,
} from '../../core/artian/artian';
import { ARTIAN_ELEMENTS, GOGMA_DEVICES, GogmaDevice, ReinforcementLevel, SHARPNESS_COLORS, WeaponKind } from '../../core/models/game-data';
import { CustomWeaponsService } from '../../data/custom-weapons.service';
import { GameDataService } from '../../data/game-data.service';
import { capitalize, WEAPON_KIND_OPTIONS, weaponKindLabel } from '../../shared/labels';
import { isObject, persistedSignal } from '../../shared/persisted-signal';
import { SearchSelect, SelectOption } from '../../shared/search-select/search-select';

/** Wilds displays element and status at 10x their true value. */
const ELEMENT_DISPLAY_SCALE = 10;

const ELEMENT_OPTIONS: SelectOption[] = [
  { value: '', label: 'None (all parts differ)' },
  ...ARTIAN_ELEMENTS.map((e) => ({
    value: e,
    label: capitalize(e),
    hint: ['poison', 'paralysis', 'sleep', 'blast'].includes(e) ? 'Status' : 'Element',
  })),
];

const REINFORCEMENT_LABELS: Record<ReinforcementType, string> = {
  attack: 'Attack',
  affinity: 'Affinity',
  element: 'Element',
  sharpness: 'Sharpness',
  ammo: 'Ammo capacity',
};

@Component({
  selector: 'app-artian-forge',
  imports: [SearchSelect],
  templateUrl: './artian-forge.html',
  styleUrl: './artian-forge.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArtianForge {
  private readonly data = inject(GameDataService);
  private readonly store = inject(CustomWeaponsService);

  protected readonly index = this.data.index;
  protected readonly loading = this.data.isLoading;
  protected readonly loadError = this.data.error;

  protected readonly kindOptions = WEAPON_KIND_OPTIONS;
  protected readonly elementOptions = ELEMENT_OPTIONS;
  protected readonly devices = GOGMA_DEVICES;
  protected readonly sharpnessColors = SHARPNESS_COLORS;
  protected readonly displayScale = ELEMENT_DISPLAY_SCALE;
  protected readonly partIndexes = [0, 1, 2];
  protected readonly capitalize = capitalize;
  protected readonly kindLabel = weaponKindLabel;
  protected readonly infusionLabel = infusionLabel;

  protected readonly configs = this.store.configs;
  /** The weapon being edited, including unsaved changes; persisted across reloads. */
  protected readonly draft = persistedSignal<ArtianConfig | null>('forge.draft.v1', null, (v) =>
    v === null || (isObject(v) && typeof v['id'] === 'string' && Array.isArray(v['partBonuses']) && Array.isArray(v['reinforcements'])),
  );
  protected readonly confirmDelete = signal(false);

  protected readonly result = computed(() => {
    const draft = this.draft();
    const index = this.index();
    return draft && index ? buildArtianWeapon(draft, index) : null;
  });

  protected readonly saved = computed(() => this.configs().find((c) => c.id === this.draft()?.id) ?? null);
  protected readonly dirty = computed(() => JSON.stringify(this.saved()) !== JSON.stringify(this.draft()));

  /** Base stats per saved config, for the list. */
  protected readonly savedWeapons = this.store.weapons;

  protected readonly reinforcementTypeOptions = computed<SelectOption[]>(() => {
    const draft = this.draft();
    if (!draft) return [];
    const ranged = ['bow', 'light-bowgun', 'heavy-bowgun'].includes(draft.kind);
    const bowgun = draft.kind === 'light-bowgun' || draft.kind === 'heavy-bowgun';
    return [
      { value: '', label: '— Empty —' },
      ...REINFORCEMENT_TYPES.filter((t) => (t === 'sharpness' ? !ranged : t === 'ammo' ? bowgun : true)).map((t) => ({
        value: t,
        label: REINFORCEMENT_LABELS[t],
      })),
    ];
  });

  protected readonly setSkillOptions = computed(() => this.bonusSkillOptions('set'));
  protected readonly groupSkillOptions = computed(() => this.bonusSkillOptions('group'));

  protected newWeapon(tier: 'artian' | 'gogma'): void {
    const kind = this.draft()?.kind ?? 'great-sword';
    this.draft.set(newArtianConfig(kind, tier, this.store.newId()));
    this.confirmDelete.set(false);
  }

  protected edit(config: ArtianConfig): void {
    this.draft.set(structuredClone(config));
    this.confirmDelete.set(false);
  }

  protected save(): void {
    const draft = this.draft();
    if (draft) this.store.save(draft);
  }

  protected revert(): void {
    const saved = this.saved();
    this.draft.set(saved ? structuredClone(saved) : null);
  }

  protected remove(): void {
    const draft = this.draft();
    if (!draft) return;
    this.store.remove(draft.id);
    this.draft.set(null);
    this.confirmDelete.set(false);
  }

  protected patch(changes: Partial<ArtianConfig>): void {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
  }

  protected setTier(tier: 'artian' | 'gogma'): void {
    // Regular Artians only roll level I reinforcements.
    this.draft.update((d) =>
      d && {
        ...d,
        tier,
        rarity: tier === 'gogma' ? 8 : d.rarity,
        reinforcements: tier === 'artian' ? d.reinforcements.map((r) => ({ ...r, level: 'I' as const })) : d.reinforcements,
      },
    );
  }

  protected setKind(kind: string): void {
    if (kind) this.patch({ kind: kind as WeaponKind });
  }

  protected setElement(value: string): void {
    this.patch({ element: (value || null) as ArtianConfig['element'] });
  }

  protected setPartBonus(i: number, bonus: PartBonus): void {
    this.draft.update((d) => d && { ...d, partBonuses: d.partBonuses.map((b, j) => (j === i ? bonus : b)) });
  }

  protected setDevice(device: GogmaDevice): void {
    this.patch({ device });
  }

  /** Five editable rows; empty rows are not stored. */
  protected reinforcementRows(): (Reinforcement | null)[] {
    const list = this.draft()?.reinforcements ?? [];
    return Array.from({ length: 5 }, (_, i) => list[i] ?? null);
  }

  protected setReinforcementType(i: number, type: string): void {
    this.updateRows(i, type ? { type: type as ReinforcementType, level: this.levelsFor(type as ReinforcementType)[0] ?? 'I' } : null);
  }

  protected setReinforcementLevel(i: number, level: ReinforcementLevel): void {
    const row = this.reinforcementRows()[i];
    if (row) this.updateRows(i, { ...row, level });
  }

  protected levelsFor(type: ReinforcementType): ReinforcementLevel[] {
    const draft = this.draft();
    const index = this.index();
    return draft && index ? allowedLevels(type, draft.tier, index.files.artian, draft.kind) : ['I'];
  }

  protected setSkill(field: 'setSkillId' | 'groupSkillId', value: string): void {
    this.patch({ [field]: value ? Number(value) : null });
  }

  protected skillName(id: number | null): string {
    return id === null ? '' : (this.index()?.skills.get(id)?.name ?? '');
  }

  protected barWidth(hits: number, bar: readonly number[]): number {
    const total = bar.reduce((a, b) => a + b, 0);
    return total ? (hits / total) * 100 : 0;
  }

  private updateRows(i: number, row: Reinforcement | null): void {
    const rows = this.reinforcementRows();
    rows[i] = row;
    this.patch({ reinforcements: rows.filter((r): r is Reinforcement => r !== null) });
  }

  private bonusSkillOptions(kind: 'set' | 'group'): SelectOption[] {
    return [
      { value: '', label: '— None —' },
      ...[...(this.index()?.files.skills ?? [])]
        .filter((s) => s.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({
          value: String(s.id),
          label: s.name,
          hint: s.ranks.map((r) => `${r.piecesRequired}pc ${r.name ?? ''}`.trim()).join(' · '),
        })),
    ];
  }
}
