#!/usr/bin/env node
// Finds a thumbnail for every weapon and armor piece and writes the image URLs
// to scripts/supplements/thumbnails.json. The app hotlinks them; nothing is
// downloaded into the app. Sources, in order of preference:
//
//   weapons  1. Kiranico      per-weapon icon (https://mhwilds.kiranico.com/data/weapons)
//            2. Fextralife    the weapon's wiki page image (Gogma Artians, newer gear)
//            3. MH Wiki       monsterhunterwiki.org render, for the few left
//   armor    1. Kiranico      per-piece icon (https://mhwilds.kiranico.com/data/armor-series)
//            2. gamertw       per-piece icon (https://mhwilds.gamertw.com/en/armor)
//            3. Fextralife    the piece's wiki page image
//   charms   MH Wiki          the charm icon in the colour of each rarity
//   decos    MH Wiki          the decoration's own icon (level, type, colour)
//   icons    MH Wiki          equipment type icons per rarity, empty slot icons
//
// Every URL is checked (Kiranico lists images it does not serve).
//
//   node scripts/extract-thumbnails.mjs            fetch pages, write thumbnails.json
//   node scripts/extract-thumbnails.mjs --offline  reuse .cache/thumbnails/
//
// Names come from ../mhdb-wilds-data/merged (read only), keys match import-data.mjs ids.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../mhdb-wilds-data/merged');
const OUT = join(here, 'supplements/thumbnails.json');
const CACHE = resolve(here, '../.cache/thumbnails');
const offline = process.argv.includes('--offline');
// Fextralife rejects requests that do not look like a browser.
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 mhwilds-engineering-tool' };

const KIRANICO = 'https://mhwilds.kiranico.com';
const KIRANICO_IMAGES = 'https://mhwilds.kiranico.net/tex_thumbnail/';
const FEXTRALIFE = 'https://monsterhunterwilds.wiki.fextralife.com/';
const MHWIKI_API = 'https://monsterhunterwiki.org/api.php?format=json&';
const GAMERTW = 'https://mhwilds.gamertw.com';

// Same files as import-data.mjs, in the game's weapon type order: Kiranico weapon
// images are it<TT>00_<NNNN>, TT = index here, NNNN = weapon game id.
const WEAPON_FILES = {
  'great-sword': 'GreatSword',
  'sword-shield': 'SwordShield',
  'dual-blades': 'DualBlades',
  'long-sword': 'LongSword',
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
const WEAPON_TYPES = Object.keys(WEAPON_FILES);
// Kiranico armor images end in _<P>; gamertw names pieces in its file names.
const ARMOR_PIECES = ['head', 'chest', 'arms', 'waist', 'legs'];
const GAMERTW_PIECES = { helm: 'head', body: 'chest', arm: 'arms', waist: 'waist', leg: 'legs' };

// ---------------------------------------------------------------- fetching

async function get(url, { json = false } = {}) {
  const cached = join(CACHE, createHash('sha1').update(url).digest('hex') + (json ? '.json' : '.html'));
  if (offline && existsSync(cached)) {
    const text = readFileSync(cached, 'utf8');
    return json ? JSON.parse(text) : text;
  }
  const res = await fetch(url, { headers: HEADERS });
  const text = res.ok ? await res.text() : '';
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cached, text);
  return json ? JSON.parse(text || 'null') : text;
}

async function parallel(items, fn, workers = 6) {
  let next = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  }));
}

/** HTTP status of each image URL; cached for --offline runs. */
const statusFile = join(CACHE, 'status.json');
const status = offline && existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')) : {};
async function served(urls) {
  await parallel(urls.filter((u) => !(u in status)), async (url) => {
    status[url] = (await fetch(url, { method: 'HEAD', headers: HEADERS })).status;
  }, 8);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(statusFile, JSON.stringify(status));
  return urls.filter((u) => status[u] === 200);
}

// ---------------------------------------------------------------- game data

const en = (names) => names?.en?.replace(/\s*\r?\n\s*/g, ' ').trim();
const loadSrc = (path) => JSON.parse(readFileSync(join(SRC, path), 'utf8'));

