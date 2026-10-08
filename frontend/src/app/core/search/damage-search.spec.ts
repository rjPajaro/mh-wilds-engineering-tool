import { collectSkillSources } from '../build/build';
import { buildGameIndex } from '../data/game-index';
import { ArmorSet, ArtianData, Decoration, Skill, Talisman, Weapon } from '../models/game-data';
import { resolveSkills, skillLevel } from '../skills/skill-resolver';
import { ArmorSetResult, searchArmorSets, SearchProgress } from './armor-search';
import { damagePerHit, DamageSearchInput, searchDamageSets } from './damage-search';
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
const weapon = index.weapons.get('long-sword:9')!;

function input(overrides: Partial<DamageSearchInput> = {}): DamageSearchInput {
  return {
    requirements: [],
    skills: index.files.skills,
    armor: index.armorByKind,
    decorations: index.files.decorations,
    talismans: index.files.talismans,
    weapon,
    toggles: {},
    buffs: [],
    target: null,
    maxResults: 5,
    ...overrides,
  };
}

const activeSkills = (set: ArmorSetResult) =>
  resolveSkills(collectSkillSources({ weapon, armor: set.armor, talisman: set.talisman, decorations: set.decorations }), index.skills);

describe('searchDamageSets', () => {
  const out = searchDamageSets(input());

  it('values Antivirus only when something inflicts Frenzy', () => {
    const level = (name: string, lv: number) => {
      const skill = [...index.skills.values()].find((s) => s.name === name)!;
      return { skill, points: lv, level: lv, wasted: 0, sources: [] };
    };
    const antivirus = level('Antivirus', 3);
    const gore = level("Gore Magala's Tyranny", 1);
    expect(damagePerHit(input(), [antivirus])).toBe(damagePerHit(input(), []));
    expect(damagePerHit(input({ targetInflictsFrenzy: true }), [antivirus])).toBeGreaterThan(damagePerHit(input(), []));
    expect(damagePerHit(input(), [antivirus, gore])).toBeGreaterThan(damagePerHit(input(), [gore]));
  });

  it("raises Antivirus when Gore Magala's Tyranny is required", () => {
    const goreId = skillId("Gore Magala's Tyranny");
    const withGore = searchDamageSets(input({ requirements: [{ skillId: goreId, level: 1 }], maxResults: 1, timeLimitMs: 20_000 }));
    const best = activeSkills(withGore.results[0]);
    expect(skillLevel(best, goreId)).toBeGreaterThanOrEqual(1);
    expect(skillLevel(best, skillId('Antivirus'))).toBeGreaterThan(0);
  });

  it('returns the requested number of different sets, best damage first', () => {
    expect(out.timedOut).toBe(false);
    expect(out.results).toHaveLength(5);
    const damage = out.results.map((r) => r.damage!);
    expect(damage).toEqual([...damage].sort((a, b) => b - a));
    const builds = out.results.map((r) => [...Object.values(r.armor).map((p) => p.id), r.talisman?.id].join('|'));
    expect(new Set(builds).size).toBe(5);
  });

  it('reports the damage of the skills each set actually has', () => {
    for (const set of out.results) expect(set.damage).toBeCloseTo(damagePerHit(input(), activeSkills(set)), 9);
  });

  it('beats a hand-picked damage build', () => {
    const picked = searchArmorSets({
      ...input(),
      requirements: [
        { skillId: skillId('Weakness Exploit'), level: 5 },
        { skillId: skillId('Agitator'), level: 5 },
        { skillId: skillId('Maximum Might'), level: 3 },
      ],
      maxResults: 1,
      rankBy: 'slots',
    }).results[0];
    expect(out.results[0].damage!).toBeGreaterThan(damagePerHit(input(), activeSkills(picked)));
  });

  it('keeps the requested skills', () => {
    const evade = searchDamageSets(input({ requirements: [{ skillId: skillId('Evade Window'), level: 3 }] }));
    expect(evade.results.length).toBeGreaterThan(0);
    for (const set of evade.results) expect(skillLevel(activeSkills(set), skillId('Evade Window'))).toBeGreaterThanOrEqual(3);
    expect(evade.results[0].damage!).toBeLessThanOrEqual(out.results[0].damage!);
  });

  it('skips guard skills for weapons that cannot guard', () => {
    const bow = [...index.weapons.values()].find((w) => w.kind === 'bow' && w.slots.some((l) => l >= 3))!;
    const sets = searchDamageSets(input({ weapon: bow, toggles: { 'Offensive Guard': true }, maxResults: 1 }));
    expect(sets.results.length).toBe(1);
    const decos = Object.values(sets.results[0].decorations).flat();
    expect(decos.some((d) => d?.skills.some((s) => s.skillId === skillId('Offensive Guard')))).toBe(false);
   }, 20_000);

  it('finds nothing when the requested skills cannot be reached', () => {
    // A weapon skill with no weapon slots and no talismans.
    const none = searchDamageSets(
      input({ weapon: { ...weapon, slots: [] }, talismans: [], requirements: [{ skillId: skillId('Critical Element'), level: 1 }] }),
    );
    expect(none.results).toEqual([]);
  });

  it.each(['paralysis', 'blastblight'])('adds no element jewels for a %s weapon, only raw ones', (status) => {
    const statusWeapon = [...index.weapons.values()]
      .filter((w) => w.specials.some((s) => s.kind === 'status' && s.status === status))
      .sort((a, b) => b.rarity - a.rarity)[0];
    const elementSkills = new Set(['Fire Attack', 'Water Attack', 'Thunder Attack', 'Ice Attack', 'Dragon Attack', 'Critical Element'].map(skillId));
    const sets = searchDamageSets(input({ weapon: statusWeapon, maxResults: 3 }));
    expect(sets.results.length).toBeGreaterThan(0);
    for (const set of sets.results) {
      const jewels = Object.values(set.decorations).flat();
      expect(jewels.flatMap((d) => d?.skills ?? []).filter((s) => elementSkills.has(s.skillId))).toEqual([]);
      const skills = resolveSkills(collectSkillSources({ weapon: statusWeapon, armor: set.armor, talisman: set.talisman, decorations: set.decorations }), index.skills);
      expect(skillLevel(skills, skillId('Attack Boost')) + skillLevel(skills, skillId('Critical Boost'))).toBeGreaterThan(0);
    }
  }, 20_000);
});

