# Artian and Gogma Artian weapons

The game data only has the base Artian weapons (Artian I/II, the R8 named weapon, and the three
Gogma Artian device variants; see `DATA.md`). Element values, infusion bonuses, device element
changes and reinforcements are **researched values** stored in
`frontend/scripts/supplements/artian.json`. The import script converts them into
`assets/data/artian.json`.

UI: **Artian Forge** page (`/artian`). Saved weapons go to localStorage (`mhwet.artians.v1`) and appear
first in the Builder's weapon list for their weapon type.
Logic: `frontend/src/app/core/artian/artian.ts` (plain TS, tested against the real data).

## How a weapon is built

```
base        = game-data weapon: Artian of the chosen rarity, or the Gogma variant for the chosen device
attack      = base attack   + 5  per Attack part   + attack reinforcements
affinity    = base affinity + 5% per Affinity part + affinity reinforcements
element     = parts value [R6/7 or R8]
            + infusion bonus (only when all 3 parts match)
            + Gogma device element change
            + element reinforcements
sharpness   = base bar + sharpness reinforcements on the top color
skills      = Gogma set skill + group skill, 1 point (one piece) each
```

"Dragon Attack Infusion" means three Dragon parts, each with the Attack bonus. "Water Affinity
Infusion" means three Water parts, each with the Affinity bonus. Two matching parts give the element
without the infusion bonus. If all three parts differ, the weapon has no element.

Attack and affinity values are true values. The game shows attack multiplied by a weapon-class
factor (Great Sword 190 is shown as 912), so it won't match the in-game number. Element is stored as
true values and shown ×10 in the UI, which matches the game.

## Sources and agreement

Researched 2026-10-01. The tables were read from the Monster Hunter Wiki's page source and
cross-checked against the other sites.

| Value | Sources | Agreement |
|---|---|---|
| Base attack/affinity per rarity and device | **game data**, wiki, phantombrawlers, game8 | exact |
| Element/status per weapon type and rarity | [wiki][wiki], [phantombrawlers][pb] | exact (pb uses true units) |
| Element infusion bonus | wiki, phantombrawlers, [game8][g8] | exact |
| Part bonus +5 atk / +5% aff | wiki, game8 | exact |
| Artian reinforcements (level I) | wiki, game8 | exact |
| Gogma reinforcements II/III/EX | [wiki Gogma][wg], [game8 Gogma][g8g], [wycademie][wy] | exact |
| Gogma element boost per type (II, EX) | wiki Gogma, game8 Gogma | exact |
| Gogma device element change (affinity, element focus) | wiki Gogma, game8 Gogma | exact |
| Gogma attack-focus element: Hunting Horn +30, Gunlance +40 | wiki Gogma only | **single source** |
| Max 2 EX of one type | wiki Gogma | single source |
| Regular Artian max counts (aff ×3, element ×4, sharpness ×2) | game8 | single source; shown as warnings only |

Where sources disagreed:
- phantombrawlers says the element device gives "+5 element for all weapons". The wiki and game8
  both list per-type values (+30 to +80 displayed, i.e. +3 to +8 true). We use the per-type values.
- One guide says every R8 Artian has "400 element". The wiki and phantombrawlers per-type tables
  contradict this, and we use those tables.
- The wiki lists Hunting Horn's attack-focus affinity as −10. The game data's Hunting Horn attack
  device has −10% total (5 − 15), the same as every other type, so we use the game data.

## Assumptions and gaps

- **Element/status device changes and boosts on status weapons** use the same numbers as element.
  No source separates them.
- **Sharpness reinforcements** add hits to the bar's current top color. They lengthen the bar but don't
  change the top color, so damage at fresh sharpness is unchanged.
- **Gogma set/group skills** count as one piece each, based on the wiki saying "just like armor
  equipment".
- Not modeled: ammo changes from bowgun parts, coating changes from status bow parts, ammo
  capacity reinforcements, and the Hunting Horn echo bubble / Gunlance shelling / phial changes
  beyond what the game data's device variants already contain.

[wiki]: https://monsterhunterwiki.org/wiki/Artian_Weapons_(MHWilds)
[wg]: https://monsterhunterwiki.org/wiki/Gogma_Artian_Weapons_(MHWilds)
[g8]: https://game8.co/games/Monster-Hunter-Wilds/archives/503103
[g8g]: https://game8.co/games/Monster-Hunter-Wilds/archives/571311
[pb]: https://www.phantombrawlers.com/mhwilds/Artian
[wy]: https://lescarnetsdelawycademie.fr/gogmazios-weapons/