const weapons = Object.entries(WEAPON_FILES).flatMap(([kind, file]) =>
  loadSrc(`weapons/${file}.json`).map((w) => ({ id: `${kind}:${w.game_id}`, kind, gameId: w.game_id, name: en(w.names) })),
);
const armorSets = loadSrc('Armor.json').map((a) => ({
  name: en(a.names),
  pieces: a.pieces.map((p) => ({ id: `${a.game_id}:${p.kind}`, kind: p.kind, name: en(p.names) })),
}));

const found = { weapons: {}, armor: {} };
const counts = {};
function use(table, id, url, source) {
  found[table][id] = url;
  counts[`${table} from ${source}`] = (counts[`${table} from ${source}`] ?? 0) + 1;
}

// ---------------------------------------------------------------- 1. Kiranico

/** Kiranico's data is in Next.js flight chunks: self.__next_f.push([1,"<json string>"]). */
function payload(html) {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((m) => JSON.parse(m[1])).join('');
}
const STRING = String.raw`"((?:[^"\\]|\\.)*)"`;
const kiranicoSrc = (id) => String.raw`"src":"${KIRANICO_IMAGES.replaceAll('.', '\\.')}(${id})\.webp"`;
/** English text of a { type: "tx", props: { children: { ja, en, ... } } } node. */
const englishName = String.raw`"type":"tx","props":\{"children":\{[^}]*?"en":${STRING}`;

{
  // Weapons: image id -> name. The id encodes type and game id; the name confirms it.
  const listed = new Map();
  const data = payload(await get(`${KIRANICO}/data/weapons`));
  for (const m of data.matchAll(new RegExp(`${kiranicoSrc(String.raw`it\d{4}_\d+`)}.*?${englishName}`, 'gs'))) {
    listed.set(m[1], JSON.parse(`"${m[2]}"`));
  }
  const candidates = new Map();
  for (const w of weapons) {
    const image = `it${String(WEAPON_TYPES.indexOf(w.kind)).padStart(2, '0')}00_${String(w.gameId).padStart(4, '0')}`;
    if (!listed.has(image)) continue;
    if (listed.get(image) !== w.name) console.warn(`  kiranico ${image} is "${listed.get(image)}", ${w.id} is "${w.name}"; skipped`);
    else candidates.set(`${KIRANICO_IMAGES}${image}.webp`, w.id);
  }
  for (const url of await served([...candidates.keys()])) use('weapons', candidates.get(url), url, 'kiranico');
}
{
  // Armor: one table row per series, its name then a thumbnail per piece it has.
  const candidates = new Map();
  const data = payload(await get(`${KIRANICO}/data/armor-series`));
  const sets = new Map(armorSets.map((s) => [s.name, s]));
  for (const row of data.split('{"type":"tr"').slice(1)) {
    const name = row.match(new RegExp(englishName))?.[1];
    const set = name && sets.get(JSON.parse(`"${name}"`));
    if (!set) continue;
    for (const m of row.matchAll(new RegExp(kiranicoSrc(String.raw`ch\d+_\d+_\d+_\d+_(\d)`), 'g'))) {
      const piece = set.pieces.find((p) => p.kind === ARMOR_PIECES[Number(m[2])]);
      if (piece) candidates.set(`${KIRANICO_IMAGES}${m[1]}.webp`, piece.id);
    }
  }
  for (const url of await served([...candidates.keys()])) use('armor', candidates.get(url), url, 'kiranico');
}

// ---------------------------------------------------------------- 2. Fextralife (weapons)

{
  // One page per weapon name; its first content image (not an icon) is the weapon.
  // Some upgrades show their tree's image, which is close enough for a thumbnail.
  const missing = Map.groupBy(weapons.filter((w) => !found.weapons[w.id]), (w) => w.name);
  const candidates = new Map();
  await parallel([...missing.keys()], async (name) => {
    const html = await get(FEXTRALIFE + encodeURIComponent(name.replaceAll(' ', '_')));
    const url = [...html.matchAll(/src="(https:\/\/static0\.fextralifeimages\.com\/file\/monsterhunterwilds\/[0-9a-f]\/[0-9a-f]{2}\/[^"]+)"/g)]
      .map((m) => m[1])
      .find((u) => !/icon|skill|material/i.test(u));
    if (url) candidates.set(url, [...(candidates.get(url) ?? []), name]);
  }, 4);
  for (const url of await served([...candidates.keys()])) {
    for (const name of candidates.get(url)) for (const w of missing.get(name)) use('weapons', w.id, url, 'fextralife');
  }
}

