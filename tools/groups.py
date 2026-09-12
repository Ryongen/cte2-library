"""Turning merged registry entries into the normalised rows the site renders.

One builder per BestiaryGroup, each reproducing what that group's lambda in
`gui/wiki/BestiaryGroup.java` puts on screen. Rows stay close to the raw data -
the level-scaled numbers are computed in the browser, because the level box
changes them on every keystroke.
"""

import collections
import re

import registries as regs

SECTION = "§"

# Enlighten wraps glossary terms as [label](link); the label is the text.
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_COLOR = re.compile(SECTION + ".")


def clean(text):
    """Strip colour codes and link markup - for names, search and sorting."""
    if not text:
        return ""
    return _LINK.sub(r"\1", _COLOR.sub("", text)).strip()


def title_case(entry_id):
    parts = [p for p in re.split(r"[_:/]", entry_id or "") if p]
    return " ".join(p[:1].upper() + p[1:] for p in parts)


def item_lang_key(item_id):
    """mmorpg:runes/ano -> item.mmorpg.runes.ano"""
    if not item_id or ":" not in item_id:
        return None
    namespace, path = item_id.split(":", 1)
    return "item." + namespace + "." + path.replace("/", ".")


class Context:
    def __init__(self, loaded, lang, code_stats=None):
        self.reg = loaded
        self.lang = lang
        self.code_stats = code_stats or {"exact": {}, "patterns": []}
        self._procs = None
        self._classes = None
        self._gear = None
        self._sets = None

    def procs(self):
        """stat id -> the spells it casts. Built once, read by two groups."""
        if self._procs is None:
            self._procs = proc_spell_index(self)
        return self._procs

    def classes(self):
        """(class key -> {name, order}, spell id -> class key). Built once."""
        if self._classes is None:
            self._classes = spell_classes(self)
        return self._classes

    def gear(self):
        """(gear type id -> row, category list). Built once.

        Two groups read it before `build_balance` ships it, so it cannot be
        built there: a unique files itself under its base item's categories,
        and a runeword under its slots'.
        """
        if self._gear is None:
            types = build_gear_types(self)
            self._gear = (types, build_gear_categories(self, types))
        return self._gear

    def item_sets(self):
        """(set id -> row, unique id -> set id). Built once."""
        if self._sets is None:
            self._sets = build_item_sets(self)
        return self._sets

    def raw(self, key):
        return self.lang.get(key) if key else None

    def name(self, keys, fallback_id):
        """First key that resolves to real text, else the title-cased id.

        'Unused' is a real value in the lang file, a tombstone for entries that
        were renamed - treat it as absent.
        """
        for key in keys:
            text = clean(self.raw(key))
            if text and text != "Unused":
                return text
        return title_case(fallback_id)


def stat_list(raw):
    """Normalise a stat block. Most types use min/max, gems use a single v1."""
    out = []
    for s in raw or []:
        if not isinstance(s, dict):
            continue
        stat = s.get("stat")
        if not stat:
            continue
        if s.get("min") is not None:
            lo = float(s.get("min", 0))
            hi = float(s.get("max", lo))
        else:
            lo = hi = float(s.get("v1", 0))
        out.append({
            "stat": stat,
            "type": str(s.get("type", "FLAT")).upper(),
            "min": lo,
            "max": hi,
        })
    return out


def _base(entry, name):
    return {"id": entry["_id"], "name": name, "src": entry.get("_source", "")}


def _facts(row, entry, fields):
    """Copy the scalar fields a group's tooltip prints, skipping empty ones."""
    f = row.get("f", {})
    for key, out_key in fields:
        v = entry.get(key)
        if v in (None, "", [], {}):
            continue
        f[out_key] = v
    if f:
        row["f"] = f
    return row


def _hidden(entry):
    return entry.get("hide_from_wiki") is True


def _entries(ctx, group_key):
    """Live entries of a group, placeholders and wiki-hidden ones dropped."""
    for entry_id, entry in sorted(ctx.reg.get(group_key, {}).items()):
        if entry_id in regs.PLACEHOLDER_IDS or _hidden(entry):
            continue
        yield entry_id, entry


# ------------------------------------------------------- cross-registry index

def proc_spell_index(ctx):
    """stat id -> the spells that stat casts when it fires.

    A proc is a three-hop chain and no single registry holds it. The stat
    (`proc_soul_wound`) names stat effects; a stat effect with `ser:
    "proc_spell"` names the `spellId` it casts (`proc_spell_soul_wound` ->
    `soul_wound`). So the thing a player sees - Banishing Blade's buff makes
    you apply Soul Wound - is only reachable by walking

        spell -> exile effect -> the effect's stats -> stat effect -> spell

    and the wiki screen never walks it: it prints the stat's own sentence and
    leaves you to go find the skill. 99 stats proc one of 80 spells.

    The conditions on a proc (`ifs`: on kill, on crit, not on cooldown) are
    deliberately not read here - the stat's lang line already spells them out,
    and it is the line the site renders right above this.
    """
    casts = {
        eid: e["spellId"]
        for eid, e in (ctx.reg.get("stat_effect") or {}).items()
        if e.get("ser") == "proc_spell" and e.get("spellId")
    }
    out = {}
    for stat_id, stat in (ctx.reg.get("stat") or {}).items():
        spells = []
        for block in stat.get("effect") or []:
            if not isinstance(block, dict):
                continue
            for eid in block.get("effects") or []:
                spell = casts.get(eid)
                if spell and spell not in spells:
                    spells.append(spell)
        if spells:
            out[stat_id] = spells
    return out


