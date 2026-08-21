import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseLevelSheet } from "../app/game/level-format.ts";

const sheetUrl = new URL("../work/levels.tsv", import.meta.url);
const COLUMNS = ["level", "name", "dims", "layers", "barrel_layers", "links", "goal_order", "goal_split", "goal_slots", "batch_slots", "shot_limit", "notes"];

// Rows are written as objects so a new column never silently shifts a value
// into the wrong field, which is exactly what a hand-written tab string did.
function sheet(...rows) {
  const body = rows.map((row) => {
    for (const key of Object.keys(row)) {
      assert.ok(COLUMNS.includes(key), `unknown column in test row: ${key}`);
    }
    return COLUMNS.map((column) => row[column] ?? "").join("\t");
  });
  return [COLUMNS.join("\t"), ...body].join("\n");
}

async function shippedLevel(id) {
  const { levels, issues } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  assert.deepEqual(issues, [], "the shipped sheet must parse cleanly");
  const level = levels.find((candidate) => candidate.id === id);
  assert.ok(level, `level ${id} missing from the sheet`);
  return level;
}

test("a lowercase colour code authors the same colour wrapped in one barrel layer", () => {
  const { levels, issues } = parseLevelSheet(sheet({ level: "20", name: "Shell", dims: "2x1x1", layers: "Rr" }));
  assert.deepEqual(issues, []);
  const blocks = levels[0].blocks;
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((block) => block.color), ["red", "red"]);
  assert.equal(blocks[0].barrelLayers, undefined, "an uppercase cell stays a plain block");
  assert.equal(blocks[1].barrelLayers, 1, "a lowercase cell carries one layer by default");
});

test("barrel_layers deepens the whole cluster it points at", () => {
  const { levels, issues } = parseLevelSheet(sheet({ level: "26", name: "Deep", dims: "2x1x1", layers: "bb", barrel_layers: "0.0.0:3" }));
  assert.deepEqual(issues, []);
  assert.deepEqual(levels[0].blocks.map((block) => block.barrelLayers), [3, 3], "one entry sets every block under the shell");
});

test("barrel_layers refuses a depth outside one to three", () => {
  const tooDeep = parseLevelSheet(sheet({ level: "27", name: "Deep", dims: "2x1x1", layers: "bb", barrel_layers: "0.0.0:4" }));
  assert.equal(tooDeep.levels.length, 0);
  assert.match(tooDeep.issues[0].message, /layer count from 1 to 3/);
});

test("barrel_layers pointing at an uncovered cluster is reported", () => {
  const { issues } = parseLevelSheet(sheet({ level: "28", name: "Plain", dims: "2x1x1", layers: "RR", barrel_layers: "0.0.0:2" }));
  assert.ok(issues.some((issue) => /no barrel/.test(issue.message)));
});

test("a barrel changes nothing about the colour inventory the goals must match", async () => {
  // createGameState throws when a colour's goals and blocks disagree, so a
  // level that loads at all proves the invariant still holds with barrels.
  const level = await shippedLevel(4);
  const blocks = new Map();
  for (const block of level.blocks) blocks.set(block.color, (blocks.get(block.color) ?? 0) + 1);
  const goals = new Map();
  for (const goal of level.goals) goals.set(goal.color, (goals.get(goal.color) ?? 0) + goal.target);
  assert.deepEqual([...goals.entries()].sort(), [...blocks.entries()].sort());
  const wrapped = level.blocks.filter((block) => block.barrelLayers);
  assert.ok(wrapped.length > 0, "level 4 must actually contain covered blocks");
});

test("links expand one authored cell per side into both whole clusters", () => {
  const { levels, issues } = parseLevelSheet(sheet({ level: "21", name: "Pair", dims: "2x1x2", layers: "RR|PP", links: "0.0.0>0.0.1" }));
  assert.deepEqual(issues, []);
  const blocks = levels[0].blocks;
  const groups = new Set(blocks.map((block) => block.linkGroup));
  assert.deepEqual([...groups], ["link-1"], "both clusters share one link group");
  assert.equal(blocks.filter((block) => block.linkGroup).length, 4, "all four blocks are linked, not just the two named cells");
});

