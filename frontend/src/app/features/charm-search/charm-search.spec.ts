import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { buildGameIndex } from '../../core/data/game-index';
import { ArmorSet, ArtianData, Decoration, Skill, Talisman, TalismanRolls, Weapon } from '../../core/models/game-data';
import { ArmorSearchService } from '../../data/armor-search.service';
import { CharmSearchService } from '../../data/charm-search.service';
import { CustomTalismansService } from '../../data/custom-talismans.service';
import { GameDataService } from '../../data/game-data.service';
import { CharmSearch } from './charm-search';
import skills from '../../../assets/data/skills.json';
import armor from '../../../assets/data/armor.json';
import decorations from '../../../assets/data/decorations.json';
import talismans from '../../../assets/data/talismans.json';
import weapons from '../../../assets/data/weapons.json';
import artian from '../../../assets/data/artian.json';
import talismanRolls from '../../../assets/data/talisman-rolls.json';

const index = buildGameIndex({
  skills: skills as unknown as Skill[],
  armor: armor as unknown as ArmorSet[],
  decorations: decorations as unknown as Decoration[],
  talismans: talismans as unknown as Talisman[],
  weapons: weapons as unknown as Weapon[],
  huntingHorn: { melodies: [], songs: [], echoBubbles: [], echoWaves: [] },
  monsters: [],
  artian: artian as unknown as ArtianData,
  moves: { extracted: '', weapons: {} },
  talismanRolls: talismanRolls as unknown as TalismanRolls,
});
const skillId = (name: string) => [...index.skills.values()].find((s) => s.name === name)!.id;
/** Long Sword reaching these needs a charm with Attack Boost 2 or more (see charm-search.spec). */
const NEEDS_A_CHARM = (
  [
    ['Weakness Exploit', 5],
    ['Agitator', 5],
    ['Maximum Might', 3],
    ['Critical Boost', 5],
    ['Attack Boost', 3],
  ] as const
).map(([name, level]) => ({ skillId: skillId(name), level }));

function button(el: HTMLElement, text: string): HTMLButtonElement {
  const b = [...el.querySelectorAll('button')].find((x) => x.textContent?.replace(/\s+/g, ' ').trim().startsWith(text));
  if (!b) throw new Error(`No button "${text}"`);
  return b;
}

/** The search runs inline in tests (no Worker in jsdom), one task later. */
const searchDone = () => new Promise((resolve) => setTimeout(resolve));

describe('CharmSearch', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: GameDataService, useValue: { index: signal(index), isLoading: signal(false), error: signal(undefined) } },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(CharmSearch);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('picks skills with the shared query panel, kept apart from Armor Search', async () => {
    const { fixture, el } = await render();
    expect(el.querySelector('.query')).not.toBeNull();
    expect(el.querySelector('.browser')).not.toBeNull();
    expect(button(el, 'Find charms').disabled).toBe(true);

    button(el, 'Affinity').click();
    await fixture.whenStable();
    button(el, 'Weakness Exploit').click();
    await fixture.whenStable();
    expect(TestBed.inject(CharmSearchService).settings().requirements).toEqual([{ skillId: skillId('Weakness Exploit'), level: 5 }]);
    expect(TestBed.inject(ArmorSearchService).settings().requirements).toEqual([]);
    expect(button(el, 'Find charms').disabled).toBe(false);
  });

  it("copies Armor Search's skills, weapon and options", async () => {
    const armorSearch = TestBed.inject(ArmorSearchService);
    armorSearch.patch({ requirements: NEEDS_A_CHARM, weapon: { kind: 'long-sword', id: 'long-sword:9' }, transcended: true });
    const { fixture, el } = await render();

    button(el, "Use Armor Search's 5 skills").click();
    await fixture.whenStable();
    expect(TestBed.inject(CharmSearchService).settings()).toEqual({
      requirements: NEEDS_A_CHARM,
      weapon: { kind: 'long-sword', id: 'long-sword:9' },
      transcended: true,
    });
    // Same skills now: no button.
    expect(() => button(el, 'Use Armor Search')).toThrow();
  });

  it('lists charms, saves one once, and finds sets with it on Armor Search', async () => {
    const store = TestBed.inject(CharmSearchService);
    store.patch({ requirements: NEEDS_A_CHARM, weapon: { kind: 'long-sword', id: 'long-sword:9' } });
    const { fixture, el } = await render();

    button(el, 'Find charms').click();
    await searchDone();
    await fixture.whenStable();
    expect(el.querySelector('.status')!.textContent).toContain('would complete a set');
    const card = el.querySelector<HTMLElement>('app-charm-card')!;
    expect(card.querySelector('.needs')!.textContent).toContain('Attack Boost 2+');
    expect(card.querySelector('.rarities')!.textContent).toContain('Historical Charm');

    const talismans = TestBed.inject(CustomTalismansService);
    button(card, 'Save to Talismans').click();
    await fixture.whenStable();
    expect(talismans.configs()).toHaveLength(1);
    expect(card.querySelector('.saved')!.textContent).toBe('Saved');
    const [saved] = talismans.configs();
    expect(saved.skills).toContainEqual({ skillId: skillId('Attack Boost'), level: 2 });

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    button(card, 'Save & find sets').click();
    await searchDone();
    // Already saved: not saved again.
    expect(talismans.configs()).toHaveLength(1);
    expect(navigate).toHaveBeenCalledWith('/search');
    const armorSearch = TestBed.inject(ArmorSearchService);
    expect(armorSearch.settings().requirements).toEqual(NEEDS_A_CHARM);
    expect(armorSearch.settings().weapon.id).toBe('long-sword:9');
    expect(armorSearch.output()!.results.length).toBeGreaterThan(0);
    expect(armorSearch.output()!.results.every((r) => r.talisman?.id === saved.id)).toBe(true);
  });

  it('explains a charm that needs no skills: its slots take the jewels', async () => {
    // No weapon: Attack Boost (a weapon skill) can only come from the charm. Every Golden Age
    // Charm has a weapon 1-slot, which takes an Attack Boost jewel, whatever its skills.
    TestBed.inject(CharmSearchService).patch({
      requirements: [
        { skillId: skillId('Agitator'), level: 1 },
        { skillId: skillId('Attack Boost'), level: 1 },
      ],
      weapon: { kind: 'long-sword', id: null },
    });
    const { fixture, el } = await render();

    button(el, 'Find charms').click();
    await searchDone();
    await fixture.whenStable();
    const card = el.querySelector<HTMLElement>('app-charm-card')!;
    expect(card.querySelector('.needs')!.textContent!.replace(/\s+/g, ' ')).toContain('No skills needed Weapon slot 1');
    expect(card.querySelector('.rarities')!.textContent).toContain('Golden Age Charm 100%');
    const jewels = card.querySelector('.jewels')!.textContent!.replace(/\s+/g, ' ');
    expect(jewels).toContain('Any charm like this works');
    expect(jewels).toMatch(/Attack|Power|Sharp/); // a jewel with Attack Boost
  });

  it('says when no charm is needed', async () => {
    TestBed.inject(CharmSearchService).patch({ requirements: [{ skillId: skillId('Weakness Exploit'), level: 1 }] });
    const { fixture, el } = await render();

    button(el, 'Find charms').click();
    await searchDone();
    await fixture.whenStable();
    expect(el.querySelector('.status')!.textContent).toContain('No charm needed');
    expect(el.querySelector('app-charm-card')).toBeNull();
  });
});
