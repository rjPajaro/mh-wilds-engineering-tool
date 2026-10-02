import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EQUIP_SLOTS, EquipSlot, emptySavedBuild, equippedItem, slotsOf, validateDecorations } from '../../core/build/build';
import {
  ARMOR_KINDS,
  ArmorKind,
  Decoration,
  GOGMA_DEVICES,
  GogmaDevice,
  SkillLevel,
  SlotTarget,
  Weapon,
  WeaponKind,
} from '../../core/models/game-data';
import { resolveBuildSkills } from '../../core/skills/skill-resolver';
import { isCustomWeapon } from '../../core/artian/artian';
import { baseArmorId, canTranscend, isTranscendedId, transcendedId } from '../../core/armor/transcend';
import { BUFF_GROUPS, BuffGroup, buffedDefense, BuffOption } from '../../core/calc/buffs';
import { CurrentBuildService } from '../../data/current-build.service';
import { DamageSettingsService } from '../../data/damage-settings.service';
import { CustomTalismansService } from '../../data/custom-talismans.service';
import { CustomWeaponsService } from '../../data/custom-weapons.service';
import { GameDataService } from '../../data/game-data.service';
import { WEAPON_KIND_OPTIONS } from '../../shared/labels';
import { SearchSelect, SelectOption } from '../../shared/search-select/search-select';
import { DEVICE_LABELS, equipmentIcon, gogmaGroupOf, skillsText, weaponIdForOption, weaponOptions, weaponOptionValue } from '../../shared/weapon-options';
import { DamagePanel } from './damage-panel/damage-panel';
import { LoadoutBar } from './loadout-bar/loadout-bar';
import { MovesPanel } from './moves-panel/moves-panel';
import { SharedBuildBanner } from './shared-build-banner/shared-build-banner';
import icons from '../../../assets/data/icons.json';

const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: 'Weapon',
  head: 'Head',
  chest: 'Chest',
  arms: 'Arms',
  waist: 'Waist',
  legs: 'Legs',
  talisman: 'Talisman',
};

