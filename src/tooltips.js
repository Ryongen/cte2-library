// Building a tooltip for one entry, per group.
//
// Each builder follows the line order of that group's lambda in
// BestiaryGroup.java, so an entry reads the same here as in the wiki screen.
// A line is { html, text, kind } - kind drives styling, text feeds search.

import { toHtml, toPlain, colorOf, formatNumber } from "./mcfmt.js";
import { renderStatMod, renderExactStat, titleCase, resolveCalcs } from "./stats.js";
import { baseStatLines, gearTypesForAffix, gearTypeName } from "./gear.js";
import { SkillLevel, leveledValue } from "./scaling.js";

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

/** The same stats at one roll percent rather than as a range. */
function exactStatLines(mods, percent, ctx) {
  return (mods || []).map((m) => {
    const r = renderExactStat(m, percent, ctx.lvl, ctx.scaling, ctx.lang);
    return { html: r.html, text: r.text, kind: "stat" };
  });
}

function ticksToSeconds(ticks) {
  return `${formatNumber(ticks / 20)}s`;
}

/**
 * The roll window the rarity picker is showing, as a line of its own.
 *
 * WikiRarityButton's own tooltip prints the same window in game, and without
 * it a rarity that narrows both ends looks like it moved the numbers for no
 * reason.
 */
