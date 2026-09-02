"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  PRISM_SPECTRUM_HEX,
  SandCannonEngine,
  SAND_COLOR_HEX,
  type SandEngineEvent,
} from "./game/SandCannonEngine";
import { COSTUMES, COSTUME_ORDER, getSelectedCostume, setSelectedCostume, type CostumeId } from "./game/costumes";
import {
  addGold,
  boosterPrice,
  buyBoosterCharge,
  claimDailyLogin,
  dailyLoginReward,
  DAILY_LOGIN_REWARDS,
  getDailyLoginState,
  getWallet,
  levelGoldReward,
  markLevelCleared,
  SERVER_WALLET,
  subscribeWallet,
  type DailyLoginState,
} from "./game/economy";
import { ensureEconomyConfigLoading, getEconomyConfigVersion, subscribeEconomyConfig } from "./game/economy-config";
import { computeLevelDifficulty } from "./game/level-difficulty";
import { ensureLevelRewardsLoading, getLevelRewardOverride } from "./game/level-rewards";
import { BUILT_IN_LEVELS } from "../design/levels/sand-levels";
import { draftToLevel, loadDrafts, validateDraft } from "./game/level-drafts";
import {
  ammoRemaining,
  createSandGameState,
  currentAmmo,
  expandLevelForPixelBoard,
  KEY_LETTER,
  nextAmmo,
  SAND_COLOR_BY_LETTER,
} from "./game/sand-rules";
import { isSoundEnabled, resumeSound, setSoundEnabled, soundSupported, suspendSound } from "./game/sound";
import { hapticsSupported, isHapticsEnabled, setHapticsEnabled } from "./game/haptics";
import type { BoosterType, SandColor, SandGameState, SandLevelConfig } from "./game/sand-types";
import { advanceLoading, finishLoading } from "./loading-screen";

const COLOR_NAME: Record<SandColor, string> = {
  red: "RED",
  green: "GREEN",
  yellow: "YELLOW",
  blue: "BLUE",
  purple: "PURPLE",
  orange: "ORANGE",
  cyan: "CYAN",
  pink: "PINK",
  lime: "LIME",
  brown: "BROWN",
};

function hex(color: SandColor) {
  return numHex(SAND_COLOR_HEX[color]);
}

/**
 * The sky's own tint of whatever is chambered — `SAND_COLOR_HEX` is full
 * candy saturation (right for a grain of sand, far too loud spread across
 * the whole background), so this lightens it toward white by the same
 * amount gameplay's flat cyan `--bg` (globals.css) sits lighter than the
 * cyan sand colour it was pulled from, rather than painting the frame in a
 * colour of its own.
 */
function ammoSky(color: SandColor) {
  const value = SAND_COLOR_HEX[color];
  const lighten = (channel: number) => Math.round(channel + (255 - channel) * 0.62);
  const r = lighten((value >> 16) & 0xff);
  const g = lighten((value >> 8) & 0xff);
  const b = lighten(value & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function numHex(value: number) {
  return `#${value.toString(16).padStart(6, "0")}`;
}

/** Toast copy for booster-radius-prism-spec.md §7.1: a booster is spent the
 * instant a shot leaves the barrel, so "armed" is the only state worth
 * announcing — there is no separate "used" moment for the player to miss. */
const BOOSTER_NAME: Record<BoosterType, string> = {
  radiusOvercharge: "Radius Overcharge",
  prismShot: "Prism Shot",
};

/** The Shop's one-line pitch for each booster — what a player who has never
 * armed one is actually buying. */
const BOOSTER_DESC: Record<BoosterType, string> = {
  radiusOvercharge: "Doubles the sorting disc for one shot.",
  prismShot: "One shot takes every colour in reach, not just the one loaded.",
};

/** The phases §21 locks input in. The HUD has to say so, not just stop responding. */
const BUSY_PHASES = new Set(["PROJECTILE_FLYING", "HIT_RESOLUTION", "SETTLING", "MERGING"]);

/** How long the home screen's exit animation runs — the Play button shrinking, the bottom
 * bar sliding off — before it actually leaves the DOM. Kept in step with the `hub-exit`
 * keyframes' duration in globals.css; the two are not read from one source because one is
 * a JS timer and the other a CSS animation-duration. */
const HOME_EXIT_MS = 480;

/**
 * The home screen's bottom bar, left to right.
 *
 * `home`, `gallery`, `shop` and `skin` are real: one is the screen itself,
 * one picks the level the screen is showing, one buys booster charges with
 * the gold levels pay out (`economy.ts`), and one equips the cannon's visual
 * costume (`costumes.ts`). `customize` is named here because the bar it
 * belongs to is being built now, but nothing behind it exists yet — it says
 * so when opened rather than pretending.
 */
const HUB_TABS = ["shop", "skin", "home", "gallery", "customize"] as const;
type HubTab = (typeof HUB_TABS)[number];

const HUB_TAB_NAME: Record<HubTab, string> = {
  shop: "Shop",
  skin: "Skin",
  home: "Home",
  gallery: "Gallery",
  customize: "Customize",
};

/** What each still-unbuilt section is for, so its placeholder is not just an
 * apology. `shop` and `skin` have no entry read at runtime any more (they
 * have real panels now) but keep one so this stays a total
 * `Record<HubTab, string>`. */
const HUB_TAB_BLURB: Record<HubTab, string> = {
  shop: "",
  skin: "",
  home: "",
  gallery: "",
  customize: "Where the frame, the sand texture and the board's colours would be set.",
};

/** One small shape set per tab, line art at rest and filled solid the
 * instant its tab is active — a single toggle in globals.css
 * (`.hub-nav-icon`'s `fill`/`stroke`, flipped by `.is-active`) rather than
 * two different icons, so every path here is drawn once and has to work
 * both ways: recognisable as an outline (no individual `fill`/`stroke` on
 * any path — they inherit the toggle from the `<svg>` itself) and still
 * read as a solid silhouette once filled, even though the odd fine line
 * (the bag's handle, the palette's paint dabs) is only ever going to show
 * up in the outline version — normal for an outline/filled icon pair, the
 * same way a filled Material icon carries less line detail than its own
 * outline variant. Shapes stay off-centre/off-angle on purpose (a roof with
 * an uneven overhang, a door pushed to one side, a cannon canted at an
 * angle) rather than built from a mirrored primitive. */
function HubIcon({ tab }: { tab: HubTab }) {
  return (
    <svg className="hub-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {tab === "shop" && (
        <g transform="rotate(-6 12 12)">
          <path d="M5.2 9h13.2l-1.3 10.8H6.6z" />
          <path d="M9 8.6V6.6a3 3 0 0 1 6 0v2" />
          <circle cx="13.2" cy="14.6" r="1.8" />
        </g>
      )}
      {tab === "skin" && (
        // The same barrel/breech/base CostumeIcon draws for the skin-card
        // cannon above (proven at that size already) — the "skin" tab picks
        // the cannon's skin, so its icon is a cannon. Kept horizontal:
        // canting it, tried earlier, made both the outline and the filled
        // silhouette read as a boot instead.
        <g transform="rotate(-4 12 13)">
          <rect x="5.6" y="10.2" width="10.8" height="4.6" rx="1.6" />
          <circle cx="17.2" cy="12.5" r="3.4" />
          <rect x="7" y="15.6" width="10" height="2.4" rx="1.2" />
        </g>
      )}
      {tab === "home" && (
        <>
          <path d="M3.4 11.6 12 4.6l9 6.8-1.3 1.8L12 7.2l-7 5.8z" />
          <path d="M5.4 11h12.6v8.6a1 1 0 0 1-1 1H6.4a1 1 0 0 1-1-1z" />
          <rect x="13.6" y="14.4" width="3.2" height="6.2" rx=".6" />
          <rect x="7.2" y="14.2" width="3" height="3" rx=".6" />
        </>
      )}
      {tab === "gallery" && (
        <>
          <rect x="3.4" y="4.6" width="17.2" height="15.4" rx="2.4" />
          <circle cx="15.6" cy="8.6" r="1.5" />
          <path d="M5.2 15.6 9.8 10.8l3.6 3.4 2.2-2.8 4.4 4v.2H5.2Z" />
        </>
      )}
      {tab === "customize" && (
        <>
          <path d="M12 4.2c4.6 0 7.8 3.2 7.8 7 0 2.6-1.8 3.6-3.4 3.6h-2c-.9 0-1.5.7-1.2 1.5.2.5.6.9.6 1.6 0 1.1-1 1.9-2.2 1.9C7 19.8 4 16.2 4 11.6c0-4.2 3.4-7.4 8-7.4Z" />
          <circle cx="8.4" cy="9.8" r="1.4" />
          <circle cx="12.9" cy="6.9" r="1.6" />
          <circle cx="16.2" cy="10.5" r="1.2" />
          <circle cx="14.5" cy="14.5" r="1.5" />
        </>
      )}
    </svg>
  );
}

/**
 * No text on a booster button (spec §6) — just an icon reusing gameplay
 * language the player already knows: Radius Overcharge is the aim ring
 * (`SandCannonEngine`'s own `aimRing`) blown up with outward arrows at the
 * four corners; Prism Shot is a bullet wrapped in the same seven-band
 * spectrum as the 3D chamber/muzzle overlay (`PRISM_SPECTRUM_HEX`), so the
 * button and the gun agree on what "prism" looks like.
 */
