import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, Injector, signal } from '@angular/core';
import { Router } from '@angular/router';
import { collectSkillSources, EquipSlot } from '../../core/build/build';
import { ARMOR_KINDS, Decoration, GOGMA_DEVICES, GogmaDevice, Skill, SlotTarget, WeaponKind } from '../../core/models/game-data';
import { ArmorSetRanking, ArmorSetResult, requiredPoints } from '../../core/search/armor-search';
import { SKILL_CATEGORIES, SkillCategory, skillCategory } from '../../core/skills/skill-categories';
import { resolveSkills } from '../../core/skills/skill-resolver';
import { SkillLevelValues, skillLevelValues, sourceText } from '../../core/skills/skill-values';
import { ArmorSearchService, MAX_RESULTS, TalismanPool, TOP_DAMAGE_RESULTS } from '../../data/armor-search.service';
import { CurrentBuildService } from '../../data/current-build.service';
import { CustomWeaponsService } from '../../data/custom-weapons.service';
import { DamageSettingsService } from '../../data/damage-settings.service';
import { GameDataService } from '../../data/game-data.service';
import { WEAPON_KIND_OPTIONS } from '../../shared/labels';
import { SearchSelect, SelectOption } from '../../shared/search-select/search-select';
import {
  DEVICE_LABELS,
  equipmentIcon,
  gogmaGroupOf,
  skillsText,
  weaponIdForOption,
  weaponOptions,
  weaponOptionValue,
} from '../../shared/weapon-options';
import { SkillTip } from '../../shared/skill-tip/skill-tip';
import { ItemRow, ResultView, SetCard } from './set-card/set-card';

const PAGE = 20;

const KIND_LABELS: Record<Skill['kind'], string> = {
  armor: 'Armor skill',
  weapon: 'Weapon skill',
  set: 'Set bonus',
  group: 'Group bonus',
};

const CATEGORY_LABELS = Object.fromEntries(SKILL_CATEGORIES.map((c) => [c.id, c.label])) as Record<SkillCategory, string>;

