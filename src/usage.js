// Anonymous usage counts: which parts of the library get used, never who uses
// them. A count is the tool and an event name and nothing else - no cookies, no
// ids. They go to the CTE2 Archives Worker, which keeps one number per day, tool
// and event; its src/usage.ts lists the events it accepts, so a new one here
// needs adding there too.

const USAGE_URL = "https://cob-codex-api.ryongenn.workers.dev/usage";
// only the live site counts; a local server or a fork would just be noise
const LIVE = location.hostname === "ryongen.github.io";
const sent = new Set();

// once per page load per event, fire and forget
export function countUsage(event) {
  if (!LIVE || sent.has(event)) return;
  sent.add(event);
  fetch(`${USAGE_URL}?tool=library&event=${event}`, { method: "POST", mode: "no-cors" }).catch(() => {});
}

// `open` on every page load, `day` once per browser per day (roughly people).
// The key names the tool because every tool on ryongen.github.io shares one
// localStorage.
export function countVisit() {
  countUsage("open");
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem("library.usage-day") === today) return;
    localStorage.setItem("library.usage-day", today);
  } catch { return; }
  countUsage("day");
}
