# Skill values per level

Where a skill's numbers are shown:

- **Armor Search:** every level in the skill browser, the chosen level under each picked skill, and the
  level in the tooltip of a found set's skills. Numbers are for the weapon type picked on the tab (it
  always has one, even with no weapon).
- **Builder:** under each active skill in the Skills list, what its current level gives, for the
  Builder's weapon type. Active set and group bonuses show their rank's text.

- **Tooltip (both tabs):** hovering or focusing a skill with a level (Builder skills list and gear
  cards, Armor Search picked skills and result cards) shows its numbers by stat and level, the current
  level highlighted, plus its condition, notes and sources. Code: `core/skills/skill-stats.ts` (the
  table) and `shared/skill-tip/` (the tooltip, placed on `<body>` so panels cannot clip it). Stat rows
  come from, in order: researched values, the calculator's skill table (`calc/skill-effects.ts`), or
  simple "<stat> +<n>" game text; other skills and set bonus ranks get one line per level.

Code: `frontend/src/app/core/skills/skill-values.ts` (`skillLevelValues`, `levelEffect`; pure, tested in
`skill-values.spec.ts`). Set and group bonus ranks are not researched yet: their game text is shown.

## Where the numbers come from

1. **Game text.** 63 of the 137 armor and weapon skills state numbers in their level text
   (`skills.json`, e.g. Attack Boost "Attack +3", Agitator "Attack +4 and affinity +3%"). That text is
   shown as is.
2. **Researched values** for skills whose level text only says "small / bigger / huge" (74 skills).
   Only damage-related ones are covered so far. Element values use the in-game display scale (×10),
   like the game's own skill text.
3. Skills with no numbers in either place show no level list (e.g. Evade Window).

| Skill | Values | Sources | Status |
|---|---|---|---|
| Burst | Attack and element per level, 4 weapon groups | Game8, Fextralife | Both agree |
| Critical Element | Element crit ×1.05 / 1.1 / 1.15; heavy weapons ~×1.07 / ~1.13 / 1.2 | Game8 | One source; the source marks the heavy values approximate and its prose contradicts its table |
| Coalescence | Element ×1.05–1.15 (×1.1–1.3 heavy), status ×1.05–1.15, 30 s | Game8 | One source |
| Charge Master | Element modifier per weapon type | Game8, Fextralife | Sources differ (Fextralife: +15/20/25% GS, Hammer, IG; +5/10/15% Bow). Game8 shown |
| Flayer | 140 / 160 / 220 / 300 / 400 fixed damage (Title Update 4) | Game8 | One source |
| Tetrad Shot, Opening Shot, Special Ammo Boost, Normal / Piercing / Spread Shots, Ballistics | Attack, affinity or damage % | Game8 | One source |
| Darkside, Power Stone, Grillmaster, Whiteflame Torrent, Synergy, Charge Up | Attack, affinity, element or damage | Game8 | One source |

Pages: Game8 `https://game8.co/games/Monster-Hunter-Wilds/archives/<id>` (ids in the code),
Fextralife `https://monsterhunterwilds.wiki.fextralife.com/<Skill>`. The Monster Hunter Wiki and
Kiranico pages were checked too and list no numbers for these skills.

Not found anywhere: Convert Element and Critical Status (Game8 only lists hits needed to proc).

## Not used by the damage calculator yet

These numbers are for display. The calculator (`docs/CALC.md`) still does not model Burst, Coalescence
or the others, and uses ×1.05 / 1.1 / 1.15 Critical Element for every weapon type.
