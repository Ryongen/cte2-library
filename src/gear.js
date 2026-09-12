// Base gear types: what an item is before anything is rolled onto it.
//
// Two groups need this and neither can work it out from its own rows.
//
//   - A unique is a base item with unique stats bolted on. The wiki builds a
//     real preview stack (BestiaryGroup.UNIQUE_GEAR -> GearBlueprint), so a
//     plate chest unique shows plate chest Armor and Health above its own
//     lines, and `gear_defense` on the unique moves those numbers.
//   - An affix declares tags, not slots. GroupFilterType.AFFIX_SLOTS resolves
//     them by testing every affix against every BaseGearType, which is why a
//     cloth helmet answers to `helmet`, `cloth` and `cloth_helmet` at once -
//     three different affix pools, all of which can roll on it.
//
// Ported from TagRequirement.meetsRequierment and BaseStatsData.

import { renderStatMod, titleCase } from "./stats.js";
import { toPlain, formatNumber } from "./mcfmt.js";

/**
 * IBaseStatModifier: the stats that rewrite a gear's own base numbers rather
 * than adding a line of their own. Both are Java-side singletons, and each
 * names exactly which base stats it may touch (GearDefense.canModifyBaseStat,
 * GearDamage.canModifyBaseStat).
 */
const BASE_STAT_MODIFIERS = {
  gear_defense: new Set(["armor", "dodge", "magic_shield"]),
  gear_weapon_damage: new Set(["weapon_damage"]),
};

/** TagRequirement.meetsRequierment, for one requirement against one gear. */
function meetsRequirement(req, tags) {
  if ((req.exc || []).some((t) => tags.has(t))) return false;
  const inc = req.inc || [];
  return req.all ? inc.every((t) => tags.has(t)) : inc.some((t) => tags.has(t));
}

/** Requirements.satisfiesAllRequirements: every requirement must hold. */
export function affixFitsGear(reqs, gearType) {
  if (!reqs || !reqs.length) return false;
  const tags = new Set(gearType.tags || []);
  return reqs.every((r) => meetsRequirement(r, tags));
}

/**
 * Which base gear types an affix can roll on, in display order.
 *
 * Empty is a real answer, not a failure: enchantment, jewel and tool affixes
 * key off tags no BaseGearType carries, so the in-game slot filter hides them
 * too - they are applied by infusion or live on items outside this registry.
 */
export function gearTypesForAffix(row, gearTypes) {
  const out = [];
  for (const [id, gt] of Object.entries(gearTypes || {})) {
    if (affixFitsGear(row.reqs, gt)) out.push(id);
  }
  return out.sort();
}

/** Every affix's gear list and categories, computed once per group load. */
export function indexAffixGear(rows, gearTypes) {
  for (const row of rows || []) {
    const gear = gearTypesForAffix(row, gearTypes);
    row.filters = row.filters || {};
    row.filters.gear = gear;
    // the same grouping the other gear groups carry, over what this affix
    // resolved to rather than over the tags it asks for: `cloth_helmet` and
    // `helmet` are two different rules that both land on "Any Helmet". The 139
    // affixes that match no base item get none, which is the honest answer.
    row.filters.cat = [...new Set(
      gear.flatMap((id) => gearTypes?.[id]?.cats || []))];
  }
}

// ------------------------------------------------------------- base stats

/**
 * A gear's base stats at a level, both before and after its own modifiers.
 *
 * The mod draws this block twice and the two do not agree, so both numbers
 * come back here:
 *
 *   - `rawLo/rawHi` is BaseStatsData.getAllStatsWithCtx, the shift view. It
 *     rolls the BaseGearType's own StatMod inside `base_stat_percents` and
 *     prints `[min - max]` from that alone - no IBaseStatModifier is ever
 *     consulted on that path, so the bracket on a Gear's Defense unique is
 *     the window *before* its own stat moves it.
 *   - `lo/hi` is BaseStatsData.GetAllStats, the line actually drawn without
 *     shift, which is what the item ends up giving you. The order there is the
 *     mod's and it matters: every FLAT IBaseStatModifier is added first and
 *     only then do the PERCENT ones multiply, so doing the percent first would
 *     make `50% Gear's Defense` miss the flat part.
 *
 * Quality is left at 0 - a blueprint-built preview has none, so
 * getQualityBaseStatsBonus contributes nothing.
 */
