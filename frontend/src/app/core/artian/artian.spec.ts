import { buildGameIndex } from '../data/game-index';
import { ArtianData, GameDataFiles, Weapon } from '../models/game-data';
import {
  ArtianConfig,
  buildArtianWeapon,
  infusionLabel,
  isCustomWeapon,
  newArtianConfig,
  Reinforcement,
  validateArtian,
} from './artian';
import weapons from '../../../assets/data/weapons.json';
import artian from '../../../assets/data/artian.json';

const index = buildGameIndex({
  skills: [],
  armor: [],
  decorations: [],
  talismans: [],
  weapons: weapons as unknown as Weapon[],
  huntingHorn: { melodies: [], songs: [], echoBubbles: [], echoWaves: [] },
  monsters: [],
  artian: artian as unknown as ArtianData,
  moves: { extracted: '', weapons: {} },
} satisfies GameDataFiles);

function config(overrides: Partial<ArtianConfig>): ArtianConfig {
  return { ...newArtianConfig('great-sword', 'artian', 'test'), ...overrides };
}

const build = (c: ArtianConfig) => buildArtianWeapon(c, index);
const rf = (type: Reinforcement['type'], level: Reinforcement['level'] = 'I'): Reinforcement => ({ type, level });

describe('buildArtianWeapon: regular Artians', () => {
  it('builds a rarity 8 dragon attack infusion (3 dragon parts, 3 attack bonuses)', () => {
    const { weapon, issues } = build(config({ element: 'dragon', matchingParts: 3 }));
    expect(issues).toEqual([]);
    expect(weapon).toMatchObject({ id: 'custom:test', name: 'Varianza', kind: 'great-sword', rarity: 8, attack: 205, affinity: 5 });
    // 450 display + 30 infusion bonus = 48 true
    expect(weapon!.specials).toEqual([{ kind: 'element', element: 'dragon', value: 48, hidden: false }]);
    expect(isCustomWeapon(weapon)).toBe(true);
  });

  it('uses the rarity 6/7 value without infusion for two matching parts', () => {
    const { weapon } = build(config({ rarity: 7, element: 'water', matchingParts: 2, partBonuses: ['affinity', 'affinity', 'attack'] }));
    expect(weapon).toMatchObject({ name: 'Artian Blade II', attack: 185, affinity: 15 });
    expect(weapon!.specials[0]).toMatchObject({ element: 'water', value: 30 });
  });

  it('maps status parts to the weapon status (blast -> blastblight)', () => {
    const { weapon } = build(config({ kind: 'long-sword', element: 'paralysis' }));
    expect(weapon!.specials).toEqual([{ kind: 'status', status: 'paralysis', value: 10, hidden: false }]); // 70 + 30 infusion
    expect(build(config({ element: 'blast' })).weapon!.specials[0]).toMatchObject({ status: 'blastblight', value: 33 });
  });

  it('has no element when all parts differ', () => {
    expect(build(config({ element: null })).weapon!.specials).toEqual([]);
  });

  it('applies level I reinforcements', () => {
    const { weapon } = build(config({
      element: 'fire',
      reinforcements: [rf('attack'), rf('attack'), rf('affinity'), rf('element'), rf('sharpness')],
    }));
    expect(weapon).toMatchObject({ attack: 215, affinity: 10 });
    expect(weapon!.specials[0]).toMatchObject({ value: 48 + 8 }); // GS element boost +80 display
    // base GS R8 bar [80,40,60,80,70,20,0]: white +30
    expect(weapon!.sharpness).toEqual([80, 40, 60, 80, 70, 50, 0]);
  });

  it('rejects levels above I and impossible reinforcements', () => {
    const errors = (c: ArtianConfig) => validateArtian(c, index).filter((i) => i.severity === 'error').map((i) => i.message);
    expect(errors(config({ reinforcements: [rf('attack', 'EX')] }))[0]).toContain('not a possible level');
    expect(errors(config({ element: null, reinforcements: [rf('element')] }))[0]).toContain('needs an elemental');
    expect(errors(config({ kind: 'bow', reinforcements: [rf('sharpness')] }))[0]).toContain('only melee');
    expect(errors(config({ reinforcements: [rf('ammo')] }))[0]).toContain('only bowguns');
    expect(build(config({ reinforcements: [rf('attack', 'EX')] })).weapon).toBeNull();
  });

  it('warns past the observed limits but still builds', () => {
    const { weapon, issues } = build(config({ reinforcements: [rf('affinity'), rf('affinity'), rf('affinity'), rf('affinity')] }));
    expect(weapon?.affinity).toBe(25);
    expect(issues).toEqual([expect.objectContaining({ severity: 'warning' })]);
  });

  it('notes that bowgun and status-bow parts only change ammo/coatings', () => {
    const { weapon, issues } = build(config({ kind: 'light-bowgun', element: 'fire' }));
    expect(weapon!.specials).toEqual([]);
    expect(issues[0]).toMatchObject({ severity: 'info' });
    expect(build(config({ kind: 'bow', element: 'poison' })).weapon!.specials).toEqual([]);
    expect(build(config({ kind: 'bow', element: 'blast' })).weapon!.specials[0]).toMatchObject({ value: 8 }); // 60 + 20
  });
});

