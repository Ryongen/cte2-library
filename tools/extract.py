"""Turn a Craft to Exile 2 install into the site's per-version data bundle.

    python tools/extract.py --instance "<...>/minecraft"

Reads the mod jars for the base content database and layers the pack's
openloader overrides on top, pack last - the same precedence the game applies
at load. For CTE2 the overrides are most of the content, not a tweak: 505
affixes against the jar's 212, 570 spells against 120.
"""

import argparse
import json
import os
import sys
import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import registries as regs
import sources as src
import groups as groupbuild

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# lang key prefixes the site actually renders; everything else is dead weight
LANG_PREFIXES = (
    "mmorpg.stat.", "mmorpg.stat_desc.", "mmorpg.affix.", "mmorpg.spell.",
    "spell.desc.", "mmorpg.word.", "mmorpg.tag.", "mmorpg.unique_gear.",
    "mmorpg.support_gem.", "mmorpg.aura.", "mmorpg.effect.", "mmorpg.gui.",
    "mmorpg.item_tips.", "mmorpg.formatter.", "item.mmorpg.",
    "library_of_exile.item_modification.", "library_of_exile.item_requirement.",
    "library_of_exile.currency.", "mmorpg.profession.", "mmorpg.gearslot.",
    "mmorpg.rarity.", "mmorpg.runeword.", "mmorpg.rune.", "mmorpg.gem.",
    "mmorpg.gear_type.",
)


def load_registry(registry, data_sources):
    """Merge one registry across every source, later sources winning.

    Returns (entries, shadowed) - shadowed being the ids one source declares
    twice, which is a pack mistake worth printing. An id the *pack* takes off
    a jar is not in there: that is the merge doing its job.
    """
    out, rank, shadowed = {}, {}, {}
    prefix = registry.data_prefix()
    for order, source in enumerate(data_sources):
        for path in sorted(source.files(prefix, ".json")):
            try:
                obj = source.read_json(path)
            except (ValueError, UnicodeDecodeError) as exc:
                print(f"  ! skipped unreadable {path} ({source.name}): {exc}")
                continue
            if not isinstance(obj, dict):
                continue
            rel = path[len(prefix):]
            fallback = os.path.splitext(os.path.basename(rel))[0]
            entry_id = registry.entry_id(obj, fallback)
            # Two files can carry the same internal id, and the pack ships 170
            # such uniques and 139 such spells: a flat leftover from April
            # beside the live copy the author moved into a per-slot folder
            # (`honourhome.json` vs `chainmail_helmet/honourhome.json`, at
            # 50-60% Gear's Defense against the current 12.5-15%). The game
            # registers whichever its loader reaches last, and that loader
            # iterates a HashMap - the stale copy wins for roughly half of
            # them, arbitrarily. There is no in-game order to be faithful to,
            # so rank the candidates by what the author clearly meant:
            #   1. a file whose own name matches the id it declares, because
            #      the ones that disagree are copy-paste that forgot to change
            #      it (`fishing_treasure_chance_bonus.json` declaring
            #      `fishing_bar_size`, shadowing the real stat)
            #   2. the deeper path, the per-slot or per-class folder the pack
            #      has been reorganising into
            #   3. path order, so an unresolved tie still lands somewhere
            # Source order outranks all of it: the pack still beats the jar.
            here = (order, fallback == entry_id, rel.count("/"))
            if entry_id in out:
                loses = here < rank[entry_id]
                # a later source shadowing an earlier one is the merge doing
                # its job; only a source colliding with itself is a mistake
                if here[0] == rank[entry_id][0]:
                    shadowed.setdefault(entry_id, []).append(
                        rel if loses else out[entry_id]["_path"])
                if loses:
                    continue
            # remember where it came from, for the merge-direction check
            obj["_source"] = source.name
            obj["_id"] = entry_id
            obj["_path"] = rel
            out[entry_id] = obj
            rank[entry_id] = here
    return out, shadowed


