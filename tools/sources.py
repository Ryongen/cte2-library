"""Reading game data out of an instance, a pack zip, or loose jars.

Two kinds of source, one interface. A jar is a zip; the pack's openloader
overrides are a directory tree. Both answer `files(prefix)` and `read(path)`
over the same virtual paths, so the merge above doesn't care which is which.
"""

import json
import os
import re
import zipfile


# Minecraft parses its JSON with a lenient GSON, so the shipped files are not
# always strict JSON - the CTE2 pack has lang files with trailing commas. Match
# that tolerance rather than dropping real content on a stray comma.
_TRAILING_COMMA = re.compile(r",(\s*[}\]])")


def loads_lenient(raw):
    text = raw.decode("utf-8-sig")
    try:
        return json.loads(text)
    except ValueError:
        return json.loads(_TRAILING_COMMA.sub(r"\1", text))


class Source:
    """A read-only tree of game files, addressed by forward-slash paths."""

    def files(self, prefix, suffix=None):
        raise NotImplementedError

    def read(self, path):
        raise NotImplementedError

    def read_json(self, path):
        raw = self.read(path)
        if raw is None:
            return None
        # utf-8-sig because some files carry a BOM, lenient because some
        # of the pack's hand-edited files have trailing commas
        return loads_lenient(raw)


class ZipSource(Source):
    """A mod jar."""

    def __init__(self, path):
        self.path = path
        self.name = os.path.basename(path)
        self._zip = zipfile.ZipFile(path)
        self._names = set(self._zip.namelist())

    def files(self, prefix, suffix=None):
        for n in self._names:
            if n.startswith(prefix) and not n.endswith("/"):
                if suffix is None or n.endswith(suffix):
                    yield n

    def read(self, path):
        if path not in self._names:
            return None
        return self._zip.read(path)

    def close(self):
        self._zip.close()


class DirSource(Source):
    """A directory holding the same layout a jar would - the pack's overrides."""

    def __init__(self, root, name=None):
        self.root = os.path.abspath(root)
        self.name = name or os.path.basename(self.root)

    def _real(self, path):
        return os.path.join(self.root, path.replace("/", os.sep))

    def files(self, prefix, suffix=None):
        base = self._real(prefix)
        # prefix may end mid-name rather than at a directory boundary
        walk_root = base if os.path.isdir(base) else os.path.dirname(base)
        if not os.path.isdir(walk_root):
            return
        for dirpath, _dirnames, filenames in os.walk(walk_root):
            for fn in filenames:
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, self.root).replace(os.sep, "/")
                if rel.startswith(prefix):
                    if suffix is None or rel.endswith(suffix):
                        yield rel

    def read(self, path):
        real = self._real(path)
        if not os.path.isfile(real):
            return None
        with open(real, "rb") as fh:
            return fh.read()


class ZipDirSource(Source):
    """A subtree of a zip presented as if it were the root.

    A CurseForge pack zip keeps everything under `overrides/`; this lets the
    caller address `config/openloader/...` without knowing that.
    """

    def __init__(self, zip_path, inner_prefix, name=None):
        self.name = name or os.path.basename(zip_path)
        self._zip = zipfile.ZipFile(zip_path)
        self._prefix = inner_prefix.rstrip("/") + "/" if inner_prefix else ""
        self._names = {
            n[len(self._prefix):]: n
            for n in self._zip.namelist()
            if n.startswith(self._prefix) and not n.endswith("/")
        }

    def files(self, prefix, suffix=None):
        for rel in self._names:
            if rel.startswith(prefix):
                if suffix is None or rel.endswith(suffix):
                    yield rel

    def read(self, path):
        real = self._names.get(path)
        if real is None:
            return None
        return self._zip.read(real)

    def close(self):
        self._zip.close()


# The mods whose data we care about. Order matters only for lang collisions,
# where later wins - mmorpg last, since it owns most of the keys.
MOD_JARS = [
    ("library_of_exile", "Library_of_Exile"),
    ("dungeon_realm", "Dungeon-Realm"),
    ("the_harvest", "The-Harvest"),
    ("ancient_obelisks", "Ancient-Obelisks"),
    ("mmorpg", "Mine_and_Slash"),
]


