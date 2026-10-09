#!/usr/bin/env node
// Imports game data from ../mhdb-wilds-data/merged into src/assets/data.
//
// - Every localized string map ({ ja, en, fr, ... }) is reduced to its `en` value.
// - Shapes are normalized to the types in src/app/core/models/game-data.ts.
// - Fields the app does not use (crafting, rewards, locations, ...) are dropped.
// - Referential integrity is checked; the script exits non-zero on bad data.
//
// The source folder is read-only reference data. Never write into it.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../mhdb-wilds-data/merged');
const OUT = resolve(here, '../src/assets/data');
const LANG = 'en';

const errors = [];
const warnings = [];

function load(path) {
  return toEnglish(JSON.parse(readFileSync(join(SRC, path), 'utf8')));
}

/** Recursively replaces localized maps with their English string. */
function toEnglish(value) {
  if (Array.isArray(value)) return value.map(toEnglish);
  if (value && typeof value === 'object') {
    if (LANG in value && 'ja' in value && typeof value[LANG] === 'string') {
      return cleanText(value[LANG]);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toEnglish(v);
    return out;
  }
  return value;
}

/** Game text uses CRLF hard wraps for the in-game text box; flatten them. */
function cleanText(text) {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}

/** `{ "123": 2 }` -> `[{ skillId: 123, level: 2 }]` */
function skillMap(map) {
  return Object.entries(map ?? {}).map(([id, level]) => ({ skillId: Number(id), level }));
}

const SHARPNESS_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'white', 'purple'];

// ---------------------------------------------------------------- skills

const skills = load('Skill.json').map((s) => ({
  id: s.game_id,
  name: s.names,
  description: s.descriptions ?? '',
  kind: s.kind,
  icon: s.icon,
  maxLevel: s.ranks.length,
  ranks: s.ranks.map((r) => ({
    level: r.level,
    description: r.descriptions ?? '',
    ...(r.names ? { name: r.names } : {}),
    ...(r.set_pieces_required != null ? { piecesRequired: r.set_pieces_required } : {}),
  })),
}));
const skillById = new Map(skills.map((s) => [s.id, s]));

function checkSkills(owner, list) {
  for (const { skillId, level } of list) {
    const skill = skillById.get(skillId);
    if (!skill) errors.push(`${owner}: unknown skill ${skillId}`);
    else if (level > skill.maxLevel && skill.kind !== 'set' && skill.kind !== 'group') {
      errors.push(`${owner}: ${skill.name} level ${level} exceeds max ${skill.maxLevel}`);
    }
  }
}

// ---------------------------------------------------------------- armor

const armorSets = load('Armor.json').map((a) => {
  const set = {
    id: a.game_id,
    name: a.names,
    rarity: a.rarity,
    setBonusSkillId: a.set_bonus?.skill_id ?? null,
    groupBonusSkillId: a.group_bonus?.skill_id ?? null,
    pieces: a.pieces.map((p) => ({
      id: `${a.game_id}:${p.kind}`,
      setId: a.game_id,
      kind: p.kind,
      name: p.names,
      rarity: a.rarity,
      defense: p.defense,
      resistances: p.resistances,
      slots: p.slots,
      skills: skillMap(p.skills),
    })),
  };
  for (const piece of set.pieces) {
    checkSkills(piece.name, piece.skills);
    for (const bonusId of [set.setBonusSkillId, set.groupBonusSkillId]) {
      if (bonusId != null && !piece.skills.some((s) => s.skillId === bonusId)) {
        warnings.push(
          `${piece.name}: set declares bonus ${skillById.get(bonusId)?.name ?? bonusId} but the piece does not carry it ` +
            `(skill resolver trusts piece skills)`,
        );
      }
    }
  }
  return set;
});

// ---------------------------------------------------------------- decorations

const decorations = load('Accessory.json').map((d) => {
  const deco = {
    id: d.game_id,
    name: d.names,
    rarity: d.rarity,
    slotLevel: d.level,
    allowedOn: d.allowed_on,
    skills: skillMap(d.skills),
  };
  checkSkills(deco.name, deco.skills);
  return deco;
});

// ---------------------------------------------------------------- talismans
// Amulet.json holds talismans ("... Charm I"). Charm.json is cosmetic weapon
// pendants and is intentionally not imported. Random talismans (is_random)
// carry no fixed skills; users enter those as custom talismans in the app.

