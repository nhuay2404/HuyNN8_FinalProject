// A small standalone Node server that writes every level in the editor's
// level list straight into app/game/sand-levels.ts, replacing whatever was
// there before — so shipping never piles up stale entries from levels the
// editor no longer has.
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
const SAND_LEVELS_PATH = path.join(process.cwd(), "app", "game", "sand-levels.ts");

const BEGIN_MARKER = "// ==== Editor-shipped levels ====";
const END_MARKER = "// ==== End editor-shipped levels ====";

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

function draftToTypeScript(draft, id, constName) {
  const scale = draft.pixelScale ?? 1;
  const pixels = draft.width * draft.height * scale * scale;

  const rows = draft.rows.map((row) => `    ${quoted(row)},`).join("\n");
  const queue = draft.ammoQueue.map((color) => quoted(color)).join(", ");
  const friction = (draft.keyFriction ?? 0) > 0 ? `\n  keyFriction: ${draft.keyFriction},\n` : "";

  return `export const ${constName}: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,

  id: ${id},
  name: ${quoted(draft.name.trim() || "Untitled")},

  frame: { width: ${draft.width}, height: ${draft.height} },
  rows: [
${rows}
  ],

  // The starting rotation only — under the cycling rule this is a wheel, not a
  // budget: colours come round again until they are gone.
  ammoQueue: [${queue}],

  sortRadius: ${draft.sortRadius},
  shotLimit: ${draft.shotLimit},

  // ${draft.width} x ${draft.height} blueprint at ${scale}x = ${pixels.toLocaleString()} simulated pixels.
  pixelScale: ${scale},
${friction}};`;
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

async function shipLevels(drafts) {
  const source = await readFile(SAND_LEVELS_PATH, "utf8");
  // Match the file's own line endings — this checkout keeps sand-levels.ts as
  // CRLF, and a block hard-coded to \n would leave the file with mixed
  // endings even though it still parses.
  const eol = source.includes("\r\n") ? "\r\n" : "\n";

  const beginIdx = source.indexOf(BEGIN_MARKER);
  const endIdx = source.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error("Could not find the editor-shipped levels markers in sand-levels.ts.");
  }

  // IDs starting right after every hand-authored level already in the file,
  // so a shipped level never collides with one written by hand.
  const outsideBlock = source.slice(0, beginIdx) + source.slice(endIdx + END_MARKER.length);
  const handAuthoredIds = [...outsideBlock.matchAll(/\bid:\s*(\d+)/g)].map((match) => Number(match[1]));
  const firstId = handAuthoredIds.length ? Math.max(...handAuthoredIds) + 1 : 1;

  const names = uniqueExportNames(drafts);
  const blocks = drafts.map((draft, index) => draftToTypeScript(draft, firstId + index, names[index]));

  // Built with plain "\n" throughout, then converted to the file's own line
  // ending in one pass at the end — converting twice (once per fragment) would
  // double up an already-CRLF ending into "\r\r\n".
  const body = [
    "// Regenerated in full every time a level is shipped from `/editor` (the",
    "// \"Ship to sand-levels.ts\" button, via `npm run level-writer`) — this array",
    "// always mirrors the editor's current level list exactly, so a level deleted",
    "// in the editor disappears from here on the next ship rather than lingering.",
    "// Hand edits inside this block are overwritten on the next ship; edit the",
    "// level in the editor instead.",
    ...(blocks.length ? [blocks.join("\n\n"), ""] : []),
    `export const EDITOR_LEVELS: SandLevelConfig[] = [${names.join(", ")}];`,
  ].join("\n").replace(/\n/g, eol);

  const next = source.slice(0, beginIdx + BEGIN_MARKER.length)
    + eol + eol + body + eol
    + source.slice(endIdx);

  await writeFile(SAND_LEVELS_PATH, next, "utf8");
  return { count: drafts.length, names };
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST" || req.url !== "/ship-levels") {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", async () => {
    try {
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
