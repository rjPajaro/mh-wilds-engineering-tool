#!/usr/bin/env node
// Imports weapon motion values from the "Monster Hunter Wilds Motion Values" spreadsheet
// (one tab per weapon; data datamined by dtlnor, https://github.com/dtlnor/mhws-rcol-record)
// into scripts/supplements/moves.json.
//
//   node scripts/import-motion-values.mjs "<path>/Monster Hunter Wilds Motion Values (1.04.0).xlsx"
//   node scripts/import-motion-values.mjs <xlsx> --all        also replace the wiki weapons (WIKI_KINDS)
//   node scripts/import-motion-values.mjs <xlsx> --out=x.json write somewhere else (for comparing)
//
// Reads the .xlsx directly (download the Google Sheet as Microsoft Excel; a CSV export only
// holds one tab). Weapon types in WIKI_KINDS keep their wiki data unless --all is given.
// Rows it can't use are reported. Review the diff of moves.json, then run `npm run import-data`.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const xlsxPath = args.find((a) => !a.startsWith('--'));
const all = args.includes('--all');
const OUT = args.find((a) => a.startsWith('--out='))?.slice(6) ?? join(here, 'supplements/moves.json');
if (!xlsxPath) {
  console.error('usage: node scripts/import-motion-values.mjs <motion values .xlsx> [--all] [--out=file]');
  process.exit(1);
}

/** Weapon types whose motion values come from the wiki (scripts/extract-wiki-moves.mjs). */
const WIKI_KINDS = ['great-sword', 'sword-shield', 'hammer'];

const SHEETS = {
  GS: 'great-sword',
  LS: 'long-sword',
  SnS: 'sword-shield',
  DB: 'dual-blades',
  Hammer: 'hammer',
  HH: 'hunting-horn',
  Lance: 'lance',
  GL: 'gunlance',
  SA: 'switch-axe',
  CB: 'charge-blade',
  IG: 'insect-glaive',
  Bow: 'bow',
  LBG: 'light-bowgun',
  HBG: 'heavy-bowgun',
};
/** The sheet itself says bowgun numbers are rough. */
const APPROXIMATE = new Set(['light-bowgun', 'heavy-bowgun']);

// ---------------------------------------------------------------- xlsx reading

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip/xlsx file');
  const files = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const data = buf.subarray(start, start + size);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}

const unescapeXml = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], unescapeXml(m[2])]));
/** Text of <t> runs, leaving out phonetic (<rPh>) runs. */
const textOf = (xml) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

/** Sheet name -> rows of cell strings (cached formula results; empty string for blank cells). */
function readWorkbook(path) {
  const files = unzip(readFileSync(path));
  const rels = new Map([...files.get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attrs(m[0]).Id, attrs(m[0]).Target]));
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const sheets = new Map();
  for (const m of files.get('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const target = rels.get(a['r:id']).replace(/^\/?(xl\/)?/, 'xl/');
    const rows = [];
    for (const c of files.get(target).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const { r, t } = attrs(c[1]);
      const [, letters, row] = r.match(/^([A-Z]+)(\d+)$/);
      const col = [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const body = c[2] ?? '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = '';
      if (t === 's') value = shared[+v];
      else if (t === 'inlineStr') value = textOf(body);
      else if (t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = unescapeXml(v);
      (rows[+row - 1] ??= [])[col] = value;
    }
    sheets.set(a.name, Array.from(rows, (row) => Array.from(row ?? [], (x) => x ?? '')));
  }
  return sheets;
}

// ---------------------------------------------------------------- row parsing

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Number, or null for blanks and values marked uncertain ("?"). Rounds float noise (23.799999999999997). */
const num = (s) => {
  const t = clean(s);
  return t === '' || !/^-?\d+(\.\d+)?$/.test(t) ? null : Math.round(+t * 10000) / 10000;
};
const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'white', 'purple'];
const TYPOS = { Sucessful: 'Successful', Retibution: 'Retribution' };
const fixTypos = (s) => s.replace(/\w+/g, (w) => TYPOS[w] ?? w);

/**
 * Splits a sheet name into the move it belongs to and where it goes:
 *   "Strong Descending Slash 3 Lv1"   -> base "Strong Descending Slash", level 1, hit 3
 *   "Iai Spirit Slash 2 (Red)"        -> state "Red", hit 2
 *   "Spirit Release Slash 2 (x3)"     -> hit 2, repeated 3 times
 *   "Triple Thrust 1/2"               -> hits 1 and 2 (same values)
 *   "Power Encore 2"                  -> power version of Encore, hit 2
 * Roman numerals (I, II) are different inputs and stay in the name. A trailing " x3" only
 * means "3 arrows" on the Bow sheet (Hunting Horn's "Echo Wave Blunt x2" is a different wave).
 */
function parseName(raw, kind) {
  let base = fixTypos(clean(raw).replace(/^"+|"+$/g, '').replace(/""/g, '"').replace(/\*/g, ''));
  let level;
  let repeat = 1;
  let hits = null;
  const states = [];
  base = base.replace(/\s*\(x(\d+)\)/i, (_, n) => ((repeat = +n), ''));
  if (kind === 'bow') base = base.replace(/\s+x(\d+)$/i, (_, n) => ((repeat = +n), ''));
  base = base.replace(/\s+lv\s*(\d+)\b/i, (_, n) => ((level = +n), ''));
  base = base.replace(/\s*\(([^)]*)\)/g, (_, s) => (states.push(clean(s)), ''));
  // "Sword Double Slash 1/Triple Slash 2" names two moves; its numbers are not hits.
  if (!/\d\s*\/\s*[A-Za-z]/.test(base)) base = base.replace(/\s+(\d+(?:\/\d+)*)$/, (_, n) => ((hits = n.split('/').map(Number)), ''));
  let power = false;
  base = base.replace(/^Power\s+/, () => ((power = true), ''));
  return { base: clean(base), level, states, hits, repeat, power };
}

