import { computed, inject, Injectable } from '@angular/core';
import { DamageTarget } from '../core/calc/damage';
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

  readonly monster = computed(() => this.data.index()?.monsters.get(Number(this.monsterId())) ?? null);
  readonly part = computed(() => this.monster()?.parts[Number(this.partIndex())] ?? null);
  readonly target = computed<DamageTarget | null>(() => {
    const part = this.part();
    return part ? { hitzones: part.hitzones, wounded: this.wounded() } : null;
  });

  selectMonster(id: string): void {
    this.monsterId.set(id);
    this.partIndex.set(id ? '0' : '');
  }

  setToggle(skill: string, on: boolean): void {
    this.toggles.update((t) => ({ ...t, [skill]: on }));
  }
}
