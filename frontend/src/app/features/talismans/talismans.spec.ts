import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { buildGameIndex } from '../../core/data/game-index';
import { ArmorSet, ArtianData, Decoration, Skill, Talisman, Weapon } from '../../core/models/game-data';
import { CurrentBuildService } from '../../data/current-build.service';
import { CustomTalismansService } from '../../data/custom-talismans.service';
import { GameDataService } from '../../data/game-data.service';
import { Talismans } from './talismans';
import skills from '../../../assets/data/skills.json';
import talismans from '../../../assets/data/talismans.json';
import artian from '../../../assets/data/artian.json';

const index = buildGameIndex({
  skills: skills as unknown as Skill[],
  armor: [] as ArmorSet[],
  decorations: [] as Decoration[],
  talismans: talismans as unknown as Talisman[],
  weapons: [] as Weapon[],
  huntingHorn: { melodies: [], songs: [], echoBubbles: [], echoWaves: [] },
  monsters: [],
  artian: artian as unknown as ArtianData,
  moves: { extracted: '', weapons: {} },
});

function button(el: HTMLElement, text: string): HTMLButtonElement {
  const b = [...el.querySelectorAll('button')].find((x) => x.textContent?.replace(/\s+/g, ' ').trim().startsWith(text));
  if (!b) throw new Error(`No button "${text}"`);
  return b;
}

describe('Talismans', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: GameDataService, useValue: { index: signal(index), isLoading: signal(false), error: signal(undefined) } },
      ],
    });
  });

  it('creates a talisman with skills and slots, saves it and equips it', async () => {
    const fixture = TestBed.createComponent(Talismans);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const store = TestBed.inject(CustomTalismansService);

    button(el, '+ Talisman').click();
    await fixture.whenStable();
    button(el, 'Historical Charm').click();
    button(el, '+ Skill').click();
    button(el, '+ Skill').click();
    button(el, '+ Weapon slot').click();
    await fixture.whenStable();
    expect(el.querySelectorAll('.row')).toHaveLength(3);
    expect(button(el, 'Save talisman').disabled).toBe(false);

    button(el, 'Save talisman').click();
    await fixture.whenStable();
    const [saved] = store.configs();
    expect(saved).toMatchObject({ rarity: 6, slots: [{ level: 1, accepts: 'weapon' }] });
    expect(saved.skills).toHaveLength(2);
    expect(store.talismans().get(saved.id)).toMatchObject({ name: 'Historical Charm', rarity: 6 });
    expect(el.querySelector('.saved-item .name')!.textContent).toBe('Historical Charm');

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    button(el, 'Save & equip').click();
    expect(TestBed.inject(CurrentBuildService).saved().talismanId).toBe(saved.id);
    expect(navigate).toHaveBeenCalledWith('/builder');
  });

  it('deletes a talisman and removes it from the current build', async () => {
    const store = TestBed.inject(CustomTalismansService);
    const current = TestBed.inject(CurrentBuildService);
    store.save({ id: 'custom:x', name: 'Old', rarity: 8, skills: [], slots: [{ level: 2, accepts: 'armor' }] });
    current.saved.update((b) => ({ ...b, talismanId: 'custom:x' }));

    const fixture = TestBed.createComponent(Talismans);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('.saved-item') as HTMLButtonElement).click();
    await fixture.whenStable();
    button(el, 'Delete talisman').click();
    await fixture.whenStable();
    button(el, 'Delete').click();
    await fixture.whenStable();

    expect(store.configs()).toEqual([]);
    expect(current.saved().talismanId).toBeNull();
  });
});
