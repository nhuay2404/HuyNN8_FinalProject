import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseLevelSheet } from "../app/game/level-format.ts";

const sheetUrl = new URL("../work/levels.tsv", import.meta.url);
const engineUrl = new URL("../app/game/CannonSortEngine.ts", import.meta.url);
const typesUrl = new URL("../app/game/types.ts", import.meta.url);

function isolate(source, signature, stopAt = "\n  private ") {
  const start = source.indexOf(signature);
  if (start < 0) return "";
  const end = source.indexOf(stopAt, start + signature.length);
  return end > start ? source.slice(start, end) : source.slice(start);
}

test("a strap sits at every junction of the two clusters, and nowhere else", async () => {
  const source = await readFile(engineUrl, "utf8");
  const build = isolate(source, "private buildLinkBridges() {");
  assert.ok(build, "buildLinkBridges builds the straps");
  assert.match(build, /groups\.set\(block\.linkGroup, members\)/, "grouped by link group");
  assert.match(build, /this\.linkContactPairs\(nearSide, farSide\)/, "a strap at every place the two clusters touch");
  assert.match(build, /for \(const seam of seams\)/);

  const contacts = isolate(source, "private linkContactPairs(nearSide: BlockRuntime[], farSide: BlockRuntime[]) {");
  assert.match(contacts, /of PHYSICAL_FACE_NEIGHBORS/, "a junction is face contact, on any axis");
  assert.match(contacts, /!farIds\.has\(to\.id\)\) continue/, "only contacts across the pair, never inside one cluster");
  assert.match(contacts, /sort\(\(a, b\) => \(a\.id < b\.id/, "block order, so a level builds the same set every time");

  // Straps follow the seam, not each block's exposed faces: the old hardware is
  // gone rather than hidden.
  for (const [name, text] of [["the engine", source], ["BlockRuntime", await readFile(typesUrl, "utf8")]]) {
    assert.doesNotMatch(text, /linkFittings|attachLinkFittings|placeLinkFittings/, `${name} still carries the per-face fittings`);
  }
});

test("two clusters authored apart still show one strap", async () => {
  const source = await readFile(engineUrl, "utf8");
  const build = isolate(source, "private buildLinkBridges() {");
  assert.match(build, /this\.findCluster\(ordered\[0\]\)/, "the split has to match the pair that goes down together");
  assert.match(build, /: \[this\.chooseLinkAnchors\(nearSide, farSide\)\]/, "no contact at all still has to draw the link");

  const choose = isolate(source, "private chooseLinkAnchors(nearSide: BlockRuntime[], farSide: BlockRuntime[]) {");
  assert.match(choose, /from\.mesh\.position\.distanceTo\(to\.mesh\.position\)/);
  assert.match(choose, /const \[mount\] = this\.strapMountDirections\(from, to\)/, "the best face a pair can offer is part of picking the pair");

  const prefer = isolate(source, "private preferAnchors(candidate: LinkAnchors, best: LinkAnchors) {");
  const byDistance = prefer.indexOf("candidate.distance < best.distance");
  const byRank = prefer.indexOf("candidate.rank < best.rank");
  const byId = prefer.indexOf("candidate.from.id < best.from.id");
  assert.ok(byDistance > 0 && byRank > byDistance, "distance decides first, then how visible the face is");
  assert.ok(byId > byRank, "id is only the last resort, so the choice stays stable");
});

test("a junction is strapped on every open face it has", async () => {
  const source = await readFile(engineUrl, "utf8");
  const mount = isolate(source, "private strapMountDirections(from: BlockRuntime, to: BlockRuntime) {");
  assert.match(mount, /Math\.abs\(direction\.dot\(axis\)\) > LINK_MOUNT_MAX_AXIS_DOT\) continue/, "square-on to the link only");
  assert.match(mount, /open\.push\(\{ direction, rank: index \}\)/, "collected, not returned on the first hit");
  assert.match(mount, /if \(open\.length\) return open/, "one face per junction left whole faces of the model bare");
  assert.match(mount, /return \[halfOpen \?\? anySquareOn/, "a junction with no outside still gets one strap");
  assert.match(mount, /rank: faceCount \+ index/, "a fallback face must never outrank a face that is actually open");

  // The strap goes on every open face, so the loop over faces cannot stop early.
  const contacts = isolate(source, "private linkContactPairs(nearSide: BlockRuntime[], farSide: BlockRuntime[]) {");
  assert.match(contacts, /for \(const mount of this\.strapMountDirections\(from, to\)\)/);

  // The face order is the visibility order, and the camera sits at +z above
  // the model — a front face of -z would have put every strap on the far side.
  const faces = source.slice(source.indexOf("const FACE_DIRECTIONS"), source.indexOf("];", source.indexOf("const FACE_DIRECTIONS")));
  assert.match(faces, /\[0, 0, 1\], \[0, 1, 0\], \[1, 0, 0\]/, "front, top, then the side the authored yaw turns toward the lens");
  assert.match(faces, /\[0, 0, -1\], \[0, -1, 0\],?\s*$/, "back and underside last");
  const camera = source.slice(source.indexOf("this.camera.position.set("), source.indexOf("\n", source.indexOf("this.camera.position.set(")));
  assert.match(camera, /set\(0, 4\.7, 13\.4\)/, "if the camera moves, the face order above has to be revisited");
});

test("the shipped link level is strapped at every junction, on every open face", async () => {
  const { levels } = parseLevelSheet(await readFile(sheetUrl, "utf8"));
  const level = levels.find((candidate) => candidate.id === 5);
  assert.ok(level, "level 5 is the link test level");
  const linked = level.blocks.filter((block) => block.linkGroup);
  assert.ok(linked.length > 0, "level 5 links two clusters");

  // The two clusters are one layer deep each and sit back to back, so they
  // touch at four blocks — four junctions to strap.
  const at = (x, y, z) => level.blocks.some((block) => block.x === x && block.y === y && block.z === z);
  const linkedAt = (x, y, z) => linked.some((block) => block.x === x && block.y === y && block.z === z);
  const touching = linked
    .filter((block) => block.z === 0 && linkedAt(block.x, block.y, 1))
    .map((block) => ({ x: block.x, y: block.y }));
  assert.equal(touching.length, 4, "level 5's clusters meet at four junctions");

  // Every junction is strapped on every face it has open, which is what makes
  // each face of the model show a strap at all of its own junctions. On this
  // level that is 6 straps over 4 junctions: two on the top, two on the left
  // side, two underneath.
  const openOnBoth = ([dx, dy, dz], { x, y }) =>
    !at(x + dx, y + dy, 0 + dz) && !at(x + dx, y + dy, 1 + dz);
  const squareOn = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, -1, 0]];
  let straps = 0;
  for (const cell of touching) {
    const open = squareOn.filter((face) => openOnBoth(face, cell));
    assert.ok(open.length > 0, `junction ${cell.x},${cell.y} has no open face`);
    straps += open.length;
    assert.ok(!openOnBoth([0, 0, 1], cell) && !openOnBoth([0, 0, -1], cell), "the seam is inside the model");
  }
  assert.equal(straps, 6, "one strap per junction would have left the side and the underside half done");

  // The face every junction shares is what a player sees on one side of the
  // model: on the left side both junctions at x=0 must be strapped.
  const leftFace = touching.filter((cell) => cell.x === 0 && openOnBoth([-1, 0, 0], cell));
  assert.equal(leftFace.length, 2, "the visible side face has to be strapped at both of its junctions");
});

