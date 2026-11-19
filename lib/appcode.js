// Lets the server functions in api/ run a few of the app's own calculations -- TAG coin balances,
// Chazzan coin amounts -- exactly as index.html does them, without a second copy that could drift.
// It reads index.html, takes out just the named top-level functions and constants, and runs them
// in a sandbox with the `state` you give it. No browser code (screens, buttons) is involved.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const NAMES = [
  // balances
  "computeStats", "studentStats", "periodsForDate", "canceledPeriodsFor", "extraPeriodsFor", "dayNameFor",
  "jsDateFor", "periodMaxFor", "isBonusPeriod", "categoryFor", "DAY_NAMES", "PERIOD_CATEGORIES",
  // Chazzan coins
  "DEFAULT_PERIOD_CATEGORY", "CHAZZAN_OTHER", "CHAZZAN_COIN_TABLE", "chazzanCoinsFor", "chazzanShareFor", "chazzanLedgerPrefix", "chazzanLedgerId",
  // staff TAG coins
  "computeStaffStats", "staffStats",
];

// The source of one top-level `function NAME(...) {...}` or `const NAME = ...;`, found by matching
// brackets while skipping strings, template literals and comments.
function extract(src, name) {
  const m = new RegExp("\\n(async\\s+)?function\\s+" + name + "\\s*\\(|\\n(const|let)\\s+" + name + "\\s*=").exec(src);
  if (!m) return null;
  let i = m.index + 1, depth = 0, started = false;
  const isFn = !!(m[0].indexOf("function") >= 0);
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { i = src.indexOf("\n", i); continue; }
    if (c === "/" && n === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") { depth++; started = true; }
    else if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (isFn && started && depth === 0 && c === "}") return src.slice(m.index + 1, i + 1);
    } else if (!isFn && c === ";" && depth === 0) return src.slice(m.index + 1, i + 1);
  }
  return null;
}

let cached = null;
function load() {
  if (cached) return cached;
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const parts = NAMES.map((n) => {
    const code = extract(html, n);
    if (!code) throw new Error("appcode: couldn't find " + n + " in index.html");
    return code.replace(/^(const|let)\s/, "var ");
  });
  const exportsLine = "\n;({" + NAMES.join(",") + "});";
  cached = new vm.Script("var state = null;\n" + parts.join("\n") + exportsLine + "\n", { filename: "appcode.js" });
  return cached;
}

// The app's functions, run against `state` (a plain copy of app/state).
function withState(state) {
  const ctx = vm.createContext({ Date, Math, JSON, Number, String, Object, Array, Set, Map, isNaN, isFinite });
  const fns = load().runInContext(ctx);
  ctx.state = state;
  return fns;
}

module.exports = { withState, extract, NAMES };
