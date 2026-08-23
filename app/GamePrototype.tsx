"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
} from "react";
import {
  CannonSortEngine,
  createInitialHookSnapshot,
  type BatchFlightEvent,
  type ControlSensitivity,
  type EngineInteractionEvent,
  type HookSnapshot,
  type SortAnimationEvent,
} from "./game/CannonSortEngine";
import {
  COSMETICS,
  COSMETIC_ORDER,
  LOCKED_COSMETIC_SLOTS,
  getCosmetic,
  getSelectedCosmetic,
  setSelectedCosmetic as storeSelectedCosmetic,
  type CosmeticId,
} from "./game/cosmetics";
import { formatSheetIssue } from "./game/level-format";
import { advanceLoading, finishLoading } from "./loading-screen";
import { loadLevelSheet, parseDroppedSheet, type LoadedLevelSheet } from "./game/level-source";
import { planBatchFlight, planSortFlight } from "./game/sort-flight";
import {
  haptic,
  hapticBlockLanded,
  hapticsSupported,
  isHapticsEnabled,
  setHapticsEnabled,
} from "./game/haptics";
import { createGameState } from "./game/rules";
import { TUTORIAL_CHAPTERS } from "./game/tutorial-levels";
import {
  TUTORIAL_COPY,
  TUTORIAL_STEP_COUNT,
  createTutorialProgress,
  nextTutorialChapter,
  reduceTutorialProgress,
  tutorialAllowedColor,
  tutorialPresentation,
  type TutorialEvent,
  type TutorialProgress,
} from "./game/tutorial";
import type { BlockColor, GameState } from "./game/types";

const COLOR_META: Record<BlockColor, { hex: string; short: string }> = {
  red: { hex: "#ff3d4d", short: "RED" },
  green: { hex: "#24e07f", short: "GREEN" },
  yellow: { hex: "#ffd21f", short: "YELLOW" },
  blue: { hex: "#2f9dff", short: "BLUE" },
  purple: { hex: "#9d5cff", short: "PURPLE" },
  orange: { hex: "#ff8a1f", short: "ORANGE" },
};

type SortSprite = {
  id: string;
  color: BlockColor;
  sourceX: number;
  sourceY: number;
  middleX: number;
  middleY: number;
  targetX: number;
  targetY: number;
  delayMs: number;
  flightMs: number;
  destination: "goal" | "reserve";
  // Where the cube started: a cluster breaking apart, or a batch emptying into
  // a goal. The two read differently on screen.
  origin: "cluster" | "batch";
  // Only a goal has a slot to land in; the reserve is one place.
  slot?: number;
  goalId?: string;
  fromCount: number;
  // Position within its burst, so each landing tick can be a little softer
  // than the one before it.
  order: number;
};

// Vibration support is a fixed fact about the device, so the store never has to
// notify anyone: it only needs a browser answer and a server answer.
const subscribeToNothing = () => () => {};
const returnFalse = () => false;

// The Skin button's mark: the rig itself, in the same three masses the model is
// built from — pedestal, cradle, barrel tilted up — so the button reads as "the
// thing you shoot with" instead of as a generic wardrobe icon. Drawn rather than
// loaded, like every other picture in this build. The gold parts are filled from
// CSS, because `var()` does not resolve inside an SVG presentation attribute.
function CannonMountIcon() {
  return (
    <svg className="hub-side-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {/* Barrel first, so the cradle and the pedestal overlap its tail the way
          the housing swallows it on the real rig. */}
      <g transform="rotate(38 12.7 8.8)">
        <rect x="10.4" y="2.4" width="4.6" height="12.6" rx="2.3" />
        <rect className="hub-side-icon-accent" x="9.5" y="3.5" width="6.4" height="1.7" rx=".85" />
      </g>
      <circle cx="9.4" cy="14.6" r="3.6" />
      <rect x="3" y="17.4" width="18" height="4.4" rx="2.2" />
      <rect className="hub-side-icon-accent" x="4.8" y="16" width="14.4" height="1.7" rx=".85" />
    </svg>
  );
}

// The win card's fireworks. DOM sparks rather than the engine's 3D ones: those
// live behind the HUD, so the panel would cover the celebration it is meant to
// be having. Fixed angles and delays, computed once — a burst that reshuffles on
// every re-render would flicker.
const RESULT_SPARK_COLORS = ["#ffd21f", "#24e07f", "#ff8ad8", "#2f9dff", "#ff8a1f"];
const RESULT_SPARKS = Array.from({ length: 18 }, (_, index) => ({
  // Spread evenly, then nudged every other spark so the ring is not a diagram.
  angle: (index / 18) * 360 + (index % 2) * 10,
  distance: 124 + (index % 4) * 22,
  delay: (index % 6) * 0.045,
  color: RESULT_SPARK_COLORS[index % RESULT_SPARK_COLORS.length],
}));

