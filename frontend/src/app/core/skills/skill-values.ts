import { Skill, WeaponKind } from '../models/game-data';

/**
 * Per-level numbers for skills whose in-game level text has none ("small / bigger /
 * huge stat boost"). Researched from guide sites, which test in the training area;
 * see `docs/SKILL-VALUES.md`. Element values use the in-game display scale (x10),
 * like the game's own skill text ("Fire attack +40").
 *
 * Skills whose game text already states numbers (Attack Boost, Agitator, ...) are
 * not listed: their text is shown as is.
 */

export interface ValueSource {
  name: string;
  url: string;
}

/** One stat across levels: values[level - 1], '' where a level does not change it. */
export interface StatRow {
  stat: string;
  values: readonly string[];
}

export interface WeaponGroup {
  /** Weapon types this row applies to; 'other' for every type not in another group. */
  kinds: readonly WeaponKind[] | 'other';
  /** Shown when no weapon is picked, e.g. "Great Sword, Hunting Horn". */
  label: string;
  /** What each level does, as one line. Index = level - 1. */
  levels: readonly string[];
  /** The same numbers by stat, when they split that way. */
  stats?: readonly StatRow[];
}

export interface ResearchedValues {
  groups: readonly WeaponGroup[];
  /** Conditions, durations and other details, shown under the levels. */
  note?: string;
  sources: readonly ValueSource[];
  /** True when two sources agree; false for one source or values the source marks as approximate. */
  confirmed: boolean;
  /** Row shown when no weapon is picked; default: the 'other' row. */
  withoutWeapon?: number;
}

const GAME8 = (archive: number): ValueSource => ({ name: 'Game8', url: `https://game8.co/games/Monster-Hunter-Wilds/archives/${archive}` });
const FEXTRALIFE = (page: string): ValueSource => ({ name: 'Fextralife', url: `https://monsterhunterwilds.wiki.fextralife.com/${page}` });

const HEAVY: readonly WeaponKind[] = ['great-sword', 'hammer', 'hunting-horn', 'gunlance', 'switch-axe', 'charge-blade'];
const HEAVY_LABEL = 'Great Sword, Hammer, Hunting Horn, Gunlance, Switch Axe, Charge Blade';
const RANGED: readonly WeaponKind[] = ['bow', 'light-bowgun', 'heavy-bowgun'];

/**
 * A group from stat rows (`[stat, level 1 value, level 2 value, ...]`); each level's line
 * is built from them: "Attack +10, element +80".
 */
const byStat = (kinds: WeaponGroup['kinds'], label: string, ...rows: [string, ...string[]][]): WeaponGroup => {
  const stats = rows.map(([stat, ...values]) => ({ stat, values }));
  const levels = stats[0].values.map((_, i) =>
    stats
      .filter((s) => s.values[i])
      .map((s, j) => `${j ? s.stat.toLowerCase() : s.stat} ${s.values[i]}`)
      .join(', '),
  );
  return { kinds, label, levels, stats };
};
const all = (...rows: [string, ...string[]][]): WeaponGroup[] => [byStat('other', 'All weapons', ...rows)];
/** For effects that do not split into stats: one line per level. */
const allText = (...levels: string[]): WeaponGroup[] => [{ kinds: 'other', label: 'All weapons', levels }];

