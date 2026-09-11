# CTE2 Library

A web version of the in-game Mine and Slash wiki, for the
[Craft to Exile 2](https://www.curseforge.com/minecraft/modpacks/craft-to-exile-2)
modpack. Browse every affix, unique, runeword, rune, gem, spell, support gem,
aura, status effect and currency orb at any character level, with the tooltips
rendered the way the game draws them.

Static site, no build step. Deploy by serving the repo root.

## Why the pack, not the mod

CTE2 ships its own datapack overrides, and they are most of the content rather
than a tweak. Measured against the 2.1.4 instance:

| | mod jar | CTE2 override | shown |
|---|---|---|---|
| affixes | 212 | 505 | 521 |
| spells | 120 | 570 | 309 |
| unique gears | 51 | 480 | 258 |
| runewords | 9 | 59 | 59 |
| support gems | 61 | 90 | 90 |
| currency | 86 | 21 | 86 |

A site built from the mod's defaults alone would show about a quarter of what
players see, under the wrong names.

The "shown" column is lower than the file counts for spells and uniques because
entries are keyed on their internal id, not their filename - the pack *replaces*
most ids rather than adding to them - and because entries flagged
`hide_from_wiki` are dropped, exactly as the in-game list drops them. For spells
that is 128 `*_deprecated` skills.

## Running it

```
python tools/serve.py
```

Serves the repo on <http://127.0.0.1:8777/> and opens a browser. It is a plain
static site, so any static server works and GitHub Pages needs no equivalent -
this just adds no-cache headers so edits show up without a hard refresh.

## Building a version's data

```
python tools/extract.py --instance "G:\PrismLauncher\instances\Craft to Exile 2 - 2.0.2 Atlas Update\minecraft"
```

Python 3, standard library only - no install step, and it runs the same on
Windows and on a CI runner. Point `--instance` at any Prism or CurseForge
instance folder: it holds both the mod jars (`mods/`) and the pack's overrides
(`config/openloader/`), so one path covers everything. Every instance still on
disk is a version you can backfill.

**The version is read from the launcher, not from you or the folder name.**
Prism never renames an instance directory when the pack updates, so the folder
above still says *2.0.2 Atlas Update* while the install is really **2.1.4** -
`instance.cfg` is rewritten on every update and `ManagedPackVersionName` is
authoritative. CurseForge instances are read from `minecraftinstance.json` the
same way. Pass `--version` to override; if it disagrees with the launcher the
extractor says so before using yours.

The extractor merges the jars first and the pack last, which is the precedence
the game applies at load, then writes `data/<version>/`:

| File | What |
|---|---|
| `groups/*.json` | one file per wiki group, rows close to the raw data |
| `lang.json` | the lang keys the site renders, mod + pack merged |
| `balance.json` | scaling curves, rarities, value calcs, stat metadata |
| `meta.json` | pack and mod versions, max level, per-group counts |

Icons land in `assets/icons/` and are **not** versioned - they change rarely and
512 item textures is ~3.7 MB, so only the JSON forks per version. A version is
about 1.4 MB, which compresses hard over the wire.

It prints per-group counts on every run. A group at 0 means a wrong registry
directory or id field; a group sitting at the *jar* count means the override
layer silently did not load, which is the failure worth watching for because the
site would still look complete.

### Stats that only exist in Java

`ExileRegistryTypes.STAT` serialises only datapack-defined stats. Health, armor,
gear_defense and every elemental resist are `Stat` subclasses registered in
code, so they appear in no JSON - about a third of the stat ids the content
references, and half of all stat lines. Without their `is_perc` and `scaling`
those numbers render wrong: a NORMAL-scaled stat is out by up to 20.8x at
level 100.

`tools/gen_code_stats.py` recovers them by scanning the mod's own source and
writes `tools/code_stats.json`, which the extractor layers *underneath* the
datapack registry:

```
python tools/gen_code_stats.py --mod-src <path to Mine-And-Slash-Rework>
```

It resolves 566 of the 567 referenced stats. Anything left over is reported by
`extract.py` by name rather than being quietly defaulted. Re-run it when the mod
changes.

## How the tooltips are rendered

No pre-rendered text: the page rebuilds each tooltip from the raw data at
whatever level is in the box, which is what makes the level control work. The
pieces are ports of small, specific bits of the mod:

| Module | Ported from |
|---|---|
| `src/scaling.js` | `LevelScalingConfig.getMultiFor`, `StatScaling`, `Stat.scale` |
| `src/stats.js` | `StatMod.getEstimationTooltip`, `getRangeToShow`, `StatNameRegex` |
| `src/mcfmt.js` | Minecraft colour codes, Enlighten link markup, `MMORPG.formatNumber` |
| `src/tooltips.js` | each `BestiaryGroup` lambda's line order |

Two details worth knowing, because they look like bugs and are not:

- **Level scaling applies only to FLAT modifiers.** `Stat.scale` returns percent
  and more modifiers untouched, so `50% Gear's Defense` is the same at level 1
  and 100 while `5.00 -> 8.00 Health` becomes `104 -> 166`.
- **Long stats ignore the level and the range.** A stat whose lang string
  carries a `[VAL1]` hole is its own whole sentence; the mod fills it with the
  unscaled `min` and returns before the range is built. No `%` is appended
  there either - the sentence already writes its own.

Check rendering without a browser:

```
node tools/render-check.mjs 2.1.4 100
```

## Known differences from the in-game wiki

- **Spell numbers that scale off a character.** `ValueCalculation` reads the
  caster's Weapon Damage and stats, and a web page has no caster. The site shows
  the base value at the chosen level plus the scaling terms -
  `36 +234% Weapon Damage` - where the game prints one final number.
- **Uniques show ranges, not a rolled item.** In game the wiki builds a real
  stack through `GearBlueprint`; here each line is its min -> max at the chosen
  level, which is more useful for planning but is not the same view.
- **Spell costs and cooldowns are as written** in `SpellConfiguration`, without
  the Cooldown Reduction and Blood Mage adjustments the game applies from live
  stats.

## Layout

```
index.html  app.css     the page
src/                    ES modules, no bundler, no dependencies
data/<version>/         one self-contained bundle per pack version
assets/icons/           shared across versions
tools/                  extractor and checks
```