def find_jars(mods_dir):
    """Match the five jars we need by filename prefix, newest-looking wins.

    Prism and CurseForge both keep disabled mods as `*.jar.disabled`, and a
    `.jar.disabled` must never be picked up - it is not what the game loaded.
    """
    found = {}
    if not os.path.isdir(mods_dir):
        return found
    for fn in sorted(os.listdir(mods_dir)):
        if not fn.endswith(".jar"):
            continue
        for modid, prefix in MOD_JARS:
            if fn.startswith(prefix):
                found[modid] = os.path.join(mods_dir, fn)
    return found


def open_instance(instance_dir):
    """A Prism/CurseForge instance: jars in mods/, overrides in config/openloader/.

    Returns (data_sources, asset_sources, versions) - each source list already
    in merge order, lowest priority first.
    """
    data_sources = []
    asset_sources = []
    versions = {}

    jars = find_jars(os.path.join(instance_dir, "mods"))
    for modid, _prefix in MOD_JARS:
        path = jars.get(modid)
        if not path:
            continue
        src = ZipSource(path)
        data_sources.append(src)
        asset_sources.append(src)
        versions[modid] = _version_from_jar_name(os.path.basename(path))

    # openloader data packs, alphabetical so a later pack wins - only cte_mns
    # ships registries today, but the pack has reorganised before
    ol_data = os.path.join(instance_dir, "config", "openloader", "data")
    if os.path.isdir(ol_data):
        for pack in sorted(os.listdir(ol_data)):
            inner = os.path.join(ol_data, pack)
            if os.path.isdir(inner):
                data_sources.append(DirSource(inner, name=f"openloader/{pack}"))

    # openloader resource packs carry the lang override - note the doubled
    # `resources/resources`, which is how the pack actually lays it out
    ol_res = os.path.join(instance_dir, "config", "openloader", "resources")
    if os.path.isdir(ol_res):
        for pack in sorted(os.listdir(ol_res)):
            inner = os.path.join(ol_res, pack)
            if os.path.isdir(inner):
                asset_sources.append(DirSource(inner, name=f"openloader-res/{pack}"))

    return data_sources, asset_sources, versions


def detect_pack_version(instance_dir):
    """Read the pack version from the launcher's own metadata.

    Prism never renames an instance folder when the pack updates, so the
    directory can read "2.0.2 Atlas Update" while the install is really 2.1.4 -
    the name is whatever it was called the day it was created. instance.cfg is
    rewritten on every update, so ManagedPackVersionName is authoritative and
    the folder name is not.

    Returns (version, project_id); either may be None.
    """
    # instance.cfg sits beside the `minecraft` dir, not inside it
    for base in (instance_dir, os.path.dirname(os.path.abspath(instance_dir))):
        path = os.path.join(base, "instance.cfg")
        if not os.path.isfile(path):
            continue
        version = project = None
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                key, _, value = line.partition("=")
                key, value = key.strip(), value.strip()
                if key == "ManagedPackVersionName":
                    version = value or None
                elif key == "ManagedPackID":
                    project = value or None
        if version or project:
            return version, project

    # a CurseForge instance keeps the same facts in minecraftinstance.json
    for base in (instance_dir, os.path.dirname(os.path.abspath(instance_dir))):
        path = os.path.join(base, "minecraftinstance.json")
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8-sig") as fh:
                data = json.load(fh)
        except (ValueError, OSError):
            continue
        installed = data.get("installedModpack") or {}
        file_info = installed.get("installedFile") or {}
        version = file_info.get("displayName") or file_info.get("fileName")
        return version, str(data.get("projectID") or "") or None

    return None, None


def _version_from_jar_name(fn):
    """Mine_and_Slash-1.20.1-6.4.13.jar -> 6.4.13"""
    stem = fn[:-4] if fn.endswith(".jar") else fn
    parts = stem.split("-")
    return parts[-1] if parts else stem
