# MH Wilds Engineering Tool

## Goal
One local app combining (1) an armor/skill search simulator (like
mhwilds.wiki-db.com/sim) and (2) a damage/build calculator (like
mathhunter.ca) for Monster Hunter Wilds. Search results should be
rankable by calculated DPS.

## Stack and decisions
- Angular + TypeScript, standalone components, signals.
- Frontend only for now. No backend, no database.
- Game data: static JSON copied from `mhdb-wilds-data/merged` into
  `frontend/src/assets/data/` by `frontend/scripts/import-data.mjs`
  (`npm run import-data`). English (`en`) only. See `docs/DATA.md`.
- Values missing from the game data (Artian crafting) are researched and
  kept in `frontend/scripts/supplements/` with sources. See `docs/ARTIAN.md`
  and `docs/CALC.md` (motion values: `frontend/scripts/extract-wiki-moves.mjs`).
- Weapon/armor thumbnails are hotlinked, never bundled: Kiranico first, then
  Fextralife, monsterhunterwiki.org and gamertw for gaps. URLs come from
  `frontend/scripts/extract-thumbnails.mjs` -> `supplements/thumbnails.json`
  (equipment type/rarity icons end up in `assets/data/icons.json`).
- `mhdb-wilds-data/` is reference only. Do not edit it.
- Saved builds: localStorage or IndexedDB, with JSON export/import.
- Calculator and skill logic live in plain TypeScript (no Angular
  imports) with unit tests.
- Solver runs in a Web Worker. Armor search: `core/search/armor-search.ts`
  + `features/armor-search/` (Armor Search tab). See `docs/SEARCH.md`.
- Angular 22, Node 24 (`frontend/.nvmrc`). Tests: `npm test` (Vitest).
- Pure logic lives in `frontend/src/app/core/` (no Angular imports).
- Hosted on GitHub Pages (https://rjpajaro.github.io/mh-wilds-engineering-tool/),
  deployed by `.github/workflows/deploy-pages.yml` on push to `dev`.
  Hash routing (`#/builder`) and `<base href="./">` so one build works
  locally and under the Pages sub-path. Keep both.
- Loadouts (named builds) and share links: `core/loadouts/` (pure) +
  `data/loadouts.service.ts`. Share codes are versioned binary over game ids;
  never change version 1 decoding, add a new version instead, so old links
  keep working. Exports: JSON with `format`/`version`.

## Build order
1. Inspect the data and document its structure
2. Types + data loading service
3. Skill resolver (equipped gear -> active skills) with tests
4. Damage calculator for one weapon type
5. Search solver
6. Integrate search + calculator

## Known gaps
- Motion values, hitzones and quest HP may not be in this dataset.
  Verify before building the calculator.