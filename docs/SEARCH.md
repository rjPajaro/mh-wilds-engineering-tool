# Armor search

The Armor Search tab (`#/search`) finds armor sets that reach chosen skill levels.

- Logic: `frontend/src/app/core/search/armor-search.ts` (pure, tested).
- Runs in a Web Worker: `features/armor-search/armor-search.worker.ts`. `data/armor-search.service.ts`
  runs it inline when `Worker` is missing (unit tests).
- Settings persist in localStorage (`mhwet.search.settings.v1`). Results stay in memory only.
  Older settings with `useWeapon` are migrated on load to the Builder's weapon at that time.
- Weapon pickers are shared with the Builder: `shared/weapon-options.ts`.

## Skill categories

`core/skills/skill-categories.ts` groups skills by their in-game icon (`Skill.icon`), with
name-based overrides where the icon misfiles a skill by effect. For example, Weakness Exploit has the
attack icon but raises affinity, and Agitator has the generic offense icon but mainly raises attack.
A test checks that every override name still exists in the data.

## What it searches

- **Fixed:** the weapon picked on the tab (any game weapon or custom Artian; "Use Builder's" copies
  the Builder's). Its skills count, and its slots take weapon jewels. With no weapon, weapon skills
  can only come from talismans. "Equip in Builder" also equips the picked weapon.
- **Chosen:** head, chest, arms, waist, legs, a talisman (or none), and jewels for every slot.
- **Talisman pool:** the user's own (Talismans tab), optionally plus every craftable one.
- **Transcended armor:** when this is on, rarity 5+ pieces are replaced by their transcended version.
- Jewel supply is unlimited. Weapon jewels give only weapon skills and armor jewels give only armor
  skills (checked against the data), so a weapon skill can only come from the weapon, weapon jewels
  or a talisman.

## Requirements

- Armor and weapon skills need `level` points.
- Set and group bonuses need the rank's `piecesRequired` (Gore α rank II: 4 pieces).
- Jewels never give set or group points.

## Algorithm

1. **Projection.** Each item is reduced to its points on the requested skills and its slot counts
   by level and type (armor/weapon).
2. **Pruning by profile.**
   - Items with identical profiles collapse into one. Armor keeps the highest max defense, and the
     rest are shown as "or N more".
   - Items that another item matches or beats on every point and every slot are dropped.
   - Slot dominance compares sorted slot levels per type.
   - Jewels are pruned the same way.
3. **Depth-first search** over talisman → head → chest → arms → waist → legs. A branch is cut when a
   skill cannot be reached even with the best remaining piece per kind, plus the best jewel in every
   slot. An aggregate bound does the same for the total of all points.
4. **Jewels.** An exact search fills the remaining points, memoized on (deficits, free slot counts).
   - It always uses the smallest free slot that fits. An exchange argument shows this is never worse.
   - It keeps the plan with the most free slot space, larger slots first.
5. **Ranking.** Every combination is tried. Only the best 200 are kept, by free slots or defense.

Speed on real data, with a 3-slot weapon:

| Requested skills | Sets found | Time |
|---|---|---|
| WEX 5, Agitator 5, Burst 1 | ~111k | ~0.13 s |
| WEX 5, Agitator 5, Maximum Might 3, Critical Boost 5 | ~102k | ~0.16 s |

A 30 s time limit guards against slow searches. When it is hit, the results are the best of the sets
found so far.

## Top 5 by damage

The **Top 5 by damage** button (`core/search/damage-search.ts`, same worker) finds the sets with the
highest expected damage of a 100 MV hit for the picked weapon. It needs a weapon; picked skills are
optional and act as must-haves.

- Damage comes from the calculator (`docs/CALC.md`) with the Builder's Damage panel conditions, buffs
  and target part. With no target, a neutral weak point (every hitzone 100) is used, so Weakness
  Exploit counts.
- Talismans follow the Talismans option (default: the user's own plus every craftable one).
- **Dimensions:** every modeled damage skill (plus Handicraft) that raises damage on its own for this
  weapon and these settings, e.g. element skills only for a matching element, toggles only when on.
- **Beam search** over their levels, from the must-have levels up. Each step raises one skill to its
  next level that adds damage (Handicraft can need several levels before the bar changes color).
  Candidates are checked in damage order with the armor search, stopping at the first set found
  (`stopAfter`); the 24 best reachable ones per round are kept.
- Checks are cheap thanks to: reachability being downward closed (anything below a reachable
  combination is reachable, anything above an unreachable one is not), and re-fitting jewels on the
  last 8 sets found before running a full search.
- The best reachable combinations that no better one contains get a full search (most free slots).
  Results are different armor + talisman combinations, ranked by the damage of the skills each set
  actually has (it can exceed the target levels).
- It is a heuristic: a width of 24 matched a width of 48 on Long Sword, Great Sword, Sword & Shield and
  Hammer, while 12 missed about 1% on Hammer. It takes 0.3 to 8 s on real data; the limit is 60 s.

## Progress bar

Both searches report progress from the worker (`onProgress`, at most every 100 ms). The tab shows a
bar with the phase, elapsed time and an estimate of the time left. The estimate is elapsed time scaled
by the share still to do, shown after 5% and 1 s, and capped by the time limit.

- **Armor search:** the share of the search tree covered, from the positions in its first three
  levels (talisman, head, chest). Branches differ in size, so it can speed up or slow down.
- **Top 5 by damage:** 90% for raising skills, then 10% for the full searches of the results. The
  first part is (levels added / most levels any set could add)², where the bound is the armor
  search's total-points bound. It is squared because later rounds are much slower: they check
  combinations near the limit of what the armor allows. On real data the beam ended at 85–95% of
  the bound. A slow check moves the bar toward the next level.

## Not handled yet

- Ranking by real DPS: there is no attack timing data, so damage per hit stands in for it.
- Excluding specific pieces, or limiting armor to what the player owns.
- Jewel inventory limits.
