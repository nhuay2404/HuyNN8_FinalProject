// The loading screen, and the only part of the game that is not React.
//
// It has to be in the **markup**, because the whole point is to be on screen
// before the bundle runs: the page paints its stylesheet at about 34 KB in and
// then spends the next ~795 KB compiling and executing script, and that is the
// window where the player was looking at an empty gradient. Anything drawn by
// JavaScript would arrive at the same moment as the game it is covering for.
//
// For the same reason the art is inline SVG rather than an image: a screenshot
// of the game would add a few hundred KB to a single-file build and would have
// to be decoded before it could paint, which is slower than the thing it is
// hiding. This draws the same composition — block cluster, cannon in the
// corner, drifting cubes — out of polygons that cost nothing to decode.
//
// One string, two consumers: the dev app injects it from `app/layout.tsx` and
// the single-file build interpolates it in `work/build-standalone.mjs`. Written
// twice it would drift.

export const LOADING_ELEMENT_ID = "loading-screen";

// How far along the bar each milestone stands. They are real checkpoints — the
// script starting, React mounting, the engine finishing its first frame — not a
// timer pretending to be progress. There is nothing to download in this build,
// so these four moments are the only honest things to report.
export const LOADING_STEPS = {
  boot: 0.34,
  mount: 0.58,
  engine: 0.86,
  ready: 1,
} as const;

export type LoadingStep = keyof typeof LOADING_STEPS;

// Where the bar starts in the markup: the first paint has already happened by
// definition, so it is never empty.
const LOADING_START = 0.1;

const BLOCK_COLORS = {
  red: "#ff172a",
  green: "#1cc870",
  yellow: "#fcc900",
  blue: "#0b8cff",
  purple: "#8432ff",
  orange: "#fc7800",
} as const;

// The wall from the reference: three bands, with the right-hand column breaking
// the pattern so the cluster does not read as a flat grid.
const CLUSTER_ROWS = [
  [BLOCK_COLORS.red, BLOCK_COLORS.red, BLOCK_COLORS.red, BLOCK_COLORS.purple],
  [BLOCK_COLORS.blue, BLOCK_COLORS.blue, BLOCK_COLORS.blue, BLOCK_COLORS.orange],
  [BLOCK_COLORS.green, BLOCK_COLORS.green, BLOCK_COLORS.green, BLOCK_COLORS.yellow],
];

const CUBE = 47;
const CUBE_GAP = 3;
const DEPTH = 17;
const CLUSTER_X = 92;
const CLUSTER_Y = 214;

// Lit and shadowed faces of the same colour, so a cube reads as one solid block
// rather than three coloured shapes that happen to touch.
function shade(hex: string, factor: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor))))
    .map((channel) => channel.toString(16).padStart(2, "0"));
  return `#${channels.join("")}`;
}

function cube(x: number, y: number, color: string, top: boolean, right: boolean) {
  const size = CUBE - CUBE_GAP;
  const faces = [
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="5" fill="${color}"/>`,
  ];
  if (top) {
    faces.push(
      `<path d="M${x} ${y} L${x + DEPTH} ${y - DEPTH} L${x + size + DEPTH} ${y - DEPTH} L${x + size} ${y}Z" fill="${shade(color, 1.24)}"/>`,
    );
  }
  if (right) {
    faces.push(
      `<path d="M${x + size} ${y} L${x + size + DEPTH} ${y - DEPTH} L${x + size + DEPTH} ${y + size - DEPTH} L${x + size} ${y + size}Z" fill="${shade(color, 0.66)}"/>`,
    );
  }
  return faces.join("");
}

function cluster() {
  const parts: string[] = [];
  for (const [row, colors] of CLUSTER_ROWS.entries()) {
    for (const [column, color] of colors.entries()) {
      parts.push(cube(
        CLUSTER_X + column * CUBE,
        CLUSTER_Y + row * CUBE,
        color,
        row === 0,
        column === colors.length - 1,
      ));
    }
  }
  return parts.join("");
}

// Cubes drifting through the dark, the small ones that sell depth in the
// reference shot. Fixed positions rather than random: the markup is generated
// once at build time and has to be identical every build.
const SPECKS: Array<[number, number, number, string, number]> = [
  [46, 470, 11, BLOCK_COLORS.blue, 0.9],
  [104, 402, 8, BLOCK_COLORS.orange, 0.75],
  [148, 556, 9, BLOCK_COLORS.blue, 0.8],
  [196, 404, 7, BLOCK_COLORS.blue, 0.7],
  [214, 618, 10, BLOCK_COLORS.yellow, 0.85],
  [246, 430, 8, BLOCK_COLORS.purple, 0.8],
  [286, 300, 6, BLOCK_COLORS.blue, 0.6],
  [318, 500, 9, BLOCK_COLORS.orange, 0.8],
  [340, 152, 7, BLOCK_COLORS.green, 0.6],
  [58, 148, 6, BLOCK_COLORS.purple, 0.55],
];

function specks() {
  return SPECKS.map(([x, y, size, color, opacity], index) => {
    const spin = (index % 4) * 12 - 18;
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="${color}" opacity="${opacity}" transform="rotate(${spin} ${x + size / 2} ${y + size / 2})"/>`;
  }).join("");
}

