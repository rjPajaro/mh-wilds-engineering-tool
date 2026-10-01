import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { buildGameIndex } from '../../core/data/game-index';
import { ArmorSet, ArtianData, Decoration, Skill, Talisman, Weapon } from '../../core/models/game-data';
import { GameDataService } from '../../data/game-data.service';
import { Builder } from './builder';
import weapons from '../../../assets/data/weapons.json';
import armor from '../../../assets/data/armor.json';
import decorations from '../../../assets/data/decorations.json';
import talismans from '../../../assets/data/talismans.json';
import skills from '../../../assets/data/skills.json';
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

interface BuilderApi {
  setWeaponKind(kind: string): void;
  equip(slot: string, id: string): void;
  setDecoration(slot: string, i: number, id: string): void;
  setGogmaDevice(device: string): void;
  build(): { weapon: Weapon | null; armor: Record<string, { id: string } | null>; decorations: Record<string, ({ id: number } | null)[]> };
  weaponKind(): string;
}

describe('Builder persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: GameDataService, useValue: { index: signal(index), isLoading: signal(false), error: signal(undefined) } }],
    });
  });

  async function mount() {
    const fixture = TestBed.createComponent(Builder);
    await fixture.whenStable();
    return { fixture, api: fixture.componentInstance as unknown as BuilderApi };
  }

  it('restores gear, decorations and weapon type after a reload', async () => {
    const head = index.armorByKind.head.find((p) => p.slots.length > 0)!;
    const jewel = index.files.decorations.find((d) => d.allowedOn === 'armor' && d.slotLevel <= head.slots[0])!;
    const hammer = index.weaponsByKind.get('hammer')![5];

    const first = await mount();
    first.api.setWeaponKind('hammer');
    first.api.equip('weapon', hammer.id);
    first.api.equip('head', head.id);
    first.api.setDecoration('head', 0, String(jewel.id));
    await first.fixture.whenStable();
    first.fixture.destroy();

    // A fresh component reads everything back from storage.
    const second = await mount();
    expect(second.api.weaponKind()).toBe('hammer');
    expect(second.api.build().weapon?.id).toBe(hammer.id);
    expect(second.api.build().armor['head']?.id).toBe(head.id);
    expect(second.api.build().decorations['head'][0]?.id).toBe(jewel.id);
  });

  it('remembers the Gogma Artian device', async () => {
    const groupId = [...index.gogmaGroups.keys()].find((k) => k.startsWith('long-sword:'))!;
    const first = await mount();
    first.api.equip('weapon', groupId);
    first.api.setGogmaDevice('affinity');
    await first.fixture.whenStable();
    first.fixture.destroy();

    const second = await mount();
    expect(second.api.build().weapon?.artian).toMatchObject({ tier: 'gogma', device: 'affinity' });
  });
});
