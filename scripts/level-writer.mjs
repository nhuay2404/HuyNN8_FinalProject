// A small standalone Node server that writes level drafts straight into
// design/levels/sand-levels.ts. Two routes, both enforcing the same rule —
// every level has exactly one id, and a draft naming an id already in the
// file updates that level rather than minting a duplicate — at two different
// scales:
//
// - POST /update-level writes ONE draft back to the specific `export const`
//   it was imported from (matched by id, wherever it sits in the file) —
//   what "Import built-in" + "Update built-in level" in the editor use to
//   actually revise a hand-authored level in place, instead of shipping the
//   edit as an unrelated new one.
// - POST /ship-levels does the same per-draft id check across the editor's
//   whole level list at once: a draft that names an existing id updates that
//   level in place (see `shipLevels`'s own comment for exactly where);
//   everything left over — genuinely new levels only — replaces the
//   EDITOR_LEVELS block wholesale, so that block never piles up stale
//   entries from levels the editor no longer has.
//
// It cannot live inside the app itself: this project's dev/build target is
// Cloudflare Workers (see worker/index.ts, wrangler.toml), and the Workers
// runtime has no real filesystem — an API route there can never touch a file
// on disk, in dev or in production. This script is a plain Node process
// instead, run alongside `npm run dev`, so it keeps ordinary `fs` access.
//
// The TypeScript-block formatting below mirrors `draftToTypeScript` in
// app/game/level-drafts.ts. It is duplicated rather than imported because this
// script runs as plain Node (no TypeScript step) — keep the two in sync if the
// exported shape of a level ever changes.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.LEVEL_WRITER_PORT) || 4787;
const SAND_LEVELS_PATH = path.join(process.cwd(), "design", "levels", "sand-levels.ts");

const BEGIN_MARKER = "// ==== Editor-shipped levels ====";
const END_MARKER = "// ==== End editor-shipped levels ====";

/**
 * Scan `source` from `openIndex` (the position of an opening bracket) for the
 * bracket that closes it, skipping over comments and string/template
 * literals so a stray `{`/`}`/`[`/`]` inside a doc comment or a quoted string
 * (both common in this codebase's prose-heavy comments) never miscounts.
 * Returns the closing bracket's index, or -1 if the source ends unclosed.
 */