test("the strap is placed from live block positions every frame", async () => {
  const source = await readFile(engineUrl, "utf8");
  const update = isolate(source, "private updateLinkBridges() {");
  assert.match(update, /bridge\.from\.mesh\.position/);
  assert.match(update, /bridge\.to\.mesh\.position/);
  assert.match(update, /bridge\.spine\.scale\.z = span \+ LINK_SPINE_OVERHANG/, "the spine spans whatever gap the wave leaves");
  assert.match(update, /Math\.max\(this\.linkPadReach\(bridge\.from\), this\.linkPadReach\(bridge\.to\)\)/, "clears the taller of the two");

  const reach = isolate(source, "private linkPadReach(block: BlockRuntime) {");
  assert.match(reach, /block\.barrelLeft > 0 \? LINK_PAD_REACH_OVER_SHELL : LINK_PAD_REACH/);
  // Peeling a shell no longer has to reposition anything by hand.
  assert.doesNotMatch(isolate(source, "private peelShell(block: BlockRuntime) {"), /LinkFittings|linkBridges/);

  const animate = source.slice(source.indexOf("private animate = () => {"));
  const updateAt = animate.indexOf("if (this.linkBridges.length) this.updateLinkBridges()");
  assert.ok(updateAt > 0, "animate has to place the straps");
  assert.ok(updateAt < animate.indexOf("this.renderer.render"), "placed before the draw, not after it");
});

test("claiming a pair drops the whole seam once", async () => {
  const source = await readFile(engineUrl, "utf8");
  const drop = isolate(source, "private dropLinkBridge(block: BlockRuntime) {");
  assert.match(drop, /filter\(\(bridge\) => bridge\.group === block\.linkGroup\)/, "every strap of the group comes off");
  assert.match(
    drop,
    /this\.linkBridges = this\.linkBridges\.filter\(\(bridge\) => bridge\.group !== block\.linkGroup\)/,
    "taken out of the list, so the partner cluster drops nothing and nothing falls twice",
  );
  assert.match(drop, /this\.addDebris\(bridge\.root, /, "falls through the same debris path the shell shards use");
  assert.match(drop, /\+ index \* 13/, "each strap gets its own scatter, or they all fall identically");
  assert.match(source, /this\.dropLinkBridge\(member\)/, "releaseCluster is where a claim reaches it");
});
