import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseLevelSheet } from "../app/game/level-format.ts";
import { level01 } from "../app/game/level-01.ts";

const sheetUrl = new URL("../work/levels.tsv", import.meta.url);
const HEADER = "level\tname\tdims\tlayers\tgoal_order\tgoal_split\tgoal_slots\tbatch_blocks\tshot_limit\tround_time\tweak_points\trainbow_trigger\trainbow_target_count\trainbow_spawn_gap\trainbow_target_duration\trainbow_reward_sec\trainbow_paths\tnotes";

function sheet(...rows) {
  return [HEADER, ...rows].join("\n");
}

function levelRow(baseRow, weakPoints, hook = {}) {
  const cells = baseRow.split("\t");
  while (cells.length < 10) cells.push("");
  assert.equal(cells.length, 10, "base level test rows use the original ten-column shape");
  const notes = cells.pop();
  return [
    ...cells,
    hook.roundTime ?? "90",
    weakPoints,
    hook.trigger ?? "25",
    hook.targetCount ?? "3",
    hook.spawnGap ?? "2",
    hook.duration ?? "4",
    hook.reward ?? "5",
    hook.paths ?? "1|8|11",
    notes,
  ].join("\t");
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
  assert.equal(first.reserveBlocks, level01.reserveBlocks);
  assert.equal(first.reserveBlocks, 8, "both sides have to carry a real number, not undefined on each");
  assert.equal(first.shotLimit, level01.shotLimit);
  assert.equal(first.roundTimeSeconds, level01.roundTimeSeconds);
  assert.deepEqual(first.weakPoints, level01.weakPoints);
  assert.deepEqual(first.rainbow, level01.rainbow);
  assert.equal(first.roundTimeTriggerPolicy, "REQUIRE_ROUND_TIME_ABOVE_TRIGGER_TEMP");
  assert.equal(first.adjacency.z, true);
  assert.equal(first.batchPriority, "OLDEST_FIRST_TEMP");
});

test("a reserve budget below the biggest cluster is rejected at author time", () => {
  // The claim would be legal and unplayable: nothing can split a cluster across
  // the reserve, so a budget under its size is a level nobody can finish.
  const tooSmall = parseLevelSheet(sheet(levelRow("1\tTight\t2x1x1\tRR\tR\t\t\t1\t\t", "0.0.0:NX")));
  assert.equal(tooSmall.levels.length, 0, "the row is dropped, not shipped half-broken");
  assert.match(tooSmall.issues.map((issue) => issue.message).join(" "), /biggest cluster is 2 blocks/);

  const exact = parseLevelSheet(sheet(levelRow("1\tTight\t2x1x1\tRR\tR\t\t\t2\t\t", "0.0.0:NX")));
  assert.deepEqual(exact.issues, [], "a budget equal to the biggest cluster is enough");
  assert.equal(exact.levels[0].reserveBlocks, 2);
});

test("a sheet still carrying a retired column says so instead of changing meaning", () => {
  // A shipped HTML file keeps its own copy of the sheet, and a cell the parser
  // no longer reads would otherwise fall back to a default in silence.
  for (const [column, value] of [["barrel_layers", "0.0.0:2"], ["links", "0.0.0>1.0.0"], ["batch_slots", ""]]) {
    const header = `level\tname\tdims\tlayers\tgoal_order\t${column}`;
    const row = `1\tOld\t2x1x1\tRR\tR\t${value}`;
    const { levels, issues } = parseLevelSheet([header, row].join("\n"));
    assert.equal(levels.length, 0, `${column} should stop the row`);
    assert.match(issues.map((issue) => issue.message).join(" "), new RegExp(`"${column}" column is no longer read`));
  }
});

test("unknown and duplicate headers are rejected before defaults can hide a typo", () => {
  for (const badHeader of [
    HEADER.replace("rainbow_reward_sec", "rainbow_reward_secs"),
    `${HEADER}\trainbow_reward_sec`,
  ]) {
    const { levels, issues } = parseLevelSheet([badHeader, levelRow(
      "6\tBad header\t1x1x1\tR\tR\t\t\t\t\t",
      "0.0.0:PX",
    )].join("\n"));
    assert.equal(levels.length, 0);
    assert.ok(issues.some((issue) => /not recognized|more than once/.test(issue.message)));
  }
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
  const weakPoints = "0.2.0:NZ~0.1.0:NZ~0.0.0:NZ~0.2.1:PZ~0.1.1:PZ~0.0.1:PZ";
  const { levels, issues } = parseLevelSheet(sheet(levelRow(
    "7\tSplit\t3x3x2\tPPP/OOO/RRR|RRR/PPP/OOO\tP,O,R\tP:3+3\t\t\t\t",
    weakPoints,
  )));
  assert.deepEqual(issues, []);
  assert.deepEqual(levels[0].goals.map((goal) => `${goal.color}${goal.target}`), ["purple3", "orange6", "red6", "purple3"]);
});

