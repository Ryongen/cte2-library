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
Currently 566/567; `max_total_summons` exists in no source and is reported by
name. Re-run it after the mod changes.

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
  one; a filename-keyed merge double-counts it.
- **Whitelist registry directories, never walk the tree.** The pack ships
  hand-made junk beside the real folders — `mmorpg_map_mob_list - obsolete`,
  a typo'd `mmorph_shrine_buff`, a stray `.claude/`.
- Uniques store stats under `unique_stats`; everything else uses `stats`. Gems
  use a single `v1` instead of `min`/`max`.
- Drop `hide_from_wiki: true` and the filler ids `empty`/`unknown`/`none` —
  that is why spells show 309 of 437 ids (128 are `*_deprecated`).
- Pack JSON is not always strict JSON (trailing commas); `sources.py` parses
  leniently, as Minecraft's GSON does.

### Tooltip rendering
Nothing is pre-baked — the page rebuilds every tooltip at the current level, so
the level box works. The ports:

| Module | From |
|---|---|
| `src/scaling.js` | `LevelScalingConfig.getMultiFor`, `StatScaling`, `Stat.scale` |
| `src/stats.js` | `StatMod.getEstimationTooltip`, `getRangeToShow`, `BasicStatRegex` |
| `src/mcfmt.js` | colour codes, Enlighten `[label](link)`, `MMORPG.formatNumber` |
| `src/tooltips.js` | each `BestiaryGroup` lambda's line order |

Two behaviours that look like bugs and are faithful:
- **Only FLAT modifiers scale with level.** Percent and more are untouched, so
  `50% Gear's Defense` is identical at level 1 and 100 while `5.00 -> 8.00
  Health` becomes `104 -> 166` (`1 + 0.2*99 = 20.8x`).
- **Long stats ignore both the level and the range.** A stat whose lang string
  has a `[VAL1]` hole is its own sentence; the mod fills it with the *unscaled*
  `min` and returns before the range is built — and appends no `%`, because the
  sentence writes its own. Adding one yields `+15%%`.

Other faithful oddities: `unique` rarity really is `RED`, not gold. Profession
EXP lists one row per *exp source*, not per profession (`ProfExpBestiary`), so
professions with no `exp_sources.map` contribute nothing.

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

Deep links take `?v=&g=&id=&lvl=`. Good probes: `g=spell&id=fireball` (icons,
`[calc:]` substitution, chips), `g=unique_gear&id=azurewrath&lvl=90` (ranges,
scaling), `g=supp_gem` (rarity picker), `g=affix` (tag + exclusion chips).

## State / what's left
- Live data: **2.1.4 only**. Older versions can be backfilled from any instance
  still on disk.
- **GitHub Pages**: enable at Settings → Pages → Deploy from a branch → `main`
  → `/ (root)`. Site will be <https://ryongen.github.io/cte2-library/>.
- **Not built yet**: `tools/fetch_curseforge.py` (CTE2 is CurseForge project
  `936875`; needs a free `CF_API_KEY`) and `.github/workflows/update-data.yml`
  to auto-add a version per pack release. `extract.py` is already folder-first,
  so this is additive: fetch pack zip → overrides, read `manifest.json` for
  pinned mod file ids → jars → hand the folder to `extract.py`.
- Modrinth is **stale** (newest 1.20.1 Mine and Slash there is 6.3.7, Jul 2025;
  the pack ships 6.4.13), so CurseForge is the only live channel for automation.
