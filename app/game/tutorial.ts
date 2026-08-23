import type { BlockColor } from "./types";

export const TUTORIAL_CHAPTER_COUNT = 3;
export const TUTORIAL_STEP_COUNT = 3;
export const TUTORIAL_ROTATE_DISTANCE = 72;
export const TUTORIAL_AIM_DISTANCE = 28;

export type TutorialProgress = Readonly<{
  chapter: number;
  step: number;
  rotateDistance: number;
}>;

export type TutorialEvent =
  | Readonly<{ type: "MODEL_ROTATED"; distance: number }>
  | Readonly<{ type: "AIM_DRAGGED"; distance: number }>
  | Readonly<{ type: "SHOT_FIRED" }>
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

export type TutorialStepCopy = Readonly<{
  title: string;
  body: string;
  hint: string;
  gesture: "rotate" | "aim" | null;
}>;

export const TUTORIAL_COPY: readonly (readonly TutorialStepCopy[])[] = [
  [
    {
      title: "Rotate the 3D model",
      body: "Drag directly across the blocks. Turn the puzzle to inspect faces that the camera cannot see yet.",
      hint: "Drag the upper play area left or right",
      gesture: "rotate",
    },
    {
      title: "Drag to aim the cannon",
      body: "Start in the lower play area and keep holding. The cannon and crosshair follow the direction of your drag.",
      hint: "Drag away from the centre until the crosshair locks on",
      gesture: "aim",
    },
    {
      title: "Release to fire",
      body: "Let go while the crosshair is over the model. The ball follows the exact arc you previewed.",
      hint: "Release your drag to take the shot",
      gesture: "aim",
    },
  ],
  [
    {
      title: "Fill the active Goal",
      body: "Shoot either Red block. A matching cluster flies straight into the Red Goal at the top.",
      hint: "Shoot 1 Red block",
      gesture: null,
    },
    {
      title: "Store an unmatched block",
      body: "Red still needs one more block. Shoot Blue now: because Blue has no open Goal, it waits in the Reserve.",
      hint: "Shoot the Blue block",
      gesture: null,
    },
    {
      title: "Open the next Goal",
      body: "Shoot the remaining Red. Red completes, the Blue Goal opens, and the stored batch automatically sorts itself.",
      hint: "Shoot the last Red block",
      gesture: null,
    },
  ],
  [
    {
      title: "Break a Weak Point face",
      body: "The white target marks the face that can break this cluster. You may hit anywhere on that marked face—not only the rings.",
      hint: "Shoot the marked face on Red",
      gesture: null,
    },
    {
      title: "Catch a Rainbow Target",
      body: "The moving target arms Rainbow Climax for one shot. Lead its straight path and hit its generous collision area.",
      hint: "Shoot the flying Rainbow Target",
      gesture: null,
    },
    {
      title: "Spend Rainbow Climax",
      body: "Your next block hit ignores Weak Points. Shoot Blue on any face; the rainbow charge is consumed on impact.",
      hint: "Shoot any face of the Blue cluster",
      gesture: null,
    },
  ],
];

export function createTutorialProgress(chapter = 0): TutorialProgress {
  return { chapter, step: 0, rotateDistance: 0 };
}

export function reduceTutorialProgress(progress: TutorialProgress, event: TutorialEvent): TutorialProgress {
  if (progress.step >= TUTORIAL_STEP_COUNT) return progress;

  if (progress.chapter === 0) {
    if (progress.step === 0 && event.type === "MODEL_ROTATED") {
      const rotateDistance = progress.rotateDistance + Math.max(0, event.distance);
      return {
        ...progress,
        rotateDistance,
        step: rotateDistance >= TUTORIAL_ROTATE_DISTANCE ? 1 : 0,
      };
    }
    if (progress.step === 1 && event.type === "AIM_DRAGGED" && event.distance >= TUTORIAL_AIM_DISTANCE) {
      return { ...progress, step: 2 };
    }
    if (progress.step === 2 && event.type === "SHOT_FIRED") return { ...progress, step: 3 };
    return progress;
  }

  const expected = progress.chapter === 1
    ? ["SORT_PROGRESS", "BATCH_STORED", "BATCH_AUTOFILLED"]
    : ["WEAK_POINT_CLEARED", "RAINBOW_HIT", "BYPASS_USED"];
  return event.type === expected[progress.step]
    ? { ...progress, step: progress.step + 1 }
    : progress;
}

export function tutorialPresentation(chapter: number): TutorialPresentation {
  return {
    showGoals: chapter === 1,
    showReserve: chapter === 1,
    showWeakPoints: chapter === 2,
    showRainbow: chapter === 2,
    allowAnyBlockFace: chapter <= 1,
  };
}

export function tutorialAllowedColor(progress: TutorialProgress): BlockColor | null {
  if (progress.chapter === 1) return (["red", "blue", "red"] as const)[progress.step] ?? null;
  if (progress.chapter === 2) return (["red", null, "blue"] as const)[progress.step] ?? null;
  return null;
}

export function nextTutorialChapter(progress: TutorialProgress): TutorialProgress | null {
  const chapter = progress.chapter + 1;
  return chapter < TUTORIAL_CHAPTER_COUNT ? createTutorialProgress(chapter) : null;
}
