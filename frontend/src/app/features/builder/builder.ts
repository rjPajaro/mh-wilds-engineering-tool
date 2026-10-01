import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  EQUIP_SLOTS,
  EquipSlot,
  emptySavedBuild,
  equippedItem,
  isSavedBuild,
  resolveBuild,
  SavedBuild,
  slotsOf,
  validateDecorations,
} from '../../core/build/build';
import {
  ARMOR_KINDS,
  ArmorKind,
  Decoration,
  GOGMA_DEVICES,
  GogmaDevice,
  SkillLevel,
  SlotTarget,
  Weapon,
  WEAPON_KINDS,
  WeaponKind,
} from '../../core/models/game-data';
import { resolveBuildSkills } from '../../core/skills/skill-resolver';
import { infusionLabel, isCustomWeapon } from '../../core/artian/artian';
import { CustomWeaponsService } from '../../data/custom-weapons.service';
import { GameDataService } from '../../data/game-data.service';
import { WEAPON_KIND_OPTIONS } from '../../shared/labels';
import { persistedSignal } from '../../shared/persisted-signal';
import { SearchSelect, SelectOption } from '../../shared/search-select/search-select';
import { DamagePanel } from './damage-panel/damage-panel';
import { MovesPanel } from './moves-panel/moves-panel';

const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: 'Weapon',
  head: 'Head',
  chest: 'Chest',
  arms: 'Arms',
  waist: 'Waist',
  legs: 'Legs',
  talisman: 'Talisman',
};

const DEVICE_LABELS: Record<GogmaDevice, string> = {
  attack: 'Attack',
  affinity: 'Affinity',
  element: 'Element',
};