// ---------------------------------------------------------------- 3. MH Wiki renders (weapons)

{
  const missing = weapons.filter((w) => !found.weapons[w.id]);
  if (missing.length) {
    // Files are "MHWilds-<Name>_Render_001.webp"; quotes may be typographic.
    const key = (name) => name.replace(/["“”]/g, '').replace(/[\s_]+/g, ' ').trim().toLowerCase();
    const files = new Map();
    let cont = '';
    do {
      const r = await get(`${MHWIKI_API}action=query&list=allimages&aiprefix=MHWilds-&ailimit=500${cont}`, { json: true });
      for (const i of r.query.allimages) {
        const m = i.name.match(/^MHWilds-(.+)_Render_001\.\w+$/);
        if (m && !files.has(key(m[1]))) files.set(key(m[1]), i.title);
      }
      cont = r.continue ? `&aicontinue=${encodeURIComponent(r.continue.aicontinue)}` : '';
    } while (cont);
    const titles = [...new Set(missing.map((w) => files.get(key(w.name))).filter(Boolean))];
    const thumbs = new Map();
    for (let i = 0; i < titles.length; i += 50) {
      // The API returns a ready-made small thumbnail URL; the renders themselves are 2048px.
      const batch = titles.slice(i, i + 50).join('|');
      const r = await get(`${MHWIKI_API}action=query&prop=imageinfo&iiprop=url&iiurlwidth=128&titles=${encodeURIComponent(batch)}`, { json: true });
      for (const p of Object.values(r.query.pages)) if (p.imageinfo) thumbs.set(p.title, p.imageinfo[0].thumburl);
    }
    const ok = new Set(await served([...thumbs.values()]));
    for (const w of missing) {
      const url = thumbs.get(files.get(key(w.name)));
      if (ok.has(url)) use('weapons', w.id, url, 'mhwiki');
    }
  }
}

// ---------------------------------------------------------------- 2. gamertw (armor)

{
  // Set pages are /en/armor/<set name, lowercased, spaces as dashes>; pieces are
  // /armors/<set>-<helm|body|arm|waist|leg>-<m|f>.webp. The male icon is used.
  const missing = armorSets.filter((s) => s.pieces.some((p) => !found.armor[p.id]));
  const candidates = new Map();
  await parallel(missing, async (set) => {
    const html = await get(`${GAMERTW}/en/armor/${encodeURIComponent(set.name.toLowerCase().replaceAll(' ', '-'))}`);
    for (const m of html.matchAll(/src="(\/armors\/[^"]+-(helm|body|arm|waist|leg)-m\.webp)"/g)) {
      const piece = set.pieces.find((p) => p.kind === GAMERTW_PIECES[m[2]]);
      if (piece && !found.armor[piece.id]) candidates.set(GAMERTW + encodeURI(decodeURI(m[1])), piece.id);
    }
  }, 4);
  for (const url of await served([...candidates.keys()])) use('armor', candidates.get(url), url, 'gamertw');
}

// ---------------------------------------------------------------- 3. Fextralife (armor)

{
  // Pages are named after the piece with Greek letters spelled out ("Regios_Helm_Beta");
  // the piece image's file name contains each word of it, in any order (type a = male).
  const GREEK = { α: 'Alpha', β: 'Beta', γ: 'Gamma' };
  const missing = armorSets.flatMap((s) => s.pieces).filter((p) => !found.armor[p.id]);
  const candidates = new Map();
  await parallel(missing, async (piece) => {
    const page = piece.name.replace(/[αβγ]/g, (c) => GREEK[c]).replaceAll(' ', '_');
    const html = await get(FEXTRALIFE + encodeURIComponent(page));
    const words = page.toLowerCase().replace(/[^a-z0-9_]/g, '').split('_').filter(Boolean);
    const url = [...html.matchAll(/src="(https:\/\/static0\.fextralifeimages\.com\/file\/monsterhunterwilds\/[^"]+)"/g)]
      .map((m) => m[1])
      .find((u) => words.every((w) => u.split('/').pop().toLowerCase().replace(/[^a-z0-9]/g, '').includes(w)));
    if (url) candidates.set(url, piece.id);
  }, 4);
  for (const url of await served([...candidates.keys()])) use('armor', candidates.get(url), url, 'fextralife');
}

// ---------------------------------------------------------------- charms (talismans)

// Charms share one icon tinted with their rarity's color. The wiki tints its base
// icon in the browser (Template:GameColorLookup, MHWilds Rare 1-8: #969696 #DEDEDE
// #A4C43B #47A33F #5CAEBB #575FD9 #9272E3 #C76D46); its images send no CORS headers,
// so the app cannot tint them. Use the closest pre-coloured "Charm Icon <Color>" file.
const CHARM_ICON_BY_RARITY = { 1: 'Gray', 2: 'White', 3: 'Light_Green', 4: 'Moss', 5: 'Light_Blue', 6: 'Violet', 7: 'Purple', 8: 'Vermilion' };
const charms = {};
{
  const titles = Object.values(CHARM_ICON_BY_RARITY).map((c) => `File:MHWilds-Charm_Icon_${c}.png`);
  const r = await get(`${MHWIKI_API}action=query&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(titles.join('|'))}`, { json: true });
  // The API reports titles with spaces.
  const urls = new Map(Object.values(r.query.pages).filter((p) => p.imageinfo).map((p) => [p.title.replaceAll(' ', '_'), p.imageinfo[0].url]));
  const ok = new Set(await served([...urls.values()]));
  for (const [rarity, color] of Object.entries(CHARM_ICON_BY_RARITY)) {
    const url = urls.get(`File:MHWilds-Charm_Icon_${color}.png`);
    if (ok.has(url)) charms[rarity] = url;
    else console.log(`no charm icon for rarity ${rarity} (${color})`);
  }
  counts['charm rarities from mhwiki'] = Object.keys(charms).length;
}

// ---------------------------------------------------------------- decorations

// The wiki has the in-game decoration icons: "Decoration Level <1-3>-<Armor|Sword> Icon <Color>".
// The data's icon_color names map one-to-one onto the wiki's colour names (checked
// against the wiki's MHWilds/Decorations list, which names each decoration's colour).
const DECORATION_COLORS = {
  purple: 'Purple', white: 'White', emerald: 'Emerald', sky: 'Light_Blue', pink: 'Pink', yellow: 'Yellow',
  blue: 'Blue', gray: 'Gray', red: 'Red', ivory: 'Tan', brown: 'Brown', lemon: 'Lemon', 'moss-green': 'Moss',
  rose: 'Rose', green: 'Green', ultramarine: 'Dark_Blue', vermilion: 'Vermilion', 'dark-purple': 'Dark_Purple',
  'sage-green': 'Light_Green',
};
const decorationIcon = (level, target, color) => `File:MHWilds-Decoration_Level_${level}-${target === 'weapon' ? 'Sword' : 'Armor'}_Icon_${color}.png`;
const decorations = {};
{
  const wanted = new Map(); // file title -> [setter]
  const want = (title, set) => wanted.set(title, [...(wanted.get(title) ?? []), set]);
  for (const d of loadSrc('Accessory.json')) {
    const color = DECORATION_COLORS[d.icon_color];
    if (!color) console.log(`  unknown decoration colour "${d.icon_color}" (${en(d.names)})`);
    else want(decorationIcon(d.level, d.allowed_on, color), (url) => (decorations[d.game_id] = url));
  }
  const titles = [...wanted.keys()];
  const urls = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50).join('|');
    const r = await get(`${MHWIKI_API}action=query&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(batch)}`, { json: true });
    // The API reports titles with spaces.
    for (const p of Object.values(r.query.pages)) if (p.imageinfo) urls.set(p.title.replaceAll(' ', '_'), p.imageinfo[0].url);
  }
  const ok = new Set(await served([...urls.values()]));
  for (const [title, setters] of wanted) {
    const url = urls.get(title);
    if (ok.has(url)) for (const set of setters) set(url);
    else console.log(`  no wiki icon ${title}`);
  }
  counts['decorations from mhwiki'] = Object.keys(decorations).length;
}