function BoosterIcon({ type }: { type: BoosterType }) {
  if (type === "radiusOvercharge") {
    return (
      <svg className="booster-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="6.2" strokeDasharray="2.6 2.2" />
        {[0, 90, 180, 270].map((deg) => (
          <g key={deg} transform={`rotate(${deg} 12 12)`}>
            <path d="M17.6 6.4 20.6 3.4" />
            <path d="M20.6 3.4h-3" />
            <path d="M20.6 3.4v3" />
          </g>
        ))}
      </svg>
    );
  }
  // Seven stroked circles at the same radius, each dashed down to its own
  // 1/7 arc and rotated into place — a ring built of bands rather than one
  // multi-colour stroke, the same construction `buildSpectrumRing` uses in
  // three.js. The bullet on top is a plain capsule in the button's own colour.
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const band = circumference / PRISM_SPECTRUM_HEX.length;
  const gap = band * 0.16;
  return (
    <svg className="booster-icon is-prism" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PRISM_SPECTRUM_HEX.map((value, index) => (
        <circle
          key={value}
          cx="12"
          cy="12"
          r={radius}
          stroke={numHex(value)}
          strokeWidth={3}
          strokeDasharray={`${band - gap} ${circumference - (band - gap)}`}
          strokeDashoffset={-index * band}
        />
      ))}
      <rect x="9.6" y="7.2" width="4.8" height="9.6" rx="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A card icon per cannon costume, drawn in currentColor like the other
 * line-art here — a plain barrel for the classic cannon, the same barrel
 * ringed with rune ticks for the rune cannon, so a card reads as "what this
 * skin does" at a glance even without the live 3D model behind it. */
function CostumeIcon({ id }: { id: CostumeId }) {
  const isRune = id === "rune-cannon";
  return (
    <svg className={`costume-icon${isRune ? " is-rune" : ""}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5.6" y="10.2" width="10.8" height="4.6" rx="1.6" />
      <circle cx="17.2" cy="12.5" r="3.4" />
      <rect x="7" y="15.6" width="10" height="2.4" rx="1.2" />
      {isRune && (
        <>
          <circle cx="12" cy="12.5" r="9.2" strokeDasharray="1.6 2.4" />
          <path d="M12 3.3v2.1M20.7 12.5h-2.1M12 21.7v-2.1M3.3 12.5h2.1" />
        </>
      )}
    </svg>
  );
}

/** A plain X, drawn in currentColor like the other line-art icons here — the
 * skin screen's own close button, since it is a full-screen takeover with no
 * hub nav bar of its own to fall back to `home` on. */
function CloseIcon() {
  return (
    <svg className="close-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * The chrome glyphs.
 *
 * These used to be literal characters in the JSX — "⚙", "?", "🎁", "⌂", "⟲",
 * "🔊", "📳", "🌐", "✎". Two problems with that, and the cozy pass fixes
 * both: a dingbat renders in whatever the platform's fallback font happens to
 * be (so the gear was a different weight and size on every OS), and a
 * full-colour emoji drops out of the palette entirely — 🎁 painted its own
 * red and blue over a screen that has exactly one accent hue.
 *
 * Drawn on the same 24×24 grid as `HubIcon` above and inheriting the same
 * `.icon-glyph` stroke settings (2px, round caps, round joins) so every icon
 * in the game is one family. `name` rather than one component per glyph
 * keeps them in a single place to keep consistent.
 */
type ChromeGlyph = "gear" | "menu" | "help" | "gift" | "home" | "restart" | "sound-on" | "sound-off" | "vibrate" | "globe" | "pencil";

function Glyph({ name, className = "icon-glyph" }: { name: ChromeGlyph; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "gear" && (
        <>
          {/* Six soft lobes rather than the usual eight sharp teeth — a
              rounder gear reads friendlier at this size and survives the
              2px stroke without the teeth merging into a blob. */}
          <path d="M12 3.4l1.9.9 2-.5 1 1.8 1.8 1-.5 2 .9 1.9-.9 1.9.5 2-1.8 1-1 1.8-2-.5-1.9.9-1.9-.9-2 .5-1-1.8-1.8-1 .5-2-.9-1.9.9-1.9-.5-2 1.8-1 1-1.8 2 .5z" />
          <circle cx="12" cy="12" r="3.1" />
        </>
      )}
      {name === "menu" && (
        <>
          {/* Three level strokes rather than the gear — mid-play this button
              opens the level-pick/Home/Restart/Settings dropdown, not
              Settings itself, so it needs its own mark instead of reusing
              the gear the "Settings" row inside that dropdown already
              shows (a gear button opening a menu with a gear item inside
              read as the settings button nested in itself). */}
          <path d="M4.6 7.2h14.8M4.6 12h14.8M4.6 16.8h14.8" />
        </>
      )}
      {name === "help" && (
        <>
          <path d="M9.3 9.1a2.8 2.8 0 0 1 5.4.9c0 1.9-2.7 2.2-2.7 4" />
          <path d="M12 17.4v.1" strokeWidth="2.6" />
        </>
      )}
      {name === "gift" && (
        <>
          <rect x="4.2" y="10.4" width="15.6" height="9" rx="1.8" />
          <path d="M3.2 7.2h17.6v3.2H3.2zM12 7.2v12.2" />
          <path d="M12 7.2c-1-2.6-2.2-3.6-3.5-3.6a1.9 1.9 0 0 0 0 3.6zM12 7.2c1-2.6 2.2-3.6 3.5-3.6a1.9 1.9 0 0 1 0 3.6z" />
        </>
      )}
      {name === "home" && (
        <>
          <path d="M4.4 10.6 12 4.4l7.6 6.2" />
          <path d="M6.4 12v7.6h11.2V12" />
        </>
      )}
      {name === "restart" && (
        <>
          <path d="M19.2 12a7.2 7.2 0 1 1-2.4-5.4" />
          <path d="M18.6 3.6v3.6h-3.6" />
        </>
      )}
      {name === "sound-on" && (
        <>
          <path d="M5 9.6h3.2L12.4 6v12l-4.2-3.6H5z" />
          <path d="M15.6 9.4a3.6 3.6 0 0 1 0 5.2M18.1 7.2a7 7 0 0 1 0 9.6" />
        </>
      )}
      {name === "sound-off" && (
        <>
          <path d="M5 9.6h3.2L12.4 6v12l-4.2-3.6H5z" />
          <path d="M16 10l4 4M20 10l-4 4" />
        </>
      )}
      {name === "vibrate" && (
        <>
          <rect x="8.2" y="3.6" width="7.6" height="16.8" rx="2" />
          <path d="M4.4 9.6v4.8M19.6 9.6v4.8" />
        </>
      )}
      {name === "globe" && (
        <>
          <circle cx="12" cy="12" r="8.2" />
          <path d="M3.8 12h16.4" />
          <path d="M12 3.8c2.2 2.3 3.3 5 3.3 8.2s-1.1 5.9-3.3 8.2c-2.2-2.3-3.3-5-3.3-8.2s1.1-5.9 3.3-8.2z" />
        </>
      )}
      {name === "pencil" && (
        <>
          <path d="M15.6 4.6 19.4 8.4 8.8 19H5v-3.8z" />
          <path d="M13.4 6.8l3.8 3.8" />
        </>
      )}
    </svg>
  );
}

/** A plain coin: a ringed disc with a face-value line, drawn in currentColor
 * like the other line-art icons here so `.coin-icon`'s colour (var(--gold))
 * is the only place the tint lives. */
function CoinIcon() {
  return (
    <svg className="coin-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="currentColor" />
      <circle cx="12" cy="12" r="9" fill="none" stroke="#b17919" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="6.2" fill="none" stroke="#b17919" strokeWidth="1.2" />
      <path d="M12 8.4v7.2M10.2 9.9c0-.9.8-1.5 1.8-1.5s1.8.5 1.8 1.3-.7 1.1-1.8 1.3-1.8.5-1.8 1.3.8 1.3 1.8 1.3 1.8-.6 1.8-1.5" stroke="#b17919" strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A level's picture at postage-stamp size.
 *
 * Drawn from the authored blueprint rather than the expanded pixel board: the
 * blueprint is what the picture IS, and expanding it first would render
 * hundreds of cells per thumbnail to show the same image.
 */
function PixelThumb({ level }: { level: SandLevelConfig }) {
  return (
    <span
      className="pixel-thumb"
      style={{ "--cols": level.frame.width, "--rows": level.frame.height } as React.CSSProperties}
      aria-hidden="true"
    >
      {level.rows.flatMap((row, y) =>
        [...row].map((letter, x) => {
          const color = SAND_COLOR_BY_LETTER[letter.toUpperCase()];
          return <i key={`${x}-${y}`} style={color ? { background: hex(color) } : undefined} />;
        }),
      )}
    </span>
  );
}

type Toast = { id: number; text: string; tone: "warn" | "good" };

/** A level in the switcher, and whether it came from the editor or the source. */
type Playable = { level: SandLevelConfig; fromEditor: boolean };

/**
 * The built-in levels plus whatever the editor has saved.
 *
 * Drafts with errors are left out rather than offered and then failing: a draft
 * whose picture holds a colour the wheel never serves cannot be won, and putting
 * it in the switcher would just be a trap. The editor is where those are fixed
 * and is the only place that explains them.
 *
 * Read once per mount rather than watched — the editor lives on its own page, so
 * anything it saves arrives with the next load of this one.
 */
function collectPlayables(): Playable[] {
  const builtIn: Playable[] = BUILT_IN_LEVELS.map((level) => ({ level, fromEditor: false }));
  const drafts = loadDrafts()
    .filter((draft) => !validateDraft(draft).some((issue) => issue.severity === "error"))
    .map((draft, index) => ({
      level: draftToLevel(draft, BUILT_IN_LEVELS.length + index + 1),
      fromEditor: true,
    }));
  return [...builtIn, ...drafts];
}

/**
 * What the page knows before React has rendered anything.
 *
 * Editor drafts live in localStorage and the requested level lives in the URL —
 * neither exists during the server pass, so this is read through
 * `useSyncExternalStore`: the server renders the built-in list, the browser
 * swaps in the real one on hydration, and React is told about the difference
 * rather than being surprised by it in an effect.
 *
 * The snapshot is cached because `useSyncExternalStore` compares it by
 * identity — rebuilding the array each call would loop forever.
 */
type Boot = { playables: Playable[]; initialIndex: number };

const SERVER_BOOT: Boot = {
  playables: BUILT_IN_LEVELS.map((level) => ({ level, fromEditor: false })),
  initialIndex: 0,
};

let cachedBoot: Boot | null = null;

function readBoot(): Boot {
  if (cachedBoot) return cachedBoot;
  const playables = collectPlayables();
  const wanted = new URLSearchParams(window.location.search).get("level");
  const found = wanted ? playables.findIndex((entry) => entry.level.name === wanted) : -1;
  cachedBoot = { playables, initialIndex: found >= 0 ? found : 0 };
  return cachedBoot;
}

/**
 * The daily-login streak as it stood the moment this page was first checked
 * this load — same reasoning as `readBoot`/`SERVER_BOOT` just above (a
 * `window.localStorage` read cached once for `useSyncExternalStore`, real on
 * the client and a fixed "nothing claimed yet" stand-in on the server, so
 * hydration never has to reconcile a modal that only one side knows about).
 */
const SERVER_DAILY_LOGIN: DailyLoginState = { day: 0, reward: DAILY_LOGIN_REWARDS[0], claimedToday: false };

let cachedInitialDailyLogin: DailyLoginState | null = null;

function readInitialDailyLogin(): DailyLoginState {
  if (!cachedInitialDailyLogin) cachedInitialDailyLogin = getDailyLoginState();
  return cachedInitialDailyLogin;
}

/**
 * Levels whose first-time overlay (`SandLevelConfig.tutorial`) has already
 * been shown, this browser. A `Set` of ids serialised as an array — small
 * and stable enough that reading it fresh on every mount costs nothing.
 */
const TUTORIALS_SEEN_KEY = "sand-cannon:v1:tutorials-seen";

function loadSeenTutorials(): Set<number> {
  try {
    const raw = window.localStorage.getItem(TUTORIALS_SEEN_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : []);
  } catch {
    return new Set();
  }
}

function markTutorialSeen(id: number) {
  try {
    const next = loadSeenTutorials().add(id);
    window.localStorage.setItem(TUTORIALS_SEEN_KEY, JSON.stringify([...next]));
  } catch {
    // Private browsing or a full quota: the overlay just shows again next
    // time, which is a mild annoyance, not a broken game.
  }
}

/**
 * Unlike `tutorial`, `ftueGesture` is not a "shown once, ever" overlay — a
 * teaching aid that costs zero clicks to dismiss (it clears itself on the
 * player's own first touch) is cheap enough to bring back on its own once the
 * lesson has plausibly gone stale, rather than trusting a player to remember
 * a control from a single showing weeks ago. Two independent triggers decide
 * that, either is enough:
 *
 *  - the app was killed and relaunched since the glyph last showed —
 *    `sessionStorage`, not `localStorage`, records "shown this run", so a
 *    fresh process (a fresh `sessionStorage`) always earns a replay;
 *  - enough real time has passed since it last showed that it is worth
 *    repeating even inside the one still-running session
 *    (`FTUE_GESTURE_REPLAY_AFTER_MS`) — the "quay lại sau một thời gian"
 *    case, for an app instance that goes a long while without ever actually
 *    being killed (backgrounded, not terminated).
 *
 * `lastShown` lives in `localStorage`, keyed by level id, because it has to
 * survive the very kill/relaunch the first trigger is built to detect.
 */
const FTUE_GESTURE_LAST_SHOWN_KEY = "sand-cannon:v1:ftue-gesture-last-shown";
const FTUE_GESTURE_SESSION_KEY_PREFIX = "sand-cannon:v1:ftue-gesture-session-shown:";
/** Six hours reads as "a different sitting", not a momentary alt-tab. */
const FTUE_GESTURE_REPLAY_AFTER_MS = 6 * 60 * 60 * 1000;

function loadFtueGestureLastShown(): Record<number, number> {
  try {
    const raw = window.localStorage.getItem(FTUE_GESTURE_LAST_SHOWN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<number, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(key);
      if (Number.isFinite(id) && typeof value === "number") result[id] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function shouldShowFtueGesture(id: number): boolean {
  try {
    if (!window.sessionStorage.getItem(`${FTUE_GESTURE_SESSION_KEY_PREFIX}${id}`)) return true;
  } catch {
    // Private browsing can refuse sessionStorage outright — showing the
    // glyph is the safe direction to fail in for a teaching aid.
    return true;
  }
  const lastShown = loadFtueGestureLastShown()[id];
  return lastShown === undefined || Date.now() - lastShown >= FTUE_GESTURE_REPLAY_AFTER_MS;
}

function markFtueGestureShown(id: number) {
  try {
    const next = loadFtueGestureLastShown();
    next[id] = Date.now();
    window.localStorage.setItem(FTUE_GESTURE_LAST_SHOWN_KEY, JSON.stringify(next));
  } catch {
    // Falls back to showing again next time — see loadFtueGestureLastShown.
  }
  try {
    window.sessionStorage.setItem(`${FTUE_GESTURE_SESSION_KEY_PREFIX}${id}`, "1");
  } catch {
    // Same fallback.
  }
}

/** Nothing to subscribe to: the snapshot is read once and never changes. */
const noopSubscribe = () => () => {};


export default function SandGame() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const aimZoneRef = useRef<HTMLDivElement | null>(null);
  const crosshairRef = useRef<HTMLSpanElement | null>(null);
  /**
   * State, not a ref.
   *
   * Everything that has to be told about the engine — above all whether it is
   * idle — depends on *which* engine it is. A ref cannot be a dependency, so
   * an effect watching one silently skips a rebuilt engine, and a rebuilt
   * engine that never heard "you are idle" comes up playing behind the home
   * screen.
   */
  const [engine, setEngine] = useState<SandCannonEngine | null>(null);

  const boot = useSyncExternalStore(noopSubscribe, readBoot, () => SERVER_BOOT);
  const playables = boot.playables;
  // null means "nothing picked yet, so use whatever the URL asked for".
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const levelIndex = chosenIndex ?? boot.initialIndex;
  const [runId, setRunId] = useState(0);
  // Whether the tutorial overlay is open. Opened by `startPlaying` the first
  // time a level with unread `tutorial` content starts play, and reopenable
  // any time from the HUD's help button.
  const [tutorialOpen, setTutorialOpen] = useState(false);
  // Same shape as `tutorialOpen`, for `ftueGesture` levels' hand/drag glyph —
  // opened by `startPlaying`, but also closed early by the engine's own
  // `AIM_TOUCHED` event (see the effect below): the glyph's job is done the
  // instant the player makes their own first touch on the real joystick.
  const [ftueGestureOpen, setFtueGestureOpen] = useState(false);

  // The engine simulates and reports state at pixel resolution — every number
  // this component reads off `state` (remainingCells above all) is in those
  // terms, so the level it reasons about here has to be expanded the same way,
  // not the small authored blueprint. Expansion is idempotent, so handing this
  // already-expanded config to the engine below costs nothing extra.
  const raw = playables[Math.min(levelIndex, playables.length - 1)]?.level ?? BUILT_IN_LEVELS[0];
  const level = useMemo(() => expandLevelForPixelBoard(raw), [raw]);
  // A placeholder only: the engine publishes the real state from its
  // constructor, so whatever is here is replaced on the first frame.
  const [state, setState] = useState<SandGameState>(() => createSandGameState(level));
  // The shots-badge dot's colour and its upcoming strip, both kept one step
  // behind `state.queue`: see the comment on `loadedAmmo` below for why.
  // Bundled into one bump counter because the two only ever change together
  // (both derive from `state.queue`, which only moves on a shot resolving or
  // a level (re)start) — that shared bump is what lets the whole strip replay
  // its "everything slides down one slot" animation in the same frame the
  // chamber's own colour pops over.
  const [ammoAnim, setAmmoAnim] = useState<{ color: SandColor | null; upcoming: SandColor[]; bump: number }>(
    () => ({ color: currentAmmo(level, state), upcoming: nextAmmo(level, state), bump: 0 }),
  );
  // Remounts `.shots-badge` (via `key`) on every `SHOT_FIRED` so its shake
  // animation replays — the same trick `ammoAnim.bump` uses for the colour
  // pop, just keyed off "a shot left the barrel" instead of "the loaded
  // colour changed".
  const [shotBump, setShotBump] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  // Mirrors `SandCannonEngine`'s own `armedBooster` — null means neither
  // booster is armed. The engine is the source of truth (it is what enforces
  // spec §3's no-cancel, no-swap rule); this only echoes it for the HUD.
  const [armedBooster, setArmedBooster] = useState<BoosterType | null>(null);
  const toastTimer = useRef<number | null>(null);
  // The player's gold + booster inventory. `economy.ts` is the source of
  // truth (localStorage-backed); this just re-renders whenever it changes —
  // a level win, a Shop purchase, or a daily-login claim all call through it.
  const wallet = useSyncExternalStore(subscribeWallet, getWallet, () => SERVER_WALLET);
  // The hub's persistent gold badge shows this instead of `wallet.gold`
  // directly, so a daily-login claim can hold the old number on screen while
  // the flying coins are still in the air and only tick it up once they
  // land — every other change to `wallet.gold` (a Shop buy, a level win)
  // still reaches it immediately via the effect below.
  const [displayGold, setDisplayGold] = useState(() => wallet.gold);
  const suppressGoldSyncRef = useRef(false);
  const goldTweenRef = useRef<number | null>(null);
  const [goldBump, setGoldBump] = useState(0);
  const goldHudRef = useRef<HTMLDivElement | null>(null);
  const todayCoinRef = useRef<HTMLSpanElement | null>(null);
  const coinBurstId = useRef(0);
  const [coinBursts, setCoinBursts] = useState<
    Array<{ id: number; fromX: number; fromY: number; dx: number; dy: number; delay: number }>
  >([]);
  useEffect(() => {
    if (suppressGoldSyncRef.current) return;
    setDisplayGold(wallet.gold);
  }, [wallet.gold]);
  useEffect(() => () => {
    if (goldTweenRef.current) cancelAnimationFrame(goldTweenRef.current);
  }, []);
  /** Eases `displayGold` up to `target` over half a second, then hands sync
   * with `wallet.gold` back to the effect above. */
  const tweenGoldTo = useCallback((target: number) => {
    if (goldTweenRef.current) cancelAnimationFrame(goldTweenRef.current);
    suppressGoldSyncRef.current = true;
    setGoldBump((n) => n + 1);
    const start = displayGold;
    const duration = 500;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplayGold(Math.round(start + (target - start) * eased));
      if (t < 1) {
        goldTweenRef.current = requestAnimationFrame(step);
      } else {
        goldTweenRef.current = null;
        suppressGoldSyncRef.current = false;
      }
    };
    goldTweenRef.current = requestAnimationFrame(step);
  }, [displayGold]);
  /** Claims today's reward, then flies a handful of coins from the day
   * strip's highlighted cell to the hub's gold badge before the number
   * there ticks up — the visual payoff `claimDailyLogin` itself has no
   * opinion on, since `economy.ts` only deals in numbers. */
  const claimDailyLoginWithFlight = useCallback(() => {
    const goldBefore = wallet.gold;
    const claimed = claimDailyLogin();
    if (!claimed) return;
    setDailyLoginOverride(claimed);
    const fromEl = todayCoinRef.current;
    const toEl = goldHudRef.current;
    if (!fromEl || !toEl) {
      tweenGoldTo(goldBefore + claimed.reward);
      return;
    }
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const fromX = fromRect.left + fromRect.width / 2;
    const fromY = fromRect.top + fromRect.height / 2;
    const dx = toRect.left + toRect.width / 2 - fromX;
    const dy = toRect.top + toRect.height / 2 - fromY;
    const spawned = Array.from({ length: 6 }, () => ({
      id: coinBurstId.current++,
      fromX,
      fromY,
      dx,
      dy,
      delay: Math.random() * 0.14,
    }));
    setCoinBursts((prev) => [...prev, ...spawned]);
    window.setTimeout(() => {
      setCoinBursts((prev) => prev.filter((b) => !spawned.some((s) => s.id === b.id)));
      tweenGoldTo(goldBefore + claimed.reward);
    }, 720);
  }, [wallet.gold, tweenGoldTo]);
  // undefined: no action taken yet this page load, so the daily-login modal's
  // open/closed state defers entirely to `initialDailyLogin` below (open iff
  // unclaimed today). Claiming, dismissing, or reopening via the gift button
  // all write a real snapshot (or `null` for "closed") here, which then wins
  // over the initial one for the rest of the session.
  const [dailyLoginOverride, setDailyLoginOverride] = useState<DailyLoginState | null | undefined>(undefined);
  // The game opens on the home screen, the way it did before the pivot.
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<HubTab>("home");
  // Read once, the same `useState(() => ...)` shape `soundOn` uses just below
  // — `getSelectedCostume()` is a plain localStorage read, and `selectCostume`
  // (the skin screen's Select button) is the only place in the UI that writes
  // it, so nothing else can go stale.
  const [costume, setCostume] = useState<CostumeId>(() => getSelectedCostume());
  // A ref mirror of `costume`, read only by the skin screen's own lifecycle
  // effect below — that effect must not re-run (and restart the showroom's
  // sway/demo-fire loop) every time the equipped skin changes, but its
  // cleanup still has to revert the live rig to whatever is *actually*
  // equipped by the time the screen closes, not whatever it was when the
  // screen opened.
  const equippedCostumeRef = useRef(costume);
  useEffect(() => {
    equippedCostumeRef.current = costume;
  }, [costume]);
  // The skin the showroom is currently showing — starts equal to `costume`
  // every time the screen opens, and only diverges while a card is being
  // looked at but not yet confirmed with Select.
  const [previewCostume, setPreviewCostume] = useState<CostumeId>(costume);
  // Rendered once per page load by `SandCannonEngine.captureCostumeThumbnails`
  // — empty until the skin screen first opens, since capturing a thumbnail
  // needs the engine's own renderer and there is no reason to pay for it
  // before a player has ever looked at the tray.
  const [costumeThumbnails, setCostumeThumbnails] = useState<Partial<Record<CostumeId, string>>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  // Read once: `isSoundEnabled()` is a plain module variable, and this is the
  // only place in the UI that ever writes it, so nothing else can go stale.
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  // Same one-place-writes-it reasoning as `soundOn` above, for the haptics
  // module's own stored preference.
  const [vibrationOn, setVibrationOn] = useState(() => isHapticsEnabled());
  // The one unified Settings card (see globals.css's own comment on
  // `.settings-screen`) — opened from the hub's gear (`.settings-wrap` while
  // `!playing`) and from a row in the in-play menu, so there is exactly one
  // place Sound/Vibration/the level editor live instead of two.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Lags `playing` on the way in: the home screen stays mounted for one more
  // beat after Play is tapped so its CSS exit animation (Play button
  // shrinking, the bottom bar sliding off) actually gets to play instead of
  // the screen just vanishing the instant `playing` flips.
  const [homeVisible, setHomeVisible] = useState(true);
  const homeExitTimer = useRef<number | null>(null);

  const pushToast = useCallback((text: string, tone: Toast["tone"]) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 1500);
  }, []);

  // Back to the home screen (goHome, a fresh level, a loss/win "Home" tap)
  // shows it again immediately — no entrance animation was asked for, so
  // this does not wait for the effect below the way the delayed hide on the
  // way OUT does. Same "adjust state during render" shape `ammoAnim` (and
  // `rewardFor`/`dailyLoginOverride`) already use elsewhere in this file:
  // guarded so it only fires the render where `playing` has actually gone
  // false and `homeVisible` is not already true, so it converges instead of
  // looping, and it needs no `useEffect` (nor the `setState`-in-effect that
  // would come with one) to do it.
  if (!playing && !homeVisible) {
    setHomeVisible(true);
  }

  useEffect(() => {
    if (!playing) {
      // The render-body check above already forced `homeVisible` back to
      // true the instant `playing` went false; this only has a real timer to
      // clean up, in case a Play -> home transition was still pending one.
      if (homeExitTimer.current) { window.clearTimeout(homeExitTimer.current); homeExitTimer.current = null; }
      return;
    }
    homeExitTimer.current = window.setTimeout(() => setHomeVisible(false), HOME_EXIT_MS);
    return () => {
      if (homeExitTimer.current) window.clearTimeout(homeExitTimer.current);
    };
  }, [playing]);

  useEffect(() => advanceLoading("mount"), []);

  // Starts loading `public/design/level-rewards.csv` and `public/design/economy.csv` (see
  // `level-rewards.ts`/`economy-config.ts`) and keeps polling both while the
  // tab stays open — no `setState` here at all (only module-level caches
  // read later: `getLevelRewardOverride` at the moment a level is actually
  // won, `economy.ts`'s accessors whenever the Shop/daily-login render), so
  // unlike the daily-login snapshot below this genuinely is a plain effect,
  // not something the `set-state-in-effect` rule has any opinion about.
  useEffect(() => {
    ensureLevelRewardsLoading();
    ensureEconomyConfigLoading();
  }, []);

  // Re-renders whenever `economy.csv` actually changes (`economy-config.ts`'s
  // version counter) — the Shop panel's price and the daily-login modal's
  // 7-day strip both read `boosterPrice`/`dailyLoginReward` directly during
  // render rather than through `subscribeWallet`, so without this a poll
  // pickup would sit in the module cache unseen until some unrelated
  // re-render happened to read it fresh.
  useSyncExternalStore(subscribeEconomyConfig, getEconomyConfigVersion, () => 0);

  // What today looked like the FIRST time this page checked — same
  // `readBoot`/`SERVER_BOOT` shape just above (a value `useSyncExternalStore`
  // reads once through a cached snapshot, real on the client and a fixed
  // stand-in on the server, so hydration never disagrees about whether a
  // modal is on screen) rather than a `useEffect` that would have to call
  // `setDailyLoginOverride` itself.
  const initialDailyLogin = useSyncExternalStore(noopSubscribe, readInitialDailyLogin, () => SERVER_DAILY_LOGIN);
  // The modal's actual state: an explicit action this page load always wins;
  // otherwise the modal opens itself iff there is something unclaimed today.
  const dailyLogin = dailyLoginOverride !== undefined
    ? dailyLoginOverride
    : (initialDailyLogin.claimedToday ? null : initialDailyLogin);

  useEffect(() => {
    const host = hostRef.current;
    const aimZone = aimZoneRef.current;
    const crosshair = crosshairRef.current;
    if (!host || !aimZone || !crosshair) return;

    const onEvent = (event: SandEngineEvent) => {
      switch (event.type) {
        case "AIM_TOUCHED":
          // The gesture glyph's whole job is to get out of the way the moment
          // the player tries the real control themselves — a no-op the rest
          // of the time, since this fires on every aim, not just the first.
          setFtueGestureOpen(false);
          break;
        case "NO_MATCH":
          // A shot can land on sand and still take nothing — the disc simply
          // found none of its colour in reach. That looks like a bug unless it
          // is said out loud.
          pushToast(`No ${COLOR_NAME[event.ammo]} in range — shot spent`, "warn");
          break;
        case "MISS":
          // A shot that never reached sand costs nothing (MISS_IS_FREE_TEMP),
          // and the player has to be told, or a missing shot is the only clue.
          pushToast(event.hitFrame ? "Hit the frame — no shot spent" : "Missed the frame — no shot spent", "warn");
          break;
        case "UNLOCKED":
          pushToast("Lock opened — the sand is free", "good");
          break;
        case "BOOSTER_ARMED":
          pushToast(`${BOOSTER_NAME[event.booster]} armed — next shot`, "good");
          break;
        case "SHOT_FIRED":
          // No toast — a shake on every single shot is feedback enough, and
          // a toast that fired that often would drown out the ones that
          // actually say something (NO_MATCH, MISS, ...).
          setShotBump((bump) => bump + 1);
          break;
        default:
          break;
      }
    };

    const built = new SandCannonEngine(host, aimZone, crosshair, level, {
      onState: setState,
      onEvent,
      onBoosterChange: setArmedBooster,
      onFirstFrame: () => {
        advanceLoading("engine");
        finishLoading();
      },
    });
    setEngine(built);
    return () => {
      built.dispose();
      setEngine((current) => (current === built ? null : current));
    };
  }, [level, runId, pushToast]);

  // The scene is the home screen's artwork as well as the board, so it is never
  // torn down — it is only told whether it is being played. `engine` is a
  // dependency so that a rebuilt one is told too, on the commit it appears.
  useEffect(() => {
    engine?.setIdle(!playing);
  }, [engine, playing]);

  useEffect(() => {
    const onVisibility = () => {
      // A background tab must not keep ambience playing (or drifting out of
      // its own schedule) behind the player's back, regardless of whether a
      // level is even open yet.
      if (document.hidden) suspendSound();
      else resumeSound();
      if (!engine) return;
      // A tab coming back must not hand control to a player looking at a menu.
      if (document.hidden || !playing) engine.pause();
      else engine.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [engine, playing]);

  const restart = useCallback(() => {
    setState(createSandGameState(level));
    setToast(null);
    setArmedBooster(null);
    setRunId((id) => id + 1);
  }, [level]);

  const goHome = useCallback(() => {
    // Back to a fresh board, not to the half-played one: the home screen shows
    // the picture as it was authored, and that is what "tap to play" promises.
    setState(createSandGameState(level));
    setToast(null);
    setArmedBooster(null);
    setRunId((id) => id + 1);
    setPlaying(false);
    setTab("home");
    setMenuOpen(false);
  }, [level]);

  const openLevel = useCallback((index: number) => {
    setChosenIndex(index);
    setState(createSandGameState(expandLevelForPixelBoard(playables[index].level)));
    setToast(null);
    setArmedBooster(null);
    setRunId((id) => id + 1);
  }, [playables]);

  /** Picking from the gallery shows that picture on the home screen, unplayed. */
  const pickFromGallery = useCallback((index: number) => {
    openLevel(index);
    setPlaying(false);
    setTab("home");
  }, [openLevel]);

  /**
   * The skin screen's whole life: entered the moment `tab` becomes "skin",
   * left the moment it becomes anything else (the close button, Home, or the
   * back-swipe every other hub tab already goes through `setTab` for).
   *
   * Opens on whatever is actually equipped (never a stale preview from a
   * previous visit), asks the engine to turn its full-screen showroom on —
   * rig front and centre, turning, firing demo shots — and grabs the tray's
   * thumbnails once. Closing reverts the live rig to whatever is actually
   * equipped (`equippedCostumeRef`, not the possibly-stale `costume` this
   * effect closed over) and turns the showroom back off, so a preview that
   * was never confirmed with Select never leaks into real play.
   */
  useEffect(() => {
    if (tab !== "skin" || !engine) return;
    setPreviewCostume(equippedCostumeRef.current);
    engine.setCostume(equippedCostumeRef.current);
    engine.setShowcase(true);
    setCostumeThumbnails(engine.captureCostumeThumbnails());
    return () => {
      engine.setCostume(equippedCostumeRef.current);
      engine.setShowcase(false);
    };
    // Intentionally not keyed on `costume` — see the doc comment above.
  }, [tab, engine]);

  /** A thumbnail tap: swaps the live rig so the showroom shows that skin, but
   * does not save anything — only the Select button does that. */
  const previewCostumeCard = useCallback((id: CostumeId) => {
    setPreviewCostume(id);
    engine?.setCostume(id);
  }, [engine]);

  /** The Select button: saves whatever the showroom is currently previewing. */
  const selectCostume = useCallback(() => {
    setSelectedCostume(previewCostume);
    setCostume(previewCostume);
  }, [previewCostume]);

  /**
   * The home screen's Play tap. Enters play, and — the first time this level
   * is opened, ever, on this browser — opens its FTUE overlay on top of the
   * fresh board rather than letting the player's first shot be a guess.
   *
   * Reads and writes localStorage directly rather than through state: this
   * only ever runs from a click, never during render or an effect, so there
   * is no server-pass mismatch to guard against and nothing worth keeping in
   * React state for it.
   */
  const startPlaying = useCallback(() => {
    setPlaying(true);
    if (level.tutorial && !loadSeenTutorials().has(level.id)) {
      setTutorialOpen(true);
      markTutorialSeen(level.id);
    }
    if (level.ftueGesture && shouldShowFtueGesture(level.id)) {
      setFtueGestureOpen(true);
      markFtueGestureShown(level.id);
    }
  }, [level]);

  /**
   * The gold economy's one entry point: pays out a level's reward the moment
   * it is WON, but only the first time that level is ever won on this
   * browser (`markLevelCleared`'s return value) — a replay clears the board
   * again but pays nothing, so farming one easy level cannot mint unlimited
   * gold.
   *
   * The reward itself is `getLevelRewardOverride(raw.id)` — a designer's own
   * number, hand-tuned in `public/design/level-rewards.csv` (`level-rewards.ts`) —
   * when that level has a row in the sheet, and `levelGoldReward`'s
   * difficulty-score formula otherwise (every level until someone tunes it
   * by hand). Scored off `raw`, the level as authored (blueprint scale), not
   * `level` (expanded to the pixel board `state` runs on) — the same scale
   * `computeLevelDifficulty` already reasons about everywhere else (the
   * editor's difficulty overview, §77).
   *
   * Set during render, not in an effect — the same "adjust state when a
   * dependency changes" shape `ammoAnim` below already uses. The guard
   * (`state.result !== rewardFor.result`) makes the whole block, side
   * effects included, run at most once per actual result transition — a
   * fresh WIN/FAIL object the engine publishes, not a re-render for an
   * unrelated reason — so `markLevelCleared`'s own idempotency is a second
   * line of defence rather than the only one. `restart`/`goHome`/`openLevel`
   * do not need to reset this themselves: they all reset `state.result` to
   * `null` via a fresh `createSandGameState`, which this guard already reads
   * as a change and resolves back to `reward: null`.
   */
  const [rewardFor, setRewardFor] = useState<{ result: SandGameState["result"]; reward: number | null }>(
    () => ({ result: null, reward: null }),
  );
  if (state.result !== rewardFor.result) {
    let reward: number | null = null;
    if (state.result?.kind === "WIN" && markLevelCleared(raw.id)) {
      reward = getLevelRewardOverride(raw.id) ?? levelGoldReward(computeLevelDifficulty(raw).score);
      addGold(reward);
    }
    setRewardFor({ result: state.result, reward });
  }
  const lastReward = rewardFor.reward;

  const remaining = ammoRemaining(level, state);
  const busy = BUSY_PHASES.has(state.phase);
  /**
   * What the badge's dot shows — one step behind `state.queue` on purpose.
   *
   * `state.queue` itself advances the instant a shot resolves, but the
   * cannon's own chamber only takes on the new colour once the settle that
   * shot triggered has finished playing (`SandCannonEngine.advanceBeats`
   * only assigns its internal `state` after the last settle beat). Reading
   * `state.queue` straight through here would flip the badge to the next
   * colour while the shot that just left the barrel is still visibly
   * settling. Held at the last colour for every busy phase and only let
   * through once play is idle again, so the two changes land in the same
   * frame.
   */
  const loadedAmmo = busy ? ammoAnim.color : currentAmmo(level, state);
  /** The next few rounds behind the loaded one — the model itself no longer
   * shows a chambered round or a queue rolling toward it (see the doc
   * comment on `updateAmmoModel` in SandCannonEngine.ts), so the badge is
   * the only place left that previews what is coming, and it now does both
   * jobs: the dot for what is loaded, this strip for what is next. Held at
   * the same busy-phase delay as `loadedAmmo`, for the same reason: without
   * it the strip would shuffle forward while the shot that just emptied the
   * chamber is still visibly settling, out of step with the dot it feeds. */
  const upcomingAmmo = busy ? ammoAnim.upcoming : nextAmmo(level, state);
  if (loadedAmmo !== ammoAnim.color) {
    setAmmoAnim({ color: loadedAmmo, upcoming: upcomingAmmo, bump: ammoAnim.bump + 1 });
  }
  // Measured against the sand this level actually started with, not the area of
  // the frame. A picture that does not fill its frame — which an editor level
  // need not — would otherwise open at "69% cleared" before a shot was fired.
  // The key is not sand — it is never cleared and never counted, so counting it
  // here would open every lock level at "4% cleared" before a shot was fired.
  const startingCells = useMemo(
    () => level.rows.reduce(
      (total, row) => total + [...row].filter((letter) => letter !== "." && letter !== KEY_LETTER).length,
      0,
    ),
    [level],
  );
  const cleared = startingCells === 0
    ? 100
    : Math.round(((startingCells - state.remainingCells) / startingCells) * 100);

  /**
   * How much of each colour the player has already taken out of the frame.
   *
   * Measured per colour against what that colour started with, not against the
   * whole picture: a colour that only ever had a dozen grains should read as
   * finished when those twelve are gone, not as a sliver next to the colour
   * that filled half the frame.
   *
   * Order is the canonical palette order rather than the ammo queue's, so a bar
   * never jumps sideways when the wheel drops a finished colour.
   */
  return (
    <main className="page-shell">
      {/* `.is-hub` swaps the wall from gameplay's vivid cyan to the calmer
          navy the hub reads in now (see globals.css) — tied to `homeVisible`
          rather than `playing` so it fades out in step with the hub screen's
          own exit animation instead of cutting the instant Play is tapped.
          `.is-skin-*` layers a per-flavour wash on top while the skin picker
          is up — on `.game-frame` itself, not `.skin-screen` sitting over
          it, because the rig is drawn by the transparent canvas *below*
          that screen; a background on the screen would paint over the rig
          instead of showing through behind it. */}
      <div
        className={`game-frame${homeVisible ? " is-hub" : ""}${tab === "skin" ? ` is-skin-${COSTUMES[previewCostume].flavor}` : ""}`}
        style={playing && loadedAmmo ? ({ "--ammo-bg": ammoSky(loadedAmmo) } as React.CSSProperties) : undefined}
      >
        {/* Top-left HUD stack: §22/§23: ammo, the 3D frame, then the cannon
            and its aim zone. The ammo row is hidden on the home screen — none
            of it is true until a level has actually been started. A
            casual-game HUD reads at a glance: the number that changes every
            shot (SHOTS) sits alone on the left, and everything that is a
            menu — level pick, home, editor, restart, help — collapses behind
            one settings button on the right so it is never in the way of the
            picture or the cannon underneath it. The coin balance used to sit
            above this row — see `wallet.gold` for where it is still tracked —
            but this corner is ammo-only now. */}
        <div className="hud-top-left">
          <header className="hud-top" hidden={!playing}>
            {/* The dot is the bullet in the chamber, not a generic "ammo" icon —
                it takes the loaded colour so the badge answers "what am I about
                to fire" at a glance, the same colour the crosshair already
                shows. Falls back to the badge's gold when the queue is empty
                (win/fail), which is the only time there is no colour to show.
                `.shots-upcoming` is the strip of what comes after it — the
                model itself no longer previews a queue rolling toward the
                chamber (see `updateAmmoModel` in SandCannonEngine.ts), so this
                badge is now the only "what's next" this game shows, and it
                widens to fit however many rounds `nextAmmo` hands back. */}
            <div
              // Keyed on the fire counter so `.shots-badge`'s shake replays
              // on every shot (see `shotBump`'s own comment) — unrelated to
              // `ammoAnim.bump` just below, which remounts only the dot.
              key={shotBump}
              className="shots-badge"
              role="status"
              aria-label={
                loadedAmmo
                  ? `${remaining} ${COLOR_NAME[loadedAmmo]} shots left, next up ${upcomingAmmo.map((color) => COLOR_NAME[color]).join(", ") || "nothing"}`
                  : `${remaining} shots left`
              }
            >
              <span
                // Keyed on the change counter, not the colour: the wheel can
                // cycle back to a colour it just showed, and a remount is what
                // gets the pop to play again rather than being a no-op className
                // change.
                key={ammoAnim.bump}
                className="shots-icon"
                aria-hidden="true"
                style={loadedAmmo ? { background: hex(loadedAmmo) } : undefined}
              />
              {upcomingAmmo.length > 0 && (
                <span className="shots-upcoming" aria-hidden="true">
                  {upcomingAmmo.map((color, index) => (
                    // Keyed on the bump too, not just `index`: every slot's
                    // content shifts one step down the queue on the same
                    // event that pops `.shots-icon` (see `ammoAnim`'s own
                    // comment), and remounting is what replays the
                    // "slide into place" animation instead of the colour
                    // just cutting over in an already-mounted node.
                    <span
                      key={`${ammoAnim.bump}-${index}`}
                      className="shots-upcoming-dot"
                      style={{ background: hex(color) }}
                    />
                  ))}
                </span>
              )}
              <strong>{remaining}</strong>
            </div>
          </header>
        </div>

        {/* Same top-right corner either way, but not the same button: mid-play
            it opens the level-pick/Home/Restart/Settings dropdown below; on
            the hub (`!playing`) that dropdown has nothing to say (no level
            grid worth showing over the picture, no in-progress run to
            restart), so this opens the unified Settings card directly
            instead of a menu with one live item in it.
            Hidden on the skin tab for now — `.skin-screen`'s own close
            button already sits in that corner. */}
        <div className="settings-wrap" hidden={tab === "skin"}>
          {playing ? (
            <>
              {(level.tutorial || level.ftueGesture) && (
                <button
                  type="button"
                  className="icon-button help-button"
                  onClick={() => (level.tutorial ? setTutorialOpen(true) : setFtueGestureOpen(true))}
                  aria-label="How to play this level"
                  title="How to play"
                >
                  <Glyph name="help" />
                </button>
              )}
              <button
                type="button"
                className="icon-button settings-button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="Menu"
                aria-haspopup="true"
                aria-expanded={menuOpen}
                title="Menu"
              >
                <Glyph name="menu" />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="icon-button settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
            >
              <Glyph name="gear" />
            </button>
          )}
          {menuOpen && (
            <>
              <button
                type="button"
                className="settings-backdrop"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              />
              <div className="settings-menu" role="menu">
                <div className="settings-level">
                  <span className="level-name">{level.name}</span>
                  <span className="level-cleared">{cleared}% cleared</span>
                </div>
                {/* Numbered rather than named: full level names do not fit this
                    panel on a phone, and the one that matters is spelled out
                    just above. */}
                <div className="settings-levels">
                  {playables.map((entry, index) => (
                    <button
                      key={entry.level.id}
                      type="button"
                      className={index === levelIndex ? "is-active" : ""}
                      onClick={() => { openLevel(index); setMenuOpen(false); }}
                      aria-label={`Level ${entry.level.id}: ${entry.level.name}`}
                      aria-current={index === levelIndex ? "true" : undefined}
                      title={entry.fromEditor ? `${entry.level.name} (from the editor)` : entry.level.name}
                    >
                      {entry.level.id}
                    </button>
                  ))}
                </div>
                <div className="settings-actions">
                  <button type="button" onClick={goHome}>
                    <Glyph name="home" /> Home
                  </button>
                  <button type="button" onClick={() => { restart(); setMenuOpen(false); }}>
                    <Glyph name="restart" /> Restart
                  </button>
                  {/* Sound/Vibration and the level editor moved into the one
                      unified Settings card (see its own comment in
                      globals.css) — this just opens it, rather than
                      duplicating an inline toggle and an editor link here
                      too. */}
                  <button type="button" onClick={() => { setMenuOpen(false); setSettingsOpen(true); }}>
                    <Glyph name="gear" /> Settings
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* The hub's own control, on the right edge rather than the top-right
            corner `.settings-wrap` uses mid-play — the two used to share
            that corner (they are never visible together, `hidden` rather
            than unmounted, on the reasoning that sharing a spot reads as one
            persistent button), but a hub-only control belongs somewhere that
            reads as hub chrome, not stacked on the exact spot the in-game
            settings gear appears the instant `playing` flips — see
            CHANGELOG-prototype.md for a report of exactly that read as an
            overlap. Conditionally rendered now, not `hidden`, so there is no
            DOM node here at all mid-play for any stray z-index/cascade
            surprise to make visible.
            Reopens the daily-login modal on demand: `initialDailyLogin`
            above already opens it once automatically when unclaimed, this
            is just "let me look again" (before claiming, or after, to see
            tomorrow's reward is not up yet). */}
        {!playing && (
          <div className="hub-gift-wrap">
            <button
              type="button"
              className="icon-button gift-button"
              onClick={() => setDailyLoginOverride(getDailyLoginState())}
              aria-label="Daily login reward"
              title="Daily login reward"
            >
              <Glyph name="gift" />
            </button>
          </div>
        )}

        {/* The hub's persistent gold balance — also the landing target for
            the daily-login claim's flying coins (`claimDailyLoginWithFlight`
            above), which is why it needs a stable ref rather than living
            inside `.shop-balance` (only mounted on the Shop tab). */}
        {!playing && (
          <div className="hub-gold-wrap">
            <div className="hub-gold-badge" ref={goldHudRef}>
              <CoinIcon />
              <strong key={goldBump}>{displayGold}</strong>
            </div>
          </div>
        )}

        {/* One `.coin-fly` span per airborne coin from the last daily-login
            claim — `position: fixed` so `fromX`/`fromY`/`dx`/`dy` (viewport
            coordinates from `getBoundingClientRect`) place and move it
            correctly regardless of where in the tree this renders. Removed
            by the timeout in `claimDailyLoginWithFlight` once the CSS
            animation has had time to finish. */}
        {coinBursts.map((burst) => (
          <span
            key={burst.id}
            className="coin-fly"
            aria-hidden="true"
            style={{
              left: burst.fromX,
              top: burst.fromY,
              animationDelay: `${burst.delay}s`,
              "--dx": `${burst.dx}px`,
              "--dy": `${burst.dy}px`,
            } as React.CSSProperties}
          >
            <CoinIcon />
          </span>
        ))}

        <div className="scene-wrap">
          <div className="scene-host" ref={hostRef} />
          <span className="aim-crosshair" ref={crosshairRef}>
            <span className="aim-crosshair-core" />
          </span>
          <div className="aim-zone" ref={aimZoneRef}>
            <div className="aim-joystick">
              <span className="aim-joystick-knob" />
            </div>
          </div>

          {/* The gesture-taught FTUE (`SandLevelConfig.ftueGesture`) — see the
              field's own doc comment in sand-types.ts for why this exists
              instead of the text `tutorial` modal. `pointer-events: none`
              throughout (see .ftue-gesture in globals.css) so it never eats
              the touch it is demonstrating: the very drag it is showing
              reaches `.aim-zone` underneath untouched, fires `AIM_TOUCHED`,
              and that is what actually closes this — not a button here.
              No enclosing card: two dashed "tap here" rings (the same dashed
              marker language `.aim-joystick::after` already draws on the real
              pad, borrowed rather than invented) with a properly-built hand —
              palm, thumb, one pointing finger, all rounded primitives, same
              construction technique as `BoosterIcon` above — gliding between
              them: press at the first ring, drag to the second, release. */}
          {ftueGestureOpen && level.ftueGesture && (
            <div className="ftue-gesture" role="status" aria-label="Drag to aim, release to fire">
              <svg className="ftue-gesture-glyph" viewBox="0 0 220 190" aria-hidden="true">
                <circle className="ftue-gesture-ring ftue-gesture-ring-a" cx="90" cy="135" r="17" />
                <circle className="ftue-gesture-ring ftue-gesture-ring-b" cx="140" cy="100" r="17" />
                <g className="ftue-gesture-hand">
                  <g transform="rotate(20)">
                    <rect x="-15" y="-58" width="30" height="28" rx="13" />
                    <circle cx="-14" cy="-40" r="9" />
                    <rect x="-7" y="-32" width="14" height="32" rx="7" />
                    <line className="ftue-gesture-hand-crease" x1="-2" y1="-33" x2="-2" y2="-23" />
                  </g>
                </g>
              </svg>
              <span className="ftue-gesture-caption">Drag to aim · release to fire</span>
            </div>
          )}

          {/* One HUD tray in the band between the picture and the cannon
              (see the comment on .scene-wrap), both booster buttons inside
              it rather than loose on the sides. No text (spec §6) — the icon
              alone, reusing the aim ring's and the chamber overlay's own
              visual language so a player who has seen either in play
              recognises the button. Disabled rather than hidden while the
              other booster is armed (spec §3: no cancel, no swap — the only
              way out of an armed booster is to fire it), while input is
              locked (`busy`, §21), or while the wallet is out of that
              booster's charges — `armBooster` is a no-op in every one of
              those cases regardless (the engine's own guard reads the same
              wallet via `getBoosterCharges`), but a button that visibly
              cannot respond is the whole point of §3.
              Conditionally rendered on `playing` rather than `hidden`: this
              tray has no business appearing over the hub (a report said it
              was), and dropping the DOM node entirely mid-play leaves no
              CSS cascade edge case that could make it visible there again —
              `.scene-wrap` around it stays mounted either way (§ its own
              comment — the 3D scene is the hub's own artwork too, never
              torn down), only this tray comes and goes with `playing`.
              Also gated on `!level.ftueGesture`: a level whose one lesson is
              "aim and shoot" should not show a second control nobody has
              explained yet — see `ftueGesture`'s doc comment. */}
          {playing && !level.ftueGesture && (
            <div className="booster-hud">
              {(["radiusOvercharge", "prismShot"] as const).map((type) => {
                const charges = wallet.boosters[type];
                return (
                  <button
                    key={type}
                    type="button"
                    className={`booster-btn is-${type === "radiusOvercharge" ? "radius" : "prism"}${armedBooster === type ? " is-armed" : ""}`}
                    onClick={() => engine?.armBooster(type)}
                    disabled={busy || charges <= 0 || (armedBooster !== null && armedBooster !== type)}
                    aria-label={`${BOOSTER_NAME[type]} — ${charges} left`}
                    aria-pressed={armedBooster === type}
                    title={`${BOOSTER_NAME[type]} — ${charges} left`}
                  >
                    <BoosterIcon type={type} />
                    {/* Spec §4's reserved charge-count badge, now shown for real
                        (see `economy.ts`) — the actual owned count, not capped
                        to a single digit: the Shop has no cap on how many a
                        player can hold. */}
                    <span className="booster-badge" aria-hidden="true">{charges}</span>
                  </button>
                );
              })}
            </div>
          )}

          {busy && (
            <div
              className="settle-badge"
              role="status"
              aria-label={state.phase === "PROJECTILE_FLYING" ? "Shot in flight" : "Sand settling"}
            >
              <i />
              <i />
              <i />
            </div>
          )}

          {toast && (
            <div key={toast.id} className={`sand-toast is-${toast.tone}`} role="status">
              {toast.text}
            </div>
          )}
        </div>

        {/* The home screen. It does not cover the picture, it frames it: the
            scene underneath is still the level's own pixel painting, sitting
            idle in its frame, which is what the player is choosing to play.
            Stays mounted a beat past `playing` turning true so `is-leaving`
            gets to animate it off instead of the screen just cutting out. */}
        {homeVisible && tab !== "skin" && (
          <div
            className={`hub-screen${playing ? " is-leaving" : ""}`}
            role="group"
            aria-label="Home screen"
            aria-hidden={playing || undefined}
          >

            {tab === "home" ? (
              <button
                className="hub-tap"
                type="button"
                onClick={startPlaying}
                aria-label={`Play ${level.name}`}
              >
                <span className="hub-play-hint"><span className="hub-play-btn">Play Level {level.id}</span></span>
              </button>
            ) : (
              // Not a click-through backdrop: while a section is open, tapping
              // anywhere off it goes back to the picture rather than starting a
              // level the player never chose.
              <button
                className="hub-scrim"
                type="button"
                onClick={() => setTab("home")}
                aria-label={`Close ${HUB_TAB_NAME[tab]}`}
              />
            )}

            {/* Kept off the home tab itself — the cannon and the level name
                would otherwise sit on top of the picture the moment it starts
                turning, which is the one thing this screen is meant to show off. */}
            {tab !== "home" && <h2 className="hub-level-name">{level.name}</h2>}

            {tab === "gallery" && (
              <div className="hub-panel" role="group" aria-label="Gallery">
                <h3>Gallery</h3>
                <div className="hub-gallery">
                  {playables.map((entry, index) => (
                    <button
                      key={entry.level.id}
                      type="button"
                      className={index === levelIndex ? "is-active" : ""}
                      onClick={() => pickFromGallery(index)}
                      aria-current={index === levelIndex ? "true" : undefined}
                      title={entry.fromEditor ? `${entry.level.name} (from the editor)` : entry.level.name}
                    >
                      <PixelThumb level={entry.level} />
                      <b>{entry.level.name}</b>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tab === "shop" && (
              <div className="hub-panel" role="group" aria-label="Shop">
                <h3>Shop</h3>
                <p className="shop-balance">
                  <CoinIcon /> <strong>{wallet.gold}</strong>
                </p>
                <div className="shop-list">
                  {(["radiusOvercharge", "prismShot"] as const).map((type) => {
                    const price = boosterPrice(type);
                    const owned = wallet.boosters[type];
                    const canAfford = wallet.gold >= price;
                    return (
                      <div key={type} className="shop-item">
                        <span className={`shop-item-icon is-${type === "radiusOvercharge" ? "radius" : "prism"}`}>
                          <BoosterIcon type={type} />
                        </span>
                        <span className="shop-item-info">
                          <b>{BOOSTER_NAME[type]}</b>
                          <span className="shop-item-desc">{BOOSTER_DESC[type]}</span>
                          <span className="shop-item-owned">Owned: {owned}</span>
                        </span>
                        <button
                          type="button"
                          className="shop-buy-btn"
                          disabled={!canAfford}
                          onClick={() => {
                            // The wallet notifies its own subscribers on a
                            // successful buy, so `wallet.gold`/`.boosters`
                            // above are already the post-purchase numbers by
                            // the time this toast reads `owned` — but `owned`
                            // was captured before the click, so the message
                            // still has to add the one charge itself.
                            if (buyBoosterCharge(type)) {
                              pushToast(`Bought ${BOOSTER_NAME[type]} — ${owned + 1} owned`, "good");
                            } else {
                              pushToast("Not enough coins", "warn");
                            }
                          }}
                          aria-label={`Buy ${BOOSTER_NAME[type]} for ${price} coins`}
                        >
                          <CoinIcon /> {price}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab !== "home" && tab !== "gallery" && tab !== "shop" && (
              <div className="hub-panel is-empty" role="group" aria-label={HUB_TAB_NAME[tab]}>
                <h3>{HUB_TAB_NAME[tab]}</h3>
                <p>{HUB_TAB_BLURB[tab]}</p>
                <p className="hub-panel-note">Not built yet.</p>
              </div>
            )}
          </div>
        )}

        {/* The skin picker: a full-screen takeover, not another hub-panel card
            — the hub screen above is unmounted entirely while this is up
            (`tab !== "skin"` on it). The rig filling the middle is the real
            one, drawn by the engine behind this screen in its own showroom
            pose (`setShowcase`) — turning on its own now (`SHOWCASE_SWAY`
            in SandCannonEngine.ts), not dragged — against a wash keyed to
            its own flavour (`.game-frame.is-skin-*` in globals.css, driven
            by the class on the frame div above); `.skin-stage` is an empty,
            see-through placeholder that only exists to give that rig a
            claimed spot in the layout. No close button of its own —
            `.hub-nav` below stays mounted over this screen too, so tapping
            any other tab is how you leave. */}
        {tab === "skin" && (
          <div
            className="skin-screen"
            role="dialog" aria-modal="true" aria-labelledby="skin-title"
          >
            <div className="skin-heading">
              <h2 id="skin-title">{COSTUMES[previewCostume].name}</h2>
              <p className="skin-tagline">{COSTUMES[previewCostume].tagline}</p>
            </div>

            <div className="skin-stage" aria-hidden="true" />

            <button
              className="skin-equip"
              type="button"
              onClick={selectCostume}
              disabled={previewCostume === costume}
            >
              {previewCostume === costume ? "Selected" : "Select"}
            </button>

            <div className="skin-tray">
              <div className="skin-grid">
                {COSTUME_ORDER.map((id) => {
                  const def = COSTUMES[id];
                  const thumbnail = costumeThumbnails[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`skin-card${previewCostume === id ? " is-previewing" : ""}`}
                      onClick={() => previewCostumeCard(id)}
                      aria-pressed={previewCostume === id}
                      aria-label={`${def.name}${costume === id ? ", equipped" : ""}`}
                    >
                      {thumbnail
                        // A data URL rendered from the rig itself a moment
                        // ago: there is no file for an image loader to
                        // optimise.
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={thumbnail} alt="" />
                        : <span className={`skin-card-icon${def.flavor === "magic" ? " is-magic" : ""}`}><CostumeIcon id={id} /></span>}
                      {costume === id && <span className="skin-card-tick" aria-hidden="true">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* The bottom bar itself, pulled out of `.hub-screen` so it stays
            mounted over the skin picker too (that screen used to unmount it
            along with the rest of `.hub-screen` — the one thing every hub
            screen shares became the one thing that vanished on skin). Gated
            on `homeVisible` alone, same as `.hub-screen`/`.skin-screen`
            themselves, so it fades out with them rather than outliving the
            screen it belongs to. */}
        {homeVisible && (
          <nav className={`hub-nav${playing ? " is-leaving" : ""}`} aria-label="Sections">
            {HUB_TABS.map((entry) => (
              <button
                key={entry}
                type="button"
                className={entry === tab ? "is-active" : ""}
                data-tab={entry}
                onClick={() => setTab(entry)}
                aria-current={entry === tab ? "page" : undefined}
                aria-label={HUB_TAB_NAME[entry]}
                title={HUB_TAB_NAME[entry]}
              >
                <span className="hub-nav-bubble">
                  <HubIcon tab={entry} />
                </span>
              </button>
            ))}
          </nav>
        )}

        {/* The one unified Settings card — see its own comment in
            globals.css. Reachable from the hub's gear and from the in-play
            menu's own "Settings" row (both just flip `settingsOpen`), so
            Sound/Vibration and the dev-only level editor live in exactly one
            place instead of being split between a dropdown and nothing. */}
        {settingsOpen && (
          <div className="settings-screen" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="settings-card">
              <div className="settings-card-header">
                <h2 id="settings-title">Settings</h2>
                <button
                  type="button"
                  className="settings-close"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                >
                  <CloseIcon />
                </button>
              </div>
              <div className="settings-body">
                {soundSupported() && (
                  <div className="settings-row">
                    <span className="settings-row-label">
                      <Glyph name={soundOn ? "sound-on" : "sound-off"} className="icon-glyph settings-row-icon" /> Sound
                    </span>
                    <button
                      type="button"
                      className={`settings-toggle${soundOn ? " is-on" : ""}`}
                      role="switch"
                      aria-checked={soundOn}
                      aria-label={`Sound ${soundOn ? "on" : "off"}`}
                      onClick={() => {
                        const next = !soundOn;
                        setSoundEnabled(next);
                        setSoundOn(next);
                      }}
                    />
                  </div>
                )}
                {hapticsSupported() && (
                  <div className="settings-row">
                    <span className="settings-row-label">
                      <Glyph name="vibrate" className="icon-glyph settings-row-icon" /> Vibration
                    </span>
                    <button
                      type="button"
                      className={`settings-toggle${vibrationOn ? " is-on" : ""}`}
                      role="switch"
                      aria-checked={vibrationOn}
                      aria-label={`Vibration ${vibrationOn ? "on" : "off"}`}
                      onClick={() => {
                        const next = !vibrationOn;
                        setHapticsEnabled(next);
                        setVibrationOn(next);
                      }}
                    />
                  </div>
                )}
                {/* Cosmetic, matching the reference — there is no second
                    language built into the game yet, so this shows the row
                    without pretending a tap here would do anything. */}
                <div className="settings-row">
                  <span className="settings-row-label">
                    <Glyph name="globe" className="icon-glyph settings-row-icon" /> Language
                  </span>
                  <span className="settings-select" aria-label="Language: English (more coming soon)">EN ▾</span>
                </div>

                <h3 className="settings-section-title">GameDevOption</h3>
                <a href="/editor" className="settings-devlink">
                  <Glyph name="pencil" /> Level editor
                </a>
              </div>
            </div>
          </div>
        )}

        {state.result && (
          <div className="result-screen" role="dialog" aria-modal="true">
            <div className="result-card">
              <h2>{state.result.kind === "WIN" ? "FRAME CLEARED" : "OUT OF SHOTS"}</h2>
              <p>
                {state.result.kind === "WIN"
                  ? `Every grain gone with ${remaining} shot${remaining === 1 ? "" : "s"} to spare.`
                  : `${cleared}% cleared — ${state.remainingCells} grains still in the frame.`}
              </p>
              {state.result.kind === "WIN" && (
                lastReward !== null ? (
                  <p className="result-reward" role="status">
                    <CoinIcon /> <strong>+{lastReward}</strong>
                  </p>
                ) : (
                  // Honest about why there is no number here rather than just
                  // omitting it: a level pays out once, ever (economy.ts) —
                  // silently showing nothing would read as a bug the first
                  // time a player replays a level they already cleared.
                  <p className="result-reward is-replay">Already cleared — no coins this time</p>
                )
              )}
              <div className="result-actions">
                <button type="button" onClick={restart}>
                  Play again
                </button>
                <button type="button" className="is-quiet" onClick={goHome}>
                  Home
                </button>
              </div>
            </div>
          </div>
        )}

        {/* The FTUE overlay: opened once automatically, by `startPlaying`, the
            first time a level with `tutorial` content is played on this
            browser, and reopenable any time from the "?" button next to the
            settings menu. Sits above everything else in `.game-frame`
            (result screen included, though the two are never open together —
            a fresh board has no result yet) so the very first shot is never
            taken blind. */}
        {tutorialOpen && level.tutorial && (
          <div className="result-screen" role="dialog" aria-modal="true" aria-label={level.tutorial.title}>
            <div className="result-card tutorial-card">
              <h2>{level.tutorial.title}</h2>
              <ol className="tutorial-steps">
                {level.tutorial.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <div className="result-actions">
                <button type="button" onClick={() => setTutorialOpen(false)}>
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Daily login: opened once automatically (`initialDailyLogin` above)
            the first time the hub is seen on a day it has not been claimed,
            and reopenable any time from the gift button in the hub's
            top-right. Gated on `!playing` on top of that — the very first
            render is always the hub, but this stays defensive rather than
            relying on that ordering.
            The day strip already says everything a status line below it
            used to repeat in words (which day, how much, whether it's
            claimed — `.is-today`/`.is-past` carry that visually), so this
            card is just the strip and the one action that matters. */}
        {!playing && dailyLogin && (
          <div className="result-screen" role="dialog" aria-modal="true" aria-label="Daily login reward">
            <div className="result-card daily-login-card">
              <h2>Daily Login</h2>
              <div className="daily-login-strip">
                {DAILY_LOGIN_REWARDS.map((_, index) => {
                  const isToday = index === dailyLogin.day;
                  const isPast = index < dailyLogin.day || (isToday && dailyLogin.claimedToday);
                  return (
                    <div
                      key={index}
                      className={`daily-login-day${isToday ? " is-today" : ""}${isPast ? " is-past" : ""}`}
                    >
                      <span className="daily-login-label">Day {index + 1}</span>
                      <span ref={isToday ? todayCoinRef : undefined}>
                        <CoinIcon />
                      </span>
                      <strong>{dailyLoginReward(index)}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="result-actions">
                {!dailyLogin.claimedToday && (
                  <button type="button" onClick={claimDailyLoginWithFlight}>
                    Claim {dailyLogin.reward} coins
                  </button>
                )}
                <button type="button" className="is-quiet" onClick={() => setDailyLoginOverride(null)}>
                  {dailyLogin.claimedToday ? "Close" : "Later"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
