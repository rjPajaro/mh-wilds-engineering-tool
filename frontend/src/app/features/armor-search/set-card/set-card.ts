import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { EquipSlot } from '../../../core/build/build';
import { Decoration, SlotTarget } from '../../../core/models/game-data';
import { ArmorSetResult } from '../../../core/search/armor-search';
import icons from '../../../../assets/data/icons.json';

export interface ItemRow {
  slot: EquipSlot;
  name: string;
  icon?: string;
  alternatives: string[];
  jewels: Decoration[];
  free: { level: number; target: SlotTarget }[];
}

/** A found set, prepared for display by the Armor Search tab. */
export interface ResultView {
  result: ArmorSetResult;
  rows: ItemRow[];
  skills: { name: string; level: number; requested: boolean; description: string }[];
  freeSlots: { level: number; target: SlotTarget }[];
}

const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: 'Weapon',
  head: 'Head',
  chest: 'Chest',
  arms: 'Arms',
  waist: 'Waist',
  legs: 'Legs',
  talisman: 'Talisman',
};

/** One armor search result: gear, jewels, free slots and skills. */
@Component({
  selector: 'app-set-card',
  templateUrl: './set-card.html',
  styleUrl: './set-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetCard {
  readonly view = input.required<ResultView>();
  readonly rank = input.required<number>();
  readonly equip = output<void>();

  protected readonly slotLabels = SLOT_LABELS;
  protected readonly emptySlotIcons: Record<SlotTarget, Record<string, string>> = icons.emptySlots;
}
