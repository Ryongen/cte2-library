# CTE2 Library

A web version of the in-game Mine and Slash wiki for the
[Craft to Exile 2](https://www.curseforge.com/minecraft/modpacks/craft-to-exile-2)
modpack. Look up any affix, unique, runeword, rune, gem, spell, support gem,
aura, status effect or currency orb, with the tooltips drawn the way the game
draws them.

**<https://ryongen.github.io/cte2-library/>**

Built from the pack's own files - the mods plus CTE2's datapack overrides - so
the names and numbers match what you actually see in game.

## Quick start

Pick a category on the left, click an entry, read its tooltip on the right.

- **Level** rebuilds every tooltip at that character level (1-100). Most stats
  grow with it, so a unique at level 100 shows very different numbers than at
  level 1.
- **Search** matches names and ids. Tick **Search tooltips** to search the whole
  tooltip text instead - useful for finding every affix that mentions Freeze
  Chance, or which spells are tagged Projectile.
- **Filters** above the list narrow a category: affix type and which base item
  it rolls on, unique gear slot and league, rune count, spell class, tag and
  style, and so on.
- **Category** is the coarse version of the base item pick, on affixes, uniques
  and runewords: *Any Chest*, *Any Plate*, *Any Two-Handed Weapon*, *Any
  Off-Hand* and so on, instead of picking through 43 base items one at a time.
  Two-handed means what the game means by it, so bows, crossbows and tridents
  are in there beside the greatswords.
- **Auras and support gems** get a rarity picker, since their numbers roll
  inside a rarity's window.
- The address bar follows along, so a link like
  `?v=2.1.4&g=spell&id=fireball&lvl=75` opens exactly what you were looking at.

Spell damage reads the way the game writes it - a base number plus its scaling
terms, like `36 +234% Weapon Damage` - because there is no character here to
scale it against.

A unique that belongs to a gear set draws the set underneath it: the other
pieces, each a link to its own entry, and every bonus tier with the piece count
it needs. Set bonuses are never rolled, so they are one number rather than a
range - but the flat ones still follow the level box. Pick a **Set** in the
filter row to see one set's pieces on their own.

A skill that sets another one off draws it underneath, under **Triggers** -
Banishing Blade's buff is what makes you apply Soul Wound, and that chain runs
through three registries the in-game screen leaves you to walk yourself. The
triggered skill's name is a link to its own entry, and **Proc Recharge** is the
gap between two triggered casts, which no Cast Speed or Cooldown Reduction can
shorten.

## What's in it

Currently pack version **2.1.4**:

521 affixes · 258 uniques · 309 spells · 209 status effects · 90 support gems ·
86 currency orbs · 72 gems · 59 runewords · 55 profession exp sources ·
28 auras · 22 runes

## Running it locally

```
python tools/serve.py
```

Serves the site at <http://127.0.0.1:8777/> and opens a browser. Any static
server works; this one just skips caching so edits show up on reload.

To add data for another pack version, point the extractor at an instance folder
that has it installed:

```
python tools/extract.py --instance "<launcher>/instances/<instance>/minecraft"
```

It reads the mod jars and the pack overrides from that one folder, picks the
version up from the launcher's own config, and writes `data/<version>/`. Python
3, standard library only - nothing to install.