def proccable_spells(ctx):
    """The spell ids something can proc - who Proc Recharge is a fact about.

    `proc_cooldown_ticks` is on every spell and means nothing on most of them:
    it is the gap ProcSpellEffect enforces between two triggered casts, read
    straight off the config so no Cast Speed or Cooldown Reduction can move it.
    A skill nothing procs never reaches that code.
    """
    return {e["spellId"] for e in (ctx.reg.get("stat_effect") or {}).values()
            if e.get("ser") == "proc_spell" and e.get("spellId")}


def _row_procs(row, index):
    """The spells a row's own stats proc, in stat order."""
    out = []
    stats = list(row.get("stats") or [])
    for group in row.get("sets") or []:
        stats.extend(group["stats"])
    for s in stats:
        for spell in index.get(s["stat"]) or []:
            if spell not in out:
                out.append(spell)
    return out


# `0_10_fighter` - the pack's own ordering, then the class's display name
_CLASS_FOLDER = re.compile(r"^(\d+)_(\d+)_")


def _folder_sort(folder):
    m = _CLASS_FOLDER.match(folder)
    if not m:
        return (1, 0, 0, folder)
    return (0, int(m.group(1)), int(m.group(2)), folder)


def spell_classes(ctx):
    """(class key -> {name, order}, spell id -> class key) for the Spells filter."""
    folder_of = {}
    for spell_id, e in (ctx.reg.get("spell") or {}).items():
        path = e.get("_path") or ""
        if "/" in path:
            folder_of[spell_id] = path.split("/", 1)[0]

    classes, key_of = {}, {}
    for folder in sorted(set(folder_of.values()), key=_folder_sort):
        bare = _CLASS_FOLDER.sub("", folder)
        key = bare
        classes[key] = {
            "name": ctx.name(["mmorpg.asc_class." + bare], title_case(bare)),
            # the numeric prefix is the pack's grouping - the twelve player
            # classes, then gear spells, then summons, then mercenaries
            "order": len(classes),
        }
        key_of[folder] = key

    return classes, {sid: key_of[f] for sid, f in folder_of.items()}


# ---------------------------------------------------------------- builders

def build_affix(ctx):
    rows = []
    for entry_id, e in _entries(ctx, "affix"):
        row = _base(e, ctx.name(["mmorpg.affix." + entry_id], entry_id))
        row["stats"] = stat_list(e.get("stats"))
        reqs, tags, excl = [], [], []
        # Requirements.satisfiesAllRequirements is an AND over the list, while
        # each TagRequirement is its own INCLUDES_ANY / HAS_ALL test - keep them
        # separate so the gear match stays right if a pack ever ships two.
        for req in (e.get("requirements") or {}).get("tag_requirements") or []:
            inc = [t for t in (req.get("included") or []) if t]
            exc = [t for t in (req.get("excluded") or []) if t]
            if not inc and not exc:
                continue
            reqs.append({"all": req.get("req_type") == "HAS_ALL",
                         "inc": inc, "exc": exc})
            for t in inc:
                if t not in tags:
                    tags.append(t)
            for t in exc:
                if t not in excl:
                    excl.append(t)
        row["reqs"] = reqs
        row["tags"] = tags
        if excl:
            row["excl"] = excl
        _facts(row, e, [("weight", "weight"), ("type", "type"),
                        ("eye_aura_req", "aura"), ("one_of_a_kind", "oneOfAKind")])
        if any(r["all"] for r in reqs):
            row.setdefault("f", {})["reqAll"] = True
        row["filters"] = {"type": [e.get("type", "")], "slot": tags}
        rows.append(row)
    return rows


def build_currency(ctx):
    rows = []
    for entry_id, e in _entries(ctx, "currency"):
        row = _base(e, ctx.name([item_lang_key(e.get("item_id")),
                                 "mmorpg.currency." + entry_id], entry_id))
        _facts(row, e, [("rar", "rarity"), ("weight", "weight"),
                        ("item_id", "item"), ("league", "league")])
        pot = e.get("potential") or {}
        if pot.get("needs_potential"):
            row.setdefault("f", {})["potentialCost"] = pot.get("potential_cost", 0)
        row["req"] = list(e.get("req") or [])
        row["itemReq"] = list(e.get("item_type_requirement") or [])
        row["mods"] = [m.get("id") for m in (e.get("always_do_item_mods") or []) if m.get("id")]
        row["modsOneOf"] = [m.get("id") for m in (e.get("pick_one_item_mod") or []) if m.get("id")]
        row["filters"] = {"rarity": [e.get("rar", "")]}
        rows.append(row)
    return rows


def _socketable(ctx, group_key, name_keys, extra_fields):
    """Runes and gems: three stat sets, one per gear family."""
    rows = []
    for entry_id, e in _entries(ctx, group_key):
        keys = [fn(entry_id, e) for fn in name_keys]
        row = _base(e, ctx.name([k for k in keys if k], entry_id))
        sets = []
        for field, label in (("on_weapons_stats", "Weapons"),
                             ("on_armor_stats", "Armor"),
                             ("on_jewelry_stats", "Jewelry")):
            stats = stat_list(e.get(field))
            if stats:
                sets.append({"label": label, "stats": stats})
        row["sets"] = sets
        _facts(row, e, extra_fields)
        row["filters"] = {"tier": [str(e.get("tier", ""))]}
        rows.append(row)
    return rows


