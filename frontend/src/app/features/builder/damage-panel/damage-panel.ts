import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { calculateDamage } from '../../../core/calc/damage';
import { comboDamage, LIGHT_COMBOS } from '../../../core/calc/combos';
import { averageHit, calculateMoves } from '../../../core/calc/moves';
import { SHARPNESS_COLORS, Weapon } from '../../../core/models/game-data';
import { ActiveSkill } from '../../../core/skills/skill-resolver';
import { GameDataService } from '../../../data/game-data.service';
import { DamageSettingsService } from '../../../data/damage-settings.service';
import { persistedSignal } from '../../../shared/persisted-signal';
import { SearchSelect, SelectOption } from '../../../shared/search-select/search-select';

/** Wilds displays element and status at 10x their true value. */
const ELEMENT_DISPLAY_SCALE = 10;

@Component({
  selector: 'app-damage-panel',
  imports: [SearchSelect, DecimalPipe],
  templateUrl: './damage-panel.html',
  styleUrl: './damage-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DamagePanel {
  private readonly data = inject(GameDataService);
  private readonly settings = inject(DamageSettingsService);

  readonly weapon = input.required<Weapon | null>();
  readonly skills = input.required<readonly ActiveSkill[]>();

  // Target and conditions are shared with the move list and persisted (DamageSettingsService).
  protected readonly monsterId = this.settings.monsterId;
  protected readonly partIndex = this.settings.partIndex;
  protected readonly wounded = this.settings.wounded;
  protected readonly toggles = this.settings.toggles;
  protected readonly monster = this.settings.monster;
  protected readonly part = this.settings.part;

  protected readonly sharpnessColors = SHARPNESS_COLORS;
  protected readonly displayScale = ELEMENT_DISPLAY_SCALE;
  protected readonly pct = pct;

  protected readonly monsterOptions = computed<SelectOption[]>(() =>
    [...(this.data.index()?.files.monsters ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ value: String(m.id), label: m.name, hint: m.speciesName })),
  );


  protected readonly partOptions = computed<SelectOption[]>(() =>
    (this.monster()?.parts ?? []).map((p, i) => {
      const hz = p.hitzones;
      return {
        value: String(i),
        label: p.name,
        hint: `Slash ${pct(hz.slash)} · Blunt ${pct(hz.blunt)} · Shot ${pct(hz.pierce)} · ` +
          `Fire ${pct(hz.fire)} · Water ${pct(hz.water)} · Thunder ${pct(hz.thunder)} · Ice ${pct(hz.ice)} · Dragon ${pct(hz.dragon)}`,
      };
    }),
  );


  protected readonly result = computed(() => {
    const weapon = this.weapon();
    if (!weapon) return null;
    return calculateDamage({ weapon, skills: this.skills(), toggles: this.toggles(), buffs: this.settings.buffEffects(), target: this.settings.target() });
  });

  /**
   * Headline number: the weapon's light-attack combo, the average hit of all its
   * moves, or a 100 MV reference hit.
   */
  protected readonly view = persistedSignal<'combo' | 'average' | 'mv100'>('damage.view.v2', 'combo', (v) =>
    v === 'combo' || v === 'average' || v === 'mv100',
  );

  /** Per-move damage; null when the weapon type's motion values are not available. */
  private readonly moveResults = computed(() => {
    const weapon = this.weapon();
    const moves = weapon ? this.data.index()?.files.moves.weapons[weapon.kind] : undefined;
    if (!weapon || !moves) return null;
    return calculateMoves({ weapon, skills: this.skills(), toggles: this.toggles(), buffs: this.settings.buffEffects(), target: this.settings.target() }, moves.moves);
  });

  protected readonly average = computed(() => {
    const results = this.moveResults();
    return results ? averageHit(results) : null;
  });

  protected readonly combo = computed(() => {
    const results = this.moveResults();
    const combo = this.weapon() ? LIGHT_COMBOS[this.weapon()!.kind] : undefined;
    return results && combo ? comboDamage(combo, results) : null;
  });

  /** The view to show: falls back when the chosen one is not available for this weapon. */
  protected readonly shownView = computed(() => {
    const view = this.view();
    if (view === 'combo' && !this.combo()) return this.average() ? 'average' : 'mv100';
    if (view === 'average' && !this.average()) return 'mv100';
    return view;
  });

  /** Target stats when a part is selected, otherwise base stats. */
  protected readonly stats = computed(() => {
    const r = this.result();
    return r ? (r.vsTarget ?? r.base) : null;
  });

  protected selectMonster(id: string): void {
    this.settings.selectMonster(id);
  }

  protected setToggle(skill: string, on: boolean): void {
    this.settings.setToggle(skill, on);
  }

  protected barWidth(hits: number, bar: readonly number[]): number {
    const total = bar.reduce((a, b) => a + b, 0);
    return total ? (hits / total) * 100 : 0;
  }
}

/** Hitzone fraction to the in-game number (0.65 -> 65). */
function pct(fraction: number): number {
  return Math.round(fraction * 100);
}
