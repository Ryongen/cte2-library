// The wiki screen, as a web page.
//
// Mirrors NewWikiScreen's widget set: a group rail, a level box, a rarity
// picker on the groups that have one, per-group filters, a search box with a
// "search tooltips" toggle, and the entry list. Selecting an entry shows its
// tooltip, built at the level currently in the box.

import { loadVersions, loadVersion, loadGroup, iconUrl } from "./data.js";
import { Scaling, SkillLevel, MIN_LEVEL } from "./scaling.js";
import { buildTooltip, tooltipText } from "./tooltips.js";
import { titleCase } from "./stats.js";
import { indexAffixGear, gearTypeName } from "./gear.js";

const GROUPS = [
  ["currency", "Currency", "currency"],
  ["affix", "Affixes", "affix"],
  ["gem", "Gems", "gem"],
  ["rune", "Runes", "rune"],
  ["unique_gear", "Unique Gear", "unique_gear"],
  ["runeword", "Runewords", "runeword"],
  ["aura", "Auras", "aura"],
  ["supp_gem", "Support Gems", "supp_gem"],
  ["effect", "Status Effects", "effect"],
  ["spell", "Spells", "spell"],
  ["prof", "Profession EXP", "prof"],
];

// BestiaryGroup.hasRarityPicker is set on the two gem groups alone, but an
// affix rolls its percent in the very same window: AffixData.getMinMax is the
// gear rarity's `stat_percents`, which is what SkillGemBlueprint rolls a gem's
// perc in. So the picker rides on affixes here too - "Any" is the affix's whole
// span, the way the group has always read, and picking a rarity narrows it to
// what that tier can actually roll.
const RARITY_GROUPS = new Set(["affix", "aura", "supp_gem"]);

// which filter dimensions each group offers, and how to label them
// `gear` is the resolved list - which base items an affix can actually roll
// on, the way GroupFilterType.AFFIX_SLOTS works. `slot` is the raw tag rule
// behind it, kept because several affix pools overlap on one item and the tag
// is the only way to ask for one of them.
// `cat` is the site's own grouping over the base items - "Any Chest", "Any
// Two-Handed Weapon" - built in build_gear_categories and shipped on every
// gear type. It rides alongside `gear`/`slot` rather than replacing them,
// because the exact base item is still the question half the time.
const FILTERS = {
  affix: [["type", "Affix Type"], ["cat", "Category"],
          ["gear", "Base Item"], ["slot", "Tag"]],
  unique_gear: [["cat", "Category"], ["slot", "Base Item"],
                ["set", "Set"], ["league", "League"]],
  runeword: [["cat", "Category"], ["runeCount", "Rune Count"], ["slot", "Slot"]],
  spell: [["cls", "Class"], ["tag", "Tag"], ["style", "Style"]],
  effect: [["type", "Type"], ["tag", "Tag"]],
  supp_gem: [["style", "Style"]],
  aura: [["style", "Style"]],
  gem: [["gemType", "Gem Type"], ["tier", "Tier"]],
  rune: [["tier", "Tier"]],
  currency: [["rarity", "Rarity"]],
  prof: [["profession", "Profession"], ["tier", "Tier"]],
};

const state = {
  versions: [],
  version: null,
  scaling: null,
  group: "unique_gear",
  rows: [],
  filtered: [],
  selected: null,
  lvl: MIN_LEVEL,
  // a skill gem's own rank. null means "whatever this skill's natural max is",
  // which is the answer people actually want and is per-entry, so it cannot be
  // a number in the box until someone types one
  skillLvl: null,
  effects: null,        // id -> status effect row, for the skills that grant one
  spells: null,         // id -> spell row, for the skills a skill triggers
  uniques: null,        // id -> unique row, for naming the pieces of a set
  cats: null,           // gear category key -> {name, order}
  rarity: null,
  search: "",
  searchTooltips: false,
  filters: {},          // dim -> Set(values)
  tooltipCache: new WeakMap(),
};

const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------------ boot

async function boot() {
  state.versions = await loadVersions();
  if (!state.versions.length) {
    $("#list").innerHTML = '<p class="empty">No data yet. Run tools/extract.py.</p>';
    return;
  }
  const params = new URLSearchParams(location.search);
  const wanted = params.get("v");
  const pick = state.versions.find((v) => v.pack === wanted)
    || state.versions.find((v) => v.pack === localStorage.getItem("cte2.version"))
    || state.versions[0];

  if (params.get("g")) state.group = params.get("g");
  const lvl = parseInt(params.get("lvl"), 10);
  if (Number.isFinite(lvl)) state.lvl = lvl;
  const slvl = parseInt(params.get("slvl"), 10);
  if (Number.isFinite(slvl)) state.skillLvl = slvl;
  // checked against the version's own picker once that has loaded, below
  if (params.get("r")) state.rarity = params.get("r");

  renderVersionPicker();
  renderGroupRail();
  await selectVersion(pick.pack, params.get("id"));
  wireControls();
}