const talismans = load('Amulet.json')
  .filter((a) => !a.is_random)
  .flatMap((a) =>
    a.ranks.map((r) => {
      const t = {
        id: `${a.game_id}:${r.level}`,
        name: r.names,
        rarity: r.rarity,
        slots: [],
        skills: skillMap(r.skills),
      };
      checkSkills(t.name, t.skills);
      return t;
    }),
  );

// ---------------------------------------------------------------- weapons

const WEAPON_FILES = {
  'great-sword': 'GreatSword',
  'long-sword': 'LongSword',
  'sword-shield': 'SwordShield',
  'dual-blades': 'DualBlades',
  hammer: 'Hammer',
  'hunting-horn': 'HuntingHorn',
  lance: 'Lance',
  gunlance: 'Gunlance',
  'switch-axe': 'SwitchAxe',
  'charge-blade': 'ChargeBlade',
  'insect-glaive': 'InsectGlaive',
  bow: 'Bow',
  'heavy-bowgun': 'HeavyBowgun',
  'light-bowgun': 'LightBowgun',
};

const weaponSeries = new Map(load('WeaponSeries.json').map((s) => [s.game_id, s.name ?? s.names]));

function weaponExtras(w) {
  switch (w.kind) {
    case 'gunlance':
      return { shell: w.shell, shellLevel: w.shell_level };
    case 'switch-axe':
      return { phial: w.phial.raw != null ? { kind: w.phial.kind, value: w.phial.raw } : { kind: w.phial.kind } };
    case 'charge-blade':
      return { phial: w.phial };
    case 'insect-glaive':
      return { kinsectLevel: w.kinsect_level };
    case 'hunting-horn':
      return { melodyId: w.melody_id, echoWaveId: w.echo_wave_id, echoBubbleId: w.echo_bubble_id };
    case 'bow':
      return { coatings: w.coatings };
    case 'light-bowgun':
      return { ammo: w.ammo.map(normalizeAmmo), specialAmmo: w.special_ammo ?? null };
    case 'heavy-bowgun':
      return { ammo: w.ammo.map(normalizeAmmo), specialAmmo: w.special_ammo ?? null };
    default:
      return {};
  }
}

function normalizeAmmo(a) {
  return { kind: a.kind, level: a.level, capacity: a.capacity, rapid: a.rapid ?? false };
}

/**
 * Artian weapons are assembled, not crafted: no series, no materials, no upgrade
 * parent. Gogma Artians are the Artian name that appears three times per weapon
 * type, once per production device. The device is identified by stats relative
 * to the other two: highest attack = attack device, highest affinity = affinity
 * device, the remaining one = element device.
 */
function isArtian(w) {
  return w.series_id == null && w.crafting?.previous_id == null && !Object.keys(w.crafting?.inputs ?? {}).length;
}

function tagArtians(kind, list, raw) {
  const artians = list.filter((_, i) => isArtian(raw[i]));
  const byName = Map.groupBy(artians, (w) => w.name);
  for (const [name, group] of byName) {
    if (group.length === 1) {
      group[0].artian = { tier: 'artian' };
      continue;
    }
    const groupId = `${kind}:gogma:${name}`;
    const attack = group.reduce((a, b) => (b.attack > a.attack ? b : a));
    const affinity = group.reduce((a, b) => (b.affinity > a.affinity ? b : a));
    const element = group.filter((w) => w !== attack && w !== affinity);
    if (group.length !== 3 || attack === affinity || element.length !== 1) {
      errors.push(`${kind}: cannot identify Gogma Artian devices for "${name}" (${group.length} entries)`);
      continue;
    }
    attack.artian = { tier: 'gogma', device: 'attack', groupId };
    affinity.artian = { tier: 'gogma', device: 'affinity', groupId };
    element[0].artian = { tier: 'gogma', device: 'element', groupId };
  }
  for (const w of list) w.artian ??= null;
  const regular = artians.filter((w) => w.artian?.tier === 'artian').length;
  const gogma = byName.size - regular;
  if (regular !== 3 || gogma !== 1) warnings.push(`${kind}: expected 3 Artians and 1 Gogma Artian, found ${regular} and ${gogma}`);
}

