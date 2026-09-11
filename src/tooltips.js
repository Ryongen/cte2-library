// Building a tooltip for one entry, per group.
//
// Each builder follows the line order of that group's lambda in
// BestiaryGroup.java, so an entry reads the same here as in the wiki screen.
// A line is { html, text, kind } - kind drives styling, text feeds search.

import { toHtml, toPlain, colorOf, formatNumber } from "./mcfmt.js";
import { renderStatMod, titleCase, resolveCalcs } from "./stats.js";

const blank = () => ({ html: "", text: "", kind: "blank" });
const plain = (text, kind = "line") => ({
  html: toHtml("§7" + text), text: toPlain(text), kind,
});
const meta = (label, value) => ({
  html: `<span class="k">${esc(label)}</span><span class="v">${esc(value)}</span>`,
  text: `${label} ${value}`, kind: "meta",
});

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function title(text, color = "#ffff55") {
  return {
    html: `<span class="title" style="color:${color}">${esc(text)}</span>`,
    text, kind: "title",
  };
}

function statLines(mods, ctx) {
  return (mods || []).map((m) => {
    const r = renderStatMod(m, ctx.lvl, ctx.scaling, ctx.lang, ctx.rarity);
    return { html: r.html, text: r.text, kind: "stat" };
  });
}

function ticksToSeconds(ticks) {
  return `${formatNumber(ticks / 20)}s`;
}

function tagChips(tags) {
  if (!tags || !tags.length) return null;
  return {
    html: tags.map((t) => `<span class="chip">${esc(titleCase(t))}</span>`).join(""),
    text: tags.join(" "), kind: "chips",
  };
}

// ------------------------------------------------------------------ builders

const BUILDERS = {
  affix(row, ctx) {
    const out = [title(row.name, "#55ffff")];
    out.push(...statLines(row.stats, ctx));
    if (row.tags?.length) {
      out.push(blank());
      out.push({
        html: row.tags.map((t) => `<span class="chip">${esc(titleCase(t))}</span>`).join("")
          + (row.excl || []).map((t) =>
            `<span class="chip excl">${esc(titleCase(t))}</span>`).join(""),
        text: [...row.tags, ...(row.excl || [])].join(" "), kind: "chips",
      });
    }
    out.push(blank());
    if (row.f?.weight != null) out.push(meta("Weight", row.f.weight));
    out.push(meta("Id", row.id));
    if (row.f?.type) out.push(meta("Affix Type", row.f.type));
    return out;
  },

  unique_gear(row, ctx) {
    const rarity = ctx.balance.rarities?.unique;
    const out = [title(row.name, colorOf(rarity?.color, "#ffaa00"))];
    if (row.f?.baseGear) out.push(plain(titleCase(row.f.baseGear), "sub"));
    out.push(blank());
    out.push(...statLines(row.stats, ctx));
    if (row.flavor) { out.push(blank()); out.push(plain("§o" + row.flavor, "flavor")); }
    out.push(blank());
    if (row.f?.minLvl) out.push(meta("Min Level", row.f.minLvl));
    if (row.f?.minTier) out.push(meta("Min Map Tier", row.f.minTier));
    if (row.f?.league) out.push(meta("League", titleCase(row.f.league)));
    if (row.f?.weight != null) out.push(meta("Weight", row.f.weight));
    out.push(meta("Id", row.id));
    return out;
  },

  runeword(row, ctx) {
    const out = [title(row.name, "#ffff55")];
    out.push(blank());
    if (row.slots?.length) {
      out.push(plain("On Slots: " + row.slots.map(titleCase).join(", ")));
    }
    out.push(blank());
    if (row.runes?.length) {
      out.push({
        html: `<span class="runes">${esc(row.runes.join(" + ").toUpperCase())}</span>`,
        text: row.runes.join(" "), kind: "runes",
      });
    }
    out.push(blank());
    out.push(plain("Stats:"));
    out.push(...statLines(row.stats, ctx));
    out.push(blank());
    out.push(meta("Id", row.id));
    return out;
  },

  rune: socketable,
  gem: socketable,

  supp_gem(row, ctx) { return skillGem(row, ctx, "Support Gem"); },
  aura(row, ctx) { return skillGem(row, ctx, "Augment"); },

  effect(row, ctx) {
    const color = row.f?.type === "negative" ? "#ff5555" : "#55ff55";
    const out = [title(row.name, color)];
    const chips = tagChips(row.tags);
    if (chips) out.push(chips);
    out.push(blank());
    out.push(...statLines(row.stats, ctx));
    out.push(blank());
    if (row.f?.maxStacks > 1) out.push(meta("Max Stacks", row.f.maxStacks));
    if (row.f?.type) out.push(meta("Type", titleCase(row.f.type)));
    out.push(meta("Id", row.id));
    return out;
  },

  spell(row, ctx) {
    const out = [title(row.name, "#ff5555")];
    out.push(blank());
    if (row.desc) {
      const resolved = resolveCalcs(row.desc, ctx.lvl, ctx.scaling, ctx.balance);
      for (const part of resolved.split("[LINE]")) {
        if (part.trim()) out.push({
          html: toHtml("§7" + part.trim()), text: toPlain(part), kind: "desc",
        });
      }
    }
    out.push(blank());
    const c = row.cfg || {};
    if (c.manaMax > 0) out.push(costLine("Mana Cost", c.manaMin, c.manaMax, "#5555ff"));
    if (c.eneMax > 0) out.push(costLine("Energy Cost", c.eneMin, c.eneMax, "#55ff55"));
    if (c.charges > 0) {
      out.push(meta("Max Charges", c.charges));
      if (c.chargeRegen) out.push(meta("Charge Regen", ticksToSeconds(c.chargeRegen)));
    } else if (c.cooldown > c.recovery) {
      out.push(meta("Cooldown", ticksToSeconds(c.cooldown)));
    }
    out.push(meta("Recovery", ticksToSeconds(c.recovery)));
    if (c.channel) {
      out.push(meta("Channel Pulse", ticksToSeconds(c.castTime)));
    } else if (c.castTime <= 1) {
      out.push(meta("Cast Time", "Instant"));
    } else {
      out.push(meta("Cast Time", ticksToSeconds(c.castTime)));
    }
    if (row.stats?.length) {
      out.push(blank());
      out.push(plain("Per Gem Level:"));
      out.push(...statLines(row.stats, ctx));
    }
    const chips = tagChips(row.tags);
    if (chips) { out.push(blank()); out.push(chips); }
    out.push(blank());
    if (c.weapon) out.push(meta("Weapon", titleCase(c.weapon)));
    if (row.f?.maxLvl) out.push(meta("Max Gem Level", row.f.maxLvl));
    out.push(meta("Id", row.id));
    return out;
  },

  currency(row, ctx) {
    const rarity = ctx.balance.rarities?.[row.f?.rarity];
    const out = [title(row.name, colorOf(rarity?.color, "#ffffff"))];
    out.push(blank());
    for (const m of row.mods || []) out.push(plain(modLabel(ctx, m)));
    if (row.modsOneOf?.length) {
      out.push(plain("One of:"));
      for (const m of row.modsOneOf) out.push(plain("  " + modLabel(ctx, m)));
    }
    if (row.req?.length) {
      out.push(blank());
      out.push(plain("Requires:"));
      for (const r of row.req) out.push(plain("  " + reqLabel(ctx, r)));
    }
    out.push(blank());
    if (row.f?.potentialCost) out.push(meta("Potential Cost", row.f.potentialCost));
    if (row.f?.rarity) out.push(meta("Rarity", titleCase(row.f.rarity)));
    if (row.f?.weight != null) out.push(meta("Weight", row.f.weight));
    out.push(meta("Id", row.id));
    return out;
  },

  // ProfExpBestiary: profession name, Exp, tier, then the raw id
  prof(row) {
    const out = [title(row.f?.profession || row.name, "#55ff55")];
    out.push(blank());
    out.push(meta("Exp", row.f?.exp ?? 0));
    out.push(meta("Tier", row.f?.tier ?? 0));
    if (row.f?.type) out.push(meta("Source", titleCase(row.f.type)));
    if (row.req?.length) {
      out.push(meta("Requires", row.req.map(titleCase).join(", ")));
    }
    out.push(blank());
    out.push(meta("Id", row.id));
    return out;
  },
};

