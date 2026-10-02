import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SlotTarget, TalismanSlot } from '../../core/models/game-data';
import {
  buildCustomTalisman,
  CHARM_TYPES,
  CustomTalismanConfig,
  MAX_TALISMAN_SKILLS,
  MAX_TALISMAN_SLOTS,
  newCustomTalisman,
  talismanSummary,
  validateCustomTalisman,
} from '../../core/talismans/custom-talisman';
import { CurrentBuildService } from '../../data/current-build.service';
import { CustomTalismansService } from '../../data/custom-talismans.service';
import { GameDataService } from '../../data/game-data.service';
import { SearchSelect, SelectOption } from '../../shared/search-select/search-select';
import icons from '../../../assets/data/icons.json';

const CHARM_ICONS: Record<string, string> = icons.charms;
const SLOT_ICONS: Record<SlotTarget, Record<string, string>> = icons.emptySlots;

/** Enter talismans you rolled (appraised charms) so the Builder can use them. */
@Component({
  selector: 'app-talismans',
  imports: [SearchSelect],
  templateUrl: './talismans.html',
  styleUrl: './talismans.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Talismans {
  private readonly data = inject(GameDataService);
  private readonly store = inject(CustomTalismansService);
  private readonly current = inject(CurrentBuildService);
  private readonly router = inject(Router);

  protected readonly index = this.data.index;
  protected readonly loading = this.data.isLoading;
  protected readonly loadError = this.data.error;

  protected readonly charmTypes = CHARM_TYPES;
  protected readonly charmIcons = CHARM_ICONS;
  protected readonly slotIcons = SLOT_ICONS;
  protected readonly maxSkills = MAX_TALISMAN_SKILLS;
  protected readonly maxSlots = MAX_TALISMAN_SLOTS;
  protected readonly slotLevels = [1, 2, 3];

  protected readonly configs = this.store.configs;
  /** The talisman being edited; null when nothing is open. */
  protected readonly draft = signal<CustomTalismanConfig | null>(null);
  protected readonly confirmDelete = signal(false);

  protected readonly saved = computed(() => this.configs().find((c) => c.id === this.draft()?.id) ?? null);
  protected readonly dirty = computed(() => JSON.stringify(this.saved()) !== JSON.stringify(this.draft()));
  protected readonly issues = computed(() => {
    const draft = this.draft();
    const skills = this.index()?.skills;
    return draft && skills ? validateCustomTalisman(draft, skills) : [];
  });
  protected readonly valid = computed(() => !this.issues().some((i) => i.severity === 'error'));

  /** Skills a talisman can roll: armor and weapon skills (not set/group bonuses), by name. */
  protected readonly skillOptions = computed<SelectOption[]>(() =>
    [...(this.index()?.skills.values() ?? [])]
      .filter((s) => s.kind === 'armor' || s.kind === 'weapon')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ value: String(s.id), label: s.name, hint: `${s.kind === 'weapon' ? 'Weapon' : 'Armor'} skill · max level ${s.maxLevel}` })),
  );

  protected summary(config: CustomTalismanConfig): string {
    const skills = this.index()?.skills;
    return skills ? talismanSummary(config, skills) : '';
  }

  protected displayName(config: CustomTalismanConfig): string {
    const skills = this.index()?.skills;
    return (skills && buildCustomTalisman(config, skills)?.name) || config.name || 'Invalid talisman';
  }

  protected maxLevel(skillId: number): number {
    return this.index()?.skills.get(skillId)?.maxLevel ?? 1;
  }

  protected levels(skillId: number): number[] {
    return Array.from({ length: this.maxLevel(skillId) }, (_, i) => i + 1);
  }

  protected newTalisman(): void {
    this.draft.set(newCustomTalisman(this.store.newId()));
    this.confirmDelete.set(false);
  }

  protected edit(config: CustomTalismanConfig): void {
    this.draft.set(structuredClone(config));
    this.confirmDelete.set(false);
  }

  protected patch(changes: Partial<CustomTalismanConfig>): void {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
  }

  protected setRarity(value: string): void {
    this.patch({ rarity: Number(value) });
  }

  protected addSkill(): void {
    const draft = this.draft();
    if (!draft || draft.skills.length >= MAX_TALISMAN_SKILLS) return;
    const taken = new Set(draft.skills.map((s) => s.skillId));
    const first = this.skillOptions().find((o) => !taken.has(Number(o.value)));
    if (first) this.patch({ skills: [...draft.skills, { skillId: Number(first.value), level: 1 }] });
  }

  protected setSkill(i: number, value: string): void {
    const draft = this.draft();
    if (!draft || !value) return;
    const skillId = Number(value);
    this.patch({
      skills: draft.skills.map((s, j) => (j === i ? { skillId, level: Math.min(s.level, this.maxLevel(skillId)) } : s)),
    });
  }

  protected setSkillLevel(i: number, value: string): void {
    const draft = this.draft();
    if (draft) this.patch({ skills: draft.skills.map((s, j) => (j === i ? { ...s, level: Number(value) } : s)) });
  }

  protected removeSkill(i: number): void {
    const draft = this.draft();
    if (draft) this.patch({ skills: draft.skills.filter((_, j) => j !== i) });
  }

  protected addSlot(accepts: SlotTarget): void {
    const draft = this.draft();
    if (draft && draft.slots.length < MAX_TALISMAN_SLOTS) this.patch({ slots: [...draft.slots, { level: 1, accepts }] });
  }

  protected setSlot(i: number, changes: Partial<TalismanSlot>): void {
    const draft = this.draft();
    if (draft) this.patch({ slots: draft.slots.map((s, j) => (j === i ? { ...s, ...changes } : s)) });
  }

  protected removeSlot(i: number): void {
    const draft = this.draft();
    if (draft) this.patch({ slots: draft.slots.filter((_, j) => j !== i) });
  }

  protected save(): void {
    const draft = this.draft();
    if (draft && this.valid()) this.store.save(structuredClone(draft));
  }

  protected revert(): void {
    const saved = this.saved();
    if (saved) this.draft.set(structuredClone(saved));
  }

  protected remove(): void {
    const draft = this.draft();
    if (!draft) return;
    this.store.remove(draft.id);
    // A build using it would point at nothing; empty the slot instead.
    if (this.current.saved().talismanId === draft.id) {
      this.current.saved.update((b) => ({ ...b, talismanId: null, decorations: { ...b.decorations, talisman: [] } }));
    }
    this.draft.set(null);
    this.confirmDelete.set(false);
  }

  /** Saves, puts the talisman in the current build and opens the Builder. */
  protected equip(): void {
    const draft = this.draft();
    if (!draft || !this.valid()) return;
    this.store.save(structuredClone(draft));
    this.current.saved.update((b) => ({ ...b, talismanId: draft.id, decorations: { ...b.decorations, talisman: [] } }));
    void this.router.navigateByUrl('/builder');
  }
}
