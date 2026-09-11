// Rendering one stat modifier the way the in-game wiki does.
//
// Ported from StatMod.getEstimationTooltip, which builds a line in two halves:
//
//   getRangeToShow(lvl)            "(0.30 -> 1.50)" in green, % where relevant
//   + the stat's name, drawn with no number at all (showNumber = false)
//
// The long stats are the exception: their lang string is the whole sentence
// with a [VAL1] hole, they short-circuit before the range is built, and they
// substitute the *unscaled* min. That asymmetry is deliberate in the mod, so
// it is reproduced rather than tidied up.

import { toHtml, toPlain, formatNumber, stripLinks } from "./mcfmt.js";

const VAL1 = "[VAL1]";
const GREEN = "§a";
const GRAY = "§7";

/** A stat's display name template, from lang. */
function statText(lang, statId) {
  return lang["mmorpg.stat." + statId] ?? null;
}

/** A long stat carries its own sentence, marked by the [VAL1] hole. */
function isLong(lang, statId, meta) {
  const text = statText(lang, statId);
  if (text && text.includes(VAL1)) return true;
  return Boolean(meta?.long);
}

function word(lang, key, fallback) {
  const v = lang["mmorpg.word." + key];
  return v ? toPlain(v) : fallback;
}

/**
 * Render one {stat, type, min, max} at a level.
 * Returns { html, text } - text is the plain form, used for tooltip search.
 */
export function renderStatMod(mod, lvl, scaling, lang, rarity = null) {
  const meta = scaling.statMeta(mod.stat);
  const type = String(mod.type || "FLAT").toUpperCase();
  const name = statText(lang, mod.stat);
  mod = applyRarity(mod, rarity);

  if (isLong(lang, mod.stat, meta)) {
    // JUST_NAME.translate: the template, with [VAL1] -> +min. No range and no
    // level scaling - the mod returns before either is applied. No % either:
    // a long stat's sentence already writes the sign where it wants it, so
    // appending one here yields "+15%%".
    const plus = mod.min > 0 ? "+" : "";
    const filled = (name || mod.stat).split(VAL1)
      .join(GREEN + plus + formatNumber(mod.min) + GRAY);
    return { html: toHtml(GRAY + filled), text: toPlain(filled) };
  }

  const lo = scaling.scale(mod.stat, type, mod.min, lvl);
  const hi = scaling.scale(mod.stat, type, mod.max, lvl);

  // getRangeToShow: percent if the stat is percent OR the modifier is
  const percent = Boolean(meta?.percent) || type === "PERCENT" || type === "MORE";
  const suffix = percent ? "%" : "";
  let range = `(${formatNumber(lo)}${suffix} -> ${formatNumber(hi)}${suffix})`;
  if (!percent && type === "MORE") {
    range += " " + (lo > 0 ? word(lang, "multiplicative_damage_more", "More")
                           : word(lang, "multiplicative_damage_less", "Less"));
  }

  const label = name || titleCase(mod.stat);
  let body;
  if (type === "MORE") {
    const w = lo > 0 ? word(lang, "multiplicative_damage_more", "More")
                     : word(lang, "multiplicative_damage_less", "Less");
    body = w + " " + label;
  } else if (type === "PERCENT" && meta?.percent) {
    // BasicStatRegex: a percent modifier on an already-percent stat reads
    // "Increased"/"Reduced" rather than stacking a second % sign
    const w = lo > 0 ? word(lang, "multiply_stat_increased", "Increased")
                     : word(lang, "multiply_stat_reduced", "Reduced");
    body = w + " " + label;
  } else {
    body = label;
  }

  const html = `<span class="range">${escapeText(range)}</span> `
    + toHtml(GRAY + body);
  return { html, text: `${range} ${toPlain(body)}` };
}

/**
 * Narrow a range to what one rarity can actually roll.
 *
 * A gear rarity carries base_stat_percents - rare rolls 30..100% of a stat's
 * span, mythic a tighter, higher window. Picking a rarity in the wiki shows
 * that window instead of the full range, which is what the rarity button does
 * in game via ExactStatData.fromStatModifier(mod, percent, lvl).
 */
function applyRarity(mod, rarity) {
  if (!rarity) return mod;
  const lo = rarity.pctMin ?? 0;
  const hi = rarity.pctMax ?? 100;
  const span = mod.max - mod.min;
  return {
    ...mod,
    min: mod.min + (span * lo) / 100,
    max: mod.min + (span * hi) / 100,
  };
}

/** Render a list of modifiers as tooltip lines. */
export function renderStatList(mods, lvl, scaling, lang, rarity = null) {
  return (mods || []).map((m) => renderStatMod(m, lvl, scaling, lang, rarity));
}

function escapeText(s) {
  return String(s).replace(/[&<>]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export function titleCase(id) {
  return String(id || "").split(/[_:/]/).filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
}

/** Resolve `[calc:id]` holes in a spell description. */
export function resolveCalcs(desc, lvl, scaling, balance) {
  const calcs = balance?.valueCalcs || {};
  return stripLinks(String(desc || "")).replace(
    /\[calc:([a-z0-9_]+)\]/gi,
    (whole, id) => {
      const calc = calcs[id];
      if (!calc) return whole;
      const base = Math.trunc(scaling.calcBase(calc, lvl));
      const parts = [`§a${base}§7`];
      for (const s of calc.scalings || []) {
        if (!s.stat) continue;
        const pct = Math.round((s.min === s.max ? s.min
          : s.min + ((s.max - s.min) / scaling.maxLevel) * lvl) * 100);
        parts.push(`§b+${pct}% ${titleCase(s.stat)}§7`);
      }
      return parts.join(" ");
    });
}
