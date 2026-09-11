// The wiki screen, as a web page.
//
// Mirrors NewWikiScreen's widget set: a group rail, a level box, a rarity
// picker on the groups that have one, per-group filters, a search box with a
// "search tooltips" toggle, and the entry list. Selecting an entry shows its
// tooltip, built at the level currently in the box.

import { loadVersions, loadVersion, loadGroup, iconUrl } from "./data.js";
import { Scaling, MIN_LEVEL } from "./scaling.js";
import { buildTooltip, tooltipText } from "./tooltips.js";
import { titleCase } from "./stats.js";

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
const FILTERS = {
  affix: [["type", "Affix Type"], ["slot", "Applies To"]],
  unique_gear: [["slot", "Slot"], ["league", "League"]],
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

  renderVersionPicker();
  renderGroupRail();
  await selectVersion(pick.pack, params.get("id"));
  wireControls();
}

async function selectVersion(pack, selectId) {
  state.version = await loadVersion(pack);
  state.scaling = new Scaling(state.version.balance);
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
  renderGroupRail();
  renderFilters();
  applyFilter();

  // land on something rather than an empty pane - a deep-linked entry if the
  // url named one, otherwise the first row so the tooltip is never blank
  const wanted = selectId && state.rows.find((r) => r.id === selectId);
  const row = wanted || state.filtered[0];
  if (row) select(row, { scroll: Boolean(wanted) });
  else renderTooltip();
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
    const opts = [...values].sort().map((v) =>
      `<option value="${esc(v)}">${esc(titleCase(v))}</option>`).join("");
    return `<label class="filter"><span>${label}</span>
      <select data-dim="${dim}"><option value="">Any</option>${opts}</select>
    </label>`;
  }).join("");
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
  const stamp = `${state.lvl}|${state.rarity || ""}`;
  let entry = state.tooltipCache.get(row);
  if (entry && entry.stamp === stamp) return entry;
  const lines = buildTooltip(state.group, row, {
    lvl: state.lvl,
    lang: state.version.lang,
    balance: state.version.balance,
    scaling: state.scaling,
    rarity: currentRarity(),
  });
  entry = { stamp, lines, text: tooltipText(lines) };
  state.tooltipCache.set(row, entry);
  return entry;
}

function select(row, { scroll = false } = {}) {
  state.selected = row;
  renderList();
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

  $("#version").addEventListener("change", (e) => selectVersion(e.target.value));
}

function syncUrl() {
  const p = new URLSearchParams();
  p.set("v", state.version.pack);
  p.set("g", state.group);
  if (state.lvl !== MIN_LEVEL) p.set("lvl", String(state.lvl));
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
