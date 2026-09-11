"""Recover stat properties that exist only in Java, not in any datapack.

`ExileRegistryTypes.STAT` serialises only datapack-defined stats. The rest -
health, armor, gear_defense, every elemental resist - are `Stat` subclasses
registered in code, so they never appear in `mmorpg_stat/*.json`. That is about
a third of the stat ids the content references and half of all stat lines, and
without their `is_perc` / `scaling` every one of those numbers renders wrong:
a NORMAL-scaled stat is out by up to 20.8x at level 100.

This scans the mod's own source and writes `tools/code_stats.json`, which
extract.py layers underneath the datapack registry. Re-run it when the mod
changes; the extractor reports anything still unresolved rather than guessing.

    python tools/gen_code_stats.py --mod-src <Mine-And-Slash repo>
"""

import argparse
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

# Stat classes are not all under stats/ - the profession ones live in
# database/data/profession/stat/, so scan the whole content tree and keep
# whatever actually looks like a Stat.
STATS_SUBPATH = os.path.join(
    "src", "main", "java", "com", "robertx22", "mine_and_slash",
    "database", "data")

# Elements.guidName, in declaration order. Cold's guid is "water" and Nature's
# is "nature" - the display name and the id deliberately disagree.
ELEMENT_GUIDS = ["physical", "fire", "water", "nature", "chaos", "elemental", "all"]

RE_CLASS = re.compile(r"\b(?:public\s+)?(?:abstract\s+)?class\s+(\w+)"
                      r"(?:\s+extends\s+(\w+))?")
RE_SCALING = re.compile(r"\bscaling\s*=\s*StatScaling\.(\w+)")
RE_IS_PERC_FIELD = re.compile(r"\bis_perc\s*=\s*(true|false)")
RE_IS_PERC_METHOD = re.compile(
    r"public\s+boolean\s+IsPercent\s*\(\s*\)\s*\{\s*return\s+(true|false)\s*;")
RE_MINUS_GOOD = re.compile(r"\bminus_is_good\s*=\s*(true|false)")
RE_STATIC_GUID = re.compile(r'static\s+(?:final\s+)?String\s+GUID\s*=\s*"([^"]+)"')
RE_GUID_METHOD = re.compile(
    r"public\s+String\s+GUID\s*\(\s*\)\s*\{\s*return\s+([^;]+);", re.S)
# `new SpecialStat("heal_cleanse", ...)` - the id is the call argument, so the
# class it belongs to never names it
RE_NEW_WITH_ID = re.compile(r'\bnew\s+(\w+)\s*\(\s*"([a-z0-9_]+)"')

# something is a Stat if it carries stat machinery, not by where it lives
RE_LOOKS_LIKE_STAT = re.compile(
    r"StatScaling\.|is_perc\s*=|public\s+boolean\s+IsPercent|public\s+String\s+GUID\s*\(")


