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
- Weapon status (poison etc.) is shown, but status buildup isn't calculated.
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
- **weak point**: Weakness Exploit applies when the raw hitzone is ≥ 45. The Wounded checkbox adds
  its wound bonus.
- **low sharpness**: Bludgeoner, at yellow or lower (Lv1–2) or green or lower (Lv3).

Active skills that look damage-related (attack/offense/affinity/element icons, and all set/group
bonuses) but aren't in the table are listed as "Not modeled" in the UI rather than silently ignored.

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
- Values are expected averages. The game rounds each hit down, so in-game numbers can be slightly lower.

## Motion values

Source: the Monster Hunter Wiki's `MHWilds/<Weapon> Mechanics` pages. Only **Great Sword, Sword &
Shield and Hammer** have complete tables so far; the other pages say "Work in Progress". Other sites
checked (game8, fextralife, Kiranico) don't publish per-move values for Wilds.

`node scripts/extract-wiki-moves.mjs` (from `frontend/`) re-reads the wiki and rewrites `moves.json`.
It handles charge levels, multi-hit moves (`10x3`), per-hit modifiers and footnotes (kept as notes,
e.g. variable hit counts), and it reports anything it can't parse. Review the diff, then run
`npm run import-data`. When the wiki finishes another weapon, re-running the script adds it.

Known source quirks: the wiki lists Sword & Shield shield bashes as "Sever" (cutting) damage; we keep
that. Great Sword Focus Strike: Perforate's 11 small hits do less than listed (the wiki notes a falloff
curve), so its total is an upper bound.

## Not yet modeled

Motion values for the other 11 weapon types, element caps, Burst, Coalescence, Convert Element, Elemental Absorption, Mind's
Eye, Partbreaker, Flayer, ranged ammo/shot skills, set and group bonuses,
food/item buffs (Might Seed, Demondrug, Powercharm), and wound hitzone changes.