test("a shape that does not match its dims is reported and skipped", () => {
  const { levels, issues } = parseLevelSheet(sheet(levelRow(
    "8\tBad\t4x3x2\tRRR/BBBB/GGGG|RRRR/BBBB/GGGG\t\t\t\t\t\t",
    "",
  )));
  assert.equal(levels.length, 0);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /row 1 has 3 cells but dims says 4/);
  assert.equal(issues[0].level, "8");
});

test("a split that does not add up to the block count is reported", () => {
  const { levels, issues } = parseLevelSheet(sheet(levelRow(
    "9\tBad split\t2x1x1\tRR\tR\tR:1+3\t\t\t\t",
    "0.0.0:PX",
  )));
  assert.equal(levels.length, 0, "a row with any problem is not loaded at all");
  assert.match(issues[0].message, /adds up to 4 but the level has 2 blocks/);
});

test("two goals of one color opening in the same window is reported", () => {
  const { issues } = parseLevelSheet(sheet(levelRow(
    "10\tClash\t4x1x1\tRRRR\tR\tR:2+2\t\t\t\t",
    "0.0.0:PX",
  )));
  assert.ok(issues.some((issue) => /open two of the same colour at once/.test(issue.message)));
});

test("duplicate level numbers are rejected", () => {
  const { levels, issues } = parseLevelSheet(sheet(
    levelRow("11\tFirst\t2x1x1\tRR\t\t\t\t\t\t", "0.0.0:NX"),
    levelRow("11\tSecond\t2x1x1\tGG\t\t\t\t\t\t", "0.0.0:NX"),
  ));
  assert.equal(levels.length, 1);
  assert.match(issues[0].message, /level 11 already exists on row/);
});

test("unknown color characters and duplicate cells are reported", () => {
  const { issues } = parseLevelSheet(sheet(levelRow(
    "12\tTypo\t2x1x1\tRZ\t\t\t\t\t\t",
    "0.0.0:PX",
  )));
  assert.ok(issues.some((issue) => /colour code "Z" is not valid/.test(issue.message)));
});

test("blank hook cells use the 90/25/3/2/4/5 baseline defaults", () => {
  const row = levelRow("13\tDefaults\t2x1x1\tRR\tR\t\t\t\t\t", "0.0.0:NX", {
    roundTime: "",
    trigger: "",
    targetCount: "",
    spawnGap: "",
    duration: "",
    reward: "",
    paths: "",
  });
  const { levels, issues } = parseLevelSheet(sheet(row));
  assert.deepEqual(issues, []);
  assert.equal(levels[0].roundTimeSeconds, 90);
  assert.deepEqual(levels[0].rainbow, {
    triggerSeconds: 25,
    targetCount: 3,
    spawnGapSeconds: 2,
    targetDurationSeconds: 4,
    rewardSeconds: 5,
    pathIds: [1, 8, 11],
  });
});

test("authored Weak Points and Rainbow timing/path values reach LevelConfig", () => {
  const row = levelRow("14\tHooks\t3x1x1\tRRG\tR,G\t\t\t\t\t", "0.0.0:NX~2.0.0:PX", {
    roundTime: "72.5",
    trigger: "20.5",
    targetCount: "2",
    spawnGap: "1.25",
    duration: "3.5",
    reward: "6.5",
    paths: "12|2",
  });
  const { levels, issues } = parseLevelSheet(sheet(row));
  assert.deepEqual(issues, []);
  assert.equal(levels[0].roundTimeSeconds, 72.5);
  assert.deepEqual(levels[0].weakPoints, [
    { id: "weak-point-block-0-0-0-nx", blockId: "block-0-0-0", x: 0, y: 0, z: 0, face: "NX" },
    { id: "weak-point-block-2-0-0-px", blockId: "block-2-0-0", x: 2, y: 0, z: 0, face: "PX" },
  ]);
  assert.deepEqual(levels[0].rainbow, {
    triggerSeconds: 20.5,
    targetCount: 2,
    spawnGapSeconds: 1.25,
    targetDurationSeconds: 3.5,
    rewardSeconds: 6.5,
    pathIds: [12, 2],
  });
});

test("Weak Point coordinates, blocks, faces, and duplicates are validated atomically", () => {
  const invalidCases = [
    ["0.0:PX", /must look like x\.y\.z:FACE/],
    ["2.0.0:PX", /outside dims 2x1x1/],
    ["1.0.0:PX", /points to an empty cell/],
    ["0.0.0:QX", /face "QX" is not valid/],
    ["0.0.0:PX~0.0.0:PX", /declares 0\.0\.0:PX more than once/],
  ];
  invalidCases.forEach(([weakPoints, expected], index) => {
    const base = `${20 + index}\tBad point\t2x1x1\tR.\tR\t\t\t\t\t`;
    const { levels, issues } = parseLevelSheet(sheet(levelRow(base, weakPoints)));
    assert.equal(levels.length, 0, `case ${weakPoints} must drop the whole row`);
    assert.ok(issues.some((issue) => expected.test(issue.message)), weakPoints);
  });
});