function socketable(row, ctx) {
  const out = [title(row.name, "#55ffff")];
  out.push(blank());
  for (const set of row.sets || []) {
    out.push(plain(set.label + ":", "sub"));
    out.push(...statLines(set.stats, ctx));
  }
  out.push(blank());
  if (row.f?.tier != null) out.push(meta("Tier", row.f.tier));
  if (row.f?.weight != null) out.push(meta("Weight", row.f.weight));
  out.push(meta("Id", row.id));
  return out;
}

function skillGem(row, ctx, kind) {
  const out = [title(row.name, "#55ff55")];
  const rarityName = ctx.rarity
    ? `${kind} · ${ctx.rarity.name}` : `${kind} · any rarity`;
  out.push(plain(rarityName, "sub"));
  out.push(blank());
  out.push(...statLines(row.stats, ctx));
  out.push(blank());
  if (row.f?.style) out.push(meta("Style", row.f.style));
  if (row.f?.minLvl) out.push(meta("Min Level", row.f.minLvl));
  if (row.f?.manaMulti) out.push(meta("Mana Multiplier", `${row.f.manaMulti}x`));
  if (row.f?.reservation) {
    out.push(meta("Reservation", `${Math.round(row.f.reservation * 100)}%`));
  }
  if (row.f?.weight != null) out.push(meta("Weight", row.f.weight));
  out.push(meta("Id", row.id));
  return out;
}

function costLine(label, min, max, color) {
  const value = min === max ? String(min) : `${min} - ${max}`;
  return {
    html: `<span class="k" style="color:${color}">${esc(label)}</span>`
      + `<span class="v">${esc(value)}</span>`,
    text: `${label} ${value}`, kind: "meta",
  };
}

function modLabel(ctx, id) {
  return toPlain(ctx.lang["library_of_exile.item_modification." + id]) || titleCase(id);
}

function reqLabel(ctx, id) {
  return toPlain(ctx.lang["library_of_exile.item_requirement." + id]) || titleCase(id);
}

/** Build the tooltip lines for a row. Falls back to name + id. */
export function buildTooltip(groupKey, row, ctx) {
  const builder = BUILDERS[groupKey];
  if (!builder) return [title(row.name), meta("Id", row.id)];
  return builder(row, ctx).filter(Boolean);
}

/** Flat text of a tooltip, for the "search tooltips" toggle. */
export function tooltipText(lines) {
  return lines.map((l) => l.text).filter(Boolean).join(" ").toLowerCase();
}
