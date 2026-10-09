# Damage calculator

Code: `frontend/src/app/core/calc/` (plain TypeScript, unit tested). UI: the Damage panel on the
Builder page.

## What it computes

Motion values aren't in the dataset (see `DATA.md`), so all damage is **average (expected) damage of one hit with 100
motion value**. To get a real attack's damage, multiply by that attack's MV / 100.

```
attack      = weapon attack × (1 + Σ attack% / 100) + Σ flat attack
affinity    = clamp(weapon affinity + Σ affinity, -100, 100)
crit (raw)  = 1 + p × (critMult − 1)    if p ≥ 0   (p = affinity / 100)
            = 1 − |p| × 0.25            if p < 0
crit (elem) = 1 + p × (critElement − 1) if p > 0, else 1

effective raw     = attack × sharpness raw × crit (raw) × (1 + Bludgeoner%)
effective element = element × sharpness elem × crit (elem)

per hit = effective raw × raw hitzone + effective element × element hitzone
```

- Raw hitzone type: blunt for Hammer and Hunting Horn, shot (`pierce`) for Bow and bowguns, slash for
  everything else. Lance, Charge Blade and Switch Axe attacks that use other damage types are not
  handled.
- Element: the data holds true values. The game shows them ×10, so the UI does too. Element skill
  text uses the displayed units, so "Fire attack +40" is +4 true element.
- Element cap (`elementCap`): element after skills is at most the larger of base + 400 and base × 2.3
  (display units), every weapon type, since Title Update 4 (before: +350 / ×1.9). The Damage panel
  shows a capped element in red (`--error`). Modeled skills alone rarely reach it.