const weapons = Object.entries(WEAPON_FILES).flatMap(([kind, file]) => {
  const raw = load(`weapons/${file}.json`);
  const list = raw.map((w) => {
    if (w.kind !== kind) errors.push(`${file}.json: weapon ${w.game_id} has kind ${w.kind}`);
    const weapon = {
      // game_id is only unique within a weapon type.
      id: `${kind}:${w.game_id}`,
      gameId: w.game_id,
      kind,
      name: w.names,
      rarity: w.rarity,
      attack: w.attack_raw,
      affinity: w.affinity,
      defense: w.defense,
      slots: w.slots,
      specials: w.specials.map((s) =>
        s.kind === 'element'
          ? { kind: 'element', element: s.element, value: s.raw, hidden: s.hidden }
          : { kind: 'status', status: s.status, value: s.raw, hidden: s.hidden },
      ),
      sharpness: w.sharpness ? SHARPNESS_COLORS.map((c) => w.sharpness[c]) : null,
      handicraft: w.handicraft ?? null,
      skills: skillMap(w.skills),
      series: w.series_id != null ? (weaponSeries.get(w.series_id) ?? null) : null,
      previousId: w.crafting?.previous_id != null ? `${kind}:${w.crafting.previous_id}` : null,
      ...weaponExtras(w),
    };
    checkSkills(`${weapon.name} (${kind})`, weapon.skills);
    return weapon;
  });
  tagArtians(kind, list, raw);
  return list;
});

// ---------------------------------------------------------------- hunting horn

const huntingHorn = {
  melodies: load('weapons/HuntingHornMelodies.json').map((m) => ({
    id: m.game_id,
    notes: m.notes,
    songIds: m.songs,
  })),
  songs: load('weapons/HuntingHornSongs.json').map((s) => ({
    effectId: s.effect_id,
    name: s.names,
    notes: s.notes,
  })),
  echoBubbles: load('weapons/HuntingHornEchoBubbles.json').map((b) => ({ id: b.game_id, kind: b.kind, name: b.names })),
  echoWaves: load('weapons/HuntingHornEchoWaves.json').map((w) => ({ id: w.game_id, kind: w.kind, name: w.names })),
};

// ---------------------------------------------------------------- monsters

// Some entries have no English name (PartNames "hide" is `{}`); fall back to the key.
const partNames = new Map(
  load('PartNames.json')
    .filter((p) => typeof p.names === 'string' && p.names)
    .map((p) => [p.part, p.names]),
);
const speciesNames = new Map(load('Species.json').map((s) => [s.kind, s.names]));

/** "left-wing-arm-hide" -> "Left wing arm hide" */
function humanize(key) {
  const text = key.replace(/-/g, ' ');
  return text[0].toUpperCase() + text.slice(1);
}

const monsters = load('LargeMonsters.json').map((m) => {
  const parts = m.parts.map((p) => {
    if (!partNames.has(p.part)) warnings.push(`${m.names}: no English name for part "${p.part}", using "${humanize(p.part)}"`);
    return {
      part: p.part,
      name: partNames.get(p.part) ?? humanize(p.part),
      health: p.base_health,
      // Hitzone values in the source are fractions (0.65 = 65).
      hitzones: p.multipliers,
    };
  });
  // Distinct parts can share a display name. Zoh Shia has "head" and "head-hide",
  // both "Head", with different hitzones: add the part key. Many monsters also have
  // several unnamed "hide" regions with the same key: number them ("Hide 2").
  for (const group of Map.groupBy(parts, (p) => p.name).values()) {
    if (group.length < 2) continue;
    const name = group[0].name;
    const byKey = Map.groupBy(group, (p) => p.part);
    for (const p of group) {
      const sameKey = byKey.get(p.part);
      p.name = sameKey.length > 1 ? `${name} ${sameKey.indexOf(p) + 1}` : `${name} (${p.part})`;
    }
  }

  return {
    id: m.game_id,
    name: m.names,
    species: m.species,
    speciesName: speciesNames.get(m.species) ?? m.species,
    baseHealth: m.base_health,
    weaknesses: m.weaknesses.map(normalizeAffinity),
    resistances: m.resistances.map(normalizeAffinity),
    parts,
  };
});