function ResultFireworks() {
  return (
    <div className="result-fireworks" aria-hidden="true">
      {RESULT_SPARKS.map((spark, index) => (
        <span
          key={index}
          style={{
            "--spark-angle": `${spark.angle}deg`,
            "--spark-distance": `${spark.distance}px`,
            "--spark-delay": `${spark.delay}s`,
            "--spark-color": spark.color,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

const CLIMAX_STREAK_COLORS = ["#ff4d6d", "#ffdf57", "#56f2df", "#6aa7ff", "#d878ff"];
const CLIMAX_STREAKS = Array.from({ length: 18 }, (_, index) => ({
  left: (index * 37 + 9) % 100,
  delay: -((index * 0.31) % 2.4),
  duration: 1.6 + (index % 5) * 0.22,
  drift: ((index % 3) - 1) * (18 + (index % 4) * 7),
  color: CLIMAX_STREAK_COLORS[index % CLIMAX_STREAK_COLORS.length],
}));

function ClimaxFireworks() {
  return (
    <div className="climax-fireworks" aria-hidden="true">
      {CLIMAX_STREAKS.map((streak, index) => (
        <span
          key={index}
          style={{
            "--climax-left": `${streak.left}%`,
            "--climax-delay": `${streak.delay}s`,
            "--climax-duration": `${streak.duration}s`,
            "--climax-drift": `${streak.drift}px`,
            "--climax-color": streak.color,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

function focusableIn(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

// Keeps Tab inside a dialog by wrapping at both ends. Shared by the settings
// modal and the skin picker so the two cannot drift apart.
function cycleFocus(root: HTMLElement | null, event: KeyboardEvent) {
  if (!root) return;
  const focusable = focusableIn(root);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// Blocks that have visibly landed in the reserve but whose state the engine
// has not applied yet, so the tray does not go briefly empty mid-flight.
type IncomingReserve = { color: BlockColor; count: number };
// One line of plain English per reason the engine can fail on, so the panel
// stops explaining every loss as a full reserve.
const FAIL_BODY: Record<string, string> = {
  "Reserve full": "The reserve was full and that shot had nothing an open goal could take.",
  "Out of shots": "The level ran out of shots before the last goal was filled.",
};

type ModalView = "settings" | "restart-confirm" | null;
type SheetNotice = { kind: "ok" | "warn"; lines: string[]; key: number };
type Screen = "hub" | "playing" | "tutorial";

// How long the menu buttons take to clear the screen before the level's own HUD
// takes over.
const HUB_EXIT_MS = 340;
// Matches the engine's intro: the HUD rises while the cluster is still zooming
// in, so the two read as one move.
const HUD_RISE_MS = 700;

const SHEET_SOURCE_LABEL: Record<LoadedLevelSheet["source"], string> = {
  embedded: "the sheet inside this HTML file",
  bundled: "the sheet bundled with this build",
  dropped: "the sheet you just dropped in",
};

export default function GamePrototype() {
  const gameFrameRef = useRef<HTMLElement>(null);
  const sceneHostRef = useRef<HTMLDivElement>(null);
  const modelZoneRef = useRef<HTMLDivElement>(null);
  const aimZoneRef = useRef<HTMLDivElement>(null);
  const crosshairRef = useRef<HTMLSpanElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const restartButtonRef = useRef<HTMLButtonElement>(null);
  const modalOverlayRef = useRef<HTMLDivElement>(null);
  const settingsFirstControlRef = useRef<HTMLInputElement>(null);
  const restartNoButtonRef = useRef<HTMLButtonElement>(null);
  const skinButtonRef = useRef<HTMLButtonElement>(null);
  const cosmeticOverlayRef = useRef<HTMLDivElement>(null);
  const cosmeticCloseRef = useRef<HTMLButtonElement>(null);
  // Read by the engine effect: a level rebuilt while the picker is open has to
  // come back up in showcase mode, not in menu mode.
  const cosmeticOpenRef = useRef(false);
  const cosmeticClosingRef = useRef(false);
  const engineRef = useRef<CannonSortEngine | null>(null);
  const modalActiveRef = useRef(false);
  const resumeAfterModalRef = useRef(false);
  // Set by startLevel and consumed by the engine effect: whether the level
  // being built came from the level before it rather than from the menu.
  const handoffIntroRef = useRef(false);
  const dragDepthRef = useRef(0);
  const sensitivityRef = useRef<ControlSensitivity>({ modelRotate: 1, aimDrag: 1 });
  const tutorialProgressRef = useRef<TutorialProgress>(createTutorialProgress());
  const tutorialBatchSeenRef = useRef(false);
  const [session, setSession] = useState(0);
  // The game opens on the menu, so the very first thing the player sees is the
  // level they are about to play, turning on its own.
  const [screen, setScreen] = useState<Screen>("hub");
  const [hubLeaving, setHubLeaving] = useState(false);
  const [hudRising, setHudRising] = useState(false);
  const [sheet, setSheet] = useState<LoadedLevelSheet>(() => loadLevelSheet());
  const [levelIndex, setLevelIndex] = useState(0);
  const [tutorialProgress, setTutorialProgress] = useState<TutorialProgress>(() => createTutorialProgress());
  const campaignLevel = sheet.levels[levelIndex] ?? sheet.levels[0];
  const tutorialChapter = TUTORIAL_CHAPTERS[tutorialProgress.chapter] ?? TUTORIAL_CHAPTERS[0];
  const tutorialMode = screen === "tutorial";
  const tutorialView = tutorialMode ? tutorialPresentation(tutorialProgress.chapter) : null;
  const level = tutorialMode ? tutorialChapter.level : campaignLevel;
  const [state, setState] = useState<GameState>(() => createGameState(sheet.levels[0]));
  const [hookState, setHookState] = useState<HookSnapshot>(() => createInitialHookSnapshot());
  const [sheetNotice, setSheetNotice] = useState<SheetNotice | null>(null);
  const [sheetDragActive, setSheetDragActive] = useState(false);
  const [sortSprites, setSortSprites] = useState<SortSprite[]>([]);
  const [visualGoalCounts, setVisualGoalCounts] = useState<Record<string, number>>({});
  const [incomingReserve, setIncomingReserve] = useState<IncomingReserve | null>(null);
  const [modal, setModal] = useState<ModalView>(null);
  const [cosmeticOpen, setCosmeticOpen] = useState(false);
  // What is equipped, and what the preview is currently showing. Tapping a card
  // only previews it; the button under the preview is what equips it, which is
  // why the button can read "Selected" at all.
  const [equippedCosmetic, setEquippedCosmetic] = useState<CosmeticId>(getSelectedCosmetic);
  const [previewCosmetic, setPreviewCosmetic] = useState<CosmeticId>(getSelectedCosmetic);
  const [cosmeticThumbnails, setCosmeticThumbnails] = useState<Partial<Record<CosmeticId, string>>>({});
  const [modelRotateSensitivity, setModelRotateSensitivity] = useState(1);
  const [aimDragSensitivity, setAimDragSensitivity] = useState(1);
  const [hapticsOn, setHapticsOn] = useState(isHapticsEnabled);
  // Whether the device can vibrate at all never changes while the page is
  // open, but it can only be read in the browser. Reading it through a store
  // with a separate server snapshot keeps the dev app's server pass and
  // browser pass in agreement instead of hydrating with a mismatched control.
  const hapticsAvailable = useSyncExternalStore(subscribeToNothing, hapticsSupported, returnFalse);

  const dispatchTutorial = useCallback((event: TutorialEvent) => {
    const current = tutorialProgressRef.current;
    const next = reduceTutorialProgress(current, event);
    if (next === current) return;
    tutorialProgressRef.current = next;
    setTutorialProgress(next);
  }, []);

  // React is mounted and the level sheet has been read; the engine below is what
  // is left. Its own effect reports the rest.
  useEffect(() => advanceLoading("mount"), []);

  useEffect(() => {
    const host = sceneHostRef.current;
    const modelZone = modelZoneRef.current;
    const aimZone = aimZoneRef.current;
    const crosshair = crosshairRef.current;
    const frame = gameFrameRef.current;
    if (!host || !modelZone || !aimZone || !crosshair || !frame) return;
    const tutorialLevelIndex = TUTORIAL_CHAPTERS.findIndex((chapter) => chapter.level === level);
    const engineTutorialChapter = tutorialLevelIndex >= 0 ? tutorialLevelIndex : null;
    const engineTutorialView = engineTutorialChapter === null
      ? null
      : tutorialPresentation(engineTutorialChapter);

    const handleState = (next: GameState) => {
      setState(next);
      setVisualGoalCounts((previous) => {
        const retained: Record<string, number> = {};
        for (const [goalId, visualCount] of Object.entries(previous)) {
          const goal = next.activeGoals.find((candidate) => candidate?.id === goalId);
          if (goal && goal.current < visualCount) retained[goalId] = visualCount;
        }
        return retained;
      });
      setIncomingReserve((previous) => {
        if (!previous || next.result) return null;
        // Dropped once the real record is at least as big as what was shown,
        // which is the moment the optimistic pips stop adding anything.
        const landed = next.batches.some((batch) => batch.color === previous.color && batch.count >= previous.count);
        return landed ? null : previous;
      });

      if (engineTutorialChapter !== 1 || tutorialProgressRef.current.chapter !== 1) return;
      const parked = next.batches.reduce((total, batch) => total + batch.count, 0);
      if (parked > 0) tutorialBatchSeenRef.current = true;
      const step = tutorialProgressRef.current.step;
      if (step === 0) {
        const redGoal = next.activeGoals.find((goal) => goal?.color === "red");
        if (redGoal && redGoal.current >= 1) dispatchTutorial({ type: "SORT_PROGRESS" });
      } else if (step === 1 && parked > 0) {
        dispatchTutorial({ type: "BATCH_STORED" });
      } else if (
        step === 2
        && tutorialBatchSeenRef.current
        && parked === 0
        && next.result?.kind === "WIN"
      ) {
        dispatchTutorial({ type: "BATCH_AUTOFILLED" });
      }
    };

    const handleSort = (event: SortAnimationEvent) => {
      const frameRect = frame.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const created: SortSprite[] = [];
      let sourceIndex = 0;
      let order = 0;

      for (const transfer of event.transfers) {
        const selector = transfer.kind === "goal"
          ? `[data-goal-slot="${transfer.slot}"]`
          : "[data-reserve-tray]";
        const target = frame.querySelector<HTMLElement>(selector);
        if (!target) {
          sourceIndex += transfer.count;
          continue;
        }
        const targetRect = target.getBoundingClientRect();
        const centerX = targetRect.left - frameRect.left + targetRect.width * 0.5;
        const centerY = targetRect.top - frameRect.top + targetRect.height * 0.5;

        for (let item = 0; item < transfer.count; item += 1) {
          const source = event.sources[sourceIndex % Math.max(event.sources.length, 1)] ?? { x: host.clientWidth * 0.5, y: host.clientHeight * 0.45 };
          const flight = planSortFlight(
            {
              x: hostRect.left - frameRect.left + source.x,
              y: hostRect.top - frameRect.top + source.y,
            },
            {
              x: centerX + ((item % 3) - 1) * 3,
              y: centerY + ((item % 2) - 0.5) * 3,
            },
            order,
            { width: frameRect.width, height: frameRect.height },
          );
          created.push({
            id: `sort-${event.key}-${order}`,
            color: event.color,
            origin: "cluster",
            sourceX: flight.source.x,
            sourceY: flight.source.y,
            middleX: flight.middle.x,
            middleY: flight.middle.y,
            targetX: flight.target.x,
            targetY: flight.target.y,
            delayMs: order * event.staggerMs,
            flightMs: event.flightMs,
            order,
            destination: transfer.kind,
            slot: transfer.kind === "goal" ? transfer.slot : undefined,
            goalId: transfer.kind === "goal" ? transfer.goalId : undefined,
            fromCount: transfer.kind === "goal" ? transfer.fromCount : 0,
          });
          sourceIndex += 1;
          order += 1;
        }
      }
      if (created.length) setSortSprites((previous) => [...previous, ...created]);
    };

    // A batch emptying into a goal flies between two pieces of the HUD, so both
    // ends are read from the DOM the player is looking at right now.
    const handleBatchFlight = (event: BatchFlightEvent) => {
      const frameRect = frame.getBoundingClientRect();
      const batchSlot = frame.querySelector<HTMLElement>(`[data-batch-id="${event.batchId}"]`);
      const goalCard = frame.querySelector<HTMLElement>(`[data-goal-slot="${event.goalSlot}"]`);
      if (!batchSlot || !goalCard) return;

      const from = batchSlot.getBoundingClientRect();
      const to = goalCard.getBoundingClientRect();
      const created = planBatchFlight(
        { x: from.left - frameRect.left + from.width * 0.5, y: from.top - frameRect.top + from.height * 0.5 },
        { x: to.left - frameRect.left + to.width * 0.5, y: to.top - frameRect.top + to.height * 0.5 },
        event.count,
        event.staggerMs,
        { width: frameRect.width, height: frameRect.height },
      ).map((plan) => ({
        id: `batch-${event.key}-${plan.index}`,
        color: event.color,
        origin: "batch" as const,
        sourceX: plan.path.source.x,
        sourceY: plan.path.source.y,
        middleX: plan.path.middle.x,
        middleY: plan.path.middle.y,
        targetX: plan.path.target.x,
        targetY: plan.path.target.y,
        delayMs: plan.delayMs,
        flightMs: event.flightMs,
        order: plan.index,
        destination: "goal" as const,
        slot: event.goalSlot,
        goalId: event.goalId,
        fromCount: event.goalFromCount,
      }));
      if (created.length) setSortSprites((previous) => [...previous, ...created]);
    };

    const handleTutorialInteraction = (event: EngineInteractionEvent) => {
      if (engineTutorialChapter === null) return;
      dispatchTutorial(event as TutorialEvent);
    };

    const engine = new CannonSortEngine(
      host,
      modelZone,
      aimZone,
      crosshair,
      level,
      {
        onState: handleState,
        onSort: handleSort,
        onBatchFlight: handleBatchFlight,
        onHookState: setHookState,
      },
      {
        allowAnyBlockFace: engineTutorialView?.allowAnyBlockFace,
        canClaimColor: engineTutorialChapter !== null && engineTutorialChapter > 0
          ? (color) => tutorialAllowedColor(tutorialProgressRef.current) === color
          : undefined,
        rainbowTargetsEnabled: engineTutorialChapter === null
          || (engineTutorialChapter === 2 && tutorialProgressRef.current.step >= 1),
        showWeakPoints: engineTutorialView?.showWeakPoints ?? true,
        onInteraction: handleTutorialInteraction,
      },
    );
    engine.setControlSensitivity(sensitivityRef.current);
    engineRef.current = engine;
    // Run before the engine's first frame reaches the screen, in the same
    // effect that built it, so the new cluster is already pulled back and
    // turned when the level swaps in.
    if (handoffIntroRef.current) {
      handoffIntroRef.current = false;
      engine.startHandoffIntro();
    }
    // A level rebuilt under an open picker: the fresh engine knows nothing about
    // the screen that is up, so it is put back into showcase mode here.
    if (cosmeticOpenRef.current) engine.setShowcase(true);
    // The constructor built the scene and drew its first frame, so there is a
    // game under the loading screen now and it can come off. Called on every
    // level too, where it finds nothing left to do.
    advanceLoading("engine");
    finishLoading();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [dispatchTutorial, level, session]);

  // Declared after the engine effect so it runs once the engine for this
  // session exists.
  useEffect(() => {
    engineRef.current?.setIdle(screen === "hub");
  }, [screen, session]);

  useEffect(() => {
    if (screen !== "tutorial") return;
    engineRef.current?.setRainbowTargetsEnabled(
      tutorialProgress.chapter === 2 && tutorialProgress.step >= 1,
    );
  }, [screen, session, tutorialProgress.chapter, tutorialProgress.step]);

  const enterLevel = () => {
    // The cluster snaps back and the level goes live on this frame; only the
    // menu furniture takes time to leave.
    engineRef.current?.setIdle(false);
    haptic("impact");
    setHubLeaving(true);
  };

  useEffect(() => {
    if (!hubLeaving) return;
    const timer = window.setTimeout(() => {
      setScreen("playing");
      setHubLeaving(false);
      setHudRising(true);
    }, HUB_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [hubLeaving]);

  // The class is dropped once the rise is over so a later re-render cannot
  // replay it.
  useEffect(() => {
    if (!hudRising) return;
    const timer = window.setTimeout(() => setHudRising(false), HUD_RISE_MS);
    return () => window.clearTimeout(timer);
  }, [hudRising]);

  // `nextScreen` decides where the fresh level is shown. Picking a level from
  // the menu keeps you in the menu, so its cluster is the one now turning.
  // `intro: "handoff"` is for going straight from one level into the next: the
  // engine for the new level plays its own short entrance instead of the model
  // simply being replaced under a HUD that never moved.
  const startLevel = useCallback((
    nextSheet: LoadedLevelSheet,
    nextIndex: number,
    nextScreen: Screen,
    options?: { intro?: "handoff" },
  ) => {
    const nextLevel = nextSheet.levels[nextIndex];
    if (!nextLevel) return;
    const handoff = options?.intro === "handoff";
    // Read by the engine effect below, which is the only place that can reach
    // the engine built for this level.
    handoffIntroRef.current = handoff;
    modalActiveRef.current = false;
    resumeAfterModalRef.current = false;
    setModal(null);
    setSheet(nextSheet);
    setLevelIndex(nextIndex);
    setState(createGameState(nextLevel));
    setHookState(createInitialHookSnapshot());
    setSortSprites([]);
    setVisualGoalCounts({});
    setIncomingReserve(null);
    setHubLeaving(false);
    // The HUD rises with the handoff entrance, so the new level's goals arrive
    // as part of the same move as the cluster.
    setHudRising(handoff);
    setScreen(nextScreen);
    setSession((value) => value + 1);
    requestAnimationFrame(() => settingsButtonRef.current?.focus());
  }, []);

  const restart = () => startLevel(sheet, levelIndex, "playing");
  const goToLevel = (nextIndex: number) => startLevel(sheet, nextIndex, "hub");
  // Clearing a level hands straight over to the next puzzle. The menu is not
  // part of that loop any more: the next level shows up where this one was, and
  // its cluster introduces itself with the handoff entrance.
  const advanceLevel = () => startLevel(sheet, levelIndex + 1, "playing", { intro: "handoff" });
  // Leaving mid-level rewinds it: the menu shows the cluster whole, so tapping
  // play cannot drop you into a half-cleared board.
  const returnToHub = () => startLevel(sheet, levelIndex, "hub");

  const loadTutorialProgress = (next: TutorialProgress) => {
    const chapter = TUTORIAL_CHAPTERS[next.chapter];
    if (!chapter) return;
    tutorialProgressRef.current = next;
    tutorialBatchSeenRef.current = false;
    setTutorialProgress(next);
    setState(createGameState(chapter.level));
    setHookState(createInitialHookSnapshot());
    setSortSprites([]);
    setVisualGoalCounts({});
    setIncomingReserve(null);
    modalActiveRef.current = false;
    resumeAfterModalRef.current = false;
    setModal(null);
    setCosmeticOpen(false);
    cosmeticOpenRef.current = false;
    setHubLeaving(false);
    setHudRising(false);
    setScreen("tutorial");
    setSession((value) => value + 1);
  };

  const beginTutorial = () => {
    haptic("impact");
    loadTutorialProgress(createTutorialProgress());
  };

  const leaveTutorial = () => {
    tutorialProgressRef.current = createTutorialProgress();
    tutorialBatchSeenRef.current = false;
    setTutorialProgress(tutorialProgressRef.current);
    startLevel(sheet, levelIndex, "hub");
  };

  const continueTutorial = () => {
    if (tutorialProgress.step < TUTORIAL_STEP_COUNT) return;
    const next = nextTutorialChapter(tutorialProgress);
    if (next) loadTutorialProgress(next);
    else leaveTutorial();
  };

  // Dropping a sheet keeps the level number you were on, so tuning level 31
  // means edit, drop, and you are back on level 31 without replaying anything.
  const applySheetText = useCallback((text: string) => {
    const dropped = parseDroppedSheet(text);
    const warnings = dropped.issues.map(formatSheetIssue);
    const errorCount = dropped.issues.filter((issue) => issue.severity === "error").length;
    if (!dropped.levels.length) {
      setSheetNotice({
        kind: "warn",
        lines: ["No levels could be read from this file:", ...warnings.slice(0, 4)],
        key: Date.now(),
      });
      return;
    }
    setSheetNotice({
      kind: warnings.length ? "warn" : "ok",
      lines: warnings.length
        ? [
          `Loaded ${dropped.levels.length} levels with ${errorCount} error(s) and ${warnings.length - errorCount} warning(s):`,
          ...warnings.slice(0, 4),
        ]
        : [`Loaded ${dropped.levels.length} levels from the sheet`],
      key: Date.now(),
    });
    startLevel(dropped, Math.min(levelIndex, dropped.levels.length - 1), "hub");
  }, [levelIndex, startLevel]);

  const readSheetFile = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    if (!/\.(tsv|txt|csv)$/i.test(file.name)) {
      setSheetNotice({ kind: "warn", lines: [`"${file.name}" is not a .csv or .tsv file`], key: Date.now() });
      return;
    }
    applySheetText(await file.text());
  }, [applySheetText]);

  // Sheets are only imported from the menu, so a stray drop during a level can
  // never swap the board out from under a shot in flight.
  const carriesFiles = (event: ReactDragEvent) =>
    screen === "hub" && Array.from(event.dataTransfer.types).includes("Files");

  const handleSheetDragEnter = (event: ReactDragEvent) => {
    if (!carriesFiles(event)) return;
    dragDepthRef.current += 1;
    setSheetDragActive(true);
  };

  const handleSheetDragOver = (event: ReactDragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleSheetDragLeave = () => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setSheetDragActive(false);
  };

  const handleSheetDrop = (event: ReactDragEvent) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setSheetDragActive(false);
    if (screen !== "hub") return;
    void readSheetFile(event.dataTransfer.files[0]);
  };

  // Without this the browser navigates away to the dropped file whenever the
  // drop lands outside the game frame.
  useEffect(() => {
    const block = (event: Event) => event.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  useEffect(() => {
    if (!sheetNotice) return;
    const timer = window.setTimeout(() => setSheetNotice(null), sheetNotice.kind === "ok" ? 2800 : 7000);
    return () => window.clearTimeout(timer);
  }, [sheetNotice]);

  const openModal = (next: Exclude<ModalView, null>) => {
    if (modalActiveRef.current) return;
    const engine = engineRef.current;
    if (!engine) return;
    // Nothing is running in the menu, so there is nothing to pause there; the
    // cluster keeps turning behind the dialog.
    if (screen === "playing") {
      const shouldResume = engine.pause();
      if (!shouldResume) return;
      resumeAfterModalRef.current = true;
    }
    modalActiveRef.current = true;
    setModal(next);
  };

  const closeModal = useCallback(() => {
    const opener = modal === "settings" ? settingsButtonRef.current : restartButtonRef.current;
    modalActiveRef.current = false;
    setModal(null);
    if (resumeAfterModalRef.current) engineRef.current?.resume();
    resumeAfterModalRef.current = false;
    requestAnimationFrame(() => opener?.focus());
  }, [modal]);

  // The picker borrows the engine that is already running: the page keeps one
  // WebGL context, so a second canvas for the preview would eventually cost the
  // game its own.
  const openCosmetics = () => {
    const engine = engineRef.current;
    if (!engine) return;
    setCosmeticThumbnails(engine.captureCosmeticThumbnails());
    setPreviewCosmetic(equippedCosmetic);
    engine.setCosmetic(equippedCosmetic);
    engine.setShowcase(true);
    cosmeticOpenRef.current = true;
    setCosmeticOpen(true);
  };

  const closeCosmetics = useCallback(() => {
    cosmeticOpenRef.current = false;
    setCosmeticOpen(false);
    const engine = engineRef.current;
    // A skin that was only being looked at goes back to whatever is equipped.
    engine?.setCosmetic(equippedCosmetic);
    engine?.setShowcase(false);
    setPreviewCosmetic(equippedCosmetic);
    // The menu is unmounted while the picker is up, so the Skin button does not
    // exist yet to hand focus back to. The effect below does it once it returns.
    cosmeticClosingRef.current = true;
  }, [equippedCosmetic]);

  useEffect(() => {
    if (cosmeticOpen || !cosmeticClosingRef.current) return;
    cosmeticClosingRef.current = false;
    skinButtonRef.current?.focus();
  }, [cosmeticOpen]);

  const showCosmetic = (id: CosmeticId) => {
    setPreviewCosmetic(id);
    engineRef.current?.setCosmetic(id);
  };

  const equipCosmetic = () => {
    setEquippedCosmetic(previewCosmetic);
    storeSelectedCosmetic(previewCosmetic);
    haptic("impact");
  };

  useEffect(() => {
    if (!cosmeticOpen) return;
    // Focused straight from the effect rather than on the next frame: the tree
    // is already committed here, so there is nothing to wait for.
    cosmeticCloseRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCosmetics();
        return;
      }
      if (event.key !== "Tab") return;
      cycleFocus(cosmeticOverlayRef.current, event);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeCosmetics, cosmeticOpen]);

  const updateModelRotateSensitivity = (value: number) => {
    sensitivityRef.current = { ...sensitivityRef.current, modelRotate: value };
    setModelRotateSensitivity(value);
    engineRef.current?.setControlSensitivity({ modelRotate: value });
  };

  const updateAimDragSensitivity = (value: number) => {
    sensitivityRef.current = { ...sensitivityRef.current, aimDrag: value };
    setAimDragSensitivity(value);
    engineRef.current?.setControlSensitivity({ aimDrag: value });
  };

  const updateHapticsEnabled = (next: boolean) => {
    setHapticsEnabled(next);
    setHapticsOn(next);
    // Turning it on buzzes once so the choice is felt, not just read.
    if (next) haptic("impact");
  };

  useEffect(() => {
    if (!modal) return;
    const focusFrame = requestAnimationFrame(() => {
      if (modal === "settings") settingsFirstControlRef.current?.focus();
      else restartNoButtonRef.current?.focus();
    });
    const handleModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== "Tab") return;
      cycleFocus(modalOverlayRef.current, event);
    };
    window.addEventListener("keydown", handleModalKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleModalKeyDown);
    };
  }, [closeModal, modal]);

  const completeSortSprite = (sprite: SortSprite) => {
    // Fires as each cube actually reaches its slot, so the buzz lands with the
    // cube rather than with the shot that sent it.
    hapticBlockLanded(sprite.order);
    setSortSprites((previous) => previous.filter((candidate) => candidate.id !== sprite.id));
    if (sprite.destination === "goal" && sprite.goalId) {
      setVisualGoalCounts((previous) => ({
        ...previous,
        [sprite.goalId!]: Math.max(previous[sprite.goalId!] ?? sprite.fromCount, sprite.fromCount) + 1,
      }));
    } else {
      setIncomingReserve((previous) => ({
        color: sprite.color,
        count: (previous?.color === sprite.color ? previous.count : 0) + 1,
      }));
    }
  };

  const parkedBlocks = state.batches.reduce((total, batch) => total + batch.count, 0);
  const batchWarning = parkedBlocks >= level.reserveBlocks;
  // Exactly one slot per block the level allows, always all of them: the row is
  // the budget drawn out, so "how much room is left" is something to count
  // rather than a number to read. Filled slots come first, in record order, and
  // each carries the id of the record it belongs to so a batch emptying into a
  // goal can be measured from the exact slots that are leaving.
  const filledSlots = [
    ...state.batches.flatMap((batch) => Array.from({ length: batch.count }, (_, block) => ({
      key: `${batch.id}-${block}`,
      batchId: batch.id,
      color: batch.color,
    }))),
    ...(incomingReserve ? Array.from({ length: incomingReserve.count }, (_, block) => ({
      key: `incoming-${block}`,
      batchId: undefined,
      color: incomingReserve.color,
    })) : []),
  ];
  // A reserve over budget can only exist for the frame before the level ends,
  // so the row grows rather than clipping the blocks that caused it.
  const traySlots = Array.from({ length: Math.max(level.reserveBlocks, filledSlots.length) }, (_, index) =>
    filledSlots[index] ?? { key: `socket-${index}`, batchId: undefined, color: null });
  const bypassArmed = hookState.weakPointBypassArmed;
  const showGoals = screen === "playing" || tutorialView?.showGoals === true;
  const showReserve = screen === "playing" || tutorialView?.showReserve === true;
  const showClimaxFeedback = (screen === "playing" || (tutorialMode && tutorialProgress.chapter === 2)) && bypassArmed;
  const tutorialSteps = TUTORIAL_COPY[tutorialProgress.chapter] ?? TUTORIAL_COPY[0];
  const tutorialStepCopy = tutorialProgress.step < TUTORIAL_STEP_COUNT
    ? tutorialSteps[tutorialProgress.step]
    : null;
  const tutorialComplete = tutorialProgress.step >= TUTORIAL_STEP_COUNT;
  const tutorialFocusColor = tutorialMode ? tutorialAllowedColor(tutorialProgress) : null;
  return (
    <main className="page-shell">
      <section
        className={`game-frame ${bypassArmed ? "is-rainbow-armed" : ""} ${state.phase === "PAUSED" ? "is-paused" : ""} ${sheetDragActive ? "is-sheet-drag" : ""} ${tutorialMode ? `is-tutorial tutorial-${tutorialChapter.id}` : ""} ${tutorialMode && !showGoals && !showReserve ? "is-tutorial-no-hud" : ""}`}
        ref={gameFrameRef}
        aria-label="Prototype game 3D Cannon Sort"
        onDragEnter={handleSheetDragEnter}
        onDragOver={handleSheetDragOver}
        onDragLeave={handleSheetDragLeave}
        onDrop={handleSheetDrop}
      >
        <div className="game-content" inert={modal !== null ? true : undefined} aria-hidden={modal !== null}>
          {showClimaxFeedback && !state.result && <ClimaxFireworks />}
          {/* Absolutely positioned rather than a row in .hud-top: a banner that
              only exists while armed would otherwise change --hud-height every
              time a target is hit, and the 3D scene would jump with it. */}
          {showClimaxFeedback && !state.result && (
            <div className="bypass-banner" role="status" aria-live="polite">
              <span className="bypass-banner-wave" aria-hidden="true" />
              <strong>Next shot ignores Weak Points</strong>
            </div>
          )}
          {screen === "playing" && (
          <div className={`game-tools ${hudRising ? "is-rising" : ""}`} role="toolbar" aria-label="Level tools">
            <button ref={settingsButtonRef} className="icon-button" type="button" onClick={() => openModal("settings")} aria-label="Open settings" aria-haspopup="dialog" aria-expanded={modal === "settings"}>⚙</button>
            <button ref={restartButtonRef} className="icon-button" type="button" onClick={() => openModal("restart-confirm")} aria-label="Restart level" aria-haspopup="dialog" aria-expanded={modal === "restart-confirm"}>↻</button>
          </div>
          )}

        {/* The picker replaces the menu rather than covering it: the level name,
            the side buttons and the play hint all belong to choosing a level,
            not to choosing a skin, and leaving them behind a half-transparent
            screen only made two screens fight over the same pixels. */}
        {screen === "hub" && !cosmeticOpen && (
          <div
            className={`hub-screen ${hubLeaving ? "is-leaving" : ""}`}
            role="group"
            aria-label={`Level ${level.id} menu`}
          >
            {/* The whole screen is the play button, with the buttons that sit on
                top of it rendered after it so they win the tap. */}
            <button
              className="hub-tap"
              type="button"
              onClick={enterLevel}
              aria-label={`Play level ${level.id}: ${level.name}`}
            >
              <span className="hub-play-hint"><span>TAP TO PLAY</span></span>
            </button>

            <h2 className="hub-level-name">{level.name}</h2>

            <div className="hub-side-buttons">
              <button
                ref={skinButtonRef}
                className="hub-side-button"
                type="button"
                onClick={openCosmetics}
                aria-haspopup="dialog"
                aria-expanded={cosmeticOpen}
              >
                <CannonMountIcon />
                Skin
              </button>
              <button
                className="hub-side-button hub-tutorial-button"
                type="button"
                onClick={beginTutorial}
                aria-label="Open the three-part tutorial"
              >
                <span className="hub-tutorial-icon" aria-hidden="true">?</span>
                Tutorial
              </button>
            </div>

            <button
              ref={settingsButtonRef}
              className="icon-button hub-settings-button"
              type="button"
              onClick={() => openModal("settings")}
              aria-label="Open settings"
              aria-haspopup="dialog"
              aria-expanded={modal === "settings"}
            >
              ⚙
            </button>
          </div>
        )}

        {screen === "hub" && cosmeticOpen && (
          <div
            ref={cosmeticOverlayRef}
            className="cosmetic-screen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cosmetic-title"
          >
            <div className="cosmetic-bar">
              <div className="cosmetic-heading">
                <h2 id="cosmetic-title">{getCosmetic(previewCosmetic).name}</h2>
                <p>{getCosmetic(previewCosmetic).tagline}</p>
              </div>
              <button
                ref={cosmeticCloseRef}
                className="cosmetic-close"
                type="button"
                onClick={closeCosmetics}
                aria-label="Close skins"
              >
                ✕
              </button>
            </div>

            {/* Deliberately empty: the rig in the middle is the real one, drawn
                by the engine behind this screen, so the stage stays see-through. */}
            <div className="cosmetic-stage" aria-hidden="true" />

            <button
              className="cosmetic-equip"
              type="button"
              onClick={equipCosmetic}
              disabled={previewCosmetic === equippedCosmetic}
            >
              {previewCosmetic === equippedCosmetic ? "Selected" : "Select"}
            </button>

            <div className="cosmetic-tray">
              <div className="cosmetic-grid">
                {COSMETIC_ORDER.map((id) => (
                  <button
                    key={id}
                    className={`cosmetic-card ${previewCosmetic === id ? "is-previewing" : ""}`}
                    type="button"
                    onClick={() => showCosmetic(id)}
                    aria-pressed={previewCosmetic === id}
                    aria-label={`${COSMETICS[id].name}${equippedCosmetic === id ? ", selected" : ""}`}
                  >
                    {cosmeticThumbnails[id]
                      // A data URL rendered from the rig itself a moment ago:
                      // there is no file for an image loader to optimise.
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={cosmeticThumbnails[id]} alt="" />
                      : <span className="cosmetic-card-blank" aria-hidden="true">◈</span>}
                    {equippedCosmetic === id && <span className="cosmetic-card-tick" aria-hidden="true">✓</span>}
                  </button>
                ))}
                {/* Visibly inert rather than hidden, so the tray shows how much
                    room there is for skins that do not exist yet. */}
                {Array.from({ length: LOCKED_COSMETIC_SLOTS }, (_, index) => (
                  <button
                    key={`locked-${index}`}
                    className="cosmetic-card is-locked"
                    type="button"
                    disabled
                    aria-label="Locked skin slot"
                  >
                    🔒
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tutorialMode && (
          <div className="tutorial-layer">
            <header className="tutorial-header">
              <div>
                <span>{tutorialChapter.eyebrow}</span>
                <strong>{tutorialChapter.title}</strong>
              </div>
              <button type="button" onClick={leaveTutorial} aria-label="Exit tutorial">✕</button>
            </header>

            <div className="tutorial-chapter-rail" aria-label={`Tutorial chapter ${tutorialProgress.chapter + 1} of ${TUTORIAL_CHAPTERS.length}`}>
              {TUTORIAL_CHAPTERS.map((chapter, index) => (
                <i
                  key={chapter.id}
                  className={`${index < tutorialProgress.chapter ? "is-done" : ""} ${index === tutorialProgress.chapter ? "is-current" : ""}`}
                  aria-hidden="true"
                />
              ))}
            </div>

            <section
              className={`tutorial-coach ${tutorialComplete ? "is-complete" : ""}`}
              aria-live="polite"
              style={tutorialFocusColor
                ? ({ "--tutorial-focus": COLOR_META[tutorialFocusColor].hex } as CSSProperties)
                : undefined}
            >
              <p className="tutorial-coach-kicker">
                {tutorialComplete ? "Lesson complete" : `Step ${tutorialProgress.step + 1} of ${TUTORIAL_STEP_COUNT}`}
              </p>
              <h2>{tutorialComplete ? "You have got it" : tutorialStepCopy?.title}</h2>
              <p className="tutorial-coach-body">
                {tutorialComplete
                  ? tutorialProgress.chapter === TUTORIAL_CHAPTERS.length - 1
                    ? "All three concepts are ready. The campaign now combines them without tutorial locks."
                    : "This concept is complete. The next lesson reveals one more part of the game."
                  : tutorialStepCopy?.body}
              </p>
              {!tutorialComplete && <span className="tutorial-hint">{tutorialStepCopy?.hint}</span>}
              <div className="tutorial-step-dots" aria-hidden="true">
                {tutorialSteps.map((step, index) => (
                  <i
                    key={step.title}
                    className={`${index < tutorialProgress.step ? "is-done" : ""} ${index === tutorialProgress.step ? "is-current" : ""}`}
                  >{index < tutorialProgress.step ? "✓" : index + 1}</i>
                ))}
              </div>
            </section>

            {tutorialComplete && (
              <button className="tutorial-next" type="button" onClick={continueTutorial}>
                {tutorialProgress.chapter === TUTORIAL_CHAPTERS.length - 1 ? "Finish tutorial" : "Next lesson"} →
              </button>
            )}
          </div>
        )}

        <div className={`hud-top ${hudRising ? "is-rising" : ""}`} hidden={!showGoals && !showReserve}>
          {showGoals && state.activeGoals.some((goal) => goal !== null) && (
          <section className="goal-section" aria-label="Active goals">
            <div className="goal-grid">
              {state.activeGoals.map((goal, index) => {
                // The emptied slot keeps its grid cell so the goal still in play
                // does not slide sideways when its neighbour finishes.
                if (!goal) return <div className="goal-slot-empty" data-goal-slot={index} key={`empty-${index}`} aria-hidden="true" />;
                const meta = COLOR_META[goal.color];
                const shownCount = visualGoalCounts[goal.id] ?? goal.current;
                const fillRatio = Math.min(1, goal.target === 0 ? 1 : shownCount / goal.target);
                return (
                  <article
                    className={`goal-card ${shownCount >= goal.target ? "is-full" : ""} ${tutorialFocusColor === goal.color ? "is-tutorial-focus" : ""}`}
                    data-goal-slot={index}
                    key={goal.id}
                    style={{ "--goal": meta.hex, "--goal-fill": `${fillRatio * 100}%` } as CSSProperties}
                    aria-label={`Goal ${meta.short}: ${shownCount} of ${goal.target}`}
                  >
                    <span className="cube-icon" aria-hidden="true" />
                    <span className="goal-count" aria-hidden="true">
                      <strong key={shownCount}>{shownCount}</strong>
                      <small>/{goal.target}</small>
                    </span>
                    <span className="goal-bar" aria-hidden="true"><i /></span>
                  </article>
                );
              })}
            </div>
          </section>
          )}

          {showReserve && <section className={`batch-section ${batchWarning ? "is-warning" : ""} ${tutorialProgress.chapter === 1 && tutorialProgress.step === 1 ? "is-tutorial-focus" : ""}`} aria-label="Reserve">
            {/* The count lives only in the label now: on screen it is the slots
                themselves, the taken ones and the empty ones together. */}
            <div
              className="batch-slot"
              data-reserve-tray=""
              style={{ "--pips": traySlots.length } as CSSProperties}
              aria-label={`Reserve, ${parkedBlocks} of ${level.reserveBlocks} block${level.reserveBlocks === 1 ? "" : "s"} used`}
            >
              <span className="batch-tray" aria-hidden="true">
                {traySlots.map((slot) => (
                  <i
                    className={slot.color ? "batch-pip" : "batch-pip is-socket"}
                    data-batch-id={slot.batchId}
                    key={slot.key}
                    style={slot.color ? ({ "--batch": COLOR_META[slot.color].hex } as CSSProperties) : undefined}
                  />
                ))}
              </span>
            </div>
          </section>}
        </div>

        <div className="scene-wrap">
          <div className="scene-host" ref={sceneHostRef} />
          <div ref={modelZoneRef} className="model-input-zone" role="application" aria-label="Drag to rotate the block model 360 degrees" />
          {tutorialMode && tutorialStepCopy?.gesture && (
            <div className={`tutorial-gesture tutorial-gesture-${tutorialStepCopy.gesture}`} aria-hidden="true">
              <span>☝</span>
              <i />
              <b>{tutorialStepCopy.gesture === "rotate" ? "DRAG TO ROTATE" : "DRAG & RELEASE"}</b>
            </div>
          )}
          <span ref={crosshairRef} className="aim-crosshair" aria-hidden="true">
            <span className="aim-crosshair-core" />
          </span>

          {screen === "playing" && state.postWinClearing && (
            <div className="auto-clear-label"><span>COMPLETE</span><b>Auto clear</b></div>
          )}

          <div
            ref={aimZoneRef}
            className="aim-zone"
            role="application"
            aria-label="Drag to aim; a plus only means the shot will hit a block or Rainbow Target, not that it will hit a Weak Point; an X means a miss; drag back to the centre to cancel"
          >
            <span className="aim-joystick" aria-hidden="true">
              <span className="aim-joystick-knob" />
            </span>
          </div>

        </div>

        {/* A sibling of the scene rather than a child of it. `.scene-wrap` is
            inset below the HUD, so an overlay inside it started 116px down the
            frame — that was the bright strip left showing along the top — and
            its `overflow: hidden` clipped the fireworks as well. */}
        {screen === "playing" && state.result && !state.postWinClearing && (
          <div className={`result-overlay result-${state.result.kind.toLowerCase()}`}>
            {/* Behind the panel, so the sparks read as bursting out from under
                it rather than streaking across the text. */}
            {state.result.kind === "WIN" && <ResultFireworks />}
            <section className="result-card">
              <div className="result-medal">{state.result.kind === "WIN" ? "★" : "!"}</div>
              <h2>{state.result.kind === "WIN" ? "Perfect sorting!" : state.result.reason}</h2>
              <p>
                {state.result.kind === "WIN"
                  ? "All clear — the whole model has been cleared."
                  : FAIL_BODY[state.result.reason ?? ""] ?? "That shot could not be sorted."}
              </p>
              <div className="result-actions">
                <button type="button" onClick={restart}>↻ Replay level</button>
                {state.result.kind === "WIN" && sheet.levels[levelIndex + 1] && (
                  <button type="button" className="result-next" onClick={advanceLevel}>Next level →</button>
                )}
              </div>
            </section>
          </div>
        )}

          <div className="sort-flight-layer" aria-hidden="true">
          {sortSprites.map((sprite) => (
            <span
              className={`sort-flight-cube ${sprite.origin === "batch" ? "is-from-batch" : ""}`}
              key={sprite.id}
              onAnimationEnd={() => completeSortSprite(sprite)}
              style={{
                "--sort-color": COLOR_META[sprite.color].hex,
                "--sort-sx": `${sprite.sourceX}px`,
                "--sort-sy": `${sprite.sourceY}px`,
                "--sort-mx": `${sprite.middleX}px`,
                "--sort-my": `${sprite.middleY}px`,
                "--sort-tx": `${sprite.targetX}px`,
                "--sort-ty": `${sprite.targetY}px`,
                "--sort-delay": `${sprite.delayMs}ms`,
                "--sort-flight": `${sprite.flightMs}ms`,
              } as CSSProperties}
            />
          ))}
          </div>
        </div>

        {sheetDragActive && (
          <div className="sheet-drop-hint" aria-hidden="true"><span>Drop a .csv or .tsv file to load levels</span></div>
        )}

        {sheetNotice && (
          <div className={`sheet-toast ${sheetNotice.kind === "warn" ? "is-warn" : ""}`} key={sheetNotice.key} role="status">
            {sheetNotice.lines.map((line, index) => <p key={`${sheetNotice.key}-${index}`}>{line}</p>)}
          </div>
        )}

        {modal === "settings" && (
          <div ref={modalOverlayRef} className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-describedby="settings-description">
            <section className="modal-card settings-card">
              <div className="modal-icon" aria-hidden="true">⚙</div>
              <h2 id="settings-title">Settings</h2>
              <p id="settings-description" className="modal-description">Adjust drag sensitivity without changing the maximum aim range.</p>

              <div className="sensitivity-control">
                <label htmlFor="model-rotate-sensitivity"><b>Rotate blocks</b><output htmlFor="model-rotate-sensitivity">{Math.round(modelRotateSensitivity * 100)}%</output></label>
                <input
                  ref={settingsFirstControlRef}
                  id="model-rotate-sensitivity"
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={modelRotateSensitivity}
                  aria-valuetext={`${Math.round(modelRotateSensitivity * 100)}%`}
                  onChange={(event) => updateModelRotateSensitivity(Number(event.target.value))}
                />
              </div>

              <div className="sensitivity-control">
                <label htmlFor="aim-drag-sensitivity"><b>Aim and shoot</b><output htmlFor="aim-drag-sensitivity">{Math.round(aimDragSensitivity * 100)}%</output></label>
                <input
                  id="aim-drag-sensitivity"
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={aimDragSensitivity}
                  aria-valuetext={`${Math.round(aimDragSensitivity * 100)}%`}
                  onChange={(event) => updateAimDragSensitivity(Number(event.target.value))}
                />
              </div>

              <div className="toggle-control">
                <label htmlFor="haptics-toggle">
                  <b>Haptics</b>
                  <span>{hapticsAvailable ? "Vibrates on impact and as blocks land in a slot" : "This device does not support vibration"}</span>
                </label>
                <input
                  id="haptics-toggle"
                  type="checkbox"
                  role="switch"
                  checked={hapticsOn}
                  disabled={!hapticsAvailable}
                  onChange={(event) => updateHapticsEnabled(event.target.checked)}
                />
              </div>

              {/* Levels and sheet import live here, reachable only from the
                  menu, so a level never changes mid-play. */}
              {screen === "hub" ? (
                <>
                  <p className="settings-section-label">
                    {sheet.levels.length} levels, read from {SHEET_SOURCE_LABEL[sheet.source]}
                  </p>

                  <div className="level-list">
                    {sheet.levels.map((entry, index) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`level-row ${index === levelIndex ? "is-current" : ""}`}
                        onClick={() => goToLevel(index)}
                        aria-current={index === levelIndex}
                      >
                        <b>{entry.id}</b>
                        <span>{entry.name}</span>
                        <small>{entry.blocks.length} blocks</small>
                      </button>
                    ))}
                  </div>

                  {sheet.issues.length > 0 && (
                    <ul className="sheet-issue-list">
                      {sheet.issues.slice(0, 5).map((issue) => (
                        <li key={`${issue.row}-${issue.message}`}>{formatSheetIssue(issue)}</li>
                      ))}
                    </ul>
                  )}

                  <label className="sheet-file-button">
                    Open a .csv or .tsv file
                    <input
                      type="file"
                      accept=".csv,.tsv,.txt"
                      onChange={(event) => {
                        void readSheetFile(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </>
              ) : (
                <button className="hub-return-button" type="button" onClick={returnToHub}>Back to menu</button>
              )}

              <button className="modal-done-button" type="button" onClick={closeModal}>Done</button>
            </section>
          </div>
        )}

        {modal === "restart-confirm" && (
          <div ref={modalOverlayRef} className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="restart-title" aria-describedby="restart-description">
            <section className="modal-card restart-card">
              <div className="modal-icon restart-icon" aria-hidden="true">↻</div>
              <h2 id="restart-title">Restart?</h2>
              <p id="restart-description" className="modal-description">Restart the whole level and lose your progress</p>
              <div className="restart-actions">
                <button ref={restartNoButtonRef} className="confirm-no" type="button" onClick={closeModal}>No</button>
                <button className="confirm-yes" type="button" onClick={restart}>Yes</button>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