async function selectVersion(pack, selectId) {
  state.version = await loadVersion(pack);
  state.scaling = new Scaling(state.version.balance);
  state.effects = null;
  state.spells = null;
  state.uniques = null;
  state.cats = new Map((state.version.balance.gearCategories || [])
    .map((c) => [c.key, c]));
  state.lvl = clampLevel(state.lvl);
  state.rarity = pickableRarity(state.rarity);
  localStorage.setItem("cte2.version", pack);
  $("#version").value = pack;
  $("#level").max = String(state.scaling.maxLevel);
  $("#level").value = String(state.lvl);
  renderGroupRail();
  await selectGroup(state.group, selectId);
}

function clampLevel(lvl) {
  const max = state.scaling?.maxLevel || 100;
  if (!Number.isFinite(lvl)) return MIN_LEVEL;
  return Math.min(Math.max(lvl, MIN_LEVEL), max);
}

// A rarity id off the url means something only if this version's picker offers
// it: the ids are the pack's own, and one it does not ship would sit in the
// select as a pick that matches nothing and narrows nothing. "Any" is the
// honest fallback, and it is the default anyway.
function pickableRarity(rid) {
  if (!rid) return null;
  const picks = state.version?.balance?.pickableRarities || [];
  return picks.includes(rid) ? rid : null;
}

async function selectGroup(key, selectId) {
  if (!GROUPS.some(([k]) => k === key)) key = "unique_gear";
  state.group = key;
  state.filters = {};
  state.selected = null;
  state.tooltipCache = new WeakMap();

  const group = await loadGroup(state.version, key);
  state.rows = group.rows || [];
  // the affix -> base item mapping is a join across two files, so it is done
  // once here rather than per row on every keystroke
  if (key === "affix") indexAffixGear(state.rows, state.version.balance.gearTypes);
  // a skill shows the buff it puts up, and the effect rows are where those
  // stats live - one extra fetch for the one group that needs it, rather than
  // a copy of every effect baked into every skill that grants it
  if (key === "spell" && !state.effects) {
    const effects = await loadGroup(state.version, "effect");
    state.effects = new Map((effects.rows || []).map((r) => [r.id, r]));
  }
  // a skill also draws the skills it triggers, and those are rows of this
  // same group - so this is an index of what is already loaded, not a fetch
  if (key === "spell") state.spells = new Map(state.rows.map((r) => [r.id, r]));
  // a unique in a set names its siblings, and they are rows of this same
  // group - an index of what is already loaded, not a fetch
  if (key === "unique_gear") {
    state.uniques = new Map(state.rows.map((r) => [r.id, r]));
  }
  renderGroupRail();
  renderFilters();
  applyFilter();

  // land on something rather than an empty pane - a deep-linked entry if the
  // url named one, otherwise the first row so the tooltip is never blank
  const wanted = selectId && state.rows.find((r) => r.id === selectId);
  const row = wanted || state.filtered[0];
  if (row) select(row, { scroll: Boolean(wanted) });
  else { renderSkillLevel(); renderTooltip(); }
  syncUrl();
}

// ------------------------------------------------------------------ render

function renderVersionPicker() {
  const sel = $("#version");
  sel.innerHTML = state.versions
    .map((v) => `<option value="${v.pack}">${v.pack}</option>`).join("");
}

function renderGroupRail() {
  const counts = state.version?.meta?.counts || {};
  $("#rail").innerHTML = GROUPS.map(([key, label, icon]) => `
    <button class="grp${key === state.group ? " on" : ""}" data-group="${key}">
      <img src="${iconUrl("group", icon + ".png")}" alt="" width="20" height="20">
      <span class="lbl">${label}</span>
      <span class="n">${counts[key] ?? ""}</span>
    </button>`).join("");
}

function renderRarityPicker() {
  const host = $("#rarity");
  if (!RARITY_GROUPS.has(state.group)) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const picks = state.version.balance.pickableRarities || [];
  const rarities = state.version.balance.rarities || {};
  host.innerHTML = `<span>Rarity</span><select id="rarity-sel">
    <option value="">Any (full range)</option>
    ${picks.map((rid) => `<option value="${esc(rid)}"${
      rid === state.rarity ? " selected" : ""}>${esc(rarities[rid]?.name || rid)}</option>`).join("")}
  </select>`;
}