export const RESEARCHED_SKILL_VALUES: Readonly<Record<string, ResearchedValues>> = {
  Burst: {
    groups: [
      byStat(['great-sword', 'hunting-horn'], 'Great Sword, Hunting Horn', ['Attack', '+10', '+12', '+14', '+16', '+18'], ['Element', '+80', '+100', '+120', '+160', '+200']),
      byStat(['dual-blades'], 'Dual Blades', ['Attack', '+8', '+10', '+12', '+15', '+18'], ['Element', '+40', '+60', '+80', '+100', '+120']),
      byStat(RANGED, 'Bow, bowguns', ['Attack', '+6', '+7', '+8', '+9', '+10'], ['Element', '+40', '+60', '+80', '+100', '+120']),
      byStat('other', 'Other weapons', ['Attack', '+8', '+10', '+12', '+15', '+18'], ['Element', '+60', '+80', '+100', '+120', '+140']),
    ],
    note: 'After 5 hits in a row. The first hit gives attack +5, element +50 (+30 for Bow and Dual Blades). Lasts about 3–5 s, depending on the weapon.',
    sources: [GAME8(501644), FEXTRALIFE('Burst')],
    confirmed: true,
  },
  'Critical Element': {
    groups: [
      byStat(HEAVY, HEAVY_LABEL, ['Element on crits', '×1.07 (approx.)', '×1.13 (approx.)', '×1.2']),
      byStat('other', 'Other weapons', ['Element on crits', '×1.05', '×1.1', '×1.15']),
    ],
    note: 'The damage calculator uses ×1.05 / 1.1 / 1.15 for every weapon.',
    sources: [GAME8(501573)],
    confirmed: false,
  },
  Coalescence: {
    groups: [
      byStat(HEAVY, HEAVY_LABEL, ['Element', '×1.1', '×1.2', '×1.3'], ['Status', '×1.05', '×1.1', '×1.15']),
      byStat('other', 'Other weapons', ['Element', '×1.05', '×1.1', '×1.15'], ['Status', '×1.05', '×1.1', '×1.15']),
    ],
    note: 'For 30 s after recovering from a blight or status ailment.',
    sources: [GAME8(501948)],
    confirmed: false,
  },
  'Charge Master': {
    groups: [
      byStat(['great-sword'], 'Great Sword', ['Element', '×1.175', '×1.25', '×1.3']),
      byStat(['lance'], 'Lance', ['Element', '×1.2', '×1.25', '×1.3']),
      byStat(['hammer', 'insect-glaive', 'charge-blade'], 'Hammer, Insect Glaive, Charge Blade', ['Element', '×1.15', '×1.2', '×1.25']),
      byStat(['sword-shield'], 'Sword & Shield', ['Element', '×1.05', '×1.1', '×1.15']),
      byStat(['gunlance'], 'Gunlance', ['Element', '×1.01', '×1.015', '×1.0175']),
      byStat(['bow'], 'Bow', ['Element', '×1.005', '×1.015', '×1.02']),
      { kinds: 'other', label: 'Other weapons', levels: ['No charged attacks listed', 'No charged attacks listed', 'No charged attacks listed'] },
    ],
    note: 'On charged attacks; also raises their status buildup. Fextralife lists element +15 / 20 / 25% (Great Sword, Hammer, Insect Glaive) and +5 / 10 / 15% (Bow) instead.',
    sources: [GAME8(501578), FEXTRALIFE('Charge+Master')],
    confirmed: false,
    withoutWeapon: 0,
  },
  Flayer: {
    groups: all(['Extra damage', '140', '160', '220', '300', '400']),
    note: 'Fixed non-elemental damage, whatever the weapon, on about half of the hits once enough damage builds up (Title Update 4 values).',
    sources: [GAME8(501647)],
    confirmed: false,
  },
  'Tetrad Shot': {
    groups: all(['Attack', '+3', '+6', '+10'], ['Affinity', '+8%', '+10%', '+12%']),
    note: 'On the 4th and 6th shots of a magazine; the affinity lasts until reload.',
    sources: [GAME8(501581)],
    confirmed: false,
  },
  'Opening Shot': {
    groups: all(['Attack', '+5', '+10', '+15']),
    note: 'On the first shot of a fully loaded magazine; also speeds up reloading.',
    sources: [GAME8(501583)],
    confirmed: false,
  },
  'Special Ammo Boost': {
    groups: all(['Special ammo damage', '+10%', '+20%']),
    note: 'Bowgun special ammo and Bow Dragon Piercer, Thousand Dragons and Tracer.',
    sources: [GAME8(501584)],
    confirmed: false,
  },
  'Normal Shots': { groups: all(['Damage', '+5%']), note: 'Normal ammo, normal arrows and Flying Swallow Shot.', sources: [GAME8(503080)], confirmed: false },
  'Piercing Shots': { groups: all(['Damage', '+5%']), note: 'Pierce ammo, Dragon Piercer and Thousand Dragons.', sources: [GAME8(503081)], confirmed: false },
  'Spread/Power Shots': { groups: all(['Damage', '+5%']), note: 'Spread ammo, Power Shots and Quick Shots.', sources: [GAME8(503082)], confirmed: false },
  Ballistics: {
    groups: allText('Longer critical range', 'Even longer critical range', 'Longest critical range, raw damage about +2% within it'),
    note: 'Bow range about ×1.15 / 1.25 / 1.4.',
    sources: [GAME8(501559)],
    confirmed: false,
  },
  Darkside: {
    groups: all(['Attack', "+10% of the weapon's base"]),
    note: 'For 30 s after a level 2 or 3 charged slash; costs about 1/8 of max health. 15 s cooldown.',
    sources: [GAME8(553787)],
    confirmed: false,
  },
  'Power Stone': {
    groups: allText('Attack +10 per Iron Ore or Earth Crystal, +15 per Carbalite Ore, +30 per Novacrystal (up to +90)'),
    note: 'For 90 s after the last ore mined; ends when switching weapons.',
    sources: [GAME8(545871)],
    confirmed: false,
  },
  Grillmaster: {
    groups: allText('Rare: affinity +10%, element +100 (90 s). Well-done: affinity +10%, element +300 (300 s). Burnt: element +300 (150 s)'),
    note: 'Depends on how the meat comes out on the Portable BBQ Grill.',
    sources: [GAME8(568611)],
    confirmed: false,
  },
  'Whiteflame Torrent': {
    groups: all(['Extra damage', '50 at random']),
    note: '2 s cooldown; about 15 damage while mounted.',
    sources: [GAME8(512816)],
    confirmed: false,
  },
  Synergy: {
    groups: all(['Affinity', '+15% for 45 s (+25% for 60 s with 4 Omega pieces)']),
    note: 'After a Rising Spiral Slash; also for nearby hunters.',
    sources: [GAME8(553789)],
    confirmed: false,
  },
  'Charge Up': {
    groups: all(['Charged attack damage', 'about +3%']),
    note: 'Hammer; also fewer hits needed for repeat stuns.',
    sources: [GAME8(501566)],
    confirmed: false,
  },
};

