import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditWeakPointRoutes, parseLevelSheet } from "../app/game/level-format.ts";
import { level01 } from "../app/game/level-01.ts";
import { computeModelPlayScale } from "../app/game/model-fit.ts";
import { createGameState, parkedBlockCount, resolveCluster } from "../app/game/rules.ts";

const sheetUrl = new URL("../work/levels.tsv", import.meta.url);
const HEADER = "level\tname\tdims\tlayers\tgoal_order\tgoal_split\tgoal_slots\tbatch_blocks\tshot_limit\tweak_points\trainbow_target_count\trainbow_spawn_gap\trainbow_target_duration\tnotes";

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
    weakPoints,
    hook.targetCount ?? "3",
    hook.spawnGap ?? "12",
    hook.duration ?? "7",
    notes,
  ].join("\t");
}

function sortById(items) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

const FACE_STEPS = {
  PX: [1, 0, 0], NX: [-1, 0, 0], PY: [0, 1, 0],
  NY: [0, -1, 0], PZ: [0, 0, 1], NZ: [0, 0, -1],
};

function blockKey(block) {
  return `${block.x}.${block.y}.${block.z}`;
}

function sameColorClusters(level) {
  const at = new Map(level.blocks.map((block) => [blockKey(block), block]));
  const seen = new Set();
  const clusters = [];
  for (const start of level.blocks) {
    if (seen.has(start.id)) continue;
    const queue = [start];
    const cluster = [];
    seen.add(start.id);
    while (queue.length) {
      const block = queue.shift();
      cluster.push(block);
      for (const [dx, dy, dz] of Object.values(FACE_STEPS)) {
        const neighbor = at.get(`${block.x + dx}.${block.y + dy}.${block.z + dz}`);
        if (!neighbor || neighbor.color !== block.color || seen.has(neighbor.id)) continue;
        seen.add(neighbor.id);
        queue.push(neighbor);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function weakPointRouteModel(level) {
  const clusters = sameColorClusters(level);
  const clusterIndexByBlock = new Map();
  clusters.forEach((cluster, clusterIndex) => {
    cluster.forEach((block) => clusterIndexByBlock.set(block.id, clusterIndex));
  });
  const blockAt = new Map(level.blocks.map((block) => [blockKey(block), block]));
  const blockersByCluster = clusters.map(() => []);
  for (const point of level.weakPoints) {
    const clusterIndex = clusterIndexByBlock.get(point.blockId);
    assert.notEqual(clusterIndex, undefined, `level ${level.id}: marker has no cluster`);
    const [dx, dy, dz] = FACE_STEPS[point.face];
    const blocker = blockAt.get(`${point.x + dx}.${point.y + dy}.${point.z + dz}`);
    blockersByCluster[clusterIndex].push(blocker ? clusterIndexByBlock.get(blocker.id) : null);
  }
  return { clusters, clusterIndexByBlock, blockersByCluster };
}

function reachableClusterIndices(model, clearedMask) {
  const reachable = [];
  for (let clusterIndex = 0; clusterIndex < model.clusters.length; clusterIndex += 1) {
    if (clearedMask & (1 << clusterIndex)) continue;
    if (model.blockersByCluster[clusterIndex].some(
      (blockerIndex) => blockerIndex === null || (clearedMask & (1 << blockerIndex)),
    )) {
      reachable.push(clusterIndex);
    }
  }
  return reachable;
}

function gameStateKey(clearedMask, state) {
  const goals = state.activeGoals
    .map((goal) => (goal ? `${goal.id}:${goal.current}` : "-"))
    .join(",");
  const batches = state.batches.map((batch) => `${batch.color}:${batch.count}`).join(",");
  return `${clearedMask}|${state.nextGoalIndex}|${goals}|${batches}|${state.result?.kind ?? "-"}`;
}

// Exhaust every legal reveal order. A cost of one means the player cleared a
// colour absent from both active goals; minimizing that cost proves a thinking
// beat is genuinely required instead of merely present in our example route.
function minimumOffGoalClears(level) {
  const model = weakPointRouteModel(level);
  const initialState = createGameState(level);
  const queue = [{ cost: 0, clearedMask: 0, state: initialState }];
  const best = new Map([[gameStateKey(0, initialState), 0]]);

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    const currentKey = gameStateKey(current.clearedMask, current.state);
    if (best.get(currentKey) !== current.cost) continue;
    if (current.state.result?.kind === "WIN" && current.state.result.allClear) return current.cost;

    for (const clusterIndex of reachableClusterIndices(model, current.clearedMask)) {
      const cluster = model.clusters[clusterIndex];
      const activeGoalColors = new Set(current.state.activeGoals.flatMap((goal) => (goal ? [goal.color] : [])));
      const offGoalCost = activeGoalColors.has(cluster[0].color) ? 0 : 1;
      const nextMask = current.clearedMask | (1 << clusterIndex);
      const nextState = resolveCluster(level, current.state, {
        color: cluster[0].color,
        count: cluster.length,
        shotIndex: current.state.shotIndex + 1,
        remainingBlockCount: current.state.remainingBlockCount - cluster.length,
      });
      if (nextState.result?.kind === "FAIL") continue;

      const nextCost = current.cost + offGoalCost;
      const nextKey = gameStateKey(nextMask, nextState);
      if ((best.get(nextKey) ?? Number.POSITIVE_INFINITY) <= nextCost) continue;
      best.set(nextKey, nextCost);
      queue.push({ cost: nextCost, clearedMask: nextMask, state: nextState });
    }
  }

  return Number.POSITIVE_INFINITY;
}

test("the Prism row of the shipped sheet rebuilds the hand written prototype level", async () => {
  const { levels, issues } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);
  // level01 stays the rich Prism board: it is the offline fallback and the
  // fixture every rules test is built on. The onboarding ramp took rows 1-5, so
  // that board is row 6 now. What this test pins is that the sheet and the
  // hand-written copy still describe the same level, not which row it sits on.
  const first = levels.find((level) => level.id === 6);
  assert.ok(first, "the Prism level is missing from the sheet");

  assert.deepEqual(sortById(first.blocks), sortById(level01.blocks));
  assert.deepEqual(first.goals, level01.goals);
  assert.equal(first.activeGoalSlots, level01.activeGoalSlots);
  assert.equal(first.reserveBlocks, level01.reserveBlocks);
  assert.equal(first.reserveBlocks, 8, "both sides have to carry a real number, not undefined on each");
  assert.equal(first.shotLimit, level01.shotLimit);
  assert.deepEqual(first.rainbow, level01.rainbow);
  assert.deepEqual(first.weakPoints, level01.weakPoints);
  assert.deepEqual(first.rainbow, level01.rainbow);
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
    HEADER.replace("rainbow_spawn_gap", "rainbow_spawn_gaps"),
    `${HEADER}\trainbow_spawn_gap`,
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

test("blank Rainbow cells use the 3/12/7 baseline defaults", () => {
  const row = levelRow("13\tDefaults\t2x1x1\tRR\tR\t\t\t\t\t", "0.0.0:NX", {
    targetCount: "",
    spawnGap: "",
    duration: "",
  });
  const { levels, issues } = parseLevelSheet(sheet(row));
  assert.deepEqual(issues, []);
  assert.deepEqual(levels[0].rainbow, {
    targetCount: 3,
    spawnGapSeconds: 12,
    targetDurationSeconds: 7,
  });
  // The round has no length any more, so nothing about it reaches the level.
  assert.equal("roundTimeSeconds" in levels[0], false);
});

test("authored Weak Points and Rainbow values reach LevelConfig", () => {
  const row = levelRow("14\tHooks\t3x1x1\tRRG\tR,G\t\t\t\t\t", "0.0.0:NX~2.0.0:PX", {
    targetCount: "2",
    spawnGap: "9.25",
    duration: "3.5",
  });
  const { levels, issues } = parseLevelSheet(sheet(row));
  assert.deepEqual(issues, []);
  assert.deepEqual(levels[0].weakPoints, [
    { id: "weak-point-block-0-0-0-nx", blockId: "block-0-0-0", x: 0, y: 0, z: 0, face: "NX" },
    { id: "weak-point-block-2-0-0-px", blockId: "block-2-0-0", x: 2, y: 0, z: 0, face: "PX" },
  ]);
  assert.deepEqual(levels[0].rainbow, {
    targetCount: 2,
    spawnGapSeconds: 9.25,
    targetDurationSeconds: 3.5,
  });
});

test("readable Weak Point face names follow the Puzzle's default local axes", () => {
  const aliases = [
    ["RIGHT", "PX"],
    ["left", "NX"],
    ["Top", "PY"],
    ["bOtToM", "NY"],
    ["FRONT", "PZ"],
    ["back", "NZ"],
  ];

  for (const [authored, canonical] of aliases) {
    const { levels, issues } = parseLevelSheet(sheet(levelRow(
      "15\tReadable face\t1x1x1\tR\tR\t\t\t\t\t",
      `0.0.0:${authored}`,
    )));
    assert.deepEqual(issues, [], authored);
    assert.equal(levels[0].weakPoints[0].face, canonical, authored);
    assert.match(levels[0].weakPoints[0].id, new RegExp(`-${canonical.toLowerCase()}$`), authored);
  }
});

test("a readable face alias and its legacy axis code are one Weak Point", () => {
  const { levels, issues } = parseLevelSheet(sheet(levelRow(
    "16\tDuplicate face alias\t1x1x1\tR\tR\t\t\t\t\t",
    "0.0.0:FRONT~0.0.0:PZ",
  )));
  assert.equal(levels.length, 0);
  assert.ok(issues.some((issue) => /declares 0\.0\.0:PZ more than once/.test(issue.message)));
});

test("a Weak Point covered by an adjacent block warns without dropping its level", () => {
  const { levels, issues } = parseLevelSheet(sheet(levelRow(
    "32\tCovered point\t2x1x1\tRG\tR,G\t\t\t\t\t",
    "0.0.0:PX~1.0.0:PX",
  )));
  assert.equal(levels.length, 1, "reachability is a design warning, not malformed row data");
  assert.ok(issues.every((issue) => issue.severity === "warning"));
  assert.ok(issues.some((issue) => /faces occupied cell 1\.0\.0 and may be inaccessible/.test(issue.message)));
  assert.ok(
    issues.some((issue) => /opening goal red has no immediately reachable cluster/.test(issue.message)),
    "the author also needs to know the opening goal cannot make immediate progress",
  );
});

test("a Weak Point covered by its own cluster gets a high-risk hard-lock warning", () => {
  const { levels, issues } = parseLevelSheet(sheet(levelRow(
    "33\tInternal point\t2x1x1\tRR\tR\t\t\t\t\t",
    "0.0.0:PX",
  )));
  assert.equal(levels.length, 1);
  assert.equal(issues[0]?.severity, "warning");
  assert.match(issues[0]?.message ?? "", /HIGH-RISK.*inside its own FACE_6 cluster.*another reachable Weak Point/);
  assert.ok(issues.some((issue) => /blocker cycle.*unreachable without a Rainbow bypass/.test(issue.message)));
});

test("a cross-colour Weak Point blocker cycle is detected", () => {
  const { levels, issues } = parseLevelSheet(sheet(levelRow(
    "34\tCycle\t2x1x1\tRG\tR,G\t\t\t\t\t",
    "0.0.0:PX~1.0.0:NX",
  )));
  assert.equal(levels.length, 1, "route risk remains advisory so a designer can inspect the row");
  assert.ok(issues.some((issue) => /blocker cycle leaves red cluster 1, green cluster 2 unreachable/.test(issue.message)));
});

test("a comma-separated sheet (Excel Save As CSV) parses the same as tab-separated", () => {
  const csvHeader = "level,name,dims,layers,goal_order,goal_split,goal_slots,batch_blocks,shot_limit,weak_points,rainbow_target_count,rainbow_spawn_gap,rainbow_target_duration,notes";
  const csvRow = '7,Split,3x3x2,PPP/OOO/RRR|RRR/PPP/OOO,"P,O,R",P:3+3,,,,0.2.0:NZ~0.1.0:NZ~0.0.0:NZ~0.2.1:PZ~0.1.1:PZ~0.0.1:PZ,3,12,4.5,';
  const { levels, issues } = parseLevelSheet([csvHeader, csvRow].join("\n"));
  assert.deepEqual(issues, []);
  assert.deepEqual(levels[0].goals.map((goal) => `${goal.color}${goal.target}`), ["purple3", "orange6", "red6", "purple3"]);
});

test("a semicolon-separated sheet (Excel on a comma-decimal locale) also parses", () => {
  const scHeader = "level;name;dims;layers;goal_order;goal_split;goal_slots;batch_blocks;shot_limit;weak_points;rainbow_target_count;rainbow_spawn_gap;rainbow_target_duration;notes";
  const scRow = "7;Split;3x3x2;PPP/OOO/RRR|RRR/PPP/OOO;P,O,R;P:3+3;;;;0.2.0:NZ~0.1.0:NZ~0.0.0:NZ~0.2.1:PZ~0.1.1:PZ~0.0.1:PZ;3;12;4.5;";
  const { levels, issues } = parseLevelSheet([scHeader, scRow].join("\n"));
  assert.deepEqual(issues, []);
  assert.deepEqual(levels[0].goals.map((goal) => `${goal.color}${goal.target}`), ["purple3", "orange6", "red6", "purple3"]);
});

test("the shipped .csv template parses to the exact same levels as the .tsv", async () => {
  const csvUrl = new URL("../work/levels.csv", import.meta.url);
  const csvText = await readFile(csvUrl, "utf8");
  const tsvResult = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  const csvResult = parseLevelSheet(csvText);
  assert.deepEqual(csvResult.issues.filter((issue) => issue.severity === "error"), []);
  assert.deepEqual(csvResult.levels, tsvResult.levels);
  // Including the reachability warnings, or the two templates would be allowed
  // to author different Weak Points and still pass.
  assert.deepEqual(csvResult.issues, tsvResult.issues);
});

test("campaign keeps its existing rows and adds one framed pixel-art relief", async () => {
  const { levels, issues } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);
  assert.deepEqual(levels.map((level) => level.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const trial = levels.find((level) => level.id === 1);
  assert.ok(trial);
  assert.equal(trial.name, "Umbrella Trial");
  assert.equal(trial.blocks.length, 132);
  assert.deepEqual(
    Object.fromEntries([...trial.blocks.reduce((counts, block) => {
      counts.set(block.color, (counts.get(block.color) ?? 0) + 1);
      return counts;
    }, new Map()).entries()].sort()),
    { blue: 26, green: 16, orange: 34, purple: 20, red: 16, yellow: 20 },
  );
  assert.deepEqual(
    trial.goals.map((goal) => `${goal.color}:${goal.target}`),
    ["yellow:20", "orange:34", "blue:26", "purple:20", "red:16", "green:16"],
  );
  assert.equal(trial.activeGoalSlots, 2, "the existing two-card HUD remains unchanged");
  assert.equal(trial.reserveBlocks, 38);
  assert.deepEqual(trial.weakPoints.map((point) => point.face), ["PZ", "NX", "NX", "PX", "PZ", "NZ"]);
  assert.deepEqual(trial.rainbow, { targetCount: 1, spawnGapSeconds: 36, targetDurationSeconds: 7 });
  const trialScale = computeModelPlayScale(trial.blocks, 0.92, 1.02);
  assert.ok(trialScale > 0.42 && trialScale < 0.43, `unexpected Umbrella fit scale ${trialScale}`);
  assert.equal(
    computeModelPlayScale(levels.find((level) => level.id === 6).blocks, 0.92, 1.02),
    1,
    "the existing Prism and every smaller board keep their original gameplay scale",
  );

  const portrait = levels.find((level) => level.id === 9);
  assert.ok(portrait);
  assert.equal(portrait.name, "Pixel Spark Portrait");
  assert.equal(portrait.blocks.length, 187);
  assert.deepEqual(
    Object.fromEntries([...portrait.blocks.reduce((counts, block) => {
      counts.set(block.color, (counts.get(block.color) ?? 0) + 1);
      return counts;
    }, new Map()).entries()].sort()),
    { black: 79, gray: 23, orange: 30, red: 4, yellow: 51 },
  );
  assert.deepEqual(
    portrait.goals.map((goal) => `${goal.color}:${goal.target}`),
    ["yellow:51", "orange:30", "gray:23", "red:4", "black:79"],
  );
  assert.equal(portrait.activeGoalSlots, 2);
  assert.equal(portrait.reserveBlocks, 74);
  assert.equal(portrait.weakPoints.length, 9);
  assert.deepEqual(portrait.rainbow, { targetCount: 0, spawnGapSeconds: 12, targetDurationSeconds: 7 });
  const portraitScale = computeModelPlayScale(portrait.blocks, 0.92, 1.02);
  assert.ok(portraitScale > 0.288 && portraitScale < 0.29, `unexpected portrait fit scale ${portraitScale}`);

  assert.deepEqual(
    levels.filter((level) => level.id >= 2 && level.id <= 8).map((level) => [
      level.id,
      level.name,
      level.blocks.length,
      level.goals.length,
      level.activeGoalSlots,
      level.reserveBlocks,
      level.weakPoints.length,
    ]),
    [
      [2, "Turn to look", 4, 2, 2, 2, 2],
      [3, "Park it", 4, 3, 2, 2, 3],
      [4, "Read the order", 8, 3, 2, 4, 3],
      [5, "Full sweep", 12, 5, 2, 4, 5],
      [6, "Prism 4x3x2", 24, 6, 2, 8, 8],
      [7, "Interleaved layers", 16, 4, 2, 8, 8],
      [8, "Split purple goal", 18, 4, 2, 8, 6],
    ],
  );
});

test("the shipped sheet alternates immediate goal hits with acyclic blocker reveals", async () => {
  const { levels, issues } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);

  // The reveal shape is authored per level, not held to one universal rule.
  // Row 1 deliberately stress-tests a long chain; the normal onboarding rows
  // stay short before the shipped boards at 5, 4 and 3 waves.
  const pacing = new Map([
    [1, { waves: 6, forcesReserveFirst: true }],
    [2, { waves: 1 }],
    // The only cluster in reach is off-goal, which is the entire lesson: the
    // reserve is where a claim goes when no goal will take it.
    [3, { waves: 2, forcesReserveFirst: true }],
    [4, { waves: 2 }],
    [5, { waves: 2 }],
    [6, { waves: 5 }],
    [7, { waves: 4 }],
    [8, { waves: 3 }],
    [9, { waves: 2 }],
  ]);

  for (const level of levels) {
    const audit = auditWeakPointRoutes(level.blocks, level.weakPoints);
    const spec = pacing.get(level.id);
    assert.ok(spec, `level ${level.id}: no authored pacing expectation`);

    // Universal, every level: one marker per cluster keeps the board readable,
    // and no cluster may be walled off behind a cycle.
    assert.equal(level.weakPoints.length, audit.clusterColors.length, `level ${level.id}: one marker per cluster`);
    assert.ok(audit.pointCounts.every((count) => count === 1), `level ${level.id}: duplicate marker in a cluster`);
    assert.deepEqual(audit.unreachableClusterIndices, [], `level ${level.id}: blocker cycle`);
    assert.equal(audit.waves.length, spec.waves, `level ${level.id}: reveal beats`);

    const openingColors = new Set((audit.waves[0] ?? []).map((index) => audit.clusterColors[index]));
    const openingGoals = level.goals.slice(0, level.activeGoalSlots).map((goal) => goal.color);
    if (spec.forcesReserveFirst) {
      assert.deepEqual(
        openingGoals.filter((color) => openingColors.has(color)),
        [],
        `level ${level.id}: this lesson only teaches the reserve if every opening goal is covered`,
      );
    } else {
      assert.deepEqual(
        openingGoals.filter((color) => !openingColors.has(color)),
        [],
        `level ${level.id}: an opening goal has no cluster the player can reach`,
      );
    }
  }

  // Row 1 is deliberately isolated as the large-model experiment. The normal
  // onboarding size curve therefore starts at row 2 and stays intact through 5.
  const ramp = [2, 3, 4, 5].map((id) => levels.find((level) => level.id === id));
  assert.ok(ramp.every(Boolean), "levels 2-5 are the unchanged onboarding ramp");
  for (let index = 1; index < ramp.length; index += 1) {
    assert.ok(
      ramp[index].blocks.length >= ramp[index - 1].blocks.length,
      `level ${ramp[index].id} is smaller than the level before it`,
    );
  }

  // Rainbow Climax is rare on purpose. Two in one round meant the next arrived
  // before the last had left, which made a bonus read as the normal state, so the
  // cap is one per level and most levels get none at all.
  for (const level of levels) {
    assert.ok(
      level.rainbow.targetCount <= 1,
      `level ${level.id} schedules ${level.rainbow.targetCount} Rainbow Targets; the cap is 1`,
    );
  }
  const withBonus = levels.filter((level) => level.rainbow.targetCount > 0);
  assert.ok(
    withBonus.length * 2 <= levels.length,
    `${withBonus.length} of ${levels.length} levels carry a bonus; it stops being rare past half`,
  );
  // Skipped levels are the point: the pattern has gaps rather than tapering in.
  assert.deepEqual(levels.map((level) => level.rainbow.targetCount), [1, 0, 0, 0, 1, 1, 0, 1, 0]);
  // A bonus in the opening seconds is not a reward for a long round. The first
  // target lands at gap x 0.5-1.0, so a floor of 24 keeps it out of the first 12
  // seconds — which is most of a teaching level, hence none of them carry one.
  for (const level of withBonus) {
    assert.ok(
      level.rainbow.spawnGapSeconds >= 24,
      `level ${level.id} can spawn its bonus after ${level.rainbow.spawnGapSeconds * 0.5}s`,
    );
  }

  // An inner face is one whose neighbour cell is occupied, so these warnings
  // document intentional reveals rather than malformed data.
  const covered = issues.filter((issue) => /may be inaccessible until that block is removed/.test(issue.message));
  assert.equal(covered.length, 27, `expected one warning for every delayed reveal, found ${covered.length}`);
  assert.deepEqual(
    issues.filter((issue) => /HIGH-RISK/.test(issue.message)),
    [],
    "the shipped dependency graph must not need a Rainbow bypass",
  );
});

test("shipped routes balance continuous progress with one forced off-goal decision", async () => {
  const { levels } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  const routes = new Map([
    // Row 1 is the isolated 132-block trial. Green is the only opening mark,
    // so its 16 blocks must wait in reserve before the five covered marks peel
    // open in order; Green auto-fills when its goal finally enters the window.
    [1, {
      anchors: ["2.5.7", "3.5.7", "6.5.7", "3.5.4", "3.5.2", "5.5.3"],
      parkedAfter: [16, 16, 16, 16, 0, 0],
      forcedOffGoalSteps: 1,
    }],
    // Level 2 remains the compact two-claim lesson.
    [2, { anchors: ["1.1.0", "0.0.0"], parkedAfter: [0, 0], forcedOffGoalSteps: 0 }],
    // 3: the front pair covers both goal marks, so Yellow is parked before
    // anything can be sorted, and the auto-fill hands it back on step 2.
    [3, { anchors: ["0.1.1", "0.1.0", "0.0.0"], parkedAfter: [2, 0, 0], forcedOffGoalSteps: 1 }],
    // 4: front mark, back mark, then the cluster the first claim uncovered.
    [4, { anchors: ["0.1.1", "0.0.0", "0.1.0"], parkedAfter: [0, 0, 0], forcedOffGoalSteps: 0 }],
    // 5: every part at once, still solvable without spending the reserve.
    [5, {
      anchors: ["1.1.1", "0.1.1", "0.0.1", "1.1.0", "2.0.0"],
      parkedAfter: [0, 0, 0, 0, 0],
      forcedOffGoalSteps: 0,
    }],
    [6, {
      anchors: ["0.2.1", "0.0.1", "0.0.0", "0.1.0", "0.1.1", "0.2.0", "3.2.0", "3.0.0"],
      parkedAfter: [0, 0, 0, 0, 0, 0, 0, 0],
      forcedOffGoalSteps: 0,
    }],
    [7, {
      anchors: ["2.1.1", "0.1.1", "0.1.0", "2.0.1", "2.0.0", "2.1.0", "0.0.1", "0.0.0"],
      parkedAfter: [0, 0, 0, 0, 2, 0, 0, 0],
      forcedOffGoalSteps: 1,
    }],
    [8, {
      anchors: ["0.1.1", "0.0.1", "0.1.0", "0.2.1", "0.0.0", "0.2.0"],
      parkedAfter: [0, 0, 0, 0, 0, 0],
      forcedOffGoalSteps: 0,
    }],
    // 9: clear the raised pigment first; the two Black markers beneath Yellow
    // and Orange then reveal with the exterior-only pop before the frame leaves.
    [9, {
      anchors: ["6.8.1", "8.3.1", "1.10.1", "6.11.0", "1.2.0", "11.3.0", "9.6.1", "10.1.0", "5.6.0"],
      parkedAfter: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      forcedOffGoalSteps: 0,
    }],
  ]);

  for (const level of levels) {
    const model = weakPointRouteModel(level);
    const activeCoordinates = new Set(level.blocks.map(blockKey));
    let state = createGameState(level);
    let remaining = level.blocks.length;
    let clearedMask = 0;
    let forcedOffGoalSteps = 0;

    const route = routes.get(level.id);
    assert.ok(route, `level ${level.id}: missing canonical route`);
    for (const [step, anchor] of route.anchors.entries()) {
      const anchorBlock = level.blocks.find((block) => blockKey(block) === anchor);
      assert.ok(anchorBlock, `level ${level.id}: route anchor ${anchor}`);
      const clusterIndex = model.clusterIndexByBlock.get(anchorBlock.id);
      const cluster = model.clusters[clusterIndex];
      assert.ok(cluster.some((block) => activeCoordinates.has(blockKey(block))), `level ${level.id}: cluster repeated`);
      const reachable = reachableClusterIndices(model, clearedMask);
      assert.ok(reachable.includes(clusterIndex), `level ${level.id}: route chose hidden cluster ${anchor}`);
      const activeGoalColors = new Set(state.activeGoals.flatMap((goal) => (goal ? [goal.color] : [])));
      if (!activeGoalColors.has(cluster[0].color)) {
        const reachableGoalClusters = reachable.filter(
          (index) => activeGoalColors.has(model.clusters[index][0].color),
        );
        assert.deepEqual(
          reachableGoalClusters,
          [],
          `level ${level.id}: off-goal step ${step + 1} was optional rather than a real blocker decision`,
        );
        forcedOffGoalSteps += 1;
      }
      const clusterIds = new Set(cluster.map((block) => block.id));
      const points = level.weakPoints.filter((point) => clusterIds.has(point.blockId));
      assert.equal(points.length, 1, `level ${level.id}: route cluster marker count`);
      const point = points[0];
      const [dx, dy, dz] = FACE_STEPS[point.face];
      assert.equal(
        activeCoordinates.has(`${point.x + dx}.${point.y + dy}.${point.z + dz}`),
        false,
        `level ${level.id}: step ${step + 1} reaches ${anchor} before its blocker leaves`,
      );

      cluster.forEach((block) => activeCoordinates.delete(blockKey(block)));
      clearedMask |= 1 << clusterIndex;
      remaining -= cluster.length;
      state = resolveCluster(level, state, {
        color: cluster[0].color,
        count: cluster.length,
        shotIndex: step + 1,
        remainingBlockCount: remaining,
      });
      assert.notEqual(state.result?.kind, "FAIL", `level ${level.id}: route failed at ${anchor}`);
      assert.equal(
        parkedBlockCount(state),
        route.parkedAfter[step],
        `level ${level.id}: unexpected reserve load after ${anchor}`,
      );
    }

    assert.equal(forcedOffGoalSteps, route.forcedOffGoalSteps, `level ${level.id}: forced thinking beats`);
    assert.equal(state.result?.kind, "WIN", `level ${level.id}: route did not win`);
    assert.equal(state.result?.allClear, true, `level ${level.id}: route left blocks behind`);
    assert.equal(
      minimumOffGoalClears(level),
      level.id === 1 || level.id === 3 || level.id === 7 ? 1 : 0,
      `level ${level.id}: minimum unavoidable off-goal clears`,
    );
  }
});
