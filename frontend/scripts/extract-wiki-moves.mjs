#!/usr/bin/env node
// Extracts weapon motion values from the Monster Hunter Wiki's
// "MHWilds/<Weapon> Mechanics" pages into scripts/supplements/moves.json.
//
//   node scripts/extract-wiki-moves.mjs            fetch pages, write moves.json
//   node scripts/extract-wiki-moves.mjs --offline  reuse .cache/wiki/*.wiki
//
// Weapons whose page is still "Work in Progress" are reported and skipped.
// Review the diff of moves.json after running; the wiki is community-edited.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'supplements/moves.json');
const CACHE = resolve(here, '../.cache/wiki');
const offline = process.argv.includes('--offline');

const PAGES = {
  'great-sword': 'Great_Sword_Mechanics',
  'long-sword': 'Long_Sword_Mechanics',
  'sword-shield': 'Sword_and_Shield_Mechanics',
  'dual-blades': 'Dual_Blades_Mechanic',
  hammer: 'Hammer_Mechanics',
  'hunting-horn': 'Hunting_Horn_Mechanics',
  lance: 'Lance_Mechanics',
  gunlance: 'Gunlance_Mechanics',
  'switch-axe': 'Switch_Axe_Mechanics',
  'charge-blade': 'Charge_Blade_Mechanics',
  'insect-glaive': 'Insect_Glaive_Mechanics',
  bow: 'Bow_Mechanics',
  'light-bowgun': 'Light_Bowgun_Mechanics',
  'heavy-bowgun': 'Heavy_Bowgun_Mechanics',
};
const pageUrl = (page) => `https://monsterhunterwiki.org/wiki/MHWilds/${page}`;
const rawUrl = (page) => `https://monsterhunterwiki.org/index.php?title=MHWilds/${page}&action=raw`;

