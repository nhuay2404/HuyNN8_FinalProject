import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LOADING_ELEMENT_ID,
  LOADING_SCREEN_MARKUP,
  LOADING_STEPS,
} from "../app/loading-screen.ts";

const loaderUrl = new URL("../app/loading-screen.ts", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);
const buildUrl = new URL("../work/build-standalone.mjs", import.meta.url);
const entryUrl = new URL("../work/standalone-entry.tsx", import.meta.url);
const uiUrl = new URL("../app/GamePrototype.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);

test("the loading screen is markup, so it can paint before the bundle runs", async () => {
  // The whole point: it exists to cover the window where the browser is
  // compiling script, so it cannot be built by script.
  assert.match(LOADING_SCREEN_MARKUP, new RegExp(`<div id="${LOADING_ELEMENT_ID}"`));
  assert.match(LOADING_SCREEN_MARKUP, /LOADING/, "the text is in the markup too");
  assert.match(LOADING_SCREEN_MARKUP, /class="loading-fill"/);
  assert.match(LOADING_SCREEN_MARKUP, /--loading-progress:10%/, "the bar is never empty on the first paint");

  // Drawn, not fetched: an image would add its own bytes to decode before it
  // could show, which is slower than the wait it is covering.
  assert.match(LOADING_SCREEN_MARKUP, /<svg /);
  // `url(#id)` is a gradient in the same document; anything else behind url()
  // would be a real fetch.
  assert.doesNotMatch(LOADING_SCREEN_MARKUP, /<img|url\((?!#)|\.png|\.jpg|data:image/, "no asset to load");

  // One string, two consumers. Written twice, the dev app and the single-file
  // build would drift apart.
  const layout = await readFile(layoutUrl, "utf8");
  const build = await readFile(buildUrl, "utf8");
  assert.match(layout, /LOADING_SCREEN_MARKUP/, "the dev app injects the shared markup");
  assert.match(build, /LOADING_SCREEN_MARKUP/, "and so does the standalone build");
  assert.doesNotMatch(build, /<div id="loading-screen"/, "the build must not carry its own copy");
});

test("the built file puts the loader ahead of the bundle", async () => {
  const build = await readFile(buildUrl, "utf8");
  const template = build.slice(build.indexOf("const html = `"));
  const loaderAt = template.indexOf("${LOADING_SCREEN_MARKUP}");
  const scriptAt = template.indexOf("<script>${javascript}");
  assert.ok(loaderAt > 0 && scriptAt > 0, "both are in the template");
  assert.ok(loaderAt < scriptAt, "a loader after the bundle would arrive with the game, not before it");
  // And outside the React root, so mounting cannot wipe it early.
  assert.ok(template.indexOf('<div id="root">') < loaderAt);
});

test("the bar moves on real milestones and never backwards", async () => {
  const values = Object.values(LOADING_STEPS);
  assert.deepEqual(values, [...values].sort((a, b) => a - b), "the steps have to be in order");
  assert.equal(values.at(-1), 1, "the last one finishes the bar");

  const source = await readFile(loaderUrl, "utf8");
  const advance = source.slice(source.indexOf("export function advanceLoading"));
  assert.match(advance, /if \(next <= reached\) return/, "a bar that retreats reads as a failure");
  assert.match(advance, /setProperty\("--loading-progress"/);

  // Every step is a thing that actually finished.
  const entry = await readFile(entryUrl, "utf8");
  assert.match(entry, /advanceLoading\("boot"\)/, "the bundle's first line of work");
  const ui = await readFile(uiUrl, "utf8");
  assert.match(ui, /useEffect\(\(\) => advanceLoading\("mount"\), \[\]\)/, "React mounted");
  assert.match(ui, /advanceLoading\("engine"\);\s*\n\s*finishLoading\(\);/, "the engine drew its first frame");

  // No timer pretending to be progress: there is nothing to download in this
  // build, so a fake ramp would be the only dishonest thing on the screen.
  assert.doesNotMatch(source, /setInterval|Math\.random/);
  const css = await readFile(cssUrl, "utf8");
  const fill = css.slice(css.indexOf(".loading-fill {"), css.indexOf("}", css.indexOf(".loading-fill {")));
  assert.match(fill, /width: var\(--loading-progress/, "the width is the checkpoint, not an animation");
});

test("the loader leaves the document instead of sitting over the game", async () => {
  const source = await readFile(loaderUrl, "utf8");
  const finish = source.slice(source.indexOf("export function finishLoading"));
  assert.match(finish, /advanceLoading\("ready"\)/, "it fills before it goes");
  assert.match(finish, /classList\.add\("is-done"\)/);
  assert.match(finish, /element\.remove\(\)/, "left in place it would swallow the first tap");

  const css = await readFile(cssUrl, "utf8");
  const done = css.slice(css.indexOf(".loading-screen.is-done {"), css.indexOf("}", css.indexOf(".loading-screen.is-done {")));
  assert.match(done, /pointer-events: none/, "and it stops taking taps the moment it starts fading");

  // It has to stand alone: it is styled before any of the app's tokens exist as
  // far as the browser is concerned, so it cannot lean on them.
  const screen = css.slice(css.indexOf(".loading-screen {"), css.indexOf("}", css.indexOf(".loading-screen {")));
  assert.doesNotMatch(screen, /var\(--(?!loading)/, "no dependency on the app's custom properties");
});
