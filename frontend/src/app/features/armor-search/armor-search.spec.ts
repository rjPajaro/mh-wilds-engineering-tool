import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { buildGameIndex } from '../../core/data/game-index';
import { ARMOR_KINDS, ArmorSet, ArtianData, Decoration, Skill, Talisman, Weapon } from '../../core/models/game-data';
import { ArmorSearchService } from '../../data/armor-search.service';
import { CurrentBuildService } from '../../data/current-build.service';
import { GameDataService } from '../../data/game-data.service';
import { ArmorSearch } from './armor-search';
import skills from '../../../assets/data/skills.json';
import armor from '../../../assets/data/armor.json';
import decorations from '../../../assets/data/decorations.json';
import talismans from '../../../assets/data/talismans.json';
import weapons from '../../../assets/data/weapons.json';
import artian from '../../../assets/data/artian.json';

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
});
const skillId = (name: string) => [...index.skills.values()].find((s) => s.name === name)!.id;

function button(el: HTMLElement, text: string): HTMLButtonElement {
  const b = [...el.querySelectorAll('button')].find((x) => x.textContent?.replace(/\s+/g, ' ').trim().startsWith(text));
  if (!b) throw new Error(`No button "${text}"`);
  return b;
}

/** The search runs inline in tests (no Worker in jsdom), one task later. */
const searchDone = () => new Promise((resolve) => setTimeout(resolve));

