import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Skill, SlotTarget, WeaponKind } from '../../../core/models/game-data';
import { CharmResult } from '../../../core/search/charm-search';
import { SkillTip } from '../../../shared/skill-tip/skill-tip';
import icons from '../../../../assets/data/icons.json';

/** A charm from the charm search, prepared for display by the Armor Search tab. */
export interface CharmView {
  charm: CharmResult;
  /** Requested skills the charm needs, at least at these levels (`orHigher`: the skill goes higher). */
  skills: { skill: Skill; level: number; orHigher: boolean }[];
  slots: { level: number; target: SlotTarget }[];
  /** Charm types that roll it, with their share of the chance, most likely first. */
  rarities: { rarity: number; name: string; share: number }[];
  /** The most likely roll: what saving the charm stores. */
  example: { name: string; rarity: number; skills: string; slots: { level: number; target: SlotTarget }[] };
  /** Jewels the example set puts in the charm's slots. */
  jewels: string[];
  /** The example set's armor, by piece. */
  armor: string[];
  weaponKind: WeaponKind;
  /** Saved on the Talismans tab during this visit. */
  saved: boolean;
}

/** One charm the charm search found: what to look for, how likely it is, and a set it completes. */
@Component({
  selector: 'app-charm-card',
  imports: [SkillTip],
  templateUrl: './charm-card.html',
  styleUrl: './charm-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CharmCard {
  readonly view = input.required<CharmView>();
  readonly rank = input.required<number>();
  readonly save = output<void>();
  readonly findSets = output<void>();

  protected readonly emptySlotIcons: Record<SlotTarget, Record<string, string>> = icons.emptySlots;
  protected readonly charmIcons: Record<string, string> = icons.charms;

  /** "0.78%" with enough digits for small chances. */
  protected percent(chance: number): string {
    const pct = chance * 100;
    return `${pct >= 1 ? pct.toFixed(1) : pct >= 0.1 ? pct.toFixed(2) : pct.toPrecision(2)}%`;
  }

  protected slotLabel(slot: { level: number; target: SlotTarget }): string {
    return `${slot.target === 'weapon' ? 'Weapon' : 'Armor'} slot ${slot.level}`;
  }

  protected oneIn(chance: number): string {
    return Math.round(1 / chance).toLocaleString();
  }
}
