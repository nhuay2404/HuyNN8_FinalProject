import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { auditWeakPointRoutes, parseLevelSheet } from "../app/game/level-format.ts";
import { level01 } from "../app/game/level-01.ts";
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

test("row 1 of the shipped sheet rebuilds the hand written prototype level", async () => {
  const { levels, issues } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);
  const first = levels.find((level) => level.id === 1);
  assert.ok(first, "level 1 is missing from the sheet");

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

test("the shipped sheet alternates immediate goal hits with acyclic blocker reveals", async () => {
  const { levels, issues } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);

  // One marker per cluster keeps the board readable. Exactly one cluster for
  // each opening goal is available immediately; the rest arrive in short,
  // acyclic reveal waves instead of all being optional fallbacks.
  for (const level of levels) {
    const audit = auditWeakPointRoutes(level.blocks, level.weakPoints);
    assert.equal(level.weakPoints.length, audit.clusterColors.length, `level ${level.id}: one marker per cluster`);
    assert.ok(audit.pointCounts.every((count) => count === 1), `level ${level.id}: duplicate marker in a cluster`);
    assert.equal(audit.waves[0]?.length, level.activeGoalSlots, `level ${level.id}: opening choice count`);
    assert.deepEqual(
      (audit.waves[0] ?? []).map((index) => audit.clusterColors[index]).sort(),
      level.goals.slice(0, level.activeGoalSlots).map((goal) => goal.color).sort(),
      `level ${level.id}: opening markers must match the visible goals`,
    );
    assert.ok(audit.waves.length >= 3, `level ${level.id}: needs multiple reveal beats`);
    assert.deepEqual(audit.unreachableClusterIndices, [], `level ${level.id}: blocker cycle`);
  }

  // An inner face is one whose neighbour cell is occupied, so these warnings
  // document intentional reveals rather than malformed data.
  const covered = issues.filter((issue) => /may be inaccessible until that block is removed/.test(issue.message));
  assert.equal(covered.length, 16, `expected one warning for every delayed reveal, found ${covered.length}`);
  assert.deepEqual(
    issues.filter((issue) => /HIGH-RISK/.test(issue.message)),
    [],
    "the shipped dependency graph must not need a Rainbow bypass",
  );
});

test("shipped routes balance continuous progress with one forced off-goal decision", async () => {
  const { levels } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  const routes = new Map([
    [1, {
      anchors: ["0.2.1", "0.0.1", "0.0.0", "0.1.0", "0.1.1", "0.2.0", "3.2.0", "3.0.0"],
      parkedAfter: [0, 0, 0, 0, 0, 0, 0, 0],
      forcedOffGoalSteps: 0,
    }],
    [2, {
      anchors: ["2.1.1", "0.1.1", "0.1.0", "2.0.1", "2.0.0", "2.1.0", "0.0.1", "0.0.0"],
      parkedAfter: [0, 0, 0, 0, 2, 0, 0, 0],
      forcedOffGoalSteps: 1,
    }],
    [3, {
      anchors: ["0.1.1", "0.0.1", "0.1.0", "0.2.1", "0.0.0", "0.2.0"],
      parkedAfter: [0, 0, 0, 0, 0, 0],
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
      level.id === 2 ? 1 : 0,
      `level ${level.id}: minimum unavoidable off-goal clears`,
    );
  }
});
