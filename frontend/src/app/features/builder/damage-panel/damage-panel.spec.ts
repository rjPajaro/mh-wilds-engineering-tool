import { TestBed } from '@angular/core/testing';
import { Skill } from '../../../core/models/game-data';
import { ActiveSkill } from '../../../core/skills/skill-resolver';
import { LONG_SWORD } from '../../../core/testing/fixtures';
import { DamagePanel } from './damage-panel';

function active(name: string, level: number, kind: Skill['kind'] = 'armor'): ActiveSkill {
  return { skill: { id: 0, name, description: '', kind, icon: 'offense', maxLevel: 5, ranks: [] }, points: level, level, wasted: 0, sources: [] };
}

describe('DamagePanel', () => {
  beforeEach(() => localStorage.clear());

  async function render(weapon = LONG_SWORD, skills: ActiveSkill[] = []) {
    const fixture = TestBed.createComponent(DamagePanel);
    fixture.componentRef.setInput('weapon', weapon);
    fixture.componentRef.setInput('skills', skills);
    await fixture.whenStable();
    return fixture;
  }

  it('asks for a weapon when none is equipped', async () => {
    const fixture = TestBed.createComponent(DamagePanel);
    fixture.componentRef.setInput('weapon', null);
    fixture.componentRef.setInput('skills', []);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Equip a weapon');
  });

  it('shows attack, affinity, sharpness and effective raw', async () => {
    const text = (await render()).nativeElement.textContent as string;
    expect(text).toContain('200'); // attack
    expect(text).toContain('10%'); // affinity
    expect(text).toContain('white');
    expect(text).toContain('270.6'); // 200 * 1.32 * 1.025
  });

  it('lists conditional skills and recalculates when toggled', async () => {
    const fixture = await render(LONG_SWORD, [active('Agitator', 5)]);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Monster enraged');
    expect(el.textContent).toContain('220'); // 200 + 20

    const box = el.querySelector<HTMLInputElement>('.conditions input')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(el.querySelector('.stats dd')?.textContent?.trim()).toBe('200');
  });

  it('keeps condition toggles after a reload', async () => {
    const first = await render(LONG_SWORD, [active('Agitator', 5)]);
    const box = (first.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.conditions input')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await first.whenStable();
    first.destroy();

    const second = await render(LONG_SWORD, [active('Agitator', 5)]);
    const el = second.nativeElement as HTMLElement;
    expect(el.querySelector<HTMLInputElement>('.conditions input')!.checked).toBe(false);
    expect(el.querySelector('.stats dd')?.textContent?.trim()).toBe('200');
  });
});
