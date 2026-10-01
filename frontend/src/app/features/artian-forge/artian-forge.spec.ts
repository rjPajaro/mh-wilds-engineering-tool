import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { buildGameIndex } from '../../core/data/game-index';
import { ArtianData, Skill, Weapon } from '../../core/models/game-data';
import { CustomWeaponsService } from '../../data/custom-weapons.service';
import { GameDataService } from '../../data/game-data.service';
import { ArtianForge } from './artian-forge';
import weapons from '../../../assets/data/weapons.json';
import artian from '../../../assets/data/artian.json';
import skills from '../../../assets/data/skills.json';

const index = buildGameIndex({
  skills: skills as unknown as Skill[],
  armor: [],
  decorations: [],
  talismans: [],
  weapons: weapons as unknown as Weapon[],
  huntingHorn: { melodies: [], songs: [], echoBubbles: [], echoWaves: [] },
  monsters: [],
  artian: artian as unknown as ArtianData,
  moves: { extracted: '', weapons: {} },
});

describe('ArtianForge', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: GameDataService, useValue: { index: signal(index), isLoading: signal(false), error: signal(undefined) } }],
    });
  });

  function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
    if (!button) throw new Error(`No button "${text}"`);
    return button;
  }

  it('creates, previews and saves a Gogma Artian', async () => {
    const fixture = TestBed.createComponent(ArtianForge);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    buttonByText(el, '+ Gogma Artian').click();
    await fixture.whenStable();
    // Great Sword attack device (200 / -10) + 3 attack parts.
    expect(el.querySelector('.weapon-name')?.textContent).toContain('Ostrak Oblivion');
    expect(el.querySelector('.stats')?.textContent).toContain('215');
    expect(el.querySelector('.stats')?.textContent).toContain('-10%');

    buttonByText(el, 'Element').click(); // device
    await fixture.whenStable();
    expect(el.querySelector('.stats')?.textContent).toContain('0%');

    buttonByText(el, 'Save weapon').click();
    await fixture.whenStable();

    const store = TestBed.inject(CustomWeaponsService);
    expect(store.configs()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('mhwet.artians.v1')!)[0]).toMatchObject({ tier: 'gogma', device: 'element', kind: 'great-sword' });
    expect(store.weaponsOfKind('great-sword')[0]).toMatchObject({ attack: 205, affinity: 0 });
    expect(el.querySelector('.saved-item')?.textContent).toContain('Gogma · Element device');
  });

  it('keeps an unsaved draft after a reload', async () => {
    const first = TestBed.createComponent(ArtianForge);
    await first.whenStable();
    buttonByText(first.nativeElement, '+ Gogma Artian').click();
    await first.whenStable();
    buttonByText(first.nativeElement, 'Affinity').click(); // device
    await first.whenStable();
    first.destroy();

    const second = TestBed.createComponent(ArtianForge);
    await second.whenStable();
    const el = second.nativeElement as HTMLElement;
    expect(el.querySelector('.editor h2')?.textContent).toContain('New Gogma Artian');
    expect(el.querySelector('.stats')?.textContent).toContain('15%'); // 180 / 15 affinity device + 0 aff parts
    expect(TestBed.inject(CustomWeaponsService).configs()).toHaveLength(0); // still not saved
  });

  it('only offers level I reinforcements for regular Artians', async () => {
    const fixture = TestBed.createComponent(ArtianForge);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    buttonByText(el, '+ Artian').click();
    await fixture.whenStable();

    const component = fixture.componentInstance as unknown as { setReinforcementType(i: number, t: string): void };
    component.setReinforcementType(0, 'attack');
    await fixture.whenStable();
    const levels = [...el.querySelectorAll('.reinforcement .segmented button')].map((b) => b.textContent?.trim());
    expect(levels).toEqual(['I']);
    expect(el.querySelector('.stats')?.textContent).toContain('210'); // 190 + 15 parts + 5
  });
});
