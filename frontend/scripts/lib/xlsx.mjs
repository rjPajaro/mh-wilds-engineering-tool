// Minimal .xlsx reader (no dependencies): sheet name -> rows of cell strings.
// Shared by import-motion-values.mjs and import-talisman-rolls.mjs.

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

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
export function readWorkbook(path) {
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