function sectionOf(kind, name, notes) {
  if (/^(seikret|dismount)/i.test(name)) return 'Riding Attacks';
  if (/^mount(ed)? /i.test(name)) return 'Mount';
  if (/sneak attack/i.test(name)) return 'Sneaking';
  if (/^underwater/i.test(name)) return 'Underwater';
  if (/clash/i.test(name)) return 'Power Clash';
  if (/focus strike/i.test(name)) return 'Focus Mode';
  if (/^from /i.test(notes)) return 'Equipment Skills';
  if (kind === 'charge-blade' && /^phial burst/i.test(name)) return 'Phial Bursts';
  const mode = (kind === 'switch-axe' || kind === 'charge-blade') && name.match(/^(Axe|Sword) /);
  if (mode) return `${mode[1]} Mode`;
  if (kind === 'switch-axe' || kind === 'charge-blade') return 'Other Attacks';
  return 'Attacks';
}

/** Flags and requirement read from a row's notes and columns. */
function rowFlags(notes, sharpness, canCrit) {
  const flags = {};
  if (/\bblunt\b/i.test(notes)) flags.damageType = 'blunt';
  else if (/\b(sever|slicing)\b/i.test(notes)) flags.damageType = 'slash';
  if (/hitzone-ignoring/i.test(notes)) flags.ignoresHitzone = true;
  if (/^no$/i.test(clean(canCrit))) flags.canCrit = false;
  const color = clean(sharpness).toLowerCase();
  const asIf = notes.match(/as if it was (\w+) sharpness/i)?.[1].toLowerCase();
  if (COLORS.includes(color)) flags.fixedSharpness = color;
  else if (COLORS.includes(asIf)) flags.fixedSharpness = asIf;
  return flags;
}

/**
 * One usable sheet row: { name, mv, element, status, notes, flags, requires?, fixedDamage?, section?, parsed? }.
 * element/status are modifiers (0 when the value is fixed instead of scaling with the weapon).
 * `parsed` replaces parseName(name) for rows whose name doesn't follow the move-list conventions.
 */
function makeRow(name, mv, element, status, notes, flags, extra = {}) {
  return { name, mv, element, status, notes, flags, ...extra };
}

