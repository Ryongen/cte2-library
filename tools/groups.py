"""Turning merged registry entries into the normalised rows the site renders.

One builder per BestiaryGroup, each reproducing what that group's lambda in
`gui/wiki/BestiaryGroup.java` puts on screen. Rows stay close to the raw data -
the level-scaled numbers are computed in the browser, because the level box
changes them on every keystroke.
"""

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
        row["filters"] = {
            "slot": [e.get("base_gear", "")],
            "league": [e.get("league") or "none"],
        }
        rows.append(row)
    return rows


def build_runeword(ctx):
    rows = []
    for entry_id, e in _entries(ctx, "runeword"):
        row = _base(e, ctx.name(["mmorpg.runeword." + entry_id], entry_id))
        row["stats"] = stat_list(e.get("stats"))
        runes = list(e.get("runes") or [])
        slots = list(e.get("slots") or [])
        row["runes"] = runes
        row["slots"] = slots
        row.setdefault("f", {})["runeCount"] = len(runes)
        row["filters"] = {"runeCount": [str(len(runes))], "slot": slots}
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
        row["filters"] = {"type": [e.get("type", "")], "tag": tags}
        rows.append(row)
    return rows


def build_spell(ctx):
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
        }
        _facts(row, e, [("weight", "weight"), ("min_lvl", "minLvl"),
                        ("max_lvl", "maxLvl"), ("default_lvl", "defaultLvl")])
        row["filters"] = {"tag": tags, "style": [cfg.get("style", "")]}
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
    out = {}
    for gid, g in sorted((ctx.reg.get("gear_type") or {}).items()):
        if gid in regs.PLACEHOLDER_IDS:
            continue
        slot_id = g.get("gear_slot") or ""
        slot = slots.get(slot_id) or {}
        out[gid] = {
            "name": ctx.name(["mmorpg.gear_type." + gid], gid),
            "slot": slot_id,
            "slotName": ctx.name(["mmorpg.gearslot." + slot_id], slot_id),
            # SlotFamily: Armor / Weapon / Jewelry / OffHand
            "family": slot.get("fam") or "",
            "style": g.get("style") or "",
            "tags": sorted((g.get("tags") or {}).get("tags") or []),
            "baseStats": stat_list(g.get("base_stats")),
        }
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
        "gearTypes": build_gear_types(ctx),
        "curves": {
            "NORMAL": curve("NORMAL_STAT_SCALING"),
            "CORE": curve("CORE_STAT_SCALING"),
            "SLOW": curve("SLOW_STAT_SCALING"),
            "STAT_REQ": curve("STAT_REQ_SCALING"),
            "MOB_DAMAGE": curve("MOB_DAMAGE_SCALING"),
            "NONE": {"base": 1, "perLevel": 0, "cap": False},
        },
        "rarities": rarities,
        "pickableRarities": pickable,
        "valueCalcs": calcs,
        "stats": stats,
    }
