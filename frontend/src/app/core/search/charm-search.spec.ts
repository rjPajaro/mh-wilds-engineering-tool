import { buildGameIndex } from '../data/game-index';
import { ArmorSet, ArtianData, Decoration, Skill, Talisman, TalismanRolls, Weapon } from '../models/game-data';
import { collectSkillSources } from '../build/build';
import { resolveSkills, skillLevel } from '../skills/skill-resolver';
import { ArmorSetResult } from './armor-search';
import { charmTalisman, CharmSearchInput, searchCharms, slotText } from './charm-search';
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
const weapon = index.weapons.get('long-sword:9')!;

function input(req: [string, number][], overrides: Partial<CharmSearchInput> = {}): CharmSearchInput {
  return {
    requirements: req.map(([name, level]) => ({ skillId: skillId(name), level })),
    skills: index.files.skills,
    armor: index.armorByKind,
    decorations: index.files.decorations,
    weapon,
    rolls: index.files.talismanRolls,
    maxResults: 10,
    ...overrides,
  };
}

const name = (id: number) => index.skills.get(id)!.name;
const WEX_AGI_MM_CB = [['Weakness Exploit', 5], ['Agitator', 5], ['Maximum Might', 3], ['Critical Boost', 5]] as [string, number][];

/** The set's skill levels with the charm in the talisman slot. */
function reaches(req: [string, number][], set: ArmorSetResult, charm: Talisman): boolean {
  const skills = resolveSkills(collectSkillSources({ weapon, armor: set.armor, talisman: charm, decorations: set.decorations }), index.skills);
  return req.every(([n, level]) => skillLevel(skills, skillId(n)) >= level);
}

describe('searchCharms', () => {
  it('says when the armor reaches the skills without a talisman', () => {
    const out = searchCharms(input([...WEX_AGI_MM_CB, ['Burst', 1]]));
    expect(out.withoutCharm).not.toBeNull();
    expect(out.results).toEqual([]);
  });

  it('finds the least demanding charms first, each with a set that works', () => {
    const req: [string, number][] = [...WEX_AGI_MM_CB, ['Attack Boost', 3]];
    const out = searchCharms(input(req));
    expect(out.withoutCharm).toBeNull();
    expect(out.timedOut).toBe(false);
    const [first] = out.results;
    // Attack Boost 2 and any armor slot: Historical, Secret or Golden Age Charm.
    expect(first.skills.map((s) => [name(s.skillId), s.level])).toEqual([['Attack Boost', 2]]);
    expect(first.slots).toEqual([{ level: 1, accepts: 'armor' }]);
    expect(first.rarities.map((r) => r.rarity).sort()).toEqual([6, 7, 8]);
    expect(first.chance).toBeGreaterThan(0.005);
    expect(first.chance).toBeLessThan(0.01);

    for (const r of out.results) expect(reaches(req, r.set, charmTalisman(r))).toBe(true);
    // Most likely first, and no listed charm is just a better version of another.
    expect(out.results.map((r) => r.chance)).toEqual([...out.results.map((r) => r.chance)].sort((a, b) => b - a));
    for (const a of out.results) {
      for (const b of out.results) {
        if (a === b) continue;
        const morePoints = b.skills.every((s) => (a.skills.find((t) => t.skillId === s.skillId)?.level ?? 0) >= s.level);
        expect(morePoints && slotText(a.slots).startsWith(slotText(b.slots))).toBe(false);
      }
    }
  });

  it('keeps only slots that fit a useful jewel, capped at its size', () => {
    // Only armor skills requested: weapon slots never matter; Agitator/Burst jewels are size 3.
    const out = searchCharms(input([...WEX_AGI_MM_CB, ['Burst', 5]]));
    expect(out.results.length).toBeGreaterThan(0);
    for (const r of out.results) expect(r.slots.every((s) => s.accepts === 'armor')).toBe(true);
    expect(out.results.some((r) => r.slots.some((s) => s.level === 3))).toBe(true);
  });

  it('returns nothing, without timing out, when no charm is enough', () => {
    const out = searchCharms(input([...WEX_AGI_MM_CB, ['Burst', 5], ['Critical Eye', 5]]));
    expect(out).toMatchObject({ withoutCharm: null, results: [], timedOut: false });
    expect(out.candidates).toBeGreaterThan(0);
  });

  it('needs requirements', () => {
    expect(searchCharms(input([]))).toMatchObject({ withoutCharm: null, results: [], checks: 0 });
  });

  it('builds a talisman from a result', () => {
    const t = charmTalisman({
      skills: [{ skillId: 1, level: 2 }],
      slots: [{ level: 1, accepts: 'weapon' }, { level: 1, accepts: 'armor' }],
      example: { rarity: 8, skills: [], slots: [], chance: 0 },
    });
    expect(t).toMatchObject({ name: 'Golden Age Charm', rarity: 8, skills: [{ skillId: 1, level: 2 }] });
    expect(t.id.startsWith('roll:')).toBe(true);
    expect(slotText(t.slots)).toBe('W1-1');
  });
});