function normalizeAffinity(w) {
  const out = { kind: w.kind };
  if (w.element) out.element = w.element;
  if (w.status) out.status = w.status;
  if (w.effect) out.effect = w.effect;
  if (w.level != null) out.level = w.level;
  if (w.condition) out.condition = w.condition;
  return out;
}

// ---------------------------------------------------------------- artian (supplement)
// Not in mhdb-wilds-data; researched values in scripts/supplements/artian.json
// (display units). Converted here to true units: element / 10.

const artianSource = JSON.parse(readFileSync(join(here, 'supplements/artian.json'), 'utf8'));
const ELEMENT_DISPLAY_SCALE = 10;
const ELEMENTS = ['fire', 'water', 'thunder', 'ice', 'dragon'];
const STATUS_GROUPS = { 'poison-blast': ['poison', 'blast'], 'paralysis-sleep': ['paralysis', 'sleep'], blast: ['blast'] };
const kinds = Object.keys(WEAPON_FILES);
const toTrue = (v) => (v == null ? null : v / ELEMENT_DISPLAY_SCALE);

function expandElements(kind, row) {
  if (row === null) return null;
  const values = {};
  for (const [key, pair] of Object.entries(row)) {
    if (key === 'infusionBonus') continue;
    const targets = key === 'element' ? ELEMENTS : (STATUS_GROUPS[key] ?? key.split('-'));
    for (const t of targets) values[t] = pair === null ? null : pair.map(toTrue);
  }
  for (const e of [...ELEMENTS, 'poison', 'paralysis', 'sleep', 'blast']) {
    if (!(e in values)) errors.push(`artian.json: ${kind} has no value for ${e}`);
  }
  return { values, infusionBonus: toTrue(row.infusionBonus) };
}

function perKind(table, name, map) {
  const out = {};
  for (const kind of kinds) {
    if (!(kind in table)) errors.push(`artian.json: ${name} is missing ${kind}`);
    else out[kind] = map(kind, table[kind]);
  }
  return out;
}

/** Drops "$source"-style note keys, which document the supplement but are not data. */
const withoutNotes = (table) => Object.fromEntries(Object.entries(table).filter(([k]) => !k.startsWith('$')));

const r = artianSource.reinforcement;
const artian = {
  parts: withoutNotes(artianSource.parts),
  elements: perKind(artianSource.elements, 'elements', expandElements),
  reinforcement: {
    slots: r.slots,
    maxSameEx: r.maxSameEx,
    attack: withoutNotes(r.attack),
    affinity: withoutNotes(r.affinity),
    sharpness: { I: r.sharpness.I, EX: r.sharpness.EX },
    insectGlaiveSharpnessI: r.sharpness.insectGlaiveI,
    ammo: withoutNotes(r.ammo),
    element: perKind(r.element, 'reinforcement.element', (_, row) =>
      row === null ? null : Object.fromEntries(Object.entries(row).map(([lvl, v]) => [lvl, toTrue(v)])),
    ),
    artianLimits: r.artianLimits,
  },
  gogmaDeviceElement: perKind(artianSource.gogmaDeviceElement, 'gogmaDeviceElement', (_, row) =>
    Object.fromEntries(Object.entries(row).map(([device, v]) => [device, toTrue(v)])),
  ),
  sources: artianSource.sources,
};

// ---------------------------------------------------------------- moves (supplement)
// Motion values from scripts/supplements/moves.json (see scripts/import-motion-values.mjs and
// scripts/extract-wiki-moves.mjs).

const movesSource = JSON.parse(readFileSync(join(here, 'supplements/moves.json'), 'utf8'));
const moves = { extracted: movesSource.extracted, weapons: {} };
for (const [kind, entry] of Object.entries(movesSource.weapons)) {
  if (!kinds.includes(kind)) errors.push(`moves.json: unknown weapon type ${kind}`);
  for (const move of entry.moves) {
    if (move.fixedSharpness && !SHARPNESS_COLORS.includes(move.fixedSharpness)) errors.push(`moves.json: ${kind} / ${move.name}: unknown sharpness ${move.fixedSharpness}`);
    for (const v of move.variants) {
      const where = `moves.json: ${kind} / ${move.name}${v.label ? ` [${v.label}]` : ''}`;
      if (!v.hits.length || v.hits.some((h) => !(h >= 0))) errors.push(`${where}: bad motion values ${JSON.stringify(v.hits)}`);
      for (const key of ['elementModifiers', 'statusModifiers']) {
        if (v[key] && v[key].length !== v.hits.length) errors.push(`${where}: ${key} length does not match hits`);
      }
      for (const ammo of v.requires?.ammo ?? []) {
        if (!weapons.some((w) => w.ammo?.some((a) => a.kind === ammo))) errors.push(`${where}: no weapon has ammo "${ammo}"`);
      }
    }
  }
  moves.weapons[kind] = entry;
}

