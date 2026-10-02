# Game data

Source: `mhdb-wilds-data/merged/` (read-only). `frontend/scripts/import-data.mjs` converts it into
`frontend/src/assets/data/*.json`, typed by `frontend/src/app/core/models/game-data.ts`.

Run `npm run import-data` from `frontend/` after updating the source data. The script fails without
writing anything if a skill reference is broken or a skill level exceeds its max.

## Localization

Every source string is a map of 15 languages (`ja`, `en`, `fr`, ... `es-419`). The importer keeps
only `en` and flattens the in-game hard line breaks (`\r\n`) into spaces. This cuts the data from
8.4 MB to about 950 KB.

## Imported files

| Output | Source | Records | Notes |
|---|---|---|---|
| `skills.json` | `Skill.json` | 179 | `kind`: `armor` (75), `weapon` (66), `set` (25), `group` (17, team-up bonuses) |
| `armor.json` | `Armor.json` | 194 sets / 714 pieces | Pieces have no game id; we use `${setId}:${kind}` |
| `decorations.json` | `Accessory.json` | 361 | `allowedOn` weapon/armor; `slotLevel` 1–3; 173 grant two skills |
| `talismans.json` | `Amulet.json` | 183 | One record per craftable rank, id `${gameId}:${rank}` |
| `weapons.json` | `weapons/*.json` (14 files) | 1188 | id `${kind}:${gameId}` because game ids repeat across weapon types |
| `hunting-horn.json` | `HuntingHorn{Melodies,Songs,EchoBubbles,EchoWaves}.json` | – | Melody → song ids, notes |
| `monsters.json` | `LargeMonsters.json` + `PartNames.json` + `Species.json` | 34 | Hitzones, base HP, weaknesses |

## Not imported

- `Charm.json`: cosmetic weapon pendants (Hope Scarf, plushies). Not talismans.
- `Item.json`, `ArmorUpgrade.json`, `Stage.json`: crafting materials, armor upgrade costs, maps. Not
  needed for builds or damage. Crafting inputs, rewards and locations are dropped too.
- Armor Transcending (TU4) is not in the data. Its slot and defense rules live in
  `core/armor/transcend.ts` (source in the file); the game index adds a transcended
  version of every rarity 5+ piece under `<piece id>:transcended`.
- Random talismans (`Amulet.json` entries with `is_random: true`: Unknown, Secret, Historical,
  Golden Age Charm). They have no fixed skills; players enter the ones they rolled on the
  Talismans tab (`core/talismans/custom-talisman.ts`, stored like custom Artians).
  `Talisman.slots` exists for that, and each slot says whether it takes weapon or armor jewels.

## Skill mechanics in the data

- Skill points are maps of `{ skillId: level }`; the importer turns them into `[{ skillId, level }]`.
- Armor pieces carry their set and group bonus skill at 1 point each. The resolver sums points and
  maps the total to a rank using `ranks[].piecesRequired` (Gore α: 2 → Black Eclipse I, 4 → II).
- `Armor.set_bonus_id` is not reliable: all 5 Gogmazios β pieces list Guardian Arkveld's Vitality
  as the set bonus, but only one piece actually carries that skill. The resolver uses piece skills
  only. The importer logs this as a warning.
- Weapons can carry only `weapon` skills. Armor and talismans carry only `armor`/`set`/`group`
  skills. No source in the data exceeds a skill's max level on its own.

## Weapons

Common fields: `attack` (true raw; the game shows it ×
a weapon-class factor, e.g. Great Sword ×4.8), `affinity` (%), `slots`, `specials` (element or
status, with `hidden` for awakening-type values), `skills`, `series`, `previousId` (upgrade tree).

Melee weapons have `sharpness`: hits per color in order red → purple. Every bar is 200–400 hits.
`handicraft` always totals 50 (Handicraft 5 at 10 per level). We assume it fills consecutive colors
starting at the bar's current top color, which explains leading zeros like `[0, 50]`. **Check
this in game before relying on it.**

### Artian weapons

The data has no Artian flag, so the importer infers one. A weapon with no series, no crafting
materials and no upgrade parent is an Artian. Each weapon type has 6 of these:

- 3 regular Artians, `artian: { tier: 'artian' }`: Artian X I (170/5%), Artian X II (180/5%) and a
  named R8 weapon (190/5%), e.g. Verdoloto.
- 1 Gogma Artian listed three times under the same name, once per production device. The importer
  tags each entry `artian: { tier: 'gogma', device, groupId }`, picking the device by comparing the
  three entries' stats:

  | Device | Attack | Affinity | Rule |
  |---|---|---|---|
  | attack | 200 | −10% | highest attack |
  | affinity | 180 | +15% | highest affinity |
  | element | 190 | 0% | the remaining entry |

The importer stops with an error if a Gogma group doesn't have exactly three entries with
distinguishable devices. In the UI, each Gogma group is one option with a device picker.
`GameIndex.gogmaGroups` maps `groupId` to `{ attack, affinity, element }`.

None of the Artians list an element or status, and the data has no reinforcements or Gogma skills.
Those come from researched values. See `ARTIAN.md`.

Type-specific fields:

| Weapon | Fields |
|---|---|
| Gunlance | `shell` (normal/wide/long), `shellLevel` |
| Switch Axe | `phial.kind` (power, element, exhaust, ...), `phial.value` for valued phials |
| Charge Blade | `phial` (impact/element) |
| Insect Glaive | `kinsectLevel` |
| Hunting Horn | `melodyId`, `echoWaveId`, `echoBubbleId` |
| Bow | `coatings` |
| Light/Heavy Bowgun | `ammo[]` (kind, level, capacity, rapid), `specialAmmo` |

## Monsters and damage-calc gaps

Available:
- `baseHealth` per monster (3800–10000).
- Per-part `hitzones` for slash, blunt, pierce (shot), 5 elements, and stun. **The values are
  fractions** (0.65 = hitzone 65). Part break HP is in `parts[].health` (null when the part can't be broken).
- Weaknesses and resistances with star levels and conditions such as "Effective only while burrowing".

Part names: `PartNames.json` has no English name for `hide` (its `names` is `{}`). `hide` entries
are unbreakable hitzone regions, and 11 monsters have one or more (Lagiacrus has 8) with different
hitzones but nothing saying which body area each covers. The importer names them "Hide", or "Hide 1",
"Hide 2", … when there are several. Other repeated names get their part key added, e.g. Zoh Shia's
"Head (head)" vs "Head (head-hide)". The importer fails if any `name` field ends up as anything other
than a non-empty string.

Missing, so the calculator needs its own data:
- **Motion values** for every weapon attack. None in the dataset.
- **Quest HP and rank multipliers** (tempered, arch-tempered, multiplayer). Only `baseHealth` exists.
- Wound and enrage hitzone changes, skill effect numbers (e.g. Weakness Exploit +X% affinity), and
  sharpness modifiers. Skill rank descriptions contain the numbers as text, but nothing parses them.
- Artian element, infusion and reinforcement values (researched separately, see `ARTIAN.md`).