test("every same-colour FACE_6 cluster must have between one and three Weak Points", () => {
  const missing = parseLevelSheet(sheet(levelRow(
    "30\tMissing cluster\t3x1x1\tR.G\tR,G\t\t\t\t\t",
    "0.0.0:PX",
  )));
  assert.equal(missing.levels.length, 0);
  assert.ok(missing.issues.some((issue) => /green cluster.*has 0 Weak Points; expected 1 to 3/.test(issue.message)));

  const tooMany = parseLevelSheet(sheet(levelRow(
    "31\tToo many\t1x1x1\tR\tR\t\t\t\t\t",
    "0.0.0:PX~0.0.0:NX~0.0.0:PY~0.0.0:NY",
  )));
  assert.equal(tooMany.levels.length, 0);
  assert.ok(tooMany.issues.some((issue) => /has 4 Weak Points; expected 1 to 3/.test(issue.message)));
});

test("a Weak Point covered by an adjacent block warns without dropping its level", () => {
  const { levels, issues } = parseLevelSheet(sheet(levelRow(
    "32\tCovered point\t2x1x1\tRG\tR,G\t\t\t\t\t",
    "0.0.0:PX~1.0.0:PX",
  )));
  assert.equal(levels.length, 1, "reachability is a design warning, not malformed row data");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, "warning");
  assert.match(issues[0].message, /faces occupied cell 1\.0\.0 and may be inaccessible/);
});

test("a Weak Point covered by its own cluster gets a high-risk hard-lock warning", () => {
  const { levels, issues } = parseLevelSheet(sheet(levelRow(
    "33\tInternal point\t2x1x1\tRR\tR\t\t\t\t\t",
    "0.0.0:PX",
  )));
  assert.equal(levels.length, 1);
  assert.equal(issues[0]?.severity, "warning");
  assert.match(issues[0]?.message ?? "", /HIGH-RISK.*inside its own FACE_6 cluster.*another reachable Weak Point/);
});

test("Rainbow paths stay in 1..12 and match rainbow_target_count", () => {
  for (const badPaths of ["0|2|3", "1|2|13", "1|two|3"]) {
    const { levels, issues } = parseLevelSheet(sheet(levelRow(
      "40\tBad path\t1x1x1\tR\tR\t\t\t\t\t",
      "0.0.0:PX",
      { paths: badPaths },
    )));
    assert.equal(levels.length, 0);
    assert.ok(issues.some((issue) => /integer from 1 to 12/.test(issue.message)), badPaths);
  }

  const mismatch = parseLevelSheet(sheet(levelRow(
    "41\tWrong count\t1x1x1\tR\tR\t\t\t\t\t",
    "0.0.0:PX",
    { targetCount: "2", paths: "1|8|11" },
  )));
  assert.equal(mismatch.levels.length, 0);
  assert.ok(mismatch.issues.some((issue) => /has 3 paths but rainbow_target_count is 2/.test(issue.message)));
});

test("TEMP timing policy rejects a round that starts at or below its Rainbow trigger", () => {
  for (const roundTime of ["25", "20"]) {
    const { levels, issues } = parseLevelSheet(sheet(levelRow(
      "50\tImmediate event\t1x1x1\tR\tR\t\t\t\t\t",
      "0.0.0:PX",
      { roundTime, trigger: "25" },
    )));
    assert.equal(levels.length, 0);
    assert.ok(issues.some((issue) => /TEMP policy rejects an immediate start-of-round trigger/.test(issue.message)));
  }
});

test("a comma-separated sheet (Excel Save As CSV) parses the same as tab-separated", () => {
  const csvHeader = "level,name,dims,layers,goal_order,goal_split,goal_slots,batch_blocks,shot_limit,round_time,weak_points,rainbow_trigger,rainbow_target_count,rainbow_spawn_gap,rainbow_target_duration,rainbow_reward_sec,rainbow_paths,notes";
  const csvRow = '7,Split,3x3x2,PPP/OOO/RRR|RRR/PPP/OOO,"P,O,R",P:3+3,,,,90,0.2.0:NZ~0.1.0:NZ~0.0.0:NZ~0.2.1:PZ~0.1.1:PZ~0.0.1:PZ,25,3,2,4,5,1|8|11,';
  const { levels, issues } = parseLevelSheet([csvHeader, csvRow].join("\n"));
  assert.deepEqual(issues, []);
  assert.deepEqual(levels[0].goals.map((goal) => `${goal.color}${goal.target}`), ["purple3", "orange6", "red6", "purple3"]);
});

test("a semicolon-separated sheet (Excel on a comma-decimal locale) also parses", () => {
  const scHeader = "level;name;dims;layers;goal_order;goal_split;goal_slots;batch_blocks;shot_limit;round_time;weak_points;rainbow_trigger;rainbow_target_count;rainbow_spawn_gap;rainbow_target_duration;rainbow_reward_sec;rainbow_paths;notes";
  const scRow = "7;Split;3x3x2;PPP/OOO/RRR|RRR/PPP/OOO;P,O,R;P:3+3;;;;90;0.2.0:NZ~0.1.0:NZ~0.0.0:NZ~0.2.1:PZ~0.1.1:PZ~0.0.1:PZ;25;3;2;4;5;1|8|11;";
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
