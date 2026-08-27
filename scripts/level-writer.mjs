// A small standalone Node server that writes level-editor drafts straight into
// app/game/sand-levels.ts.
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

function quoted(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function levelExportName(draft) {
  return (draft.name.trim() || "untitled")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join("") || "untitled";
}

function draftToTypeScript(draft, id) {
  const scale = draft.pixelScale ?? 1;
  const pixels = draft.width * draft.height * scale * scale;
  const constName = levelExportName(draft);

  const rows = draft.rows.map((row) => `    ${quoted(row)},`).join("\n");
  const queue = draft.ammoQueue.map((color) => quoted(color)).join(", ");
  const phaseLines = (draft.wind?.phases ?? []).map((phase) => {
    const zone = phase.zone
      ? `{ x: ${phase.zone.x}, y: ${phase.zone.y}, width: ${phase.zone.width}, height: ${phase.zone.height} }`
      : "null";
    return `      { direction: ${quoted(phase.direction)}, durationMs: ${phase.durationMs}, `
      + `cooldownMs: ${phase.cooldownMs}, power: ${phase.power}, zone: ${zone} },`;
  }).join("\n");
  const wind = draft.wind
    ? `\n  wind: {\n    phases: [\n${phaseLines}\n    ],\n  },\n`
    : "";
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
${wind}${friction}};
`;
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

async function exportLevel(draft) {
  const source = await readFile(SAND_LEVELS_PATH, "utf8");
  // Match the file's own line endings — this checkout keeps sand-levels.ts as
  // CRLF, and a regex or inserted block hard-coded to \n would either fail to
  // find the existing declaration or leave the file with mixed endings.
  const usesCrlf = source.includes("\r\n");
  const eol = usesCrlf ? "\r\n" : "\n";
  const constName = levelExportName(draft);

  const usedIds = [...source.matchAll(/\bid:\s*(\d+)/g)].map((match) => Number(match[1]));
  const nextId = usedIds.length ? Math.max(...usedIds) + 1 : 1;

  const existing = new RegExp(`export const ${constName}: SandLevelConfig = \\{[\\s\\S]*?\\r?\\n\\};\\r?\\n`);
  const alreadyDeclared = existing.test(source);
  const previousId = alreadyDeclared
    ? Number(source.match(existing)[0].match(/\bid:\s*(\d+)/)?.[1] ?? nextId)
    : nextId;
  const block = draftToTypeScript(draft, previousId).replace(/\n/g, eol);

  // The declaration always lands right before `BUILT_IN_LEVELS`, never where
  // it happened to sit before: a `const` referenced by that array has to be
  // declared above it, or the array's own initializer throws at import time.
  const withoutOldDeclaration = alreadyDeclared ? source.replace(existing, "") : source;
  let next = withoutOldDeclaration.replace(
    /export const BUILT_IN_LEVELS: SandLevelConfig\[\] = \[/,
    `${block}${eol}export const BUILT_IN_LEVELS: SandLevelConfig[] = [`,
  );

  const listMatch = next.match(/export const BUILT_IN_LEVELS: SandLevelConfig\[\] = \[([^\]]*)\];/);
  if (listMatch && !new RegExp(`(^|[,\\[]\\s*)${constName}\\s*($|[,\\]])`).test(listMatch[1])) {
    const names = listMatch[1].split(",").map((entry) => entry.trim()).filter(Boolean);
    names.push(constName);
    next = next.replace(listMatch[0], `export const BUILT_IN_LEVELS: SandLevelConfig[] = [${names.join(", ")}];`);
  }

  await writeFile(SAND_LEVELS_PATH, next, "utf8");
  return { name: constName, id: previousId, updated: alreadyDeclared };
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST" || req.url !== "/export-level") {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", async () => {
    try {
      const { draft } = JSON.parse(body);
      if (!isDraft(draft)) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "That doesn't look like a level draft." }));
        return;
      }
      const result = await exportLevel(draft);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`Level writer listening on http://localhost:${PORT} — writing into ${SAND_LEVELS_PATH}`);
});
