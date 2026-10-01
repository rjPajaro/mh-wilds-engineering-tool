import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { calculateMoves, MoveResult, MoveVariantResult } from '../../../core/calc/moves';
import { MonsterPart, Weapon } from '../../../core/models/game-data';
import { ActiveSkill } from '../../../core/skills/skill-resolver';
import { DamageSettingsService } from '../../../data/damage-settings.service';
import { GameDataService } from '../../../data/game-data.service';
import { weaponKindLabel } from '../../../shared/labels';
import { isBoolean, persistedSignal } from '../../../shared/persisted-signal';

interface Row {
  /** Part name, or null without a target. */
  part: string | null;
  move: MoveResult;
  variant: MoveVariantResult;
}

@Component({
  selector: 'app-moves-panel',
  imports: [DecimalPipe],
  templateUrl: './moves-panel.html',
  styleUrl: './moves-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MovesPanel {
  private readonly data = inject(GameDataService);
  protected readonly settings = inject(DamageSettingsService);

  readonly weapon = input.required<Weapon | null>();
  readonly skills = input.required<readonly ActiveSkill[]>();

  protected readonly filter = signal('');
  protected readonly sortByDamage = persistedSignal('moves.sortByDamage.v1', false, isBoolean);
  /** List every part of the target monster instead of only the selected part. */
  protected readonly allParts = persistedSignal('moves.allParts.v1', false, isBoolean);

  protected readonly kindLabel = computed(() => {
    const weapon = this.weapon();
    return weapon ? weaponKindLabel(weapon.kind) : '';
  });

  protected readonly source = computed(() => {
    const weapon = this.weapon();
    return weapon ? (this.data.index()?.files.moves.weapons[weapon.kind] ?? null) : null;
  });

  protected readonly targetLabel = computed(() => {
    const monster = this.settings.monster();
    if (!monster) return null;
    const wounded = this.settings.wounded() ? ' (wounded)' : '';
    if (this.allParts()) return `${monster.name} · all parts${wounded}`;
    const part = this.settings.part();
    return part ? `${monster.name} · ${part.name}${wounded}` : null;
  });

  /** The parts rows are computed against; [null] means no target (hitzone 100). */
  private readonly targetParts = computed<(MonsterPart | null)[]>(() => {
    const monster = this.settings.monster();
    if (monster && this.allParts()) return monster.parts;
    return [this.settings.part()];
  });

  /** Rows grouped by move-list section, or one list sorted by total damage. */
  protected readonly groups = computed(() => {
    const weapon = this.weapon();
    const source = this.source();
    if (!weapon || !source) return [];

    const base = { weapon, skills: this.skills(), toggles: this.settings.toggles() };
    const perPart = this.targetParts().map((part) => ({
      part: part?.name ?? null,
      results: calculateMoves({ ...base, target: part ? { hitzones: part.hitzones, wounded: this.settings.wounded() } : null }, source.moves),
    }));

    // Rows in move-list order: each move variant, then each part.
    const terms = this.filter().toLowerCase().split(/\s+/).filter(Boolean);
    const rows: Row[] = [];
    source.moves.forEach((_, m) => {
      perPart[0].results[m].variants.forEach((__, v) => {
        for (const { part, results } of perPart) {
          const move = results[m];
          const text = `${move.name} ${move.section} ${move.variants[v].label ?? ''} ${part ?? ''}`.toLowerCase();
          if (terms.every((t) => text.includes(t))) rows.push({ part, move, variant: move.variants[v] });
        }
      });
    });

    if (this.sortByDamage()) {
      rows.sort((a, b) => b.variant.total - a.variant.total);
      return rows.length ? [{ section: 'Highest damage first', rows }] : [];
    }
    const groups: { section: string; rows: Row[] }[] = [];
    for (const row of rows) {
      let group = groups.at(-1);
      if (group?.section !== row.move.section) groups.push((group = { section: row.move.section, rows: [] }));
      group.rows.push(row);
    }
    return groups;
  });

  protected pct(fraction: number): number {
    return Math.round(fraction * 100);
  }

  protected mvText(hits: readonly number[]): string {
    // Collapse runs: [10, 10, 10, 25] -> "10×3 + 25"
    const parts: string[] = [];
    for (let i = 0; i < hits.length; ) {
      let j = i;
      while (j < hits.length && hits[j] === hits[i]) j++;
      parts.push(j - i > 1 ? `${hits[i]}×${j - i}` : `${hits[i]}`);
      i = j;
    }
    return parts.join(' + ');
  }

  /** Hover text for a row: motion values, total and per-hit damage. */
  protected detail(row: Row): string {
    const v = row.variant;
    const lines = [`MV ${this.mvText(v.hits)}`, `Total ${v.total.toFixed(1)}`];
    if (v.perHit.length > 1) lines.push(`Per hit: ${v.perHit.map((d) => d.toFixed(1)).join(', ')}`);
    return [...lines, ...row.move.notes].join('\n');
  }
}