def scan_file(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()

    constructed = [
        {"class": mm.group(1), "id": mm.group(2)}
        for mm in RE_NEW_WITH_ID.finditer(text)
    ]

    # A holder like SpecialStats.java carries no stat machinery of its own,
    # only `new SpecialStat("heal_cleanse", ...)` instantiations. Keep those.
    if not RE_LOOKS_LIKE_STAT.search(text):
        return {"class": None, "parent": None, "ids": [], "patterns": [],
                "constructed": constructed} if constructed else None

    m = RE_CLASS.search(text)
    if not m:
        return None
    cls, parent = m.group(1), m.group(2)

    rec = {"class": cls, "parent": parent, "file": os.path.basename(path)}

    ms = RE_SCALING.search(text)
    if ms:
        rec["scaling"] = ms.group(1)

    mp = RE_IS_PERC_METHOD.search(text)
    if mp:
        rec["percent"] = mp.group(1) == "true"
    else:
        mf = RE_IS_PERC_FIELD.search(text)
        if mf:
            rec["percent"] = mf.group(1) == "true"

    mg = RE_MINUS_GOOD.search(text)
    if mg:
        rec["minusIsGood"] = mg.group(1) == "true"

    rec["ids"], rec["patterns"] = _guids(text)
    rec["constructed"] = constructed
    return rec


def _guids(text):
    """What ids this class produces: exact ones, plus suffix/prefix patterns.

    A family class composes its id from an enum - `element.guidName + "_resist"`
    - so it cannot be resolved to one id. Record the affix instead and let the
    extractor apply it to any id that matches and is otherwise unknown.
    """
    ids, patterns = [], []

    static_guid = RE_STATIC_GUID.search(text)

    for m in RE_GUID_METHOD.finditer(text):
        expr = " ".join(m.group(1).split())

        if expr == "GUID" and static_guid:
            ids.append(static_guid.group(1))
            continue

        lit = re.fullmatch(r'"([^"]+)"', expr)
        if lit:
            ids.append(lit.group(1))
            continue

        # <something> + "_suffix" - the something is an enum or a sibling stat,
        # so the id can only be matched by its affix
        suf = re.search(r'\+\s*"([^"]+)"\s*$', expr)
        if suf:
            patterns.append({"kind": "suffix", "text": suf.group(1)})
            continue

        # "prefix_" + <something>
        pre = re.match(r'^"([^"]+)"\s*\+', expr)
        if pre:
            patterns.append({"kind": "prefix", "text": pre.group(1)})

    if not ids and static_guid:
        ids.append(static_guid.group(1))

    return ids, patterns


def resolve(records):
    """Fill each class's blanks from its parent, then flatten to id -> props."""
    by_class = {r["class"]: r for r in records if r.get("class")}

    def prop(rec, key, seen=None):
        seen = seen or set()
        if key in rec:
            return rec[key]
        parent = rec.get("parent")
        if parent and parent in by_class and parent not in seen:
            seen.add(parent)
            return prop(by_class[parent], key, seen)
        return None

    def props_of(rec):
        out = {}
        for key, default in (("scaling", "NONE"), ("percent", False),
                             ("minusIsGood", False)):
            v = prop(rec, key)
            out[key] = default if v is None else v
        out["from"] = rec["class"]
        return out

    def is_stat(rec):
        """Does this class actually carry stat behaviour?

        A GUID() method alone is not enough - SupportGem has one, and every
        `new SupportGem("burn_chance", ...)` would otherwise register a support
        gem id as a stat and override the real `_chance` rule with the wrong
        percent flag. Require a scaling or percent declaration somewhere in the
        chain, which is what a Stat subclass always has.
        """
        return prop(rec, "scaling") is not None or prop(rec, "percent") is not None

    exact, patterns = {}, []
    for rec in records:
        if not rec.get("class") or not is_stat(rec):
            continue
        props = props_of(rec)
        for sid in rec["ids"]:
            exact[sid] = props
        for pat in rec["patterns"]:
            patterns.append(dict(pat, props=props))

    # ids passed to a stat class's constructor take that class's props
    for rec in records:
        for made in rec.get("constructed") or []:
            target = by_class.get(made["class"])
            if target is not None and is_stat(target) and made["id"] not in exact:
                exact[made["id"]] = props_of(target)

    # element families are enumerable, so turn those into exact ids
    for pat in list(patterns):
        if pat["kind"] == "suffix":
            for el in ELEMENT_GUIDS:
                sid = el + pat["text"]
                exact.setdefault(sid, pat["props"])

    # longest pattern first, so `_proc_chance` beats `_chance`
    patterns.sort(key=lambda p: len(p["text"]), reverse=True)
    return exact, patterns


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mod-src", required=True, help="Mine-And-Slash repo root")
    ap.add_argument("--out", default=os.path.join(HERE, "code_stats.json"))
    args = ap.parse_args(argv)

    root = os.path.join(args.mod_src, STATS_SUBPATH)
    if not os.path.isdir(root):
        ap.error("no stats source at " + root)

    records = []
    for dirpath, _dirs, files in os.walk(root):
        for fn in files:
            if fn.endswith(".java"):
                rec = scan_file(os.path.join(dirpath, fn))
                if rec:
                    records.append(rec)

    exact, patterns = resolve(records)
    out = {
        "_note": "generated by tools/gen_code_stats.py from Mine and Slash source; "
                 "covers stats defined in Java that no datapack serialises",
        "exact": exact,
        "patterns": patterns,
    }
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)

    print(f"scanned {len(records)} stat classes")
    print(f"  exact ids : {len(exact)}")
    print(f"  patterns  : {len(patterns)}  "
          + ", ".join(sorted({p['kind'] + ':' + p['text'] for p in patterns}))[:160])
    print(f"-> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