// Faint motion lines. They are what stops the empty half of the frame from
// looking like a flat wash.
const STREAKS: Array<[number, number, number]> = [
  [22, 372, 84],
  [268, 418, 62],
  [312, 560, 70],
  [96, 626, 54],
];

function streaks() {
  return STREAKS.map(([x, y, length]) =>
    `<rect x="${x}" y="${y}" width="${length}" height="2" rx="1" fill="url(#loadStreak)" transform="rotate(-24 ${x} ${y})"/>`).join("");
}

// The cannon in the corner, at the scale the reference frames it: cut off by the
// edge, close enough to read as the one the player is about to hold.
function cannon() {
  return [
    `<g transform="rotate(-36 118 596)">`,
    `<rect x="86" y="386" width="64" height="226" rx="32" fill="#b1c7e9"/>`,
    `<ellipse cx="118" cy="392" rx="32" ry="13" fill="#93acdc"/>`,
    `<rect x="86" y="424" width="64" height="15" rx="7" fill="#728bc2" opacity=".55"/>`,
    `</g>`,
    `<ellipse cx="56" cy="628" rx="98" ry="76" fill="#5c6d99"/>`,
    `<ellipse cx="56" cy="628" rx="98" ry="76" fill="none" stroke="#ffc332" stroke-width="15" stroke-dasharray="96 400" stroke-dashoffset="-24"/>`,
    `<circle cx="118" cy="676" r="26" fill="#ffc332" opacity=".92"/>`,
  ].join("");
}

const ART = `<svg class="loading-art" viewBox="0 0 390 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
<defs>
<linearGradient id="loadStreak" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".3"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
</linearGradient>
</defs>
<rect width="390" height="700" fill="#aedee4"/>
${streaks()}
${specks()}
${cluster()}
${cannon()}
</svg>`;

export const LOADING_SCREEN_MARKUP = `<div id="${LOADING_ELEMENT_ID}" class="loading-screen" role="status" aria-live="polite" style="--loading-progress:${LOADING_START * 100}%">
${ART}
<div class="loading-panel">
<p class="loading-text">LOADING<i></i><i></i><i></i></p>
<div class="loading-track"><span class="loading-fill"></span></div>
</div>
</div>`;

// Never backwards: the steps can arrive out of order in a dev reload, and a bar
// that retreats reads as something going wrong.
let reached = LOADING_START;

export function advanceLoading(step: LoadingStep) {
  if (typeof document === "undefined") return;
  // A page that mounts after loading has already finished must not start
  // filling a bar again — there is nothing left to wait for.
  if (finished) return;
  const element = document.getElementById(LOADING_ELEMENT_ID);
  if (!element) return;
  const next = LOADING_STEPS[step];
  if (next <= reached) return;
  reached = next;
  element.style.setProperty("--loading-progress", `${next * 100}%`);
}

/**
 * True once any page has finished loading in this document.
 *
 * From that moment on, a loading screen is stale by definition — see
 * `watchForStaleScreen`.
 */
let finished = false;
let observer: MutationObserver | null = null;

function dismiss(element: HTMLElement) {
  element.classList.add("is-done");
  // Taken out of the document after the fade rather than left transparent on
  // top of the game, where it would still swallow the first tap.
  window.setTimeout(() => element.remove(), 420);
}

/**
 * Remove any loading screen that turns up after loading is already done.
 *
 * The screen is server-rendered in the root layout so that it is in the very
 * first HTML the browser paints. The cost of that is that a client-side
 * navigation re-renders the layout and puts a *fresh* one into the document —
 * after the page it is covering has already mounted and called
 * `finishLoading`. Nothing would ever dismiss that one, and the player would
 * be left looking at a loading bar over a page that had finished loading.
 */
function watchForStaleScreen() {
  if (observer || typeof MutationObserver === "undefined") return;
  observer = new MutationObserver(() => {
    const element = document.getElementById(LOADING_ELEMENT_ID);
    if (element && !element.classList.contains("is-done")) dismiss(element);
  });
  observer.observe(document.body, { childList: true });
}

export function finishLoading() {
  if (typeof document === "undefined") return;
  const element = document.getElementById(LOADING_ELEMENT_ID);
  if (element) {
    // Filled to the end before it fades, so the bar is never seen to stop short.
    advanceLoading("ready");
    dismiss(element);
  }
  finished = true;
  watchForStaleScreen();
}