def build_rune(ctx):
    return _socketable(
        ctx, "rune",
        [lambda i, e: item_lang_key(e.get("item_id")),
         lambda i, e: "mmorpg.rune." + i],
        [("tier", "tier"), ("weight", "weight"), ("item_id", "item"),
         ("min_lvl_multi", "minLvlMulti")])


def build_gem(ctx):
    rows = _socketable(
        ctx, "gem",
        [lambda i, e: item_lang_key(e.get("item_id")),
         lambda i, e: "mmorpg.gem_type." + str(e.get("gem_type", ""))],
        [("tier", "tier"), ("weight", "weight"), ("item_id", "item"),
         ("rar", "rarity"), ("gem_type", "gemType"),
         ("perc_upgrade_chance", "upgradeChance")])
    # a gem's lang name is per gem_type, so every tier of Amethyst resolves to
    # "Amethyst" - qualify it so the list is navigable
    for row in rows:
        f = row.get("f") or {}
        tier = f.get("tier")
        if tier is not None:
            row["name"] = row["name"] + " " + str(int(tier) + 1)
        row.setdefault("filters", {})["gemType"] = [f.get("gemType", "")]
    return rows


def build_unique_gear(ctx):
    gear_types, _cats = ctx.gear()
    set_of = ctx.item_sets()[1]
    rows = []
    for entry_id, e in _entries(ctx, "unique_gear"):
        row = _base(e, ctx.name(["mmorpg.unique_gear." + entry_id + ".name",
                                 "mmorpg.unique_gear." + entry_id], entry_id))
        row["stats"] = stat_list(e.get("unique_stats"))
        flavor = clean(ctx.raw("mmorpg.unique_gear." + entry_id + ".flavor")) or \
            clean(e.get("flavor_text"))
        if flavor:
            row["flavor"] = flavor
        _facts(row, e, [("base_gear", "baseGear"), ("league", "league"),
                        ("min_drop_lvl", "minLvl"), ("min_tier", "minTier"),
                        ("rarity", "rarity"), ("weight", "weight"),
                        ("force_item_id", "item")])
        base = gear_types.get(e.get("base_gear") or "") or {}
        row["filters"] = {
            "slot": [e.get("base_gear", "")],
            "cat": list(base.get("cats") or []),
            "league": [e.get("league") or "none"],
        }
        # a unique is only ever in one set - ItemSet.ofUnique is a HashMap, so
        # a second one claiming it would silently take it over
        set_id = set_of.get(entry_id)
        if set_id:
            row["setId"] = set_id
            row["filters"]["set"] = [set_id]
        rows.append(row)
    return rows


def build_runeword(ctx):
    gear_types, _cats = ctx.gear()
    rows = []
    for entry_id, e in _entries(ctx, "runeword"):
        row = _base(e, ctx.name(["mmorpg.runeword." + entry_id], entry_id))
        row["stats"] = stat_list(e.get("stats"))
        runes = list(e.get("runes") or [])
        slots = list(e.get("slots") or [])
        row["runes"] = runes
        row["slots"] = slots
        row.setdefault("f", {})["runeCount"] = len(runes)
        # a runeword names gear *slots*, not base items, so its categories are
        # every category of every base item sitting in those slots
        cats = []
        for gear in gear_types.values():
            if gear["slot"] not in slots:
                continue
            for cat in gear.get("cats") or []:
                if cat not in cats:
                    cats.append(cat)
        row["filters"] = {"runeCount": [str(len(runes))], "slot": slots,
                          "cat": cats}
        rows.append(row)
    return rows


def _skill_gem(ctx, group_key, lang_prefix, extra_fields):
    rows = []
    for entry_id, e in _entries(ctx, group_key):
        row = _base(e, ctx.name([lang_prefix + entry_id], entry_id))
        row["stats"] = stat_list(e.get("stats"))
        _facts(row, e, extra_fields)
        row["filters"] = {"style": [e.get("style", "")]}
        rows.append(row)
    return rows


def build_supp_gem(ctx):
    return _skill_gem(ctx, "supp_gem", "mmorpg.support_gem.",
                      [("style", "style"), ("weight", "weight"),
                       ("min_lvl", "minLvl"), ("manaMulti", "manaMulti"),
                       ("one_of_a_kind", "oneOfAKind")])


def build_aura(ctx):
    return _skill_gem(ctx, "aura", "mmorpg.aura.",
                      [("style", "style"), ("min_lvl", "minLvl"),
                       ("reservation", "reservation"), ("weight", "weight")])


def build_effect(ctx):
    rows = []
    for entry_id, e in _entries(ctx, "effect"):
        row = _base(e, ctx.name(["mmorpg.effect." + entry_id], entry_id))
        row["stats"] = stat_list(e.get("stats"))
        tags = list((e.get("tags") or {}).get("tags") or [])
        row["tags"] = tags
        _facts(row, e, [("type", "type"), ("max_stacks", "maxStacks"),
                        ("stacks_affect_stats", "stacksAffectStats")])
        # the skills this effect's stats cast. 17 effects carry one, and they
        # are the middle link of every "buff makes you apply X" skill - the
        # spell group reads it back through the effect the skill grants
        procs = _row_procs(row, ctx.procs())
        if procs:
            row["procs"] = procs
        row["filters"] = {"type": [e.get("type", "")], "tag": tags}
        rows.append(row)
    return rows


