"""Which datapack registries we read, and how each one names its entries.

Every id field here was probed against the shipped data rather than guessed -
they are not consistent (`guid` on affixes and uniques, `identifier` on gems
and spells, `id` on most of the rest, and `mmorpg_stat` uses both).

Entries are keyed on their internal id, never on the filename: mmorpg_unique_gears
keeps a deprecated flat copy beside the live per-slot one, and a filename-keyed
merge double-counts it.
"""

# id field strategies
ID = "id"
GUID = "guid"
IDENT = "identifier"
AUTO = "auto"          # `id`, else `data.id`
FILENAME = "filename"  # no id field at all


class Registry:
    def __init__(self, modid, dirname, id_field=ID, stats_field="stats"):
        self.modid = modid
        self.dirname = dirname
        self.id_field = id_field
        self.stats_field = stats_field

    @property
    def key(self):
        return f"{self.modid}/{self.dirname}"

    def data_prefix(self):
        return f"data/{self.modid}/{self.dirname}/"

    def entry_id(self, obj, fallback):
        if self.id_field == AUTO:
            v = obj.get("id")
            if isinstance(v, str) and v:
                return v
            data = obj.get("data")
            if isinstance(data, dict) and isinstance(data.get("id"), str) and data["id"]:
                return data["id"]
            return fallback
        if self.id_field == FILENAME:
            return fallback
        v = obj.get(self.id_field)
        return v if isinstance(v, str) and v else fallback


# --- the 11 wiki groups ------------------------------------------------------
GROUP_REGISTRIES = {
    "currency":    Registry("library_of_exile", "library_of_exile_currency", ID),
    "affix":       Registry("mmorpg", "mmorpg_affixes", GUID),
    "gem":         Registry("mmorpg", "mmorpg_gems", IDENT),
    "rune":        Registry("mmorpg", "mmorpg_runes", ID),
    "unique_gear": Registry("mmorpg", "mmorpg_unique_gears", GUID, stats_field="unique_stats"),
    "runeword":    Registry("mmorpg", "mmorpg_runeword", ID),
    "aura":        Registry("mmorpg", "mmorpg_aura", ID),
    "supp_gem":    Registry("mmorpg", "mmorpg_support_gem", ID),
    "effect":      Registry("mmorpg", "mmorpg_exile_effect", ID),
    "spell":       Registry("mmorpg", "mmorpg_spells", IDENT),
    "prof":        Registry("mmorpg", "mmorpg_profession", ID),
}

# --- support data the tooltips need ------------------------------------------
SUPPORT_REGISTRIES = {
    "stat":         Registry("mmorpg", "mmorpg_stat", AUTO),
    "gear_rarity":  Registry("mmorpg", "mmorpg_gear_rarity", GUID),
    "game_balance": Registry("mmorpg", "mmorpg_game_balance", ID),
    "value_calc":   Registry("mmorpg", "mmorpg_value_calc", ID),
    "gear_slot":    Registry("mmorpg", "mmorpg_gear_slot", ID),
    "gear_type":    Registry("mmorpg", "mmorpg_base_gear_types", GUID),
    "item_set":     Registry("mmorpg", "mmorpg_sets", ID),
    # what a stat *does*, not how it scales. The `proc_spell` ones name a
    # spellId, which is the only link between a stat like `proc_soul_wound`
    # and the skill it actually casts.
    "stat_effect":  Registry("mmorpg", "mmorpg_stat_effect", ID),
    # the class trees. Their `perks` lists are what says which class a skill
    # belongs to - the spell folder names are display names, not ids.
    "spell_school": Registry("mmorpg", "mmorpg_spell_school", ID),
}

ALL_REGISTRIES = dict(GROUP_REGISTRIES)
ALL_REGISTRIES.update(SUPPORT_REGISTRIES)

# Filler entries that exist only so a registry is never empty. Not content.
PLACEHOLDER_IDS = {"empty", "unknown", "none"}

# Group order and display, mirroring BestiaryGroup.getAll()
GROUP_ORDER = [
    ("currency",    "Currency",       "currency"),
    ("affix",       "Affixes",        "affix"),
    ("gem",         "Gems",           "gem"),
    ("rune",        "Runes",          "rune"),
    ("unique_gear", "Unique Gear",    "unique_gear"),
    ("runeword",    "Runewords",      "runeword"),
    ("aura",        "Auras",          "aura"),
    ("supp_gem",    "Support Gems",   "supp_gem"),
    ("effect",      "Status Effects", "effect"),
    ("spell",       "Spells",         "spell"),
    ("prof",        "Profession EXP", "prof"),
]

# Groups whose entries the in-game wiki shows a rarity picker for
RARITY_PICKER_GROUPS = {"aura", "supp_gem"}