describe('infusionLabel', () => {
  it('names configs the way the game does', () => {
    expect(infusionLabel(config({ element: 'dragon' }))).toBe('Dragon Attack Infusion');
    expect(infusionLabel(config({ element: 'water', partBonuses: ['affinity', 'affinity', 'affinity'] }))).toBe('Water Affinity Infusion');
    expect(infusionLabel(config({ element: 'paralysis', partBonuses: ['attack', 'attack', 'affinity'] }))).toBe('Paralysis (Infusion) · 2 Atk / 1 Aff');
    expect(infusionLabel(config({ element: 'fire', matchingParts: 2 }))).toBe('Fire (2 parts) · Attack');
    expect(infusionLabel(config({ element: null }))).toBe('Non-elemental · Attack');
  });
});

describe('buildArtianWeapon: Gogma Artians', () => {
  const gogma = (overrides: Partial<ArtianConfig>) => config({ tier: 'gogma', ...overrides });

  it('starts from the game-data device variant and adds the device element change', () => {
    const { weapon } = build(gogma({ element: 'dragon', device: 'element' }));
    // data: element device 190 / 0; parts +15 atk; element 48 + 5 device
    expect(weapon).toMatchObject({ name: 'Ostrak Oblivion', attack: 205, affinity: 0 });
    expect(weapon!.specials[0]).toMatchObject({ element: 'dragon', value: 53 });
    expect(weapon!.artian).toMatchObject({ tier: 'gogma', device: 'element' });
  });

  it('builds a water affinity infusion on the affinity device', () => {
    const { weapon } = build(gogma({ kind: 'long-sword', element: 'water', device: 'affinity', partBonuses: ['affinity', 'affinity', 'affinity'] }));
    // data: affinity device 180 / 15; parts +15%; element 27 + 3 - 2
    expect(weapon).toMatchObject({ name: "Headsman's Hamus", attack: 180, affinity: 30 });
    expect(weapon!.specials[0]).toMatchObject({ value: 28 });
  });

  it('applies tiered reinforcements and limits EX per type', () => {
    const { weapon } = build(gogma({
      element: 'fire',
      reinforcements: [rf('attack', 'EX'), rf('attack', 'EX'), rf('affinity', 'III'), rf('element', 'EX'), rf('sharpness', 'EX')],
    }));
    expect(weapon).toMatchObject({ attack: 200 + 15 + 24, affinity: -10 + 8 });
    expect(weapon!.specials[0]).toMatchObject({ value: 48 + 11 });

    const issues = validateArtian(gogma({ reinforcements: [rf('attack', 'EX'), rf('attack', 'EX'), rf('attack', 'EX')] }), index);
    expect(issues.map((i) => i.message)).toContain('At most 2 EX attack reinforcements.');
  });

  it('adds the rolled set and group skills as one point each', () => {
    const { weapon } = build(gogma({ setSkillId: 111, groupSkillId: 222 }));
    expect(weapon!.skills).toEqual([{ skillId: 111, level: 1 }, { skillId: 222, level: 1 }]);
  });

  it('requires rarity 8', () => {
    expect(build(gogma({ rarity: 7 })).weapon).toBeNull();
  });

  it('has supplement data for every weapon type', () => {
    for (const kind of index.weaponsByKind.keys()) {
      expect(index.files.artian.gogmaDeviceElement[kind], kind).toBeDefined();
      expect(build(gogma({ kind })).weapon, kind).not.toBeNull();
      expect(build(config({ kind, rarity: 6 })).weapon, kind).not.toBeNull();
    }
  });
});