@Component({
  selector: 'app-builder',
  imports: [SearchSelect, DamagePanel, MovesPanel],
  templateUrl: './builder.html',
  styleUrl: './builder.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Builder {
  private readonly data = inject(GameDataService);
  private readonly customWeapons = inject(CustomWeaponsService);

  protected readonly index = this.data.index;
  protected readonly loading = this.data.isLoading;
  protected readonly loadError = this.data.error;

  protected readonly equipSlots = EQUIP_SLOTS;
  protected readonly slotLabels = SLOT_LABELS;
  protected readonly weaponKindOptions = WEAPON_KIND_OPTIONS;

  // Persisted across reloads. The build is stored as ids and resolved against
  // current data, so it restores once the data loads and follows Artian edits.
  protected readonly weaponKind = persistedSignal<WeaponKind>('builder.weaponKind.v1', 'long-sword', (v) =>
    WEAPON_KINDS.includes(v as WeaponKind),
  );
  private readonly saved = persistedSignal<SavedBuild>('builder.build.v1', emptySavedBuild(), isSavedBuild);
  protected readonly build = computed(() => {
    const index = this.index();
    const custom = this.customWeapons.weapons();
    if (!index) return resolveBuild(emptySavedBuild(), NO_LOOKUP);
    return resolveBuild(this.saved(), {
      weapon: (id) => custom.get(id) ?? index.weapons.get(id),
      armor: (id) => index.armorPieces.get(id),
      talisman: (id) => index.talismans.get(id),
      decoration: (id) => index.decorations.get(id),
    });
  });

  /**
   * Weapons of the chosen type: the user's saved Artians first, then game data.
   * Each game-data Gogma Artian appears once, keyed by its group id.
   */
  protected readonly weaponOptions = computed<SelectOption[]>(() => {
    const index = this.index();
    const configs = new Map(this.customWeapons.configs().map((c) => [c.id, c]));
    const options: SelectOption[] = this.customWeapons.weaponsOfKind(this.weaponKind()).map((w) => {
      const config = configs.get(w.id)!;
      const tier = config.tier === 'gogma' ? `Gogma · ${DEVICE_LABELS[config.device]} device` : `Artian R${config.rarity}`;
      return {
        value: w.id,
        label: w.name,
        hint: [`My ${tier}`, infusionLabel(config), statText(w), specialText(w)].filter(Boolean).join(' · '),
        keywords: 'my custom artian',
      };
    });
    for (const w of index?.weaponsByKind.get(this.weaponKind()) ?? []) {
      if (w.artian?.tier !== 'gogma') {
        options.push({
          value: w.id,
          label: w.name,
          hint: [`R${w.rarity}`, w.artian ? 'Artian' : '', statText(w), specialText(w), this.skillsText(w.skills)]
            .filter(Boolean)
            .join(' · '),
          keywords: w.series ?? '',
        });
      } else if (w.artian.device === 'attack') {
        const group = index!.gogmaGroups.get(w.artian.groupId)!;
        options.push({
          value: w.artian.groupId,
          label: w.name,
          hint: [`R${w.rarity} · Gogma Artian`, ...GOGMA_DEVICES.map((d) => `${DEVICE_LABELS[d]} ${statText(group[d])}`)].join(' · '),
          keywords: 'artian',
        });
      }
    }
    return options;
  });

  protected readonly gogmaDevices = GOGMA_DEVICES;
  protected readonly deviceLabels = DEVICE_LABELS;
  /** Device variants of the equipped Gogma Artian, or null for any other weapon. */
  protected readonly gogmaGroup = computed(() => {
    const weapon = this.build().weapon;
    if (isCustomWeapon(weapon)) return null; // device is part of the saved config
    const artian = weapon?.artian;
    return artian?.tier === 'gogma' ? (this.index()?.gogmaGroups.get(artian.groupId) ?? null) : null;
  });
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
        }));
    }
    return options;
  });

  protected readonly talismanOptions = computed<SelectOption[]>(() =>
    [...(this.index()?.files.talismans ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ value: t.id, label: t.name, hint: `R${t.rarity} · ${this.skillsText(t.skills)}` })),
  );

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
            .map((d) => ({ value: String(d.id), label: d.name, hint: this.skillsText(d.skills) })),
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
  protected readonly totalDefense = computed(() =>
    ARMOR_KINDS.reduce((sum, kind) => sum + (this.build().armor[kind]?.defense.base ?? 0), 0),
  );

  protected itemName(slot: EquipSlot): string | undefined {
    return equippedItem(this.build(), slot)?.name;
  }

  protected equippedId(slot: EquipSlot): string {
    if (slot === 'weapon') {
      const weapon = this.build().weapon;
      if (isCustomWeapon(weapon)) return weapon!.id;
      return weapon?.artian?.tier === 'gogma' ? weapon.artian.groupId : (weapon?.id ?? '');
    }
    if (slot === 'talisman') return this.build().talisman?.id ?? '';
    return this.build().armor[slot]?.id ?? '';
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
        // A game-data Gogma Artian option is keyed by group id; equip its attack device.
        const weaponId = id ? (index.gogmaGroups.get(id)?.attack.id ?? id) : null;
        return { ...b, weaponId, decorations };
      }
      if (slot === 'talisman') return { ...b, talismanId: id || null, decorations };
      return { ...b, armor: { ...b.armor, [slot]: id || null }, decorations };
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
    const index = this.index();
    return skills
      .map(({ skillId, level }) => ({ skill: index?.skills.get(skillId), level }))
      .filter(({ skill }) => skill && (includeBonuses || (skill.kind !== 'set' && skill.kind !== 'group')))
      .map(({ skill, level }) => `${skill!.name} ${level}`)
      .join(', ');
  }

}

const NO_LOOKUP = { weapon: () => undefined, armor: () => undefined, talisman: () => undefined, decoration: () => undefined };

function statText(w: Weapon): string {
  return `${w.attack} atk${w.affinity ? ` ${w.affinity > 0 ? '+' : ''}${w.affinity}%` : ''}`;
}

function slotText(slots: readonly number[]): string {
  return slots.length ? slots.map((s) => `[${s}]`).join('') : '';
}

function specialText(w: Weapon): string {
  return w.specials
    .map((s) => `${s.hidden ? '(' : ''}${s.kind === 'element' ? s.element : s.status} ${s.value}${s.hidden ? ')' : ''}`)
    .join(' ');
}
