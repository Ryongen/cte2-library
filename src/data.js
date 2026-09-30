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

/** The id a version ships for `locale`, or null - es_mx is es_es's file. */
export function resolveLocale(meta, locale) {
  if (!locale) return null;
  const hit = (meta.locales || []).find((l) =>
    l.id === locale || (l.aliases || []).includes(locale));
  return hit ? hit.id : null;
}

/**
 * The shared tables for one version: lang, balance, meta.
 *
 * A locale is an overlay on the English bundle, not a bundle of its own: the
 * pack translates none of what it adds, so most of every language is English
 * anyway. Its file carries the translated lang keys the tooltips read at
 * render time, plus a patch for the strings the extractor baked into rows and
 * balance - names, descriptions, category labels. See tools/locales.py.
 */
export async function loadVersion(pack, locale) {
  const [meta, lang, balance] = await Promise.all([
    getJson(dataUrl(pack, "meta.json")),
    getJson(dataUrl(pack, "lang.json")),
    getJson(dataUrl(pack, "balance.json")),
  ]);
  const loc = resolveLocale(meta, locale);
  let patch = {};
  let translated = {};
  if (loc) {
    const overlay = await getJson(dataUrl(pack, "lang", `${loc}.json`));
    Object.assign(lang, overlay.lang);
    translated = overlay.lang || {};
    mergePatch(balance, overlay.balance || {});
    patch = overlay.groups || {};
  }
  // `translated` is the language's own keys alone, for the UI to tell a
  // translated word from the English fallback merged into `lang`
  return { pack, meta, lang, translated, balance, locale: loc, patch, groups: new Map() };
}

/** One group's rows, cached on the version bundle, in the bundle's language. */
export async function loadGroup(version, key) {
  if (version.groups.has(key)) return version.groups.get(key);
  const promise = getJson(dataUrl(version.pack, "groups", `${key}.json`))
    .then((group) => {
      const patch = version.patch[key];
      if (patch) {
        patchRows(group.rows || [], patch);
        // the extractor sorted by the English name (groups.build); a list in
        // French should read alphabetically in French
        const collator = new Intl.Collator(version.locale.replace("_", "-"));
        group.rows.sort((a, b) => collator.compare(a.name, b.name)
          || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      }
      return group;
    });
  version.groups.set(key, promise);
  return promise;
}

/** A locale's patch for one group, applied to its rows in place. */
export function patchRows(rows, patch) {
  if (!patch) return;
  for (const row of rows) {
    const p = patch[row.id];
    if (!p) continue;
    // kept so a search still finds an entry by the English name, which is
    // what every guide and most players in any language call it
    row.nameEn = row.name;
    mergePatch(row, p);
  }
}

// A patch mirrors the tree it lands on. Objects recurse, and so does a list
// patched as {"3": ...}, since arr["3"] is arr[3]; anything else replaces.
export function mergePatch(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    const t = target[k];
    if (v && typeof v === "object" && !Array.isArray(v)
        && t && typeof t === "object") {
      mergePatch(t, v);
    } else {
      target[k] = v;
    }
  }
}

export function iconUrl(...parts) {
  return `${BASE}assets/icons/${parts.join("/")}`.replace(/\/{2,}/g, "/");
}