def load_lang(asset_sources):
    """en_us across every source. The pack's override is a near-total replacement."""
    lang = {}
    for source in asset_sources:
        for path in sorted(source.files("assets/", "lang/en_us.json")):
            try:
                obj = source.read_json(path)
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if isinstance(v, str):
                        lang[k] = v
    return lang


def prune_lang(lang):
    return {k: v for k, v in lang.items() if k.startswith(LANG_PREFIXES)}


def extract_icons(asset_sources, icon_root, spell_ids):
    """Copy the icons the UI needs. Shared across versions, not per-version.

    They change rarely and 512 item textures is ~3.7 MB, so versioning them
    would dominate the repo for no benefit. New icons are added, existing ones
    left alone - an old version keeps rendering with whatever is there.
    """
    os.makedirs(icon_root, exist_ok=True)
    written = 0

    def copy(path, out_name):
        nonlocal written
        dest = os.path.join(icon_root, out_name)
        if os.path.exists(dest):
            return
        for source in reversed(asset_sources):   # pack override wins
            raw = source.read(path)
            if raw:
                with open(dest, "wb") as fh:
                    fh.write(raw)
                written += 1
                return

    os.makedirs(os.path.join(icon_root, "group"), exist_ok=True)
    for _key, _label, icon in regs.GROUP_ORDER:
        copy(f"assets/mmorpg/textures/gui/bestiary/group_icons/{icon}.png",
             os.path.join("group", f"{icon}.png"))

    os.makedirs(os.path.join(icon_root, "spell"), exist_ok=True)
    for sid in spell_ids:
        copy(f"assets/mmorpg/textures/gui/spells/icons/{sid}.png",
             os.path.join("spell", f"{sid}.png"))

    return written


