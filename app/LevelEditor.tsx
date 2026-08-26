"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { SAND_COLOR_HEX } from "./game/SandCannonEngine";
import { analyseLevel, type LevelAnalysis } from "./game/level-analysis";
import {
  EMPTY_CELL,
  KEY_LETTER,
  LETTER_BY_SAND_COLOR,
  MAX_HEIGHT,
  MAX_PIXEL_SCALE,
  MAX_WIDTH,
  MIN_DIMENSION,
  autoPixelScale,
  blankRows,
  coloursUsed,
  countPaintedCells,
  createDraft,
  draftToLevel,
  draftToTypeScript,
  defaultWindPhase,
  effectivePixelScale,
  fixtureCounts,
  loadDrafts,
  lockedLetter,
  readCell,
  resizeDraft,
  saveDrafts,
  settleDraft,
  syncQueueToPicture,
  validateDraft,
  type LevelDraft,
} from "./game/level-drafts";
import { SAND_COLORS, type SandColor, type WindConfig, type WindPhase } from "./game/sand-types";
import { finishLoading } from "./loading-screen";

type Tool = "brush" | "eraser" | "bucket" | "key";

const COLOR_NAME: Record<SandColor, string> = {
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
  purple: "Purple",
  orange: "Orange",
};

function hex(color: SandColor) {
  return `#${SAND_COLOR_HEX[color].toString(16).padStart(6, "0")}`;
}

/** The key's gold, matching what the engine paints on the board. */
const KEY_HEX = "#ffd654";

/** Replace one phase of a wind loop, leaving the rest of the list alone. */
function editWindPhase(wind: WindConfig | null | undefined, index: number, patch: Partial<WindPhase>) {
  if (!wind) return wind ?? null;
  return { phases: wind.phases.map((phase, at) => (at === index ? { ...phase, ...patch } : phase)) };
}

/** Move one phase up or down the loop. Order is the whole point of a loop. */
function moveWindPhase(wind: WindConfig | null | undefined, index: number, delta: number) {
  if (!wind) return wind ?? null;
  const target = index + delta;
  if (target < 0 || target >= wind.phases.length) return wind;
  const phases = [...wind.phases];
  [phases[index], phases[target]] = [phases[target], phases[index]];
  return { phases };
}

/** Reading a cell out of the row strings, and writing one back. */
function letterAt(rows: string[], x: number, y: number, height: number) {
  const row = rows[height - 1 - y];
  return row?.[x] ?? EMPTY_CELL;
}

function withCell(rows: string[], x: number, y: number, height: number, letter: string) {
  const rowIndex = height - 1 - y;
  const row = rows[rowIndex];
  if (row === undefined || x < 0 || x >= row.length) return rows;
  if (row[x] === letter) return rows;
  const next = [...rows];
  next[rowIndex] = row.slice(0, x) + letter + row.slice(x + 1);
  return next;
}

