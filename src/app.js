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

// BestiaryGroup.hasRarityPicker - only the skill gems roll a rarity
const RARITY_GROUPS = new Set(["aura", "supp_gem"]);

// which filter dimensions each group offers, and how to label them
// `gear` is the resolved list - which base items an affix can actually roll
// on, the way GroupFilterType.AFFIX_SLOTS works. `slot` is the raw tag rule
// behind it, kept because several affix pools overlap on one item and the tag
// is the only way to ask for one of them.
const FILTERS = {
  affix: [["type", "Affix Type"], ["gear", "Base Item"], ["slot", "Tag"]],
  unique_gear: [["slot", "Base Item"], ["league", "League"]],
  runeword: [["runeCount", "Rune Count"], ["slot", "Slot"]],
  spell: [["tag", "Tag"], ["style", "Style"]],
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

  renderVersionPicker();
  renderGroupRail();
  await selectVersion(pick.pack, params.get("id"));
  wireControls();
}

async function selectVersion(pack, selectId) {
  state.version = await loadVersion(pack);
  state.scaling = new Scaling(state.version.balance);
  state.effects = null;
  state.lvl = clampLevel(state.lvl);
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
      .map((v) => [v, filterLabel(dim, v)])
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([v, text]) =>
        `<option value="${esc(v)}">${esc(text)}</option>`).join("");
    return `<label class="filter"><span>${label}</span>
      <select data-dim="${dim}"><option value="">Any</option>${opts}</select>
    </label>`;
  }).join("");
}

/** A filter value's display text - ids that lang can name, get named. */
function filterLabel(dim, value) {
  const balance = state.version?.balance;
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