# ExileEffectAction.INFINITE_DURATION - a potion_dur of -1 never expires.
INFINITE_DURATION = -1

# SpellConfiguration.DEFAULT_PROC_COOLDOWN_TICKS. Every spell the pack ships
# sets its own; the six that fall back to this are the jar's.
DEFAULT_PROC_COOLDOWN_TICKS = 20

# ExileEffectAction.GiveOrTake. REMOVE_NEGATIVE has no GiveOrTake2 pair, so the
# action bails out before applying anything and there is nothing to show.
_EFFECT_ACTIONS = {
    "GIVE_STACKS": "give",
    "REMOVE_STACKS": "take",
    "REMOVE_ALL_STACKS": "take",
}


def _spell_effects(ctx, entry):
    """The status effects a skill hands out, and the ones it strips.

    Found the way `Spell.GetTooltipString` finds them: `effect_tip` names one
    outright, then every component's actions are scanned for an
    `exile_effect` act. `AttachedSpell.getAllComponents` is on_cast *plus* the
    entity ones, and that second half is not optional - a projectile applies
    its debuff from the component keyed on the projectile's name, so reading
    only on_cast loses most of them.

    Two departures from that loop, both because this list is read rather than
    hovered:

    - give and take are kept apart. 159 of the pack's 598 effect acts are a
      REMOVE, and a skill that *consumes* Overheat must not read as one that
      grants it.
    - the same id twice keeps the longest duration, which is what the mod's
      LinkedHashMap pass does, except that -1 counts as the longest rather
      than as -0.05 seconds.
    """
    known = ctx.reg.get("effect") or {}
    out = {}

    def add(effect_id, dur, on_self, count, chance, action="give", every=False):
        target = known.get(effect_id)
        if not target or _hidden(target) or effect_id in regs.PLACEHOLDER_IDS:
            return
        key = (effect_id, action)
        prev = out.get(key)
        if prev is not None:
            if "dur" in prev:
                longest = (dur == INFINITE_DURATION
                           or (prev["dur"] != INFINITE_DURATION and dur > prev["dur"]))
                if longest:
                    prev["dur"] = dur
            prev["self"] = prev["self"] or on_self
            return
        row = {"id": effect_id, "act": action, "self": on_self}
        # a removal has no duration - the action reads potion_dur for the
        # event either way, but nothing downstream of a REMOVE looks at it
        if action == "give":
            row["dur"] = dur
        if every:
            row["all"] = True
        elif count > 1:
            row["count"] = count
        if chance < 100:
            row["chance"] = chance
        out[key] = row

    tip = entry.get("effect_tip") or ""
    if tip:
        add(tip, INFINITE_DURATION, True, 1, 100)

    attached = entry.get("attached") or {}
    parts = list(attached.get("on_cast") or [])
    for group in (attached.get("entity_components") or {}).values():
        parts.extend(group or [])

    for part in parts:
        if not isinstance(part, dict):
            continue
        targets = [t.get("type", "") for t in (part.get("targets") or [])
                   if isinstance(t, dict)]
        on_self = "self" in targets
        for act in part.get("acts") or []:
            if not isinstance(act, dict):
                continue
            m = act.get("map") or {}
            effect_id = m.get("exile_potion_id")
            if not effect_id:
                continue
            raw_action = m.get("potion_action", "GIVE_STACKS")
            action = _EFFECT_ACTIONS.get(raw_action)
            if not action:
                continue
            add(effect_id, int(m.get("potion_dur", 0) or 0), on_self,
                int(m.get("count", 1) or 1), float(m.get("chance", 100) or 100),
                action, raw_action == "REMOVE_ALL_STACKS")

    return list(out.values())


