#!/usr/bin/env node
// Imports the appraised (random) talisman roll tables from the "護石テーブル" spreadsheet
// (data mined by dtlnor, grouped by Aki at Wiggler, Japanese by だる; linked from
// https://kazuo-blog.org/mhwilds-talisman-drop-research/) into scripts/supplements/talisman-rolls.json.
//
//   node scripts/import-talisman-rolls.mjs "<path>/護石テーブル.xlsx"
//
// Download the Google Sheet as Microsoft Excel (.xlsx). Tabs used:
//   護石組み合わせ  rarity, skill group of skills 1-3, possible free slots per pattern
//   スキルリスト    group, skill name (Japanese), level
// スキルグループ (the same groups laid out side by side) is used as a cross-check.
// Japanese names are matched to game skills through Skill.json's `ja` names (NFKC-normalized,
// plus ALIASES for names the sheet spells differently). Review the diff, then run `npm run import-data`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkbook } from './lib/xlsx.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const xlsxPath = process.argv[2];
if (!xlsxPath) {
  console.error('usage: node scripts/import-talisman-rolls.mjs <talisman table .xlsx>');
  process.exit(1);
}
const OUT = join(here, 'supplements/talisman-rolls.json');
const SKILLS = resolve(here, '../../mhdb-wilds-data/merged/Skill.json');

/** Sheet spelling -> game (Skill.json `ja`) spelling: typos and pre-release names. */
const ALIASES = {
  弾道強化: '弾導強化',
  災禍転覆: '災禍転福',
  毒属性攻撃強化: '毒属性強化',
  麻痺属性攻撃強化: '麻痺属性強化',
  睡眠属性攻撃強化: '睡眠属性強化',
  爆破属性攻撃強化: '爆破属性強化',
  '貫通弾・竜の一矢強化': '貫通弾・竜の矢強化',
  // Only in the スキルグループ tab (the cross-check):
  火属性強化: '火属性攻撃強化',
  水属性強化: '水属性攻撃強化',
  雷属性強化: '雷属性攻撃強化',
  氷属性強化: '氷属性攻撃強化',
  龍属性強化: '龍属性攻撃強化',
  '貫通弾・貫通矢強化': '貫通弾・竜の矢強化',
  '通常弾・連射矢強化': '通常弾・通常矢強化',
  防御down耐性: '防御力ＤＯＷＮ耐性',
  回避距離: '回避距離ＵＰ',
};

/** Groups 1-4 roll weapon skills, 5-10 armor skills (the sheet's legend). */
const WEAPON_GROUPS = new Set([1, 2, 3, 4]);

const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '').trim();
const errors = [];

const skills = JSON.parse(readFileSync(SKILLS, 'utf8'));
const byJa = new Map(skills.map((s) => [norm(s.names.ja), s]));
function skillFor(name) {
  const skill = byJa.get(norm(ALIASES[name] ?? name));
  if (!skill) errors.push(`unknown skill ${name}`);
  return skill;
}

const sheets = readWorkbook(xlsxPath);
const tab = (name) => sheets.get(name) ?? (errors.push(`missing tab ${name}`), []);

// ---------------------------------------------------------------- groups

const groups = {};
for (const row of tab('スキルリスト')) {
  const group = Number(row[1]);
  if (!Number.isInteger(group) || group < 1 || !row[2]) continue;
  const skill = skillFor(row[2]);
  const level = Number(row[3]);
  if (!skill) continue;
  if (!(level >= 1 && level <= skill.ranks.length)) errors.push(`group ${group}: ${row[2]} level ${row[3]} out of range`);
  const kind = WEAPON_GROUPS.has(group) ? 'weapon' : 'armor';
  if (skill.kind !== kind) errors.push(`group ${group}: ${row[2]} is a ${skill.kind} skill, expected ${kind}`);
  const list = (groups[group] ??= []);
  if (list.some((e) => e.skillId === skill.game_id)) errors.push(`group ${group}: ${row[2]} listed twice`);
  list.push({ skillId: skill.game_id, level, name: skill.names.en });
}

