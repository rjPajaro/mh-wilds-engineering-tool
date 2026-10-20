import { TestBed } from '@angular/core/testing';
import { DamageSettingsService } from '../../../data/damage-settings.service';
import { CustomBuffs } from './custom-buffs';

describe('CustomBuffs', () => {
  beforeEach(() => localStorage.clear());

  async function render() {
    const fixture = TestBed.createComponent(CustomBuffs);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, settings: TestBed.inject(DamageSettingsService) };
  }

  it('adds, edits and removes a custom buff, feeding the calculator buffs', async () => {
    const { fixture, el, settings } = await render();
    el.querySelector<HTMLButtonElement>('.custom-head button')!.click();
    await fixture.whenStable();
    expect(settings.customBuffs().length).toBe(1);

    const name = el.querySelector<HTMLInputElement>('input.name')!;
    name.value = 'Attack Up';
    name.dispatchEvent(new Event('input'));
    const attack = el.querySelector<HTMLInputElement>('.custom-fields input')!; // first field: flat attack
    attack.value = '10';
    attack.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(settings.buffEffects()).toContainEqual({ label: 'Attack Up', values: { attackFlat: 10 } });

    attack.value = '';
    attack.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(settings.customBuffs()[0].values).toEqual({});

    el.querySelector<HTMLButtonElement>('.remove')!.click();
    await fixture.whenStable();
    expect(settings.customBuffs()).toEqual([]);
  });

  it('adds a preset as an editable buff and resets the dropdown', async () => {
    const { fixture, el, settings } = await render();
    const select = el.querySelector<HTMLSelectElement>('select')!;
    select.value = 'hh-attack-l-2';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(settings.customBuffs()).toMatchObject([{ name: 'Attack Up (L), tier 2', enabled: true, values: { attackPct: 10 } }]);
    expect(select.value).toBe('');
    expect(el.querySelector<HTMLInputElement>('input.name')!.value).toBe('Attack Up (L), tier 2');
  });

  it('leaves disabled buffs out of the calculation', async () => {
    const { settings } = await render();
    settings.addCustomBuff();
    const id = settings.customBuffs()[0].id;
    settings.updateCustomBuff(id, { name: 'Demon Mode', values: { rawMultiplier: 10 }, enabled: false });
    expect(settings.buffEffects().some((b) => b.label === 'Demon Mode')).toBe(false);
    settings.updateCustomBuff(id, { enabled: true });
    expect(settings.buffEffects()).toContainEqual({ label: 'Demon Mode', values: { rawDamagePct: 10 } });
  });
});
