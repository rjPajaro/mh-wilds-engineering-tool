import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { emptySavedBuild } from '../../../core/build/build';
import { CurrentBuildService } from '../../../data/current-build.service';
import { GameDataService } from '../../../data/game-data.service';
import { LoadoutsService } from '../../../data/loadouts.service';
import { LoadoutBar } from './loadout-bar';
import { SharedBuildBanner } from '../shared-build-banner/shared-build-banner';

const gameData = { index: signal(undefined), isLoading: signal(false), error: signal(undefined) };

function button(el: HTMLElement, text: string): HTMLButtonElement {
  const b = [...el.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`No button "${text}"`);
  return b;
}

describe('LoadoutBar', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: GameDataService, useValue: gameData }] });
  });

  it('saves the current build under a name, then saves changes and deletes', async () => {
    const current = TestBed.inject(CurrentBuildService);
    const loadouts = TestBed.inject(LoadoutsService);
    current.saved.set({ ...emptySavedBuild(), weaponId: 'hammer:5' });

    const fixture = TestBed.createComponent(LoadoutBar);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Unsaved changes');
    expect(button(el, 'Save').disabled).toBe(true); // nothing selected yet

    button(el, 'Save as…').click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('#loadout-name')!;
    input.value = 'Hammer KO';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(loadouts.loadouts().map((l) => l.name)).toEqual(['Hammer KO']);
    expect(el.textContent).not.toContain('Unsaved changes');
    expect(el.textContent).toContain('Saved as "Hammer KO".');

    current.saved.update((b) => ({ ...b, talismanId: '1:1' }));
    await fixture.whenStable();
    button(el, 'Save').click();
    await fixture.whenStable();
    expect(loadouts.loadouts()[0].build.talismanId).toBe('1:1');

    button(el, '⋯').click();
    await fixture.whenStable();
    button(el, 'Delete').click();
    await fixture.whenStable();
    button(el, 'Delete').click(); // confirm
    await fixture.whenStable();
    expect(loadouts.loadouts()).toEqual([]);
  });
});

describe('SharedBuildBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'builder', component: SharedBuildBanner }]), { provide: GameDataService, useValue: gameData }],
    });
  });

  it('loads a build from a share link and clears the code from the URL', async () => {
    const loadouts = TestBed.inject(LoadoutsService);
    const current = TestBed.inject(CurrentBuildService);
    current.weaponKind.set('lance');
    current.saved.set({ ...emptySavedBuild(), weaponId: 'lance:3', armor: { legs: '8:legs' } });
    loadouts.saveAs('Friend lance');
    const code = loadouts.shareCode();
    current.saved.set(emptySavedBuild());
    loadouts.detach();

    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/builder?b=${code}`);
    const el = harness.routeNativeElement!;
    expect(el.textContent).toContain('Shared build: Friend lance');
    expect(el.textContent).toContain('Lance');

    button(el, 'Load into Builder').click();
    await harness.fixture.whenStable();
    expect(current.saved()).toMatchObject({ weaponId: 'lance:3', armor: { legs: '8:legs' } });
    expect(TestBed.inject(Router).url).toBe('/builder');
    expect(el.textContent).not.toContain('Shared build');
  });

  it('explains invalid links', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/builder?b=not-a-real-code');
    expect(harness.routeNativeElement!.textContent).toContain("Couldn't open this shared build");
  });
});
