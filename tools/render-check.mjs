// Render sample tooltips headlessly, to compare against the in-game wiki.
//
//   node tools/render-check.mjs [version] [level] [locale]
//
// Prints the same lines the page would draw, as plain text. This is the check
// that catches a scaling or percent mistake - a wrong stat meta shows up here
// as a number that does not match what the game prints at the same level.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Scaling } from "../src/scaling.js";
import { buildTooltip } from "../src/tooltips.js";
import { setUiLocale } from "../src/ui.js";
import { mergePatch, patchRows } from "../src/data.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2] || readdirSync(join(REPO, "data"))
  .filter((d) => /^\d/.test(d)).sort().pop();
const lvl = Number(process.argv[3] || 1);
// a data/<version>/lang/ file name, e.g. zh_cn - applied the way the page does
const locale = process.argv[4] || null;

const readRaw = (...p) => JSON.parse(readFileSync(join(REPO, "data", version, ...p), "utf8"));
const overlay = locale ? readRaw("lang", `${locale}.json`) : null;
const read = (...p) => {
  const obj = readRaw(...p);
  if (overlay && p[0] === "groups") patchRows(obj.rows, overlay.groups[obj.group]);
  return obj;
};
const lang = { ...readRaw("lang.json"), ...(overlay?.lang || {}) };
const balance = readRaw("balance.json");
if (overlay) mergePatch(balance, overlay.balance || {});
const scaling = new Scaling(balance);
// a skill's tooltip shows the effects it puts up, which live in their own group
const effects = new Map(read("groups", "effect.json").rows.map((r) => [r.id, r]));
// and the skills it triggers, which are rows of the spell group itself
const spells = new Map(read("groups", "spell.json").rows.map((r) => [r.id, r]));
// a unique in a gear set names the other pieces, which are rows of its own group
const uniques = new Map(read("groups", "unique_gear.json").rows.map((r) => [r.id, r]));
// null skillLvl is "each skill at its own natural max", the page's default
const translated = overlay?.lang || {};
// the tooltip labels come from the same table as the page chrome
setUiLocale(locale, translated);
const ctx = { lvl, lang, translated, balance, scaling, effects, spells, uniques, skillLvl: null };

// one representative entry per group, plus extra affixes since they are the
// most numerous and the most formula-sensitive
const SAMPLES = [
  ["affix", 5], ["unique_gear", 2], ["runeword", 1], ["rune", 1],
  ["gem", 1], ["supp_gem", 2], ["aura", 1], ["effect", 1],
  ["spell", 2], ["currency", 1], ["prof", 1],
];

console.log(`version ${version}  level ${lvl}${locale ? "  " + locale : ""}\n`);

for (const [group, n] of SAMPLES) {
  const rows = read("groups", `${group}.json`).rows;
  console.log(`${"=".repeat(60)}\n${group}  (${rows.length} entries)`);
  const step = Math.max(1, Math.floor(rows.length / (n + 1)));
  for (let i = 0; i < n; i += 1) {
    const row = rows[Math.min((i + 1) * step, rows.length - 1)];
    if (!row) continue;
    console.log(`\n-- ${row.name}  [${row.id}]`);
    for (const line of buildTooltip(group, row, ctx)) {
      if (line.kind === "blank") console.log("");
      else console.log("   " + line.text);
    }
  }
  console.log("");
}
