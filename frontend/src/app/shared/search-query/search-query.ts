import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, Injector, input, model, signal } from '@angular/core';
import { GOGMA_DEVICES, GogmaDevice, Skill, Weapon, WeaponKind } from '../../core/models/game-data';
import { requiredPoints, SkillRequirement } from '../../core/search/armor-search';
import { SKILL_CATEGORIES, SkillCategory, skillCategory } from '../../core/skills/skill-categories';
import { SkillLevelValues, skillLevelValues, sourceText } from '../../core/skills/skill-values';
import type { SearchWeapon } from '../../data/armor-search.service';
import { CurrentBuildService } from '../../data/current-build.service';
import { CustomWeaponsService } from '../../data/custom-weapons.service';
import { GameDataService } from '../../data/game-data.service';
import { WEAPON_KIND_OPTIONS } from '../labels';
import { SearchSelect, SelectOption } from '../search-select/search-select';
import { SkillTip } from '../skill-tip/skill-tip';
import { DEVICE_LABELS, gogmaGroupOf, skillsText, weaponIdForOption, weaponOptions, weaponOptionValue } from '../weapon-options';

const KIND_LABELS: Record<Skill['kind'], string> = {
  armor: 'Armor skill',
  weapon: 'Weapon skill',
  set: 'Set bonus',
  group: 'Group bonus',
};

const CATEGORY_LABELS = Object.fromEntries(SKILL_CATEGORIES.map((c) => [c.id, c.label])) as Record<SkillCategory, string>;

/**
 * The query side of a search tab: weapon picker and requested skills (`.query`, with the tab's
 * own options and buttons projected at the end), and the skill browser (`.browser`). The host has
 * `display: contents`, so both are items of the tab's layout grid (areas `query` and `browser`).
 */
@Component({
  selector: 'app-search-query',
  imports: [SearchSelect, SkillTip],
  templateUrl: './search-query.html',
  styleUrl: './search-query.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchQuery {
  private readonly data = inject(GameDataService);
  private readonly current = inject(CurrentBuildService);
  private readonly customWeapons = inject(CustomWeaponsService);
  private readonly injector = inject(Injector);

  readonly requirements = model.required<SkillRequirement[]>();
  readonly searchWeapon = model.required<SearchWeapon>();
  /** Shown while no skill is picked: what the tab does with them. */
  readonly emptyText = input('');

  protected readonly index = this.data.index;
  /** Bumped after each pick so the "add skill" box is recreated empty. */
  protected readonly addKey = signal(0);
  /** Category whose skills are listed for browsing; null when collapsed. */
  protected readonly browsing = signal<SkillCategory | null>('attack');

  // ---------------------------------------------------------------- weapon

  protected readonly weaponKindOptions = WEAPON_KIND_OPTIONS;
  protected readonly gogmaDevices = GOGMA_DEVICES;
  protected readonly deviceLabels = DEVICE_LABELS;
  private readonly kind = computed(() => this.searchWeapon().kind);
  /** The picked weapon; null when none is picked or the id no longer exists. */
  protected readonly weapon = computed<Weapon | null>(() => {
    const id = this.searchWeapon().id;
    return id ? (this.customWeapons.weapons().get(id) ?? this.index()?.weapons.get(id) ?? null) : null;
  });
  protected readonly builderWeapon = computed(() => this.current.build().weapon);
  protected readonly weaponOptions = computed<SelectOption[]>(() =>
    weaponOptions(this.kind(), this.index(), [...this.customWeapons.weapons().values()], this.customWeapons.configs()),
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

  private readonly requested = computed(() => new Set(this.requirements().map((r) => r.skillId)));

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
          values: levelValues(skill, this.kind()),
        }))
      : [];
  });

  /** Picked skills grouped by category, in category order. */
  protected readonly groups = computed(() => {
    const skills = this.index()?.skills;
    if (!skills) return [];
    const rows = this.requirements().flatMap((req, i) => {
      const skill = skills.get(req.skillId);
      if (!skill) return [];
      const levels = isBonus(skill)
        ? skill.ranks.map((r) => ({ level: r.level, label: `${r.name ?? `Rank ${r.level}`} (${requiredPoints(skill, r.level)} pieces)` }))
        : skill.ranks.map((r) => ({ level: r.level, label: `Lv ${r.level}` }));
      const effect = levelValues(skill, this.kind())?.levels.find((l) => l.level === req.level)?.text ?? null;
      return [{ i, req, skill, levels, hint: KIND_LABELS[skill.kind], category: skillCategory(skill), effect }];
    });
    return SKILL_CATEGORIES.map((c) => ({ ...c, rows: rows.filter((r) => r.category === c.id) })).filter((g) => g.rows.length);
  });

  /** Weapon skills are requested but only talismans can supply them (no weapon in the search). */
  protected readonly weaponSkillsWithoutWeapon = computed(
    () => !this.weapon() && this.groups().some((g) => g.rows.some((r) => r.skill.kind === 'weapon')),
  );

  // ---------------------------------------------------------------- actions

  protected setWeaponKind(kind: string): void {
    if (kind && kind !== this.kind()) this.searchWeapon.set({ kind: kind as WeaponKind, id: null });
  }

  protected setWeapon(value: string): void {
    const index = this.index();
    if (index) this.searchWeapon.set({ kind: this.kind(), id: weaponIdForOption(value, index) });
  }

  protected setGogmaDevice(device: GogmaDevice): void {
    const weapon = this.gogmaGroup()?.[device];
    if (weapon) this.searchWeapon.set({ kind: weapon.kind, id: weapon.id });
  }

  protected copyBuilderWeapon(): void {
    const weapon = this.builderWeapon();
    if (weapon) this.searchWeapon.set({ kind: weapon.kind, id: weapon.id });
  }

  protected browse(category: SkillCategory): void {
    this.browsing.update((c) => (c === category ? null : category));
  }

  /** Category chip click: add the skill, or remove it when already picked. */
  protected toggleSkill(skill: Skill): void {
    const i = this.requirements().findIndex((r) => r.skillId === skill.id);
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
    this.requirements.set([...this.requirements(), { skillId: skill.id, level }]);
  }

  protected setLevel(i: number, value: string): void {
    this.requirements.set(this.requirements().map((r, j) => (j === i ? { ...r, level: Number(value) } : r)));
  }

  protected removeSkill(i: number): void {
    this.requirements.set(this.requirements().filter((_, j) => j !== i));
  }

  protected clearSkills(): void {
    this.requirements.set([]);
  }

  protected readonly sourceText = sourceText;

  /** Source pages, one per line, for a tooltip. */
  protected sourceLinks(researched: NonNullable<SkillLevelValues['researched']>): string {
    return researched.sources.map((s) => `${s.name}: ${s.url}`).join('\n');
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
