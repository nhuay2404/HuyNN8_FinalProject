import type { BlockColor } from "./types";

export const TUTORIAL_CHAPTER_COUNT = 3;
export const TUTORIAL_ROTATE_DISTANCE = 72;
export const TUTORIAL_AIM_DISTANCE = 28;

export type TutorialProgress = Readonly<{
  chapter: number;
  step: number;
  rotateDistance: number;
  /**
   * The dim is gone for the rest of this chapter.
   *
   * The scrim exists so the player reads one thing; the moment they start doing
   * that thing it is in the way. It is sticky per chapter rather than per step,
   * because "drag to aim" and "release to fire" are one continuous gesture — the
   * dim coming back between them would flash over the shot being taken.
   */
  scrimHidden: boolean;
}>;

export type TutorialEvent =
  | Readonly<{ type: "MODEL_ROTATED"; distance: number }>
  | Readonly<{ type: "AIM_TOUCHED" }>
  | Readonly<{ type: "MODEL_RESET" }>
  | Readonly<{ type: "AIM_DRAGGED"; distance: number }>
  | Readonly<{ type: "SHOT_FIRED" }>
  | Readonly<{ type: "TAP_ADVANCED" }>
  | Readonly<{ type: "LEVEL_WON" }>
  | Readonly<{ type: "SORT_PROGRESS" }>
  | Readonly<{ type: "BATCH_STORED" }>
  | Readonly<{ type: "BATCH_AUTOFILLED" }>
  | Readonly<{ type: "WEAK_POINT_CLEARED" }>
  | Readonly<{ type: "RAINBOW_HIT" }>
  | Readonly<{ type: "BYPASS_USED" }>;

export type TutorialPresentation = Readonly<{
  showGoals: boolean;
  showReserve: boolean;
  showWeakPoints: boolean;
  showRainbow: boolean;
  allowAnyBlockFace: boolean;
}>;

/**
 * The region the scrim cuts a hole in for a step, or null for no scrim at all.
 *
 * `model`, `cannon` and `sky` are places inside the 3D scene, which has no DOM
 * to measure, so they are fractions of the scene box. `goals` and `reserve` are
 * real elements whose position depends on the HUD height and the safe area, so
 * those are measured instead of guessed.
 */
export type TutorialFocus = "model" | "cannon" | "sky" | "goals" | "reserve";

export type TutorialGlyphName =
  | "rotate"
  | "recenter"
  | "drag"
  | "release"
  | "goal"
  | "reserve"
  | "autosort"
  | "mark"
  | "rainbow"
  | "bypass";

export type TutorialStepCopy = Readonly<{
  /** The pictogram that carries the instruction. */
  glyph: TutorialGlyphName;
  /** Three or four words naming the pictogram. Never a sentence. */
  caption: string;
  /**
   * The same instruction as a full sentence, for screen readers only.
   *
   * The visual is a picture and a label because a wall of text is the thing a
   * player skips. Assistive tech cannot read a spotlight or an animated hand,
   * so the sentence still has to exist — just not on screen.
   */
  described: string;
  /** null means the cue stays but nothing is dimmed or ringed. */
  focus: TutorialFocus | null;
  gesture: "rotate" | "hold" | "aim" | null;
  /**
   * `tap` steps are read, not played: a tap anywhere moves to the next one, and
   * nothing can be shot while one is up. `event` steps wait for the player to
   * actually do the thing.
   */
  advance: "tap" | "event";
  /** Drop the dim as soon as a finger lands on the aim zone. */
  dimDropsOnAimTouch?: boolean;
}>;

export const TUTORIAL_COPY: readonly (readonly TutorialStepCopy[])[] = [
  [
    {
      glyph: "rotate",
      caption: "Find the mark",
      described: "Drag across the blocks to turn the model. Every cluster has one marked face, and some of them start out of sight.",
      focus: "model",
      gesture: "rotate",
      advance: "event",
    },
    {
      glyph: "recenter",
      caption: "Hold to reset",
      described: "Press and hold on the blocks to swing the model back to the pose it started in.",
      focus: "model",
      gesture: "hold",
      advance: "event",
    },
    {
      glyph: "drag",
      caption: "Drag to aim",
      described: "Hold low on the screen and drag. The cannon and the crosshair follow your drag.",
      focus: "cannon",
      gesture: "aim",
      advance: "event",
      dimDropsOnAimTouch: true,
    },
    {
      glyph: "release",
      caption: "Release to fire",
      described: "Let go while the crosshair sits on a marked face. The ball follows the arc you previewed.",
      focus: "cannon",
      gesture: "aim",
      advance: "event",
      dimDropsOnAimTouch: true,
    },
  ],
  [
    // Read all three beats first, then play them. Gating each beat behind its own
    // shot meant the explanation for the reserve only arrived once a cluster was
    // already sitting in it.
    {
      glyph: "goal",
      caption: "Match the goal",
      described: "A cluster whose colour matches the open goal flies straight into it.",
      focus: "goals",
      gesture: null,
      advance: "tap",
    },
    {
      glyph: "reserve",
      caption: "No match waits",
      described: "A cluster with no goal open for it parks in the reserve instead.",
      focus: "reserve",
      gesture: null,
      advance: "tap",
    },
    {
      glyph: "autosort",
      caption: "Reserve auto-sorts",
      described: "When a goal finishes and the next one opens, whatever was waiting in the reserve sorts itself.",
      focus: "goals",
      gesture: null,
      advance: "tap",
    },
    {
      glyph: "release",
      caption: "Now clear it",
      described: "Clear the board. The board is built so all three of those happen on the way.",
      focus: null,
      gesture: null,
      advance: "event",
    },
  ],
  [
    {
      glyph: "mark",
      caption: "Hit the mark",
      described: "Only the marked face breaks a cluster, and anywhere on that face counts.",
      focus: "model",
      gesture: null,
      advance: "event",
    },
    {
      glyph: "rainbow",
      caption: "Hit the rainbow",
      described: "Catch the rainbow target while it crosses the screen.",
      focus: "sky",
      gesture: null,
      advance: "event",
    },
    {
      glyph: "bypass",
      caption: "Now any face",
      described: "One shot now ignores marks, so any face of the blue cluster breaks it.",
      focus: "model",
      gesture: null,
      advance: "event",
    },
  ],
];

