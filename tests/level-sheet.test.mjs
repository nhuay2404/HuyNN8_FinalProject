import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseLevelSheet } from "../app/game/level-format.ts";
import { level01 } from "../app/game/level-01.ts";

const sheetUrl = new URL("../work/levels.tsv", import.meta.url);
const HEADER = "level\tname\tdims\tlayers\tgoal_order\tgoal_split\tgoal_slots\tbatch_slots\tshot_limit\tnotes";

function sheet(...rows) {
  return [HEADER, ...rows].join("\n");
}

function sortById(items) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

test("row 1 of the shipped sheet rebuilds the hand written prototype level", async () => {
  const { levels, issues } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  assert.deepEqual(issues, []);
  const first = levels.find((level) => level.id === 1);
  assert.ok(first, "level 1 is missing from the sheet");

  assert.deepEqual(sortById(first.blocks), sortById(level01.blocks));
  assert.deepEqual(first.goals, level01.goals);
  assert.equal(first.activeGoalSlots, level01.activeGoalSlots);
  assert.equal(first.batchCapacity, level01.batchCapacity);
  assert.equal(first.shotLimit, level01.shotLimit);
  assert.equal(first.adjacency.z, true);
  assert.equal(first.batchPriority, "OLDEST_FIRST_TEMP");
});

test("every level in the sheet keeps goal totals equal to its block inventory", async () => {
  const { levels } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  assert.ok(levels.length >= 1);
  for (const level of levels) {
    const blocks = new Map();
    for (const block of level.blocks) blocks.set(block.color, (blocks.get(block.color) ?? 0) + 1);
    const goals = new Map();
    for (const goal of level.goals) goals.set(goal.color, (goals.get(goal.color) ?? 0) + goal.target);
    assert.deepEqual([...goals.entries()].sort(), [...blocks.entries()].sort(), `level ${level.id}`);
    assert.equal(new Set(level.goals.map((goal) => goal.id)).size, level.goals.length, `level ${level.id} goal ids`);
  }
});

test("a split color is spread across the goal queue instead of landing twice in a row", () => {
  const { levels, issues } = parseLevelSheet(sheet("7\tSplit\t3x3x2\tPPP/OOO/RRR|RRR/PPP/OOO\tP,O,R\tP:3+3\t\t\t\t"));
  assert.deepEqual(issues, []);
  assert.deepEqual(levels[0].goals.map((goal) => `${goal.color}${goal.target}`), ["purple3", "orange6", "red6", "purple3"]);
});

test("a shape that does not match its dims is reported and skipped", () => {
  const { levels, issues } = parseLevelSheet(sheet("8\tBad\t4x3x2\tRRR/BBBB/GGGG|RRRR/BBBB/GGGG\t\t\t\t\t\t"));
  assert.equal(levels.length, 0);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /row 1 has 3 cells but dims says 4/);
  assert.equal(issues[0].level, "8");
});

test("a split that does not add up to the block count is reported", () => {
  const { levels, issues } = parseLevelSheet(sheet("9\tBad split\t2x1x1\tRR\tR\tR:1+3\t\t\t\t"));
  assert.equal(levels.length, 0, "a row with any problem is not loaded at all");
  assert.match(issues[0].message, /adds up to 4 but the level has 2 blocks/);
});

test("two goals of one color opening in the same window is reported", () => {
  const { issues } = parseLevelSheet(sheet("10\tClash\t4x1x1\tRRRR\tR\tR:2+2\t\t\t\t"));
  assert.ok(issues.some((issue) => /open two of the same colour at once/.test(issue.message)));
});

test("duplicate level numbers are rejected", () => {
  const { levels, issues } = parseLevelSheet(sheet(
    "11\tFirst\t2x1x1\tRR\t\t\t\t\t\t",
    "11\tSecond\t2x1x1\tGG\t\t\t\t\t\t",
  ));
  assert.equal(levels.length, 1);
  assert.match(issues[0].message, /level 11 already exists on row/);
});

test("unknown color characters and duplicate cells are reported", () => {
  const { issues } = parseLevelSheet(sheet("12\tTypo\t2x1x1\tRZ\t\t\t\t\t\t"));
  assert.ok(issues.some((issue) => /colour code "Z" is not valid/.test(issue.message)));
});

test("a comma-separated sheet (Excel Save As CSV) parses the same as tab-separated", () => {
  const csvHeader = "level,name,dims,layers,goal_order,goal_split,goal_slots,batch_slots,shot_limit,notes";
  const csvRow = '7,Split,3x3x2,PPP/OOO/RRR|RRR/PPP/OOO,"P,O,R",P:3+3,,,,';
  const { levels, issues } = parseLevelSheet([csvHeader, csvRow].join("\n"));
  assert.deepEqual(issues, []);
  assert.deepEqual(levels[0].goals.map((goal) => `${goal.color}${goal.target}`), ["purple3", "orange6", "red6", "purple3"]);
});

test("a semicolon-separated sheet (Excel on a comma-decimal locale) also parses", () => {
  const scHeader = "level;name;dims;layers;goal_order;goal_split;goal_slots;batch_slots;shot_limit;notes";
  const scRow = "7;Split;3x3x2;PPP/OOO/RRR|RRR/PPP/OOO;P,O,R;P:3+3;;;;";
  const { levels, issues } = parseLevelSheet([scHeader, scRow].join("\n"));
  assert.deepEqual(issues, []);
  assert.deepEqual(levels[0].goals.map((goal) => `${goal.color}${goal.target}`), ["purple3", "orange6", "red6", "purple3"]);
});

test("the shipped .csv template parses to the exact same levels as the .tsv", async () => {
  const csvUrl = new URL("../work/levels.csv", import.meta.url);
  const csvText = await readFile(csvUrl, "utf8");
  const tsvResult = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  const csvResult = parseLevelSheet(csvText);
  assert.deepEqual(csvResult.issues, []);
  assert.deepEqual(csvResult.levels, tsvResult.levels);
});