function findMatchingBracket(source, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const eol = source.indexOf("\n", i);
      if (eol === -1) return -1;
      i = eol;
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      if (close === -1) return -1;
      i = close + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Finds the one `export const NAME: SandLevelConfig = { ... };` block whose
 * body contains `id: <id>` — hand-authored or previously shipped, wherever it
 * sits in the file. Used by `/update-level` to write back to the *same*
 * const a draft was imported from, rather than shipping it as a new level.
 */
function findLevelBlockById(source, id) {
  const headerRe = /export const (\w+): SandLevelConfig = \{/g;
  let match;
  while ((match = headerRe.exec(source))) {
    const openBrace = match.index + match[0].length - 1;
    const closeBrace = findMatchingBracket(source, openBrace, "{", "}");
    if (closeBrace === -1) break;
    let end = closeBrace + 1;
    while (end < source.length && /\s/.test(source[end])) end += 1;
    if (source[end] === ";") end += 1;
    headerRe.lastIndex = end;

    const blockText = source.slice(match.index, end);
    const idMatch = blockText.match(/\bid:\s*(\d+)\b/);
    if (idMatch && Number(idMatch[1]) === id) {
      const rowsMatch = blockText.match(/\brows:\s*(\w+)\s*,/);
      return { start: match.index, end, constName: match[1], pictureConstName: rowsMatch?.[1] ?? null };
    }
  }
  return null;
}

/**
 * If the block being replaced pointed at a separate `const PICTURE = [...]`
 * (the style every hand-authored level in sand-levels.ts uses — see that
 * file's own levels), that picture becomes dead code the instant the level
 * block is replaced with a self-contained one (the shipped format always
 * inlines `rows` directly). Removed here so updating a built-in level does
 * not leave an unused const behind for every level it touches.
 */
function removeOrphanedPictureConst(source, pictureConstName) {
  const headerRe = new RegExp(`const ${pictureConstName} = \\[`, "g");
  const match = headerRe.exec(source);
  if (!match) return source;
  const openBracket = match.index + match[0].length - 1;
  const closeBracket = findMatchingBracket(source, openBracket, "[", "]");
  if (closeBracket === -1) return source;
  let end = closeBracket + 1;
  while (end < source.length && /\s/.test(source[end]) && source[end] !== "\n") end += 1;
  if (source[end] === ";") end += 1;
  // Eat one trailing blank line so removing the const does not leave a gap
  // of two blank lines where there used to be one.
  let start = match.index;
  while (end < source.length && (source[end] === "\n" || source[end] === "\r")) end += 1;
  return source.slice(0, start) + source.slice(end);
}

function quoted(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function baseExportName(draft) {
  return (draft.name.trim() || "untitled")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join("") || "untitled";
}

/** Two drafts named the same thing would otherwise collide on one const. */
function uniqueExportNames(drafts) {
  const seen = new Map();
  return drafts.map((draft) => {
    const base = baseExportName(draft);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}${count + 1}`;
  });
}

/**
 * `forcedOpeningQueue`/`ftueFreezeDemo`/`ftueFreezeTargets` (and, the same
 * way, `forcedBoosterCharges`/`ftueBoosterDemo`/`ftueBoosterTargets`) have no
 * editor control of their own (see their `LevelDraft` doc comments) — a
 * draft only carries them at all if it happened to be imported after they
 * existed on the built-in level it came from. A draft imported earlier (or
 * edited by hand before that) silently lacks them, and writing THAT draft
 * back with `draftToTypeScript` would erase them from the file even though
 * nothing about them was meant to change. So before every write-back to an
 * existing level (`updateLevel`, and `shipLevels`' own upsert of a level
 * living outside the shipped block), this reads whatever the CURRENT
 * on-disk block already has for these six fields and fills in only the ones
 * the draft itself doesn't carry — the draft still wins whenever it does
 * have an opinion, this only stops it from clobbering silence with silence.
 */
function preserveUneditableFtueFields(existingBlockText, draft) {
  const allPresent = draft.forcedOpeningQueue !== undefined && draft.ftueFreezeDemo !== undefined
    && draft.ftueFreezeTargets !== undefined && draft.forcedBoosterCharges !== undefined
    && draft.ftueBoosterDemo !== undefined && draft.ftueBoosterTargets !== undefined;
  if (allPresent) return draft;
  const forced = draft.forcedOpeningQueue ?? (() => {
    const m = existingBlockText.match(/forcedOpeningQueue:\s*\[([^\]]*)\]/);
    return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((mm) => mm[1]) : undefined;
  })();
  const demo = draft.ftueFreezeDemo ?? (/ftueFreezeDemo:\s*true/.test(existingBlockText) || undefined);
  const targets = draft.ftueFreezeTargets ?? (() => {
    const m = existingBlockText.match(/ftueFreezeTargets:\s*\[([\s\S]*?)\]/);
    if (!m) return undefined;
    return [...m[1].matchAll(/\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+)\s*\}/g)]
      .map((mm) => ({ x: Number(mm[1]), y: Number(mm[2]) }));
  })();
  const boosterCharges = draft.forcedBoosterCharges ?? (() => {
    const m = existingBlockText.match(/forcedBoosterCharges:\s*\{([^}]*)\}/);
    if (!m) return undefined;
    const charges = {};
    for (const cm of m[1].matchAll(/(radiusOvercharge|prismShot):\s*(-?\d+)/g)) charges[cm[1]] = Number(cm[2]);
    return charges;
  })();
  const boosterDemo = draft.ftueBoosterDemo ?? (/ftueBoosterDemo:\s*true/.test(existingBlockText) || undefined);
  const boosterTargets = draft.ftueBoosterTargets ?? (() => {
    const m = existingBlockText.match(/ftueBoosterTargets:\s*\[([\s\S]*?)\]/);
    if (!m) return undefined;
    return [...m[1].matchAll(/\{\s*x:\s*(-?\d+),\s*y:\s*(-?\d+)\s*\}/g)]
      .map((mm) => ({ x: Number(mm[1]), y: Number(mm[2]) }));
  })();
  return {
    ...draft,
    forcedOpeningQueue: forced,
    ftueFreezeDemo: demo,
    ftueFreezeTargets: targets,
    forcedBoosterCharges: boosterCharges,
    ftueBoosterDemo: boosterDemo,
    ftueBoosterTargets: boosterTargets,
  };
}

function draftToTypeScript(draft, id, constName) {
  const scale = draft.pixelScale ?? 1;
  const pixels = draft.width * draft.height * scale * scale;

  const rows = draft.rows.map((row) => `    ${quoted(row)},`).join("\n");
  const queue = draft.ammoQueue.map((color) => quoted(color)).join(", ");
  const friction = (draft.keyFriction ?? 0) > 0 ? `\n  keyFriction: ${draft.keyFriction},\n` : "";
  const freeze = (draft.freezeDuration ?? 0) > 0 ? `\n  freezeDuration: ${draft.freezeDuration},\n` : "";
  // Freeze triggers buried under sand (on request: "freeze bị che sau lớp
  // cát") — a second grid, same shape as `rows`, only ever present at all
  // once the editor's own Freeze-tool "Hidden" mode has painted into it.
  const hasHiddenFreeze = Array.isArray(draft.hiddenFreezeRows) && draft.hiddenFreezeRows.some((row) => row.includes("@"));
  const hiddenFreezeRows = hasHiddenFreeze
    ? `\n  hiddenFreezeRows: [\n${draft.hiddenFreezeRows.map((row) => `    ${quoted(row)},`).join("\n")}\n  ],\n`
    : "";
  // None of these three have an editor control of their own (see their
  // `LevelDraft` doc comments) — they only ever get here by having survived
  // an import from a hand-authored level that already had them, and this is
  // what keeps them from being silently dropped the next time that level is
  // saved from the editor.
  const forcedOpeningQueue = Array.isArray(draft.forcedOpeningQueue) && draft.forcedOpeningQueue.length
    ? `\n  forcedOpeningQueue: [${draft.forcedOpeningQueue.map((color) => quoted(color)).join(", ")}],\n`
    : "";
  const ftueFreezeDemo = draft.ftueFreezeDemo ? `\n  ftueFreezeDemo: true,\n` : "";
  const ftueFreezeTargets = Array.isArray(draft.ftueFreezeTargets) && draft.ftueFreezeTargets.length
    ? `\n  ftueFreezeTargets: [${draft.ftueFreezeTargets.map((t) => `{ x: ${t.x}, y: ${t.y} }`).join(", ")}],\n`
    : "";
  const boosterChargeEntries = draft.forcedBoosterCharges
    ? Object.entries(draft.forcedBoosterCharges).filter(([, count]) => count !== undefined)
    : [];
  const forcedBoosterCharges = boosterChargeEntries.length
    ? `\n  forcedBoosterCharges: { ${boosterChargeEntries.map(([type, count]) => `${type}: ${count}`).join(", ")} },\n`
    : "";
  const ftueBoosterDemo = draft.ftueBoosterDemo ? `\n  ftueBoosterDemo: true,\n` : "";
  const ftueBoosterTargets = Array.isArray(draft.ftueBoosterTargets) && draft.ftueBoosterTargets.length
    ? `\n  ftueBoosterTargets: [${draft.ftueBoosterTargets.map((t) => `{ x: ${t.x}, y: ${t.y} }`).join(", ")}],\n`
    : "";

  return `export const ${constName}: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: ${id},
  name: ${quoted(draft.name.trim() || "Untitled")},

  frame: { width: ${draft.width}, height: ${draft.height} },
  rows: [
${rows}
  ],
${hiddenFreezeRows}
  // The starting rotation only — under the cycling rule this is a wheel, not a
  // budget: colours come round again until they are gone.
  ammoQueue: [${queue}],
${forcedOpeningQueue}${ftueFreezeDemo}${ftueFreezeTargets}${forcedBoosterCharges}${ftueBoosterDemo}${ftueBoosterTargets}
  sortRadius: ${draft.sortRadius},
  shotLimit: ${draft.shotLimit},

  // ${draft.width} x ${draft.height} blueprint at ${scale}x = ${pixels.toLocaleString()} simulated pixels.
  pixelScale: ${scale},
${friction}${freeze}};`;
}

function isDraft(value) {
  return value && typeof value === "object"
    && typeof value.name === "string"
    && typeof value.width === "number"
    && typeof value.height === "number"
    && Array.isArray(value.rows)
    && Array.isArray(value.ammoQueue)
    && typeof value.sortRadius === "number"
    && typeof value.shotLimit === "number";
}

/**
 * Every level gets exactly one id, and shipping a draft whose `importedFromId`
 * names an id already in the file updates that same level rather than
 * minting a duplicate — the one rule this function exists to enforce,
 * regardless of where that id's own `export const` happens to live:
 *
 * - Outside the editor-shipped block (a hand-authored level, or one shipped
 *   on an earlier run and later re-imported for more editing): updated in
 *   place, independently of anything below, the same way `/update-level`
 *   does it — because the wholesale regeneration below would otherwise wipe
 *   out that update the instant it replaces the whole block.
 * - Inside the editor-shipped block: left for that regeneration to handle,
 *   just kept at its own id instead of being handed a fresh one.
 *
 * Only a draft with no `importedFromId` at all — one that has never named an
 * existing level — actually counts as new and gets a fresh id.
 */
async function shipLevels(drafts) {
  let source = await readFile(SAND_LEVELS_PATH, "utf8");
  // Match the file's own line endings — this checkout keeps sand-levels.ts as
  // CRLF, and a block hard-coded to \n would leave the file with mixed
  // endings even though it still parses.
  const eol = source.includes("\r\n") ? "\r\n" : "\n";

  let beginIdx = source.indexOf(BEGIN_MARKER);
  let endIdx = source.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error("Could not find the editor-shipped levels markers in design/levels/sand-levels.ts.");
  }

  const regenerate = [];
  let updatedInPlace = 0;
  for (const draft of drafts) {
    const targetId = Number.isInteger(draft.importedFromId) ? draft.importedFromId : null;
    if (targetId === null) {
      regenerate.push({ draft, id: null });
      continue;
    }
    const found = findLevelBlockById(source, targetId);
    const insideShippedBlock = found && found.start >= beginIdx && found.start < endIdx;
    if (found && !insideShippedBlock) {
      const merged = preserveUneditableFtueFields(source.slice(found.start, found.end), draft);
      const newBlock = draftToTypeScript(merged, targetId, found.constName).replace(/\n/g, eol);
      source = source.slice(0, found.start) + newBlock + source.slice(found.end);
      if (found.pictureConstName) source = removeOrphanedPictureConst(source, found.pictureConstName);
      // The upsert above can shift both markers (a removed picture const, a
      // block that changed size) — re-find them before the next draft trusts
      // either index.
      beginIdx = source.indexOf(BEGIN_MARKER);
      endIdx = source.indexOf(END_MARKER);
      updatedInPlace += 1;
      continue;
    }
    // Either its own const sits inside the block the loop below regenerates
    // wholesale (so updating it here would just be overwritten a moment
    // later), or `targetId` no longer exists (its level was deleted by
    // hand) — either way its edit belongs in that regeneration, kept at its
    // own id rather than treated as a fresh level.
    regenerate.push({ draft, id: targetId });
  }

  // Fresh ids start right after every id living outside the block about to be
  // regenerated, so a genuinely new level never collides with one written by
  // hand — or with one of the re-ided drafts above, now sitting outside it.
  const outsideBlock = source.slice(0, beginIdx) + source.slice(endIdx + END_MARKER.length);
  const existingIds = [...outsideBlock.matchAll(/\bid:\s*(\d+)/g)].map((match) => Number(match[1]));
  let nextFreshId = existingIds.length ? Math.max(...existingIds) + 1 : 1;

  const names = uniqueExportNames(regenerate.map((entry) => entry.draft));
  const blocks = regenerate.map((entry, index) =>
    draftToTypeScript(entry.draft, entry.id ?? nextFreshId++, names[index]));

  // Built with plain "\n" throughout, then converted to the file's own line
  // ending in one pass at the end — converting twice (once per fragment) would
  // double up an already-CRLF ending into "\r\r\n".
  const body = [
    "// Regenerated in full every time a level is shipped from `/editor` (the",
    "// \"Ship to sand-levels.ts\" button, via `npm run level-writer`) — this array",
    "// always mirrors the editor's current level list exactly, so a level deleted",
    "// in the editor disappears from here on the next ship rather than lingering.",
    "// A draft imported from a level living outside this block updates that",
    "// level's own const instead of appearing here at all — see this file's",
    "// header comment.",
    "// Hand edits inside this block are overwritten on the next ship; edit the",
    "// level in the editor instead.",
    ...(blocks.length ? [blocks.join("\n\n"), ""] : []),
    `export const EDITOR_LEVELS: SandLevelConfig[] = [${names.join(", ")}];`,
  ].join("\n").replace(/\n/g, eol);

  const next = source.slice(0, beginIdx + BEGIN_MARKER.length)
    + eol + eol + body + eol
    + source.slice(endIdx);

  await writeFile(SAND_LEVELS_PATH, next, "utf8");
  const created = regenerate.filter((entry) => entry.id === null).length;
  return { count: drafts.length, created, updatedInPlace: updatedInPlace + (regenerate.length - created), names };
}

/**
 * Writes one draft back to the *same* `export const` it was imported from
 * (matched by `id`, wherever that const sits in the file — hand-authored or
 * previously shipped), rather than appending it as a new level the way
 * `shipLevels` always does. This is what the editor's "Update built-in
 * level" button calls.
 *
 * The replacement is always in the self-contained, inlined-`rows` shape
 * `draftToTypeScript` produces — the same shape `shipLevels` writes. A
 * hand-authored level that split its picture into its own named const (every
 * level in sand-levels.ts written before this feature existed does) loses
 * that split: the const becomes unreferenced the instant this runs, so it is
 * deleted here too rather than left as dead code.
 */
async function updateLevel(id, draft) {
  const source = await readFile(SAND_LEVELS_PATH, "utf8");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";

  const found = findLevelBlockById(source, id);
  if (!found) {
    throw new Error(`Could not find a level with id ${id} in design/levels/sand-levels.ts.`);
  }

  const merged = preserveUneditableFtueFields(source.slice(found.start, found.end), draft);
  const newBlock = draftToTypeScript(merged, id, found.constName).replace(/\n/g, eol);
  let next = source.slice(0, found.start) + newBlock + source.slice(found.end);

  let orphanRemoved = false;
  if (found.pictureConstName) {
    const before = next;
    next = removeOrphanedPictureConst(next, found.pictureConstName);
    orphanRemoved = next !== before;
  }

  await writeFile(SAND_LEVELS_PATH, next, "utf8");
  return { constName: found.constName, pictureConstName: found.pictureConstName, orphanRemoved };
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST" || (req.url !== "/ship-levels" && req.url !== "/update-level")) {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", async () => {
    try {
      if (req.url === "/update-level") {
        const { id, draft } = JSON.parse(body);
        if (!Number.isInteger(id) || id < 1 || !isDraft(draft)) {
          res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "That doesn't look like a level id and a draft." }));
          return;
        }
        const result = await updateLevel(id, draft);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, ...result }));
        return;
      }

      const { drafts } = JSON.parse(body);
      if (!Array.isArray(drafts) || !drafts.every(isDraft)) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "That doesn't look like a list of level drafts." }));
        return;
      }
      const result = await shipLevels(drafts);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Level writer listening on http://localhost:${PORT} — writing into ${SAND_LEVELS_PATH}`);
});
