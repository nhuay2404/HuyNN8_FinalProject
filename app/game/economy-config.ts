// General (not per-level) economy numbers, hand-tuned in a CSV a designer
// edits directly — see `public/design/economy.csv`. Covers everything in
// `economy.ts` that is not "how much does clearing THIS level pay" (that one
// is `level-rewards.ts`, a sibling file with the exact same shape): the
// starter grant, booster prices, and the 7-day daily-login curve.
//
// Same fetch/parse/poll design as `level-rewards.ts` — see that file's
// header for the full reasoning (why runtime `fetch` rather than a bundled
// import, why the poll interval, why the standalone build seeds this
// instead). The two are separate files rather than one generic CSV loader
// because their rows mean different things (id->reward vs key->value) and
// every caller already knows which sheet it wants.

const CSV_URL = "/design/economy.csv";
/** Same value as `level-rewards.ts`'s `POLL_MS` — sized for "an edit shows
 * up without touching the keyboard again", not a production polling budget. */
const POLL_MS = 4000;

export type EconomyConfigRow = { key: string; value: number };

/**
 * Parses `key`/`value` pairs out of the CSV text — see `parseLevelRewardsCsv`
 * in `level-rewards.ts` for the identical reasoning (minimal, no quoted
 * fields, `#`-comment lines skipped, an invalid row dropped rather than
 * thrown). A negative value is kept here (unlike a level reward) — nothing
 * in this sheet is a "cannot cost gold" quantity the way a level's reward
 * is, and rejecting it would just be a rule this file invented for no
 * reason; `economy.ts`'s own accessors are what actually enforce meaning
 * per key (a booster price of 0 is a strange but valid choice, for example).
 */
export function parseEconomyConfigCsv(text: string): EconomyConfigRow[] {
  const lines = text
    .split(/\r\n|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) return [];

  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  const keyIndex = header.indexOf("key");
  const valueIndex = header.indexOf("value");
  if (keyIndex === -1 || valueIndex === -1) return [];

  const rows: EconomyConfigRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const key = cells[keyIndex]?.trim();
    const value = Number(cells[valueIndex]?.trim());
    if (key && Number.isFinite(value)) rows.push({ key, value });
  }
  return rows;
}

function rowsEqual(a: Map<string, number> | null, b: Map<string, number>): boolean {
  if (!a || a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

let cache: Map<string, number> | null = null;
let polling = false;
let version = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

async function refresh() {
  if (typeof window === "undefined") return;
  try {
    const response = await fetch(`${CSV_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const next = new Map(parseEconomyConfigCsv(await response.text()).map((row) => [row.key, row.value]));
    // Only notify on an actual change — a poll firing every `POLL_MS`
    // forever should not re-render anything (or re-run `economy.ts`'s
    // fresh-wallet patch, see its own comment) when nothing in the sheet
    // moved since the last check.
    if (rowsEqual(cache, next)) return;
    cache = next;
    version += 1;
    notify();
  } catch {
    // No server to fetch from (the standalone build, or a `file://` open),
    // or a genuine network hiccup: `getEconomyConfigOverride` already falls
    // back to the hardcoded default for every key while `cache` is null.
  }
}

/**
 * Starts loading the CSV, and — once it has loaded at least once — keeps
 * re-fetching it every `POLL_MS` while the tab is visible. A no-op, past the
 * first `polling` guard, if `seedEconomyConfig` has already filled the cache
 * (the standalone build) — see `level-rewards.ts`'s `ensureLevelRewardsLoading`
 * for the identical reasoning.
 */
export function ensureEconomyConfigLoading() {
  if (typeof window === "undefined" || polling) return;
  polling = true;
  if (cache) return;
  void refresh();
  window.setInterval(() => {
    if (!document.hidden) void refresh();
  }, POLL_MS);
}

/** `useSyncExternalStore`'s subscribe function, and `economy.ts`'s own hook
 * for re-applying a starter-value override to a still-untouched wallet —
 * fires whenever the cache actually changes. */
export function subscribeEconomyConfig(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `undefined` means "no row for this key" — including the CSV not having
 * loaded yet, or not existing at all in this build. */
export function getEconomyConfigOverride(key: string): number | undefined {
  return cache?.get(key);
}

/**
 * A number that changes exactly when the cache does — `SandGame.tsx`'s
 * `useSyncExternalStore` snapshot for re-rendering the Shop panel and the
 * daily-login modal on a live poll pickup, since neither reads through
 * `subscribeWallet` the way gold/boosters do. `0` (the initial value) is a
 * stable server snapshot: SSR never has a loaded config to disagree about.
 */
export function getEconomyConfigVersion(): number {
  return version;
}

/**
 * Fills the cache directly, bypassing `fetch` — mirrors `level-rewards.ts`'s
 * `seedLevelRewards`, same two real callers: `work/standalone-entry.tsx`
 * (baked in at build time by `work/build-standalone.mjs`) and
 * `tests/economy-config.test.ts`.
 */
export function seedEconomyConfig(rows: EconomyConfigRow[]) {
  cache = new Map(rows.map((row) => [row.key, row.value]));
}