// ---------------------------------------------------------------- thumbnails (supplement)
// Image URLs per weapon / armor piece id from scripts/supplements/thumbnails.json
// (see scripts/extract-thumbnails.mjs). The app hotlinks them; items without one
// show no image.

const thumbnailSource = JSON.parse(readFileSync(join(here, 'supplements/thumbnails.json'), 'utf8'));
const thumbnailMisses = [];
for (const [table, items] of [['weapons', weapons], ['armor', armorSets.flatMap((s) => s.pieces)]]) {
  const known = new Set(items.map((item) => item.id));
  for (const id of Object.keys(thumbnailSource[table])) {
    if (!known.has(id)) warnings.push(`thumbnails.json: ${table} has an image for unknown id ${id}`);
  }
  for (const item of items) {
    if (thumbnailSource[table][item.id]) item.thumbnail = thumbnailSource[table][item.id];
    else thumbnailMisses.push(item.name);
  }
}
for (const d of decorations) {
  if (thumbnailSource.decorations[d.id]) d.thumbnail = thumbnailSource.decorations[d.id];
  else thumbnailMisses.push(d.name);
}
for (const t of talismans) {
  if (thumbnailSource.charmsByRarity[t.rarity]) t.thumbnail = thumbnailSource.charmsByRarity[t.rarity];
  else thumbnailMisses.push(t.name);
}
if (thumbnailMisses.length) warnings.push(`no thumbnail for ${thumbnailMisses.length} item(s): ${thumbnailMisses.join(', ')}`);

// ---------------------------------------------------------------- write

const outputs = { skills, armorSets, decorations, talismans, weapons, huntingHorn, monsters, artian, moves };

/** Every display name must be a non-empty string; a missing translation yields `{}`. */
function checkNames(value, path) {
  if (Array.isArray(value)) return value.forEach((v, i) => checkNames(v, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (k === 'name' && (typeof v !== 'string' || !v)) errors.push(`${path}.name is ${JSON.stringify(v)}, expected text`);
    else checkNames(v, `${path}.${k}`);
  }
}
for (const [file, data] of Object.entries(outputs)) checkNames(data, file);

if (warnings.length) {
  console.warn(`${warnings.length} warning(s):`);
  for (const w of warnings) console.warn(`  - ${w}`);
}
if (errors.length) {
  console.error(`${errors.length} error(s), nothing written:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const files = {
  'skills.json': skills,
  'armor.json': armorSets,
  'decorations.json': decorations,
  'talismans.json': talismans,
  'weapons.json': weapons,
  'hunting-horn.json': huntingHorn,
  'monsters.json': monsters,
  'artian.json': artian,
  'moves.json': moves,
  // Equipment type icons per rarity, empty slot and charm icons; imported by the app directly.
  'icons.json': { ...thumbnailSource.icons, charms: thumbnailSource.charmsByRarity },
};
for (const [name, data] of Object.entries(files)) {
  const text = JSON.stringify(data);
  writeFileSync(join(OUT, name), text);
  console.log(`${name.padEnd(18)} ${String(Array.isArray(data) ? data.length : '-').padStart(5)} records  ${(text.length / 1024).toFixed(0)} KB`);
}
writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify({ source: 'mhdb-wilds-data/merged', language: LANG, files: Object.keys(files) }, null, 2),
);

// Sanity: the source folder must contain exactly what we expect.
const unexpected = readdirSync(SRC).filter(
  (f) => !['weapons', 'Accessory.json', 'Amulet.json', 'Armor.json', 'ArmorUpgrade.json', 'Charm.json', 'Item.json',
    'LargeMonsters.json', 'PartNames.json', 'Skill.json', 'Species.json', 'Stage.json', 'WeaponSeries.json'].includes(f),
);
if (unexpected.length) console.warn(`New source files not imported: ${unexpected.join(', ')}`);
