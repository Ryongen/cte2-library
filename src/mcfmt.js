// Minecraft text formatting, rendered as HTML.
//
// The mod writes its stat and spell text as Minecraft-formatted strings -
// section-sign colour codes plus Enlighten's [label](glossary-link) markup -
// and the in-game tooltip is just that string drawn by the font renderer.
// Reproducing both here is what makes the web tooltips look like the game's.

const SECTION = "§";

// vanilla ChatFormatting, by code and by name (the data uses names too)
export const COLORS = {
  "0": "#000000", "1": "#0000aa", "2": "#00aa00", "3": "#00aaaa",
  "4": "#aa0000", "5": "#aa00aa", "6": "#ffaa00", "7": "#aaaaaa",
  "8": "#555555", "9": "#5555ff", a: "#55ff55", b: "#55ffff",
  c: "#ff5555", d: "#ff55ff", e: "#ffff55", f: "#ffffff",
};

const NAMED = {
  black: "0", dark_blue: "1", dark_green: "2", dark_aqua: "3",
  dark_red: "4", dark_purple: "5", gold: "6", gray: "7", grey: "7",
  dark_gray: "8", dark_grey: "8", blue: "9", green: "a", aqua: "b",
  red: "c", light_purple: "d", yellow: "e", white: "f",
};

const STYLES = { l: "bold", o: "italic", n: "underline", m: "strike", k: "obf" };

/** A ChatFormatting name (as the data stores it) to a CSS colour. */
export function colorOf(name, fallback = "#aaaaaa") {
  if (!name) return fallback;
  const code = NAMED[String(name).toLowerCase()];
  return code ? COLORS[code] : fallback;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/**
 * Render a Minecraft-formatted string as HTML.
 *
 * Codes are sticky until reset, the way the font renderer treats them, so a
 * span stays open across the rest of the line rather than wrapping one word.
 */
export function toHtml(text, { baseColor = "#aaaaaa" } = {}) {
  if (text == null) return "";
  const src = stripLinks(String(text));
  let html = "";
  let open = 0;
  let color = null;
  let styles = new Set();

  const openSpan = () => {
    const css = [];
    css.push(`color:${color || baseColor}`);
    if (styles.has("l")) css.push("font-weight:700");
    if (styles.has("o")) css.push("font-style:italic");
    const deco = [];
    if (styles.has("n")) deco.push("underline");
    if (styles.has("m")) deco.push("line-through");
    if (deco.length) css.push(`text-decoration:${deco.join(" ")}`);
    html += `<span style="${css.join(";")}">`;
    open += 1;
  };
  const closeAll = () => {
    while (open > 0) { html += "</span>"; open -= 1; }
  };

  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    if (!open) openSpan();
    html += escapeHtml(buffer);
    buffer = "";
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch !== SECTION || i + 1 >= src.length) { buffer += ch; continue; }
    const code = src[i + 1].toLowerCase();
    i += 1;
    if (code === "r") {
      flush(); closeAll(); color = null; styles = new Set();
    } else if (COLORS[code]) {
      // a colour code also clears styles, same as the font renderer
      flush(); closeAll(); color = COLORS[code]; styles = new Set();
    } else if (STYLES[code]) {
      flush(); closeAll(); styles.add(code);
    }
    // unknown codes are dropped, which is what the renderer does
  }
  flush();
  closeAll();
  return html;
}

/** Enlighten glossary markup: `[Attack Speed](attack_speed)` -> `Attack Speed`. */
export function stripLinks(text) {
  return String(text ?? "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/** Plain text with every code and link removed - for search and sorting. */
export function toPlain(text) {
  return stripLinks(String(text ?? "")).replace(
    new RegExp(SECTION + ".", "g"), "").trim();
}

/**
 * MMORPG.formatNumber: two decimals below 15, truncated to an integer above.
 * Matching this exactly is what keeps a range reading `0.30 -> 1.50` rather
 * than `0.3 -> 1.5`.
 */
export function formatNumber(n) {
  if (!Number.isFinite(n)) return "0";
  return Math.abs(n) < 15 ? n.toFixed(2) : String(Math.trunc(n));
}