test("a link pointing at an empty cell is reported instead of silently dropped", () => {
  const { levels, issues } = parseLevelSheet(sheet({ level: "22", name: "Bad", dims: "2x1x1", layers: "RR", links: "0.0.0>1.5.0" }));
  assert.equal(levels.length, 0);
  assert.match(issues[0].message, /points at the empty cell 1\.5\.0/);
});

test("a link with a malformed coordinate is reported", () => {
  const { issues } = parseLevelSheet(sheet({ level: "23", name: "Bad", dims: "2x1x1", layers: "RR", links: "0.0>1.0.0" }));
  assert.ok(issues.some((issue) => /invalid coordinate/.test(issue.message)));
});

test("a link naming the same cluster twice is reported", () => {
  const { issues } = parseLevelSheet(sheet({ level: "24", name: "Self", dims: "2x1x1", layers: "RR", links: "0.0.0>1.0.0" }));
  assert.ok(issues.some((issue) => /the same cluster twice/.test(issue.message)));
});

test("a cluster cannot be linked into two pairs at once", () => {
  const { issues } = parseLevelSheet(sheet({ level: "25", name: "Chain", dims: "3x1x2", layers: "RGB|PPP", links: "0.0.0>0.0.1;1.0.0>0.0.1" }));
  assert.ok(issues.some((issue) => /only be in one pair/.test(issue.message)));
});

test("level 4 offers both a one-layer barrel to reach indirectly and a three-layer one", async () => {
  const level = await shippedLevel(4);
  const wrapped = level.blocks.filter((block) => block.barrelLayers);
  const depths = new Set(wrapped.map((block) => block.barrelLayers));
  assert.deepEqual([...depths].sort(), [1, 3], "one shallow shell and one at full depth");

  // Path two of the draft: claiming a neighbouring cluster peels a layer, so
  // the level has to contain a plain cluster touching the shallow shell.
  const shallow = wrapped.filter((block) => block.barrelLayers === 1);
  const green = level.blocks.filter((block) => block.color === "green");
  const touches = green.some((cell) => shallow.some((shell) =>
    Math.abs(cell.x - shell.x) + Math.abs(cell.y - shell.y) + Math.abs(cell.z - shell.z) === 1));
  assert.ok(touches, "a plain cluster must sit next to the one-layer barrel to test the indirect path");

  // The deep shell must not be reachable from any plain cluster, or its colour
  // ramp would be cut short by an unrelated shot.
  const deep = wrapped.filter((block) => block.barrelLayers === 3);
  const plain = level.blocks.filter((block) => !block.barrelLayers);
  const accidental = plain.filter((cell) => deep.some((shell) =>
    Math.abs(cell.x - shell.x) + Math.abs(cell.y - shell.y) + Math.abs(cell.z - shell.z) === 1));
  assert.deepEqual(accidental.map((block) => block.id), [], "the three-layer shell must only be reachable by direct hits");
});

test("level 5 links two clusters of different colours", async () => {
  const level = await shippedLevel(5);
  const linked = level.blocks.filter((block) => block.linkGroup);
  assert.equal(linked.length, 8, "both four-block clusters are linked");
  const colors = new Set(linked.map((block) => block.color));
  assert.deepEqual([...colors].sort(), ["purple", "red"]);

  // The teaching point is shot order, which only exists if the linked partner's
  // goal is not already open next to the goal of the cluster being shot.
  const openingColors = level.goals.slice(0, level.activeGoalSlots).map((goal) => goal.color);
  assert.ok(openingColors.includes("red"), "the shot side should start with an open goal");
  assert.ok(!openingColors.includes("purple"), "the linked side must not start open, or there is no decision to make");
});
