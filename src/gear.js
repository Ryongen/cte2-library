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

/** Every affix's gear list, computed once per group load. */
export function indexAffixGear(rows, gearTypes) {
  for (const row of rows || []) {
    row.filters = row.filters || {};
    row.filters.gear = gearTypesForAffix(row, gearTypes);
  }
}

// ------------------------------------------------------------- base stats

/**
 * A gear's base stats at a level, after its own modifiers.
 *
 * BaseStatsData.GetAllStats, with the roll replaced by the range the rarity
 * allows. The order is the mod's and it matters: a base stat is first rolled
 * inside `base_stat_percents` and scaled to the level, then every FLAT
 * IBaseStatModifier is added, and only then do the PERCENT ones multiply.
 * Doing the percent first would make `50% Gear's Defense` miss the flat part.
 *
 * Quality is left at 0 - a blueprint-built preview has none, so
 * getQualityBaseStatsBonus contributes nothing.
 */
export function baseStatRange(mod, rarity, modifiers, lvl, scaling) {
  const p0 = rarity?.basePctMin ?? 0;
  const p1 = rarity?.basePctMax ?? 100;
  const span = mod.max - mod.min;
  let lo = scaling.scale(mod.stat, mod.type, mod.min + (span * p0) / 100, lvl);
  let hi = scaling.scale(mod.stat, mod.type, mod.min + (span * p1) / 100, lvl);

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
  return { lo, hi };
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

    const { lo, hi } = baseStatRange(mod, rarity, modifiers, lvl, scaling);
    // the `%` rides on the name, not the number - BaseLocalStatTooltip appends
    // it to locName and prints the value bare, so `Block Chance%: 17 -> 20`
    const percent = Boolean(meta?.percent) || mod.type !== "FLAT";
    const label = toPlain(name || titleCase(mod.stat)) + (percent ? "%" : "");
    const value = lo === hi
      ? formatNumber(lo)
      : `${formatNumber(lo)} -> ${formatNumber(hi)}`;
    return {
      html: `<span class="bullet">●</span>`
        + `<span class="k">${escapeText(label)}</span>`
        + `<span class="v">${escapeText(value)}</span>`,
      text: `${label} ${value}`,
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