async function source(page) {
  const cached = join(CACHE, `${page}.wiki`);
  if (offline && existsSync(cached)) return readFileSync(cached, 'utf8');
  const res = await fetch(rawUrl(page), { headers: { 'User-Agent': 'mhwilds-engineering-tool (motion value import)' } });
  if (!res.ok) throw new Error(`${page}: HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cached, text);
  return text;
}

// <ref name="x">footnote text</ref> and the self-closing reuse form <ref name="x"/> or <ref name="x"></ref>.
const REF_WITH_TEXT = new RegExp(String.raw`<ref[^>/]*>([\s\S]*?)</ref>`, 'g');
const ANY_REF = new RegExp(String.raw`<ref[^>]*/>|<ref[^>]*>[\s\S]*?</ref>`, 'g');

const clean = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[[^|\]]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .trim();

/**
 * "10, 91" -> hits [10, 91], groups [1, 1]; "23, 18x4, 25" -> 6 hits, groups [1, 4, 1].
 * Groups line up with per-group modifier lists ("x2.5, x2.5, x1.5"). Unknown text -> null.
 */
function parseHits(text) {
  const parts = text.split(/,\s*|\s*\+\s*/).map((p) => p.trim()).filter(Boolean);
  const hits = [];
  const groups = [];
  for (const p of parts) {
    const m = /^(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+))?$/.exec(p);
    if (!m) return null;
    const count = Number(m[2] ?? 1);
    for (let i = 0; i < count; i++) hits.push(Number(m[1]));
    groups.push(count);
  }
  return hits.length ? { hits, groups } : null;
}

const MODIFIER_LIST = /^x\s*[\d.]+(\s*,\s*x\s*[\d.]+)*$/;

/** "x2.5, x2.5, x1.5" -> [2.5, 2.5, 1.5] */
const modifierList = (cell) => cell.split(',').map((p) => Number(p.trim().slice(1)));

/**
 * One modifier for the whole move -> number; one per hit group -> per-hit array;
 * anything else -> undefined (reported).
 */
function expandModifier(list, groups) {
  if (list.length === 1) return list[0];
  if (list.length !== groups.length) return undefined;
  return groups.flatMap((count, i) => Array(count).fill(list[i]));
}

function parseMoves(wikitext) {
  const t = wikitext.replace(/\r/g, '');
  // Moves live under =Attacks=, =Focus Mode=, equipment-skill sections etc.; stop at =Defense=.
  const start = t.indexOf('\n=Attacks=');
  if (start === -1) return { moves: [], skipped: [] };
  const defense = t.indexOf('\n=Defense=', start);
  const body = t.slice(start, defense === -1 ? undefined : defense);

  // Headings: [ \t]* (not \s*) so a heading does not swallow the newline the next one starts with.
  const marks = [...body.matchAll(/\n=+[ \t]*([^=\n]+?)[ \t]*=+[ \t]*(?=\n)|<h4 style="margin:0px;">(.*?)<\/h4>/g)];
  const moves = [];
  const skipped = [];
  let section = '';
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (m[1] !== undefined) {
      if (m[1] !== 'Attacks') section = clean(m[1]);
      continue;
    }
    const name = clean(m[2]);
    const block = body.slice(m.index, marks[i + 1]?.index ?? body.length);
    const mvHeader = block.indexOf('\n!MV');
    if (mvHeader === -1) continue; // e.g. guards, evades

    const tableStart = block.lastIndexOf('{|', mvHeader);
    const firstRow = block.indexOf('\n|-', mvHeader);
    const headers = block.slice(tableStart, firstRow).split('\n').filter((l) => l.startsWith('!'));
    const hasVariantColumn = !headers[0].startsWith('!MV');
    const otherStats = block.indexOf('Other Stats', firstRow);
    const rowsText = block.slice(firstRow, otherStats === -1 ? undefined : block.lastIndexOf('\n|-', otherStats));

    const variants = [];
    const notes = new Set();
    let damageType = null; // from the "Attack Type" column; rowspan'd, so only on the first row
    for (const row of rowsText.split('\n|-').slice(1)) {
      const cells = row
        .split('\n')
        .filter((l) => l.startsWith('|') || l.startsWith('!'))
        .map((l) => l.replace(/^[|!]\s*(?:rowspan\s*=\s*\d+\s*\|)?\s*/, '').trim());
      if (!cells.length) continue;
      const label = hasVariantColumn ? clean(cells[0]) : '';
      const cell = hasVariantColumn ? cells[1] : cells[0];
      if (cell === undefined) continue;
      // Footnotes explain caveats (variable hit counts, damage falloff); keep them as notes.
      for (const ref of cell.matchAll(REF_WITH_TEXT)) if (clean(ref[1])) notes.add(clean(ref[1]));
      const raw = cell.replace(ANY_REF, '').trim();
      const typeCell = clean(hasVariantColumn ? (cells[2] ?? '') : (cells[1] ?? ''));
      if (!damageType && /^(Sever|Blunt)$/.test(typeCell)) damageType = typeCell === 'Sever' ? 'slash' : 'blunt';
      const parsed = parseHits(raw);
      if (!parsed) {
        skipped.push(`${name}${label ? ` [${label}]` : ''}: "${raw}"`);
        continue;
      }
      variants.push({ ...(label ? { label } : {}), hits: parsed.hits, groups: parsed.groups });
    }
    if (!variants.length) continue;

    // "Other Stats": a header row of icons, then value rows (one per variant on
    // pages with charge levels). Locate the Element / Status columns by their
    // header icons and read the same positions in each value row.
    const rowMods = [];
    if (otherStats !== -1) {
      const end = block.indexOf('\n|}', otherStats);
      const rows = block
        .slice(otherStats, end === -1 ? undefined : end)
        .split(/\n\|-[^\n]*/)
        .map((r) => r.split('\n').filter((l) => /^[|!]/.test(l)).map((l) => l.replace(/^[|!]\s*(?:colspan\s*=\s*"?\d+"?\s*\|)?\s*/, '').trim()))
        .filter((cells) => cells.length);
      const headerAt = rows.findIndex((cells) => cells.some((c) => c.includes('|Element|')));
      if (headerAt !== -1) {
        const header = rows[headerAt];
        const elementCol = header.findIndex((c) => c.includes('|Element|'));
        const statusCol = header.findIndex((c) => c.includes('|Status Up Horn|'));
        for (const cells of rows.slice(headerAt + 1)) {
          const element = cells[elementCol] ?? '';
          // Skip the description row that follows the values.
          if (!MODIFIER_LIST.test(element)) continue;
          const status = cells[statusCol] ?? '';
          rowMods.push({
            label: clean(cells[0]),
            element: modifierList(element),
            status: MODIFIER_LIST.test(status) ? modifierList(status) : [1],
          });
        }
      }
    }

    // Attach modifiers per variant (a single value row applies to all variants).
    for (const v of variants) {
      const row = rowMods.length === 1 ? rowMods[0] : rowMods.find((r) => r.label === v.label);
      for (const [key, list] of [['element', row?.element], ['status', row?.status]]) {
        if (!list) continue;
        const value = expandModifier(list, v.groups);
        if (value === undefined) skipped.push(`${name} [${v.label ?? ''}] ${key} modifiers "${list}" do not match ${v.groups.length} hit groups`);
        else if (Array.isArray(value)) v[`${key}Modifiers`] = value;
        else if (value !== 1) v[`${key}Modifier`] = value;
      }
      delete v.groups;
    }

    const move = { section, name, variants };
    if (damageType) move.damageType = damageType;
    if (notes.size) move.notes = [...notes];
    // Hoist modifiers shared by every variant to the move.
    for (const key of ['elementModifier', 'statusModifier']) {
      const values = variants.map((v) => v[key]);
      if (values[0] !== undefined && values.every((x) => x === values[0]) && !variants.some((v) => v[`${key}s`])) {
        move[key] = values[0];
        for (const v of variants) delete v[key];
      }
    }
    moves.push(move);
  }
  return { moves, skipped };
}

const result = {
  $comment:
    'Motion values per weapon type, extracted by scripts/extract-wiki-moves.mjs from the Monster Hunter Wiki. ' +
    'hits = MV of each hit; elementModifier/statusModifier default to 1. Do not edit by hand; re-run the script.',
  extracted: new Date().toISOString().slice(0, 10),
  weapons: {},
};

for (const [kind, page] of Object.entries(PAGES)) {
  try {
    const text = await source(page);
    const { moves, skipped } = parseMoves(text);
    if (!moves.length) {
      console.log(`${kind.padEnd(14)} no move data (${text.length < 200 ? clean(text) : 'no MV tables'})`);
      continue;
    }
    result.weapons[kind] = { source: pageUrl(page), moves };
    console.log(`${kind.padEnd(14)} ${String(moves.length).padStart(3)} moves`);
    for (const s of skipped) console.log(`  skipped ${s}`);
  } catch (e) {
    console.log(`${kind.padEnd(14)} failed: ${e.message}`);
  }
}

writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(`wrote ${OUT}`);
