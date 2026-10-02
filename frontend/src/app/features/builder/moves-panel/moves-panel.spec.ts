import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { buildGameIndex } from '../../../core/data/game-index';
import { ArtianData, Monster, MoveData, Weapon } from '../../../core/models/game-data';
import { DamageSettingsService } from '../../../data/damage-settings.service';
import { GameDataService } from '../../../data/game-data.service';
import { MovesPanel } from './moves-panel';
import weapons from '../../../../assets/data/weapons.json';
import monsters from '../../../../assets/data/monsters.json';
import moves from '../../../../assets/data/moves.json';

const index = buildGameIndex({
  skills: [],
  armor: [],
  decorations: [],
  talismans: [],
  weapons: weapons as unknown as Weapon[],
  huntingHorn: { melodies: [], songs: [], echoBubbles: [], echoWaves: [] },
  monsters: monsters as unknown as Monster[],
  artian: {} as ArtianData,
  moves: moves as unknown as MoveData,
});

const arkveld = index.files.monsters.find((m) => m.name === 'Arkveld')!;
const greatSword = index.weaponsByKind.get('great-sword')!.at(-1)!;

describe('MovesPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: GameDataService, useValue: { index: signal(index), isLoading: signal(false), error: signal(undefined) } }],
    });
  });

  async function render(weapon: Weapon) {
    const fixture = TestBed.createComponent(MovesPanel);
    fixture.componentRef.setInput('weapon', weapon);
    fixture.componentRef.setInput('skills', []);
    await fixture.whenStable();
    return fixture;
  }

  const headers = (el: HTMLElement) => [...el.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
  const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLTableRowElement>('tbody tr:not(.section)')];

  it('shows Hitzone, Move, Attack, Affinity and Element against the shared target', async () => {
    TestBed.inject(DamageSettingsService).selectMonster(String(arkveld.id)); // part 0: Right Chainblade
    const fixture = await render(greatSword);
    const el = fixture.nativeElement as HTMLElement;

    expect(headers(el)).toEqual(['Hitzone', 'Move', 'Attack', 'Affinity', 'Element']);
    expect(el.textContent).toContain('vs Arkveld · Right Chainblade');

    const tcs = rows(el).find((r) => r.textContent?.includes('True Charged Slash') && r.textContent.includes('LV 3'))!;
    const cells = [...tcs.querySelectorAll('td')].map((td) => td.textContent?.replace(/\s+/g, ' ').trim());
    expect(cells[0]).toBe('Right Chainblade slash 50 · elem 0');
    expect(cells[3]).toBe(`${greatSword.affinity}%`);
    expect(tcs.title).toContain('MV 16 + 209'); // motion values and total move to the tooltip
  });

  it('lists every part with "All parts"', async () => {
    TestBed.inject(DamageSettingsService).selectMonster(String(arkveld.id));
    const fixture = await render(greatSword);
    const el = fixture.nativeElement as HTMLElement;

    el.querySelectorAll<HTMLInputElement>('.controls input[type=checkbox]')[0].click(); // All parts
    await fixture.whenStable();
    const overhead = rows(el).filter((r) => r.querySelector('.name')?.textContent === 'Overhead Slash');
    expect(overhead.map((r) => r.querySelector('.part')?.textContent)).toEqual(arkveld.parts.map((p) => p.name));
    expect(el.textContent).toContain('vs Arkveld · all parts');
  }, 20_000); // renders every move for every part: slow under jsdom

  it('sorts by damage and filters', async () => {
    const fixture = await render(greatSword);
    const el = fixture.nativeElement as HTMLElement;
    const totals = () => rows(el).map((r) => Number(/Total ([\d.]+)/.exec(r.title)![1]));

    el.querySelector<HTMLInputElement>('.controls input[type=checkbox]')!.click(); // Sort (no monster: only control)
    await fixture.whenStable();
    const sorted = totals();
    expect(sorted.length).toBeGreaterThan(20);
    expect(sorted).toEqual([...sorted].sort((a, b) => b - a));

    const filter = el.querySelector<HTMLInputElement>('input[type=search]')!;
    filter.value = 'tackle';
    filter.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect([...el.querySelectorAll('.name')].map((n) => n.textContent)).toEqual(['Tackle', 'Tackle', 'Tackle', 'Tackle']);
  });

  it('says when a weapon type has no motion values', async () => {
    const fixture = await render(index.weaponsByKind.get('long-sword')![0]);
    expect(fixture.nativeElement.textContent).toContain('No motion values for Long Sword yet');
  });
});