describe('search progress', () => {
  // Each Date.now() call is `step` ms later; 100 or more makes every chance to report do so (100 ms throttle).
  const slowClock = (step: number) => {
    let now = 0;
    return vi.spyOn(Date, 'now').mockImplementation(() => (now += step));
  };
  afterEach(() => vi.restoreAllMocks());

  const checkFractions = (reports: SearchProgress[]) => {
    const fractions = reports.map((r) => r.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    for (const f of fractions) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  };

  it('reports the share of the armor search tree covered', () => {
    slowClock(1000);
    const reports: SearchProgress[] = [];
    const out = searchArmorSets(
      {
        ...input(),
        requirements: [
          { skillId: skillId('Weakness Exploit'), level: 5 },
          { skillId: skillId('Agitator'), level: 5 },
          { skillId: skillId('Maximum Might'), level: 3 },
        ],
        maxResults: 10,
        rankBy: 'slots',
        timeLimitMs: 1e12,
      },
      (p) => reports.push(p),
    );
    expect(out.timedOut).toBe(false);
    expect(reports.length).toBeGreaterThan(3);
    checkFractions(reports);
    expect(reports.at(-1)!.fraction).toBeGreaterThan(0.5);
    expect(reports[0].phase).toBe('Searching armor sets');
  });

  it('reports the damage search from start to finish', () => {
    // Small steps: the damage search gives each check its own 5 s limit.
    slowClock(100);
    const reports: SearchProgress[] = [];
    searchDamageSets(input({ timeLimitMs: 1e12 }), (p) => reports.push(p));
    checkFractions(reports);
    expect(reports[0].fraction).toBe(0);
    expect(reports.at(-1)!.fraction).toBe(1);
    expect(new Set(reports.map((r) => r.phase))).toEqual(new Set(['Raising damage skills', 'Finding the best sets', 'Done']));
  });
});