// ---------------------------------------------------------------- equipment type icons

// The in-game equipment icons (helmet, great sword, ...) tinted by rarity, from the
// wiki's shared "MHWA-<Type> Icon Rare <N>" files; "Base" is the untinted one, used
// for empty slots. Empty decoration slots use the grey decoration icon of their type
// and level.
const EQUIPMENT_ICON_TYPES = {
  head: 'Helmet', chest: 'Chestplate', arms: 'Armguards', waist: 'Waist', legs: 'Leggings',
  'great-sword': 'Great_Sword', 'long-sword': 'Long_Sword', 'sword-shield': 'Sword_and_Shield',
  'dual-blades': 'Dual_Blades', hammer: 'Hammer', 'hunting-horn': 'Hunting_Horn', lance: 'Lance',
  gunlance: 'Gunlance', 'switch-axe': 'Switch_Axe', 'charge-blade': 'Charge_Blade',
  'insect-glaive': 'Insect_Glaive', bow: 'Bow', 'heavy-bowgun': 'Heavy_Bowgun', 'light-bowgun': 'Light_Bowgun',
  talisman: 'Talisman',
};
const icons = { equipment: {}, emptySlots: { weapon: {}, armor: {} } };
{
  const wanted = new Map();
  for (const [kind, type] of Object.entries(EQUIPMENT_ICON_TYPES)) {
    icons.equipment[kind] = {};
    wanted.set(`File:MHWA-${type}_Icon_Base.webp`, (url) => (icons.equipment[kind].base = url));
    for (let rarity = 1; rarity <= 8; rarity++) wanted.set(`File:MHWA-${type}_Icon_Rare_${rarity}.png`, (url) => (icons.equipment[kind][rarity] = url));
  }
  for (const target of ['weapon', 'armor']) {
    for (const level of [1, 2, 3]) wanted.set(decorationIcon(level, target, 'Gray'), (url) => (icons.emptySlots[target][level] = url));
  }
  const titles = [...wanted.keys()];
  const urls = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50).join('|');
    const r = await get(`${MHWIKI_API}action=query&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(batch)}`, { json: true });
    for (const p of Object.values(r.query.pages)) if (p.imageinfo) urls.set(p.title.replaceAll(' ', '_'), p.imageinfo[0].url);
  }
  const ok = new Set(await served([...urls.values()]));
  for (const [title, set] of wanted) {
    if (ok.has(urls.get(title))) set(urls.get(title));
    else console.log(`  no wiki icon ${title}`);
  }
  counts['equipment icons from mhwiki'] = Object.values(icons.equipment).reduce((n, byRarity) => n + Object.keys(byRarity).length, 0);
}