export interface SkillLevelValues {
  /** One line per level, level 1 first. */
  levels: { level: number; text: string }[];
  /** Researched values: where they come from. Absent for the game's own text. */
  researched?: {
    /** Which weapons the numbers are for. */
    weapons: string;
    /** True when the numbers differ by weapon type and no weapon was given. */
    varies: boolean;
    note?: string;
    sources: readonly ValueSource[];
    confirmed: boolean;
  };
  /** False when not one level states a number (vague game text, nothing researched). */
  numeric: boolean;
}

/**
 * What each level of a skill does, with numbers where known: researched values for
 * the weapon type (or the "other weapons" row without one), else the game's text.
 */
export function skillLevelValues(skill: Skill, weaponKind: WeaponKind | null): SkillLevelValues {
  const researched = RESEARCHED_SKILL_VALUES[skill.name];
  if (researched) {
    const other = researched.groups.find((g) => g.kinds === 'other') ?? researched.groups[0];
    const group = weaponKind
      ? (researched.groups.find((g) => g.kinds !== 'other' && g.kinds.includes(weaponKind)) ?? other)
      : (researched.groups[researched.withoutWeapon ?? -1] ?? other);
    return {
      levels: group.levels.map((text, i) => ({ level: i + 1, text })),
      researched: {
        weapons: group.label,
        varies: !weaponKind && researched.groups.length > 1,
        note: researched.note,
        sources: researched.sources,
        confirmed: researched.confirmed,
      },
      numeric: true,
    };
  }
  const levels = skill.ranks.map((r) => ({ level: r.level, text: r.description }));
  return { levels, numeric: levels.some((l) => /\d/.test(l.text)) };
}

export interface LevelEffect {
  text: string;
  researched?: SkillLevelValues['researched'];
}

/**
 * What a skill gives at `level`: the active rank's text for set and group bonuses, the
 * level's numbers otherwise. Null below level 1, or when the level has no numbers.
 */
export function levelEffect(skill: Skill, level: number, weaponKind: WeaponKind | null): LevelEffect | null {
  if (level <= 0) return null;
  if (skill.kind === 'set' || skill.kind === 'group') {
    const text = skill.ranks.find((r) => r.level === level)?.description;
    return text ? { text } : null;
  }
  const values = skillLevelValues(skill, weaponKind);
  if (!values.numeric) return null;
  const text = values.levels.find((l) => l.level === level)?.text;
  return text ? { text, researched: values.researched } : null;
}

/** "Game8 + Fextralife", or "Game8 (one source)" / "(sources differ)" when not confirmed. */
export function sourceText(researched: NonNullable<SkillLevelValues['researched']>): string {
  const names = researched.sources.map((s) => s.name).join(' + ');
  return researched.confirmed ? names : `${names} (${researched.sources.length > 1 ? 'sources differ' : 'one source'})`;
}
