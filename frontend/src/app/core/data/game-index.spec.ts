import { GameDataFiles, GogmaDevice, Weapon } from '../models/game-data';
import { LONG_SWORD } from '../testing/fixtures';
import { buildGameIndex } from './game-index';

function gogma(gameId: number, device: GogmaDevice, attack: number, affinity: number): Weapon {
  return {
    ...LONG_SWORD,
    id: `long-sword:${gameId}`,
    gameId,
    name: "Headsman's Hamus",
    attack,
    affinity,
    skills: [],
    artian: { tier: 'gogma', device, groupId: "long-sword:gogma:Headsman's Hamus" },
  };
}

function files(weapons: Weapon[]): GameDataFiles {
  return {
    skills: [],
    armor: [],
    decorations: [],
    talismans: [],
    weapons,
    huntingHorn: { melodies: [], songs: [], echoBubbles: [], echoWaves: [] },
    monsters: [],
    artian: {} as GameDataFiles['artian'],
    moves: { extracted: '', weapons: {} },
  };
}

describe('buildGameIndex', () => {
  it('groups Gogma Artian variants by device', () => {
    const attack = gogma(91, 'attack', 200, -10);
    const affinity = gogma(92, 'affinity', 180, 15);
    const element = gogma(99, 'element', 190, 0);
    const index = buildGameIndex(files([LONG_SWORD, attack, affinity, element]));

    expect([...index.gogmaGroups.keys()]).toEqual(["long-sword:gogma:Headsman's Hamus"]);
    expect(index.gogmaGroups.get("long-sword:gogma:Headsman's Hamus")).toEqual({ attack, affinity, element });
    // Variants stay individually addressable for saved builds and the solver.
    expect(index.weapons.get('long-sword:92')).toBe(affinity);
    expect(index.weaponsByKind.get('long-sword')).toHaveLength(4);
  });
});
