import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { buildGameIndex } from '../../core/data/game-index';
import { ARMOR_KINDS, ArmorSet, ArtianData, Decoration, Skill, Talisman, Weapon } from '../../core/models/game-data';
import { ArmorSearchService } from '../../data/armor-search.service';
import { CurrentBuildService } from '../../data/current-build.service';
import { GameDataService } from '../../data/game-data.service';
import { ArmorSearch } from './armor-search';
import type { ArmorSearchMessage, ArmorSearchRequest } from './armor-search.worker';
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

  it('finds the top sets by damage for the picked weapon', async () => {
    const store = TestBed.inject(ArmorSearchService);
    store.patch({ weapon: { kind: 'long-sword', id: null } });
    const fixture = TestBed.createComponent(ArmorSearch);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(button(el, 'Top 5 by damage').disabled).toBe(true);

    store.patch({ weapon: { kind: 'long-sword', id: 'long-sword:9' } });
    await fixture.whenStable();
    // No skills needed: damage skills are picked by the search.
    expect(button(el, 'Search').disabled).toBe(true);
    button(el, 'Top 5 by damage').click();
    await searchDone();
    await fixture.whenStable();

    expect(store.mode()).toBe('damage');
    expect(el.querySelector('.results h2')!.textContent).toBe('Top 5 by damage');
    expect(el.querySelector('#search-rank')).toBeNull();
    expect(el.querySelector('.status')!.textContent).toContain('against a neutral weak point');
    const cards = el.querySelectorAll('app-set-card');
    expect(cards).toHaveLength(5);
    const damage = [...cards].map((c) => Number(c.querySelector('.damage strong')!.textContent));
    expect(damage[0]).toBeGreaterThan(0);
    expect(damage).toEqual([...damage].sort((a, b) => b - a));
  });

  it('shows the progress the worker reports', async () => {
    // A stand-in worker the test answers by hand.
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent<ArmorSearchMessage>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      request: ArmorSearchRequest | null = null;
      terminated = false;
      constructor() {
        workers.push(this);
      }
      postMessage(request: ArmorSearchRequest) {
        this.request = request;
      }
      terminate() {
        this.terminated = true;
      }
      emit(message: ArmorSearchMessage) {
        this.onmessage!(new MessageEvent('message', { data: message }));
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const store = TestBed.inject(ArmorSearchService);
      store.patch({ requirements: [{ skillId: skillId('Weakness Exploit'), level: 5 }] });
      const fixture = TestBed.createComponent(ArmorSearch);
      await fixture.whenStable();
      const el = fixture.nativeElement as HTMLElement;

      button(el, 'Search').click();
      await fixture.whenStable();
      expect(workers[0].request!.kind).toBe('sets');
      expect(el.querySelector('.progress [role=progressbar]')!.getAttribute('aria-valuenow')).toBe('0');

      workers[0].emit({ type: 'progress', progress: { fraction: 0.42, phase: 'Searching armor sets' } });
      await fixture.whenStable();
      expect(el.querySelector('.progress-head')!.textContent).toContain('Searching armor sets…');
      expect(el.querySelector('.progress-head strong')!.textContent).toBe('42%');
      expect(el.querySelector('.progress .fill')!.getAttribute('style')).toContain('width: 42%');
      expect(button(el, 'Searching').textContent!.trim()).toBe('Searching… 42%');
      // Too early to estimate.
      expect(el.querySelector('.progress .hint')!.textContent).toContain('estimating time left');

      workers[0].emit({ type: 'done', output: { results: [], found: 0, timedOut: false, elapsedMs: 5 } });
      await fixture.whenStable();
      expect(el.querySelector('.progress')).toBeNull();
      expect(workers[0].terminated).toBe(true);
      expect(el.querySelector('.status')!.textContent).toContain('No set reaches these skills');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows each level's numbers for the picked weapon type", async () => {
    const store = TestBed.inject(ArmorSearchService);
    store.patch({ weapon: { kind: 'great-sword', id: null }, requirements: [{ skillId: skillId('Burst'), level: 3 }] });
    const fixture = TestBed.createComponent(ArmorSearch);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    // The picked skill shows what its chosen level does.
    expect(el.querySelector('.skills .effect')!.textContent).toBe('Attack +14, element +120');

    // Burst and Attack Boost are in the Attack category, open by default.
    const burst = [...el.querySelectorAll('.browse button')].find((b) => b.querySelector('.name')!.textContent!.trim() === 'Burst')!;
    const levels = [...burst.querySelectorAll('.lv')].map((l) => l.textContent!.trim());
    expect(levels[0]).toBe('Lv 1Attack +10, element +80');
    expect(levels).toHaveLength(5);
    expect(burst.querySelector('.source')!.textContent!.trim()).toBe('Great Sword, Hunting Horn · Game8 + Fextralife');

    // Another weapon type, other numbers.
    store.patch({ weapon: { kind: 'long-sword', id: null } });
    await fixture.whenStable();
    expect(el.querySelector('.skills .effect')!.textContent).toBe('Attack +12, element +100');

    // Game text with numbers is listed as is.
    const attack = [...el.querySelectorAll('.browse button')].find((b) => b.querySelector('.name')!.textContent!.trim().startsWith('Attack Boost'))!;
    expect(attack.querySelector('.lv')!.textContent!.trim()).toBe('Lv 1Attack +3');
    expect(attack.querySelector('.source')).toBeNull();
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
  it('estimates the time left from progress, capped by the time limit', () => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: GameDataService, useValue: { index: signal(index), isLoading: signal(false), error: signal(undefined) } }],
    });
    let worker: { onmessage: (event: { data: ArmorSearchMessage }) => void } | null = null;
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null;
        constructor() {
          worker = this as never;
        }
        postMessage() {}
        terminate() {}
      },
    );
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const store = TestBed.inject(ArmorSearchService);
      store.patch({ requirements: [{ skillId: skillId('Weakness Exploit'), level: 5 }] });
      store.search();
      const progress = (fraction: number, at: number) => {
        now = 1_000_000 + at;
        worker!.onmessage({ data: { type: 'progress', progress: { fraction, phase: 'Searching armor sets' } } });
        return store.progress()!;
      };

      // Too early: under 5% done.
      expect(progress(0.02, 2_000).remainingMs).toBeNull();
      // A quarter done in 3 s: about 9 s left.
      expect(progress(0.25, 3_000)).toEqual({ kind: 'sets', fraction: 0.25, phase: 'Searching armor sets', elapsedMs: 3_000, remainingMs: 9_000 });
      // Slow progress cannot outlast the 30 s time limit.
      expect(progress(0.3, 29_000).remainingMs).toBe(1_000);

      store.cancel();
      expect(store.progress()).toBeNull();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

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