/** Pick a weapon and skills; find armor sets (with talisman and jewels) that reach them. */
@Component({
  selector: 'app-armor-search',
  imports: [SearchSelect, SkillTip, SetCard],
  templateUrl: './armor-search.html',
  styleUrl: './armor-search.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArmorSearch {
  private readonly data = inject(GameDataService);
  private readonly store = inject(ArmorSearchService);
  private readonly current = inject(CurrentBuildService);
  private readonly customWeapons = inject(CustomWeaponsService);
  private readonly damageSettings = inject(DamageSettingsService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

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
  protected readonly categories = SKILL_CATEGORIES;

  protected readonly shown = signal(PAGE);
  /** Bumped after each pick so the "add skill" box is recreated empty. */
  protected readonly addKey = signal(0);
  /** Category whose skills are listed for browsing; null when collapsed. */
  protected readonly browsing = signal<SkillCategory | null>('attack');

  // ---------------------------------------------------------------- weapon

  protected readonly weaponKindOptions = WEAPON_KIND_OPTIONS;
  protected readonly gogmaDevices = GOGMA_DEVICES;
  protected readonly deviceLabels = DEVICE_LABELS;
  protected readonly weapon = this.store.weapon;
  protected readonly builderWeapon = computed(() => this.current.build().weapon);
  protected readonly weaponOptions = computed<SelectOption[]>(() =>
    weaponOptions(this.settings().weapon.kind, this.index(), [...this.customWeapons.weapons().values()], this.customWeapons.configs()),
  );
  protected readonly weaponValue = computed(() => weaponOptionValue(this.weapon()));
  protected readonly gogmaGroup = computed(() => gogmaGroupOf(this.weapon(), this.index()));
  protected readonly weaponSummary = computed(() => {
    const weapon = this.weapon();
    if (!weapon) return '';
    const slots = weapon.slots.length ? weapon.slots.map((s) => `[${s}]`).join('') : 'no slots';
    return [slots, skillsText(weapon.skills, this.index()?.skills)].filter(Boolean).join(' · ');
  });
  protected readonly canCopyBuilderWeapon = computed(() => {
    const weapon = this.builderWeapon();
    return !!weapon && weapon.id !== this.weapon()?.id;
  });

  // ---------------------------------------------------------------- skills

  private readonly requested = computed(() => new Set(this.settings().requirements.map((r) => r.skillId)));

  /** Skills not picked yet, by name; searchable by category too. */
  protected readonly skillOptions = computed<SelectOption[]>(() =>
    [...(this.index()?.skills.values() ?? [])]
      .filter((s) => !this.requested().has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({
        value: String(s.id),
        label: s.name,
        hint: `${CATEGORY_LABELS[skillCategory(s)]} · ${skillHint(s)}`,
        keywords: s.ranks.map((r) => r.name ?? '').join(' '),
        description: describeSkill(s).join(' '),
      })),
  );

  /** Every skill by category, by name. */
  private readonly skillsByCategory = computed(() => {
    const map = new Map<SkillCategory, Skill[]>();
    for (const skill of [...(this.index()?.skills.values() ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      const category = skillCategory(skill);
      map.set(category, [...(map.get(category) ?? []), skill]);
    }
    return map;
  });

  /** Category chips with how many of their skills are picked. */
  protected readonly categoryChips = computed(() =>
    SKILL_CATEGORIES.map((c) => ({
      ...c,
      picked: (this.skillsByCategory().get(c.id) ?? []).filter((s) => this.requested().has(s.id)).length,
    })),
  );

  protected readonly browseSkills = computed(() => {
    const category = this.browsing();
    return category
      ? (this.skillsByCategory().get(category) ?? []).map((skill) => ({
          skill,
          on: this.requested().has(skill.id),
          weapon: skill.kind === 'weapon',
          description: describeSkill(skill),
          values: levelValues(skill, this.settings().weapon.kind),
        }))
      : [];
  });

  /** Picked skills grouped by category, in category order. */
  protected readonly groups = computed(() => {
    const skills = this.index()?.skills;
    if (!skills) return [];
    const rows = this.settings().requirements.flatMap((req, i) => {
      const skill = skills.get(req.skillId);
      if (!skill) return [];
      const levels = isBonus(skill)
        ? skill.ranks.map((r) => ({ level: r.level, label: `${r.name ?? `Rank ${r.level}`} (${requiredPoints(skill, r.level)} pieces)` }))
        : skill.ranks.map((r) => ({ level: r.level, label: `Lv ${r.level}` }));
      const effect = levelValues(skill, this.settings().weapon.kind)?.levels.find((l) => l.level === req.level)?.text ?? null;
      return [{ i, req, skill, levels, hint: KIND_LABELS[skill.kind], category: skillCategory(skill), effect }];
    });
    return SKILL_CATEGORIES.map((c) => ({ ...c, rows: rows.filter((r) => r.category === c.id) })).filter((g) => g.rows.length);
  });

  /** Weapon skills are requested but only talismans can supply them (no weapon in the search). */
  protected readonly weaponSkillsWithoutWeapon = computed(
    () => !this.weapon() && this.groups().some((g) => g.rows.some((r) => r.skill.kind === 'weapon')),
  );

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

  protected setWeaponKind(kind: string): void {
    if (kind && kind !== this.settings().weapon.kind) this.store.patch({ weapon: { kind: kind as WeaponKind, id: null } });
  }

  protected setWeapon(value: string): void {
    const index = this.index();
    if (index) this.store.patch({ weapon: { kind: this.settings().weapon.kind, id: weaponIdForOption(value, index) } });
  }

  protected setGogmaDevice(device: GogmaDevice): void {
    const weapon = this.gogmaGroup()?.[device];
    if (weapon) this.store.patch({ weapon: { kind: weapon.kind, id: weapon.id } });
  }

  protected copyBuilderWeapon(): void {
    const weapon = this.builderWeapon();
    if (weapon) this.store.patch({ weapon: { kind: weapon.kind, id: weapon.id } });
  }

  protected browse(category: SkillCategory): void {
    this.browsing.update((c) => (c === category ? null : category));
  }

  /** Category chip click: add the skill, or remove it when already picked. */
  protected toggleSkill(skill: Skill): void {
    const i = this.settings().requirements.findIndex((r) => r.skillId === skill.id);
    if (i >= 0) this.removeSkill(i);
    else this.addSkill(skill);
  }

  protected pickSkill(value: string): void {
    this.addKey.update((k) => k + 1);
    // The recreated box starts unfocused; keep focus there for the next skill.
    afterNextRender(() => document.getElementById('search-add-skill')?.focus(), { injector: this.injector });
    const skill = this.index()?.skills.get(Number(value));
    if (skill) this.addSkill(skill);
  }

  private addSkill(skill: Skill): void {
    if (this.requested().has(skill.id)) return;
    // Armor/weapon skills usually wanted maxed; set bonuses start at their first rank.
    const level = isBonus(skill) ? (skill.ranks[0]?.level ?? 1) : skill.maxLevel;
    this.store.patch({ requirements: [...this.settings().requirements, { skillId: skill.id, level }] });
  }

  protected setLevel(i: number, value: string): void {
    this.store.patch({ requirements: this.settings().requirements.map((r, j) => (j === i ? { ...r, level: Number(value) } : r)) });
  }

  protected removeSkill(i: number): void {
    this.store.patch({ requirements: this.settings().requirements.filter((_, j) => j !== i) });
  }

  protected clearSkills(): void {
    this.store.patch({ requirements: [] });
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

  protected readonly sourceText = sourceText;

  /** Source pages, one per line, for a tooltip. */
  protected sourceLinks(researched: NonNullable<SkillLevelValues['researched']>): string {
    return researched.sources.map((s) => `${s.name}: ${s.url}`).join('\n');
  }

  protected seconds(ms: number): string {
    return (ms / 1000).toFixed(ms < 10_000 ? 2 : 0);
  }

  protected percent(fraction: number): number {
    return Math.floor(fraction * 100);
  }

  /** Whole seconds, with minutes past one minute: "12 s", "1 min 5 s". Rounds up (time left) or down (elapsed). */
  protected duration(ms: number, round: 'up' | 'down' = 'up'): string {
    const total = round === 'up' ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
    const minutes = Math.floor(total / 60);
    return minutes ? `${minutes} min ${total % 60} s` : `${total} s`;
  }
}

function isBonus(skill: Skill): boolean {
  return skill.kind === 'set' || skill.kind === 'group';
}

/**
 * What a skill does. Set and group bonuses have no overall description in the
 * data, so each rank's effect is listed instead.
 */
function describeSkill(skill: Skill): string[] {
  if (isBonus(skill)) {
    return skill.ranks.map((r) => `${r.name ?? `Rank ${r.level}`} (${requiredPoints(skill, r.level)} pieces): ${r.description}`);
  }
  return skill.description ? [skill.description] : [];
}

/**
 * Numbers per level for armor and weapon skills; null for set and group bonuses (their
 * ranks are already listed) and for skills where no level states a number.
 */
function levelValues(skill: Skill, weaponKind: WeaponKind): SkillLevelValues | null {
  if (isBonus(skill)) return null;
  const values = skillLevelValues(skill, weaponKind);
  return values.numeric ? values : null;
}


function skillHint(skill: Skill): string {
  if (isBonus(skill)) return skill.ranks.map((r) => r.name).filter(Boolean).join(', ');
  return `${KIND_LABELS[skill.kind]} · max level ${skill.maxLevel}`;
}