def build_spell(ctx):
    classes, class_of = ctx.classes()
    proccable = proccable_spells(ctx)
    rows = []
    for entry_id, e in _entries(ctx, "spell"):
        row = _base(e, ctx.name(["mmorpg.spell." + entry_id], entry_id))
        cfg = e.get("config") or {}
        desc = ctx.raw("spell.desc." + entry_id)
        if desc:
            row["desc"] = desc          # raw: [calc:] and colour codes resolved in JS
        row["stats"] = stat_list(e.get("statsForSkillGem"))
        tags = list((cfg.get("tags") or {}).get("tags") or [])
        row["tags"] = tags
        cost = cfg.get("mana_cost") or {}
        ene = cfg.get("ene_cost") or {}
        row["cfg"] = {
            "manaMin": cost.get("min", 0), "manaMax": cost.get("max", 0),
            "eneMin": ene.get("min", 0), "eneMax": ene.get("max", 0),
            "cooldown": cfg.get("cooldown_ticks", 0),
            "castTime": cfg.get("cast_time_ticks", 0),
            "recovery": cfg.get("cast_speed_ticks", 0),
            "charges": cfg.get("charges", 0),
            "chargeRegen": cfg.get("charge_regen", 0),
            "channel": bool(cfg.get("channel_skill")),
            "weapon": cfg.get("castingWeapon", ""),
            "style": cfg.get("style", ""),
            "timesToCast": cfg.get("times_to_cast", 1),
            # SpellConfiguration.DEFAULT_PROC_COOLDOWN_TICKS when absent, and
            # 0 is a real value meaning no limit at all - so it cannot be
            # dropped the way an empty field would be
            "procCd": cfg.get("proc_cooldown_ticks",
                              DEFAULT_PROC_COOLDOWN_TICKS),
        }
        # what this skill's own gem stats proc, beside what its buffs do
        procs = _row_procs(row, ctx.procs())
        if procs:
            row["procs"] = procs
        # what the skill puts on you, so a buff skill reads without a trip to
        # Status Effects. The stats stay in the effect group - they are looked
        # up by id at render time, because they scale with this skill's level
        # and duplicating them here would be a second copy to keep true.
        effects = _spell_effects(ctx, e)
        if effects:
            row["effects"] = effects
        # Spell.getLevelOf delegates to another skill's rank when this is set.
        # 17 skills in the pack do, and each pair happens to share a max_lvl, so
        # nothing moves - but "Skill Level 20 / 20" on Splinter reads as if
        # Splinter were the thing you rank, and it is Chilling Touch
        _facts(row, e, [("weight", "weight"), ("min_lvl", "minLvl"),
                        ("max_lvl", "maxLvl"), ("default_lvl", "defaultLvl"),
                        ("lvl_based_on_spell", "lvlFrom")])
        cls = class_of.get(entry_id)
        if cls:
            row.setdefault("f", {})["cls"] = cls
        if entry_id in proccable:
            row.setdefault("f", {})["proccable"] = True
        row["filters"] = {"cls": [cls] if cls else [],
                          "tag": tags, "style": [cfg.get("style", "")]}
        rows.append(row)
    return rows


def build_prof(ctx):
    """Profession EXP.

    ProfExpBestiary lists one entry per *exp source*, not per profession - the
    row is the item you gather and the tooltip says which profession it feeds,
    how much xp it gives and at what tier. A profession with no `exp_sources.map`
    (fishing, husbandry, alchemy) contributes nothing here, which is also what
    the in-game list does.
    """
    rows = []
    for entry_id, e in _entries(ctx, "prof"):
        prof_name = ctx.name(["mmorpg.profession." + entry_id], entry_id)
        sources = (e.get("exp_sources") or {}).get("map") or {}
        for tier, items in sources.items():
            for it in items or []:
                if not isinstance(it, dict):
                    continue
                item_id = it.get("id", "")
                row = {
                    "id": item_id,
                    "name": ctx.name([item_lang_key(item_id)], item_id.split(":")[-1]),
                    "src": e.get("_source", ""),
                    "f": {
                        "profession": prof_name,
                        "exp": it.get("exp", 0),
                        "tier": _num(tier),
                        "type": it.get("type", ""),
                    },
                    "req": list(it.get("req") or []),
                    "filters": {
                        "profession": [entry_id],
                        "tier": [str(_num(tier))],
                    },
                }
                rows.append(row)
    return rows


def _num(s):
    try:
        return int(s)
    except (TypeError, ValueError):
        return 0


BUILDERS = {
    "currency": build_currency,
    "affix": build_affix,
    "gem": build_gem,
    "rune": build_rune,
    "unique_gear": build_unique_gear,
    "runeword": build_runeword,
    "aura": build_aura,
    "supp_gem": build_supp_gem,
    "effect": build_effect,
    "spell": build_spell,
    "prof": build_prof,
}


def build(group_key, ctx):
    rows = BUILDERS[group_key](ctx)
    rows.sort(key=lambda r: (r["name"].lower(), r["id"]))
    return rows


# ---------------------------------------------------------------- balance

def _stat_meta(entry):
    """Normalise a stat definition. The registry ships two shapes.

    641 stats are flat (`ser: "data"`) and spell the fields `is_perc` /
    `scaling`; the other 191 nest everything under `data` and spell the same
    two `perc` / `scale`. Reading only one shape leaves most stats looking
    unscaled and non-percent, which silently renders every number wrong.
    """
    flat = entry
    nested = entry.get("data") if isinstance(entry.get("data"), dict) else {}

    def pick(*names, default=None):
        for src_obj in (nested, flat):
            for n in names:
                if n in src_obj and src_obj[n] is not None:
                    return src_obj[n]
        return default

    meta = {
        "scaling": pick("scale", "scaling", default="NONE") or "NONE",
        "percent": bool(pick("perc", "is_perc", default=False)),
        "minusIsGood": bool(pick("minus_is_good", default=False)),
        "long": bool(pick("is_long", default=False)),
    }
    # the vanilla-attribute stats store their value x100 and divide for display
    if pick("cut_by_hundred", default=False):
        meta["cutByHundred"] = True
    fmt = pick("format")
    if fmt:
        meta["format"] = fmt
    icon = pick("icon")
    if icon:
        meta["icon"] = icon
    multi = pick("multiUseType")
    if multi:
        meta["multiUse"] = multi
    return meta


