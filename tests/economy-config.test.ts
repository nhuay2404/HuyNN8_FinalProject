// `parseEconomyConfigCsv` — the pure half of `economy-config.ts`. Same
// coverage shape as `tests/level-rewards.test.ts` for its sibling parser;
// see that file's header for why the fetch/poll orchestration itself is not
// exercised here.

import assert from "node:assert/strict";
import test from "node:test";
import { parseEconomyConfigCsv } from "../app/game/economy-config.ts";

test("parses key/value pairs", () => {
  const csv = "key,value\nstarterGold,150\nboosterPriceRadiusOvercharge,75\n";
  assert.deepEqual(parseEconomyConfigCsv(csv), [
    { key: "starterGold", value: 150 },
    { key: "boosterPriceRadiusOvercharge", value: 75 },
  ]);
});

test("skips comment lines and blank lines", () => {
  const csv = [
    "# a comment",
    "key,value",
    "",
    "starterGold,150",
    "# another comment",
    "",
  ].join("\n");
  assert.deepEqual(parseEconomyConfigCsv(csv), [{ key: "starterGold", value: 150 }]);
});

test("column order does not matter, as long as the header names do", () => {
  assert.deepEqual(parseEconomyConfigCsv("value,key\n75,boosterPriceRadiusOvercharge\n"), [
    { key: "boosterPriceRadiusOvercharge", value: 75 },
  ]);
});

test("a row with a non-numeric value is dropped, not thrown", () => {
  const csv = "key,value\nstarterGold,150\nboosterPricePrismShot,not-a-number\n";
  assert.deepEqual(parseEconomyConfigCsv(csv), [{ key: "starterGold", value: 150 }]);
});

test("a row with an empty key is dropped", () => {
  assert.deepEqual(parseEconomyConfigCsv("key,value\n,150\n"), []);
});

test("unlike level-rewards, a negative value is kept — this sheet has no blanket sign rule", () => {
  assert.deepEqual(parseEconomyConfigCsv("key,value\nsomeKey,-5\n"), [{ key: "someKey", value: -5 }]);
});

test("missing key or value column: nothing parses", () => {
  assert.deepEqual(parseEconomyConfigCsv("value\n150\n"), []);
  assert.deepEqual(parseEconomyConfigCsv("key\nstarterGold\n"), []);
});

test("an empty sheet (header only, or nothing at all) parses to no rows", () => {
  assert.deepEqual(parseEconomyConfigCsv("key,value\n"), []);
  assert.deepEqual(parseEconomyConfigCsv(""), []);
});

test("the real shipped public/design/economy.csv parses, and has every key economy.ts expects", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const csvPath = path.join(process.cwd(), "public", "design", "economy.csv");
  const text = await readFile(csvPath, "utf8");
  const rows = parseEconomyConfigCsv(text);
  const keys = new Set(rows.map((row) => row.key));
  const expectedKeys = [
    "starterGold",
    "starterBoosterRadiusOvercharge",
    "starterBoosterPrismShot",
    "boosterPriceRadiusOvercharge",
    "boosterPricePrismShot",
    "dailyLoginDay1",
    "dailyLoginDay2",
    "dailyLoginDay3",
    "dailyLoginDay4",
    "dailyLoginDay5",
    "dailyLoginDay6",
    "dailyLoginDay7",
  ];
  for (const key of expectedKeys) {
    assert.ok(keys.has(key), `the shipped sheet should have a row for "${key}"`);
  }
});
