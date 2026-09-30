"""The other languages, as sparse overlays on the English bundle.

Mine and Slash ships a dozen translations; CTE2 translates none of them - its
openloader override is `en_us` alone, and it rewrites or adds well over half of
what the site shows. So a translation covers only what the pack left as the
jar wrote it, 17-33% of the site's strings depending on the language.

A translated key is kept only when its English is still current: the English
beside it in the same source must equal the English the site ships. The game
has no such test - it falls back per *missing* key, so a French player sees
some 680 French strings translated from English the pack has since rewritten.
A stale spell description describes a spell that no longer exists, so here it
falls back to English instead. A pack-supplied translation is current by
definition, since it sits beside the English override it translates.

Names, descriptions and category labels are resolved at extract time and
baked into the rows, so a lang overlay alone cannot reach them. Rather than
thread a lang key through every place that bakes one, the whole bundle is
rebuilt with the translated lang and only the strings that came out different
are shipped, as a patch the browser deep-merges over the English rows.
"""

import os
import re

import groups as groupbuild
import registries as regs

# what the picker shows - a language is named in itself, never in English
NATIVE_NAMES = {
    "de_de": "Deutsch", "es_es": "Español", "fr_fr": "Français",
    "it_it": "Italiano", "ja_jp": "日本語", "ko_kr": "한국어",
    "pl_pl": "Polski", "pt_br": "Português (Brasil)", "ru_ru": "Русский",
    "tr_tr": "Türkçe", "uk_ua": "Українська", "zh_cn": "简体中文",
    "zh_tw": "繁體中文",
}

# identical files collapse onto the first of these that is present, so the five
# byte-identical Spanish files become one "Español" rather than five
PREFERRED = ("es_es",)

# not a locale: the mod's own guide text
NOT_LOCALES = {"en_us", "manual"}

# ll_cc, the only shape Minecraft reads - anything else in a lang folder is a
# leftover the game never loads (a community pack ships `bak_ko_kr.json`)
_LOCALE = re.compile(r"^[a-z]{2,3}_[a-z]{2,3}$")

MISSING = object()


def _lang_files(source):
    """(namespace dir, locale) for every lang file a source carries."""
    for path in source.files("assets/", ".json"):
        head, name = os.path.split(path)
        if os.path.basename(head) == "lang":
            loc = os.path.splitext(name)[0].lower()
            if _LOCALE.match(loc):
                yield head, loc


def load_translations(asset_sources, english, prune):
    """locale -> {key: text} for the keys that are translated *and* current."""
    out = {}
    for source in asset_sources:
        by_dir = {}
        for head, loc in _lang_files(source):
            by_dir.setdefault(head, set()).add(loc)
        for head, locs in by_dir.items():
            source_en = _read(source, f"{head}/en_us.json")
            for loc in sorted(locs - NOT_LOCALES):
                text = _read(source, f"{head}/{loc}.json")
                if not text:
                    continue
                into = out.setdefault(loc, {})
                for k, v in prune(text).items():
                    if not isinstance(v, str) or k not in english:
                        continue
                    # translated from English that is no longer the English
                    if source_en is not None and source_en.get(k) != english[k]:
                        continue
                    if v != english[k]:
                        into[k] = v
    return {loc: t for loc, t in out.items() if t}


def _read(source, path):
    try:
        obj = source.read_json(path)
    except (ValueError, UnicodeDecodeError):
        return None
    return obj if isinstance(obj, dict) else None


def collapse(translations):
    """Fold identical locales onto one. Returns [(locale, aliases, text)]."""
    kept = []
    for loc in sorted(translations, key=lambda l: (l not in PREFERRED, l)):
        text = translations[loc]
        twin = next((k for k in kept if k[2] == text), None)
        if twin:
            twin[1].append(loc)
        else:
            kept.append((loc, [], text))
    return kept


def diff(en, loc):
    """The part of `loc` that differs from `en`, or MISSING.

    Dicts diff per key and equal-length lists per index (as "3": ...), which
    the browser's merge reads the same way, since arr["3"] is arr[3].
    """
    if en == loc:
        return MISSING
    if isinstance(en, dict) and isinstance(loc, dict):
        out = {}
        for k, v in loc.items():
            d = diff(en[k], v) if k in en else v
            if d is not MISSING:
                out[k] = d
        return out or MISSING
    if isinstance(en, list) and isinstance(loc, list) and len(en) == len(loc):
        out = {}
        for i, (a, b) in enumerate(zip(en, loc)):
            d = diff(a, b)
            if d is not MISSING:
                out[str(i)] = d
        return out or MISSING
    return loc


def build_bundle(loaded, english, text, code_stats, finish_balance):
    """Everything the extractor writes, rebuilt with a translated lang."""
    ctx = groupbuild.Context(loaded, {**english, **text}, code_stats,
                               translated=text)
    built = {key: groupbuild.build(key, ctx) for key, _l, _i in regs.GROUP_ORDER}
    balance = groupbuild.build_balance(ctx)
    finish_balance(balance, built)
    return built, balance


def overlay(en_built, en_balance, built, balance):
    """The patch for one locale: rows by id, balance as a tree."""
    groups = {}
    for key, en_rows in en_built.items():
        by_id = {r["id"]: r for r in built[key]}
        patch = {}
        for row in en_rows:
            d = diff(row, by_id.get(row["id"], row))
            if d is not MISSING:
                patch[row["id"]] = d
        if patch:
            groups[key] = patch
    d = diff(en_balance, balance)
    return groups, ({} if d is MISSING else d)