/** Melee sheets and Bow: one row per hit, columns found by header name. */
function standardRows(rows, kind, report) {
  const header = rows[0].map(clean);
  const col = (re) => header.findIndex((h) => re.test(h));
  const c = {
    name: col(/^Attack$/),
    mv: col(/^Motion Value/),
    element: col(/^Element/),
    status: col(/^Status/),
    sharpness: col(/^Sharpness/),
    crit: col(/^Can Crit/),
    notes: col(/^Notes/),
  };
  if (c.name < 0 || c.mv < 0) throw new Error(`unexpected header: ${header.join(' | ')}`);
  // Bow: footnotes ("*Pierce Coating applies...") explain the starred names.
  const footnotes = rows.map((r) => clean(r[c.name])).filter((n) => n.startsWith('*'));
  const out = [];
  for (const row of rows.slice(1)) {
    const name = clean(row[c.name]);
    if (!name || name.startsWith('*')) continue;
    // Insect Glaive: "Kinsect attacks scale with Kinsect stats:" starts the Kinsect's own table.
    if (name.endsWith(':')) {
      report.push(`stopped at "${name}" (the rest does not scale with the weapon)`);
      break;
    }
    const notes = clean(row[c.notes]);
    if (/\b(unavailable|unused|not used)\b/i.test(name) || /not available/i.test(notes)) continue;
    const mv = num(row[c.mv]);
    if (mv === null) {
      report.push(`${name}: motion value "${clean(row[c.mv])}"`);
      continue;
    }
    const elementText = clean(row[c.element]);
    let element = num(elementText);
    const fixedElement = element === null && elementText !== '';
    if (fixedElement || /elemental value is fixed/i.test(notes)) element = 0;
    let status = num(row[c.status]);
    if (/status value is fixed/i.test(notes)) status = 0;
    if (mv === 0 && (element ?? 1) === 0) {
      report.push(`${name}: no damage (${elementText || 'MV 0'})`);
      continue;
    }
    const rowNotes = [notes, fixedElement ? `Fixed ${elementText} element, not calculated` : '', ...(name.includes('*') ? footnotes.map((f) => f.slice(1)) : [])]
      .filter(Boolean)
      .join(' ');
    const extra = {};
    // Gunlance Wyrmstake ticks depend on shell type and level.
    const stake = kind === 'gunlance' && name.match(/^((?:Normal|Wide|Long)(?:\/(?:Normal|Wide|Long))*) Wyrmstake Lv(\d+)/i);
    if (stake) extra.requires = { shell: stake[1].toLowerCase().split('/'), level: +stake[2] };
    // Charge Blade lists Phial Bursts twice: impact phial (motion values), then element phial (element only).
    if (kind === 'charge-blade' && /^phial burst/i.test(name)) extra.requires = { phial: mv > 0 ? 'impact' : 'element' };
    out.push(makeRow(name, mv, element ?? 1, status ?? 1, rowNotes, rowFlags(notes, row[c.sharpness], row[c.crit]), extra));
  }
  return out;
}

const AMMO = {
  Normal: ['normal'],
  Pierce: ['pierce'],
  Spread: ['spread'],
  Slicing: ['slicing'],
  Sticky: ['sticky'],
  Cluster: ['cluster'],
  Element: ['flaming', 'water', 'thunder', 'freeze'],
  Dragon: ['dragon'],
  'Wyvern Ammo': ['wyvern'],
};
/** Status ammo is for status buildup, not damage. */
const STATUS_AMMO = /^(Status|Exhaust)\b/;

/**
 * Bowgun sheets. Ammo rows ("Normal Lv2") become "<kind> Ammo" moves with a variant per level
 * (and per Rapid Fire on Light Bowgun) that needs the weapon to carry that ammo. The rest
 * (Wyvernblast, Jumping Reload...) are ordinary moves. Only the raw part is calculated: ammo
 * element is a fixed value, and bowguns have no weapon element.
 */
function bowgunRows(rows, kind, report) {
  const light = kind === 'light-bowgun';
  const header = rows[light ? 1 : 0].map(clean);
  const notesCol = header.lastIndexOf('Notes');
  const out = [];
  for (const row of rows.slice(light ? 2 : 1)) {
    const name = clean(row[0]);
    if (!name || name === '-') continue;
    // Below the ammo table the columns are Name | Raw | Element | KO | Notes.
    const notes = clean(row[notesCol]) || clean(row[4]);
    if (/not available/i.test(notes)) continue;
    const parsed = parseName(name, kind);
    const { base, level } = parsed;
    if (STATUS_AMMO.test(base)) {
      report.push(`${name}: status ammo, no damage to calculate`);
      continue;
    }
    const flags = rowFlags(notes, '', '');
    const ammo = AMMO[base.replace(/^(\w+).*$/, '$1')] ?? AMMO[base];
    const element = 0;
    if (!ammo) {
      const mv = num(row[1]);
      if (mv === null) report.push(`${name}: raw "${clean(row[1])}"`);
      else out.push(makeRow(name, mv, element, 1, notes, flags));
      continue;
    }
    const ammoNotes = [notes, num(row[2]) ? 'Ammo element not calculated' : ''].filter(Boolean).join('. ');
    const shots = [{ col: 1, rapid: false }, ...(light ? [{ col: 4, rapid: true }] : [])];
    for (const { col, rapid } of shots) {
      const mv = num(row[col]);
      if (mv === null) {
        if (clean(row[col])) report.push(`${name}${rapid ? ' (Rapid Fire)' : ''}: raw "${clean(row[col])}"`);
        continue;
      }
      // "Shoots 3 bullets": one use is several hits. Pierce hits "up to N times" with falloff, so it stays one.
      const bullets = +(notes.match(/Shoots (\d+) bullets/i)?.[1] ?? 1);
      out.push(
        makeRow(name, mv, element, 1, ammoNotes, flags, {
          parsed: { ...parsed, base: `${base} Ammo`, states: rapid ? ['Rapid Fire'] : [], repeat: parsed.repeat * bullets },
          requires: { ammo, ...(level !== undefined ? { level } : {}), ...(rapid ? { rapid: true } : {}) },
          section: 'Ammo',
        }),
      );
    }
  }
  return out;
}