def build_gear_types(ctx):
    """The 43 BaseGearTypes, which two groups need and neither can derive.

    A unique is a base item with unique stats bolted on: `plate_chest` is where
    its Armor and Health come from, and the wiki builds the same preview stack
    (BestiaryGroup.UNIQUE_GEAR -> GearBlueprint) rather than showing the unique
    stats alone. The tag list is the other half - GroupFilterType.AFFIX_SLOTS
    tests every affix against every gear type, which is why the same helmet
    answers to `helmet`, `cloth` and `cloth_helmet` at once.
    """
    slots = ctx.reg.get("gear_slot") or {}
    weapons = ctx.reg.get("weapon_type") or {}
    out = {}
    for gid, g in sorted((ctx.reg.get("gear_type") or {}).items()):
        if gid in regs.PLACEHOLDER_IDS:
            continue
        slot_id = g.get("gear_slot") or ""
        slot = slots.get(slot_id) or {}
        row = {
            "name": ctx.name(["mmorpg.gear_type." + gid], gid),
            "slot": slot_id,
            "slotName": ctx.name(["mmorpg.gearslot." + slot_id], slot_id),
            # SlotFamily: Armor / Weapon / Jewelry / OffHand
            "family": slot.get("fam") or "",
            "style": g.get("style") or "",
            "tags": sorted((g.get("tags") or {}).get("tags") or []),
            "baseStats": stat_list(g.get("base_stats")),
        }
        # WeaponTypes, for the twelve gear types that are a weapon. `dual` is
        # the mod's own one-handed flag - DualWieldUtils reads nothing else -
        # and `range` its MELEE / RANGED / OPTIONALLY_RANGED class.
        wep_id = g.get("weapon_type") or "none"
        wep = weapons.get(wep_id)
        if wep and wep_id not in regs.PLACEHOLDER_IDS:
            row["weapon"] = {
                "type": wep_id,
                "dual": bool(wep.get("can_dual_wield")),
                "range": wep.get("range") or "MELEE",
                "projectile": bool(wep.get("isProjectile")),
            }
        out[gid] = row
    return out


# Display order for the slot categories. Only a slot holding more than one base
# item becomes one, which in this pack is exactly the four armour slots, so the
# order is head-to-toe. Nothing in the data supplies one: GearSlot.model_num is
# a texture index and ties trident with hammer.
SLOT_CATEGORY_ORDER = ("helmet", "chest", "pants", "boots")

# SlotFamily, in the order the picker lists them. The names are the enum's own
# (Armor, Jewelry - US spelling), hyphenated where the id runs two words.
FAMILY_CATEGORY_ORDER = ("Armor", "Weapon", "OffHand", "Jewelry")
FAMILY_CATEGORY_NAMES = {"OffHand": "Off-Hand"}

# Tags that say *where* a gear type sits rather than what it is: the family
# rows, the `*_stat` rows a slot contributes to, and the three attributes.
_POSITIONAL_TAG_SUFFIXES = ("_family", "_stat", "_stat_half")
_ATTRIBUTE_TAGS = ("strength", "dexterity", "intelligence")

# `two_handed` is not the handedness tag it reads as. It is the pack's own
# affix target and sits on greatsword, scythe and spear alone, while the game
# asks WeaponTypes.can_dual_wield - which makes trident, bow and crossbow two
# handed as well. Six, not three. So the weapon type answers handedness and
# this tag is dropped, rather than shipping two picks that disagree.
_SUPERSEDED_TAGS = ("two_handed",)


def _trait_tags(gear_types, family, slot_ids):
    """Tags naming what a gear type *is*, within one slot family.

    Derived rather than listed, so a material the pack adds later files itself.
    Everything positional goes - slot names, the `<material>_<slot>` composites
    an affix targets, the family and stat rows, the attributes - and a tag that
    survives on two or more gear types is the trait. That leaves exactly the
    six armour materials and, on the weapons, mage / melee / ranged.
    """
    counts = collections.Counter()
    for g in gear_types.values():
        if g["family"] != family:
            continue
        for tag in g["tags"]:
            if tag in slot_ids or tag in _ATTRIBUTE_TAGS:
                continue
            if tag in _SUPERSEDED_TAGS or tag.endswith(_POSITIONAL_TAG_SUFFIXES):
                continue
            if any(tag.endswith("_" + s) for s in slot_ids):
                continue
            counts[tag] += 1
    return sorted(t for t, n in counts.items() if n >= 2)


