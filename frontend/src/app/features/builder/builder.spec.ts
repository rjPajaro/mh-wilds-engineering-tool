import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
      providers: [
        provideRouter([]),
        { provide: GameDataService, useValue: { index: signal(index), isLoading: signal(false), error: signal(undefined) } },
      ],
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

  it('shows the thumbnail of picked gear and hides images that fail to load', async () => {
    const sieglinde = index.files.weapons.find((w) => w.id === 'great-sword:8')!;
    const head = index.armorByKind.head.find((p) => p.thumbnail)!;
    const charm = index.files.talismans.find((t) => t.rarity === 6)!;
    const { fixture, api } = await mount();
    const el = fixture.nativeElement as HTMLElement;
    const images = () => [...el.querySelectorAll<HTMLImageElement>('img.thumb')].map((img) => img.getAttribute('src'));
    expect(images()).toEqual([]);

    api.setWeaponKind('great-sword');
    api.equip('weapon', sieglinde.id);
    api.equip('head', head.id);
    api.equip('talisman', charm.id);
    await fixture.whenStable();
    expect(images()).toEqual([
      'https://mhwilds.kiranico.net/tex_thumbnail/it0000_0008.webp',
      head.thumbnail,
      'https://monsterhunterwiki.org/images/7/70/MHWilds-Charm_Icon_Violet.png',
    ]);

    el.querySelector('img.thumb')!.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(images()).toEqual([head.thumbnail, charm.thumbnail]);
  });

  it('shows equipment and decoration icons beside their fields', async () => {
    const head = index.armorByKind.head.find((p) => p.slots[0] === 3 && p.rarity === 8)!;
    const jewel = index.files.decorations.find((d) => d.allowedOn === 'armor' && d.slotLevel === 2)!;
    const { fixture, api } = await mount();
    const el = fixture.nativeElement as HTMLElement;
    const headIcon = () => el.querySelector('#equip-head')!.closest('app-search-select')!.querySelector('img')!.getAttribute('src');
    const decoField = () => el.querySelector<HTMLElement>('.decos app-search-select')!;
    expect(headIcon()).toContain('MHWA-Helmet_Icon_Base');

    api.equip('head', head.id);
    await fixture.whenStable();
    expect(headIcon()).toContain('MHWA-Helmet_Icon_Rare_8');
    expect(decoField().querySelector('input')!.placeholder).toBe('Armor slot');
    expect(decoField().querySelector('img')!.getAttribute('src')).toContain('Decoration_Level_3-Armor_Icon_Gray');

    api.setDecoration('head', 0, String(jewel.id));
    await fixture.whenStable();
    expect(jewel.thumbnail).toContain('Decoration_Level_2-Armor_Icon_');
    expect(decoField().querySelector('img')!.getAttribute('src')).toBe(jewel.thumbnail);
    expect(decoField().querySelector('input')!.value).toBe(jewel.name);
  });

  it('transcends rarity 5+ armor, upgrading slots and keeping decorations that still fit', async () => {
    const pieces = index.files.armor.flatMap((s) => s.pieces);
    const chest = pieces.find((p) => p.name === 'G. Ebony Mail β')!;
    const head = pieces.find((p) => p.name === 'G. Ebony Helm α')!;
    const jewel1 = index.files.decorations.find((d) => d.allowedOn === 'armor' && d.slotLevel === 1)!;
    const { fixture, api } = await mount();
    const el = fixture.nativeElement as HTMLElement;
    const toggle = (slot: string) =>
      el.querySelector(`#equip-${slot}`)!.closest('.equip')!.querySelector<HTMLButtonElement>('button.transcend');
    const slotCount = (slot: string) => el.querySelector(`#equip-${slot}`)!.closest('.equip')!.querySelectorAll('.decos app-search-select').length;

    api.equip('chest', chest.id);
    api.equip('head', head.id);
    await fixture.whenStable();
    expect(chest.slots).toEqual([2, 2]);
    expect(slotCount('head')).toBe(0);

    toggle('chest')!.click();
    toggle('head')!.click();
    await fixture.whenStable();
    expect((api.build().armor['chest'] as { slots?: number[] }).slots).toEqual([3, 3]);
    expect(toggle('chest')!.textContent!.trim()).toBe('Transcended');
    expect(slotCount('head')).toBe(2); // no slots -> two level 1 slots

    api.setDecoration('head', 1, String(jewel1.id));
    toggle('head')!.click(); // back to no slots: the decoration goes
    await fixture.whenStable();
    expect(api.build().armor['head']?.id).toBe(head.id);
    expect(api.build().decorations['head']).toEqual([]);

    // Swapping to another eligible piece stays transcended.
    api.equip('chest', pieces.find((p) => p.name === 'G. Ebony Mail α')!.id);
    await fixture.whenStable();
    expect(api.build().armor['chest']?.id).toMatch(/:transcended$/);
  });

  it("lists each piece's set bonuses, then its skills with levels", async () => {
    const set = index.files.armor.find((s) => s.name === 'Arkveld γ')!;
    const helm = set.pieces.find((p) => p.name === 'Arkvulcan Helm γ')!;
    const { fixture, api } = await mount();
    const el = fixture.nativeElement as HTMLElement;
    const card = (slot: string) => el.querySelector(`#equip-${slot}`)!.closest('.equip')!.querySelector('.item-skills')!;
    const lines = (slot: string) => [...card(slot).querySelectorAll('li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());

    api.equip('head', helm.id);
    await fixture.whenStable();
    expect(lines('head')).toEqual(["Arkveld's Hunger", "Lord's Soul", 'Weakness Exploit 3']);
    expect(card('head').querySelectorAll('li.bonus')).toHaveLength(2);
    expect(card('head').querySelector('li.bonus.active')).toBeNull(); // one piece activates neither

    api.equip('chest', set.pieces.find((p) => p.kind === 'chest')!.id);
    await fixture.whenStable();
    expect(card('head').querySelector('li.bonus.active')?.textContent).toContain("Arkveld's Hunger");
  });

  it('shows what each active skill gives at its level', async () => {
    const skillId = (name: string) => index.files.skills.find((s) => s.name === name)!.id;
    const helm = index.files.armor.flatMap((s) => s.pieces).find((p) => p.name === 'Arkvulcan Helm γ')!;
    const burstPiece = index.files.armor
      .flatMap((s) => s.pieces)
      .find((p) => p.kind === 'chest' && p.skills.some((s) => s.skillId === skillId('Burst')))!;
    const burstLevel = burstPiece.skills.find((s) => s.skillId === skillId('Burst'))!.level;
    const { fixture, api } = await mount();
    const el = fixture.nativeElement as HTMLElement;
    const effect = (name: string) =>
      [...el.querySelectorAll('section.skills li')]
        .find((li) => li.querySelector('.name')?.textContent === name)
        ?.querySelector('.effect')
        ?.textContent!.replace(/\s+/g, ' ')
        .trim();

    api.setWeaponKind('great-sword');
    api.equip('head', helm.id);
    api.equip('chest', burstPiece.id);
    await fixture.whenStable();

    // Game text with numbers.
    expect(effect('Weakness Exploit')).toBe('Attacks that hit weak points gain affinity +15%, with an extra 10% on wounds.');
    // Researched numbers for the weapon type, with their source.
    const greatSword = ['Attack +10, element +80', 'Attack +12, element +100', 'Attack +14, element +120'][burstLevel - 1];
    expect(effect('Burst')).toBe(`${greatSword} · Game8 + Fextralife`);

    api.setWeaponKind('bow');
    await fixture.whenStable();
    expect(effect('Burst')).toBe(`${['Attack +6, element +40', 'Attack +7, element +60', 'Attack +8, element +80'][burstLevel - 1]} · Game8 + Fextralife`);
  });

  it('shows a skill tooltip with numbers by stat and level on hover and focus', async () => {
    const helm = index.files.armor.flatMap((s) => s.pieces).find((p) => p.name === 'Arkvulcan Helm γ')!;
    const { fixture, api } = await mount();
    const el = fixture.nativeElement as HTMLElement;
    api.equip('head', helm.id);
    await fixture.whenStable();
    const row = [...el.querySelectorAll<HTMLElement>('section.skills li')].find((li) => li.querySelector('.name')?.textContent === 'Weakness Exploit')!;
    const tip = () => document.body.querySelector('app-skill-tip-panel');
    const cells = (stat: string) =>
      [...tip()!.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('th')!.textContent === stat)!.querySelectorAll('td');

    row.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(tip()!.getAttribute('role')).toBe('tooltip');
    expect(row.getAttribute('aria-describedby')).toBe(tip()!.id);
    expect(tip()!.querySelector('.current')!.textContent).toBe('Lv 3 / 5');
    expect([...cells('Affinity')].map((td) => td.textContent)).toEqual(['+5%', '+10%', '+15%', '+20%', '+30%']);
    // The current level is highlighted.
    expect(cells('Affinity')[2].classList).toContain('on');
    expect(tip()!.textContent).toContain('When: Hitting a weak point');

    row.dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip()).toBeNull();

    // Keyboard: the skill can be focused, Escape closes the tooltip.
    expect(row.tabIndex).toBe(0);
    row.dispatchEvent(new FocusEvent('focusin'));
    expect(tip()).not.toBeNull();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tip()).toBeNull();

    // The gear card's skills have it too.
    const cardSkill = el.querySelector<HTMLElement>('#equip-head')!.closest('.equip')!.querySelector<HTMLElement>('.item-skills li:not(.bonus)')!;
    cardSkill.dispatchEvent(new MouseEvent('mouseenter'));
    expect(tip()!.querySelector('strong')!.textContent).toBe('Weakness Exploit');
    fixture.destroy();
    expect(tip()).toBeNull();
  });
});