describe('ArmorSearch', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: GameDataService, useValue: { index: signal(index), isLoading: signal(false), error: signal(undefined) } },
      ],
    });
  });

  it('adds a skill through the picker at its max level', async () => {
    const fixture = TestBed.createComponent(ArmorSearch);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('#search-add-skill')!;

    input.value = 'weakness exploit';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    // Options show what the skill does.
    expect(el.querySelector('#search-add-skill-opt-0 .desc')!.textContent).toBe(
      "Increases the affinity of attacks that exploit a monster's weak points and wounds.",
    );
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();

    expect(TestBed.inject(ArmorSearchService).settings().requirements).toEqual([{ skillId: skillId('Weakness Exploit'), level: 5 }]);
    expect(el.querySelector('.skills .name')!.textContent).toBe('Weakness Exploit');
    // The picker is empty again for the next skill.
    expect(el.querySelector<HTMLInputElement>('#search-add-skill')!.value).toBe('');
  });

  it('finds sets that reach the skills and equips one in the Builder', async () => {
    const store = TestBed.inject(ArmorSearchService);
    store.patch({
      requirements: [
        { skillId: skillId('Weakness Exploit'), level: 5 },
        { skillId: skillId('Agitator'), level: 5 },
      ],
    });
    const fixture = TestBed.createComponent(ArmorSearch);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    button(el, 'Search').click();
    await searchDone();
    await fixture.whenStable();

    const out = store.output()!;
    expect(out.found).toBeGreaterThan(0);
    expect(el.querySelectorAll('app-set-card')).toHaveLength(20);
    const requested = [...el.querySelectorAll('app-set-card')[0].querySelectorAll('.set-skills .requested')].map((li) => li.textContent?.trim());
    expect(requested).toEqual(expect.arrayContaining(['Weakness Exploit 5', 'Agitator 5']));

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    button(el, 'Equip in Builder').click();
    const saved = TestBed.inject(CurrentBuildService).saved();
    const best = out.results[0];
    for (const kind of ARMOR_KINDS) {
      expect(saved.armor[kind]).toBe(best.armor[kind].id);
      expect(saved.decorations[kind]).toEqual((best.decorations[kind] ?? []).map((d) => d?.id ?? null));
    }
    expect(saved.talismanId).toBe(best.talisman?.id ?? null);
    expect(navigate).toHaveBeenCalledWith('/builder');
  });

  it('uses the picked weapon and equips it in the Builder with its jewels', async () => {
    const store = TestBed.inject(ArmorSearchService);
    const current = TestBed.inject(CurrentBuildService);
    current.weaponKind.set('great-sword');
    store.patch({ requirements: [{ skillId: skillId('Critical Boost'), level: 5 }], weapon: { kind: 'long-sword', id: null } });
    const fixture = TestBed.createComponent(ArmorSearch);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.query .issue.warning')).not.toBeNull();

    const input = el.querySelector<HTMLInputElement>('#search-weapon')!;
    input.value = 'Tonitrus Clairblade';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    expect(store.settings().weapon).toEqual({ kind: 'long-sword', id: 'long-sword:9' });
    expect(el.querySelector('.query .issue.warning')).toBeNull();

    button(el, 'Search').click();
    await searchDone();
    await fixture.whenStable();
    const best = store.output()!.results[0];
    expect(best.decorations.weapon!.some((d) => d)).toBe(true);
    expect(el.querySelector('app-set-card .items th')!.textContent).toBe('Weapon');

    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    button(el, 'Equip in Builder').click();
    expect(current.weaponKind()).toBe('long-sword');
    expect(current.saved().weaponId).toBe('long-sword:9');
    expect(current.saved().decorations.weapon).toEqual(best.decorations.weapon!.map((d) => d?.id ?? null));
  });

  it('browses skills by category and toggles them', async () => {
    const store = TestBed.inject(ArmorSearchService);
    const fixture = TestBed.createComponent(ArmorSearch);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    button(el, 'Affinity').click();
    await fixture.whenStable();
    const names = [...el.querySelectorAll('.browse .name')].map((b) => b.textContent!.replace(/\s+/g, ' ').trim());
    expect(names).toEqual(expect.arrayContaining(['Weakness Exploit', 'Critical Boost W', 'Critical Eye W']));
    expect(names).not.toContain('Attack Boost W');
    const wex = [...el.querySelectorAll('.browse button')].find((b) => b.querySelector('.name')!.textContent!.trim() === 'Weakness Exploit')!;
    expect(wex.querySelector('.desc')!.textContent).toBe("Increases the affinity of attacks that exploit a monster's weak points and wounds.");

    // Set bonuses have no overall description: each rank's effect is shown.
    button(el, 'Set bonuses').click();
    await fixture.whenStable();
    const gore = [...el.querySelectorAll('.browse button')].find((b) => b.querySelector('.name')!.textContent!.trim() === "Gore Magala's Tyranny")!;
    expect([...gore.querySelectorAll('.desc')].map((d) => d.textContent)).toEqual([
      'Black Eclipse I (2 pieces): Infects you with Frenzy when against large monsters.',
      'Black Eclipse II (4 pieces): Infects you with Frenzy and raises attack when against large monsters. Attack power increases upon recovery.',
    ]);
    button(el, 'Affinity').click();
    await fixture.whenStable();

    button(el, 'Weakness Exploit').click();
    await fixture.whenStable();
    expect(store.settings().requirements).toEqual([{ skillId: skillId('Weakness Exploit'), level: 5 }]);
    expect(el.querySelector('.skills')!.previousElementSibling!.textContent).toBe('Affinity');
    expect(button(el, 'Affinity').textContent).toContain('1');

    button(el, 'Weakness Exploit').click();
    await fixture.whenStable();
    expect(store.settings().requirements).toEqual([]);
  });

  it('says so when no set reaches the skills', async () => {
    const store = TestBed.inject(ArmorSearchService);
    // A weapon skill with no weapon and no talismans cannot be reached.
    store.patch({ requirements: [{ skillId: skillId('Critical Element'), level: 1 }], weapon: { kind: 'long-sword', id: null }, talismans: 'none' });
    const fixture = TestBed.createComponent(ArmorSearch);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    button(el, 'Search').click();
    await searchDone();
    await fixture.whenStable();

    expect(el.querySelector('.status')!.textContent).toContain('No set reaches these skills');
  });
});

describe('ArmorSearchService', () => {
  it('migrates version 1 settings: useWeapon meant the Builder weapon', () => {
    localStorage.clear();
    localStorage.setItem('mhwet.builder.build.v1', JSON.stringify({ weaponId: 'long-sword:9', armor: {}, talismanId: null, decorations: {} }));
    localStorage.setItem(
      'mhwet.search.settings.v1',
      JSON.stringify({ requirements: [{ skillId: 1, level: 2 }], useWeapon: true, transcended: true, talismans: 'mine', rankBy: 'defense' }),
    );
    TestBed.configureTestingModule({
      providers: [{ provide: GameDataService, useValue: { index: signal(index), isLoading: signal(false), error: signal(undefined) } }],
    });
    expect(TestBed.inject(ArmorSearchService).settings()).toEqual({
      requirements: [{ skillId: 1, level: 2 }],
      weapon: { kind: 'long-sword', id: 'long-sword:9' },
      transcended: true,
      talismans: 'mine',
      rankBy: 'defense',
    });
  });
});