/** Flood fill over cells of the same starting letter, four-connected. */
function bucketFill(rows: string[], width: number, height: number, x: number, y: number, letter: string) {
  const target = letterAt(rows, x, y, height);
  if (target === letter) return rows;
  let next = rows;
  const queue: Array<[number, number]> = [[x, y]];
  const seen = new Set<string>([`${x},${y}`]);
  while (queue.length) {
    const [cx, cy] = queue.pop()!;
    if (letterAt(next, cx, cy, height) !== target) continue;
    next = withCell(next, cx, cy, height, letter);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      const key = `${nx},${ny}`;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen.has(key)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return next;
}

const HISTORY_LIMIT = 60;

/**
 * The drafts already in the browser, read once.
 *
 * localStorage does not exist during the server pass, so this goes through
 * `useSyncExternalStore` rather than an effect that calls setState: the server
 * renders nothing, the browser hydrates with the real list, and React is told
 * about the difference instead of being surprised by it.
 *
 * Cached because the snapshot is compared by identity — rebuilding the array on
 * every call would loop forever.
 */
const SERVER_DRAFTS: LevelDraft[] = [];
let cachedDrafts: LevelDraft[] | null = null;

function readStoredDrafts(): LevelDraft[] {
  if (!cachedDrafts) {
    const stored = loadDrafts();
    cachedDrafts = stored.length ? stored : [syncQueueToPicture(starterDraft())];
  }
  return cachedDrafts;
}

/** Nothing to subscribe to: the snapshot is read once and never changes. */
const noopSubscribe = () => () => {};

export default function LevelEditor() {
  const stored = useSyncExternalStore(noopSubscribe, readStoredDrafts, () => SERVER_DRAFTS);
  // null until the first edit, so the stored list is what shows until then.
  const [edited, setEdited] = useState<LevelDraft[] | null>(null);
  const drafts = edited ?? stored;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const selectedId = pickedId ?? drafts[0]?.id ?? null;
  const [tool, setTool] = useState<Tool>("brush");
  /** Whether the brush lays sand down frozen. A modifier, not a tool. */
  const [locking, setLocking] = useState(false);
  /** Which wind phase's zone is drawn over the picture. */
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [color, setColor] = useState<SandColor>("blue");
  const [analysis, setAnalysis] = useState<LevelAnalysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const painting = useRef(false);
  const history = useRef<{ past: LevelDraft[]; future: LevelDraft[] }>({ past: [], future: [] });

  // The loading screen is painted by the root layout for every route, and only
  // the game knows when its first frame is up. The editor has no such moment,
  // so it dismisses the screen as soon as it is mounted — otherwise the tool
  // sits behind it forever.
  useEffect(() => finishLoading(), []);

  const draft = useMemo(
    () => drafts.find((entry) => entry.id === selectedId) ?? null,
    [drafts, selectedId],
  );

  const persist = useCallback((next: LevelDraft[]) => {
    setEdited(next);
    saveDrafts(next);
  }, []);

  /**
   * Replace the selected draft.
   *
   * `record` is what separates a stroke from a settings tweak: a paint stroke
   * pushes one history entry when it starts and none while it continues, so
   * undo steps back a whole stroke rather than a pixel.
   */
  const update = useCallback((change: (current: LevelDraft) => LevelDraft, record = true) => {
    setEdited((currentEdited) => {
      const current = currentEdited ?? readStoredDrafts();
      const target = current.find((entry) => entry.id === selectedId);
      if (!target) return current;
      const next = { ...change(target), updatedAt: Date.now() };
      if (record) {
        history.current.past = [...history.current.past, target].slice(-HISTORY_LIMIT);
        history.current.future = [];
      }
      const list = current.map((entry) => (entry.id === selectedId ? next : entry));
      saveDrafts(list);
      return list;
    });
    setAnalysis(null);
  }, [selectedId]);

  const undo = useCallback(() => {
    const previous = history.current.past.at(-1);
    if (!previous) return;
    history.current.past = history.current.past.slice(0, -1);
    setEdited((currentEdited) => {
      const current = currentEdited ?? readStoredDrafts();
      const target = current.find((entry) => entry.id === previous.id);
      if (target) history.current.future = [...history.current.future, target];
      const list = current.map((entry) => (entry.id === previous.id ? previous : entry));
      saveDrafts(list);
      return list;
    });
    setAnalysis(null);
  }, []);

  const redo = useCallback(() => {
    const nextDraft = history.current.future.at(-1);
    if (!nextDraft) return;
    history.current.future = history.current.future.slice(0, -1);
    setEdited((currentEdited) => {
      const current = currentEdited ?? readStoredDrafts();
      const target = current.find((entry) => entry.id === nextDraft.id);
      if (target) history.current.past = [...history.current.past, target];
      const list = current.map((entry) => (entry.id === nextDraft.id ? nextDraft : entry));
      saveDrafts(list);
      return list;
    });
    setAnalysis(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ---- painting ----------------------------------------------------------

  const cellFromEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !draft) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * draft.width);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * draft.height);
    if (x < 0 || x >= draft.width || row < 0 || row >= draft.height) return null;
    return { x, y: draft.height - 1 - row };
  }, [draft]);

  const paintAt = useCallback((x: number, y: number, record: boolean) => {
    const letter = tool === "eraser"
      ? EMPTY_CELL
      : tool === "key"
        ? KEY_LETTER
        : locking ? lockedLetter(color) : LETTER_BY_SAND_COLOR[color];
    update((current) => {
      const rows = tool === "bucket"
        ? bucketFill(current.rows, current.width, current.height, x, y, letter)
        : withCell(current.rows, x, y, current.height, letter);
      return rows === current.rows ? current : { ...current, rows };
    }, record);
  }, [tool, color, locking, update]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const cell = cellFromEvent(event);
    if (!cell) return;
    // Capture throws on a pointer the browser is not tracking, and losing the
    // whole stroke to that is not worth it: without capture a drag simply stops
    // following a finger that leaves the canvas.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Not capturable — carry on with the stroke.
    }
    painting.current = true;
    paintAt(cell.x, cell.y, true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!painting.current || tool === "bucket") return;
    const cell = cellFromEvent(event);
    if (!cell) return;
    // record: false — the whole drag is one undo step.
    paintAt(cell.x, cell.y, false);
  };

  const endStroke = () => {
    painting.current = false;
  };

  // ---- canvas ------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !draft) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const cellPx = Math.max(4, Math.floor(Math.min(560 / draft.width, 620 / draft.height)));
    canvas.width = draft.width * cellPx;
    canvas.height = draft.height * cellPx;

    context.fillStyle = "#150e28";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < draft.height; row += 1) {
      for (let x = 0; x < draft.width; x += 1) {
        const cell = readCell(draft.rows[row]?.[x] ?? EMPTY_CELL);
        if (cell.kind === "empty") continue;
        const left = x * cellPx;
        const top = row * cellPx;

        if (cell.kind === "key") {
          context.fillStyle = KEY_HEX;
          context.fillRect(left, top, cellPx, cellPx);
          continue;
        }

        context.fillStyle = hex(cell.color);
        context.fillRect(left, top, cellPx, cellPx);
        if (!cell.locked) continue;
        // Frost over the colour, so a locked cell still says which colour it
        // will be once it thaws — that is what the wheel has to cover.
        context.fillStyle = "rgba(198,226,255,.5)";
        context.fillRect(left, top, cellPx, cellPx);
        context.strokeStyle = "rgba(255,255,255,.85)";
        context.lineWidth = Math.max(1, cellPx * 0.08);
        context.beginPath();
        context.moveTo(left + cellPx * 0.28, top + cellPx * 0.28);
        context.lineTo(left + cellPx * 0.72, top + cellPx * 0.72);
        context.moveTo(left + cellPx * 0.72, top + cellPx * 0.28);
        context.lineTo(left + cellPx * 0.28, top + cellPx * 0.72);
        context.stroke();
      }
    }

    // Grid lines last, so they sit over the paint rather than under it.
    context.strokeStyle = "rgba(255,255,255,.10)";
    context.lineWidth = 1;
    for (let x = 0; x <= draft.width; x += 1) {
      context.beginPath();
      context.moveTo(x * cellPx + 0.5, 0);
      context.lineTo(x * cellPx + 0.5, canvas.height);
      context.stroke();
    }
    for (let row = 0; row <= draft.height; row += 1) {
      context.beginPath();
      context.moveTo(0, row * cellPx + 0.5);
      context.lineTo(canvas.width, row * cellPx + 0.5);
      context.stroke();
    }

    // The selected wind phase's reach, over everything. Four numbers in a
    // sidebar are impossible to picture; the rectangle on the drawing is not.
    const zone = draft.wind?.phases[phaseIndex]?.zone;
    if (!zone) return;
    // Grid y counts up from the floor, canvas rows count down from the top.
    const top = (draft.height - (zone.y + zone.height)) * cellPx;
    const left = zone.x * cellPx;
    const width = zone.width * cellPx;
    const height = zone.height * cellPx;
    context.fillStyle = "rgba(120,200,255,.14)";
    context.fillRect(left, top, width, height);
    context.strokeStyle = "rgba(150,215,255,.95)";
    context.lineWidth = 2;
    context.setLineDash([6, 4]);
    context.strokeRect(left + 1, top + 1, width - 2, height - 2);
    context.setLineDash([]);
  }, [draft, phaseIndex]);

  // ---- derived -----------------------------------------------------------

  const issues = useMemo(() => (draft ? validateDraft(draft) : []), [draft]);
  const errors = issues.filter((issue) => issue.severity === "error");
  const used = draft ? coloursUsed(draft) : [];
  const painted = draft ? countPaintedCells(draft) : 0;
  const fixtures = draft ? fixtureCounts(draft) : { locked: 0, keys: 0 };
  const scale = draft ? effectivePixelScale(draft) : 1;
  const pixels = draft ? draft.width * draft.height * scale * scale : 0;

  const flash = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 2200);
  };

  const runAnalysis = () => {
    if (!draft || errors.length) return;
    setAnalysing(true);
    // Yield a frame so the button can show its busy state before the solver
    // takes the thread — this runs to completion synchronously.
    window.setTimeout(() => {
      setAnalysis(analyseLevel(draftToLevel(draft, 0)));
      setAnalysing(false);
    }, 16);
  };

  if (!draft) {
    return (
      <main className="editor-shell">
        <p className="editor-empty">Loading the level editor…</p>
      </main>
    );
  }

  const index = drafts.findIndex((entry) => entry.id === draft.id);

  return (
    <main className="editor-shell">
      <header className="editor-top">
        <h1>Sand level editor</h1>
        <div className="editor-top-actions">
          <Link className="editor-button" href="/">← Back to the game</Link>
        </div>
      </header>

      <div className="editor-body">
        {/* ---- levels ---- */}
        <aside className="editor-panel editor-levels">
          <h2>Levels</h2>
          <ul className="editor-level-list">
            {drafts.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={entry.id === draft.id ? "is-active" : ""}
                  onClick={() => {
                    setPickedId(entry.id);
                    setAnalysis(null);
                    history.current = { past: [], future: [] };
                  }}
                >
                  <strong>{entry.name || "Untitled"}</strong>
                  <small>{entry.width}×{entry.height} · {entry.shotLimit} shots</small>
                </button>
              </li>
            ))}
          </ul>
          <div className="editor-row">
            <button
              type="button"
              className="editor-button"
              onClick={() => {
                const created = syncQueueToPicture(starterDraft(`Level ${drafts.length + 1}`));
                persist([...drafts, created]);
                setPickedId(created.id);
                history.current = { past: [], future: [] };
              }}
            >
              + New
            </button>
            <button
              type="button"
              className="editor-button"
              onClick={() => {
                const copy = { ...createDraft(`${draft.name} copy`, draft.width, draft.height) };
                const duplicated: LevelDraft = {
                  ...copy,
                  rows: [...draft.rows],
                  ammoQueue: [...draft.ammoQueue],
                  sortRadius: draft.sortRadius,
                  shotLimit: draft.shotLimit,
                  pixelScale: draft.pixelScale,
                };
                persist([...drafts, duplicated]);
                setPickedId(duplicated.id);
                history.current = { past: [], future: [] };
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="editor-button is-danger"
              disabled={drafts.length <= 1}
              onClick={() => {
                const remaining = drafts.filter((entry) => entry.id !== draft.id);
                persist(remaining);
                setPickedId(remaining[Math.max(0, index - 1)]?.id ?? null);
                history.current = { past: [], future: [] };
              }}
            >
              Delete
            </button>
          </div>
        </aside>

        {/* ---- canvas ---- */}
        <section className="editor-panel editor-canvas-panel">
          <div className="editor-tools">
            <div className="editor-swatches">
              {SAND_COLORS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={`editor-swatch${entry === color && tool !== "eraser" ? " is-active" : ""}`}
                  style={{ "--swatch": hex(entry) } as React.CSSProperties}
                  onClick={() => {
                    setColor(entry);
                    if (tool === "eraser") setTool("brush");
                  }}
                  aria-label={COLOR_NAME[entry]}
                  title={COLOR_NAME[entry]}
                />
              ))}
            </div>
            <div className="editor-row">
              {(["brush", "bucket", "eraser", "key"] as Tool[]).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className={`editor-button${tool === entry ? " is-active" : ""}`}
                  onClick={() => setTool(entry)}
                  title={entry === "key" ? "Paint the key that opens locked sand" : undefined}
                >
                  {entry === "brush" ? "Brush" : entry === "bucket" ? "Fill" : entry === "eraser" ? "Eraser" : "Key"}
                </button>
              ))}
              {/* A modifier on the brush rather than a tool of its own: a lock
                  is a state of a colour, so it has to be painted with one. */}
              <button
                type="button"
                className={`editor-button${locking ? " is-active" : ""}`}
                onClick={() => {
                  setLocking((value) => !value);
                  if (tool === "eraser" || tool === "key") setTool("brush");
                }}
                title="Paint this colour frozen: it hangs in the frame and cannot be shot until a key reaches it"
              >
                ❄ Locked
              </button>
              <button type="button" className="editor-button" onClick={undo}>Undo</button>
              <button type="button" className="editor-button" onClick={redo}>Redo</button>
              <button
                type="button"
                className="editor-button"
                onClick={() => update((current) => ({ ...current, rows: blankRows(current.width, current.height) }))}
              >
                Clear
              </button>
            </div>
          </div>

          <canvas
            ref={canvasRef}
            className="editor-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
            onPointerCancel={endStroke}
          />

          <p className="editor-hint">
            {painted} grains painted · {draft.width}×{draft.height} blueprint →{" "}
            {draft.width * scale}×{draft.height * scale} simulated pixels ({pixels.toLocaleString()})
          </p>
        </section>

        {/* ---- settings ---- */}
        <aside className="editor-panel editor-settings">
          <label className="editor-field">
            <span>Name</span>
            <input
              value={draft.name}
              onChange={(event) => update((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <div className="editor-field-row">
            <label className="editor-field">
              <span>Width</span>
              <input
                type="number"
                min={MIN_DIMENSION}
                max={MAX_WIDTH}
                value={draft.width}
                onChange={(event) => update((current) => resizeDraft(current, Number(event.target.value), current.height))}
              />
            </label>
            <label className="editor-field">
              <span>Height</span>
              <input
                type="number"
                min={MIN_DIMENSION}
                max={MAX_HEIGHT}
                value={draft.height}
                onChange={(event) => update((current) => resizeDraft(current, current.width, Number(event.target.value)))}
              />
            </label>
          </div>

          <h2>Wind</h2>
          <p className="editor-note">
            A loop of phases. Each one blows one way for a while, then leaves the air still, then
            hands over to the next — and the list starts again. Frozen sand never moves; a key does,
            so wind can open a lock on its own.
          </p>
          <label className="editor-check">
            <input
              type="checkbox"
              checked={Boolean(draft.wind)}
              onChange={(event) => update((current) => ({
                ...current,
                wind: event.target.checked ? { phases: [defaultWindPhase()] } : null,
              }))}
            />
            <span>This level has wind</span>
          </label>

          {draft.wind && (
            <ol className="editor-phases">
              {draft.wind.phases.map((phase, index) => (
                <li
                  key={index}
                  className={index === phaseIndex ? "is-active" : ""}
                  // Selecting a phase is what puts its zone on the canvas, so
                  // the rectangle being edited is the one being looked at.
                  onFocusCapture={() => setPhaseIndex(index)}
                  onClick={() => setPhaseIndex(index)}
                >
                  <header>
                    <b>Phase {index + 1}</b>
                    <span className="editor-phase-summary">
                      {phase.direction === "right" ? "→" : "←"} {(phase.durationMs / 1000).toFixed(1)}s
                      {" · "}rest {(phase.cooldownMs / 1000).toFixed(1)}s
                      {" · "}power {phase.power}
                      {phase.zone ? " · zoned" : ""}
                    </span>
                    <button
                      type="button"
                      className="editor-mini"
                      disabled={index === 0}
                      onClick={() => update((current) => ({ ...current, wind: moveWindPhase(current.wind, index, -1) }))}
                      aria-label={`Move phase ${index + 1} earlier`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="editor-mini"
                      disabled={index === (draft.wind?.phases.length ?? 0) - 1}
                      onClick={() => update((current) => ({ ...current, wind: moveWindPhase(current.wind, index, 1) }))}
                      aria-label={`Move phase ${index + 1} later`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="editor-mini"
                      onClick={() => update((current) => ({
                        ...current,
                        wind: current.wind
                          ? { phases: current.wind.phases.filter((_, at) => at !== index) }
                          : current.wind,
                      }))}
                      aria-label={`Remove phase ${index + 1}`}
                    >
                      ✕
                    </button>
                  </header>

                  <div className="editor-field-row">
                    <label className="editor-field">
                      <span>Blows</span>
                      <select
                        value={phase.direction}
                        onChange={(event) => update((current) => ({
                          ...current,
                          wind: editWindPhase(current.wind, index, {
                            direction: event.target.value === "left" ? "left" : "right",
                          }),
                        }))}
                      >
                        {/* Named for where the sand goes, which is what the
                            field stores — labelling it by where the wind comes
                            from would read as the opposite of the value. */}
                        <option value="right">right →</option>
                        <option value="left">← left</option>
                      </select>
                    </label>
                    <label className="editor-field">
                      <span>For (s)</span>
                      <input
                        type="number"
                        min={0.2}
                        max={30}
                        step={0.2}
                        value={phase.durationMs / 1000}
                        onChange={(event) => update((current) => ({
                          ...current,
                          wind: editWindPhase(current.wind, index, {
                            durationMs: Math.round(Number(event.target.value) * 1000),
                          }),
                        }))}
                      />
                    </label>
                    <label className="editor-field">
                      <span>Rest (s)</span>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        step={0.2}
                        value={phase.cooldownMs / 1000}
                        onChange={(event) => update((current) => ({
                          ...current,
                          wind: editWindPhase(current.wind, index, {
                            cooldownMs: Math.round(Number(event.target.value) * 1000),
                          }),
                        }))}
                      />
                    </label>
                    <label className="editor-field">
                      <span>Power</span>
                      <input
                        type="number"
                        min={1}
                        max={6}
                        value={phase.power}
                        onChange={(event) => update((current) => ({
                          ...current,
                          wind: editWindPhase(current.wind, index, {
                            power: Math.max(1, Math.round(Number(event.target.value))),
                          }),
                        }))}
                      />
                    </label>
                  </div>

                  <label className="editor-check">
                    <input
                      type="checkbox"
                      checked={phase.zone !== null}
                      onChange={(event) => update((current) => ({
                        ...current,
                        wind: editWindPhase(current.wind, index, {
                          zone: event.target.checked
                            ? { x: 0, y: Math.floor(current.height / 2), width: current.width, height: Math.ceil(current.height / 2) }
                            : null,
                        }),
                      }))}
                    />
                    <span>Only part of the frame</span>
                  </label>

                  {phase.zone && (
                    <div className="editor-field-row">
                      {(["x", "y", "width", "height"] as const).map((field) => (
                        <label className="editor-field" key={field}>
                          <span>{field === "x" ? "Left" : field === "y" ? "Bottom" : field === "width" ? "Wide" : "Tall"}</span>
                          <input
                            type="number"
                            min={field === "x" || field === "y" ? 0 : 1}
                            max={field === "x" || field === "width" ? draft.width : draft.height}
                            value={phase.zone![field]}
                            onChange={(event) => update((current) => ({
                              ...current,
                              wind: editWindPhase(current.wind, index, {
                                zone: { ...phase.zone!, [field]: Math.max(0, Math.round(Number(event.target.value))) },
                              }),
                            }))}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </li>
              ))}
              <li className="editor-phase-add">
                <button
                  type="button"
                  className="editor-button"
                  onClick={() => update((current) => ({
                    ...current,
                    wind: { phases: [...(current.wind?.phases ?? []), defaultWindPhase()] },
                  }))}
                >
                  + Add phase
                </button>
              </li>
            </ol>
          )}

          <h2>Ammo wheel</h2>
          <p className="editor-note">
            Only colours you have painted can be loaded, and every painted colour has to be here —
            otherwise that sand could never be shot at. Frozen sand counts: it needs a bullet the
            moment a key frees it.
            {fixtures.locked > 0 && ` This picture has ${fixtures.locked} frozen cells and ${fixtures.keys} key cells.`}
          </p>
          <ol className="editor-queue">
            {draft.ammoQueue.map((entry, position) => (
              <li key={`${entry}-${position}`}>
                <i className="editor-pip" style={{ "--swatch": hex(entry) } as React.CSSProperties} />
                <span>{COLOR_NAME[entry]}</span>
                <button
                  type="button"
                  className="editor-mini"
                  disabled={position === 0}
                  onClick={() => update((current) => {
                    const queue = [...current.ammoQueue];
                    [queue[position - 1], queue[position]] = [queue[position], queue[position - 1]];
                    return { ...current, ammoQueue: queue };
                  })}
                  aria-label="Move earlier"
                >↑</button>
                <button
                  type="button"
                  className="editor-mini"
                  disabled={position === draft.ammoQueue.length - 1}
                  onClick={() => update((current) => {
                    const queue = [...current.ammoQueue];
                    [queue[position + 1], queue[position]] = [queue[position], queue[position + 1]];
                    return { ...current, ammoQueue: queue };
                  })}
                  aria-label="Move later"
                >↓</button>
                <button
                  type="button"
                  className="editor-mini is-danger"
                  onClick={() => update((current) => ({
                    ...current,
                    ammoQueue: current.ammoQueue.filter((_, at) => at !== position),
                  }))}
                  aria-label="Remove"
                >×</button>
              </li>
            ))}
            {draft.ammoQueue.length === 0 && <li className="editor-queue-empty">The wheel is empty.</li>}
          </ol>
          <div className="editor-row">
            {used.filter((entry) => !draft.ammoQueue.includes(entry)).map((entry) => (
              <button
                key={entry}
                type="button"
                className="editor-button"
                onClick={() => update((current) => ({ ...current, ammoQueue: [...current.ammoQueue, entry] }))}
              >
                + {COLOR_NAME[entry]}
              </button>
            ))}
            <button
              type="button"
              className="editor-button"
              onClick={() => update((current) => syncQueueToPicture(current))}
            >
              Match picture
            </button>
          </div>

          <div className="editor-field-row">
            <label className="editor-field">
              <span>Shots</span>
              <input
                type="number"
                min={1}
                value={draft.shotLimit}
                onChange={(event) => update((current) => ({ ...current, shotLimit: Math.max(1, Number(event.target.value) || 1) }))}
              />
            </label>
            <label className="editor-field">
              <span>Radius</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={draft.sortRadius}
                onChange={(event) => update((current) => ({ ...current, sortRadius: Math.max(0.5, Number(event.target.value) || 0.5) }))}
              />
            </label>
          </div>

          <label className="editor-field">
            <span>Pixel scale</span>
            <select
              value={draft.pixelScale ?? "auto"}
              onChange={(event) => update((current) => ({
                ...current,
                pixelScale: event.target.value === "auto" ? null : Number(event.target.value),
              }))}
            >
              <option value="auto">Auto ({autoPixelScale(draft.width, draft.height)}×)</option>
              {Array.from({ length: MAX_PIXEL_SCALE }, (_, at) => at + 1).map((entry) => (
                <option key={entry} value={entry}>{entry}×</option>
              ))}
            </select>
          </label>

          {/* ---- validation ---- */}
          {issues.length > 0 && (
            <ul className="editor-issues">
              {issues.map((issue, at) => (
                <li key={at} className={`is-${issue.severity}`}>
                  <span>{issue.message}</span>
                  {issue.fix === "settle" && (
                    <button type="button" className="editor-mini" onClick={() => update(settleDraft)}>
                      Settle it
                    </button>
                  )}
                  {issue.fix === "syncQueue" && (
                    <button type="button" className="editor-mini" onClick={() => update(syncQueueToPicture)}>
                      Fix wheel
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {issues.length === 0 && <p className="editor-ok">This level is ready to play.</p>}

          {/* ---- difficulty ---- */}
          <h2>Difficulty</h2>
          <p className="editor-note">
            The shot budget IS the difficulty here, so it is worth measuring rather than guessing.
            Both models play the real solver.
          </p>
          <button
            type="button"
            className="editor-button"
            disabled={analysing || errors.length > 0}
            onClick={runAnalysis}
          >
            {analysing ? "Measuring…" : "Measure difficulty"}
          </button>
          {analysis && (
            <div className={`editor-analysis is-${analysis.verdict}`}>
              {analysis.strongShots === null ? (
                <p>Strong play could not clear this inside {draft.shotLimit} shots.</p>
              ) : (
                <>
                  <p>
                    Strong play clears it in <strong>{analysis.strongShots}</strong> shots
                    {" "}({analysis.slack} to spare).
                  </p>
                  <p>
                    Careless play wins <strong>{analysis.carelessWins}</strong> of {analysis.carelessRuns} runs.
                  </p>
                  <p className="editor-verdict">
                    {analysis.verdict === "good" && "Well judged — there is room to misplay, and lazy play still loses."}
                    {analysis.verdict === "too-tight" && "Very tight — a good player has almost no slack."}
                    {analysis.verdict === "too-easy" && "Too generous — even careless play always wins."}
                  </p>
                  {analysis.suggestedShotLimit !== null && analysis.suggestedShotLimit !== draft.shotLimit && (
                    <button
                      type="button"
                      className="editor-mini"
                      onClick={() => update((current) => ({ ...current, shotLimit: analysis.suggestedShotLimit! }))}
                    >
                      Use {analysis.suggestedShotLimit} shots
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ---- ship it ---- */}
          <h2>Use this level</h2>
          <div className="editor-row">
            {errors.length ? (
              <button type="button" className="editor-button is-primary" disabled>
                Test in game
              </button>
            ) : (
              <Link
                className="editor-button is-primary"
                href={`/?level=${encodeURIComponent(draft.name.trim() || "Untitled")}`}
              >
                Test in game
              </Link>
            )}
            <button
              type="button"
              className="editor-button"
              onClick={() => {
                const code = draftToTypeScript(draft, index + 2);
                setExported(code);
                navigator.clipboard?.writeText(code).then(
                  () => flash("Copied — paste it into app/game/sand-levels.ts"),
                  () => flash("Copy it from the box below"),
                );
              }}
            >
              Export TypeScript
            </button>
          </div>
          <p className="editor-note">
            Saved levels show up in the game&apos;s level switcher automatically. Exporting is for
            committing one to the source, where it survives clearing your browser.
          </p>
          {status && <p className="editor-ok">{status}</p>}
          {exported && (
            <textarea className="editor-export" readOnly value={exported} onFocus={(event) => event.currentTarget.select()} />
          )}
        </aside>
      </div>
    </main>
  );
}

/** A small filled block on the floor — legal from the first frame, and obvious to paint over. */
function starterDraft(name = "New level"): LevelDraft {
  const draft = createDraft(name, 12, 14);
  const rows = blankRows(draft.width, draft.height);
  for (let row = draft.height - 4; row < draft.height; row += 1) {
    rows[row] = "B".repeat(draft.width);
  }
  return { ...draft, rows, shotLimit: 20 };
}