// ---------------------------------------------------------------- write

const missingWeapons = weapons.filter((w) => !found.weapons[w.id]);
const missingArmor = armorSets.flatMap((s) => s.pieces).filter((p) => !found.armor[p.id]);
for (const [what, n] of Object.entries(counts)) console.log(`${what.padEnd(22)} ${String(n).padStart(5)}`);
if (missingWeapons.length) console.log(`no image for ${missingWeapons.length} weapon(s): ${missingWeapons.map((w) => w.name).join(', ')}`);
if (missingArmor.length) console.log(`no image for ${missingArmor.length} armor piece(s): ${missingArmor.map((p) => p.name).join(', ')}`);

const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
const result = {
  $comment:
    'Thumbnail URLs per weapon / armor piece id, found by scripts/extract-thumbnails.mjs. ' +
    'Hotlinked by the app. Do not edit by hand; re-run the script.',
  extracted: new Date().toISOString().slice(0, 10),
  sources: [`${KIRANICO}/data/weapons`, `${KIRANICO}/data/armor-series`, FEXTRALIFE, 'https://monsterhunterwiki.org/', `${GAMERTW}/en/armor`],
  weapons: sortKeys(found.weapons),
  armor: sortKeys(found.armor),
  /** Charm icon per rarity; every charm of that rarity uses it. */
  charmsByRarity: charms,
  /** Decoration icon per decoration game id. */
  decorations: sortKeys(decorations),
  /** Equipment type icons by rarity (and untinted "base"), and empty decoration slot icons. */
  icons,
};
writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(`wrote ${OUT}`);