def build_gear_categories(ctx, gear_types):
    """The "Any Chest" / "Any Two-Handed Weapon" picks, and who is in them.

    The in-game wiki has no such filter - its slot list is one row per base
    item, 43 of them - so this grouping is the site's own. It is still built
    out of the game's own answers rather than a hand list: the slot family, the
    gear slot, the trait tags above, and WeaponTypes for handedness and range.

    Writes `cats` onto each gear type and returns the picker's rows in display
    order. A category nothing matches is never emitted.
    """
    cats = collections.OrderedDict()
    members = {}

    def category(key, name, order, test):
        hit = [gid for gid, g in gear_types.items() if test(g)]
        if not hit:
            return
        cats[key] = {"key": key, "name": "Any " + name, "order": order}
        members[key] = set(hit)

    slot_ids = {g["slot"] for g in gear_types.values() if g["slot"]}
    slot_size = collections.Counter(g["slot"] for g in gear_types.values())

    for i, fam in enumerate(FAMILY_CATEGORY_ORDER):
        category("fam_" + fam.lower(), FAMILY_CATEGORY_NAMES.get(fam, fam),
                 10 + i, lambda g, fam=fam: g["family"] == fam)

    # a slot holding a single base item says nothing the Base Item filter does
    # not already say, so only the shared ones become a pick
    def slot_rank(slot):
        return (SLOT_CATEGORY_ORDER.index(slot) if slot in SLOT_CATEGORY_ORDER
                else len(SLOT_CATEGORY_ORDER))

    for slot in sorted((s for s in slot_ids if slot_size[s] > 1), key=slot_rank):
        category("slot_" + slot, ctx.name(["mmorpg.gearslot." + slot], slot),
                 20 + slot_rank(slot), lambda g, slot=slot: g["slot"] == slot)

    for tag in _trait_tags(gear_types, "Armor", slot_ids):
        category("tag_" + tag, ctx.name(["mmorpg.tag.gear_slot." + tag], tag),
                 30, lambda g, tag=tag: tag in g["tags"])

    # handedness from the weapon type, never from the `two_handed` tag
    category("wep_1h", "One-Handed Weapon", 40,
             lambda g: bool(g.get("weapon")) and g["weapon"]["dual"])
    category("wep_2h", "Two-Handed Weapon", 40,
             lambda g: bool(g.get("weapon")) and not g["weapon"]["dual"])
    # OPTIONALLY_RANGED is the trident, and it really is both: the mod counts
    # it as a two-handed melee weapon for a mercenary's reach and as non-melee
    # in WeaponTypes.isMelee.
    category("wep_melee", "Melee Weapon", 41,
             lambda g: bool(g.get("weapon")) and g["weapon"]["range"] != "RANGED")
    category("wep_ranged", "Ranged Weapon", 41,
             lambda g: bool(g.get("weapon")) and g["weapon"]["range"] != "MELEE")
    for tag in _trait_tags(gear_types, "Weapon", slot_ids):
        if tag in ("melee_weapon", "ranged_weapon"):
            continue    # the weapon type above already answers these
        category("tag_" + tag, ctx.name(["mmorpg.tag.gear_slot." + tag], tag),
                 42, lambda g, tag=tag: tag in g["tags"])

    for gid, g in gear_types.items():
        g["cats"] = [key for key, hit in members.items() if gid in hit]
    return list(cats.values())


def build_item_sets(ctx):
    """The gear sets: (set id -> row, unique id -> the set it belongs to).

    Membership is listed on the set and nowhere on the unique - ItemSet's own
    comment says why: adding a set would otherwise restale every unique's json
    - so the reverse map is built here the way `ItemSet.ofUnique` builds it.

    Bonus tiers sort by piece count (getSortedBonuses) and are cumulative:
    every tier at or below what you wear applies. Their stats are never rolled
    - `SetBonus.getStats` asks for 100% every time - so a bonus is one number
    rather than a range, and only the level moves it.
    """
    sets, owner = {}, {}
    for entry_id, e in _entries(ctx, "item_set"):
        members = [u for u in (e.get("uniques") or []) if u]
        bonuses = []
        for b in sorted((e.get("bonuses") or []),
                        key=lambda x: _num(x.get("pieces"))):
            stats = stat_list(b.get("stats"))
            if stats:
                bonuses.append({"pieces": _num(b.get("pieces")), "stats": stats})
        if not members or not bonuses:
            continue
        sets[entry_id] = {
            "name": ctx.name(["mmorpg.item_set." + entry_id], entry_id),
            "uniques": members,
            "bonuses": bonuses,
        }
        for unique_id in members:
            owner[unique_id] = entry_id
    return sets, owner


def item_set_stats(balance):
    """Stat ids only a set bonus mentions, so they get meta like any other.

    The same hole `gear_type_stats` fills: `learn_slice` and `learn_bola_throw`
    appear in no affix, unique or gem, so without this they miss
    fill_code_stats and render at NONE scaling.
    """
    out = set()
    for item_set in (balance.get("itemSets") or {}).values():
        for bonus in item_set["bonuses"]:
            for s in bonus["stats"]:
                out.add(s["stat"])
    return out


def gear_type_stats(balance):
    """Stat ids only the gear bases mention, so they get meta like any other.

    `weapon_damage` and `learn_bolt` appear in no affix, unique or gem, so
    without this they miss fill_code_stats and render at NONE scaling - a
    weapon's whole damage line, wrong by 20.8x at level 100.
    """
    out = set()
    for gt in (balance.get("gearTypes") or {}).values():
        for s in gt.get("baseStats") or []:
            out.add(s["stat"])
    return out


def fill_code_stats(stats, referenced, code_stats):
    """Back-fill stats the datapack never serialises, from the Java scan.

    Datapack entries always win - they are what the game actually loaded.
    Returns the ids still unknown, which the caller reports rather than
    quietly rendering at default scaling.
    """
    exact = code_stats.get("exact") or {}
    patterns = code_stats.get("patterns") or []
    unresolved = []

    for sid in sorted(referenced):
        if sid in stats:
            continue
        props = exact.get(sid)
        if props is None:
            for pat in patterns:
                text = pat.get("text", "")
                hit = (sid.endswith(text) if pat.get("kind") == "suffix"
                       else sid.startswith(text))
                if hit and text:
                    props = pat.get("props")
                    break
        if props is None:
            unresolved.append(sid)
            continue
        stats[sid] = {
            "scaling": props.get("scaling", "NONE"),
            "percent": bool(props.get("percent")),
            "minusIsGood": bool(props.get("minusIsGood")),
            "long": False,
            "code": True,
        }
    return unresolved


