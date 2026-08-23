import { parseLevelSheet } from "./level-format";
import type { LevelSheetResult } from "./level-format";
import { level01 } from "./level-01";
import { LEVELS_SHEET } from "./levels-sheet";

// The built HTML carries the sheet as plain text in this block, so a level can be
// fixed by editing the shipped file and reloading, with no rebuild.
export const EMBEDDED_SHEET_ID = "levels";

export type LevelSheetSource = "embedded" | "bundled" | "dropped";
export type LoadedLevelSheet = LevelSheetResult & { source: LevelSheetSource };

function readEmbeddedSheetText() {
  if (typeof document === "undefined") return null;
  const text = document.getElementById(EMBEDDED_SHEET_ID)?.textContent?.trim();
  return text ? text : null;
}

// The game must always boot, so a sheet that parses to nothing falls back to the
// bundled copy and finally to the prototype level baked into the source.
function withFallback(result: LevelSheetResult, source: LevelSheetSource): LoadedLevelSheet {
  if (result.levels.length) return { ...result, source };
  const bundled = parseLevelSheet(LEVELS_SHEET);
  if (bundled.levels.length) {
    return { levels: bundled.levels, issues: [...result.issues, ...bundled.issues], source: "bundled" };
  }
  return {
    levels: [level01],
    issues: [
      ...result.issues,
      ...bundled.issues,
      { row: 0, level: "-", severity: "error", message: "falling back to the level baked into the source" },
    ],
    source: "bundled",
  };
}

export function loadLevelSheet(): LoadedLevelSheet {
  const embedded = readEmbeddedSheetText();
  if (embedded) return withFallback(parseLevelSheet(embedded), "embedded");
  return withFallback(parseLevelSheet(LEVELS_SHEET), "bundled");
}

// Dropped sheets keep their issues so the game can show exactly which row is
// wrong instead of failing silently.
export function parseDroppedSheet(text: string): LoadedLevelSheet {
  return { ...parseLevelSheet(text), source: "dropped" };
}