/** Chapters are different lengths: the sort lesson reads three cards then plays. */
export function tutorialStepCount(chapter: number): number {
  return (TUTORIAL_COPY[chapter] ?? TUTORIAL_COPY[0]).length;
}

export function tutorialStep(progress: TutorialProgress): TutorialStepCopy | null {
  return TUTORIAL_COPY[progress.chapter]?.[progress.step] ?? null;
}

export function isTutorialChapterComplete(progress: TutorialProgress): boolean {
  return progress.step >= tutorialStepCount(progress.chapter);
}

/** Whether the dim and its ring are drawn right now. */
export function tutorialScrimVisible(progress: TutorialProgress): boolean {
  if (progress.scrimHidden || isTutorialChapterComplete(progress)) return false;
  return tutorialStep(progress)?.focus !== null;
}

export function createTutorialProgress(chapter = 0): TutorialProgress {
  return { chapter, step: 0, rotateDistance: 0, scrimHidden: false };
}

export function reduceTutorialProgress(progress: TutorialProgress, event: TutorialEvent): TutorialProgress {
  if (isTutorialChapterComplete(progress)) return progress;
  const step = tutorialStep(progress);
  if (!step) return progress;

  // Touching the aim zone is the player starting the thing the card describes,
  // so the dim goes even though the step itself has not finished.
  if (event.type === "AIM_TOUCHED") {
    return step.dimDropsOnAimTouch && !progress.scrimHidden ? { ...progress, scrimHidden: true } : progress;
  }

  if (step.advance === "tap") {
    if (event.type !== "TAP_ADVANCED") return progress;
    const next = progress.step + 1;
    // The tap that leaves the last card is the one that clears the dim, so the
    // board is fully visible for the play that follows.
    const nextStep = TUTORIAL_COPY[progress.chapter]?.[next] ?? null;
    return { ...progress, step: next, scrimHidden: progress.scrimHidden || nextStep?.focus == null };
  }
  if (event.type === "TAP_ADVANCED") return progress;

  if (progress.chapter === 0) {
    if (progress.step === 0 && event.type === "MODEL_ROTATED") {
      const rotateDistance = progress.rotateDistance + Math.max(0, event.distance);
      return {
        ...progress,
        rotateDistance,
        step: rotateDistance >= TUTORIAL_ROTATE_DISTANCE ? 1 : 0,
      };
    }
    if (progress.step === 1 && event.type === "MODEL_RESET") return { ...progress, step: 2 };
    if (progress.step === 2 && event.type === "AIM_DRAGGED" && event.distance >= TUTORIAL_AIM_DISTANCE) {
      return { ...progress, step: 3 };
    }
    if (progress.step === 3 && event.type === "SHOT_FIRED") return { ...progress, step: 4 };
    return progress;
  }

  if (progress.chapter === 1) {
    // Only the last step of this chapter is event-driven, and the board being
    // clear is what finishes it.
    return event.type === "LEVEL_WON" ? { ...progress, step: progress.step + 1 } : progress;
  }

  const expected = ["WEAK_POINT_CLEARED", "RAINBOW_HIT", "BYPASS_USED"];
  if (event.type !== expected[progress.step]) return progress;
  // Catching the target is the reward beat; the dim has no business sitting over
  // the fireworks and the armed banner that follow it.
  const scrimHidden = progress.scrimHidden || event.type === "RAINBOW_HIT";
  return { ...progress, step: progress.step + 1, scrimHidden };
}

export function tutorialPresentation(chapter: number): TutorialPresentation {
  return {
    showGoals: chapter === 1,
    showReserve: chapter === 1,
    // Marks are on the model from the very first shot, and no lesson lets an
    // unmarked face break a cluster. The old tutorial did the opposite: two
    // lessons taught "any face works", then the third revealed marks and
    // contradicted them. A rule the player has to unlearn is worse than a rule
    // that starts out strict.
    showWeakPoints: true,
    showRainbow: chapter === 2,
    allowAnyBlockFace: false,
  };
}

export function tutorialAllowedColor(progress: TutorialProgress): BlockColor | null {
  // The sort lesson no longer locks a colour per step: the board's own blockers
  // force the order, so every claim the player can reach is one they may take.
  if (progress.chapter === 2) return (["red", null, "blue"] as const)[progress.step] ?? null;
  return null;
}

export function nextTutorialChapter(progress: TutorialProgress): TutorialProgress | null {
  const chapter = progress.chapter + 1;
  return chapter < TUTORIAL_CHAPTER_COUNT ? createTutorialProgress(chapter) : null;
}