// Cross-check against the side-by-side layout: "Group N" headers, then name / level column pairs.
const grid = tab('スキルグループ');
const header = grid.findIndex((row) => row.some((c) => /^Group \d+$/.test(c)));
if (header >= 0) {
  for (const [col, cell] of grid[header].entries()) {
    const group = Number(cell.match(/^Group (\d+)$/)?.[1]);
    if (!group) continue;
    const names = grid.slice(header + 2).map((row) => row[col]).filter(Boolean);
    const listed = new Set((groups[group] ?? []).map((e) => e.skillId));
    const fromGrid = new Set(names.map((n) => skillFor(n)?.game_id));
    if (fromGrid.size !== listed.size || [...fromGrid].some((id) => !listed.has(id))) {
      errors.push(`group ${group}: スキルグループ and スキルリスト tabs differ`);
    }
  }
} else errors.push('スキルグループ: no Group headers found');

// ---------------------------------------------------------------- patterns

/** "[1,1] [2,0]" -> [[{1 armor},{1 armor}], [{2 armor}]]; "W1" is a weapon slot, 0 no slot. */
function parseSlots(text, where) {
  return [...text.matchAll(/\[([^\]]*)\]/g)].map((m) =>
    m[1].split(',').flatMap((part) => {
      const t = part.trim();
      const w = /^W(\d)$/i.exec(t);
      const level = Number(w ? w[1] : t);
      if (!Number.isInteger(level) || level < 0 || level > 3) errors.push(`${where}: bad slot "${t}"`);
      return level ? [{ level, accepts: w ? 'weapon' : 'armor' }] : [];
    }),
  );
}

const rarities = {};
for (const row of tab('護石組み合わせ')) {
  const rarity = Number(/^RARE\[(\d)\]$/.exec(row[0] ?? '')?.[1]);
  if (!rarity) continue;
  const where = `rarity ${rarity} pattern ${row.slice(1, 4).join('/')}`;
  const groupIds = row.slice(1, 4).filter((g) => g && g !== '-').map(Number);
  for (const g of groupIds) if (!groups[g]) errors.push(`${where}: unknown group ${g}`);
  const slots = parseSlots(row[4] ?? '', where);
  if (!slots.length) errors.push(`${where}: no slots`);
  (rarities[rarity] ??= { chance: null, patterns: [] }).patterns.push({ groups: groupIds, slots });
}

// Appraisal chances per rarity and rarity 8 slot chances, from the side notes.
const rows = tab('護石組み合わせ');
const rarity8Slots = {};
for (const row of rows) {
  for (const [i, cell] of row.entries()) {
    const r = /^Rare (\d)$/.exec(cell);
    if (r && rarities[r[1]]) rarities[r[1]].chance = Number(row[i + 1]);
    if (/^\[W1[,\d]*\]$/.test(cell)) rarity8Slots[cell] = Number(row[i + 1]);
  }
}
for (const [rarity, entry] of Object.entries(rarities)) if (!(entry.chance > 0)) errors.push(`rarity ${rarity}: no appraisal chance`);
// Rarity 8: slot layouts with their chances (the same for every pattern).
const slotChances = Object.entries(rarity8Slots).map(([text, chance]) => ({ slots: parseSlots(text, 'rarity 8 slot chances')[0], chance }));
if (rarities[8] && slotChances.length !== 3) errors.push('rarity 8: expected 3 slot chances');

const lastUpdate = rows.flat().find((c) => /^Last update/i.test(c)) ?? '';

if (errors.length) {
  console.error(`${errors.length} error(s), nothing written:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const out = {
  $source:
    'Appraised talisman roll tables: "護石テーブル" Google Sheet (data mined by dtlnor; grouping by Aki at Wiggler), ' +
    'https://docs.google.com/spreadsheets/d/1sWzcj2yZ7ZIgY8MH6CbR2pZj13bwBHlnXIkhakCsdLM, linked from ' +
    'https://kazuo-blog.org/mhwilds-talisman-drop-research/. Imported by scripts/import-talisman-rolls.mjs.',
  sheetUpdated: lastUpdate.replace(/^Last update\s*/i, ''),
  rarities,
  rarity8SlotChances: slotChances,
  groups,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
const count = (o) => Object.values(o).reduce((n, v) => n + (v.patterns ?? v).length, 0);
console.log(`wrote ${OUT}: ${count(rarities)} patterns, ${count(groups)} group entries`);
