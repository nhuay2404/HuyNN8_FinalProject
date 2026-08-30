// Per-level gold-reward overrides, hand-tuned in a CSV a designer edits
// directly rather than in code — see `public/design/level-rewards.csv`.
//
// `economy.ts`'s `levelGoldReward` (a difficulty-score formula, §79) stays
// the fallback for any level id NOT listed here, which is every level until
// someone tunes it by hand: a level shipped fresh from the editor still pays
// out something sensible with no CSV row of its own, and the designer only
// ever has to add a row for a level whose number they actually want to
// override.
//
// Fetched at runtime rather than imported/bundled in the normal dev/
// production app, so editing the CSV and reloading the page picks up the new
// numbers with no rebuild at all — and, while the tab stays open, a
// background poll (`POLL_MS`) picks up a saved edit without even a reload,
// which is the "the game automatically adjusts" part of the ask.
//
// The standalone single-file build (`work/build-standalone.mjs`) has no
// server to fetch a CSV from at runtime, so it reads the same file at BUILD
// time instead and bakes the result into the bundle via `seedLevelRewards`
// (see `work/standalone-entry.tsx`) — real numbers, just frozen at whatever
// the sheet said the moment that export was made, rather than live.

const CSV_URL = "/design/level-rewards.csv";
/** How often the tab re-checks the file while it stays open and visible. A
 * plain static-file GET to localhost/self, so even a few times a minute costs
 * nothing real — sized for "an edit shows up without touching the keyboard
 * again", not for a production polling budget. */
const POLL_MS = 4000;

export type LevelRewardRow = { id: number; reward: number };

/**
 * Parses `id`/`reward` pairs out of the CSV text.
 *
 * Deliberately minimal — no quoted-field support. The sheet's `name` column
 * is for a human reading the file, never read by this parser, so a comma
 * inside a level's name cannot break a row; only a comma inside `id` or
 * `reward` themselves would, and neither is ever authored as free text.
 * Lines starting with `#` (and blank lines) are skipped, the same comment
 * convention `work/levels.csv` already uses. Any row whose `id`/`reward`
 * does not parse to a finite, non-negative number is dropped rather than
 * corrupting the wallet with `NaN` — see `sanitiseCount` in `economy.ts` for
 * the same defensiveness against a value that does not round-trip.
 */
export function parseLevelRewardsCsv(text: string): LevelRewardRow[] {
  const lines = text
    .split(/\r\n|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) return [];

  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  const idIndex = header.indexOf("id");
  const rewardIndex = header.indexOf("reward");
  if (idIndex === -1 || rewardIndex === -1) return [];

  const rows: LevelRewardRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const id = Number(cells[idIndex]?.trim());
    const reward = Number(cells[rewardIndex]?.trim());
    if (Number.isFinite(id) && Number.isFinite(reward) && reward >= 0) {
      rows.push({ id, reward: Math.round(reward) });
    }
  }
  return rows;
}

let cache: Map<number, number> | null = null;
let polling = false;

async function refresh() {
  if (typeof window === "undefined") return;
  try {
    // Cache-busting query, and `cache: "no-store"`: the whole point is
    // reading the file as it is on disk right now, not whatever the browser
    // last saw it as.
    const response = await fetch(`${CSV_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const rows = parseLevelRewardsCsv(await response.text());
    cache = new Map(rows.map((row) => [row.id, row.reward]));
  } catch {
    // No server to fetch from (the standalone build, or a `file://` open),
    // or a genuine network hiccup: `getLevelRewardOverride` already falls
    // back to the formula for every id while `cache` is still null, so this
    // is a quiet no-op, not a broken economy.
  }
}

/**
 * Starts loading the CSV, and — once it has loaded at least once — keeps
 * re-fetching it every `POLL_MS` while the tab is visible, so a saved edit
 * reaches a still-open game on its own. Idempotent: every call site (only
 * `SandGame.tsx`, on mount, today) can call this without coordinating who
 * "owns" starting it.
 *
 * A no-op, past the first `polling` guard, if `seedLevelRewards` has already
 * filled the cache — the standalone single-file build (`work/
 * build-standalone.mjs`) seeds it with the CSV as it stood at build time
 * before `SandGame` ever mounts, and that build has no server to fetch a
 * fresher copy from anyway, so starting a timer that would only ever fail is
 * pure waste (and, on a `file://` page, a scary-looking failed-fetch line in
 * the console for a thing that was never actually broken).
 */
export function ensureLevelRewardsLoading() {
  if (typeof window === "undefined" || polling) return;
  polling = true;
  if (cache) return;
  void refresh();
  window.setInterval(() => {
    if (!document.hidden) void refresh();
  }, POLL_MS);
}

/**
 * `undefined` means "no CSV row for this id" — including the CSV not having
 * loaded yet, or not existing at all in this build — the caller's cue to
 * fall back to `levelGoldReward`.
 */
export function getLevelRewardOverride(id: number): number | undefined {
  return cache?.get(id);
}

/**
 * Fills the cache directly, bypassing `fetch` entirely — two real callers:
 *
 * - `work/standalone-entry.tsx`, once at startup, with the CSV as it stood
 *   the moment `work/build-standalone.mjs` ran (baked into the bundle via
 *   esbuild's `define`, since that build has no server to fetch the file
 *   from afterward — see its own comment for why the numbers there are
 *   frozen at build time rather than live).
 * - `tests/level-rewards.test.ts`, to drive `getLevelRewardOverride` without
 *   a real `fetch` (mirrors `economy.ts`'s `__reset*ForTests` seams).
 */
export function seedLevelRewards(rows: LevelRewardRow[]) {
  cache = new Map(rows.map((row) => [row.id, row.reward]));
}