def referenced_stats(all_rows):
    """Every stat id the built rows mention."""
    out = set()
    for rows in all_rows:
        for row in rows:
            for s in row.get("stats") or []:
                out.add(s["stat"])
            for group in row.get("sets") or []:
                for s in group["stats"]:
                    out.add(s["stat"])
    return out


def build_balance(ctx):
    """The scaling coefficients, rarities and value calcs the tooltips need.

    GameBalanceConfig ships two entries - original and compat. The pack runs
    the original, which is what CompatConfig defaults to.
    """
    balances = ctx.reg.get("game_balance", {})
    balance = balances.get("original_balance") or (
        next(iter(balances.values())) if balances else {})

    def curve(name):
        c = balance.get(name) or {}
        return {
            "base": c.get("base_scaling", 1),
            "perLevel": c.get("per_level_scaling", 0),
            "cap": c.get("cap_to_max_lvl", True),
        }

    rarities = {}
    for rid, r in (ctx.reg.get("gear_rarity") or {}).items():
        # A GearRarity carries two different windows and they are not
        # interchangeable. `stat_percents` is the one a roll lands in - what
        # SkillGemBlueprint gives a gem and what ISkillGem shows as its range,
        # so it is what the wiki's rarity button narrows to. `base_stat_percents`
        # is only ever read by BaseStatsData, for a gear's own base stats.
        # Reading the second where the first belongs looks almost right and is
        # not: every rarity's base window ends at 100, so picking Rare over
        # Mythic would move the low end and leave the high end alone.
        roll = r.get("stat_percents") or {}
        base = r.get("base_stat_percents") or {}
        rarities[rid] = {
            # the lang key doubles the dot: "mmorpg.rarity..rare"
            "name": (clean(ctx.raw("mmorpg.rarity.." + rid))
                     or clean(ctx.raw("mmorpg.rarity." + rid))
                     or title_case(rid)),
            "color": r.get("text_format") or r.get("color") or "WHITE",
            "tier": r.get("item_tier", 0),
            "pctMin": roll.get("min", 0),
            "pctMax": roll.get("max", 100),
            "basePctMin": base.get("min", 0),
            "basePctMax": base.get("max", 100),
            "unique": bool(r.get("is_unique_item")),
            "runeword": r.get("type") == "RUNEWORD" or rid == "runeword",
            "minAffixes": r.get("min_affixes", 0),
        }
    # WikiDisplayOptions.pickableRarities: normal gear rarities, lowest first -
    # unique and runeword are gear-only and never appear in the picker
    pickable = sorted(
        (rid for rid, r in rarities.items() if not r["unique"] and not r["runeword"]),
        key=lambda rid: rarities[rid]["tier"])

    calcs = {}
    for cid, c in (ctx.reg.get("value_calc") or {}).items():
        base = c.get("base") or {}
        calcs[cid] = {
            "baseMin": base.get("min", 0),
            "baseMax": base.get("max", 0),
            "scaling": c.get("base_scaling_type", "NORMAL"),
            "scalings": [
                {
                    "stat": s.get("stat") or s.get("stat_id") or "",
                    "min": (s.get("multi") or {}).get("min", 0),
                    "max": (s.get("multi") or {}).get("max", 0),
                }
                for s in (c.get("stat_scalings") or [])
            ],
        }

    stats = {}
    for sid, s in (ctx.reg.get("stat") or {}).items():
        stats[sid] = _stat_meta(s)

    return {
        "maxLevel": balance.get("MAX_LEVEL", 100),
        # Spell.getMaxLevelWithBonuses: a skill gem's rank ceiling is its own
        # max_lvl plus this, and gear is the only way past the natural cap.
        # The mod's default is 5; this pack ships 8.
        "maxBonusSpellLevels": balance.get("MAX_BONUS_SPELL_LEVELS", 5),
        "gearTypes": ctx.gear()[0],
        # the site's own "Any Chest" / "Any Two-Handed Weapon" grouping over
        # those, in display order - see build_gear_categories
        "gearCategories": ctx.gear()[1],
        # the diablo-style sets, which live in a registry of their own and are
        # drawn under whichever unique belongs to one
        "itemSets": ctx.item_sets()[0],
        # the Spells group's class filter: key -> display name and the pack's
        # own ordering, so the twelve player classes sort ahead of gear spells
        "spellClasses": ctx.classes()[0],
        "curves": {
            "NORMAL": curve("NORMAL_STAT_SCALING"),
            "CORE": curve("CORE_STAT_SCALING"),
            "SLOW": curve("SLOW_STAT_SCALING"),
            "STAT_REQ": curve("STAT_REQ_SCALING"),
            "MOB_DAMAGE": curve("MOB_DAMAGE_SCALING"),
            # not a stat curve - SpellStatsCalculationEvent multiplies every
            # resource cost by this at the *caster's* level
            "MANA_COST": curve("MANA_COST_SCALING"),
            "NONE": {"base": 1, "perLevel": 0, "cap": False},
        },
        "rarities": rarities,
        "pickableRarities": pickable,
        "valueCalcs": calcs,
        "stats": stats,
    }