/**
 * The skill-level box, for the one group whose entries have a level of their
 * own. Its max is the *selected* skill's ceiling, because that is per entry -
 * a stance caps at 4 (12 with gear) where a spell caps at 20 (28). The typed
 * value is kept across selections and clamped for display, so stepping through
 * a class's skills at "rank 20" does not silently reset to something else.
 */
function renderSkillLevel() {
  const host = $("#skill-ctl");
  const box = $("#skill-level");
  if (state.group !== "spell") { host.hidden = true; return; }
  host.hidden = false;
  const skill = state.selected
    ? new SkillLevel(state.selected, state.scaling, state.skillLvl) : null;
  box.max = skill ? String(skill.maxLvl) : "";
  box.placeholder = skill ? `max ${skill.natural}` : "max";
  box.value = state.skillLvl == null ? "" : String(skill ? skill.lvl : state.skillLvl);
}

function renderFilters() {
  renderRarityPicker();
  const dims = FILTERS[state.group] || [];
  const host = $("#filters");
  if (!dims.length) { host.innerHTML = ""; return; }

  host.innerHTML = dims.map(([dim, label]) => {
    const values = new Set();
    for (const row of state.rows) {
      for (const v of row.filters?.[dim] || []) if (v) values.add(v);
    }
    if (!values.size) return "";
    const opts = [...values]
      .map((v) => [v, filterLabel(dim, v), filterOrder(dim, v)])
      .sort((a, b) => a[2] - b[2] || a[1].localeCompare(b[1]))
      .map(([v, text]) =>
        `<option value="${esc(v)}">${esc(text)}</option>`).join("");
    return `<label class="filter"><span>${label}</span>
      <select data-dim="${dim}"><option value="">Any</option>${opts}</select>
    </label>`;
  }).join("");
}

/**
 * A dimension's own ordering, where the data carries one.
 *
 * Class is the only dimension that does: the pack numbers its spell folders
 * (`0_1_brawler` ... `3_1_wizard`), which puts the twelve player classes ahead
 * of gear spells, summons and mercenaries. Alphabetical would interleave them.
 */
function filterOrder(dim, value) {
  if (dim === "cat") return state.cats?.get(value)?.order ?? 0;
  if (dim !== "cls") return 0;
  return state.version?.balance?.spellClasses?.[value]?.order ?? 0;
}

/** A filter value's display text - ids that lang can name, get named. */
function filterLabel(dim, value) {
  const balance = state.version?.balance;
  if (dim === "cls") {
    return balance?.spellClasses?.[value]?.name || titleCase(value);
  }
  if (dim === "cat") return state.cats?.get(value)?.name || titleCase(value);
  if (dim === "set") return balance?.itemSets?.[value]?.name || titleCase(value);
  if (dim === "gear" || (dim === "slot" && state.group === "unique_gear")) {
    return gearTypeName(balance?.gearTypes, value);
  }
  if (dim === "slot" && state.group === "affix") {
    const text = balance && state.version.lang["mmorpg.tag.gear_slot." + value];
    if (text) return text;
  }
  return titleCase(value);
}

function matches(row) {
  for (const [dim, set] of Object.entries(state.filters)) {
    if (!set || !set.size) continue;
    const have = row.filters?.[dim] || [];
    // same dimension is OR, different dimensions AND - the game's GearSlot rule
    if (!have.some((v) => set.has(v))) return false;
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    const inName = row.name.toLowerCase().includes(q) || row.id.includes(q);
    if (inName) return true;
    if (!state.searchTooltips) return false;
    return tooltipFor(row).text.includes(q);
  }
  return true;
}

function applyFilter() {
  state.filtered = state.rows.filter(matches);
  renderList();
}

function renderList() {
  const host = $("#list");
  $("#count").textContent =
    `${state.filtered.length} of ${state.rows.length}`;
  if (!state.filtered.length) {
    host.innerHTML = '<p class="empty">Nothing matches.</p>';
    return;
  }
  const icon = GROUPS.find(([k]) => k === state.group)?.[2];
  host.innerHTML = state.filtered.map((row, i) => {
    const src = state.group === "spell"
      ? iconUrl("spell", row.id + ".png") : iconUrl("group", icon + ".png");
    return `<button class="row${row === state.selected ? " on" : ""}" data-i="${i}">
      <img src="${src}" alt="" width="18" height="18" loading="lazy"
           onerror="this.src='${iconUrl("group", icon + ".png")}'">
      <span class="nm">${esc(row.name)}</span>
      <span class="id">${esc(row.id)}</span>
    </button>`;
  }).join("");
}