/**
 * Gunlance shelling: raw part ignores hitzones, plus fixed fire damage. Each shell type has a
 * variant per shell level; the weapon's shell type and level pick one. Like earlier games,
 * shells are assumed not to crit or scale with sharpness (yellow = x1.0 raw).
 */
function shellingRows(rows, report) {
  const out = [];
  for (const row of rows.slice(1)) {
    const name = clean(row[0]);
    if (!name) continue;
    const notes = clean(row[5]);
    if (/not available/i.test(notes)) continue;
    const mv = num(row[1]);
    const fire = num(row[2]);
    const level = +(name.match(/Lv(\d+)/i)?.[1] ?? NaN);
    const shell = name.match(/\b(Normal|Wide|Long)\b/)?.[1].toLowerCase();
    if (mv === null || fire === null || !shell || !level) {
      report.push(`shelling ${name}: not understood`);
      continue;
    }
    out.push(
      makeRow(name, mv, 0, 0, notes, { ignoresHitzone: true, canCrit: false, fixedSharpness: 'yellow' }, {
        parsed: { base: clean(name.replace(/\s*\([^)]*\)/, '').replace(/\s+Lv\d+/i, '')), level, states: [], hits: null, repeat: 1, power: false },
        requires: { shell: [shell], level },
        fixedDamage: fire,
        section: 'Shelling',
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------- grouping rows into moves

const sameFlags = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const describeFlags = (f) =>
  [f.damageType, f.ignoresHitzone && 'hitzone-ignoring', f.canCrit === false && 'no crit', f.fixedSharpness && `${f.fixedSharpness} sharpness`].filter(Boolean).join(', ');

/** Groups rows into moves: hits of one attack together, charge levels and states as variants. */
function buildMoves(kind, rows, report) {
  const moves = new Map();
  for (const row of rows) {
    const p = row.parsed ?? parseName(row.name, kind);
    const section = row.section ?? sectionOf(kind, p.base, row.notes);
    const labelParts = [p.level !== undefined ? `LV ${p.level}` : null, ...p.states, p.power ? 'Power' : null];
    const label = labelParts.filter(Boolean).join(', ');
    const requiresKey = row.requires ? JSON.stringify(row.requires) : '';
    // Rows needing different phials are different moves (Charge Blade lists Phial Bursts twice).
    // So are hits with another damage type or hitzone rule than the move's first row
    // (Insect Glaive's Descending Thrust has one blunt hit): flags are per move.
    const first = moves.get(`${section}|${p.base}|${row.requires?.phial ?? ''}`);
    const odd = first && !sameFlags(first.flags, row.flags);
    const name = odd ? `${p.base} (${describeFlags(row.flags) || 'other hits'})` : p.base;
    const key = `${section}|${name}|${row.requires?.phial ?? ''}`;
    let move = moves.get(key);
    if (!move) moves.set(key, (move = { section, name, flags: row.flags, notes: new Set(), variants: new Map() }));
    if (row.notes) move.notes.add(row.notes);
    const vKey = `${label}|${requiresKey}`;
    let variant = move.variants.get(vKey);
    if (!variant) move.variants.set(vKey, (variant = { label, power: p.power, level: p.level, states: p.states, requires: row.requires, fixedDamage: row.fixedDamage, hits: new Map() }));
    for (const index of p.hits ?? [variant.hits.size ? Math.max(...variant.hits.keys()) + 1 : 1]) {
      if (variant.hits.has(index)) {
        report.push(`${row.name}: duplicate of an earlier row, skipped`);
        continue;
      }
      variant.hits.set(index, Array(p.repeat).fill({ mv: row.mv, element: row.element, status: row.status }));
    }
  }

  // Power versions often only list the hit that changes ("Power Encore 2"): take the others from the normal version.
  for (const move of moves.values()) {
    for (const v of move.variants.values()) {
      if (!v.power) continue;
      const normal = [...move.variants.values()].find((o) => !o.power && o.level === v.level && sameFlags(o.states, v.states) && sameFlags(o.requires, v.requires));
      for (const [i, hits] of normal?.hits ?? []) if (!v.hits.has(i)) v.hits.set(i, hits);
    }
  }

  // Keep sections together, in order of first appearance.
  const order = [...new Set([...moves.values()].map((m) => m.section))];
  return [...moves.values()].sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section)).map(toMove);
}

function toMove(m) {
  const variants = [...m.variants.values()].map((v) => {
    const hits = [...v.hits.entries()].sort(([a], [b]) => a - b).flatMap(([, h]) => h);
    const out = { ...(v.label ? { label: v.label } : {}), hits: hits.map((h) => h.mv) };
    for (const [key, field] of [
      ['element', 'elementModifier'],
      ['status', 'statusModifier'],
    ]) {
      const values = hits.map((h) => h[key]);
      if (values.every((x) => x === values[0])) {
        if (values[0] !== 1) out[field] = values[0];
      } else out[`${field}s`] = values;
    }
    if (v.fixedDamage) out.fixedDamage = v.fixedDamage;
    if (v.requires) out.requires = v.requires;
    return out;
  });
  // A move with several variants labels all of them.
  if (variants.length > 1) for (const v of variants) v.label ||= 'Normal';
  const move = { section: m.section, name: m.name, ...m.flags };
  // Hoist modifiers shared by every variant to the move (as extract-wiki-moves.mjs does).
  for (const key of ['elementModifier', 'statusModifier']) {
    const values = variants.map((v) => v[key]);
    if (values[0] !== undefined && values.every((x) => x === values[0]) && !variants.some((v) => v[`${key}s`])) {
      move[key] = values[0];
      for (const v of variants) delete v[key];
    }
  }
  if (m.notes.size) move.notes = [...m.notes];
  move.variants = variants;
  return move;
}

// ---------------------------------------------------------------- main

const workbook = readWorkbook(xlsxPath);
const source = `${basename(xlsxPath).replace(/\.xlsx$/i, '')} spreadsheet (datamine: https://github.com/dtlnor/mhws-rcol-record)`;
const existing = JSON.parse(readFileSync(join(here, 'supplements/moves.json'), 'utf8'));
const result = {
  $comment:
    'Motion values per weapon type: from the motion values spreadsheet by scripts/import-motion-values.mjs, ' +
    'and from the Monster Hunter Wiki by scripts/extract-wiki-moves.mjs (see `source`). hits = MV of each hit; ' +
    'elementModifier/statusModifier default to 1. Do not edit by hand; re-run the scripts.',
  extracted: new Date().toISOString().slice(0, 10),
  weapons: {},
};

for (const [sheet, kind] of Object.entries(SHEETS)) {
  if (WIKI_KINDS.includes(kind) && !all) {
    if (existing.weapons[kind]) result.weapons[kind] = existing.weapons[kind];
    console.log(`${kind.padEnd(14)} kept (wiki)`);
    continue;
  }
  const rows = workbook.get(sheet);
  if (!rows) {
    console.log(`${kind.padEnd(14)} no "${sheet}" tab`);
    if (existing.weapons[kind]) result.weapons[kind] = existing.weapons[kind];
    continue;
  }
  const report = [];
  let sheetRows = kind.endsWith('bowgun') ? bowgunRows(rows, kind, report) : standardRows(rows, kind, report);
  if (kind === 'gunlance' && workbook.has('GL Shelling')) sheetRows = [...sheetRows, ...shellingRows(workbook.get('GL Shelling'), report)];
  const moves = buildMoves(kind, sheetRows, report);
  result.weapons[kind] = { source, ...(APPROXIMATE.has(kind) ? { approximate: true } : {}), moves };
  const variants = moves.reduce((n, m) => n + m.variants.length, 0);
  console.log(`${kind.padEnd(14)} ${String(moves.length).padStart(3)} moves, ${variants} variants`);
  for (const line of report) console.log(`  ${line}`);
}

// Keep the file's weapon order stable (SHEETS order).
writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(`wrote ${OUT}`);