function rarityLabel(ctx) {
  return ctx.rarity
    ? `${ctx.rarity.name} (${ctx.rarity.pctMin}% - ${ctx.rarity.pctMax}%)`
    : "Any rarity (full range)";
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
    out.push(plain(rarityLabel(ctx), "sub"));
    out.push(blank());
    out.push(...statLines(row.stats, ctx));
    if (row.tags?.length) {
      out.push(blank());
      out.push(plain(row.f?.reqAll ? "Needs every tag:" : "Tag Requirements:", "sub"));
      out.push({
        html: row.tags.map((t) => `<span class="chip">${esc(tagName(ctx, t))}</span>`).join("")
          + (row.excl || []).map((t) =>
            `<span class="chip excl">${esc(tagName(ctx, t))}</span>`).join(""),
        text: [...row.tags, ...(row.excl || [])]
          .map((t) => `${t} ${tagName(ctx, t)}`).join(" "), kind: "chips",
      });
    }
    // the tags above are the rule; this is the rule applied. a cloth helmet
    // carries `helmet`, `cloth` and `cloth_helmet`, so three different affix
    // pools land on it and none of them is redundant
    const fits = gearTypesForAffix(row, ctx.balance.gearTypes || {});
    out.push(blank());
    if (fits.length) {
      out.push(plain("Can Roll On:", "sub"));
      out.push({
        html: fits.map((g) =>
          `<span class="chip gear">${esc(gearTypeName(ctx.balance.gearTypes, g))}</span>`).join(""),
        text: fits.map((g) =>
          `${g} ${gearTypeName(ctx.balance.gearTypes, g)}`).join(" "), kind: "chips",
      });
      out.push(blank());
    }
    if (row.f?.weight != null) out.push(meta("Weight", row.f.weight));
    out.push(meta("Id", row.id));
    if (row.f?.type) out.push(meta("Affix Type", row.f.type));
    return out;
  },

  unique_gear(row, ctx) {
    const rarity = ctx.balance.rarities?.unique;
    const gear = ctx.balance.gearTypes?.[row.f?.baseGear];
    const out = [title(row.name, colorOf(rarity?.color, "#ffaa00"))];
    if (row.f?.baseGear) {
      out.push(plain(gear?.name || titleCase(row.f.baseGear), "sub"));
    }
    // the base item comes first, the way GearTooltipUtils lays a gear out:
    // name, rarity, then BaseStatsData, then the unique's own stats. the
    // number is the base roll window the game brackets under shift, with the
    // window after the unique's own Gear's Defense / Weapon Damage in
    // parentheses - those rewrite the base numbers rather than adding a line
    // of their own, and the shift bracket is blind to them (see baseStatLines)
    const base = baseStatLines(gear, rarity, row.stats, ctx);
    if (base.length) {
      out.push(blank());
      out.push(...base);
    }
    out.push(blank());
    out.push(...statLines(row.stats, ctx));
    if (row.flavor) { out.push(blank()); out.push(plain("§o" + row.flavor, "flavor")); }
    // GearTooltipUtils accepts the set block straight after the stats, above
    // everything the item's footer says - so it sits here and not at the end
    out.push(...setLines(row, ctx));
    out.push(blank());
    if (gear?.slotName) out.push(meta("Slot", gear.slotName));
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
    // the stat line above says "Chance to Cast Soul Wound"; this says which
    // entry that is, since the stat's sentence is prose and not a link
    if (row.procs?.length) {
      out.push(blank());
      out.push(plain("Triggers: "
        + row.procs.map((id) => spellName(ctx, id)).join(", "), "sub"));
    }
    out.push(blank());
    if (row.f?.maxStacks > 1) out.push(meta("Max Stacks", row.f.maxStacks));
    if (row.f?.type) out.push(meta("Type", titleCase(row.f.type)));
    out.push(meta("Id", row.id));
    return out;
  },

  spell(row, ctx) {
    // a skill answers to two levels at once: the character's, which every
    // FLAT stat and the mana curve scale with, and the gem's own rank, which
    // decides where in each range the skill sits. `skill` is the second one
    const skill = skillLevelFor(row, ctx);
    const out = [title(row.name, "#ff5555")];
    out.push(blank());
    if (row.desc) {
      const resolved = resolveCalcs(row.desc, ctx.lvl, ctx.scaling, ctx.balance, skill);
      for (const part of resolved.split("[LINE]")) {
        if (part.trim()) out.push({
          html: toHtml("§7" + part.trim()), text: toPlain(part), kind: "desc",
        });
      }
    }
    out.push(blank());
    out.push(skillLevelLine(row, skill, ctx));
    out.push(blank());
    const c = row.cfg || {};
    // SpellStatsCalculationEvent: MANA_COST_SCALING at the caster's level
    // times the cost's own walk up the gem's ranks, then truncated to an int
    const multi = ctx.scaling.manaCostMulti(ctx.lvl);
    const mana = Math.trunc(multi * leveledValue(c.manaMin, c.manaMax, skill.lvl, skill.maxLvl));
    const ene = Math.trunc(multi * leveledValue(c.eneMin, c.eneMax, skill.lvl, skill.maxLvl));
    if (mana > 0) out.push(costLine("Mana Cost", mana, "#5555ff"));
    if (ene > 0) out.push(costLine("Energy Cost", ene, "#55ff55"));
    // a Blood Mage pays both costs out of one blood pool. Worth a line only
    // when there are two of them - on a skill with a single cost it would just
    // repeat the number above it
    if (mana > 0 && ene > 0) {
      out.push(costLine("Blood Cost (Blood Mage)", mana + ene, "#aa0000"));
    }
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
    // ProcSpellEffect keeps a triggered cast on its own cooldown key, read
    // straight off the config - neither Cast Speed nor Cooldown Reduction
    // moves it, and 0 means no limit at all. Every spell carries the field
    // and on most of them nothing ever reads it, so this asks whether
    // anything can proc this skill rather than printing the number on all
    // 309 the way the mod's shift tooltip does.
    if (row.f?.proccable) {
      out.push(meta("Proc Recharge",
        c.procCd > 0 ? ticksToSeconds(c.procCd) : "no limit"));
    }
    out.push(...effectLines(row, ctx, skill));
    if (row.stats?.length) {
      out.push(blank());
      out.push(plain(`Gem Stats at Level ${skill.lvl}:`, "sub"));
      out.push(...exactStatLines(row.stats, skill.pct, ctx));
    }
    const chips = tagChips(row.tags);
    if (chips) { out.push(blank()); out.push(chips); }
    out.push(blank());
    if (c.weapon) out.push(meta("Weapon", titleCase(c.weapon)));
    if (row.f?.minLvl) out.push(meta("Requires Level", row.f.minLvl));
    out.push(meta("Max Gem Level", `${skill.natural} (${skill.maxLvl} with gear)`));
    out.push(meta("Id", row.id));
    out.push(...procLines(row, ctx));
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
  out.push(plain(`${kind} · ${rarityLabel(ctx)}`, "sub"));
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

function costLine(label, value, color) {
  return {
    html: `<span class="k" style="color:${color}">${esc(label)}</span>`
      + `<span class="v">${esc(value)}</span>`,
    text: `${label} ${value}`, kind: "meta",
  };
}

/** The gem rank every number below is read at, and how far it can still go. */
function skillLevelLine(row, skill, ctx) {
  let value = `${skill.lvl} / ${skill.natural}`;
  if (skill.lvl > skill.natural) {
    value = `${skill.lvl} / ${skill.natural} (+${skill.lvl - skill.natural} from gear)`;
  }
  // Spell.getLevelOf hands the question to another skill when lvl_based_on_spell
  // is set - this one has no rank of its own to raise
  if (row.f?.lvlFrom) {
    const from = toPlain(ctx.lang["mmorpg.spell." + row.f.lvlFrom])
      || titleCase(row.f.lvlFrom);
    value += ` · ranked by ${from}`;
  }
  return {
    html: `<span class="k skill-lvl">Skill Level</span><span class="v">${esc(value)}</span>`,
    text: `Skill Level ${value}`, kind: "meta",
  };
}

/**
 * The status effects a skill puts up, inline.
 *
 * The mod hides these behind shift and prints only the names plus a duration;
 * this shows the stats too, because the whole point of the section is not
 * having to go and find the effect in another list. They are the same numbers
 * the effect's own entry shows, read at one point instead of as a range:
 * ExileEffect.getExactStats rolls them at `LeveledValue(0, 100)` over the
 * *casting skill's* rank, so a rank 20 buff grants 71% of its span and the
 * page would be lying if it showed the full one here.
 */
function effectLines(row, ctx, skill) {
  const applied = row.effects || [];
  if (!applied.length || !ctx.effects) return [];
  const out = [];
  for (const group of [["give", "Applies:"], ["take", "Removes:"]]) {
    const [act, label] = group;
    const some = applied.filter((e) => e.act === act && ctx.effects.get(e.id));
    if (!some.length) continue;
    out.push(blank());
    out.push(plain(label, "sub"));
    for (const ref of some) out.push(...effectEntry(ref, ctx, skill, act));
  }
  return out;
}

function effectEntry(ref, ctx, skill, act) {
  const effect = ctx.effects.get(ref.id);
  const color = effect.f?.type === "negative" ? "#ff5555" : "#55ff55";
  const notes = [];
  if (act === "give") {
    notes.push(ref.self ? "on self" : "on target");
    if (ref.dur > 0) notes.push(ticksToSeconds(ref.dur));
    else if (ref.dur < 0) notes.push("permanent");
    if (ref.count > 1) notes.push(`${ref.count} stacks`);
    if (effect.f?.maxStacks > 1) notes.push(`stacks to ${effect.f.maxStacks}`);
  } else {
    notes.push(ref.all ? "all stacks"
      : ref.count > 1 ? `${ref.count} stacks` : "1 stack");
  }
  if (ref.chance != null) notes.push(`${Math.round(ref.chance)}% chance`);

  const head = {
    html: `<span class="eff-name" style="color:${color}">${esc(effect.name)}</span>`
      + (notes.length ? `<span class="eff-note">${esc(notes.join(" · "))}</span>` : ""),
    text: `${effect.name} ${notes.join(" ")}`, kind: "eff",
  };
  if (act === "take") return [head];
  return [head, ...exactStatLines(effect.stats, skill.pct, ctx)
    .map((l) => ({ ...l, kind: "stat sub-stat" }))];
}

/**
 * The gear set this unique belongs to, drawn under its own stats.
 *
 * ItemSet.getTooltip's shape, minus the one thing a wiki page cannot know:
 * how many pieces are being worn. The mod prints "Oath of Mahj (2/4)" and
 * colours each tier green once you reach it, grey while you have not; here
 * every tier is potential, so the header counts the whole set and each tier
 * keeps its piece count in front of it.
 *
 * The numbers are not a range and the rarity picker does not touch them:
 * SetBonus.getStats asks for 100% every time. Only the level moves them, and
 * only the FLAT ones, like everywhere else.
 *
 * The other pieces are rows of this same group, so each is a button - the
 * whole point of listing them is not having to search for the next one.
 */
function setLines(row, ctx) {
  const set = ctx.balance.itemSets?.[row.setId];
  if (!set) return [];
  const size = set.uniques.length;
  const out = [blank(), {
    html: `<span class="eff-name set-name">${esc(set.name)}</span>`
      + `<span class="eff-note">set · ${size} pieces</span>`,
    text: `${set.name} set ${size} pieces`, kind: "eff set",
  }];
  for (const id of set.uniques) {
    const piece = ctx.uniques?.get(id);
    const name = piece?.name || titleCase(id);
    // a link only where there is a row to land on: the piece being looked at
    // is already here, and a member the group does not hold would go nowhere
    const here = id === row.id;
    out.push({
      html: here || !piece
        ? `<span class="set-piece here">${esc(name)}</span>`
          + (here ? `<span class="eff-note">this item</span>` : "")
        : `<button type="button" class="set-piece proc-link" `
          + `data-entry="${esc(id)}">${esc(name)}</button>`,
      text: here ? `${name} this item` : name, kind: "set-piece",
    });
  }
  // cumulative: every tier at or below what you wear applies, so a 4-piece
  // set hands you the 2, 3 and 4 lines at once
  for (const bonus of set.bonuses) {
    for (const line of exactStatLines(bonus.stats, 100, ctx)) {
      out.push({
        html: `<span class="set-tier">(${esc(bonus.pieces)})</span>` + line.html,
        text: `(${bonus.pieces}) ${line.text}`, kind: "stat set-bonus",
      });
    }
  }
  return out;
}

/**
 * A skill's rank, following `lvl_based_on_spell` to whichever skill owns it.
 *
 * Spell.getLevelOf hands the question straight to the other spell - Soul Wound
 * has no rank of its own, Banishing Blade's rank *is* its rank - while
 * Spell.getStats still divides by *this* spell's ceiling. So the two halves of
 * one percent come from two rows and only the level is borrowed. The pack's 17
 * pairs happen to share a max_lvl, so nothing moves today; the borrowed rank is
 * clamped to this skill's own ceiling in case one ever stops sharing it.
 */
function skillLevelFor(row, ctx) {
  const from = row.f?.lvlFrom ? ctx.spells?.get(row.f.lvlFrom) : null;
  // Spell.getLevelOf's own guard against a pair pointing at each other
  if (!from || from.f?.lvlFrom === row.f.lvlFrom) {
    return new SkillLevel(row, ctx.scaling, ctx.skillLvl);
  }
  const source = new SkillLevel(from, ctx.scaling, ctx.skillLvl);
  return new SkillLevel(row, ctx.scaling, source.lvl);
}

/**
 * The skills this one sets off, drawn under it.
 *
 * The wiki screen draws none of this, and the chain it skips is three hops
 * long: Banishing Blade grants the Banishing Blade buff, the buff carries
 * `proc_soul_wound`, and that stat casts the Soul Wound skill. The buff's own
 * line says "80% Chance to Cast Soul Wound" and then leaves you to find Soul
 * Wound in a list of three hundred - which is the whole reason its numbers are
 * worth inlining here rather than named and linked.
 *
 * Deliberately one level deep. A triggered skill can carry a proc stat of its
 * own, and following those would nest a tooltip inside a tooltip; the name is
 * a button, so the next hop is a click.
 */
function procLines(row, ctx) {
  if (!ctx.spells) return [];
  // a skill is not news to itself - Cinder's buff procs Cinder
  const seen = new Set([row.id]);
  const found = [];
  const add = (id, via) => {
    const spell = ctx.spells.get(id);
    if (!spell || seen.has(id)) return;
    seen.add(id);
    found.push({ spell, via });
  };
  for (const id of row.procs || []) add(id, null);
  for (const ref of row.effects || []) {
    // only what the skill grants: removing a buff does not hand you its procs
    if (ref.act !== "give") continue;
    const effect = ctx.effects?.get(ref.id);
    for (const id of effect?.procs || []) {
      // a buff is routinely named for the skill it casts - Chilling Touch's
      // buff is "Splinter" and it casts Splinter. "via Splinter" under the
      // heading "Splinter" says nothing, so only a real second name is kept
      const spell = ctx.spells.get(id);
      add(id, spell && spell.name === effect.name ? null : effect.name);
    }
  }
  if (!found.length) return [];
  const out = [blank(), plain("Triggers:", "sub")];
  for (const { spell, via } of found) out.push(...procEntry(spell, via, ctx));
  return out;
}

function procEntry(spell, via, ctx) {
  const rank = skillLevelFor(spell, ctx);
  const cd = spell.cfg?.procCd ?? 0;
  const notes = [];
  if (via) notes.push("via " + via);
  notes.push(`Skill Level ${rank.lvl}`);
  notes.push(cd > 0 ? `every ${ticksToSeconds(cd)}` : "no proc cooldown");

  const out = [{
    html: `<button type="button" class="eff-name proc-link" `
      + `data-entry="${esc(spell.id)}">${esc(spell.name)}</button>`
      + `<span class="eff-note">${esc(notes.join(" · "))}</span>`,
    text: `${spell.name} ${notes.join(" ")}`, kind: "eff proc",
  }];
  if (spell.desc) {
    const resolved = resolveCalcs(spell.desc, ctx.lvl, ctx.scaling, ctx.balance, rank);
    for (const part of resolved.split("[LINE]")) {
      if (part.trim()) {
        out.push({
          html: toHtml("§7" + part.trim()), text: toPlain(part),
          kind: "desc proc-body",
        });
      }
    }
  }
  out.push(...exactStatLines(spell.stats, rank.pct, ctx)
    .map((l) => ({ ...l, kind: "stat proc-body" })));
  return out;
}

/** A skill's display name, for the groups that only hold its id. */
function spellName(ctx, id) {
  return toPlain(ctx.lang["mmorpg.spell." + id]) || titleCase(id);
}

/** A slot tag's display name: `mmorpg.tag.gear_slot.<tag>`. */
function tagName(ctx, id) {
  return toPlain(ctx.lang["mmorpg.tag.gear_slot." + id]) || titleCase(id);
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