export function baseStatRange(mod, rarity, modifiers, lvl, scaling) {
  const p0 = rarity?.basePctMin ?? 0;
  const p1 = rarity?.basePctMax ?? 100;
  const span = mod.max - mod.min;
  const rawLo = scaling.scale(mod.stat, mod.type, mod.min + (span * p0) / 100, lvl);
  const rawHi = scaling.scale(mod.stat, mod.type, mod.min + (span * p1) / 100, lvl);
  let lo = rawLo;
  let hi = rawHi;

  const applies = (m) => BASE_STAT_MODIFIERS[m.stat]?.has(mod.stat);
  for (const m of modifiers || []) {
    if (m.type !== "FLAT" || !applies(m)) continue;
    lo += scaling.scale(m.stat, "FLAT", m.min, lvl);
    hi += scaling.scale(m.stat, "FLAT", m.max, lvl);
  }
  for (const m of modifiers || []) {
    if (m.type !== "PERCENT" || !applies(m)) continue;
    lo *= 1 + m.min / 100;
    hi *= 1 + m.max / 100;
  }
  return { lo, hi, rawLo, rawHi };
}

/** True if any of `mods` would move this gear's base stats. */
export function modifiesBaseStats(mods, baseStats) {
  const targets = new Set((baseStats || []).map((s) => s.stat));
  return (mods || []).some((m) => {
    const set = BASE_STAT_MODIFIERS[m.stat];
    return set && [...set].some((t) => targets.has(t));
  });
}

/**
 * Render a gear's base stats as tooltip lines.
 *
 * BaseLocalStatTooltip's shape - a bullet, the stat name, a `%` when the stat
 * or the modifier is one, then the number. The in-game line shows the single
 * value that was rolled; here there is no roll, so the rarity's whole window
 * is shown instead, the way holding shift over a real item does.
 *
 * The shift view is also where the number comes from: its `[110 - 126]` is the
 * base stat alone, so that is what a reader holding shift over the real item
 * sees and it goes first. A unique carrying `gear_defense` or
 * `gear_weapon_damage` then gets the window it actually ends up with in
 * parentheses after it - the no-shift `●` line's own answer, which the
 * bracket never shows. Nothing is appended when no modifier moved the numbers,
 * which is every base item and most uniques.
 */
export function baseStatLines(gearType, rarity, modifiers, ctx) {
  const { lvl, lang, scaling } = ctx;
  return (gearType?.baseStats || []).map((mod) => {
    const meta = scaling.statMeta(mod.stat);
    const name = lang["mmorpg.stat." + mod.stat];

    // a long stat writes its own sentence and takes the unscaled min, exactly
    // as it does anywhere else - see renderStatMod
    if (name && name.includes("[VAL1]")) {
      const line = renderStatMod(mod, lvl, scaling, lang);
      return { html: line.html, text: line.text, kind: "base" };
    }

    const r = baseStatRange(mod, rarity, modifiers, lvl, scaling);
    // the `%` rides on the name, not the number - BaseLocalStatTooltip appends
    // it to locName and prints the value bare, so `Block Chance%: 17 -> 20`
    const percent = Boolean(meta?.percent) || mod.type !== "FLAT";
    const label = toPlain(name || titleCase(mod.stat)) + (percent ? "%" : "");
    const window = (a, b) => (a === b
      ? formatNumber(a)
      : `${formatNumber(a)} -> ${formatNumber(b)}`);
    const value = window(r.rawLo, r.rawHi);
    // compared after formatting, so a modifier too small to move the printed
    // number does not earn a parenthetical that repeats it
    const moved = window(r.lo, r.hi);
    const extra = moved === value ? "" : ` (${moved})`;
    return {
      html: `<span class="bullet">●</span>`
        + `<span class="k">${escapeText(label)}</span>`
        + `<span class="v">${escapeText(value)}`
        + (extra ? `<span class="mod">${escapeText(extra)}</span>` : "")
        + `</span>`,
      text: `${label} ${value}${extra}`,
      kind: "base",
    };
  });
}

function escapeText(s) {
  return String(s).replace(/[&<>]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

/** A gear type's display name, falling back to the id. */
export function gearTypeName(gearTypes, id) {
  return gearTypes?.[id]?.name || titleCase(id);
}