@Component({
  selector: 'app-builder',
  imports: [SearchSelect, DamagePanel, MovesPanel, LoadoutBar, SharedBuildBanner],
  templateUrl: './builder.html',
  styleUrl: './builder.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Builder {
  private readonly data = inject(GameDataService);
  private readonly customWeapons = inject(CustomWeaponsService);
  private readonly customTalismans = inject(CustomTalismansService);
  private readonly current = inject(CurrentBuildService);
  private readonly damageSettings = inject(DamageSettingsService);

  protected readonly index = this.data.index;
  protected readonly loading = this.data.isLoading;
  protected readonly loadError = this.data.error;

  protected readonly equipSlots = EQUIP_SLOTS;
  protected readonly slotLabels = SLOT_LABELS;
  /** Single items are checkboxes; groups with alternatives (only one applies) are dropdowns. */
  protected readonly buffToggles = BUFF_GROUPS.filter((g) => g.options.length === 1);
  protected readonly buffChoices = BUFF_GROUPS.filter((g) => g.options.length > 1).map((g) => ({
    group: g,
    options: g.options.map((o): SelectOption => ({ value: o.id, label: o.name, hint: buffHint(o) })),
  }));
  protected readonly emptySlotIcons: Record<SlotTarget, Record<string, string>> = icons.emptySlots;
  protected readonly weaponKindOptions = WEAPON_KIND_OPTIONS;

  // Shared with loadouts and persisted across reloads (CurrentBuildService).
  protected readonly weaponKind = this.current.weaponKind;
  private readonly saved = this.current.saved;
  protected readonly build = this.current.build;

  /**
   * Weapons of the chosen type: the user's saved Artians first, then game data.
   * Each game-data Gogma Artian appears once, keyed by its group id.
   */
  protected readonly weaponOptions = computed<SelectOption[]>(() =>
    weaponOptions(this.weaponKind(), this.index(), [...this.customWeapons.weapons().values()], this.customWeapons.configs()),
  );

  protected readonly gogmaDevices = GOGMA_DEVICES;
  protected readonly deviceLabels = DEVICE_LABELS;
  /** Device variants of the equipped Gogma Artian, or null for any other weapon. */
  protected readonly gogmaGroup = computed(() => gogmaGroupOf(this.build().weapon, this.index()));
  protected readonly gogmaDevice = computed(() => {
    const artian = this.build().weapon?.artian;
    return artian?.tier === 'gogma' ? artian.device : null;
  });

  protected readonly armorOptions = computed(() => {
    const index = this.index();
    const options = {} as Record<ArmorKind, SelectOption[]>;
    for (const kind of ARMOR_KINDS) {
      options[kind] = [...(index?.armorByKind[kind] ?? [])]
        .sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name))
        .map((p) => ({
          value: p.id,
          label: p.name,
          hint: [`R${p.rarity}`, slotText(p.slots), this.skillsText(p.skills, false)].filter(Boolean).join(' · '),
          keywords: `${index?.armorSets.get(p.setId)?.name ?? ''} ${this.skillsText(p.skills)}`,
          icon: equipmentIcon(kind, p.rarity),
        }));
    }
    return options;
  });

  /** The player's own talismans (Talismans tab) first, then craftable ones. */
  protected readonly talismanOptions = computed<SelectOption[]>(() => [
    ...[...this.customTalismans.talismans().values()].map((t) => ({
      value: t.id,
      label: t.name,
      hint: ['My talisman', `R${t.rarity}`, this.skillsText(t.skills), slotText(t.slots.map((s) => s.level))].filter(Boolean).join(' · '),
      keywords: 'my custom talisman charm',
      icon: t.thumbnail,
    })),
    ...[...(this.index()?.files.talismans ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ value: t.id, label: t.name, hint: `R${t.rarity} · ${this.skillsText(t.skills)}`, icon: t.thumbnail })),
  ]);

  /** Decoration options per `${target}:${slotLevel}`, each including smaller decorations. */
  private readonly decorationOptionsBySlot = computed(() => {
    const decos = [...(this.index()?.files.decorations ?? [])].sort(
      (a, b) => b.slotLevel - a.slotLevel || a.name.localeCompare(b.name),
    );
    const map = new Map<string, SelectOption[]>();
    for (const target of ['weapon', 'armor'] as const) {
      for (const level of [1, 2, 3]) {
        map.set(
          `${target}:${level}`,
          decos
            .filter((d) => d.allowedOn === target && d.slotLevel <= level)
            .map((d) => ({ value: String(d.id), label: d.name, hint: this.skillsText(d.skills), icon: d.thumbnail })),
        );
      }
    }
    return map;
  });

  protected readonly activeSkills = computed(() => {
    const index = this.index();
    return index ? resolveBuildSkills(this.build(), index.skills) : [];
  });
  protected readonly issues = computed(() => validateDecorations(this.build()));
  /** Armor defense as crafted, and fully upgraded (transcending raises the latter). */
  protected readonly totalDefense = computed(() =>
    ARMOR_KINDS.reduce(
      (sum, kind) => {
        const defense = this.build().armor[kind]?.defense;
        return { base: sum.base + (defense?.base ?? 0), max: sum.max + (defense?.max ?? 0) };
      },
      { base: 0, max: 0 },
    ),
  );
  /** Max defense with item and meal buffs. */
  protected readonly buffedDefense = computed(() => buffedDefense(this.totalDefense().max, this.damageSettings.buffs()));

  protected buffChoice(group: BuffGroup): string {
    return this.damageSettings.buffs()[group.id] ?? group.defaultOption ?? '';
  }

  protected buffHintFor(group: BuffGroup): string {
    return buffHint(group.options[0]);
  }

  protected setBuff(group: BuffGroup, option: string): void {
    this.damageSettings.setBuff(group.id, option);
  }

  protected itemName(slot: EquipSlot): string | undefined {
    return equippedItem(this.build(), slot)?.name;
  }

  // Images their site could not serve (e.g. removed); hidden instead of a broken icon.
  private readonly failedThumbnails = signal<ReadonlySet<string>>(new Set());

  protected thumbnail(slot: EquipSlot): string | null {
    const url = (equippedItem(this.build(), slot) as { thumbnail?: string } | null)?.thumbnail;
    return url && !this.failedThumbnails().has(url) ? url : null;
  }

  /**
   * Skills on the item in `slot`: its set and group bonuses first (`active` once the
   * build has enough pieces), then its own skills with their levels.
   */
  protected itemSkills(slot: EquipSlot): { id: number; name: string; description: string; level: number | null; active: boolean }[] {
    const skills = this.index()?.skills;
    const item = equippedItem(this.build(), slot);
    if (!skills || !item) return [];
    const isBonus = (kind: string) => kind === 'set' || kind === 'group';
    const order = (kind: string) => (kind === 'set' ? 0 : kind === 'group' ? 1 : 2);
    return item.skills
      .map((s) => ({ s, skill: skills.get(s.skillId) }))
      .filter((x) => x.skill)
      .sort((a, b) => order(a.skill!.kind) - order(b.skill!.kind) || b.s.level - a.s.level)
      .map(({ s, skill }) => {
        const bonus = isBonus(skill!.kind);
        return {
          id: skill!.id,
          name: skill!.name,
          description: skill!.description,
          level: bonus ? null : s.level,
          active: bonus && this.activeSkills().some((a) => a.skill.id === skill!.id && a.level > 0),
        };
      });
  }

  protected thumbnailFailed(url: string): void {
    this.failedThumbnails.update((set) => new Set(set).add(url));
  }

  protected equippedId(slot: EquipSlot): string {
    if (slot === 'weapon') return weaponOptionValue(this.build().weapon);
    if (slot === 'talisman') return this.build().talisman?.id ?? '';
    // Transcended pieces share their option with the normal piece.
    return baseArmorId(this.build().armor[slot]?.id ?? '');
  }

  /** Whether the armor in `slot` can be (or is) transcended. */
  protected transcendable(slot: EquipSlot): boolean {
    if (slot === 'weapon' || slot === 'talisman') return false;
    const piece = this.build().armor[slot];
    return !!piece && (!!piece.transcended || canTranscend(piece));
  }

  protected isTranscended(slot: EquipSlot): boolean {
    return slot !== 'weapon' && slot !== 'talisman' && !!this.build().armor[slot]?.transcended;
  }

  /**
   * Switches the armor in `slot` between its normal and transcended version.
   * Decorations stay in place where the new slots still fit them.
   */
  protected setTranscended(slot: ArmorKind, on: boolean): void {
    const index = this.index();
    const id = this.saved().armor[slot];
    if (!index || !id) return;
    const newId = on ? transcendedId(id) : baseArmorId(id);
    const slots = index.armorPieces.get(newId)?.slots ?? [];
    this.saved.update((b) => {
      const decorations = (b.decorations[slot] ?? [])
        .slice(0, slots.length)
        .map((d, i) => (d !== null && (index.decorations.get(d)?.slotLevel ?? 0) <= slots[i] ? d : null));
      return { ...b, armor: { ...b.armor, [slot]: newId }, decorations: { ...b.decorations, [slot]: decorations } };
    });
  }

  protected equipOptions(slot: EquipSlot): readonly SelectOption[] {
    if (slot === 'weapon') return this.weaponOptions();
    if (slot === 'talisman') return this.talismanOptions();
    return this.armorOptions()[slot];
  }

  protected slots(slot: EquipSlot) {
    return slotsOf(this.build(), slot);
  }

  protected decorationId(slot: EquipSlot, i: number): string {
    const deco: Decoration | null | undefined = this.build().decorations[slot]?.[i];
    return deco ? String(deco.id) : '';
  }

  /** The untinted equipment icon shown while `slot` is empty. */
  protected emptyEquipmentIcon(slot: EquipSlot): string | undefined {
    return equipmentIcon(slot === 'weapon' ? this.weaponKind() : slot, 'base');
  }

  protected decorationOptions(accepts: SlotTarget, level: number): readonly SelectOption[] {
    return this.decorationOptionsBySlot().get(`${accepts}:${level}`) ?? [];
  }

  protected setWeaponKind(kind: string): void {
    if (!kind || kind === this.weaponKind()) return;
    this.weaponKind.set(kind as WeaponKind);
    this.saved.update((b) => ({ ...b, weaponId: null, decorations: { ...b.decorations, weapon: [] } }));
  }

  protected equip(slot: EquipSlot, id: string): void {
    const index = this.index();
    if (!index) return;
    this.saved.update((b) => {
      const decorations = { ...b.decorations, [slot]: [] };
      if (slot === 'weapon') {
        return { ...b, weaponId: weaponIdForOption(id, index), decorations };
      }
      if (slot === 'talisman') return { ...b, talismanId: id || null, decorations };
      // Swapping pieces keeps the slot transcended when the new piece can be.
      const piece = id ? index.armorPieces.get(id) : undefined;
      const keep = isTranscendedId(b.armor[slot] ?? '') && piece && canTranscend(piece);
      return { ...b, armor: { ...b.armor, [slot]: keep ? transcendedId(id) : id || null }, decorations };
    });
  }

  /** Swaps the Gogma Artian variant. All variants share slots, so decorations stay. */
  protected setGogmaDevice(device: GogmaDevice): void {
    const weapon = this.gogmaGroup()?.[device];
    if (weapon) this.saved.update((b) => ({ ...b, weaponId: weapon.id }));
  }

  protected setDecoration(slot: EquipSlot, i: number, id: string): void {
    this.saved.update((b) => {
      const list = [...(b.decorations[slot] ?? [])];
      list[i] = id ? Number(id) : null;
      return { ...b, decorations: { ...b.decorations, [slot]: list } };
    });
  }

  protected reset(): void {
    this.saved.set(emptySavedBuild());
  }

  protected pips(level: number, max: number): boolean[] {
    return Array.from({ length: max }, (_, i) => i < level);
  }

  /** "Weakness Exploit 2, Agitator 1"; set/group bonuses only when `includeBonuses`. */
  private skillsText(skills: readonly SkillLevel[], includeBonuses = true): string {
    return skillsText(skills, this.index()?.skills, includeBonuses);
  }

}


function slotText(slots: readonly number[]): string {
  return slots.length ? slots.map((s) => `[${s}]`).join('') : '';
}

function buffHint(o: BuffOption): string {
  return [
    o.attack ? `+${o.attack} attack` : '',
    o.defense ? `+${o.defense} defense` : '',
    o.defenseMultiplier ? `defense ×${o.defenseMultiplier}` : '',
    o.foodSkills?.join(', ') ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
}
