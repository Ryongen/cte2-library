# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is
**CTE2 Library** — a static web replica of the in-game Mine and Slash wiki
(`NewWikiScreen`, the "library") for the **Craft to Exile 2** modpack. Vanilla
ES modules, no bundler, no dependencies, no build step; GitHub Pages serves the
repo root. Published at <https://github.com/Ryongen/cte2-library>.

**This is not the mod.** The mod lives at `G:\Projects\Mine-And-Slash-Rework-1.20-Forge`
and is only a *reference* — read it to check how a tooltip or a formula works,
never edit it from here. It has its own `CLAUDE.md` covering the mod itself.

Prior art this deliberately parallels: [cte2-planner](https://github.com/Cofeiini/cte2-planner),
the talent-tree planner, which uses the same `data/<pack version>/` shape.

## Commands

```
python tools/extract.py --instance "<instance>/minecraft"   # build a version bundle
python tools/gen_code_stats.py --mod-src "G:\Projects\Mine-And-Slash-Rework-1.20-Forge"
python tools/serve.py                                        # localhost:8777 + browser
node   tools/render-check.mjs 2.1.4 100                      # tooltips as plain text
```

There is no test suite. `render-check.mjs` plus a headless screenshot (below) is
how rendering gets verified.

The known-good instance on this machine:
`G:\PrismLauncher\instances\Craft to Exile 2 - 2.0.2 Atlas Update\minecraft`

## Non-obvious facts, all verified against real data

### The pack overrides *are* the content
CTE2's openloader datapacks are not a tuning layer. Jar vs override: affixes
212/505, spells 120/570, uniques 51/480, runewords 9/59. The pack's lang file
is a partial-but-large override (3637 keys) that must be merged over the mod's,
not substituted for it. A build from mod jars alone shows roughly a quarter of
the game under the wrong names.

**The failure worth guarding:** a group landing at the *jar* count means the
override layer silently didn't load. The site still looks complete. `extract.py`
prints per-group counts and how many rows came from the pack — read them.

### The folder name is never the version
Prism doesn't rename an instance when the pack updates. That directory says
*2.0.2 Atlas Update*, `instance.cfg`'s own `name=` says *2.0.4*, and the install
is actually **2.1.4**. `ManagedPackVersionName` in `instance.cfg` is the only
authoritative source (CurseForge instances: `minecraftinstance.json`).
`--version` is optional and exists only to override; it warns on disagreement.

### A third of the stats exist only in Java
`ExileRegistryTypes.STAT` serialises only *datapack* stats. `health`, `armor`,
`gear_defense` and every elemental resist are `Stat` subclasses registered in
code — 168 of 567 referenced ids, **half of all stat lines**. Without their
`is_perc`/`scaling` those numbers are wrong by up to 20.8x at level 100, and
wrong silently.

`tools/gen_code_stats.py` scans the mod source and writes `tools/code_stats.json`
(committed), which `extract.py` layers *underneath* the datapack registry.
Currently every referenced stat resolves (572, 403 datapack + 169 code).
`max_total_summons` used to be reported as unknown; the only thing that
referenced it was a stale duplicate entry (below). Re-run it after the mod
changes, and read the unresolved list when it prints one.

Two traps that generator already handles, so don't "simplify" them away:
- Stat classes live outside `stats/` too (profession stats are in
  `database/data/profession/stat/`), so it scans all of `database/data`.
- A class needs a `scaling` or `percent` declaration to count as a stat.
  `SupportGem` has a `GUID()` method, so without that gate every
  `new SupportGem("burn_chance", …)` registers a gem id as a stat and
  overrides the real `_chance` rule with the wrong percent flag.

### Registry reading rules
- Datapack path is `data/<modid>/<modid>_<registry>/**.json`.
- **Key entries on their internal id field, never the filename.** The id field
  differs per registry (`guid` for affixes/uniques/bases, `identifier` for
  gems/spells, `id` for most, and `mmorpg_stat` uses both `id` and `data.id`).
  `mmorpg_unique_gears` keeps a deprecated flat copy beside the live per-slot
  one; a filename-keyed merge double-counts it. Which of the two wins is its
  own trap — see below.
- **Whitelist registry directories, never walk the tree.** The pack ships
  hand-made junk beside the real folders — `mmorpg_map_mob_list - obsolete`,
  a typo'd `mmorph_shrine_buff`, a stray `.claude/`.
- Uniques store stats under `unique_stats`; everything else uses `stats`. Gems
  use a single `v1` instead of `min`/`max`.
- Drop `hide_from_wiki: true` and the filler ids `empty`/`unknown`/`none` —
  that is why spells show 309 of 437 ids (128 are `*_deprecated`).
- Pack JSON is not always strict JSON (trailing commas); `sources.py` parses
  leniently, as Minecraft's GSON does.

### Two files, one id: the flat copy is the stale one
The pack declares the same id twice a lot — 170 uniques, 139 spells, 146 stats,
one status effect. It is always the same shape: a flat `honourhome.json` left
over beside the live `chainmail_helmet/honourhome.json` the author moved into a
per-slot folder. The leftovers are a single April batch by mtime; the folder
copies are August/September. They are not equal files — that Honourhome is
50-60% Gear's Defense against the current 12.5-15%, and 138 spells had
`Max Gem Level 16` where the pack now says 20.

**There is no in-game order to copy here.** Both files load: `fileToId` makes
them two different resource locations (`mmorpg:honourhome` and
`mmorpg:chainmail_helmet/honourhome`), and `BaseDataPackLoader.apply` registers
each by its internal GUID, unregistering whatever held it. It iterates a
`HashMap`, so the winner is bucket order — simulating it gives the subfolder
copy for 92 uniques and the flat one for 78. The game is picking at random and
players see a mix.

So `load_registry` ranks candidates within a source instead: a filename that
matches the declared id beats one that does not (`fishing_treasure_chance_bonus.json`
declares `fishing_bar_size` — copy-paste that never got its id changed, and it
was shadowing the real stat), then the deeper path, then path order. Source
order still outranks all of it, so the pack keeps beating the jar.

It prints `ids declared twice by one source` on every run. Counts climbing is
the pack reorganising further; a *new* group appearing there is worth a look.

### A gear rarity has two percent windows and they are not the same one
`GearRarity` carries both `stat_percents` and `base_stat_percents`, and they
answer different questions:

- **`stat_percents`** is where a roll lands. `SkillGemBlueprint` rolls a gem's
  `perc` in it, and `ISkillGem.getAllStatsWithCtx` shows it as the range - so
  it is what the wiki's rarity button narrows to. In this pack: rare 35-51,
  mythic 86-100.
- **`base_stat_percents`** is read by `BaseStatsData` alone, for a gear's own
  base stats. Every rarity's is `x-100`.

Reading the second where the first belongs looks almost right: the low end
still moves per rarity, so the bug reads as "picking Rare only changed the
minimum". Both are extracted; `pctMin/pctMax` is the roll window and
`basePctMin/basePctMax` the base-stat one.

### Unique gear is a base item, not a stat list
`BestiaryGroup.UNIQUE_GEAR` builds a real `GearBlueprint`, so the wiki entry is
a plate chest that happens to have unique stats - it shows the base item's
Armor and Health above them. Those come from `mmorpg_base_gear_types`
(`base_stats`), rolled inside the unique rarity's `base_stat_percents` (75-100)
and scaled to the level like any FLAT stat.

`gear_defense` and `gear_weapon_damage` are `IBaseStatModifier`: they do not add
a line, they **rewrite the base numbers**. `gear_defense` reaches `armor`,
`dodge` and `magic_shield`; `gear_weapon_damage` only `weapon_damage`. Order is
load-bearing - `BaseStatsData.GetAllStats` adds every FLAT one first and only
then multiplies by the PERCENT ones.

Nothing but the gear bases mentions `weapon_damage` or `learn_bolt`, so they
have to be fed into `fill_code_stats` explicitly (`gear_type_stats`) or a
weapon's whole damage line renders at NONE scaling - out by 20.8x at level 100.

### Affix "slots" are tags, and the layering is deliberate
An affix declares tag requirements, not slots, and `GroupFilterType.AFFIX_SLOTS`
resolves them by testing every affix against every `BaseGearType`. A cloth
helmet carries `helmet`, `cloth` **and** `cloth_helmet`, so three different
affix pools roll on it; that is not redundancy. The hybrid armours go further -
`chainmail_helmet` carries `plate_helmet` *and* `cloth_helmet`, inheriting both
families' affixes.

`INCLUDES_ANY` (453 affixes) needs one included tag, `HAS_ALL` (52) needs all,
and an excluded tag vetoes either. 139 affixes match no base item at all -
enchantment, jewel and tool affixes key off tags no `BaseGearType` has; the
in-game filter hides them the same way. Requirements are stored per-requirement
(`row.reqs`), because `satisfiesAllRequirements` ANDs the list while each entry
is its own any/all test - flattening them silently changes the meaning if a
pack ever ships two.

### Tooltip rendering
Nothing is pre-baked — the page rebuilds every tooltip at the current level, so
the level box works. The ports:

| Module | From |
|---|---|
| `src/scaling.js` | `LevelScalingConfig.getMultiFor`, `StatScaling`, `Stat.scale`, `LeveledValue` |
| `src/stats.js` | `StatMod.getEstimationTooltip`, `getRangeToShow`, `ExactStatData`, `BasicStatRegex` |
| `src/mcfmt.js` | colour codes, Enlighten `[label](link)`, `MMORPG.formatNumber` |
| `src/tooltips.js` | each `BestiaryGroup` lambda's line order |
| `src/gear.js` | `TagRequirement.meetsRequierment`, `BaseStatsData` |

Two behaviours that look like bugs and are faithful:
- **Only FLAT modifiers scale with level.** Percent and more are untouched, so
  `50% Gear's Defense` is identical at level 1 and 100 while `5.00 -> 8.00
  Health` becomes `104 -> 166` (`1 + 0.2*99 = 20.8x`).
- **Long stats ignore both the level and the range.** A stat whose lang string
  has a `[VAL1]` hole is its own sentence; the mod fills it with the *unscaled*
  `min` and returns before the range is built — and appends no `%`, because the
  sentence writes its own. Adding one yields `+15%%`. Only on the *range* path,
  though: `ExactStatData.fromStatModifier` runs `scaleToLevel` before the
  sentence is filled, so the same stat on a skill gem *is* level-scaled. Both
  are reproduced; they are two different renderers in the mod, not one.

Other faithful oddities: `unique` rarity really is `RED`, not gold. Profession
EXP lists one row per *exp source*, not per profession (`ProfExpBestiary`), so
professions with no `exp_sources.map` contribute nothing.

### A skill has two levels and almost nothing on it reads the character's
A `Spell` is its own `MaxLevelProvider`, and `LeveledValue.getValue` asks the
provider — not the unit — for both the level and the ceiling. So on a skill's
tooltip the gem's rank, not the character level, drives:

- **the resource cost** (`SpellConfiguration.mana_cost` / `ene_cost`),
- **the flat base of every `[calc:]`** and **every stat proportion in it**
  (`ValueCalculation.base`, `ScalingCalc.multi`),
- **the stats of any status effect the skill applies**
  (`ExileEffect.getExactStats` rolls them at `LeveledValue(0, 100)` over the
  *casting skill's* rank).

The character's level still owns `base_scaling_type.scale` on a calc's base and
`Stat.scale` on every FLAT stat, so the two interleave inside one line: Fireball
at character 100 reads `38 +277% Weapon Damage`, where the 38 is the character's
and the 277% is the gem's.

The ceiling is `max_lvl + MAX_BONUS_SPELL_LEVELS` — **8 in this pack**, against
the mod's default of 5, and gear is the only way past the natural max. That
matters more than it looks: `Spell.getStats` rolls the gem's own stats at
`(int)(rank / maxWithBonuses * 100)`, so a gem sitting at its natural 20 is at
**71%** of its range, not 100%. Showing those as a full `min -> max` range reads
as if the last 29% were reachable by levelling.

`max_lvl` is per skill and not always 20 — the stances cap at 4 (12 with gear) —
so the Skill Lvl box holds one number and every entry clamps it to its own
ceiling. Empty means "this skill's natural max", which is the only default that
is right for every entry.

`MANA_COST_SCALING` is the one curve on this path that reads the character:
`SpellStatsCalculationEvent` multiplies both costs by it before anything else,
so a level 100 character pays 20.8x the configured number (Fireball: 7 -> 154).
It is not a stat curve, but it ships in the same `game_balance` entry and is
extracted into `curves` beside the others.

### The buffs a skill puts up
`Spell.GetTooltipString` finds them in two places: the `effect_tip` field, and
an `exile_effect` act on any component. **Any** component — `getAllComponents`
is `on_cast` *plus* every entity one, and most debuffs live on the projectile's
component, so reading only `on_cast` loses them.

Two things the mod's own loop conflates, and the site does not:
- **159 of the pack's 598 effect acts are a `REMOVE`.** Ice Comet *removes* an
  Overheat stack and Dark Pact *consumes* three Sacrifice; listing those under
  the same heading as a buff inverts what the skill does.
- **`potion_dur: -1` is `ExileEffectAction.INFINITE_DURATION`**, and the mod
  prints it through `tooltipFormatTicksAsSeconds` as `-0.05` seconds. Here it is
  "permanent".

The spell rows carry only the effect id and how it is applied; the stats come
from the `effect` group at render time, because they scale with the *skill's*
rank and a copy baked into the spell row would be a second thing to keep true.
That is the one group that pulls a second group's file (`src/app.js`).

## Conventions
- **Never hand-edit `data/**`** — it is generated. Change `tools/` and re-extract.
- Icons in `assets/icons/` are shared across versions, not per-version. Only
  JSON forks per version (~1.4 MB each).
- `.gitattributes` pins LF. Without it Windows checkout gives CRLF while the
  extractor writes LF, and every re-extraction shows 300 files as modified.
- `.nojekyll` must stay — Pages would otherwise run the files through Jekyll.
- Keep the site path-relative. It is served from a subpath
  (`/cte2-library/`), so absolute `/data/...` paths break it. Verify by serving
  the parent directory and loading `/cte2-library/`.
- Python: standard library only, so it runs unchanged on Windows and CI.

## Verifying a change visually
Headless Chrome works and is the fastest way to actually *see* a regression:

```
python tools/serve.py --no-open &
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --hide-scrollbars --virtual-time-budget=7000 --window-size=1500,950 \
  --screenshot=shot.png "http://127.0.0.1:8777/?g=spell&id=fireball&lvl=75"
```

Deep links take `?v=&g=&id=&lvl=&slvl=` (`slvl` is the gem rank; omit it for
each skill's natural max). Good probes: `g=spell&id=fireball` (icons, `[calc:]`
substitution, chips), `g=spell&id=fighter_stance&slvl=12` (a short `max_lvl`, the
`+8 from gear` line, and both stances' stats inline),
`g=spell&id=ice_comet` (a skill that only *removes* an effect),
`g=unique_gear&id=fracture_splint&lvl=100` (base stats, `gear_defense` folded
in), `g=supp_gem&id=fire_flat_dmg&lvl=50` (rarity picker - both ends must move),
`g=affix&id=strong_int_armor_suf` (tag chips plus the resolved base items).

Vary `lvl` and `slvl` independently when touching a skill: the two levels move
different halves of the same line, and a mistake that swaps them still produces
plausible numbers at level 1, where both curves sit at their base.

## State / what's left
- Live data: **2.1.4 only**. Older versions can be backfilled from any instance
  still on disk.
- **GitHub Pages**: live at <https://ryongen.github.io/cte2-library/>, deployed
  from a branch — `main`, `/ (root)`. So a push to `main` *is* the deploy;
  there is no build step to wait on beyond Pages itself, which takes a minute.
- **Not built yet**: `tools/fetch_curseforge.py` (CTE2 is CurseForge project
  `936875`; needs a free `CF_API_KEY`) and `.github/workflows/update-data.yml`
  to auto-add a version per pack release. `extract.py` is already folder-first,
  so this is additive: fetch pack zip → overrides, read `manifest.json` for
  pinned mod file ids → jars → hand the folder to `extract.py`.
- Modrinth is **stale** (newest 1.20.1 Mine and Slash there is 6.3.7, Jul 2025;
  the pack ships 6.4.13), so CurseForge is the only live channel for automation.