- Weapon status (poison etc.) is shown, but status buildup isn't calculated.
- Weakness indicator (`weakness.ts`): the monster's 1–3 weakness stars per element and status from
  the game data, "resists" when listed as a resistance, "—" otherwise. Shown as a strip under the
  target (the weapon's own element/status outlined) and in the monster picker's hints.
- Sharpness uses the bar's top color after Handicraft (a fresh weapon).

## Skill effects

`skill-effects.ts` lists 27 damage skills by English name. A test checks that every name exists in
`skills.json` and has the right number of levels. Unless a skill is marked `verified: false`, its
numbers come from the skill rank descriptions in the game data.

Conditions:
- **always**: Attack Boost, Critical Eye, Critical Boost, element attack skills (only when the
  element matches the weapon's), Critical Element.
- **toggle** (the user switches these on or off; the default is shown in brackets): Agitator (on),
  Maximum Might (on), Peak Performance (on), Resentment (on), Antivirus (on), Latent Power, Counterstrike, Adrenaline Rush, Foray, Heroics,
  Offensive Guard, Ambush, Slicked Blade, Critical Draw, Punishing Draw (off).
  Peak Performance (full health) excludes Resentment and Heroics (`excludes` on the toggle): the
  calculator never applies both, an explicitly checked toggle beats a default, and checking one in
  the panel unchecks the other. Resentment and Heroics can stack.
- **weak point**: Weakness Exploit applies when the raw hitzone is ≥ 45 (without a target: always)
  and its condition "Hitting a weak point" is on (default on). The Wounded checkbox adds its wound
  bonus.
- **low sharpness**: Bludgeoner, at yellow or lower (Lv1–2) or green or lower (Lv3).

Set and group bonuses are in `SET_EFFECTS` (same file), all toggles keyed by set name, and only shown
at ranks that change damage. Gore Magala's Tyranny (Lv2: +10 infected, on; +5 more once overcome,
off), Gogmapocalypse (element ×1.2 + 20 / ×1.3 + 40 display, enraged, on), Lord's Soul (+5%, on);
off by default: Doshaguma, Xu Wu, Ebony Odogaron (game text), Jin Dahaad, Leviathan's Fury
(affinity only), Seregios, Omega Resonance (Remote attack / Local affinity), Blangonga, festival
Prayer sets (Lv2 +9%), Lord's Fury, Lord's Favor, Fortifying Pelt, Buttery Leathercraft. Sources are
in the file. Extra toggles on one skill (`extra`) use their own key, e.g.
`"Gore Magala's Tyranny: overcome"`.

Antivirus (`needsFrenzy`) only counts when something infects you with Frenzy: a set in
`FRENZY_SETS` (Gore Magala's Tyranny, any rank) or a target monster in `FRENZY_MONSTERS` (Gore
Magala). Otherwise it is listed as "No effect" and adds nothing, so the armor search doesn't raise it.
The search also counts required set/group bonuses, so requiring Gore Magala's Tyranny makes
Antivirus worth raising.

Active skills that look damage-related (attack/offense/affinity/element icons, and all set/group
bonuses) but aren't in the table are listed as "Not modeled" in the UI rather than silently ignored.

## Item and meal buffs

`buffs.ts` lists Powercharm (+6 attack), Armorcharm (+12 defense), Demon Powder (+10 attack),
Hardshell Powder (+20 defense), meals (Meat ration +2 attack, Fish +4 defense, Veggie +2 defense,
settlement meals such as Kunafa, Azuz, Sild and Suja cuisine and the Grand Hub festival and
collaboration meals, all +5 attack / +10 defense; their food skills are listed, and Caprice Meal (Hi) (+15 attack, Suja cuisine) is a Damage panel condition, off by default — `FOOD_SKILL_EFFECTS`), Demondrug / Mega Demondrug (+5 / +7), Might Seed / Pill
(+10 / +25), Armorskin / Mega Armorskin (+15 / +25 defense) and Adamant Seed / Pill (+20 / ×1.3
defense). Options in one group don't stack, so the UI allows one per group. Sources are in the file
(game8 and the Monster Hunter Wiki).

- Attack buffs are flat attack, added after skill percentages (`DamageInput.buffs`).
- Powercharm and Armorcharm are on by default (they work from the item pouch); everything else starts off.
- Defense buffs only change the "buffed" defense in the Skills header: flat bonuses first, then the
  Adamant Pill multiplier. That order is **assumed**.
- Food skills other than Caprice Meal (Hi) and Hunting Horn songs are not modeled. Spicy Red Meal
  (Attack) boosts Focus Strike wound destruction and part damage, but no numbers are published;
  Exploiter Meal only affects wound rewards.

## Assumptions to verify in game

| Value | Used | Source |
|---|---|---|
| Sharpness raw multipliers | 0.5 / 0.75 / 1.0 / 1.05 / 1.2 / 1.32 / 1.39 | Earlier games |
| Sharpness element multipliers | 0.25 / 0.5 / 0.75 / 1.0 / 1.0625 / 1.15 / 1.25 | Earlier games |
| Base crit / negative crit | 1.25 / 0.75 | Earlier games |
| Critical Element | ×1.05 / 1.10 / 1.15 | Skill text gives no numbers |
| Weak point threshold | raw hitzone ≥ 45 | Earlier games |
| Attack % stacking | percentages summed, applied to base attack | Common convention |
| Handicraft fill order | starts at the bar's top color | Inferred from data (DATA.md) |
| Element display scale | ×10 | Confirmed: wiki shows Artian element 450 where true-unit sources list 45 (ARTIAN.md) |

## Per-move damage

The Moves table on the Builder page (`core/calc/moves.ts`) uses each move's motion values, from
`frontend/scripts/supplements/moves.json` (see "Motion values" below):

```
raw hit     = effective raw     × MV / 100 × raw hitzone of the move's damage type
element hit = effective element × element modifier × element hitzone
move damage = sum over all hits (one row per charge level / state)
```

- Element damage doesn't scale with motion value. Each move instead has an element modifier
  (e.g. Hammer Spinning Bludgeon ×2.5 for the spin hits and ×1.5 for the finisher, shield bashes ×0).
  This follows earlier games and the wiki's data. **Assumed** for Wilds.
- A move with its own damage type (e.g. Great Sword's blunt Tackle) uses that hitzone, and
  Weakness Exploit is checked against it.
- Without a target, both hitzones count as 100.
- Per-move flags from the spreadsheet: `canCrit: false` takes the crit factors out (affinity shows 0);
  `fixedSharpness` uses that color's multipliers instead of the weapon's (e.g. Bow Arc Shot "as if
  green", Charge Blade phial bursts yellow); `ignoresHitzone` counts the raw hitzone as 100 (element
  still uses its hitzone; Weakness Exploit is still checked against the part).
- `fixedDamage` (Gunlance shell fire) is added to the total as is: no attack, skills, crits or hitzones.
  Artillery isn't modeled.
- `movesForWeapon` drops variants the equipped weapon can't use (`requires`): bowgun ammo kinds and
  levels it doesn't carry (Rapid Fire only when that ammo is rapid), Gunlance shells and Wyrmstake
  ticks of another shell type or level, and Charge Blade phial bursts of the other phial type. Both
  Builder panels filter before calculating.
- Values are expected averages. The game rounds each hit down, so in-game numbers can be slightly lower.

The Damage panel's default headline is the **light combo** (`combos.ts`): the combo from pressing
only light attack without charging (GS Overhead Slash → Strong Charged Slash → True Charged Slash at
charge level 0; SnS Chop → Side Slash → Diagonal Rising Slash → Diagonal Chop; Hammer Overhead Smash
I → II → Upswing; sources in the file). It shows the combo total and its average per hit. A test
checks every step against `moves.json`. The other 11 weapon types have no light combo yet, so their
headline defaults to "All moves".

"All moves" is the **average hit** (`averageHit` in `moves.ts`): the mean damage of
every hit of every move and charge level/state in the weapon's move list (after `movesForWeapon`),
leaving out riding, mounting, sneak attacks and power clashes. Every hit counts once, so it is a
typical hit, not a combo or DPS figure. "Per 100 MV" switches back to the reference hit above.

## Motion values

All 14 weapon types. Each entry in `moves.json` names its `source`:

- **Great Sword, Sword & Shield, Hammer**: the Monster Hunter Wiki's `MHWilds/<Weapon> Mechanics`
  pages. The wiki works out hit counts the spreadsheet leaves open (Perforate's 11 follow-up hits,
  Spinning Bludgeon's spins), so these three stay on the wiki.
- **The other 11**: the "Monster Hunter Wilds Motion Values (1.04.0)" spreadsheet (one tab per weapon,
  datamined by dtlnor, https://github.com/dtlnor/mhws-rcol-record). Bowgun entries are marked
  `approximate`: the sheet says its bowgun numbers are rough.

`node scripts/import-motion-values.mjs "<path>/Monster Hunter Wilds Motion Values (1.04.0).xlsx"`
(from `frontend/`) reads the spreadsheet directly (download the Google Sheet as **.xlsx**; a CSV
export only holds one tab) and rewrites the spreadsheet weapons in `moves.json`, keeping the wiki
ones (`--all` replaces those too; `--out=file` writes elsewhere for comparing). How it reads a tab:

- Columns are found by header name (Attack, Motion Value, Element, Status, Sharpness, Can Crit,
  Notes), so tabs with different column orders work.
- Names: `Lv2` is a charge/ammo/shell level (variant `LV 2`); a trailing `1`, `2` is a hit of one
  attack (`1/2`: both hits); `(x3)` (and Bow's `x3`) repeats a hit; other parentheses are states
  (`(Red)`, `(No Gauge)`); `Power X` is a variant of X, taking hits it doesn't list from X. Roman
  numerals are separate inputs. Hunting Horn's `Echo Wave … x2` is a different wave, not 2 hits.
- Skipped: rows marked unavailable/unused/"Not available", values with `?`, rows with no damage
  (Melody of Life), status ammo, and the Insect Glaive Kinsect table (scales with the Kinsect).
- Notes: "Blunt" / "Sever" / "Slicing" set the damage type; "Hitzone-ignoring" sets `ignoresHitzone`.
  Hits of one attack with a different damage type become their own row ("Descending Thrust (blunt)").
  A fixed element value (`60 Dragon`, "Elemental Value is fixed") gives element modifier 0 and a note.
- Charge Blade phial bursts are listed twice: impact phial (motion values) and element phial
  (element modifier, MV 0); each needs its phial type.
- Bowguns: ammo rows become `<Kind> Ammo` with a variant per level (Light Bowgun: plus Rapid Fire).
  "Shoots N bullets" counts N hits; pierce ("hits up to N times", with falloff) counts one. Only the
  raw part is calculated: ammo element is a fixed value, and bowguns have no weapon element.
- Gunlance shelling (`GL Shelling` tab): raw part as hitzone-ignoring MV, fire as `fixedDamage`, per
  shell type and level. Shells are **assumed** not to crit or scale with sharpness (as in earlier
  games), modeled as `canCrit: false` + yellow sharpness (×1.0).

It reports every row it skips. Review the diff, then run `npm run import-data` (which checks hit
counts, modifier lengths, sharpness colors and that every required ammo kind exists).

`node scripts/extract-wiki-moves.mjs` re-reads the wiki for the wiki weapons; it keeps the
spreadsheet weapons as they are. It handles charge levels, multi-hit moves (`10x3`), per-hit
modifiers and footnotes (kept as notes, e.g. variable hit counts), and it reports anything it can't
parse.

Wiki vs spreadsheet (checked with `--all --out`): values agree except Hammer Upswing (wiki 96, sheet
95) and a few element modifiers (sheet: GS Tackle and Flood of Shadow 0, Hammer Side Smash 1.0, SnS
sneak attacks 1.0; wiki: 1 / 1 / 1.3 / 1.3).

Known source quirks: the wiki lists Sword & Shield shield bashes as "Sever" (cutting) damage; we keep
that. Great Sword Focus Strike: Perforate's 11 small hits do less than listed (the wiki notes a falloff
curve), so its total is an upper bound.

## Not yet modeled

Light combos for the 11 spreadsheet weapon types, Kinsect damage, Hunting Horn echo wave choice
(all four wave types are listed), Artillery, bowgun ammo element and chaser shots, Bow coatings,
falloff on multi-hit moves (pierce, Resounding Melody), element caps, Burst, Coalescence, Convert Element, Elemental Absorption, Mind's
Eye, Partbreaker, Flayer, ranged ammo/shot skills, set and group bonuses,
food skills, Hunting Horn songs, and wound hitzone changes.
