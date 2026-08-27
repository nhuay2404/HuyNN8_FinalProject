"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { SandCannonEngine, SAND_COLOR_HEX, type SandEngineEvent } from "./game/SandCannonEngine";
import { BUILT_IN_LEVELS } from "./game/sand-levels";
import { draftToLevel, loadDrafts, validateDraft } from "./game/level-drafts";
import {
  ammoRemaining,
  createSandGameState,
  expandLevelForPixelBoard,
  KEY_LETTER,
  SAND_COLOR_BY_LETTER,
} from "./game/sand-rules";
import type { SandColor, SandGameState, SandLevelConfig } from "./game/sand-types";
import { advanceLoading, finishLoading } from "./loading-screen";

const COLOR_NAME: Record<SandColor, string> = {
  red: "RED",
  green: "GREEN",
  yellow: "YELLOW",
  blue: "BLUE",
  purple: "PURPLE",
  orange: "ORANGE",
};

function hex(color: SandColor) {
  return `#${SAND_COLOR_HEX[color].toString(16).padStart(6, "0")}`;
}

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
 * `home` and `gallery` are real: one is the screen itself, the other picks the
 * level the screen is showing. The other three are named here because the bar
 * they belong to is being built now, but nothing behind them exists yet — they
 * say so when opened rather than pretending.
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

/** What each unbuilt section is for, so the placeholder is not just an apology. */
const HUB_TAB_BLURB: Record<HubTab, string> = {
  shop: "Where bundles and shot refills would be bought.",
  skin: "Where the cannon's finish would be chosen.",
  home: "",
  gallery: "",
  customize: "Where the frame, the sand texture and the board's colours would be set.",
};

