// scratch probe: print one tooltip
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Scaling } from "../src/scaling.js";
import { buildTooltip } from "../src/tooltips.js";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const v = "2.1.4";
const read = (...p) => JSON.parse(readFileSync(join(REPO, "data", v, ...p), "utf8"));
const lang = read("lang.json"), balance = read("balance.json");
const scaling = new Scaling(balance);
const effects = new Map(read("groups", "effect.json").rows.map((r) => [r.id, r]));
const spellRows = read("groups", "spell.json").rows;
const spells = new Map(spellRows.map((r) => [r.id, r]));
const lvl = Number(process.argv[3] || 100);
const slvl = process.argv[4] ? Number(process.argv[4]) : null;
const ctx = { lvl, lang, balance, scaling, effects, spells, skillLvl: slvl };
const group = process.argv[5] || "spell";
const rows = group === "spell" ? spellRows : read("groups", `${group}.json`).rows;
const row = rows.find((r) => r.id === process.argv[2]);
for (const line of buildTooltip(group, row, ctx)) {
  console.log(line.kind === "blank" ? "" : `[${line.kind}] ${line.text}`);
}
