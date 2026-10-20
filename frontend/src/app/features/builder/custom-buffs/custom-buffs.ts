import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CUSTOM_BUFF_FIELDS, CUSTOM_BUFF_PRESETS, CustomBuff, CustomBuffField } from '../../../core/calc/custom-buffs';
import { DamageSettingsService } from '../../../data/damage-settings.service';

/** Editor for buffs with user-entered values (songs, weapon modes, ammo). Persisted in DamageSettingsService. */
@Component({
  selector: 'app-custom-buffs',
  templateUrl: './custom-buffs.html',
  styleUrl: './custom-buffs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomBuffs {
  private readonly settings = inject(DamageSettingsService);

  protected readonly customBuffs = this.settings.customBuffs;
  protected readonly customBuffFields = CUSTOM_BUFF_FIELDS;
  /** Presets by group, for the "Add preset" dropdown. */
  protected readonly presetGroups = [...new Set(CUSTOM_BUFF_PRESETS.map((p) => p.group))].map((group) => ({
    group,
    presets: CUSTOM_BUFF_PRESETS.filter((p) => p.group === group),
  }));

  protected addCustomBuff(): void {
    this.settings.addCustomBuff();
  }

  /** Adds the chosen preset as an editable custom buff, then resets the dropdown. */
  protected addPreset(select: HTMLSelectElement): void {
    const preset = CUSTOM_BUFF_PRESETS.find((p) => p.id === select.value);
    if (preset) this.settings.addCustomBuffFromPreset(preset);
    select.value = '';
  }

  protected removeCustomBuff(buff: CustomBuff): void {
    this.settings.removeCustomBuff(buff.id);
  }

  protected updateCustomBuff(buff: CustomBuff, patch: Partial<Omit<CustomBuff, 'id'>>): void {
    this.settings.updateCustomBuff(buff.id, patch);
  }

  /** An empty or invalid number clears the field. */
  protected setCustomBuffValue(buff: CustomBuff, key: CustomBuffField, text: string): void {
    const n = Number(text);
    const values = { ...buff.values };
    if (text.trim() !== '' && Number.isFinite(n) && n !== 0) values[key] = n;
    else delete values[key];
    this.updateCustomBuff(buff, { values });
  }
}
