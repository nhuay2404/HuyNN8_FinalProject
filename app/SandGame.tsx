"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { SandCannonEngine, SAND_COLOR_HEX, type SandEngineEvent } from "./game/SandCannonEngine";
import { BUILT_IN_LEVELS } from "./game/sand-levels";
import { draftToLevel, loadDrafts, validateDraft } from "./game/level-drafts";
import { ammoRemaining, createSandGameState, expandLevelForPixelBoard, SAND_COLOR_BY_LETTER } from "./game/sand-rules";
import { SAND_COLORS, type SandColor, type SandGameState, type SandLevelConfig } from "./game/sand-types";
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
  const engineRef = useRef<SandCannonEngine | null>(null);

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

  const pushToast = useCallback((text: string, tone: Toast["tone"]) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 1500);
  }, []);

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
        default:
          break;
      }
    };

    const engine = new SandCannonEngine(host, aimZone, crosshair, level, {
      onState: setState,
      onEvent,
      onFirstFrame: () => {
        advanceLoading("engine");
        finishLoading();
      },
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [level, runId, pushToast]);

  useEffect(() => {
    const onVisibility = () => {
      const engine = engineRef.current;
      if (!engine) return;
      if (document.hidden) engine.pause();
      else engine.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const restart = useCallback(() => {
    setState(createSandGameState(level));
    setToast(null);
    setRunId((id) => id + 1);
  }, [level]);

  const openLevel = useCallback((index: number) => {
    setChosenIndex(index);
    setState(createSandGameState(expandLevelForPixelBoard(playables[index].level)));
    setToast(null);
    setRunId((id) => id + 1);
  }, [playables]);

  const remaining = ammoRemaining(level, state);
  const busy = BUSY_PHASES.has(state.phase);
  // Measured against the sand this level actually started with, not the area of
  // the frame. A picture that does not fill its frame — which an editor level
  // need not — would otherwise open at "69% cleared" before a shot was fired.
  const startingCells = useMemo(
    () => level.rows.reduce((total, row) => total + [...row].filter((letter) => letter !== ".").length, 0),
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
  const startingByColor = useMemo(() => {
    const counts = new Map<SandColor, number>();
    for (const row of level.rows) {
      for (const letter of row) {
        if (letter === ".") continue;
        const color = SAND_COLOR_BY_LETTER[letter.toUpperCase()];
        if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
      }
    }
    return counts;
  }, [level]);

  const colorProgress = useMemo(() => {
    const left = new Map<SandColor, number>();
    for (const body of state.bodies) {
      left.set(body.color, (left.get(body.color) ?? 0) + body.cells.length);
    }
    return SAND_COLORS.filter((color) => startingByColor.has(color)).map((color) => {
      const total = startingByColor.get(color) ?? 0;
      const remainingCells = left.get(color) ?? 0;
      return { color, fill: total === 0 ? 1 : (total - remainingCells) / total };
    });
  }, [startingByColor, state.bodies]);

  return (
    <main className="page-shell">
      <div className="game-frame">
        {/* §22, top to bottom: ammo, the 3D frame, then the cannon and its aim zone. */}
        <header className="hud-top">
          <div className="ammo-row">
            {/* One bar per colour in the picture, filling as that colour leaves
                the frame. The cannon model itself now carries the bullet in
                hand and the queue behind it, so the HUD no longer repeats it. */}
            <div className="color-bars">
              {colorProgress.map((entry) => (
                <span
                  key={entry.color}
                  className="color-bar"
                  style={{ "--bullet": hex(entry.color), "--fill": entry.fill } as React.CSSProperties}
                  title={COLOR_NAME[entry.color]}
                  role="progressbar"
                  aria-label={`${COLOR_NAME[entry.color]} cleared`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(entry.fill * 100)}
                >
                  <i />
                </span>
              ))}
            </div>
            <div className="ammo-total">
              <span className="ammo-label">SHOTS</span>
              <strong>{remaining}</strong>
            </div>
          </div>
          <div className="board-row">
            {/* Numbered rather than named: full level names do not fit the row
                on a phone, and the one that matters is spelled out beside them. */}
            <span className="level-switch">
              {playables.map((entry, index) => (
                <button
                  key={entry.level.id}
                  type="button"
                  className={index === levelIndex ? "is-active" : ""}
                  onClick={() => openLevel(index)}
                  aria-label={`Level ${entry.level.id}: ${entry.level.name}`}
                  aria-current={index === levelIndex ? "true" : undefined}
                  title={entry.fromEditor ? `${entry.level.name} (from the editor)` : entry.level.name}
                >
                  {entry.level.id}
                </button>
              ))}
            </span>
            <span className="level-name">{level.name}</span>
            <span>{cleared}% cleared</span>
          </div>
        </header>

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
            <div className="settle-badge" role="status">
              <i />
              <span>{state.phase === "PROJECTILE_FLYING" ? "SHOT IN FLIGHT" : "SAND SETTLING"}</span>
            </div>
          )}

          {toast && (
            <div key={toast.id} className={`sand-toast is-${toast.tone}`} role="status">
              {toast.text}
            </div>
          )}
        </div>

        <div className="game-tools">
          <Link className="icon-button" href="/editor" aria-label="Open the level editor" title="Level editor">
            ✎
          </Link>
          <button type="button" className="icon-button" onClick={restart} aria-label="Restart level" title="Restart">
            ⟲
          </button>
        </div>

        {state.result && (
          <div className="result-screen" role="dialog" aria-modal="true">
            <div className="result-card">
              <h2>{state.result.kind === "WIN" ? "FRAME CLEARED" : "OUT OF SHOTS"}</h2>
              <p>
                {state.result.kind === "WIN"
                  ? `Every grain gone with ${remaining} shot${remaining === 1 ? "" : "s"} to spare.`
                  : `${cleared}% cleared — ${state.remainingCells} grains still in the frame.`}
              </p>
              <button type="button" onClick={restart}>
                Play again
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
