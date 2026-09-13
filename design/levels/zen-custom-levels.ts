import type { SandLevelConfig } from "../../app/game/sand-types.ts";

// Zen Mode's own editor-shipped levels — its own file, separate from
// design/levels/sand-levels.ts, on request (2026-09-13: "Chỉnh sửa lại level
// editor cho Zen Mode, nó nên lưu vào 1 file ts riêng và các level trong zen
// mode sẽ dựa trên file đó"). Before this file existed, a Zen draft's "Ship
// all levels" ran through the exact same sand-levels.ts EDITOR_LEVELS block
// every ordinary level does — even though `SandGame.tsx`'s `collectPlayables`
// always filtered `mode: "zen"` drafts back out of the main list, so a
// shipped Zen level just sat there as dead, wrong-shaped weight in the main
// roster's own file (unlimited shots and boosters, meant for Zen's rules, not
// the main list's). This file is that shipping path's own twin, scoped to
// Zen only: `scripts/level-writer.mjs`'s `/ship-zen-levels` route writes into
// the block below exactly the way `/ship-levels` writes into sand-levels.ts's
// own — see that script's own comment. `zen-levels.ts`'s `BUILT_IN_ZEN_LEVELS`
// is what actually spreads this array in alongside its three hand-picked seed
// levels; nothing reads this file directly otherwise.

// ==== Editor-shipped Zen levels ====

// Regenerated in full every time a Zen level is shipped from `/editor` (the
// "Ship all Zen levels to zen-custom-levels.ts" button, via `npm run
// level-writer`) — this array always mirrors the editor's current Zen level
// list exactly, so a Zen level deleted in the editor disappears from here on
// the next ship rather than lingering.
// Hand edits inside this block are overwritten on the next ship; edit the
// level in the editor instead.
export const EDITOR_ZEN_LEVELS: SandLevelConfig[] = [];
// ==== End editor-shipped Zen levels ====
