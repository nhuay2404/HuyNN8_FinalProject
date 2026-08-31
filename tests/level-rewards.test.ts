// `parseLevelRewardsCsv` — the pure half of `level-rewards.ts`. The fetch/poll
// orchestration around it needs `window`/`fetch`, so it is not exercised here
// the same way `level-drafts.ts`'s `localStorage` round-trip never has been
// (see that file, or `economy.ts`'s tests) — verified by hand on the dev
// server instead. The parsing/validation logic itself is exactly the part
// worth proving without a browser: it is what stands between a hand-edited
// CSV and the wallet.

import assert from "node:assert/strict";
import test from "node:test";
import { parseLevelRewardsCsv } from "../app/game/level-rewards.ts";

test("parses id/reward pairs, ignoring the name column", () => {
  const csv = "id,name,reward\n1,Level 1,20\n2,Level 2,45\n";
  assert.deepEqual(parseLevelRewardsCsv(csv), [
    { id: 1, reward: 20 },
    { id: 2, reward: 45 },
  ]);
});

test("skips comment lines and blank lines", () => {
  const csv = [
    "# a comment at the top",
    "id,name,reward",
    "",
    "1,Level 1,20",
    "# a comment in the middle",
    "2,Level 2,45",
    "",
  ].join("\n");
  assert.deepEqual(parseLevelRewardsCsv(csv), [
    { id: 1, reward: 20 },
    { id: 2, reward: 45 },
  ]);
});

test("column order does not matter, as long as the header names do", () => {
  const csv = "reward,id,name\n30,7,Some Level\n";
  assert.deepEqual(parseLevelRewardsCsv(csv), [{ id: 7, reward: 30 }]);
});

test("a row with a non-numeric id or reward is dropped, not thrown", () => {
  const csv = "id,name,reward\n1,Level 1,20\nabc,Broken,30\n3,Level 3,not-a-number\n";
  assert.deepEqual(parseLevelRewardsCsv(csv), [{ id: 1, reward: 20 }]);
});

test("a negative reward is dropped — a level cannot cost gold to clear", () => {
  const csv = "id,name,reward\n1,Level 1,-5\n2,Level 2,20\n";
  assert.deepEqual(parseLevelRewardsCsv(csv), [{ id: 2, reward: 20 }]);
});

test("a fractional reward is rounded", () => {
  const csv = "id,name,reward\n1,Level 1,20.6\n";
  assert.deepEqual(parseLevelRewardsCsv(csv), [{ id: 1, reward: 21 }]);
});

test("missing id or reward column: nothing parses, rather than reading the wrong column", () => {
  assert.deepEqual(parseLevelRewardsCsv("name,reward\nLevel 1,20\n"), []);
  assert.deepEqual(parseLevelRewardsCsv("id,name\n1,Level 1\n"), []);
});

test("an empty sheet (header only, or nothing at all) parses to no rows", () => {
  assert.deepEqual(parseLevelRewardsCsv("id,name,reward\n"), []);
  assert.deepEqual(parseLevelRewardsCsv(""), []);
});

test("the real shipped public/design/level-rewards.csv parses, and its id 1 row matches the shipped default level", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const csvPath = path.join(process.cwd(), "public", "design", "level-rewards.csv");
  const text = await readFile(csvPath, "utf8");
  const rows = parseLevelRewardsCsv(text);
  assert.ok(rows.length >= 1, "the shipped sheet should have at least the default level's row");
  const level1 = rows.find((row) => row.id === 1);
  assert.ok(level1, "the shipped sheet should have a row for level id 1");
  assert.equal(typeof level1?.reward, "number");
});