function currentRarity() {
  if (!state.rarity || !RARITY_GROUPS.has(state.group)) return null;
  return state.version.balance.rarities?.[state.rarity] || null;
}

function tooltipFor(row) {
  const stamp = `${state.lvl}|${state.rarity || ""}|${state.skillLvl ?? ""}`;
  let entry = state.tooltipCache.get(row);
  if (entry && entry.stamp === stamp) return entry;
  const lines = buildTooltip(state.group, row, {
    lvl: state.lvl,
    lang: state.version.lang,
    balance: state.version.balance,
    scaling: state.scaling,
    rarity: currentRarity(),
    skillLvl: state.skillLvl,
    effects: state.effects,
    spells: state.spells,
    uniques: state.uniques,
  });
  entry = { stamp, lines, text: tooltipText(lines) };
  state.tooltipCache.set(row, entry);
  return entry;
}

function select(row, { scroll = false } = {}) {
  state.selected = row;
  renderList();
  renderSkillLevel();
  renderTooltip();
  if (scroll) {
    // a deep-linked entry can be thousands of rows down; put it on screen
    const i = state.filtered.indexOf(row);
    if (i >= 0) {
      $("#list").querySelector(`[data-i="${i}"]`)
        ?.scrollIntoView({ block: "center" });
    }
  }
  syncUrl();
}

function renderTooltip() {
  const host = $("#tip");
  if (!state.selected) {
    host.innerHTML = '<p class="empty">Pick an entry.</p>';
    return;
  }
  const { lines } = tooltipFor(state.selected);
  host.innerHTML = `<div class="tooltip">${lines.map((l) => (
    l.kind === "blank" ? '<div class="sp"></div>'
      : `<div class="tl ${l.kind}">${l.html}</div>`
  )).join("")}</div>`;
}

// ------------------------------------------------------------------ events

function wireControls() {
  $("#rail").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-group]");
    if (btn) selectGroup(btn.dataset.group);
  });

  $("#list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-i]");
    if (btn) select(state.filtered[Number(btn.dataset.i)]);
  });

  // an entry the tooltip names - the skill this one triggers, the other pieces
  // of a set - is one hop away and already a row of the current group, so this
  // is a selection and not a navigation
  $("#tip").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-entry]");
    if (!btn) return;
    const row = state.rows.find((r) => r.id === btn.dataset.entry);
    if (row) select(row, { scroll: true });
  });

  $("#filters").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-dim]");
    if (!sel) return;
    const set = new Set();
    if (sel.value) set.add(sel.value);
    state.filters[sel.dataset.dim] = set;
    applyFilter();
  });

  $("#rarity").addEventListener("change", (e) => {
    if (e.target.id !== "rarity-sel") return;
    state.rarity = e.target.value || null;
    state.tooltipCache = new WeakMap();
    renderTooltip();
    if (state.search && state.searchTooltips) applyFilter();
    syncUrl();
  });

  $("#search").addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    applyFilter();
  });

  $("#search-tips").addEventListener("change", (e) => {
    state.searchTooltips = e.target.checked;
    if (state.search) applyFilter();
  });

  $("#level").addEventListener("input", (e) => {
    state.lvl = clampLevel(parseInt(e.target.value, 10));
    state.tooltipCache = new WeakMap();
    renderTooltip();
    if (state.search && state.searchTooltips) applyFilter();
    syncUrl();
  });

  $("#skill-level").addEventListener("input", (e) => {
    // an empty box is not zero - it means "this skill's natural max", which is
    // a different number for every entry and so cannot be typed once
    const v = parseInt(e.target.value, 10);
    state.skillLvl = Number.isFinite(v) ? Math.max(v, 0) : null;
    state.tooltipCache = new WeakMap();
    renderTooltip();
    if (state.search && state.searchTooltips) applyFilter();
    syncUrl();
  });

  $("#version").addEventListener("change", (e) => selectVersion(e.target.value));
}

function syncUrl() {
  const p = new URLSearchParams();
  p.set("v", state.version.pack);
  p.set("g", state.group);
  if (state.lvl !== MIN_LEVEL) p.set("lvl", String(state.lvl));
  if (state.skillLvl != null) p.set("slvl", String(state.skillLvl));
  if (state.rarity) p.set("r", state.rarity);
  if (state.selected) p.set("id", state.selected.id);
  history.replaceState(null, "", `?${p}`);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

boot().catch((err) => {
  document.querySelector("#list").innerHTML =
    `<p class="empty">Failed to load: ${esc(err.message)}</p>`;
  console.error(err);
});