def load_code_stats():
    """Properties for the stats only Java defines. See gen_code_stats.py."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "code_stats.json")
    if not os.path.isfile(path):
        print("  ! tools/code_stats.json missing - every code-defined stat will "
              "render unscaled; run tools/gen_code_stats.py")
        return {"exact": {}, "patterns": []}
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, obj, compact=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        if compact:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
        else:
            json.dump(obj, fh, ensure_ascii=False, indent=1, sort_keys=False)
    return os.path.getsize(path)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", help="modpack version, e.g. 2.1.4 "
                                      "(default: read from the launcher metadata)")
    ap.add_argument("--instance", help="instance dir holding mods/ and config/openloader/")
    ap.add_argument("--out", help="output root (default: <repo>/data)")
    ap.add_argument("--pretty", action="store_true", help="indent the JSON (debugging)")
    args = ap.parse_args(argv)

    if not args.instance:
        ap.error("--instance is required (a pack zip path will be added with the CF fetcher)")
    if not os.path.isdir(args.instance):
        ap.error(f"not a directory: {args.instance}")

    detected, project_id = src.detect_pack_version(args.instance)
    version = args.version or detected
    if not version:
        ap.error("could not read the pack version from the instance - pass --version")
    if args.version and detected and args.version != detected:
        print(f"  ! --version {args.version} disagrees with the launcher's "
              f"{detected}; using {args.version}")
        print("    the folder name is not the version - instance.cfg is")

    print(f"instance: {args.instance}")
    print(f"pack:     {version}" + (f"  (project {project_id})" if project_id else "")
          + ("  [detected]" if not args.version else ""))
    data_sources, asset_sources, mod_versions = src.open_instance(args.instance)
    if not data_sources:
        ap.error("no mod jars or openloader data found - is this the 'minecraft' dir?")

    print(f"sources:  {len(data_sources)} data, {len(asset_sources)} asset")
    for modid, ver in sorted(mod_versions.items()):
        print(f"          {modid} {ver}")

    lang = load_lang(asset_sources)
    print(f"lang:     {len(lang)} keys")

    # merge every registry we need
    loaded = {}
    collisions = {}
    for name, registry in regs.ALL_REGISTRIES.items():
        loaded[name], shadowed = load_registry(registry, data_sources)
        if shadowed:
            collisions[name] = shadowed
    if collisions:
        print("\nids declared twice by one source (kept the live copy):")
        for name in sorted(collisions):
            shadowed = collisions[name]
            example = min(shadowed)
            print(f"  {name:14} {len(shadowed):4} shadowed"
                  f"   e.g. {example} <- {', '.join(shadowed[example])}")

    code_stats = load_code_stats()
    ctx = groupbuild.Context(loaded, lang, code_stats)

    out_root = args.out or os.path.join(REPO, "data")
    version_dir = os.path.join(out_root, version)

    # --- groups
    counts = {}
    total_bytes = 0
    built = {}
    print("\ngroups:")
    for key, label, icon in regs.GROUP_ORDER:
        rows = groupbuild.build(key, ctx)
        built[key] = rows
        counts[key] = len(rows)
        size = write_json(os.path.join(version_dir, "groups", f"{key}.json"),
                          {"group": key, "label": label, "icon": icon, "rows": rows},
                          compact=not args.pretty)
        total_bytes += size
        over = sum(1 for r in rows if r.get("src", "").startswith("openloader"))
        print(f"  {label:16} {len(rows):5}  ({over} from pack)  {size/1024:7.1f} KB")

    # --- shared tables
    size = write_json(os.path.join(version_dir, "lang.json"), prune_lang(lang),
                      compact=not args.pretty)
    total_bytes += size
    print(f"\n  lang.json      {len(prune_lang(lang)):5}  {size/1024:7.1f} KB")

    balance = groupbuild.build_balance(ctx)

    # back-fill the stats only Java defines, and say so if any are still unknown.
    # the gear bases are counted too - nothing else references weapon_damage
    referenced = groupbuild.referenced_stats(built.values())
    referenced |= groupbuild.gear_type_stats(balance)
    from_datapack = len([s for s in referenced if s in balance["stats"]])
    unresolved = groupbuild.fill_code_stats(balance["stats"], referenced, code_stats)
    print(f"  stats          {len(referenced):5} referenced  "
          f"({from_datapack} datapack, {len(referenced) - from_datapack - len(unresolved)} code)")
    if unresolved:
        print(f"  ! {len(unresolved)} stats unresolved - rendering them unscaled:")
        for sid in unresolved[:20]:
            print(f"      {sid}")
        if len(unresolved) > 20:
            print(f"      ... and {len(unresolved) - 20} more")
        print("    re-run tools/gen_code_stats.py against a current mod checkout")

    size = write_json(os.path.join(version_dir, "balance.json"), balance,
                      compact=not args.pretty)
    total_bytes += size
    print(f"  balance.json         {size/1024:7.1f} KB")

    icons = extract_icons(asset_sources, os.path.join(REPO, "assets", "icons"),
                          [r["id"] for r in built.get("spell", [])])
    print(f"  icons          {icons:5} new")

    meta = {
        "pack": version,
        "mods": mod_versions,
        "generated": datetime.datetime.now(datetime.timezone.utc)
                             .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "maxLevel": balance.get("maxLevel", 100),
        "counts": counts,
    }
    write_json(os.path.join(version_dir, "meta.json"), meta, compact=False)

    update_version_index(out_root, version, meta)

    print(f"\ntotal: {total_bytes/1024/1024:.2f} MB -> {version_dir}")
    return 0


def update_version_index(out_root, version, meta):
    """Rewrite data/versions.json, newest first."""
    index_path = os.path.join(out_root, "versions.json")
    existing = []
    if os.path.isfile(index_path):
        try:
            with open(index_path, encoding="utf-8") as fh:
                existing = json.load(fh)
        except (ValueError, OSError):
            existing = []
    existing = [v for v in existing if v.get("pack") != version]
    existing.append({
        "pack": version,
        "mods": meta["mods"],
        "generated": meta["generated"],
        "counts": meta["counts"],
    })
    existing.sort(key=lambda v: _version_key(v["pack"]), reverse=True)
    write_json(index_path, existing, compact=False)


def _version_key(v):
    """'2.10.1' sorts above '2.9.9'; anything unparseable sorts last."""
    out = []
    for part in str(v).replace("-", ".").split("."):
        out.append(int(part) if part.isdigit() else -1)
    return out


if __name__ == "__main__":
    sys.exit(main())