/** Line art, one path set per tab, drawn in currentColor so the active tab tints it. */
function HubIcon({ tab }: { tab: HubTab }) {
  return (
    <svg className="hub-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {tab === "shop" && (
        <>
          <path d="M4.6 7.5h14.8l-1.2 12H5.8z" />
          <path d="M8.8 9.4V6.6a3.2 3.2 0 0 1 6.4 0v2.8" />
        </>
      )}
      {tab === "skin" && (
        <>
          <path d="M12 3.6c4.2 0 6.6 2.2 6.6 5 0 2.2-1.7 2.9-3 2.9h-1.4c-1 0-1.8.7-1.8 1.7 0 .5.2.9.5 1.3.3.4.5.8.5 1.3 0 1-.8 1.8-1.9 1.8-3.8 0-6.9-3.1-6.9-7s3-7 7.4-7Z" />
          <circle cx="9" cy="8.6" r="1.1" />
          <circle cx="14.4" cy="7.4" r="1.1" />
        </>
      )}
      {tab === "home" && (
        <>
          <path d="M4.4 10.6 12 4.4l7.6 6.2" />
          <path d="M6.4 12v7.6h11.2V12" />
        </>
      )}
      {tab === "gallery" && (
        <>
          <rect x="4" y="5.2" width="16" height="13.6" rx="2" />
          <path d="M4.6 15.2 9 11.2l3.4 3 2.6-2.2 4.4 3.6" />
          <circle cx="8.9" cy="8.9" r="1.2" />
        </>
      )}
      {tab === "customize" && (
        <>
          <path d="M5 8h14M5 16h14" />
          <circle cx="10" cy="8" r="2.1" />
          <circle cx="15" cy="16" r="2.1" />
        </>
      )}
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
      style={{ "--cols": level.frame.width } as React.CSSProperties}
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
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | null>(null);
  // The game opens on the home screen, the way it did before the pivot.
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<HubTab>("home");
  const [menuOpen, setMenuOpen] = useState(false);
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

  useEffect(() => {
    if (!playing) {
      // Back to the home screen (goHome, a fresh level, a loss/win "Home"
      // tap): show it again immediately, no entrance animation was asked for.
      if (homeExitTimer.current) { window.clearTimeout(homeExitTimer.current); homeExitTimer.current = null; }
      setHomeVisible(true);
      return;
    }
    homeExitTimer.current = window.setTimeout(() => setHomeVisible(false), HOME_EXIT_MS);
    return () => {
      if (homeExitTimer.current) window.clearTimeout(homeExitTimer.current);
    };
  }, [playing]);

  useEffect(() => advanceLoading("mount"), []);

  useEffect(() => {
    const host = hostRef.current;
    const aimZone = aimZoneRef.current;
    const crosshair = crosshairRef.current;
    if (!host || !aimZone || !crosshair) return;

    const onEvent = (event: SandEngineEvent) => {
      switch (event.type) {
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
        case "WIND_INCOMING":
          // Ahead of the wind, not with it: a warning that arrives at the same
          // moment as the sand it is warning about is not a warning.
          pushToast(event.direction === "right" ? "Wind picking up →" : "← Wind picking up", "warn");
          break;
        case "WIND_END":
          pushToast("The air is still", "good");
          break;
        default:
          break;
      }
    };

    const built = new SandCannonEngine(host, aimZone, crosshair, level, {
      onState: setState,
      onEvent,
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
    setRunId((id) => id + 1);
  }, [level]);

  const goHome = useCallback(() => {
    // Back to a fresh board, not to the half-played one: the home screen shows
    // the picture as it was authored, and that is what "tap to play" promises.
    setState(createSandGameState(level));
    setToast(null);
    setRunId((id) => id + 1);
    setPlaying(false);
    setTab("home");
    setMenuOpen(false);
  }, [level]);

  const openLevel = useCallback((index: number) => {
    setChosenIndex(index);
    setState(createSandGameState(expandLevelForPixelBoard(playables[index].level)));
    setToast(null);
    setRunId((id) => id + 1);
  }, [playables]);

  /** Picking from the gallery shows that picture on the home screen, unplayed. */
  const pickFromGallery = useCallback((index: number) => {
    openLevel(index);
    setPlaying(false);
    setTab("home");
  }, [openLevel]);

  const remaining = ammoRemaining(level, state);
  const busy = BUSY_PHASES.has(state.phase);
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
      <div className="game-frame">
        {/* §22: ammo, the 3D frame, then the cannon and its aim zone. Hidden on
            the home screen — none of it is true until a level has actually
            been started. A casual-game HUD reads at a glance: the number that
            changes every shot (SHOTS) sits alone on the left, and everything
            that is a menu — level pick, home, editor, restart — collapses
            behind one settings button on the right so it is never in the way
            of the picture or the cannon underneath it. */}
        <header className="hud-top" hidden={!playing}>
          <div className="shots-badge" role="status" aria-label={`${remaining} shots left`}>
            <span className="shots-icon" aria-hidden="true" />
            <strong>{remaining}</strong>
          </div>
        </header>

        <div className="settings-wrap" hidden={!playing}>
          <button
            type="button"
            className="icon-button settings-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            title="Menu"
          >
            ⚙
          </button>
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
                    <span aria-hidden="true">⌂</span> Home
                  </button>
                  <Link href="/editor" onClick={() => setMenuOpen(false)}>
                    <span aria-hidden="true">✎</span> Level editor
                  </Link>
                  <button type="button" onClick={() => { restart(); setMenuOpen(false); }}>
                    <span aria-hidden="true">⟲</span> Restart
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

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
        {homeVisible && (
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
                onClick={() => setPlaying(true)}
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

            {tab !== "home" && tab !== "gallery" && (
              <div className="hub-panel is-empty" role="group" aria-label={HUB_TAB_NAME[tab]}>
                <h3>{HUB_TAB_NAME[tab]}</h3>
                <p>{HUB_TAB_BLURB[tab]}</p>
                <p className="hub-panel-note">Not built yet.</p>
              </div>
            )}

            <nav className="hub-nav" aria-label="Sections">
              {HUB_TABS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={entry === tab ? "is-active" : ""}
                  onClick={() => setTab(entry)}
                  aria-current={entry === tab ? "page" : undefined}
                  aria-label={HUB_TAB_NAME[entry]}
                  title={HUB_TAB_NAME[entry]}
                >
                  <HubIcon tab={entry} />
                </button>
              ))}
            </nav>
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
      </div>
    </main>
  );
}
