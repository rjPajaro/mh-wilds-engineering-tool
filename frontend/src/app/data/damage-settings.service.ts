import { computed, inject, Injectable } from '@angular/core';
import { BuffSelection, buffEffects } from '../core/calc/buffs';
import { CustomBuff, customBuffEffects, customBuffFromPreset, CustomBuffPreset, isCustomBuffList, newCustomBuff } from '../core/calc/custom-buffs';
import { DamageTarget } from '../core/calc/damage';
import { FRENZY_MONSTERS } from '../core/calc/skill-effects';
import { isBoolean, isObject, isString, persistedSignal } from '../shared/persisted-signal';
import { GameDataService } from './game-data.service';

/** Target monster/part and condition toggles, shared by the damage panel and the move list. Persisted. */
@Injectable({ providedIn: 'root' })
export class DamageSettingsService {
  private readonly data = inject(GameDataService);

  readonly monsterId = persistedSignal('damage.monster.v1', '', isString);
  readonly partIndex = persistedSignal('damage.part.v1', '', isString);
  readonly wounded = persistedSignal('damage.wounded.v1', false, isBoolean);
  readonly toggles = persistedSignal<Record<string, boolean>>('damage.toggles.v1', {}, (v) => isObject(v) && Object.values(v).every(isBoolean));

  /** Items and meals in use (group id -> option id, '' for none). */
  readonly buffs = persistedSignal<BuffSelection>('damage.buffs.v1', {}, (v) => isObject(v) && Object.values(v).every(isString));
  /** Buffs with user-entered values (songs, weapon modes, ammo); see custom-buffs.ts. */
  readonly customBuffs = persistedSignal<CustomBuff[]>('damage.customBuffs.v1', [], isCustomBuffList);
  readonly buffEffects = computed(() => [...buffEffects(this.buffs()), ...customBuffEffects(this.customBuffs())]);

  readonly monster = computed(() => this.data.index()?.monsters.get(Number(this.monsterId())) ?? null);
  readonly inflictsFrenzy = computed(() => FRENZY_MONSTERS.has(this.monster()?.name ?? ''));
  readonly part = computed(() => this.monster()?.parts[Number(this.partIndex())] ?? null);
  readonly target = computed<DamageTarget | null>(() => {
    const part = this.part();
    return part ? { hitzones: part.hitzones, wounded: this.wounded() } : null;
  });

  selectMonster(id: string): void {
    this.monsterId.set(id);
    this.partIndex.set(id ? '0' : '');
  }

  setBuff(group: string, option: string): void {
    this.buffs.update((b) => ({ ...b, [group]: option }));
  }

  addCustomBuff(): void {
    this.customBuffs.update((list) => [...list, newCustomBuff(crypto.randomUUID())]);
  }

  addCustomBuffFromPreset(preset: CustomBuffPreset): void {
    this.customBuffs.update((list) => [...list, customBuffFromPreset(crypto.randomUUID(), preset)]);
  }

  updateCustomBuff(id: string, patch: Partial<Omit<CustomBuff, 'id'>>): void {
    this.customBuffs.update((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  removeCustomBuff(id: string): void {
    this.customBuffs.update((list) => list.filter((b) => b.id !== id));
  }

  setToggle(key: string, on: boolean): void {
    this.toggles.update((t) => ({ ...t, [key]: on }));
  }
}
