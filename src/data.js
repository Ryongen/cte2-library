// Loading the per-version data bundles.
//
// Every version under data/<pack>/ is self-contained, so switching versions is
// a fetch, not a migration. Group files are pulled on demand - opening Affixes
// should not cost the 250 KB of spell data.

const BASE = new URL(".", new URL("..", import.meta.url)).pathname;

function dataUrl(...parts) {
  return `${BASE}data/${parts.join("/")}`.replace(/\/{2,}/g, "/");
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} - ${url}`);
  return res.json();
}

export async function loadVersions() {
  return getJson(dataUrl("versions.json"));
}

/** The shared tables for one version: lang, balance, meta. */
export async function loadVersion(pack) {
  const [meta, lang, balance] = await Promise.all([
    getJson(dataUrl(pack, "meta.json")),
    getJson(dataUrl(pack, "lang.json")),
    getJson(dataUrl(pack, "balance.json")),
  ]);
  return { pack, meta, lang, balance, groups: new Map() };
}

/** One group's rows, cached on the version bundle. */
export async function loadGroup(version, key) {
  if (version.groups.has(key)) return version.groups.get(key);
  const promise = getJson(dataUrl(version.pack, "groups", `${key}.json`));
  version.groups.set(key, promise);
  return promise;
}

export function iconUrl(...parts) {
  return `${BASE}assets/icons/${parts.join("/")}`.replace(/\/{2,}/g, "/");
}
