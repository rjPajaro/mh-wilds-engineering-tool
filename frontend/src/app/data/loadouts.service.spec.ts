import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { newArtianConfig } from '../core/artian/artian';
import { emptySavedBuild } from '../core/build/build';
import { CurrentBuildService } from './current-build.service';
import { CustomWeaponsService } from './custom-weapons.service';
import { DamageSettingsService } from './damage-settings.service';
import { GameDataService } from './game-data.service';
import { LoadoutsService } from './loadouts.service';

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: GameDataService, useValue: { index: signal(undefined), isLoading: signal(false), error: signal(undefined) } }],
  });
  return {
    loadouts: TestBed.inject(LoadoutsService),
    current: TestBed.inject(CurrentBuildService),
    artians: TestBed.inject(CustomWeaponsService),
    settings: TestBed.inject(DamageSettingsService),
  };
}

const hammerBuild = { ...emptySavedBuild(), weaponId: 'hammer:5', armor: { head: '1:head' }, decorations: { head: [42] } };

describe('LoadoutsService', () => {
  beforeEach(() => localStorage.clear());

  it('saves, tracks changes, overwrites and reloads a loadout', () => {
    const { loadouts, current, settings } = setup();
    current.weaponKind.set('hammer');
    current.saved.set(hammerBuild);
    settings.selectMonster('7');

    const saved = loadouts.saveAs('  Big Bang  ');
    expect(saved.name).toBe('Big Bang');
    expect(loadouts.activeId()).toBe(saved.id);
    expect(loadouts.dirty()).toBe(false);

    current.saved.update((b) => ({ ...b, armor: { ...b.armor, legs: '2:legs' } }));
    expect(loadouts.dirty()).toBe(true);
    loadouts.save();
    expect(loadouts.dirty()).toBe(false);
    expect(loadouts.loadouts()[0].build.armor.legs).toBe('2:legs');

    current.saved.set(emptySavedBuild());
    settings.selectMonster('');
    loadouts.load(saved.id);
    expect(current.saved().armor).toEqual({ head: '1:head', legs: '2:legs' });
    expect(settings.monsterId()).toBe('7');
  });

  it('renames and deletes; deleting the active loadout detaches the build', () => {
    const { loadouts } = setup();
    const a = loadouts.saveAs('A');
    loadouts.rename(a.id, 'B');
    expect(loadouts.loadouts()[0].name).toBe('B');
    loadouts.remove(a.id);
    expect(loadouts.loadouts()).toEqual([]);
    expect(loadouts.activeId()).toBe('');
  });

  it('restores a deleted Artian when loading a loadout that uses it', () => {
    const { loadouts, current, artians } = setup();
    const artian = newArtianConfig('lance', 'gogma', 'mine');
    artians.save(artian);
    current.saved.set({ ...emptySavedBuild(), weaponId: artian.id });
    const saved = loadouts.saveAs('Lance');

    artians.remove(artian.id);
    loadouts.load(saved.id);
    expect(artians.configs()).toEqual([artian]);
  });

  it('shares a build with its Artian and loads it elsewhere without duplicating the Artian', () => {
    const sender = setup();
    const artian = { ...newArtianConfig('sword-shield', 'gogma', 'x'), element: 'dragon' as const };
    sender.artians.save(artian);
    sender.current.weaponKind.set('sword-shield');
    sender.current.saved.set({ ...emptySavedBuild(), weaponId: artian.id, armor: { waist: '9:waist' } });
    sender.loadouts.saveAs('Dragon SnS');
    const url = sender.loadouts.shareUrl({ origin: 'https://example.github.io', pathname: '/tool/' });
    expect(url).toMatch(/^https:\/\/example\.github\.io\/tool\/#\/builder\?b=[A-Za-z0-9_-]+$/);
    const code = url.split('b=')[1];

    localStorage.clear();
    const friend = setup();
    const content = friend.loadouts.decode(code);
    expect(content.name).toBe('Dragon SnS');
    friend.loadouts.loadShared(content);
    const [received] = friend.artians.configs();
    expect(received).toMatchObject({ kind: 'sword-shield', element: 'dragon' });
    expect(received.id).not.toBe(artian.id);
    expect(friend.current.saved()).toMatchObject({ weaponId: received.id, armor: { waist: '9:waist' } });
    expect(friend.loadouts.activeId()).toBe('');

    // Opening the same link again reuses the Artian.
    friend.loadouts.saveShared(friend.loadouts.decode(code));
    expect(friend.artians.configs()).toHaveLength(1);
    expect(friend.loadouts.loadouts()[0]).toMatchObject({ name: 'Dragon SnS', build: { weaponId: received.id } });
  });

  it('exports and imports loadouts and Artians', () => {
    const source = setup();
    const artian = newArtianConfig('bow', 'artian', 'b');
    source.artians.save(artian);
    source.current.saved.set({ ...emptySavedBuild(), weaponId: artian.id });
    source.loadouts.saveAs('Bow');
    source.current.saved.set(hammerBuild);
    source.loadouts.saveAs('Hammer');
    const json = source.loadouts.exportJson();

    localStorage.clear();
    const target = setup();
    expect(target.loadouts.importJson(json)).toEqual({ loadouts: 2, artians: 1, skipped: 0 });
    const bow = target.loadouts.loadouts().find((l) => l.name === 'Bow')!;
    expect(target.artians.configs().map((c) => c.id)).toContain(bow.build.weaponId);

    // Importing the same file again adds the loadouts as new entries but not the Artian.
    expect(target.loadouts.importJson(json)).toMatchObject({ loadouts: 2, artians: 0 });
    expect(new Set(target.loadouts.loadouts().map((l) => l.id)).size).toBe(4);
  });
});
