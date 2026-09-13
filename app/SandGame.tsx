"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  SandCannonEngine,
  SAND_COLOR_HEX,
  WIN_REVEAL_HOLD_MS,
  MAX_CONTROL_SENSITIVITY,
  MIN_CONTROL_SENSITIVITY,
  type SandEngineEvent,
} from "./game/SandCannonEngine";
import {
  COSTUMES,
  COSTUME_ORDER,
  costumePrice,
  costumeUnlockedByLevel,
  getSelectedCostume,
  isCostumeOwned,
  markSkinBadgeSeen,
  resetOwnedCostumes,
  setSelectedCostume,
  unlockCostume,
  unseenAffordableSkins,
  type CostumeId,
} from "./game/costumes";
import {
  addGold,
  addBoosterCharges,
  boosterPrice,
  claimRewardTrack,
  getRewardTrackSnapshot,
  NODES_PER_CHEST,
  recordLevelPlayed,
  fillRewardTrack,
  resetRewardTrack,
  spendEmeralds,
  subscribeRewardTrack,
  buyBoosterCharges,
  claimDailyLogin,
  DAILY_LOGIN_REWARDS,
  devNow,
  getDailyLoginCalendar,
  getDailyLoginState,
  getDevDateOffsetDays,
  getWallet,
  hasClearedLevel,
  levelGoldReward,
  levelMilestoneBonus,
  markLevelCleared,
  resetClearedLevels,
  resetDailyLogin,
  resetGold,
  resetWallet,
  setDevDateOffsetDays,
  SERVER_REWARD_TRACK,
  SERVER_WALLET,
  subscribeWallet,
  getHeartsState,
  spendHeart,
  resetHearts,
  isHeartsUnlocked,
  subscribeHearts,
  getHeartsVersion,
  SERVER_HEARTS,
  MAX_HEARTS,
  HEARTS_UNLOCK_LEVEL_ID,
  type RewardTrackState,
  type DailyLoginState,
  type DailyLoginCalendarCell,
  type HeartsState,
} from "./game/economy";
import { ensureEconomyConfigLoading, getEconomyConfigVersion, subscribeEconomyConfig } from "./game/economy-config";
import { computeLevelDifficulty } from "./game/level-difficulty";
import { ensureLevelRewardsLoading, getLevelRewardOverride } from "./game/level-rewards";
import { BUILT_IN_LEVELS } from "../design/levels/sand-levels";
import { BUILT_IN_ZEN_LEVELS, ZEN_ID_BASE } from "../design/levels/zen-levels";
import { draftToLevel, loadDrafts, validateDraft } from "./game/level-drafts";
import {
  ammoRemaining,
  createSandGameState,
  currentAmmo,
  DEFAULT_FREEZE_DURATION,
  expandLevelForPixelBoard,
  KEY_LETTER,
  nextAmmo,
  SAND_COLOR_BY_LETTER,
  WALL_LETTER,
} from "./game/sand-rules";
import { isSoundEnabled, resumeSound, setSoundEnabled, soundSupported, suspendSound } from "./game/sound";
import { hapticsSupported, isHapticsEnabled, setHapticsEnabled } from "./game/haptics";
import { getAimSensitivity, setAimSensitivity } from "./game/aim-sensitivity";
import { BOOSTER_TYPES, type BoosterType, type SandColor, type SandGameState, type SandLevelConfig } from "./game/sand-types";
import { advanceLoading, finishLoading } from "./loading-screen";
import { getLanguage, LANGUAGES, LANGUAGE_NAME, setLanguage, subscribeLanguage, t, type Strings } from "./i18n";

/** `palette` is a level's own `customPalette` (see `SandLevelConfig`'s doc
 * comment) — passed by every call site that has a level in scope, so a Zen
 * level's image-derived colours actually show up in the HUD/thumbnail
 * instead of the shared candy palette. */
function hex(color: SandColor, palette?: Partial<Record<SandColor, number>>) {
  return numHex(palette?.[color] ?? SAND_COLOR_HEX[color]);
}

/**
 * The sky's own tint of whatever is chambered — `SAND_COLOR_HEX` is full
 * candy saturation (right for a grain of sand, far too loud spread across
 * the whole background), so this lightens it toward white by the same
 * amount gameplay's flat cyan `--bg` (globals.css) sits lighter than the
 * cyan sand colour it was pulled from, rather than painting the frame in a
 * colour of its own.
 */
function ammoSky(color: SandColor, palette?: Partial<Record<SandColor, number>>) {
  const value = palette?.[color] ?? SAND_COLOR_HEX[color];
  const lighten = (channel: number) => Math.round(channel + (255 - channel) * 0.62);
  const r = lighten((value >> 16) & 0xff);
  const g = lighten((value >> 8) & 0xff);
  const b = lighten(value & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function numHex(value: number) {
  return `#${value.toString(16).padStart(6, "0")}`;
}

// Booster name/description copy (booster-radius-prism-spec.md §7.1's toast
// language, and the Shop's one-line pitch) now lives in i18n.ts as
// `s.boosterName`/`s.boosterDesc` — see `Strings` there — so both follow
// whichever language is current instead of being fixed English records.

/**
 * The Shop's real-money offers/bundles/packs — none of it wired to an actual
 * payment processor yet (see `notifyIapComingSoon` at the call site). Gems
 * are gone from the game entirely (2026-09d, on request — the hard currency
 * nothing ever spent, see economy.ts's own history); every real-money item
 * now sells some mix of the three currencies that actually DO something:
 * gold (spendable on boosters today), hearts (the play-attempt currency,
 * capped at `MAX_HEARTS`), and a SMALL Blue Emerald top-up (skins) — the
 * reward track stays the only FREE source of emerald, this is just a taste
 * of it for players who would rather pay than grind toward one.
 *
 * Coin amounts across every table below (2026-09e, on request — "$0.99 mà
 * được 1000 coins là quá nhiều, tương đương 10 booster") are re-anchored to
 * $0.99 = 200 gold: ~2 charges of Radius Overcharge/Prism Shot
 * (`BOOSTER_PRICE`, economy.ts) rather than 10 — spending real money still
 * buys a head start, not a shortcut past the shop's whole point. Every other
 * price point's coin amount is that same $0.99-per-200-gold rate (a flat 5×
 * cut off every old number, since $0.99 = 1000 gold is exactly 5× the new
 * anchor) carried across the STANDARD store price tiers
 * ($0.99/$1.99/$4.99/$9.99/$19.99/$49.99/$99.99 — the App Store/Play
 * Store's own fixed ladder, not something a game can set arbitrarily), each
 * tier keeping the bonus percentage it already had so the "bigger pack =
 * better $/coin deal" curve mobile IAP ladders always use is untouched —
 * only the anchor under it moved. See CHANGELOG-prototype.md.
 */
type SpecialOffer = { id: string; name: string; tag: string; coins?: number; hearts?: number; emeralds?: number; bonus?: string; valuePercent: number; price: string };
/**
 * Both rows below are priced so their COINS + HEARTS alone — priced at the
 * matching `COIN_PACKS`/`HEART_PACKS` tier, the market rate a player could
 * get the same currencies for elsewhere in the Shop — total ~99% MORE than
 * the offer's own price (2026-09f, on request: "special offer nên hời hơn
 * nhiều so với mua lẻ"), Blue Emerald counted as pure bonus on top since it
 * is sold nowhere else to price against. This is the anchoring play the
 * slide deck's "Mỏ neo" section describes: a "First purchase"/limited-time
 * offer needs to read as obviously too good to pass up, not as a
 * break-even bundle with some free emerald on the side — the flat coin
 * scale-down in 2026-09e (see this section's header) had quietly erased
 * that gap (Starter Pack's coins+hearts used to cost MORE bought
 * separately; Weekend Heart Rush's still would).
 *
 * `starter`: 1,900 coins (`COIN_PACKS`' $4.99 tier, `c3`, rate 1200/4.99)
 * + 3 hearts (`HEART_PACKS`' `h2`, $1.99 flat) ≈ $9.89 of separate
 * purchases for a $4.99 offer.
 * `weekend`: 4,400 coins (`COIN_PACKS`' $9.99 tier, `c4`, rate 2600/9.99)
 * + 5 hearts (`HEART_PACKS`' `h3`, $2.99 flat) ≈ $19.90 of separate
 * purchases for a $9.99 offer — this DOES give the weekend offer coins for
 * the first time (it used to be hearts/emerald only, "on purpose," per the
 * design note this replaces); there is no other priceable good in it
 * (hearts alone, capped at `MAX_HEARTS`, cannot carry a 99% gap by
 * themselves) to hit the same target without one.
 *
 * `valuePercent` (2026-09f, on request — "offer nên có [...] giá trị lợi
 * ích để hook người chơi") is that same gap made VISIBLE on the card
 * (`s.offerValueBadge`, i18n.ts) instead of only living in this comment —
 * the whole point of an anchor is that the player sees it, not that the
 * designer did the math. Rounded down from the exact ratio above (98.25%,
 * 99.19%) so the badge never overstates what the offer actually delivers.
 */
const SPECIAL_OFFERS: readonly SpecialOffer[] = [
  { id: "starter", name: "Islander's Starter Pack", tag: "First purchase", coins: 1_900, hearts: 3, emeralds: 150, valuePercent: 98, price: "$4.99" },
  { id: "weekend", name: "Weekend Heart Rush", tag: "Weekend only", coins: 4_400, hearts: MAX_HEARTS, emeralds: 300, bonus: "+35% extra", valuePercent: 99, price: "$9.99" },
];

/** Each bundle sells all three currencies together, per the ask ("Bundles
 * giờ sẽ là Coins + heart + 1 ít blue emerald") — hearts capped at
 * `MAX_HEARTS` (a bundle cannot sell more hearts than the tank can ever hold
 * at once), emerald a small top-up scaling with price — never enough alone
 * to buy a skin outright at the cheap end (Rune Cannon is 500,
 * `costumes.ts`), a real head start at the top. Coin amounts re-anchored to
 * the Shop's $0.99 = 200 gold rate (2026-09e) — same ratio to the matching
 * `COIN_PACKS` tier the old gold-heavy numbers already had (a bundle spends
 * part of its price on hearts/emeralds, so it was never meant to match a
 * coin-only pack coin for coin), just off the new anchor.
 *
 * Unlike `SPECIAL_OFFERS` above, these are NOT re-priced for a "hời" gap
 * against buying separately (2026-09f) — a standing, always-available
 * ladder reads as a graduated set of options (its own `bonus` tags already
 * say "better than the last tier"), not a limited-time hook that needs to
 * out-anchor the rest of the Shop the way "First purchase"/"Weekend only"
 * do. */
type Bundle = { id: string; coins: number; hearts: number; emeralds: number; bonus?: string; flag?: string; price: string };
const BUNDLES: readonly Bundle[] = [
  { id: "b1", coins: 80, hearts: 1, emeralds: 50, price: "$0.99" },
  { id: "b2", coins: 500, hearts: 2, emeralds: 120, bonus: "+10%", price: "$4.99" },
  { id: "b3", coins: 1_200, hearts: 3, emeralds: 250, bonus: "+20%", flag: "Most popular", price: "$9.99" },
  { id: "b4", coins: 2_600, hearts: MAX_HEARTS, emeralds: 400, bonus: "+35%", price: "$19.99" },
  { id: "b5", coins: 7_000, hearts: MAX_HEARTS, emeralds: 800, bonus: "+50%", flag: "Best value", price: "$49.99" },
];

/** Coin-only packs, priced the way mobile-game coin ladders usually are:
 * $0.99 up to $99.99, each tier's bonus a little steeper than the last.
 * `c1` IS the anchor (`COIN_ANCHOR_RATE`, 200 gold at $0.99, no bonus); every
 * row after it is that same rate carried to its own price tier and then
 * bumped by its own bonus% (2026-09e — see this section's header comment). */
type CoinPack = { id: string; coins: number; bonus?: string; flag?: string; price: string };
const COIN_PACKS: readonly CoinPack[] = [
  { id: "c1", coins: 200, price: "$0.99" },
  { id: "c2", coins: 440, price: "$1.99" },
  { id: "c3", coins: 1_200, bonus: "+10%", price: "$4.99" },
  { id: "c4", coins: 2_600, bonus: "+20%", price: "$9.99" },
  { id: "c5", coins: 5_600, bonus: "+30%", flag: "Popular", price: "$19.99" },
  { id: "c6", coins: 16_000, bonus: "+45%", price: "$49.99" },
  { id: "c7", coins: 36_000, bonus: "+60%", flag: "Best value", price: "$99.99" },
];

/** Hearts sold directly, alongside Coins rather than folded into it — on
 * request: "Ngoài coins ra giờ sẽ có mục mua riêng". Every tier is capped at
 * `MAX_HEARTS` (a full tank) — there is nowhere to put a heart bought past
 * that, so a ladder past 5 would just be a number nothing can ever use. */
type HeartPack = { id: string; hearts: number; flag?: string; price: string };
const HEART_PACKS: readonly HeartPack[] = [
  { id: "h1", hearts: 1, price: "$0.99" },
  { id: "h2", hearts: 3, price: "$1.99" },
  { id: "h3", hearts: MAX_HEARTS, flag: "Full refill", price: "$2.99" },
];

/** The phases §21 locks input in. The HUD has to say so, not just stop responding. */
const BUSY_PHASES = new Set(["PROJECTILE_FLYING", "HIT_RESOLUTION", "SETTLING", "MERGING"]);

/** How many flakes `.freeze-snowfall` renders while the board is frozen. */
const FREEZE_SNOWFLAKE_COUNT = 26;

/**
 * Fixed layout for the Freeze Map snowfall — computed once, by formula, not
 * `Math.random()`, so server and client render the exact same markup and a
 * re-render never reshuffles a flake already mid-fall. The golden-angle
 * spread (137.5°) is the standard trick for scattering N points across a
 * span without visible clumping or repetition; everything else (size,
 * timing) just derives from the index by a different, unrelated formula so
 * the flakes don't all share one rhythm.
 */
const FREEZE_SNOWFLAKES = Array.from({ length: FREEZE_SNOWFLAKE_COUNT }, (_, index) => ({
  left: (index * 137.5) % 100,
  size: 3 + (index % 5) * 1.4,
  opacity: 0.45 + (index % 4) * 0.15,
  fallDuration: 6 + (index % 7) * 0.9,
  fallDelay: -((index * 0.83) % 9),
  driftDuration: 2.6 + (index % 3) * 0.7,
  driftDelay: -((index * 0.41) % 3),
}));

/** How many pieces `.prism-confetti` renders while Prism Shot is armed. */
const PRISM_CONFETTI_COUNT = 22;

/** Prism Shot's own palette — the same 7-colour rainbow spread the rejected
 * background/HUD stripe treatment used, kept here as the one place that
 * idea survives. */
const PRISM_CONFETTI_COLORS = ["#ff3b3b", "#ff9f1c", "#ffd60a", "#2ec4b6", "#3a86ff", "#8338ec", "#ff006e"];

/**
 * Fixed layout for Prism Shot's confetti — same reasoning as
 * `FREEZE_SNOWFLAKES` just above: computed once, by formula, not
 * `Math.random()`, so it never reshuffles itself on a re-render. Reuses
 * `.win-confetti-piece`'s own `win-confetti-fall` keyframe (globals.css) via
 * `.prism-confetti-piece`, just spread over the whole scene continuously
 * instead of once behind the win card.
 */
const PRISM_CONFETTI = Array.from({ length: PRISM_CONFETTI_COUNT }, (_, index) => ({
  left: (index * 137.5) % 100,
  size: 5 + (index % 4) * 2,
  duration: 2.6 + (index % 5) * 0.5,
  delay: -((index * 0.63) % 3),
  drift: (index % 2 === 0 ? 1 : -1) * (10 + (index % 3) * 6),
  color: PRISM_CONFETTI_COLORS[index % PRISM_CONFETTI_COLORS.length],
}));

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
 * costume (`costumes.ts`). `modes` is named here because the bar it belongs
 * to is being built now, but nothing behind it exists yet — it says so when
 * opened rather than pretending (a full-screen takeover now, same footing as
 * Gallery/Shop/Skin, not the small `.hub-panel` bottom sheet it used to be —
 * see `.modes-screen`'s own comment in globals.css).
 */
const HUB_TABS = ["shop", "skin", "home", "gallery", "modes"] as const;
type HubTab = (typeof HUB_TABS)[number];

/** `HUB_TAB_NAME`'s replacement, built inside the component from `s` (see
 * `i18n.ts`) rather than kept as a module-level constant — the name has to
 * follow whichever language is current. Used for every tab's nav label; the
 * one tab with its own blurb (Modes) reads `s.modesBlurb` directly at its
 * own full-screen takeover instead of going through a matching Record here. */
function hubTabNames(s: Strings): Record<HubTab, string> {
  return { shop: s.tabShop, skin: s.tabSkin, home: s.tabHome, gallery: s.tabGallery, modes: s.tabModes };
}

/** Every `HubTab` now has its own real photographic asset
 * (`/public/icons/*.png`) rather than hand-drawn line art — Modes was the
 * last holdout (a placeholder paint-palette `<svg>`, on request replaced
 * with real artwork). Home got the reference house artwork first; Shop,
 * Skin, Gallery and Modes followed with their own matching pieces (a
 * shopping cart, a cannon on a coat hanger, a framed picture, a controller). */
const TAB_PHOTO_ICON: Partial<Record<HubTab, string>> = {
  home: "/icons/HomeIcon.png",
  shop: "/icons/ShoppingCartIcon.png",
  skin: "/icons/CannonSkinIcon.png",
  gallery: "/icons/GalleryIcon.png",
  modes: "/icons/ModesIcon.png",
};

/**
 * A tab icon backed by one of `TAB_PHOTO_ICON`'s real images, not a
 * hand-drawn stand-in. Active, it is just that PNG at full colour. Idle, it
 * is the exact same PNG turned into a flat one-colour silhouette via a CSS
 * `mask-image` (a `<span>` filled with `--wood-ink`, masked by the
 * artwork's own alpha channel) rather than a second hand-authored asset —
 * so the idle shape is guaranteed to trace the real artwork's outline, not
 * an approximation of it, and the two states can never drift out of sync
 * with each other the way two independently drawn assets could. This is why
 * these three tabs cannot join `HubIcon`'s shared "one `<svg>`, toggle
 * `fill`/`stroke`" trick below: that trick needs plain line art with no
 * colour of its own, and a photographic asset has none to strip out. */
function PhotoTabIcon({ src, active }: { src: string; active: boolean }) {
  if (active) {
    return <img className="hub-nav-icon photo-tab-icon" src={src} alt="" aria-hidden="true" />;
  }
  return (
    <span
      className="hub-nav-icon photo-tab-icon is-silhouette"
      aria-hidden="true"
      style={{ WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` } as React.CSSProperties}
    />
  );
}

/** Every `HubTab` resolves through `TAB_PHOTO_ICON` now (Modes was the last
 * one still drawing hand-authored `<svg>` line art) — this stays a thin
 * wrapper rather than inlining `PhotoTabIcon` at each call site so a future
 * tab with no artwork yet still has one place to add a fallback shape. */
function HubIcon({ tab, active }: { tab: HubTab; active: boolean }) {
  const photoSrc = TAB_PHOTO_ICON[tab];
  if (!photoSrc) return null;
  return <PhotoTabIcon src={photoSrc} active={active} />;
}

/**
 * No text on a booster button (spec §6) — just an icon reusing gameplay
 * language the player already knows. Real artwork for all three now
 * (`/public/icons/RadiusIncreaseIcon.png`, `PrismChargeIcon.png`,
 * `ChainIcon.png` — Chain Sort's own art replaces the borrowed Prism Shot
 * icon it used as a stand-in), same as `CancelIcon`/`ReturnMainHubIcon` —
 * one component so the in-play HUD tray and the Shop cards stay on the same
 * glyph automatically.
 */
function BoosterIcon({ type }: { type: BoosterType }) {
  const src =
    type === "radiusOvercharge" ? "/icons/RadiusIncreaseIcon.png"
    : type === "chainSort" ? "/icons/ChainIcon.png"
    : "/icons/PrismChargeIcon.png";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`booster-icon${type === "prismShot" ? " is-prism" : ""}`} src={src} alt="" aria-hidden="true" />
  );
}

/** A card icon per cannon costume, drawn in currentColor like the other
 * line-art here — a plain barrel for the classic cannon, the same barrel
 * ringed with rune ticks for the rune cannon, topped with a small three-point
 * pennant for the hero cannon, and hung with a couple of small icicles for
 * the frost cannon, so a card reads as "what this skin does" at a glance even
 * without the live 3D model behind it. */
function CostumeIcon({ id }: { id: CostumeId }) {
  const isRune = id === "rune-cannon";
  const isHero = id === "hero-cannon";
  const isFrost = id === "frost-cannon";
  return (
    <svg className={`costume-icon${isRune ? " is-rune" : ""}${isHero ? " is-hero" : ""}${isFrost ? " is-frost" : ""}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5.6" y="10.2" width="10.8" height="4.6" rx="1.6" />
      <circle cx="17.2" cy="12.5" r="3.4" />
      <rect x="7" y="15.6" width="10" height="2.4" rx="1.2" />
      {isRune && (
        <>
          <circle cx="12" cy="12.5" r="9.2" strokeDasharray="1.6 2.4" />
          <path d="M12 3.3v2.1M20.7 12.5h-2.1M12 21.7v-2.1M3.3 12.5h2.1" />
        </>
      )}
      {isHero && <path d="M6.6 10.2V5.6l3.2 2.3-3.2 2.3Z" strokeLinejoin="round" />}
      {isFrost && <path d="M8.4 18v2.2l.9-1.5.9 1.5V18M12 18v2.6l.9-1.7.9 1.7V18" strokeLinejoin="round" fill="none" />}
    </svg>
  );
}

/** Every "cancel/dismiss this card" button shares this one mark — real
 * artwork (`/public/icons/CancelIcon.png`) rather than a hand-drawn X, same
 * as Home/Restart's `ReturnMainHubIcon.png`/`ReplayIcon.png`. The art already
 * carries its own filled red-pink circle, so callers go bare (no button
 * background of their own) and just size/position this. */
function CancelIcon() {
  return <img className="close-icon" src="/icons/CancelIcon.png" alt="" aria-hidden="true" />;
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
type ChromeGlyph = "menu" | "sound-on" | "sound-off" | "vibrate" | "globe" | "pencil" | "target" | "trash" | "calendar" | "chevron-down";

function Glyph({ name, className = "icon-glyph" }: { name: ChromeGlyph; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
      {name === "target" && (
        <>
          <circle cx="12" cy="12" r="8.2" />
          <circle cx="12" cy="12" r="3.6" />
          <path d="M12 3.8v2.6M12 17.6v2.6M20.2 12h-2.6M6.4 12H3.8" />
        </>
      )}
      {name === "trash" && (
        <>
          <path d="M4.6 7.2h14.8" />
          <path d="M9 7.2V5a1.4 1.4 0 0 1 1.4-1.4h3.2A1.4 1.4 0 0 1 15 5v2.2" />
          <path d="M6.6 7.2 7.5 19a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5l.9-11.8" />
          <path d="M10.2 10.6v6.4M13.8 10.6v6.4" />
        </>
      )}
      {name === "calendar" && (
        <>
          <rect x="3.8" y="5.4" width="16.4" height="15" rx="2" />
          <path d="M3.8 9.8h16.4" />
          <path d="M8 3.4v3.6M16 3.4v3.6" />
        </>
      )}
      {name === "chevron-down" && (
        <>
          {/* A single downward caret, rotated by `.is-open` in CSS — used to
              show a collapsed section can be expanded (GameDevOption). */}
          <path d="M5.6 9.2 12 15.6l6.4-6.4" />
        </>
      )}
    </svg>
  );
}

/** A plain coin: a ringed disc with a face-value line, drawn in currentColor
 * like the other line-art icons here so `.coin-icon`'s colour (var(--gold))
 * is the only place the tint lives. */
/**
 * The Shop confirm dialog's quantity-stepper arrow — a real shape, not the
 * CSS border trick this used to be. That trick's rendered box is only ever
 * as wide as the border itself, sitting entirely to one side of the
 * zero-width anchor it gets centred on, so centring the anchor never
 * reliably centred the *shape* a player actually sees (however carefully the
 * margin nudging it needed was tuned). An SVG's box is exactly its declared
 * width no matter what's drawn inside it — `points` here is deliberately
 * symmetric within the 10×10 viewBox (both directions span x:2..8, centred
 * on x:5) — so `place-items: center` on the button centres the shape too,
 * not just some off-to-one-side bounding box standing in for it.
 */
function StepperArrow({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg className="confirm-qty-arrow" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <polygon points={direction === "prev" ? "8,1 8,9 2,5" : "2,1 2,9 8,5"} fill="currentColor" />
    </svg>
  );
}

/** The soft-currency glyph everywhere it appears — the wallet badge, every
 * price pill, the daily-login strip, the flying-coin claim animation. A real
 * image (`/public/icons/CoinIcon.png`) now, not hand-drawn line art: unlike
 * the nav tabs' `PhotoTabIcon`, this one has no idle/active states to worry
 * about (a price is a price, it does not go "unselected"), so it is just an
 * `<img>` — every `.coin-icon` sizing rule in globals.css keyed to the class
 * rather than the element, so they keep applying unchanged. */
function CoinIcon() {
  return <img className="coin-icon" src="/icons/CoinIcon.png" alt="" aria-hidden="true" />;
}

/** The daily-login calendar's cell label — day-of-month as an ordinal
 * ("1st", "2nd", "13th") instead of a bare number, per the 2026-09e ask.
 * Kept as plain English suffixes regardless of `s`'s locale: the calendar
 * grid no longer labels weekdays at all (`getDailyLoginCalendar`'s own doc
 * comment), so this is the one date label left on the grid and the ask was
 * specifically for this "2nd/13th/1st" text shape, not a translated one. */
function ordinalDay(day: number): string {
  const remainder100 = day % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** The hub currency HUD's own "buy more" mark — real artwork
 * (`/public/icons/PlusIcon.png`), same as `CoinIcon`/`CancelIcon`. Already
 * carries its own filled green circle, so `.hub-gold-plus` just sizes and
 * positions it rather than drawing a circle of its own behind it. */
function PlusIcon() {
  return <img className="hub-gold-plus-icon" src="/icons/PlusIcon.png" alt="" aria-hidden="true" />;
}

/** Blue Emerald — the reward track's currency, and the only thing a locked
 * skin can be bought with. Real artwork (`/public/icons/BlueEmeraldIcon.png`),
 * the same `<img>` treatment `CoinIcon` gets, with every size rule in
 * globals.css keyed to the class rather than the element so one component
 * covers the HUD chip, a price pill, a button label and the chest's burst. */
function EmeraldIcon() {
  return <img className="emerald-icon" src="/icons/BlueEmeraldIcon.png" alt="" aria-hidden="true" />;
}

/** Hearts — the play-attempt currency, locked until level 10
 * (`isHeartsUnlocked`, economy.ts). Real artwork (`/public/icons/HeartIcon.png`),
 * the same `<img>` treatment `CoinIcon`/`EmeraldIcon` get. */
function HeartIcon() {
  return <img className="heart-icon" src="/icons/HeartIcon.png" alt="" aria-hidden="true" />;
}

/** A generic "go back" glyph (`/public/icons/backIcon.png`) — used wherever a
 * screen needs an explicit back action rather than relying only on the
 * bottom nav (today: the Modes screen, both its two-card view and the Zen
 * picker inside it). Already carries its own dark rounded-square backing in
 * the art, same as `BoosterIcon`'s PNGs, so no button chrome is drawn behind
 * it beyond sizing/positioning. */
function BackIcon() {
  return <img className="back-icon" src="/icons/backIcon.png" alt="" aria-hidden="true" />;
}

/** The reward chest on the home screen's own track button — the flat icon
 * (`/public/icons/ChestIcon.png`). The chest that actually OPENS is not this:
 * it is a 3D rig the engine draws (`chest-model.ts`, built to match this same
 * artwork), so the button and the reward screen show one object in two
 * places rather than two different chests. */
function ChestIcon() {
  return <img className="chest-icon" src="/icons/ChestIcon.png" alt="" aria-hidden="true" />;
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
          return <i key={`${x}-${y}`} style={color ? { background: hex(color, level.customPalette) } : undefined} />;
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
 * A draft with `importedFromId` set is a working copy of a level already in
 * `builtIn` — "Import built-in" brought it in to edit, not to add a second,
 * unrelated entry alongside the original. Without this exclusion, editing a
 * built-in level in the editor and never shipping it makes it show up twice
 * in this browser's own Gallery: once as the real level, once more as a
 * stray "new" one tacked on the end under a fresh id.
 *
 * Read once per mount rather than watched — the editor lives on its own page, so
 * anything it saves arrives with the next load of this one.
 */
function collectPlayables(): Playable[] {
  const builtIn: Playable[] = BUILT_IN_LEVELS.map((level) => ({ level, fromEditor: false }));
  const drafts = loadDrafts()
    // A Zen draft (`mode: "zen"`) belongs on `collectZenPlayables`'s own list
    // below, never this one — without this filter a level authored in the
    // editor's Zen toggle would show up twice: once here (wrongly finite,
    // ignoring its own unlimited shots/boosters), once on the real Zen list.
    .filter((draft) => draft.mode !== "zen")
    .filter((draft) => draft.importedFromId === undefined)
    .filter((draft) => !validateDraft(draft).some((issue) => issue.severity === "error"))
    .map((draft, index) => ({
      level: draftToLevel(draft, BUILT_IN_LEVELS.length + index + 1),
      fromEditor: true,
    }));
  return [...builtIn, ...drafts];
}

/**
 * Zen Mode's own switcher list — the built-in seed levels (`BUILT_IN_ZEN_LEVELS`,
 * zen-levels.ts) plus whatever the editor's "Zen Mode" toggle has saved,
 * same shape and same reasoning as `collectPlayables` above (drafts with
 * errors excluded, an "Import built-in" working copy excluded), just filtered
 * to `draft.mode === "zen"` instead of the ordinary main-list drafts. A
 * separate list rather than a `mode` filter over one combined array because
 * nothing else about Zen Mode (its own id space, `ZEN_ID_BASE`, its own
 * "always unlocked, no progression" picker) shares `playables`' own rules —
 * see `SandGame.tsx`'s `playingZen` state for how the two lists are switched
 * between at play time.
 */
function collectZenPlayables(): Playable[] {
  const builtIn: Playable[] = BUILT_IN_ZEN_LEVELS.map((level) => ({ level, fromEditor: false }));
  const drafts = loadDrafts()
    .filter((draft) => draft.mode === "zen")
    .filter((draft) => draft.importedFromId === undefined)
    .filter((draft) => !validateDraft(draft).some((issue) => issue.severity === "error"))
    .map((draft, index) => ({
      level: draftToLevel(draft, ZEN_ID_BASE + BUILT_IN_ZEN_LEVELS.length + index + 1),
      fromEditor: true,
    }));
  return [...builtIn, ...drafts];
}

/**
 * Zen Mode's playables list, read once per page load — same hydration-safety
 * shape as `readBoot`/`SERVER_BOOT` below (real on the client, a fixed
 * built-ins-only stand-in on the server, read through `useSyncExternalStore`
 * so hydration never has to reconcile a list only one side computed) —
 * except Zen has no URL-driven `initialIndex` to re-derive ("Test in game"
 * for a Zen draft lands the player on the Zen picker, not straight into the
 * level — see zen-levels.ts's own header for that trade-off), so this is
 * just the list, cached once.
 */
const SERVER_ZEN_PLAYABLES: Playable[] = BUILT_IN_ZEN_LEVELS.map((level) => ({ level, fromEditor: false }));

let cachedZenPlayables: Playable[] | null = null;

function readZenPlayables(): Playable[] {
  if (!cachedZenPlayables) cachedZenPlayables = collectZenPlayables();
  return cachedZenPlayables;
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
 * identity — rebuilding the array each call would loop forever. `playables`
 * itself (the drafts read from localStorage) is only ever computed once,
 * but `initialIndex` is re-derived every time `window.location.search`
 * actually changes from what it was last read as — not just once, ever —
 * so a client-side navigation into `/?level=...` (the level editor's own
 * "Test in game" link, a same-tab route change rather than a full reload)
 * still lands on the right level. Without that check, this module-level
 * cache would keep answering with whatever level (or none) was in the URL
 * the very first time this page loaded in the tab, silently stranding
 * "Test in game" on level 1 for the rest of that session.
 */
type Boot = { playables: Playable[]; initialIndex: number };

const SERVER_BOOT: Boot = {
  playables: BUILT_IN_LEVELS.map((level) => ({ level, fromEditor: false })),
  initialIndex: 0,
};

let cachedBoot: Boot | null = null;
let cachedBootSearch: string | null = null;

function readBoot(): Boot {
  const search = window.location.search;
  if (cachedBoot && cachedBootSearch === search) return cachedBoot;
  const playables = cachedBoot?.playables ?? collectPlayables();
  const wanted = new URLSearchParams(search).get("level");
  const found = wanted ? playables.findIndex((entry) => entry.level.name === wanted) : -1;
  cachedBoot = { playables, initialIndex: found >= 0 ? found : 0 };
  cachedBootSearch = search;
  return cachedBoot;
}

/**
 * The daily-login streak as it stood the moment this page was first checked
 * this load — same reasoning as `readBoot`/`SERVER_BOOT` just above (a
 * `window.localStorage` read cached once for `useSyncExternalStore`, real on
 * the client and a fixed "nothing claimed yet" stand-in on the server, so
 * hydration never has to reconcile a modal that only one side knows about).
 */
const SERVER_DAILY_LOGIN: DailyLoginState = {
  weekday: 0,
  date: "",
  reward: DAILY_LOGIN_REWARDS[0],
  boosterPerk: null,
  claimedToday: false,
  streak: 0,
};

let cachedInitialDailyLogin: DailyLoginState | null = null;

function readInitialDailyLogin(): DailyLoginState {
  if (!cachedInitialDailyLogin) cachedInitialDailyLogin = getDailyLoginState(devNow());
  return cachedInitialDailyLogin;
}

/**
 * Same hydration-safety reasoning as `SERVER_DAILY_LOGIN`/`readInitialDailyLogin`
 * just above, for the calendar grid: `getDailyLoginCalendar` reads real
 * `localStorage` (which `date` claimed) the instant it is called client-side,
 * so calling it directly during render — as the modal's JSX used to — reads a
 * DIFFERENT value during the client's hydration pass than the server ever
 * saw (SSR always sees an empty `claimedDates`, a real browser usually does
 * not), which React reports as a hydration mismatch. Cached once per load
 * and paired with a fixed empty-grid server snapshot, the same shape as the
 * wallet/streak above, fixes it: hydration renders the empty grid on both
 * sides, and the real one swaps in right after mount.
 */
const SERVER_DAILY_CALENDAR: DailyLoginCalendarCell[] = [];

let cachedInitialDailyCalendar: DailyLoginCalendarCell[] | null = null;

function readInitialDailyCalendar(): DailyLoginCalendarCell[] {
  if (!cachedInitialDailyCalendar) cachedInitialDailyCalendar = getDailyLoginCalendar(devNow());
  return cachedInitialDailyCalendar;
}

/**
 * Whether the hearts system has ever been unlocked on this browser
 * (`isHeartsUnlocked`, economy.ts — level `HEARTS_UNLOCK_LEVEL_ID` cleared),
 * as it stood the moment this page was first checked this load — same
 * hydration-safety shape as `readInitialDailyLogin` above (`false` is the
 * one universally correct SSR/first-paint answer, since a server render
 * never has `localStorage`), read through `useSyncExternalStore` so
 * hydration never disagrees about whether the HUD chip is on screen.
 *
 * This can go stale mid-session in exactly one direction — a player who
 * clears level 10 for the very first time THIS load — which the WIN
 * handler's own `heartsUnlockedOverride` state (component-level, not this
 * module cache) covers; see that state's own comment.
 */
let cachedInitialHeartsUnlocked: boolean | null = null;

function readInitialHeartsUnlocked(): boolean {
  if (cachedInitialHeartsUnlocked === null) cachedInitialHeartsUnlocked = isHeartsUnlocked();
  return cachedInitialHeartsUnlocked;
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
 * Whether this browser has EVER opened the game before — checked once, right
 * after mount, to skip the Home screen's "tap Play" step the very first time
 * (on request: "Khi người mở game ra lần đầu tiên, lập tức chơi level 1
 * luôn"). A first-time player lands straight in Level 1's guided opening
 * (its `tutorial` overlay, same as any other first visit to that level)
 * instead of having to find and tap Play on an otherwise-empty Home screen
 * before anything happens at all. Every later open — reload included, since
 * this is set the instant the first one fires — behaves exactly as before:
 * Home screen, Play button, nothing auto-started.
 */
const FIRST_OPEN_SEEN_KEY = "sand-cannon:v1:first-open-seen";

function hasOpenedBefore(): boolean {
  try {
    return window.localStorage.getItem(FIRST_OPEN_SEEN_KEY) === "1";
  } catch {
    // Private browsing or a full quota: falls back to "yes, treat as a
    // returning player" — auto-starting play on every single reload because
    // storage never sticks would be far more disruptive than the reverse.
    return true;
  }
}

function markOpened() {
  try {
    window.localStorage.setItem(FIRST_OPEN_SEEN_KEY, "1");
  } catch {
    // Nothing to persist if storage is unavailable — see `hasOpenedBefore`'s
    // own fallback for why that direction is the safe one.
  }
}

/**
 * The WIN card's own "✕ back to Home" button (`.result-close-btn`) is
 * withheld through the guided opening — levels 1-3, the same span level 3's
 * own booster FTUE already treats as "still being taught the game" — so a
 * brand-new player cannot bail out mid-tutorial back to an empty Home screen
 * before ever seeing Continue. On request: "hướng dẫn đến level 3 rồi mới
 * hiện nút (X) ở frame cleared". Every level from 4 on keeps the button
 * exactly as it always had it; so does every Zen level (its own WIN card
 * check below reads `playingZen` first) — Zen never ran this onboarding at
 * all, so there is nothing for it to be withheld from. Levels 1-3 always
 * have a next level to Continue to, so hiding this one button never leaves
 * a player stranded on the card with no way off it.
 */
const WIN_CLOSE_BUTTON_FROM_LEVEL_ID = 4;

/**
 * Chain Sort stays out of both the in-play booster tray and the Shop's
 * Boosters grid until level 5 — its own tutorial level (`ftueChainSortDemo`)
 * — not just level 3 (on request: "Chainsort chưa nên hiện cho tới level
 * 5", tightening an earlier version of this same gate that only hid it
 * during level 3's Radius/Prism tutorial). `>=` this id is what actually
 * shows it again, level 5's own tutorial included — the button has to be
 * visible for that tutorial to spotlight it at all.
 */
const CHAIN_SORT_UNLOCK_LEVEL_ID = 5;

/**
 * Level 3's Radius Overcharge/Prism Shot tutorial — and, on request, Level
 * 5's Chain Sort one too, now taught the exact same way — no longer watches
 * a scripted stand-in shot; both teach by having the player actually arm and
 * fire the real booster themselves (see `boosterFtueStep`'s own doc comment
 * for the whole redesigned beat-by-beat shape, and `chainSortFtueStep`'s for
 * how it reuses the same shape for a single booster). This is the one
 * timing knob both still need: once the player's own shot lands and the
 * sand finishes settling (`state.phase` back to `"READY"`), the result
 * stays on screen, uncovered, for this long before the tutorial moves on —
 * long enough to actually read what their shot just did, short enough that
 * it never reads as the game stalling.
 */
const BOOSTER_TRY_SETTLE_HOLD_MS = 1000;

/**
 * Levels whose scripted freeze demo (`SandLevelConfig.ftueFreezeDemo`) has
 * already auto-played, this browser — same shape as `TUTORIALS_SEEN_KEY`,
 * just its own key/list so the two features don't share bookkeeping.
 */
const FREEZE_FTUE_SEEN_KEY = "sand-cannon:v1:freeze-ftue-seen";

function loadSeenFreezeFtue(): Set<number> {
  try {
    const raw = window.localStorage.getItem(FREEZE_FTUE_SEEN_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : []);
  } catch {
    return new Set();
  }
}

function markFreezeFtueSeen(id: number) {
  try {
    const next = loadSeenFreezeFtue().add(id);
    window.localStorage.setItem(FREEZE_FTUE_SEEN_KEY, JSON.stringify([...next]));
  } catch {
    // Private browsing or a full quota: the demo just plays again next time,
    // which is a mild annoyance, not a broken game.
  }
}

/**
 * Levels whose scripted booster demo (`SandLevelConfig.ftueBoosterDemo`) has
 * already auto-played, this browser — same shape as `FREEZE_FTUE_SEEN_KEY`,
 * its own key so the two FTUE features don't share bookkeeping.
 */
const BOOSTER_FTUE_SEEN_KEY = "sand-cannon:v1:booster-ftue-seen";

function loadSeenBoosterFtue(): Set<number> {
  try {
    const raw = window.localStorage.getItem(BOOSTER_FTUE_SEEN_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : []);
  } catch {
    return new Set();
  }
}

function markBoosterFtueSeen(id: number) {
  try {
    const next = loadSeenBoosterFtue().add(id);
    window.localStorage.setItem(BOOSTER_FTUE_SEEN_KEY, JSON.stringify([...next]));
  } catch {
    // Private browsing or a full quota: the demo just plays again next time,
    // which is a mild annoyance, not a broken game.
  }
}

/**
 * Whether the "go buy the boosters you just tried" red dot on the Shop tab
 * should be showing — a plain on/off flag, not per-level like the FTUE-seen
 * keys above, because it means "there is an unactioned hint right now", not
 * "level N has been shown this". Turned on the moment the booster FTUE's demo
 * finishes (`boosterFtueStep` reaching "outro"), turned off the moment the
 * player actually taps into Shop from it — see the `hub-nav` button below.
 * Same guarded-storage contract as `loadSeenBoosterFtue`: a browser that
 * refuses storage just means the dot never shows, which is the safe
 * direction to fail in.
 */
const BOOSTER_SHOP_HINT_KEY = "sand-cannon:v1:booster-shop-hint";

function loadBoosterShopHint(): boolean {
  try {
    return window.localStorage.getItem(BOOSTER_SHOP_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function setBoosterShopHint(active: boolean) {
  try {
    if (active) window.localStorage.setItem(BOOSTER_SHOP_HINT_KEY, "1");
    else window.localStorage.removeItem(BOOSTER_SHOP_HINT_KEY);
  } catch {
    // Nothing to persist if storage is unavailable — the dot just won't
    // survive a reload, same fallback as everything else here.
  }
}

/** Nothing to subscribe to: the snapshot is read once and never changes. */
const noopSubscribe = () => () => {};

/** `msUntilNext` (from `HeartsState`) as `m:ss`, for both the HUD chip's own
 * countdown and the "out of hearts" toast — one format, read the same way in
 * both places. Floors rather than rounds, so the label counts down to
 * exactly `0:00` the instant the heart actually lands rather than blinking
 * from `0:01` to a heart appearing. */
function formatHeartCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Falling paper pieces covering the whole WIN screen (`.win-confetti` in
 * globals.css) — a fixed hand-picked set rather than `Math.random()` so the
 * layout doesn't reshuffle every re-render while the result screen is up.
 * Slow and staggered on purpose ("rơi nhẹ thôi") — gentle drift over a long
 * duration, not a confetti-cannon burst — but spread across the full width
 * (and a few different sizes) so the screen reads as filled rather than a
 * single thin band of pieces. */
const WIN_CONFETTI = [
  { left: 2, delay: 0, duration: 7.2, drift: 16, size: 7, color: "var(--gold)" },
  { left: 9, delay: 2.4, duration: 8.4, drift: -12, size: 6, color: "var(--sky)" },
  { left: 16, delay: 1.1, duration: 6.6, drift: 20, size: 9, color: "var(--danger)" },
  { left: 23, delay: 3.2, duration: 7.8, drift: -18, size: 6, color: "var(--gem)" },
  { left: 30, delay: 0.5, duration: 8.0, drift: 10, size: 8, color: "var(--accent)" },
  { left: 37, delay: 2.0, duration: 6.9, drift: -14, size: 7, color: "var(--wood)" },
  { left: 44, delay: 0.9, duration: 7.5, drift: 18, size: 6, color: "var(--gold)" },
  { left: 51, delay: 3.6, duration: 8.6, drift: -10, size: 9, color: "var(--danger)" },
  { left: 58, delay: 1.6, duration: 7.0, drift: 14, size: 7, color: "var(--sky)" },
  { left: 65, delay: 0.2, duration: 8.2, drift: -20, size: 6, color: "var(--gem)" },
  { left: 72, delay: 2.8, duration: 7.4, drift: 12, size: 8, color: "var(--accent)" },
  { left: 79, delay: 1.4, duration: 6.7, drift: -16, size: 7, color: "var(--gold)" },
  { left: 86, delay: 3.0, duration: 8.5, drift: 20, size: 6, color: "var(--wood)" },
  { left: 93, delay: 0.7, duration: 7.1, drift: -12, size: 9, color: "var(--danger)" },
  { left: 98, delay: 2.2, duration: 7.9, drift: 10, size: 7, color: "var(--sky)" },
] as const;


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

  // ---- Zen Mode --------------------------------------------------------
  // Own switcher list (`zenPlayables`, never mixed with the main `playables`
  // above), own selected index, and a flag saying which of the two lists
  // `raw`/`level` below should actually read from right now — see
  // `openZenLevel`/`goHome`/the `hub-nav` tap handler for how the three stay
  // in sync. `zenPickerOpen` is purely which screen the Modes tab shows
  // (the two mode buttons, or the Zen level list) — it can stay `true` while
  // `playingZen` is momentarily `false` (browsing the list before picking a
  // level) and vice versa is never true (picking a level always implies the
  // list was open).
  const zenPlayables = useSyncExternalStore(noopSubscribe, readZenPlayables, () => SERVER_ZEN_PLAYABLES);
  const [playingZen, setPlayingZen] = useState(false);
  const [zenLevelIndex, setZenLevelIndex] = useState(0);
  const [zenPickerOpen, setZenPickerOpen] = useState(false);
  // The Modes screen's own "?" info popup (on request: "Đặt 1 icon '?' ở góc
  // trên cùng bên phải để giải thích sơ về các mode") — a plain overlay card,
  // same family as `.settings-screen`, explaining what each mode card does
  // before a player commits to tapping one. Shown in both Modes states (the
  // two cards AND the Zen level list) since "what is this mode" is a
  // reasonable question from either.
  const [modesHelpOpen, setModesHelpOpen] = useState(false);

  // ---- Hearts (lives) ---------------------------------------------------
  // See `economy.ts`'s own "hearts (lives)" section header for the whole
  // design. Two pieces of state: whether the system is unlocked at all
  // (`heartsUnlocked`), and the live count + regen countdown (`hearts`,
  // updated on its own 1-second timer below so the countdown actually
  // counts down on screen, not just on a spend).
  const initialHeartsUnlocked = useSyncExternalStore(noopSubscribe, readInitialHeartsUnlocked, () => false);
  // Sticky true the instant level `HEARTS_UNLOCK_LEVEL_ID` is cleared THIS
  // load (the WIN handler below sets this) — `initialHeartsUnlocked` alone
  // would miss that until the next full reload, since it is only ever read
  // once per page load (see its own comment).
  const [heartsUnlockedOverride, setHeartsUnlockedOverride] = useState(false);
  const heartsUnlocked = initialHeartsUnlocked || heartsUnlockedOverride;
  // Bumps whenever the STORED record changes (a spend, a dev reset) —
  // `subscribeHearts`/`getHeartsVersion` — which the effect below listens
  // for to recompute `hearts` immediately rather than waiting up to a
  // second for its own timer tick.
  const heartsStoreVersion = useSyncExternalStore(subscribeHearts, getHeartsVersion, () => 0);
  // `SERVER_HEARTS` (a full tank) is the correct value for both the server
  // pass and the client's own first paint — real regen state only exists in
  // `localStorage`, so reading it any earlier than an effect (which never
  // runs during hydration) would be the same hydration-mismatch mistake
  // `SERVER_DAILY_CALENDAR`'s own comment already explains for the
  // daily-login grid.
  const [hearts, setHearts] = useState<HeartsState>(SERVER_HEARTS);
  useEffect(() => {
    if (!heartsUnlocked) return;
    const update = () => setHearts(getHeartsState(devNow().getTime()));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [heartsUnlocked, heartsStoreVersion]);

  const [runId, setRunId] = useState(0);
  // Whether the tutorial overlay is open. Opened by `startPlaying` the first
  // time a level with unread `tutorial` content starts play.
  const [tutorialOpen, setTutorialOpen] = useState(false);
  // Same shape as `tutorialOpen`, for `ftueGesture` levels' hand/drag glyph —
  // opened by `startPlaying` every time such a level starts play, and closed
  // early by the engine's own `AIM_TOUCHED` event (see the effect below): the
  // glyph's job is done the instant the player makes their own first touch on
  // the real joystick.
  const [ftueGestureOpen, setFtueGestureOpen] = useState(false);
  /**
   * Level 31's freeze-orb tutorial (`SandLevelConfig.ftueFreezeDemo`) — a
   * beat-by-beat guided walkthrough, not one continuous auto-play, per the
   * "make it read like a real game tutorial" ask: a callout points at the
   * orb and waits for a tap, THEN the scripted shot plays out unobstructed,
   * THEN the next callout explains what just happened, and so on. Null means
   * the tutorial isn't running (either not started yet, or already finished
   * and handed back to the player on this same attempt).
   *
   *   intro          — spotlight + caption on the orb, waiting for a tap
   *   demo-freeze     — (no caption) scripted shot #1: fires at the orb
   *   explain-thaw    — spotlight + caption again, waiting for a tap
   *   demo-clear      — (no caption) scripted shots #2-3: clear the mint patch
   *   outro           — plain caption, waiting for the final tap
   *
   * The three caption steps are the only ones a tap can be read from — see
   * `advanceFreezeFtue`; the two "demo-*" steps are driven entirely by the
   * effect below and advance themselves once their shots are fired.
   */
  const [freezeFtueStep, setFreezeFtueStep] = useState<
    "intro" | "demo-freeze" | "explain-thaw" | "demo-clear" | "outro" | null
  >(null);
  // Whether the current caption step can be dismissed yet — a short grace so
  // the tap that landed the previous step's last shot can't bleed through
  // and instantly skip the callout that just appeared.
  const [freezeFtueTapReady, setFreezeFtueTapReady] = useState(false);
  useEffect(() => {
    const captionStep = freezeFtueStep === "intro" || freezeFtueStep === "explain-thaw" || freezeFtueStep === "outro";
    if (!captionStep) return;
    setFreezeFtueTapReady(false);
    const timer = window.setTimeout(() => setFreezeFtueTapReady(true), 500);
    return () => window.clearTimeout(timer);
  }, [freezeFtueStep]);
  // Only "intro" and "explain-thaw" go through here — "outro"'s tap is wired
  // to `restart` directly at the call site (JSX, further down), since it has
  // to reset the whole board rather than just move the state machine along;
  // see that `onClick`'s own comment for why.
  const advanceFreezeFtue = useCallback(() => {
    if (!freezeFtueTapReady) return;
    setFreezeFtueStep((step) => {
      switch (step) {
        case "intro": return "demo-freeze";
        case "explain-thaw": return "demo-clear";
        default: return step;
      }
    });
  }, [freezeFtueTapReady]);

  /**
   * Level 3's booster tutorial (`SandLevelConfig.ftueBoosterDemo`) — teaches
   * two boosters back to back by having the player actually arm and fire
   * each one themselves, not by watching a scripted stand-in shot:
   *
   *   intro-radius — spotlight (dark everywhere else, a see-through hole
   *                  over the real Radius Overcharge tray button — see
   *                  `.ftue-freeze-spotlight` in globals.css) + caption,
   *                  purely visual (`pointer-events: none` on the whole
   *                  overlay) so the tap actually needed here reaches the
   *                  REAL button underneath and arms it for real
   *   shoot-radius — the overlay is gone outright; the player aims and
   *                  fires their own shot with it armed, exactly like any
   *                  other shot. `armedBooster` flipping to
   *                  "radiusOvercharge" is what moves `intro-radius` here;
   *                  `state.phase` returning to "READY" with `shotsUsed`
   *                  past this step's own baseline is "the shot landed and
   *                  the sand finished settling", which — held for
   *                  `BOOSTER_TRY_SETTLE_HOLD_MS` — is what moves on
   *   intro-prism  — same idea as intro-radius, spotlighting Prism Shot
   *   shoot-prism  — same idea as shoot-radius; landing this one hands
   *                  control back outright (no outro caption) — on
   *                  request: "cho người chơi booster như cũ rồi tiếp tục
   *                  màn hiện tại"
   *
   * On request (replacing an earlier scripted-demo version entirely):
   * "Nó nên là hiện giới thiệu highlight booster -> bắt người chơi nhấn
   * vào -> tắt opacity, để người chơi tự nhắm và bắn -> bắn xong, sau khi
   * cát sand settling được 1 giây thì giới thiệu prism shot... Sau khi bắn
   * xong, sau cát sand settling được 1 giây thì cho người chơi booster như
   * cũ rồi tiếp tục màn hiện tại."
   */
  const [boosterFtueStep, setBoosterFtueStep] = useState<
    "intro-radius" | "shoot-radius" | "intro-prism" | "shoot-prism" | null
  >(null);
  // Which `state.shotsUsed` count a "shoot-*" step started at — the signal
  // for "the player's own shot has landed" is this count going up, not just
  // `state.phase` cycling (aiming/idle time before they actually fire looks
  // identical to settled-and-waiting otherwise). Set by the arm-detection
  // effect the instant a step becomes "shoot-*"; read by the settle effect
  // just below it.
  const shootStepBaselineShotsRef = useRef(0);
  // The two effects that actually drive `boosterFtueStep` forward live
  // further down, right after `state` and `armedBooster` are both in scope
  // — they need to read `state.phase`/`state.shotsUsed` and `armedBooster`,
  // none of which exist yet at this point in the component body.

  /**
   * Level 5's Chain Sort tutorial (`SandLevelConfig.ftueChainSortDemo`) —
   * on request ("Tôi muốn flow tutorial giới thiệu chainsort cũng sẽ giống
   * như 2 booster trước đó"), reuses the exact same "player actually arms
   * and fires the real booster themselves" shape `boosterFtueStep` teaches
   * Radius Overcharge/Prism Shot with, just for one booster instead of a
   * pair — no more scripted demo shot, no more "outro"/loop-until-tapped:
   *
   *   intro — spotlight (dark everywhere else, a see-through hole over the
   *           real Chain Sort tray button) + caption, purely visual
   *           (`pointer-events: none` on the whole overlay) so the tap
   *           actually needed here reaches the REAL button underneath and
   *           arms it for real
   *   shoot — the overlay is gone outright; the player aims and fires their
   *           own shot with it armed, exactly like any other shot.
   *           `armedBooster` flipping to "chainSort" is what moves `intro`
   *           here; `state.phase` returning to "READY" with `shotsUsed`
   *           past this step's own baseline is "the shot landed and the
   *           sand finished settling", which — held for
   *           `BOOSTER_TRY_SETTLE_HOLD_MS` — hands control back outright
   *           (no outro caption), same as `boosterFtueStep`'s own
   *           "shoot-prism" ending
   *
   * The two effects that actually drive this forward live further down,
   * right after `state` and `armedBooster` are both in scope — same reason
   * `boosterFtueStep`'s own pair of effects live there, and this reuses
   * their shared `shootStepBaselineShotsRef` (the two tutorials never run
   * on the same level at once, so sharing it is safe).
   */
  const [chainSortFtueStep, setChainSortFtueStep] = useState<"intro" | "shoot" | null>(null);

  // The engine simulates and reports state at pixel resolution — every number
  // this component reads off `state` (remainingCells above all) is in those
  // terms, so the level it reasons about here has to be expanded the same way,
  // not the small authored blueprint. Expansion is idempotent, so handing this
  // already-expanded config to the engine below costs nothing extra.
  //
  // `playingZen` picks which of the two lists this reads from — the main
  // list and the Zen list never share an index space (see `ZEN_ID_BASE`), so
  // this has to be an either/or, not a merge.
  const raw = playingZen
    ? (zenPlayables[Math.min(zenLevelIndex, zenPlayables.length - 1)]?.level ?? BUILT_IN_ZEN_LEVELS[0])
    : (playables[Math.min(levelIndex, playables.length - 1)]?.level ?? BUILT_IN_LEVELS[0]);
  const level = useMemo(() => expandLevelForPixelBoard(raw), [raw]);

  /**
   * The Play/Restart entry points' one shared gate — spends a heart and
   * returns `true` (go ahead and start playing) when there was one to spend,
   * or shows the "out of hearts" toast and returns `false` (the caller must
   * NOT start play) when the tank was empty. A no-op that always returns
   * `true` before hearts unlock or while playing Zen — see `economy.ts`'s
   * own header for why Zen never touches this at all — and also a no-op
   * once `raw` (the level about to be (re)played) has already been cleared
   * at least once: a replay from the Gallery (or "Play again"/Restart on a
   * level beaten before) does not cost a heart, only a genuinely new
   * attempt does (on request, 2026-09m: "Khi người chơi chơi lại màn từ
   * gallery, sẽ không tốn tim"). Declared here, after `raw`, rather than up
   * with the rest of the hearts state above — `raw.id` needs to be a real
   * dependency (so this recreates whenever the selected/played level
   * changes, not just when hearts state does), and `raw` is not assigned
   * yet at that earlier point in this component. Zen levels never reach
   * `hasClearedLevel` either way since the `playingZen` check above already
   * returns first.
   */
  const tryStartAttempt = useCallback((): boolean => {
    if (!heartsUnlocked || playingZen || hasClearedLevel(raw.id)) return true;
    if (spendHeart(devNow().getTime())) {
      setHearts(getHeartsState(devNow().getTime()));
      return true;
    }
    const state = getHeartsState(devNow().getTime());
    pushToast(s.outOfHearts(formatHeartCountdown(state.msUntilNext ?? 0)), "warn");
    return false;
  }, [heartsUnlocked, playingZen, raw.id]);

  /**
   * Whether the level 1-3 onboarding lock (Settings gear hidden mid-play,
   * WIN card's own ✕ hidden, booster tray showing empty) still applies. On
   * request ("Nút setting không xuất hiện ở level 1, 2, 3 khi người chơi
   * vào game lần đầu, nếu người chơi chơi lại, kích hoạt level từ gallery
   * HUB thì nó vẫn hiện. Booster cũng vậy") — `raw.id >= WIN_CLOSE_BUTTON_FROM_LEVEL_ID`
   * on its own only covers "has this play session reached level 4 yet",
   * which re-locks every one of these the moment a player REPLAYS level
   * 1-3 later (from Gallery, GameDevOption, or Home's Play once level 1 is
   * cleared again) — the onboarding walkthrough is long over by then, so
   * there is nothing left to protect the player from. `hasClearedLevel`
   * reads the same persisted "cleared at least once" record the Gallery
   * grid's own unlock check and Chain Sort's unlock gate already trust —
   * once level 3 has been cleared a single time, this is permanently
   * `true` from then on (never re-locks), same shape as every other
   * once-and-done unlock in this file. */
  const onboardingLockLifted =
    raw.id >= WIN_CLOSE_BUTTON_FROM_LEVEL_ID || hasClearedLevel(WIN_CLOSE_BUTTON_FROM_LEVEL_ID - 1);

  // Nothing to show yet on a level whose one lesson is "aim and shoot"
  // (`ftueGesture`) or that explicitly asks to hide the tray's buttons
  // (`hideBoosterHud`, e.g. level 2, boosters aren't taught until level 3)
  // — the booster tray's own dock still renders with no buttons in it (see
  // `.booster-hud`'s own comment further down). Only for the FIRST time
  // through, though (`onboardingLockLifted`, same shape as its own doc
  // comment above): once level 3 has been cleared once, a Gallery replay of
  // level 1/2 shows the real buttons same as any other level. The tray's
  // gold chip shares this exact gate (on request: "Xóa Coin Currency HUD ở
  // level 1, 2 ở trên booster tray") — there is nothing to spend it on
  // before boosters exist, so a balance there would just be clutter on a
  // dock with no buttons under it.
  const showBoosterButtons = (!level.ftueGesture && !level.hideBoosterHud) || onboardingLockLifted;

  // Drives the two "demo-*" freeze-tutorial steps: fires the scripted
  // shot(s) for that beat, then moves straight to the next caption once
  // they land — no tap gates a demo step, the shots landing is what ends
  // it. `level.ftueFreezeTargets` is `[orb, ...clearShots]` (see its own
  // doc comment): the orb is its own one-shot beat, everything after it is
  // the "watch it clear" beat.
  useEffect(() => {
    if (!engine) return;
    const targets = level.ftueFreezeTargets;
    if (!targets?.length) return;
    if (freezeFtueStep === "demo-freeze") {
      let cancelled = false;
      engine.runScriptedShotSequence([targets[0]]).finally(() => {
        if (!cancelled) setFreezeFtueStep("explain-thaw");
      });
      return () => { cancelled = true; };
    }
    if (freezeFtueStep === "demo-clear") {
      let cancelled = false;
      engine.runScriptedShotSequence(targets.slice(1)).finally(() => {
        if (!cancelled) setFreezeFtueStep("outro");
      });
      return () => { cancelled = true; };
    }
  }, [freezeFtueStep, engine, level]);

  // The Shop tab's "go buy the boosters you just tried" red dot
  // (`BOOSTER_SHOP_HINT_KEY`) — lit the instant a tutorial finishes, so it's
  // waiting on the hub-nav the moment the player backs out to Home (the nav
  // itself is what's hidden during play, not this flag). Kept as its own
  // piece of state, not read fresh from storage on every render like
  // `unseenAffordableSkins`, because there's no wallet/level input to
  // recompute it from — it only ever changes on these explicit edges, both
  // of them the "shoot-*"/"shoot" ending of a tutorial (further down, once
  // `state`/`armedBooster` are in scope, alongside `boosterFtueStep`'s and
  // `chainSortFtueStep`'s own settle-detection effects).
  const [boosterShopHint, setBoosterShopHintState] = useState(false);
  useEffect(() => {
    setBoosterShopHintState(loadBoosterShopHint());
  }, []);

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
  const [ammoAnim, setAmmoAnim] = useState<{
    color: SandColor | null;
    upcoming: SandColor[];
    bump: number;
    shotsUsed: number;
  }>(() => ({ color: currentAmmo(level, state), upcoming: nextAmmo(level, state), bump: 0, shotsUsed: state.shotsUsed }));
  const [toast, setToast] = useState<Toast | null>(null);
  // Mirrors `SandCannonEngine`'s own `armedBooster` — null means neither
  // booster is armed. The engine is the source of truth (it is what enforces
  // spec §3's no-cancel, no-swap rule); this only echoes it for the HUD.
  const [armedBooster, setArmedBooster] = useState<BoosterType | null>(null);

  // The real tray button arming is what advances past each "intro-*" step
  // of `boosterFtueStep` — see its own doc comment for why there is nothing
  // to tap on the overlay itself any more.
  useEffect(() => {
    if (boosterFtueStep === "intro-radius" && armedBooster === "radiusOvercharge") {
      shootStepBaselineShotsRef.current = state.shotsUsed;
      setBoosterFtueStep("shoot-radius");
    } else if (boosterFtueStep === "intro-prism" && armedBooster === "prismShot") {
      shootStepBaselineShotsRef.current = state.shotsUsed;
      setBoosterFtueStep("shoot-prism");
    }
  }, [armedBooster, boosterFtueStep, state.shotsUsed]);
  // The player's own shot landing (and the sand settling after it) is what
  // advances past each "shoot-*" step, held `BOOSTER_TRY_SETTLE_HOLD_MS` so
  // the result actually reads before anything covers it again.
  useEffect(() => {
    if (boosterFtueStep !== "shoot-radius" && boosterFtueStep !== "shoot-prism") return;
    if (state.phase !== "READY" || state.shotsUsed <= shootStepBaselineShotsRef.current) return;
    const timer = window.setTimeout(() => {
      if (boosterFtueStep === "shoot-radius") {
        setBoosterFtueStep("intro-prism");
      } else {
        // The pair is done — hand control back outright, no outro caption
        // (on request), and light the Shop's own "go buy more" hint the
        // same moment `chainSortFtueStep`'s own "shoot" ending, just below,
        // does too.
        setBoosterFtueStep(null);
        setBoosterShopHint(true);
        setBoosterShopHintState(true);
      }
    }, BOOSTER_TRY_SETTLE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [boosterFtueStep, state.phase, state.shotsUsed]);

  // Level 5's Chain Sort tutorial — same pair of effects as `boosterFtueStep`
  // just above, reusing the exact same `shootStepBaselineShotsRef` (the two
  // tutorials live on different levels and never run at once), just for one
  // booster instead of two: real tray-button arming advances "intro" to
  // "shoot", the player's own shot landing (settled `BOOSTER_TRY_SETTLE_HOLD_MS`)
  // hands control back outright — no scripted demo, no outro caption.
  useEffect(() => {
    if (chainSortFtueStep === "intro" && armedBooster === "chainSort") {
      shootStepBaselineShotsRef.current = state.shotsUsed;
      setChainSortFtueStep("shoot");
    }
  }, [armedBooster, chainSortFtueStep, state.shotsUsed]);
  useEffect(() => {
    if (chainSortFtueStep !== "shoot") return;
    if (state.phase !== "READY" || state.shotsUsed <= shootStepBaselineShotsRef.current) return;
    const timer = window.setTimeout(() => {
      setChainSortFtueStep(null);
      setBoosterShopHint(true);
      setBoosterShopHintState(true);
    }, BOOSTER_TRY_SETTLE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [chainSortFtueStep, state.phase, state.shotsUsed]);

  // Bumped once per Radius Overcharge impact (`BOOSTER_IMPACT`) — the actual
  // shake is a CSS animation restarted by the effect below keyed on this
  // number, not a class this state directly renders, since the same class
  // held constant across two bumps would not replay the animation on its
  // own (on request: "rung chuyển toàn HUD").
  const [radiusShakeBump, setRadiusShakeBump] = useState(0);
  /** Bumped once per `NO_MATCH`/`MISS` engine event — a shot that hit
   * nothing of its own colour, hit the frame, or missed the frame outright.
   * Same "bump counter, not a boolean" shape as `radiusShakeBump` just
   * above and for the same reason: the CSS animation it keys
   * (`.miss-flash`, remounted on every change via `key={missFlashBump}`)
   * has to replay even when two misses land back to back before the
   * previous flash finished fading. Replaces the old text toast entirely —
   * on request: "không hiện UI pop up thông báo miss lên, mà thay vì đó cho
   * background có 1 lớp đỏ nhẹ và viền tranh cũng có filter đỏ nhẹ". */
  const [missFlashBump, setMissFlashBump] = useState(0);
  const hudAmmoClusterRef = useRef<HTMLDivElement | null>(null);
  const hudSettingsRef = useRef<HTMLDivElement | null>(null);
  // Replays `.hud-radius-shake` on both HUD clusters every time
  // `radiusShakeBump` changes — toggling the class off then on (with a
  // forced reflow between the two) restarts the CSS animation without
  // remounting either cluster's own DOM, which would also reset unrelated
  // per-element animations already living inside them (the ammo badge's own
  // bump-driven slide, the freeze bar's mount-in pop). `hudSettingsRef` is
  // null whenever the settings gear itself is not mounted (chest/unlock/win
  // screens) — skipped rather than an error, same as any other ref guard.
  useEffect(() => {
    if (radiusShakeBump === 0) return;
    for (const el of [hudAmmoClusterRef.current, hudSettingsRef.current]) {
      if (!el) continue;
      el.classList.remove("hud-radius-shake");
      void el.offsetWidth;
      el.classList.add("hud-radius-shake");
    }
  }, [radiusShakeBump]);
  const toastTimer = useRef<number | null>(null);
  // The player's gold + booster inventory. `economy.ts` is the source of
  // truth (localStorage-backed); this just re-renders whenever it changes —
  // a level win, a Shop purchase, or a daily-login claim all call through it.
  const wallet = useSyncExternalStore(subscribeWallet, getWallet, () => SERVER_WALLET);
  // Which booster the Shop is asking "buy this?" about, or null when no
  // confirm dialog is up. A coin spend is real money in this economy (it
  // took playing levels to earn), so tapping a price pill opens this instead
  // of buying on the spot — the dialog itself reads straight from `wallet`
  // and `boosterPrice`, so it never goes stale between opening and the
  // player's Yes/No.
  const [buyConfirm, setBuyConfirm] = useState<BoosterType | null>(null);
  // The quantity the confirm dialog's own stepper is dialed to — reset to 1
  // every time a price pill opens a fresh confirm (see that `onClick`), not
  // carried over between boosters or reopenings. Clamped to [0, `qtyCap`] by
  // the stepper's own buttons rather than here (`qtyCap`, computed where the
  // dialog renders, is 99 or whatever fewer the wallet can actually afford —
  // never let a player dial in a quantity they cannot pay for), so this can
  // stay a plain number.
  const [buyQty, setBuyQty] = useState(1);
  // A small "not live yet" notice for every real-money buy button (Special
  // Offers, Bundles, the Coins/Hearts packs) — there is no payment processor
  // behind any of them, so tapping one cannot silently do nothing; it has to
  // say why. Its own state rather than reusing `toast` above: `toast`
  // renders inside `.scene-wrap`, which sits underneath the Shop screen's
  // own opaque background and would never be seen from here.
  const [iapNotice, setIapNotice] = useState(false);
  const iapNoticeTimer = useRef<number | null>(null);
  const notifyIapComingSoon = useCallback(() => {
    if (iapNoticeTimer.current) window.clearTimeout(iapNoticeTimer.current);
    setIapNotice(true);
    iapNoticeTimer.current = window.setTimeout(() => setIapNotice(false), 1800);
  }, []);
  // Hold-to-repeat for the stepper's two triangle buttons: pointerdown arms a
  // one-shot delay, and only once that delay elapses does the first repeat
  // fire and an interval take over — a quick tap never enters this path at
  // all (`stopQtyHold` below cancels the still-pending delay before it can),
  // so a tap keeps behaving like a plain click's `onClick` (see the button
  // JSX) instead of double-stepping. `qtyHeldRef` is what tells that `onClick`
  // to skip its own step once a hold-repeat has already run — the browser
  // still fires a trailing click after a completed press-and-release, and
  // without this it would step once more on top of whatever the hold already
  // added.
  const qtyHoldDelay = useRef<number | null>(null);
  const qtyHoldInterval = useRef<number | null>(null);
  const qtyHeldRef = useRef(false);
  const stopQtyHold = useCallback(() => {
    if (qtyHoldDelay.current !== null) { window.clearTimeout(qtyHoldDelay.current); qtyHoldDelay.current = null; }
    if (qtyHoldInterval.current !== null) { window.clearInterval(qtyHoldInterval.current); qtyHoldInterval.current = null; }
  }, []);
  const startQtyHold = useCallback((step: () => void) => {
    // Defensive: a stray second `pointerdown` before its predecessor's own
    // `pointerup`/`pointerleave` (multi-touch, pointer-capture quirks) would
    // otherwise stack a second timer on top of the first instead of just
    // restarting the hold.
    stopQtyHold();
    qtyHeldRef.current = false;
    qtyHoldDelay.current = window.setTimeout(() => {
      qtyHeldRef.current = true;
      step();
      qtyHoldInterval.current = window.setInterval(step, 90);
    }, 400);
  }, []);
  // A tap's own step, suppressed the one time it lands right after a
  // hold-repeat let go (see the comment above `qtyHoldDelay`).
  const stepQtyOnClick = useCallback((step: () => void) => {
    if (qtyHeldRef.current) {
      qtyHeldRef.current = false;
      return;
    }
    step();
  }, []);
  // Timers are refs, not state — nothing here should ever survive the
  // component unmounting mid-hold (a shot fired, a tab switched via some
  // other input) with an interval still ticking against a dead component.
  useEffect(() => stopQtyHold, [stopQtyHold]);
  // The hub's persistent gold badge shows this instead of `wallet.gold`
  // directly, so a daily-login claim (or a level win — see `pendingHomeReward`
  // below) can hold the old number on screen while the flying coins are still
  // in the air and only tick it up once they land. A Shop buy is the one
  // change that still reaches it immediately via the effect below: the Shop
  // is only ever open at home, badge already on screen, nothing to fly from.
  const [displayGold, setDisplayGold] = useState(() => wallet.gold);
  const suppressGoldSyncRef = useRef(false);
  const goldTweenRef = useRef<number | null>(null);
  const [goldBump, setGoldBump] = useState(0);
  const goldHudRef = useRef<HTMLSpanElement | null>(null);
  const todayCoinRef = useRef<HTMLDivElement | null>(null);
  const coinBurstId = useRef(0);
  const [coinBursts, setCoinBursts] = useState<
    Array<{ id: number; fromX: number; fromY: number; dx: number; dy: number; delay: number }>
  >([]);
  /**
   * Gold earned from level wins since the last time the player actually saw
   * the hub's gold badge — the WIN screen's own coin-fly animation (its own
   * effect, below `claimDailyLoginWithFlight`) is what pays this out, and
   * that only ever happens once the player is looking at the badge it flies
   * into. Tapping Continue straight into the next level keeps stacking this
   * instead of paying it out — there is no badge on screen mid-play for a
   * fly animation to land on, so a chain of Continues shows nothing until
   * Home, then flies the whole stack at once. The gold itself is never held
   * back this way (`addGold` still runs the instant a level is won, where
   * the reward is granted); only the *badge's own number* and the flight
   * that ticks it up wait for Home.
   */
  const [pendingHomeReward, setPendingHomeReward] = useState(0);
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
  // undefined: no action taken yet this page load, so the daily-login modal's
  // open/closed state defers entirely to `initialDailyLogin` below (open iff
  // unclaimed today). Claiming, dismissing, or reopening via the gift button
  // all write a real snapshot (or `null` for "closed") here, which then wins
  // over the initial one for the rest of the session.
  const [dailyLoginOverride, setDailyLoginOverride] = useState<DailyLoginState | null | undefined>(undefined);
  // Mirrors `dailyLoginOverride`, for the calendar grid's own claimed-state:
  // `undefined` until a claim happens this session, at which point the grid
  // needs to redraw today's cell with its checkmark — same "write a real
  // snapshot on claim" shape, just a whole grid's worth instead of one day's.
  const [dailyCalendarOverride, setDailyCalendarOverride] = useState<DailyLoginCalendarCell[] | undefined>(undefined);
  /** Lit the instant the daily-login modal gets FORCE-closed by a hub-nav tap
   * (see the nav's own `onClick` below) while still unclaimed — on request:
   * "nếu người nhấn phần thanh tác vụ ở dưới và chuyển sang hub khác, thì
   * daily login đó buộc phải tắt đi... nếu ... vẫn chưa nhận phần thưởng,
   * thì sẽ hiện chấm đỏ". Not set for an ordinary dismiss (the corner X or
   * tapping the scrim) — only the "the player was on their way somewhere
   * else and never got to decide" case needs a reminder; a player who
   * closed it on purpose already made their choice. Cleared the moment a
   * claim actually lands (`claimDailyLoginWithFlight` below), same "one
   * look is enough to dismiss it" shape as `boosterShopHint`'s own dot —
   * except this one needs the reward actually collected, not just seen,
   * since the whole point is "you still haven't claimed this". Session-only
   * (not persisted): a reload with today still unclaimed re-opens the modal
   * automatically anyway (`initialDailyLogin` above), which already puts it
   * back in front of the player without needing this dot too. */
  const [dailyLoginMissedClaim, setDailyLoginMissedClaim] = useState(false);
  /** Claims today's reward, then flies a handful of coins from the day
   * strip's highlighted cell to the hub's gold badge before the number
   * there ticks up — the visual payoff `claimDailyLogin` itself has no
   * opinion on, since `economy.ts` only deals in numbers. */
  const claimDailyLoginWithFlight = useCallback(() => {
    const goldBefore = wallet.gold;
    const claimed = claimDailyLogin(devNow());
    if (!claimed) return;
    setDailyLoginOverride(claimed);
    setDailyCalendarOverride(getDailyLoginCalendar(devNow()));
    setDailyLoginMissedClaim(false);
    // Weekend claims pay no gold at all (`DAILY_LOGIN_REWARDS[5]`/`[6]` are
    // 0 — booster only), so there is nothing to fly to the wallet.
    if (claimed.reward <= 0) return;
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
  // The game opens on the home screen, the way it did before the pivot.
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<HubTab>("home");
  // Closes the Shop's buy-confirm dialog (`buyConfirm` above) the instant the
  // player leaves the Shop tab, not just when the dialog's own render guard
  // hides it — otherwise switching tabs mid-confirm and coming back to Shop
  // later would resurrect a stale "buy this?" nobody asked to reopen.
  useEffect(() => {
    if (tab !== "shop") {
      setBuyConfirm(null);
      setIapNotice(false);
    }
  }, [tab]);

  // The hub's own currency HUD (`.hub-gold-wrap`) doubles as a shortcut to
  // buying more — tapping it jumps straight to the "Buy coins directly"
  // section (real-money packs, `COIN_PACKS`) rather than just opening the
  // Shop at its top, since that section sits a few screens down (Special
  // Offers, then Bundles, above it) and would otherwise need a manual
  // scroll to find. `coinPackSectionRef` is what gets scrolled into view;
  // `scrollToCoinPacks` just remembers the intent until the Shop screen is
  // actually mounted (`tab` flipping to `"shop"` is not synchronous with
  // this click, so the ref is not attached to anything yet the instant this
  // runs).
  const coinPackSectionRef = useRef<HTMLDivElement | null>(null);
  const [scrollToCoinPacks, setScrollToCoinPacks] = useState(false);
  const openCoinPacks = useCallback(() => {
    setTab("shop");
    setScrollToCoinPacks(true);
  }, []);
  useEffect(() => {
    if (!scrollToCoinPacks || tab !== "shop") return;
    coinPackSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollToCoinPacks(false);
  }, [scrollToCoinPacks, tab]);

  // Same shortcut shape as `openCoinPacks` above, for the `hub-nav`'s own
  // Shop-tab hint dot — "go buy the boosters you just tried" now means
  // scrolling all the way to the Boosters section at the very end of the
  // unified Shop screen (see that section's own comment for why it moved
  // there), not switching to a "Coins tab" that no longer exists.
  const boostersSectionRef = useRef<HTMLDivElement | null>(null);
  const [scrollToBoosters, setScrollToBoosters] = useState(false);
  useEffect(() => {
    if (!scrollToBoosters || tab !== "shop") return;
    boostersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollToBoosters(false);
  }, [scrollToBoosters, tab]);

  // Same shortcut shape as `openCoinPacks` above, now for the heart HUD
  // chip's own green plus mark (2026-09p ask: "thêm icon dấu cộng nền xanh
  // lá vào heart currency, giống như coin currency... chuyển đến khu vực
  // mua heart ở trong shop") — jumps straight to the Shop's "buy Hearts
  // directly" section instead of just opening the Shop at its top.
  const heartPackSectionRef = useRef<HTMLDivElement | null>(null);
  const [scrollToHeartPacks, setScrollToHeartPacks] = useState(false);
  const openHeartPacks = useCallback(() => {
    setTab("shop");
    setScrollToHeartPacks(true);
  }, []);
  useEffect(() => {
    if (!scrollToHeartPacks || tab !== "shop") return;
    heartPackSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollToHeartPacks(false);
  }, [scrollToHeartPacks, tab]);
  /**
   * Pays out `pendingHomeReward` (see its own comment) the moment its badge
   * is actually on screen to fly into — `!playing && tab === "home"`, the
   * same condition `.hub-gold-badge` itself renders under. Fires once per
   * arrival: the first thing this does is zero `pendingHomeReward`, so the
   * guard fails on the very next render and the effect does not re-fire
   * chasing its own state change. No specific "from" element the way
   * `claimDailyLoginWithFlight` has one (the day strip's highlighted cell) —
   * a level win has no fixed on-screen origin, so the coins simply spawn
   * from the middle of the frame.
   */
  useEffect(() => {
    if (playing || tab !== "home" || pendingHomeReward <= 0) return;
    setPendingHomeReward(0);
    // `wallet.gold` already includes this reward — `addGold` ran the instant
    // the level was won (see that block's own comment) — so it is the tween's
    // target as-is. `tweenGoldTo` reads its own start point from `displayGold`,
    // which `suppressGoldSyncRef` has been holding back at the pre-reward
    // number since the win, so there is still real ground to visibly cover.
    const toEl = goldHudRef.current;
    if (!toEl) {
      tweenGoldTo(wallet.gold);
      return;
    }
    const toRect = toEl.getBoundingClientRect();
    const fromX = window.innerWidth / 2;
    const fromY = window.innerHeight / 2;
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
      tweenGoldTo(wallet.gold);
    }, 720);
  }, [playing, tab, pendingHomeReward, wallet.gold, tweenGoldTo]);
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
  // True for the one animation's worth of time right after tapping Select —
  // see `selectCostume` and `.skin-equip.is-just-selected` in globals.css.
  const [justEquippedPulse, setJustEquippedPulse] = useState(false);
  // Rendered once per page load by `SandCannonEngine.captureCostumeThumbnails`
  // — empty until the skin screen first opens, since capturing a thumbnail
  // needs the engine's own renderer and there is no reason to pay for it
  // before a player has ever looked at the tray.
  const [costumeThumbnails, setCostumeThumbnails] = useState<Partial<Record<CostumeId, string>>>({});
  // Read once: `isSoundEnabled()` is a plain module variable, and this is the
  // only place in the UI that ever writes it, so nothing else can go stale.
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  // Same one-place-writes-it reasoning as `soundOn` above, for the haptics
  // module's own stored preference.
  const [vibrationOn, setVibrationOn] = useState(() => isHapticsEnabled());
  // Same one-place-writes-it reasoning again, for the aim-sensitivity module.
  // Applying it to the engine is a separate effect below — `aim-sensitivity.ts`
  // only owns storing the number, `SandCannonEngine.setControlSensitivity` is
  // what actually changes how the joystick responds.
  const [aimSensitivity, setAimSensitivityState] = useState(() => getAimSensitivity());
  // Unlike `soundOn`/`vibrationOn` above, this can't be a plain `useState(()
  // => getLanguage())`: that reads real client storage on the very first
  // client render, while the server pass (which never sees localStorage)
  // rendered "en" — a text mismatch `useSyncExternalStore` exists to
  // reconcile safely (`() => "en"` is what the server, and the first client
  // pass during hydration, render; `getLanguage`/`subscribeLanguage` are what
  // every render after that reads and reacts to). `s` is every piece of copy
  // this render needs, in whichever language is current; every JSX string
  // below reads through it rather than branching on `language` itself.
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => "en" as const);
  const s = t(language);
  const HUB_TAB_NAME = hubTabNames(s);
  // The one unified Settings card (see globals.css's own comment on
  // `.settings-screen`) — opened from the same gear button either way,
  // `!playing` (the hub) or mid-play (`.settings-wrap`'s in-play button),
  // so there is exactly one place Sound/Vibration/the level editor live.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Whether the GameDevOption section is expanded — it starts collapsed
  // behind its own toggle button so the whole dev-tools grid doesn't crowd
  // the Settings card for players who never open it.
  const [devOptionsOpen, setDevOptionsOpen] = useState(false);
  // The GameDevOption "jump to level" field's raw text, kept separate from
  // `chosenIndex` so a half-typed number never triggers a jump.
  const [devLevelInput, setDevLevelInput] = useState("");
  // The GameDevOption date-offset field — mirrors `devLevelInput`'s own
  // "raw text, not the applied value" shape. Seeded from whatever offset is
  // already persisted (`getDevDateOffsetDays`), not `0`, so reopening
  // Settings after a previous nudge shows the offset actually in effect
  // rather than looking like it reset itself. Server-safe default (`"0"`)
  // since `getDevDateOffsetDays` reads `window.localStorage` — this is a
  // dev-only field nobody sees before hydration anyway.
  const [devDateOffsetInput, setDevDateOffsetInput] = useState(() =>
    typeof window === "undefined" ? "0" : String(getDevDateOffsetDays()),
  );
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
  // `lastHandledResult`/`dailyLoginOverride`) already use elsewhere in this file:
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
  // version counter) — the Shop panel's price reads `boosterPrice` directly
  // during render rather than through `subscribeWallet`, so without this a
  // poll pickup would sit in the module cache unseen until some unrelated
  // re-render happened to read it fresh. (The daily-login calendar's own
  // numbers are cached once per page load instead, same trade-off
  // `cachedInitialDailyLogin` already makes — see `SERVER_DAILY_CALENDAR`'s
  // comment — so a CSV edit there needs a reload, not just this poll.)
  useSyncExternalStore(subscribeEconomyConfig, getEconomyConfigVersion, () => 0);

  /**
   * The home screen's reward track — the bar that replaced the dead "Modes"
   * chip next to Play. `getRewardTrackState()` builds a fresh object on every
   * call, so it cannot be a `useSyncExternalStore` snapshot itself; the
   * version number is (`subscribeRewardTrack` in `economy.ts`, see its own
   * comment), and the state is derived off that plus `economyConfigVersion`,
   * so a designer's live `economy.csv` edit to a milestone amount moves the
   * bar's labels without a reload the same way booster prices already do.
   */
  const track: RewardTrackState = useSyncExternalStore(
    subscribeRewardTrack,
    getRewardTrackSnapshot,
    () => SERVER_REWARD_TRACK,
  );
  /**
   * The chest screen, or `null` when it is closed. Its own little state
   * machine rather than a boolean, because the ask is a sequence: the chest
   * spins in place, stops, the lid opens, and only then does the emerald fly
   * out. Each phase is handed to the engine, which draws and animates the
   * chest itself (`setChestShowcase`), plus the timer below that advances to
   * the next one.
   *
   * `amount` is filled in at the "opening" step — that is where
   * `claimRewardTrack` actually runs, so the number on screen is the one that
   * was really paid, and a screen closed early (or a reload mid-animation)
   * has already banked it rather than losing it.
   */
  const [chest, setChest] = useState<{ phase: "spinning" | "opening" | "revealed"; amount: number } | null>(null);
  useEffect(() => {
    if (!chest || chest.phase === "revealed") return;
    if (chest.phase === "spinning") {
      // Matched to `CHEST_SPIN_SECONDS` in SandCannonEngine.ts — long enough
      // to read as a real spin-and-settle rather than a flicker, short enough
      // that a player opening their fifth chest is not waiting on it.
      const timer = window.setTimeout(() => {
        // Paid at the moment the lid starts to move. `claimRewardTrack` is
        // itself the "is this bar actually complete" guard, so a second
        // opening that somehow got through gets `null` here and shows 0
        // rather than paying twice.
        const paid = claimRewardTrack() ?? 0;
        setChest({ phase: "opening", amount: paid });
      }, 1500);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setChest((c) => (c ? { ...c, phase: "revealed" } : c)), 620);
    return () => window.clearTimeout(timer);
  }, [chest]);
  /**
   * Hands the chest's current beat to the engine, which is what actually draws
   * and animates it — a 3D rig on the shared canvas behind this screen, the
   * same arrangement the skin picker's cannon uses (see `setChestShowcase`).
   * Passing `null` on close takes it off stage and puts the level's picture
   * back. Re-entrant on the engine's side, so a re-render with the phase
   * unchanged does not restart the animation.
   */
  useEffect(() => {
    if (!engine) return;
    engine.setChestShowcase(chest?.phase ?? null);
  }, [engine, chest?.phase]);
  // Nothing to clean up on unmount beyond what the effect above already does
  // on `chest` going null — the engine is disposed with the component anyway.

  /** The reward-track button on the home screen. Only opens the chest on a
   * complete bar — an incomplete one is a progress readout, not an action. */
  const openChest = useCallback(() => {
    if (!track.canClaim) return;
    setChest({ phase: "spinning", amount: 0 });
  }, [track.canClaim]);

  /** Tapping the track while it is still filling does nothing but shake —
   * a "not yet" jolt distinct from the ready state's own idle wiggle, reset
   * once its animation finishes so the same tap can retrigger it. */
  const [trackDenied, setTrackDenied] = useState(false);
  const handleTrackTap = useCallback(() => {
    if (track.canClaim) {
      openChest();
      return;
    }
    setTrackDenied(true);
  }, [track.canClaim, openChest]);

  // Which locked skin the skin screen is asking "buy this?" about, or null.
  // Same reasoning as the Shop's own `buyConfirm`: spending a currency is
  // never a single unconfirmed tap, and emerald is scarcer than gold.
  const [skinBuyConfirm, setSkinBuyConfirm] = useState<CostumeId | null>(null);
  // The full-screen "you unlocked it" reveal — which cannon it is
  // celebrating, or null the rest of the time. Shared by two triggers, both
  // on the Skin screen now (on request — a level-progression unlock and a
  // Shop purchase are meant to look identical): `buySkin` sets it after
  // spending emerald, `unlockProgressionSkin` sets it after a level-earned
  // skin's own Unlock tap. A level clear no longer sets this directly — see
  // `skinTryPrompt` for the "want to try it?" step that now sits between a
  // win and this reveal. Cleared only by `dismissCannonUnlock` (the player's
  // own tap) — there is no timer that closes this on its own, the reveal is
  // meant to hold until they actually move past it.
  const [cannonUnlock, setCannonUnlock] = useState<CostumeId | null>(null);
  // Whether the "tap to continue" prompt has appeared yet — starts false the
  // instant the reveal opens so the very first frame cannot be tapped past
  // before the player has even read the name, then flips true after a fixed
  // beat (see the effect below).
  const [cannonUnlockTapReady, setCannonUnlockTapReady] = useState(false);
  useEffect(() => {
    if (!cannonUnlock) return;
    setCannonUnlockTapReady(false);
    const timer = window.setTimeout(() => setCannonUnlockTapReady(true), 2000);
    return () => window.clearTimeout(timer);
  }, [cannonUnlock]);
  // `dismissCannonUnlock` itself sits below `openLevel`'s own declaration,
  // since it calls it — see that declaration's own comment.
  // A confirm left open behind a tab switch must not resurrect itself when
  // the player comes back to the skin screen — same guard the Shop's has.
  useEffect(() => {
    if (tab !== "skin") setSkinBuyConfirm(null);
  }, [tab]);
  /**
   * The skin screen's Buy button. Spends first and only unlocks on a spend
   * that actually went through (`spendEmeralds` is atomic), so a short wallet
   * can never end up owning a skin it did not pay for. Equips it on the spot:
   * a player who just bought a skin wants to be wearing it, not looking at a
   * second button.
   */
  const buySkin = useCallback((id: CostumeId) => {
    if (!spendEmeralds(costumePrice(id))) {
      // Reads the language fresh rather than through the outer `s`: this
      // callback is memoised once per `[pushToast, engine]`, not per render,
      // so a stale closure would keep announcing in whatever language was
      // active when it was created instead of whichever is active now.
      pushToast(t(getLanguage()).toastNotEnoughEmerald, "warn");
      setSkinBuyConfirm(null);
      return;
    }
    unlockCostume(id);
    setSelectedCostume(id);
    setCostume(id);
    setSkinBuyConfirm(null);
    setJustEquippedPulse(true);
    // The reveal replaces the usual toast for this one moment — the spin,
    // glow and "YOU UNLOCKED ..." banner are the announcement now.
    setCannonUnlock(id);
    engine?.playUnlockCelebration();
  }, [pushToast, engine]);

  /**
   * The Skin screen's Unlock button for a `unlockLevel` skin whose level has
   * already been cleared (`previewUnlockRequirementMet`) — the level-earned
   * counterpart to `buySkin` above, minus the spend. On request: a level
   * clear used to grant and equip the skin immediately, with the reveal
   * firing the instant Continue was tapped; now the win only makes this
   * button live (see `skinTryPrompt`'s own comment for the "want to try it?"
   * step in between), and ownership + the reveal only happen here, once the
   * player actually taps it.
   */
  const unlockProgressionSkin = useCallback((id: CostumeId) => {
    unlockCostume(id);
    setSelectedCostume(id);
    setCostume(id);
    setJustEquippedPulse(true);
    setCannonUnlock(id);
    engine?.playUnlockCelebration();
  }, [engine]);

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
  // The calendar grid's own data, same hydration-safe shape as `dailyLogin`
  // just above (see `SERVER_DAILY_CALENDAR`'s comment for why this cannot
  // just call `getDailyLoginCalendar` inline in the JSX below).
  const initialDailyCalendar = useSyncExternalStore(noopSubscribe, readInitialDailyCalendar, () => SERVER_DAILY_CALENDAR);
  const dailyCalendar = dailyCalendarOverride ?? initialDailyCalendar;

  useEffect(() => {
    const host = hostRef.current;
    const aimZone = aimZoneRef.current;
    const crosshair = crosshairRef.current;
    if (!host || !aimZone || !crosshair) return;

    const onEvent = (event: SandEngineEvent) => {
      // Read fresh, not through the outer `s`: this handler is captured once
      // per `[level, runId, pushToast]` by the effect below, not per render,
      // so a stale closure would keep announcing in whatever language was
      // active when the engine was (re)built instead of whichever is active
      // by the time a shot actually lands.
      const s = t(getLanguage());
      switch (event.type) {
        case "AIM_TOUCHED":
          // The gesture glyph's whole job is to get out of the way the moment
          // the player tries the real control themselves — a no-op the rest
          // of the time, since this fires on every aim, not just the first.
          setFtueGestureOpen(false);
          break;
        case "NO_MATCH":
        case "MISS":
          // Both used to push a text toast explaining exactly what went
          // wrong (no colour in range / hit the frame / missed outright) —
          // on request: "Khi hit miss, không hiện UI pop up thông báo miss
          // lên, mà thay vì đó cho background có 1 lớp đỏ nhẹ và viền tranh
          // cũng có filter đỏ nhẹ". One flash covers every flavour of
          // "that shot didn't do anything" now; see `missFlashBump`'s own
          // comment for what it actually renders.
          setMissFlashBump((n) => n + 1);
          break;
        case "UNLOCKED":
          pushToast(s.toastLockOpened, "good");
          break;
        case "BOOSTER_ARMED":
          pushToast(s.toastBoosterArmed(s.boosterName(event.booster)), "good");
          break;
        case "BOOSTER_DISARMED":
          pushToast(s.toastBoosterCancelled(s.boosterName(event.booster)), "warn");
          break;
        case "BOOSTER_IMPACT":
          // Only Radius Overcharge has a screen shake (on request); Prism
          // Shot's own tell is the continuous rainbow overlay instead, keyed
          // straight off `armedBooster` further down rather than a one-shot
          // event like this.
          if (event.booster === "radiusOvercharge") setRadiusShakeBump((n) => n + 1);
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

  // Every level start/restart builds a fresh engine (`aimDragSensitivity`
  // resets to its own default of 1 in the constructor — see the effect that
  // builds `built` above), so the stored preference has to be re-applied on
  // every new one, not just once when the slider itself moves.
  useEffect(() => {
    engine?.setControlSensitivity({ aim: aimSensitivity });
  }, [engine, aimSensitivity]);

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

  // Opening the in-play Settings card is a pause menu now, not just an
  // overlay: the board underneath must not keep settling/animating while a
  // player is looking at Sound/Vibration or about to tap Home/Restart. Only
  // acts while `playing` — the hub's own gear opens the same card over
  // nothing worth pausing. Skips the `resume()` half while the tab itself is
  // still hidden, so this cannot undo the visibility effect's own pause.
  useEffect(() => {
    if (!engine || !playing) return;
    if (settingsOpen) engine.pause();
    else if (!document.hidden) engine.resume();
  }, [engine, playing, settingsOpen]);

  const restart = useCallback(() => {
    setState(createSandGameState(level));
    setToast(null);
    setArmedBooster(null);
    setRunId((id) => id + 1);
    setFreezeFtueStep(null);
    setBoosterFtueStep(null);
    setChainSortFtueStep(null);
  }, [level]);

  const goHome = useCallback(() => {
    // Back to a fresh board, not to the half-played one: the home screen shows
    // the picture as it was authored, and that is what "tap to play" promises.
    setState(createSandGameState(level));
    setToast(null);
    setArmedBooster(null);
    setRunId((id) => id + 1);
    setPlaying(false);
    // A Zen level's own "home" is the Zen picker, not the main hub — leaving
    // `playingZen`/`zenPickerOpen` alone (both already true at this point)
    // so the Modes tab reopens right back on the level list, not the
    // two-button screen. Only Modes tab's own nav tap (see `HUB_TABS.map`
    // below) resets `playingZen` — the actual "leave Zen Mode" action.
    setTab(playingZen ? "modes" : "home");
    // Both overlays are already gated on `playing` at the call site, so
    // leaving either `true` here could not leak onto the hub screen — this
    // is just so a level left mid-tutorial/mid-FTUE doesn't quietly resume
    // showing it the instant Play is tapped again, the way it would if a
    // player had actually dismissed it before leaving.
    setTutorialOpen(false);
    setFtueGestureOpen(false);
    setFreezeFtueStep(null);
    setBoosterFtueStep(null);
    setChainSortFtueStep(null);
  }, [level, playingZen]);

  const openLevel = useCallback((index: number) => {
    setChosenIndex(index);
    // Belt and braces alongside the `hub-nav` tap handler's own reset: any
    // path that opens a MAIN-list level must leave Zen Mode, or `raw`
    // (branched on `playingZen`) would keep reading the Zen list against a
    // main-list index.
    setPlayingZen(false);
    setState(createSandGameState(expandLevelForPixelBoard(playables[index].level)));
    setToast(null);
    setArmedBooster(null);
    setRunId((id) => id + 1);
  }, [playables]);

  /**
   * Zen Mode's own `openLevel` — picks from `zenPlayables` instead of the
   * main list, and starts play immediately rather than just previewing on
   * the home screen (`pickFromGallery`'s own two-step "pick, then tap Play"
   * does not exist here: the Zen picker IS the level list, so tapping a
   * level in it is the one and only action). Zen levels have no
   * tutorial/FTUE fields left on them (`toZenLevel` in zen-levels.ts strips
   * them) and no lock/unlock progression, so this skips every check
   * `startPlaying` runs for the main list — there is nothing here for any of
   * them to find.
   */
  const openZenLevel = useCallback((index: number) => {
    setZenLevelIndex(index);
    setPlayingZen(true);
    setState(createSandGameState(expandLevelForPixelBoard(zenPlayables[index].level)));
    setToast(null);
    setArmedBooster(null);
    setRunId((id) => id + 1);
    setPlaying(true);
  }, [zenPlayables]);

  /**
   * Every "a level is about to start being played" FTUE check, run against
   * whichever `SandLevelConfig` is ABOUT to load — never the render's own
   * `level`, which still describes whatever was on screen a moment ago.
   * This is what actually decides whether a first-time overlay shows; every
   * call site below just has to remember to call it with the right level.
   *
   * Extracted out of `startPlaying` (still one of its callers, a few
   * hundred lines down) after a report that reaching level 3 by tapping
   * Continue off level 2 never showed the booster tutorial — Continue calls
   * `openLevel` directly, which only ever touched board state, never any of
   * this. Home's Play tap is not the only door into a level: Continue (just
   * below) and the cannon-unlock reveal's own "advance after this" path
   * (right here) walk straight into the next one without ever passing back
   * through Home, so they need this exact same check, just handed the level
   * they are ABOUT to open instead of relying on a closure over whatever
   * render happened to be current.
   *
   * Reads and writes localStorage directly rather than through state: this
   * only ever runs from a click, never during render or an effect, so there
   * is no server-pass mismatch to guard against and nothing worth keeping in
   * React state for it.
   */
  const triggerLevelFtue = useCallback((lvl: SandLevelConfig) => {
    if (lvl.tutorial && !loadSeenTutorials().has(lvl.id)) {
      setTutorialOpen(true);
      markTutorialSeen(lvl.id);
    }
    if (lvl.ftueGesture) {
      setFtueGestureOpen(true);
    }
    // Level 31's freeze tutorial: marked seen the instant it starts, same as
    // `tutorial` above — the point is "never plays again on this browser",
    // not "played to completion", so backgrounding the tab mid-tutorial still
    // counts. `forcedOpeningQueue` (mint, mint, mint, grass) stays in force
    // on every future attempt regardless — that part is plain level config,
    // read fresh every time, nothing to do with this flag. Kicks off at
    // `"intro"`; the effect above and `advanceFreezeFtue` carry it the rest
    // of the way from there.
    if (lvl.ftueFreezeDemo && lvl.ftueFreezeTargets?.length
      && !loadSeenFreezeFtue().has(lvl.id)) {
      markFreezeFtueSeen(lvl.id);
      setFreezeFtueStep("intro");
    }
    // Level 3's booster tutorial: same "marked seen the instant it starts"
    // reasoning as the freeze one just above. `forcedBoosterCharges` (3
    // Radius Overcharge, 2 Prism Shot) stays in force on every future
    // attempt regardless, same as `forcedOpeningQueue` does for ammo.
    if (lvl.ftueBoosterDemo && lvl.ftueBoosterTargets && lvl.ftueBoosterTargets.length >= 2
      && !loadSeenBoosterFtue().has(lvl.id)) {
      markBoosterFtueSeen(lvl.id);
      setBoosterFtueStep("intro-radius");
    }
    // Level 5's Chain Sort tutorial: same "marked seen the instant it
    // starts" reasoning, sharing the same seen-set/key as the pair above —
    // it is keyed per level id, so level 3's and level 5's own FTUE never
    // collide. `forcedBoosterCharges` (1 Chain Sort) stays in force on every
    // future attempt regardless, same as `forcedOpeningQueue` does for ammo.
    if (lvl.ftueChainSortDemo && lvl.ftueChainSortTarget && !loadSeenBoosterFtue().has(lvl.id)) {
      markBoosterFtueSeen(lvl.id);
      setChainSortFtueStep("intro");
    }
  }, []);

  /** The reveal's own close — only reachable once `cannonUnlockTapReady`, so
   * a tap cannot skip past the name before the prompt inviting one exists.
   * Both triggers (`buySkin`, `unlockProgressionSkin`) fire from the Skin
   * screen now, so this just closes the banner — no level to advance into. */
  const dismissCannonUnlock = useCallback(() => {
    engine?.stopUnlockCelebration();
    setCannonUnlock(null);
  }, [engine]);

  /** Picking from the gallery shows that picture on the home screen, unplayed. */
  const pickFromGallery = useCallback((index: number) => {
    openLevel(index);
    setPlaying(false);
    setTab("home");
  }, [openLevel]);

  /**
   * GameDevOption's "jump to level" field — matched against each playable's
   * `level.id` (what the HUD and level name already show), not its array
   * index, since editor-shipped levels number from `BUILT_IN_LEVELS.length + 1`
   * (see `collectPlayables`) rather than from a plain position in the list.
   * Deliberately skips the unlock/progression check `pickFromGallery`'s own
   * gallery grid enforces (`hasClearedLevel`) — same "bypass, don't earn it"
   * spirit as every other row in GameDevOption. Does still run the freeze
   * FTUE (`startPlaying`'s own check, duplicated here) when it jumps to
   * level 31 unseen — on request, so testing that tutorial doesn't require
   * clearing 30 levels first. Reads `playables[index].level` directly rather
   * than this render's own `level`/`raw`: those still describe whatever
   * level was showing *before* this jump, since `openLevel` above only takes
   * effect on the next render.
   */
  const jumpToLevel = useCallback(() => {
    const wanted = Number(devLevelInput);
    if (!Number.isFinite(wanted)) return;
    const index = playables.findIndex((entry) => entry.level.id === wanted);
    if (index < 0) return;
    openLevel(index);
    setPlaying(true);
    setSettingsOpen(false);
    setDevLevelInput("");
    const jumped = expandLevelForPixelBoard(playables[index].level);
    if (jumped.ftueFreezeDemo && jumped.ftueFreezeTargets?.length && !loadSeenFreezeFtue().has(jumped.id)) {
      markFreezeFtueSeen(jumped.id);
      setFreezeFtueStep("intro");
    }
    if (jumped.ftueBoosterDemo && jumped.ftueBoosterTargets && jumped.ftueBoosterTargets.length >= 2
      && !loadSeenBoosterFtue().has(jumped.id)) {
      markBoosterFtueSeen(jumped.id);
      setBoosterFtueStep("intro-radius");
    }
    if (jumped.ftueChainSortDemo && jumped.ftueChainSortTarget && !loadSeenBoosterFtue().has(jumped.id)) {
      markBoosterFtueSeen(jumped.id);
      setChainSortFtueStep("intro");
    }
  }, [devLevelInput, playables, openLevel]);

  /**
   * GameDevOption's "reset entire game" button — every piece of persisted
   * player progress (wallet, first-clears, the daily-login streak, the
   * reward track, owned/equipped skins) back to a brand-new install, plus
   * the dev date-offset tool below so a full reset does not leave "today"
   * quietly nudged. Reloads immediately after rather than trying to patch
   * every already-rendered piece of state by hand — several of these
   * (`cachedInitialDailyLogin`, `cachedInitialDailyCalendar`, the reward
   * track's cached snapshot, the wallet cache) are only ever read fresh once
   * per page load, the same reasoning `applyDevDateOffset` below relies on.
   */
  const resetEntireGame = useCallback(() => {
    resetWallet();
    resetClearedLevels();
    resetDailyLogin();
    resetRewardTrack();
    resetOwnedCostumes();
    resetHearts();
    setDevDateOffsetDays(0);
    try {
      window.localStorage.removeItem(TUTORIALS_SEEN_KEY);
      window.localStorage.removeItem(FREEZE_FTUE_SEEN_KEY);
      window.localStorage.removeItem(BOOSTER_FTUE_SEEN_KEY);
      window.localStorage.removeItem(BOOSTER_SHOP_HINT_KEY);
      // So "reset entire game" really does put a tester back at a brand-new
      // install, auto-play-into-Level-1 included, rather than every other
      // first-time flag clearing except this one.
      window.localStorage.removeItem(FIRST_OPEN_SEEN_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
    window.location.reload();
  }, []);

  /**
   * GameDevOption's date tool — persists the typed day offset
   * (`setDevDateOffsetDays`) and reloads, so `devNow()` picks it up
   * everywhere it is read from a fresh module load (`cachedInitialDailyLogin`
   * included) rather than just in whatever React state happens to be open
   * right now. Testing a streak is then: nudge +1, reload, claim, repeat —
   * or jump straight past several days to check the streak actually breaks.
   */
  const applyDevDateOffset = useCallback(() => {
    const days = Number(devDateOffsetInput);
    if (!Number.isFinite(days)) return;
    setDevDateOffsetDays(Math.trunc(days));
    window.location.reload();
  }, [devDateOffsetInput]);

  /**
   * Captured as soon as the engine exists, not gated on the Skin screen ever
   * having been opened — cheap (an off-screen render target the engine's own
   * renderer draws into and restores from, cached forever by
   * `getCostumeThumbnails` in costumes.ts, so a second call anywhere just
   * hands back the same object) and needed by more than the skin picker's
   * tray now: the Gallery's level-20/40 cards show a costume's real
   * thumbnail on their unlock badge (`unlocksCostume` below) and must never
   * fall back to the plain `CostumeIcon` line art just because the player
   * has not looked at Skin yet.
   */
  useEffect(() => {
    if (!engine) return;
    setCostumeThumbnails(engine.captureCostumeThumbnails());
  }, [engine]);

  /**
   * The skin screen's whole life: entered the moment `tab` becomes "skin",
   * left the moment it becomes anything else (the close button, Home, or the
   * back-swipe every other hub tab already goes through `setTab` for).
   *
   * Opens on whatever is actually equipped (never a stale preview from a
   * previous visit) and asks the engine to turn its full-screen showroom on
   * — rig front and centre, turning, firing demo shots. Closing reverts the
   * live rig to whatever is actually equipped (`equippedCostumeRef`, not the
   * possibly-stale `costume` this effect closed over) and turns the showroom
   * back off, so a preview that was never confirmed with Select never leaks
   * into real play.
   */
  useEffect(() => {
    if (tab !== "skin" || !engine) return;
    setPreviewCostume(equippedCostumeRef.current);
    engine.setCostume(equippedCostumeRef.current);
    engine.setShowcase(true);
    return () => {
      engine.setCostume(equippedCostumeRef.current);
      engine.setShowcase(false);
    };
    // Intentionally not keyed on `costume` — see the doc comment above.
  }, [tab, engine]);

  /** A thumbnail tap: swaps the live rig so the showroom shows that skin, but
   * does not save anything — only the Select button does that. Also dismisses
   * that card's afford-notification dot, if it is wearing one — a look is
   * enough to acknowledge it, buying is not required (see
   * `unseenAffordableSkins`'s own comment on what that dot means). */
  const previewCostumeCard = useCallback((id: CostumeId) => {
    setPreviewCostume(id);
    engine?.setCostume(id);
    markSkinBadgeSeen(id);
  }, [engine]);

  /** The Select button: saves whatever the showroom is currently previewing. */
  const selectCostume = useCallback(() => {
    setSelectedCostume(previewCostume);
    setCostume(previewCostume);
    // Plays the button's own left-to-right sweep exactly once, for this tap
    // only — cleared by `onAnimationEnd` below, never re-added on mount, so a
    // skin that was already equipped never replays it just by opening the
    // picker back up.
    setJustEquippedPulse(true);
  }, [previewCostume]);

  /**
   * The home screen's Play tap. Enters play, and — the first time this level
   * is opened, ever, on this browser — opens its FTUE overlay on top of the
   * fresh board rather than letting the player's first shot be a guess.
   */
  const startPlaying = useCallback(() => {
    setPlaying(true);
    triggerLevelFtue(level);
  }, [level, triggerLevelFtue]);

  /**
   * The very first open of the game on this browser: skips the Home
   * screen's "tap Play" step and starts Level 1 immediately, exactly as if
   * Play had just been tapped (`startPlaying` — its own `tutorial` overlay
   * check fires right along with it, since level 1 is unseen too) — on
   * request: "Khi người mở game ra lần đầu tiên, lập tức chơi level 1 luôn".
   *
   * `useLayoutEffect`, not `useEffect`: fires before the browser paints the
   * very first frame, so a first-time player never actually sees the Home
   * screen flash up before play starts — `playing` flips before anything
   * hits the screen. Guarded on `hasOpenedBefore()` alone (not also
   * `chosenIndex`/`levelIndex`): this only ever needs to run once, the very
   * first time this effect body executes on a browser that has never set
   * the flag, and `markOpened()` makes every subsequent run everywhere
   * (including this same mount under Strict Mode's double-invoke) a no-op.
   * Left out of the dependency array on purpose — it must run exactly once
   * at mount, against whatever `level`/`startPlaying` happen to close over
   * right then (level 1, on a fresh load with no `?level=` override), not
   * re-fire every time either identity changes afterward.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (hasOpenedBefore()) return;
    markOpened();
    startPlaying();
  }, []);

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
   * (`state.result !== lastHandledResult`) makes the whole block, side
   * effects included, run at most once per actual result transition — a
   * fresh WIN/FAIL object the engine publishes, not a re-render for an
   * unrelated reason — so `markLevelCleared`'s own idempotency is a second
   * line of defence rather than the only one. `restart`/`goHome`/`openLevel`
   * do not need to reset this themselves: they all reset `state.result` to
   * `null` via a fresh `createSandGameState`, which this guard already reads
   * as a change.
   *
   * The gold itself is granted right here, immediately — `addGold` never
   * waits on anything UI-side. What DOES wait is the badge: `pendingHomeReward`
   * (own comment above) picks up the amount and `suppressGoldSyncRef` holds
   * `displayGold` back, so the WIN screen's own fly-to-badge effect has real
   * ground left to visibly cover once the player actually reaches Home,
   * whether that is right after this level or several Continues later.
   */
  const [lastHandledResult, setLastHandledResult] = useState<SandGameState["result"]>(null);
  // The gold amount the WIN card's own body shows — the actual amount just
  // credited to the wallet by the block below, not the level's payout in the
  // abstract, so a replay (no new gold, `markLevelCleared` already false)
  // correctly shows 0 rather than re-claiming the same number.
  const [wonGold, setWonGold] = useState(0);
  // A skin this exact WIN just made eligible (`costumeUnlockedByLevel`),
  // waiting on the "Frame cleared" card's own Continue tap before
  // `skinTryPrompt` (below) asks whether to go try it — ownership itself is
  // NOT granted yet at this point, only `hasClearedLevel` for its own
  // `unlockLevel` (which is what actually flips the Skin screen's card from
  // "Progression" to a live "Unlock" button).
  const [pendingLevelUnlock, setPendingLevelUnlock] = useState<CostumeId | null>(null);
  // The "you unlocked X — want to try it now?" prompt that now sits between
  // Continue and the actual reveal (on request — the old flow auto-equipped
  // and celebrated with no way to decline). "Equip" sends the player to the
  // Skin screen to finish the unlock themselves (`unlockProgressionSkin`);
  // "No" just continues on, leaving the skin earned-but-not-yet-unlocked.
  const [skinTryPrompt, setSkinTryPrompt] = useState<CostumeId | null>(null);
  if (state.result !== lastHandledResult) {
    // Zen Mode pays nothing at all — no gold, no reward-track credit
    // (`recordLevelPlayed`), no first-clear bookkeeping (`markLevelCleared`),
    // no skin unlock. It is a replay-forever space with no fail state, not a
    // second way to earn the same currencies the main list is carefully
    // tuned around (§10, GDD.md) — see zen-levels.ts's own header. `wonGold`
    // stays 0 so the WIN card's gold line (gated on `!playingZen` there)
    // simply never renders for a Zen clear.
    if (!playingZen) {
      // The reward track counts every win, replays included — unlike the gold
      // above, which pays first-clears only. See the reward-track section header
      // in `economy.ts` for why the two differ.
      if (state.result?.kind === "WIN") recordLevelPlayed();
      if (state.result?.kind === "WIN" && markLevelCleared(raw.id)) {
        // The level's own reward (CSV override or the difficulty formula) plus
        // a decade-milestone bonus (`levelMilestoneBonus`, 0 for every level
        // that is not 10/20/30/40/50) — both first-clear-only, both paid the
        // same beat.
        const granted =
          (getLevelRewardOverride(raw.id) ?? levelGoldReward(computeLevelDifficulty(raw).score)) +
          levelMilestoneBonus(raw.id);
        addGold(granted);
        suppressGoldSyncRef.current = true;
        setPendingHomeReward((sum) => sum + granted);
        setWonGold(granted);
        // A progression skin tied to this level (`hero-cannon`/level 20 today)
        // is NOT granted yet here — only the "you're eligible" flag is (this
        // level's own `hasClearedLevel` just went true, which is all
        // `previewUnlockRequirementMet` needs). Ownership itself only happens
        // once the player actually taps Unlock on the Skin screen
        // (`unlockProgressionSkin`), on request: the old flow auto-equipped
        // and celebrated immediately on Continue, with no way to say "not
        // now" — see `skinTryPrompt` for the prompt that replaces it.
        const unlockedCostume = costumeUnlockedByLevel(raw.id);
        if (unlockedCostume && !isCostumeOwned(unlockedCostume)) {
          setPendingLevelUnlock(unlockedCostume);
        }
        // Hearts unlock right here, on the very win that clears level
        // `HEARTS_UNLOCK_LEVEL_ID` for the first time — `heartsUnlockedOverride`
        // is what lets the HUD chip appear THIS load instead of only after a
        // reload (`initialHeartsUnlocked`, the module-cached read, is only
        // ever checked once per page load — see its own comment).
        if (raw.id === HEARTS_UNLOCK_LEVEL_ID) setHeartsUnlockedOverride(true);
      } else if (state.result?.kind === "WIN") {
        setWonGold(0);
      }
    } else if (state.result?.kind === "WIN") {
      setWonGold(0);
    }
    setLastHandledResult(state.result);
  }

  /**
   * Holds the "Frame cleared" card (and the rest of the in-play HUD) off
   * screen for `WIN_REVEAL_HOLD_MS` after a WIN, so the engine's own
   * `playWinReveal` — the picture's full turn plus the moderate saturation
   * boost, both started the instant the engine itself detects WIN, well
   * before this effect even runs — has room to play out and the finished
   * picture gets a beat to sit before the card interrupts it. Keyed on
   * `state.result` itself (a fresh object per win, see `lastHandledResult`'s
   * own comment) rather than `lastHandledResult`, so this effect's cleanup
   * — clearing a still-pending timer — runs on every result change, not just
   * the ones this component happened to still be mounted to finish.
   */
  const [winReveal, setWinReveal] = useState(false);
  useEffect(() => {
    if (state.result?.kind !== "WIN") {
      setWinReveal(false);
      return;
    }
    setWinReveal(true);
    const timer = window.setTimeout(() => setWinReveal(false), WIN_REVEAL_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [state.result]);

  const remaining = ammoRemaining(level, state);
  // `ammoRemaining` returns `Infinity` for a `shotLimit: Infinity` level (see
  // its own doc comment) — rendered as "∞" rather than the literal word
  // "Infinity" a plain template string would otherwise produce.
  const remainingLabel = Number.isFinite(remaining) ? String(remaining) : "∞";
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
  // Gated on `state.shotsUsed`, not on whether the colours actually differ:
  // a single-colour level (Level 1's whole ammo queue is just "blue") shifts
  // the queue on every shot without a single pixel of `loadedAmmo`/
  // `upcomingAmmo` ever changing, and a content diff would call that "nothing
  // happened" forever, silently skipping the slide replay for that level's
  // entire run. `shotsUsed` advances once per shot resolved (`spend` in
  // sand-rules.ts) regardless of colour, so it is the one signal that always
  // means "the queue actually moved". Held off while `busy` for the same
  // reason `loadedAmmo` is: `state.shotsUsed` ticks the instant a shot
  // resolves, before the settle it triggered has finished playing, and
  // replaying the animation that early would desync it from the dot/strip
  // (which are still showing the pre-shot values at that point).
  const ammoChanged = !busy && state.shotsUsed !== ammoAnim.shotsUsed;
  if (ammoChanged) {
    setAmmoAnim({ color: loadedAmmo, upcoming: upcomingAmmo, bump: ammoAnim.bump + 1, shotsUsed: state.shotsUsed });
  }
  // Measured against the sand this level actually started with, not the area of
  // the frame. A picture that does not fill its frame — which an editor level
  // need not — would otherwise open at "69% cleared" before a shot was fired.
  // The key is not sand — it is never cleared and never counted, so counting it
  // here would open every lock level at "4% cleared" before a shot was fired.
  // A Wall Obstacle cell is the same story: never sand, never cleared, so a
  // walled level would open already "cleared" by however much wall it drew.
  const startingCells = useMemo(
    () => level.rows.reduce(
      (total, row) => total + [...row].filter((letter) => letter !== "." && letter !== KEY_LETTER && letter !== WALL_LETTER).length,
      0,
    ),
    [level],
  );
  const cleared = startingCells === 0
    ? 100
    : Math.round(((startingCells - state.remainingCells) / startingCells) * 100);

  // The Shop confirm dialog's own numbers — computed here rather than inside
  // its JSX so `buyConfirm`'s null case (dialog closed) stays a single guard
  // at the render site instead of leaking into every value it needs.
  // `buyQtyCap` is 99 unless the wallet cannot even afford that many: the
  // stepper's "+" button (see its `disabled` prop below) never lets a player
  // dial past what `wallet.gold` could actually cover.
  // The previewed skin's own lock state, pulled out of the JSX because the
  // heading, the main button and the confirm dialog all need the same two
  // answers. Recomputed every render on purpose: `isCostumeOwned` is a cached
  // localStorage read, and `buySkin` writing it has to show up immediately in
  // all three places at once.
  const previewOwned = isCostumeOwned(previewCostume);
  const previewPrice = costumePrice(previewCostume);
  // Set only for a `unlockLevel` skin — `previewPrice` above is meaningless
  // for one of these (always the unused 0, see `CostumeDef.unlockLevel`'s own
  // comment), so every place that would otherwise show `previewPrice` checks
  // this first instead.
  const previewUnlockLevel = COSTUMES[previewCostume].unlockLevel;
  // Whether a `unlockLevel` skin's own level has actually been cleared yet —
  // the line between the disabled "Progression" label (not earned yet) and a
  // live "Unlock" button (earned, just waiting on the player's own tap). A
  // plain `hasClearedLevel` read, same as `previewOwned`/`previewPrice`
  // above: recomputed every render so `unlockProgressionSkin` writing it
  // shows up immediately everywhere this is read.
  const previewUnlockRequirementMet = previewUnlockLevel !== undefined && hasClearedLevel(previewUnlockLevel);
  // Every skin the wallet's current Blue Emerald covers, is not yet owned,
  // and has not already had its dot dismissed (`markSkinBadgeSeen`) — drives
  // both the Skin tab's own dot (non-empty) and which card(s) in the picker
  // wear one. Recomputed every render for the same reason `previewOwned`
  // above is: a purchase or a dismiss has to show up immediately, not on the
  // next unrelated re-render.
  const unseenSkins = unseenAffordableSkins(wallet.emeralds);
  const buyConfirmPrice = buyConfirm ? boosterPrice(buyConfirm) : 0;
  const buyQtyCap = buyConfirmPrice > 0 ? Math.min(99, Math.floor(wallet.gold / buyConfirmPrice)) : 99;

  // The WIN screen's own "Continue" button needs to know whether there is
  // anywhere to continue TO — the last playable gets no Continue, only the
  // close button (see the result screen below). Zen Mode never chains into
  // "the next one" automatically (there is no ordering to a Zen list the way
  // there is a difficulty curve to the main one) — a Zen win always shows
  // just the close button, back to the Zen picker.
  const hasNextLevel = !playingZen && levelIndex + 1 < playables.length;

  /** Shop's Special Offers, minus any offer that sells hearts while hearts
   * are still locked (level 10 not cleared yet) — see the Shop JSX's own
   * comment on request: "nếu chưa có heart currency thì không hiện những
   * bundle, hay shop heart trong shop". */
  const visibleOffers = heartsUnlocked ? SPECIAL_OFFERS : SPECIAL_OFFERS.filter((offer) => offer.hearts == null);

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
        className={`game-frame${homeVisible ? " is-hub" : ""}${tab === "skin" ? ` is-skin-${COSTUMES[previewCostume].flavor}` : ""}${chest ? " is-chest" : ""}`}
        style={playing && loadedAmmo ? ({ "--ammo-bg": ammoSky(loadedAmmo, raw?.customPalette) } as React.CSSProperties) : undefined}
      >
        {/* A shot that did nothing (no colour in range, hit the frame,
            missed outright) used to explain itself with a text toast — now
            it's a quick light-red vignette instead: transparent over the
            picture itself, reddening toward the background and the frame's
            own border, on request (see `missFlashBump`'s own comment).
            Direct child of `.game-frame` itself, NOT nested inside
            `.scene-wrap` (moved out on request: "tràn toàn rìa màn hình
            luôn chứ không phải dừng lại trước UI số đạn hay setting") —
            `.scene-wrap` is inset below the top HUD bar and clips its own
            overflow, so a vignette living inside it could never physically
            reach the ammo badge/Settings gear's corner no matter its own
            `inset`/z-index. Living at this level instead, with a z-index
            above both `.hud-top-left` (31) and `.settings-wrap` (32), the
            same `inset: 0` genuinely covers the whole visible frame edge to
            edge, HUD included. Keyed on the bump so back-to-back misses
            each replay the fade from scratch rather than the second one
            being a no-op class change mid-animation. */}
        {missFlashBump > 0 && !winReveal && (
          <div key={missFlashBump} className="miss-flash" aria-hidden="true" />
        )}

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
        <div className="hud-top-left" ref={hudAmmoClusterRef}>
          <header className="hud-top" hidden={!playing || winReveal}>
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
              className="shots-badge"
              role="status"
              aria-label={
                loadedAmmo
                  ? s.shotsLeftWithNext(
                      remainingLabel,
                      s.colorName(loadedAmmo),
                      upcomingAmmo.map((color) => s.colorName(color)).join(", ") || s.nothing,
                    )
                  : s.shotsLeftOnly(remainingLabel)
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
                style={loadedAmmo ? { background: hex(loadedAmmo, raw?.customPalette) } : undefined}
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
                      style={{ background: hex(color, raw?.customPalette) }}
                    />
                  ))}
                </span>
              )}
              <strong>{remainingLabel}</strong>
            </div>

            {/* The Freeze Map bar: in the same row as the shot count because
                it answers the same kind of question ("what do I have to
                work with right now") the ammo badge does. Counted in shots,
                not real time — `state.freezeShotsRemaining` is read straight
                off engine state like everything else in this HUD, no local
                clock of its own. One segment per shot of
                `level.freezeDuration`; the leftmost `freezeShotsRemaining` of
                them are lit, so the lit run visibly shrinks from the right
                as shots land, same "drains right to left" read as before.
                Same overall shape as the ammo badge, and the same 44px
                height as the settings gear (on request). No more art on it
                (on request, "bỏ freeze bar icon") — a plain light-blue tray
                (`.freeze-cooldown-bar`'s own background) instead, with the
                word FREEZE printed over the segments (`.freeze-cooldown-
                label`) so the bar reads on its own without the art. */}
            {state.freezeShotsRemaining > 0 && (
              <div
                className="freeze-cooldown-bar"
                role="status"
                aria-label={s.freezeCooldown(state.freezeShotsRemaining)}
              >
                {Array.from({ length: level.freezeDuration ?? DEFAULT_FREEZE_DURATION }, (_, index) => (
                  <span
                    key={index}
                    className={`freeze-cooldown-segment${index < state.freezeShotsRemaining ? " is-lit" : ""}`}
                  />
                ))}
                <span className="freeze-cooldown-label">{s.freezeLabel}</span>
              </div>
            )}
          </header>
        </div>

        {/* Same top-right corner and the same gear either way now. The old
            mid-play menu (level grid, Home/Restart/Settings rows behind a
            hamburger) is gone: the gear now opens the one unified Settings
            card directly, same as the hub, and `.settings-round-actions`
            inside that card is what covers Home/Restart while a level is
            open (see its own comment). Shown on every hub tab, Skin included
            now — none of the full-screen takeovers (Skin, Shop, Gallery)
            have a close button of their own, so this gear is the one
            settings entry point that has to stay reachable no matter which
            one is open. The reward chest is the one exception: it is a short
            animation that ends in a Collect button, not a screen a player
            can get stuck on, and a gear floating over it would be the only
            thing on that frame besides the chest.

            Also withheld for the entire duration of playing levels 1-3, the
            FIRST time through only (on request: the flip side of
            `onboardingLockLifted`'s own onboarding lock, see its own doc
            comment for why this isn't just `raw.id >= WIN_CLOSE_BUTTON_FROM_LEVEL_ID`
            any more) — `!playing` keeps it showing on every hub tab as
            before (Home, Shop, Gallery, Skin, Modes never lose it, only
            actual gameplay on one of the three onboarding levels does), and
            it is back the instant level 4 starts OR the walkthrough has
            already been completed once before (a Gallery replay of level
            1-3 shows it same as any other level). Same reasoning as the WIN
            card's own close button: nothing to escape TO mid-onboarding that
            the gear's own Home/Restart rows would offer beyond the level's
            own Continue/Play-again flow. */}
        {!chest && !cannonUnlock && !winReveal && (!playing || onboardingLockLifted) && (
          <div className="settings-wrap" ref={hudSettingsRef}>
            <button
              type="button"
              className="icon-button settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label={s.settingsTitle}
              title={s.settingsTitle}
            >
              <img className="settings-button-icon" src="/icons/SettingIcon.png" alt="" aria-hidden="true" />
            </button>
          </div>
        )}

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
            tomorrow's reward is not up yet).
            Home only now, not every hub tab: Shop and Gallery are full-bleed
            takeovers of the same right-edge real estate this button floats
            over (`.shop-screen`/`.gallery-screen`), so it covered their own
            grid; Skin and Modes dropped it on request, to keep those two
            screens free of anything that is not about the thing they are
            showing. Also hidden the instant the daily-login card itself is
            open (`dailyLogin` below) — a button that opens a card it is
            currently sitting behind would just be dead chrome until the
            card closes. */}
        {!playing && !chest && !cannonUnlock && tab === "home" && !dailyLogin && (
          <div className="hub-gift-wrap">
            <button
              type="button"
              className="icon-button gift-button"
              onClick={() => setDailyLoginOverride(getDailyLoginState(devNow()))}
              aria-label={`${s.dailyLoginAria}${dailyLoginMissedClaim ? s.homeTabHasDailyLoginHintSuffix : ""}`}
              title={s.dailyLoginAria}
            >
              <img className="gift-button-icon" src="/icons/LoginIcon.png" alt="" aria-hidden="true" />
              {/* Same trigger as the hub-nav's own dot on the Home tab (see
                  `dailyLoginMissedClaim`'s doc comment) — this is the button
                  that dot is actually pointing at, so it gets one too. */}
              {dailyLoginMissedClaim && <span className="gift-button-dot" aria-hidden="true" />}
            </button>
          </div>
        )}

        {/* The hub's persistent gold balance — also a shortcut to buying more
            (`openCoinPacks`, its own comment above) and the landing target
            for the daily-login claim's flying coins
            (`claimDailyLoginWithFlight` above), which is why the pill itself
            needs a stable ref rather than living inside the Shop screen
            (only mounted on the Shop tab). The coin art sits half outside
            the pill on purpose — a big coin overlapping the chip's own edge,
            not a small icon tucked inside it, per the reference layout. */}
        {!playing && !chest && !cannonUnlock && (
          <div className="hub-currency-row">
            <button
              type="button"
              key={goldBump}
              className="hub-gold-wrap"
              onClick={openCoinPacks}
              aria-label={s.coinsAria(displayGold)}
            >
              <CoinIcon />
              <span className="hub-gold-badge" ref={goldHudRef}>
                <strong key={goldBump}>{displayGold}</strong>
                <span className="hub-gold-plus" aria-hidden="true">
                  <PlusIcon />
                </span>
              </span>
            </button>

            {/* Blue Emerald, in the same row as gold and built to the same
                shape (a big stone overlapping a stadium pill), with the two
                differences that carry the whole distinction: a pale blue pill
                instead of gold's pale yellow, and no plus mark. Not a button
                either, for the same reason there is no plus — emerald has
                exactly one source (the reward track) and cannot be bought, so
                there is nowhere for a tap to go. A real flex row rather than a
                second fixed inset: gold's pill grows with its digit count, and
                only a row keeps the two flush as it does. */}
            <div className="hub-emerald-wrap" role="status" aria-label={s.emeraldAria(wallet.emeralds)}>
              <EmeraldIcon />
              <span className="hub-emerald-badge">
                <strong>{wallet.emeralds}</strong>
              </span>
            </div>

            {/* Hearts — same overlap silhouette gold/emerald both use (the
                icon overlaps a pill's rounded end-cap, per the ask: "phải
                đồng nhất... icon đè lên cái tray"), but the COUNT itself
                sits ON the icon as its own small badge (on request: "số
                lượng icon sẽ nằm trên icon HeartIcon luôn"), not inside the
                pill the way gold/emerald's numbers are. Bare `m:ss` in that
                pill when the tank is short a heart, no "+1 in"/"+1 sau"
                wording (on request: "bỏ chữ in đi, countdown thôi") —
                `formatHeartCountdown` straight, not wrapped in an i18n
                sentence any more. Only rendered once unlocked (level 10
                cleared — `heartsUnlocked`).
                Now a real `<button>` (`openHeartPacks`), same shortcut shape
                as `.hub-gold-wrap`: tapping it jumps to the Shop's "buy
                Hearts directly" section. The pill itself is always shown
                now — not just while short a heart — since it is what holds
                the green plus mark (`.hub-heart-plus`, the same `PlusIcon`
                artwork `.hub-gold-plus` uses), on request: "thêm icon dấu
                cộng nền xanh lá vào heart currency, giống như coin
                currency". A full tank still shows no countdown text, just
                the plus, rather than an empty pill. */}
            {heartsUnlocked && (
              <button
                type="button"
                className="hub-heart-wrap"
                onClick={openHeartPacks}
                aria-label={s.heartsAria(hearts.hearts, MAX_HEARTS)}
              >
                <span className="hub-heart-icon-wrap">
                  <HeartIcon />
                  <strong className="hub-heart-count">{hearts.hearts}</strong>
                </span>
                <span className="hub-heart-badge">
                  {hearts.msUntilNext !== null && <small>{formatHeartCountdown(hearts.msUntilNext)}</small>}
                  <span className="hub-heart-plus" aria-hidden="true">
                    <PlusIcon />
                  </span>
                </span>
              </button>
            )}
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

          {/* Prism Shot's own tell (on request — the rainbow background/HUD
              stripe treatment tried before this was pulled back in favour of
              something simpler): confetti falling over the scene while the
              booster is armed. `PRISM_CONFETTI` is a fixed, module-level
              layout (not `Math.random()` at render time), same reasoning as
              `FREEZE_SNOWFLAKES` just below — server and client agree on it,
              and it never reshuffles itself on a re-render. */}
          {armedBooster === "prismShot" && (
            <div className="prism-confetti" aria-hidden="true">
              {PRISM_CONFETTI.map((piece, index) => (
                <span
                  key={index}
                  className="prism-confetti-piece"
                  style={{
                    left: `${piece.left}%`,
                    width: `${piece.size}px`,
                    height: `${piece.size}px`,
                    background: piece.color,
                    animationDuration: `${piece.duration}s`,
                    animationDelay: `${piece.delay}s`,
                    "--drift": `${piece.drift}px`,
                  } as React.CSSProperties}
                />
              ))}
            </div>
          )}

          {/* Freeze Map's ambient tell (on request): while the board is
              frozen, snow drifts down over the whole scene, not just the
              HUD bar — a background effect rather than a state announced
              only in one corner. `aria-hidden` + `pointer-events: none`
              throughout (see `.freeze-snowfall` in globals.css): purely
              decorative, must never intercept the aim drag underneath.
              `FREEZE_SNOWFLAKES` is a fixed, module-level layout (not
              `Math.random()` at render time) so server and client agree on
              it and it never reshuffles itself on a re-render. */}
          {state.freezeShotsRemaining > 0 && (
            <div className="freeze-snowfall" aria-hidden="true">
              {FREEZE_SNOWFLAKES.map((flake, index) => (
                <span
                  key={index}
                  className="freeze-snowflake"
                  style={{
                    left: `${flake.left}%`,
                    width: `${flake.size}px`,
                    height: `${flake.size}px`,
                    opacity: flake.opacity,
                    animationDuration: `${flake.fallDuration}s, ${flake.driftDuration}s`,
                    animationDelay: `${flake.fallDelay}s, ${flake.driftDelay}s`,
                  }}
                />
              ))}
            </div>
          )}

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
              No enclosing card: a dashed circular track (`.ftue-gesture-path`,
              the same dashed marker language `.aim-joystick::after` already
              draws on the real pad, borrowed rather than invented) with the
              real reference tapping-hand artwork
              (`/public/icons/FTUEicon.png`, an SVG `<image>`) swinging all the
              way around it — press at the first ring, arc around the track,
              release at the second. A curved sweep reads unambiguously as
              "drag any direction from here", where the old straight
              corner-to-corner glide could be misread as "this exact diagonal
              is the one that works". The image sits inside the same `<g>`
              `ftue-gesture-drag` (in globals.css) already animates, offset so
              the fingertip in the artwork — not the image's own top-left
              corner — lands on that `<g>`'s local origin, the same
              "fingertip at (0,0)" contract the old hand-drawn shapes used. */}
          {playing && ftueGestureOpen && level.ftueGesture && (
            <div className="ftue-gesture" role="status" aria-label={s.dragToAim}>
              <svg className="ftue-gesture-glyph" viewBox="0 0 220 190" aria-hidden="true">
                <circle className="ftue-gesture-path" cx="115" cy="120" r="42" />
                <circle className="ftue-gesture-ring ftue-gesture-ring-a" cx="157" cy="120" r="17" />
                <circle className="ftue-gesture-ring ftue-gesture-ring-b" cx="136" cy="84" r="17" />
                <g className="ftue-gesture-hand">
                  <image href="/icons/FTUEicon.png" x={-33} y={-69} width={72} height={83} />
                </g>
              </svg>
              <span className="ftue-gesture-caption">{s.dragToAimCaption}</span>
            </div>
          )}

          {/* One HUD tray in the band between the picture and the cannon
              (see the comment on .scene-wrap), both booster buttons inside
              it rather than loose on the sides. No text (spec §6) — the icon
              alone, reusing the aim ring's and the chamber overlay's own
              visual language so a player who has seen either in play
              recognises the button. Tapping the already-armed booster's own
              button cancels it (`armBooster` toggles), so its button stays
              enabled while armed; disabled only while the *other* booster is
              armed instead (no swap mid-arm), while input is locked (`busy`,
              §21), or while the wallet is out of that booster's charges —
              `armBooster` is a no-op in every one of those cases regardless
              (the engine's own guard reads the same wallet via
              `getBoosterCharges`), but a button that visibly cannot respond
              is the whole point of §3.
              Conditionally rendered on `playing` rather than `hidden`: this
              tray has no business appearing over the hub (a report said it
              was), and dropping the DOM node entirely mid-play leaves no
              CSS cascade edge case that could make it visible there again —
              `.scene-wrap` around it stays mounted either way (§ its own
              comment — the 3D scene is the hub's own artwork too, never
              torn down), only this tray comes and goes with `playing`.
              The tray itself always mounts on `playing` now (on request) —
              levels 1-2 (`ftueGesture`/`hideBoosterHud`) used to hide the
              whole bar; they now show the same empty dock instead (no
              buttons inside, via `showBoosterButtons` below), so the
              HUD's overall layout stays identical from level 1 onward
              rather than the scene reflowing the moment boosters unlock. */}
          {playing && !winReveal && (
            <div className="booster-hud">
              {/* The tray's own gold balance — read-only (no "buy more" tap
                  target the way `.hub-gold-wrap` is), pinned to the tray's
                  own top-left corner on request ("Góc trái bên cùng của tray
                  sẽ hiện coin currency hud") so a player who runs a booster
                  out mid-match can see whether they can afford the "buy 1
                  now" price right next to it, without leaving the level. */}
              {showBoosterButtons && (
                <div className="booster-hud-gold" role="status" aria-label={s.boosterTrayGoldAria(wallet.gold)}>
                  <CoinIcon />
                  <strong>{wallet.gold}</strong>
                </div>
              )}
              {(() => {
                if (!showBoosterButtons) return null;
                // Chain Sort withheld until level 5 — its own tutorial level
                // (`CHAIN_SORT_UNLOCK_LEVEL_ID`'s own comment) — not just
                // during level 3's Radius/Prism tutorial. A third,
                // unexplained control sitting in the tray for two levels
                // after the pair it arrived alongside were taught would just
                // be a distraction; level 5 itself still shows it (`>=`),
                // since its own tutorial has to spotlight a real button.
                return (["radiusOvercharge", "prismShot", "chainSort"] as const)
                  .filter((type) => type !== "chainSort" || level.id >= CHAIN_SORT_UNLOCK_LEVEL_ID)
                  .map((type) => {
                // A level with `forcedBoosterCharges` (level 3's booster
                // tutorial) reads its own level-scoped count instead of the
                // real wallet — see `SandGameState.boosterChargesOverride`'s
                // own doc comment. Absent for every other level, which falls
                // straight back to the wallet exactly as before.
                const overrideCharges = state.boosterChargesOverride?.[type];
                const charges = overrideCharges ?? wallet.boosters[type];
                // Out of charges mid-match, on a level that isn't forcing its
                // own scripted count (a forced-charges level, e.g. an FTUE
                // demo, has nothing to buy — the whole point is a guaranteed
                // free try): the button becomes a one-tap "buy 1 now" instead
                // of disabling outright, so running dry never has to send the
                // player all the way out to the Shop mid-run.
                const canBuyHere = overrideCharges === undefined && charges <= 0;
                const price = boosterPrice(type);
                return (
                  <button
                    key={type}
                    type="button"
                    data-booster={type}
                    className={`booster-btn is-${type === "radiusOvercharge" ? "radius" : "prism"}${armedBooster === type ? " is-armed" : ""}${canBuyHere ? " is-buy" : ""}`}
                    onClick={() => {
                      if (canBuyHere) {
                        const owned = wallet.boosters[type];
                        if (buyBoosterCharges(type, 1)) {
                          pushToast(s.toastBoughtBooster(s.boosterName(type), 1, owned + 1), "good");
                        } else {
                          pushToast(s.toastNotEnoughCoins, "warn");
                        }
                        return;
                      }
                      engine?.armBooster(type);
                    }}
                    disabled={canBuyHere ? busy : (busy || charges <= 0 || (armedBooster !== null && armedBooster !== type))}
                    aria-label={canBuyHere ? s.boosterBuyAria(s.boosterName(type), price) : s.boosterAria(s.boosterName(type), charges)}
                    aria-pressed={armedBooster === type}
                    title={canBuyHere ? s.boosterBuyAria(s.boosterName(type), price) : s.boosterAria(s.boosterName(type), charges)}
                  >
                    <BoosterIcon type={type} />
                    {/* Spec §4's reserved charge-count badge, now shown for real
                        (see `economy.ts`) — the actual owned count, not capped
                        to a single digit: the Shop has no cap on how many a
                        player can hold. Out of charges mid-match, this becomes
                        the gold price instead — see `canBuyHere` above. Sits
                        BELOW the icon rather than above it once it turns into
                        a price (on request: "giá tiền sẽ để phía dưới biểu
                        tượng booster thay vì ở trên"), with its own coin icon
                        so the number reads as a price and not a leftover
                        charge count — the plain charge-count badge above the
                        icon is untouched. */}
                    {canBuyHere ? (
                      <span className="booster-badge is-price" aria-hidden="true">
                        <CoinIcon />
                        {price}
                      </span>
                    ) : (
                      <span className="booster-badge" aria-hidden="true">{charges}</span>
                    )}
                  </button>
                );
                  });
              })()}
            </div>
          )}

          {/* §24's "a visible sign that firing is locked while sand is
              moving" — brought back on request after a stretch of trying the
              frame's own colour/opacity instead (that whole detour has been
              reverted; the frame now always keeps its authored colour). Sits
              in the open band between the picture and the cannon (see the
              comment on `.scene-wrap`), same spot `.ftue-gesture` already
              anchors to, rather than the old page-level position above the
              frame. */}
          {busy && !winReveal && (
            <div
              className="settle-badge"
              role="status"
              aria-label={state.phase === "PROJECTILE_FLYING" ? s.shotInFlight : s.sandSettling}
            >
              <i />
              <i />
              <i />
            </div>
          )}

          {toast && !winReveal && (
            <div key={toast.id} className={`sand-toast is-${toast.tone}`} role="status">
              {toast.text}
            </div>
          )}

        </div>

        {/* The three FTUE spotlight overlays below (Level 31's freeze-orb
            demo, Level 3's booster pair, Level 5's Chain Sort) used to live
            INSIDE `.scene-wrap` — on request ("làm vậy với lớp opacity đen
            khi tutorial luôn", the same fix `.miss-flash` just got): a
            direct child of `.game-frame` now instead, same reasoning as
            `.miss-flash`'s own move. `.scene-wrap` is inset below the top
            HUD bar and clips its own overflow, so `.ftue-freeze-spotlight`'s
            oversized dimming box-shadow — no matter how large its own
            spread — could never actually darken the ammo badge/Settings
            gear's corner from in there. Every `spot`/`screenPointForGrid`
            coordinate below is computed relative to `.game-frame` now
            instead of `.scene-wrap` (its left/right/bottom edges already sit
            flush with `.game-frame`'s own, only the top differs by the HUD's
            own height — see each spot's own comment for how that's
            handled), and `.ftue-freeze-overlay`'s own z-index climbs from 30
            to 33 (above `.hud-top-left`'s 31 and `.settings-wrap`'s 32, the
            same tier `.miss-flash` sits at) so the whole thing — dimming,
            caption and (where interactive) its own tap target — genuinely
            covers the whole visible frame while a beat is active. */}
        {/* Level 31's freeze-orb tutorial — the three callout beats
            (`freezeFtueStep` "intro"/"explain-thaw"/"outro"). Unlike the
            unlock banner elsewhere in this file, dismissing this never calls
            `openLevel` or touches `runId`: the whole point is a live board
            that keeps playing on through and past the tutorial, not one
            that resets. No background scrim of its own —
            `.ftue-freeze-spotlight` dims everything except a ring around
            the orb by itself (an oversized box-shadow with a hole cut where
            the ring sits), so the board stays legible underneath instead of
            vanishing behind a flat curtain. The "outro" beat (freeze
            already thawed, nothing left to point at) renders no spotlight,
            just the caption.
            `engine.screenPointForGrid` returns coordinates in `.scene-host`'s
            own space (the same `.scene-wrap`-relative space `.aim-crosshair`
            is positioned in) — now that this overlay itself lives at
            `.game-frame` level, that raw point needs `hudOffsetY` (measured
            live off `.scene-wrap`'s own position, the gap this overlay used
            to sit flush against) added to its `y` before it lines up with
            the real cell on screen. */}
        {playing && (freezeFtueStep === "intro" || freezeFtueStep === "explain-thaw" || freezeFtueStep === "outro") && (
          <div
            className="ftue-freeze-overlay"
            role="button"
            tabIndex={0}
            onClick={() => {
              // "outro"'s tap is a real restart, not just a state-machine
              // step: on request, the player re-plays level 31 from its
              // authored start (orb and mint patch both back, 30 shots
              // again) rather than picking up from the live board the
              // three demo shots already spent. `restart` itself clears
              // `freezeFtueStep` back to null (see its own body) — same as
              // `advanceFreezeFtue` would, just alongside the reset.
              if (freezeFtueStep === "outro") {
                if (freezeFtueTapReady) restart();
                return;
              }
              advanceFreezeFtue();
            }}
            aria-label={`${
              freezeFtueStep === "intro" ? s.ftueFreezeIntro
                : freezeFtueStep === "explain-thaw" ? s.ftueFreezeExplainThaw
                : s.ftueFreezeOutro
            }${freezeFtueTapReady ? ` ${s.tapToContinue}.` : ""}`}
          >
            {freezeFtueStep !== "outro" && level.ftueFreezeTargets?.[0] && engine && (() => {
              const spot = engine.screenPointForGrid(level.ftueFreezeTargets[0].x, level.ftueFreezeTargets[0].y);
              const sceneWrapEl = document.querySelector<HTMLElement>(".scene-wrap");
              const gameFrameEl = document.querySelector<HTMLElement>(".game-frame");
              const hudOffsetY = sceneWrapEl && gameFrameEl
                ? sceneWrapEl.getBoundingClientRect().top - gameFrameEl.getBoundingClientRect().top
                : 0;
              return (
                <div
                  className="ftue-freeze-spotlight"
                  style={{ left: `${spot.x}px`, top: `${spot.y + hudOffsetY}px` }}
                  aria-hidden="true"
                />
              );
            })()}
            <div className="ftue-freeze-caption">
              <p className="ftue-freeze-caption-text" aria-hidden="true">
                {freezeFtueStep === "intro" ? s.ftueFreezeIntro
                  : freezeFtueStep === "explain-thaw" ? s.ftueFreezeExplainThaw
                  : s.ftueFreezeOutro}
              </p>
              {freezeFtueTapReady && (
                <p className="ftue-freeze-caption-tap" aria-hidden="true">{s.tapToContinue}</p>
              )}
            </div>
          </div>
        )}

        {/* Level 3's booster tutorial — reuses the freeze-orb one's
            `.ftue-freeze-*` classes (the spotlight/caption/dim-the-rest
            styling is entirely generic), but only for the two "intro-*"
            steps now — `boosterFtueStep`'s own doc comment covers the
            whole "have them actually press and fire it themselves"
            redesign. `.is-noninteractive` drops `pointer-events` on the
            whole overlay: nothing here is tappable any more (no "tap to
            continue" — see that doc comment), so every click has to fall
            straight through to the REAL tray button this is spotlighting,
            or the player could never actually arm it. The spotlight itself
            points at that real DOM element via `getBoundingClientRect()`,
            measured straight against `.game-frame` now (this overlay's own
            container) rather than `.scene-wrap` — no separate offset add
            needed the way the freeze demo's engine-space point above does,
            since this measurement was already live DOM geometry, not a
            pre-computed scene-relative point. Nothing renders at all during
            "shoot-*" — on request: "tắt opacity, để người chơi tự nhắm và
            bắn". */}
        {playing && (boosterFtueStep === "intro-radius" || boosterFtueStep === "intro-prism") && (() => {
          const isRadiusStep = boosterFtueStep === "intro-radius";
          const captionText = isRadiusStep ? s.ftueBoosterRadiusIntro : s.ftueBoosterPrismIntro;
          return (
            <div className="ftue-freeze-overlay is-noninteractive" aria-hidden="true">
              {(() => {
                const button = document.querySelector<HTMLElement>(
                  `.booster-btn[data-booster="${isRadiusStep ? "radiusOvercharge" : "prismShot"}"]`,
                );
                const container = document.querySelector<HTMLElement>(".game-frame");
                if (!button || !container) return null;
                const buttonRect = button.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const spot = {
                  x: buttonRect.left + buttonRect.width / 2 - containerRect.left,
                  y: buttonRect.top + buttonRect.height / 2 - containerRect.top,
                };
                return (
                  <div
                    className="ftue-freeze-spotlight"
                    style={{ left: `${spot.x}px`, top: `${spot.y}px` }}
                    aria-hidden="true"
                  />
                );
              })()}
              <div className="ftue-freeze-caption">
                <p className="ftue-freeze-caption-text" aria-hidden="true">{captionText}</p>
              </div>
            </div>
          );
        })()}

        {/* Level 5's Chain Sort tutorial — on request, now taught exactly
            the same way as level 3's Radius/Prism pair just above (see
            `chainSortFtueStep`'s own doc comment for the redesign): one
            spotlight step instead of a scripted demo, tapping straight
            through to arm the real button, nothing rendered at all once
            the player is aiming their own "shoot" shot. */}
        {playing && chainSortFtueStep === "intro" && (
          <div className="ftue-freeze-overlay is-noninteractive" aria-hidden="true">
            {(() => {
              const button = document.querySelector<HTMLElement>('.booster-btn[data-booster="chainSort"]');
              const container = document.querySelector<HTMLElement>(".game-frame");
              if (!button || !container) return null;
              const buttonRect = button.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              const spot = {
                x: buttonRect.left + buttonRect.width / 2 - containerRect.left,
                y: buttonRect.top + buttonRect.height / 2 - containerRect.top,
              };
              return (
                <div
                  className="ftue-freeze-spotlight"
                  style={{ left: `${spot.x}px`, top: `${spot.y}px` }}
                  aria-hidden="true"
                />
              );
            })()}
            <div className="ftue-freeze-caption">
              <p className="ftue-freeze-caption-text" aria-hidden="true">{s.ftueChainSortIntro}</p>
            </div>
          </div>
        )}

        {/* The home screen. It does not cover the picture, it frames it: the
            scene underneath is still the level's own pixel painting, sitting
            idle in its frame, which is what the player is choosing to play.
            Stays mounted a beat past `playing` turning true so `is-leaving`
            gets to animate it off instead of the screen just cutting out.
            Unmounted entirely while the reward chest is open, same as the nav
            and the currency row: that screen owns the whole frame while it
            plays, and the chest behind it is drawn on the same canvas this
            screen frames.
            Excludes Shop too now, same reasoning as Skin below it: `.shop-screen`
            is its own full-bleed takeover (see its own comment), not another
            `.hub-panel` bottom sheet floating over the picture. Modes is the
            same story (`.modes-screen`, own comment below). */}
        {homeVisible && !chest && tab !== "skin" && tab !== "shop" && tab !== "gallery" && tab !== "modes" && (
          <div
            className={`hub-screen${playing ? " is-leaving" : ""}`}
            role="group"
            aria-label={s.homeScreenAria}
            aria-hidden={playing || undefined}
          >

            {/* This screen only ever mounts for `tab === "home"` now — Shop,
                Skin, Gallery and Modes all left for their own full-screen
                takeovers above/below, so the `.hub-scrim`/`.hub-panel`
                fallback that used to handle every other tab here (most
                recently Modes, ex-"customize") has nothing left to serve and
                is gone rather than kept as dead code nothing can reach. */}
            <div className="hub-actions">
              <button
                type="button"
                className="hub-play-btn"
                onClick={() => { if (tryStartAttempt()) startPlaying(); }}
                aria-label={s.playLevelAria(s.levelName(level.name))}
              >
                {s.levelButtonLabel(level.id)}
              </button>
              {/* The reward track, in the slot the dead "Modes" chip used
                  to hold and sized to match Play beside it (see
                  `.hub-actions`, which gives both the same box). A real
                  button only once the bar is full: an incomplete track is a
                  progress readout with nothing to tap, and `disabled` says
                  so to a screen reader rather than a tap that silently does
                  nothing. The bar under the chest is one continuous track
                  filling a fifth per level won — the count itself lives in
                  the label above, since a bar this size has no room to print
                  it without crowding the chest. */}
              <button
                type="button"
                className={`hub-track-btn${track.canClaim ? " is-ready" : ""}${trackDenied ? " is-denied" : ""}`}
                onClick={handleTrackTap}
                onAnimationEnd={(e) => {
                  if (e.animationName === "hub-track-denied") setTrackDenied(false);
                }}
                aria-label={
                  track.canClaim
                    ? s.openRewardChestAria(track.chestReward)
                    : s.rewardTrackAria(track.filled, NODES_PER_CHEST)
                }
              >
                <span className="hub-track-label" aria-hidden="true">{s.progressionChest}</span>
                <span className="hub-track-row">
                  <span className="hub-track-bar" aria-hidden="true">
                    <span
                      className="hub-track-fill"
                      style={{ width: `${Math.round(track.progress * 100)}%` }}
                    />
                    <span className="hub-track-ticks" aria-hidden="true">
                      <span /><span /><span /><span /><span />
                    </span>
                  </span>
                  <span className="hub-track-chest" aria-hidden="true">
                    <ChestIcon />
                  </span>
                </span>
              </button>
            </div>
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
            {!cannonUnlock && (
              <div className="skin-heading">
                <h2 id="skin-title">{s.costumeName(previewCostume)}</h2>
                <p className="skin-tagline">{s.costumeTagline(previewCostume)}</p>
              </div>
            )}

            <div className="skin-stage" aria-hidden="true" />

            {/* The unlock reveal: every other control on this screen (and
                every persistent HUD piece — see the `!cannonUnlock` guards
                on `.settings-wrap`/`.hub-gift-wrap`/`.hub-currency-row`/
                `.hub-nav`) is hidden while this is up, so the spinning,
                glowing rig the engine is playing (`playUnlockCelebration`)
                and this banner are the only things on screen. Sits above the
                rig rather than over it (`.cannon-unlock-text`'s own top
                margin) so the reveal reads as a caption on the cannon, not a
                curtain over it.
                Plain `role="button"` div rather than a real `<button
                disabled>` — a disabled-then-enabled native button has been
                unreliable about picking taps back up in the game's WebView,
                where every other full-screen tap surface here (`.hub-tap`
                etc.) is already a div for the same reason. The tap guard
                lives in the handler itself instead: any tap anywhere on
                screen dismisses the reveal, but only once
                `cannonUnlockTapReady` flips true (~2s in) — before that a
                tap is swallowed rather than skipping past the name before
                the prompt inviting one even exists. */}
            {cannonUnlock && (
              <div
                className="cannon-unlock-banner"
                role="button"
                tabIndex={0}
                onClick={() => { if (cannonUnlockTapReady) dismissCannonUnlock(); }}
                aria-label={`${s.youUnlocked(s.costumeName(cannonUnlock))}${cannonUnlockTapReady ? ` ${s.tapToContinue}.` : ""}`}
              >
                {/* Two lines on purpose (on request: "'You unlocked' xuống
                    dòng 'X cannon'") — the verb on its own line, the skin's
                    own name on the next. `youUnlockedPrefix` carries only the
                    first; the full one-line sentence still lives in
                    `youUnlocked` for the banner's own aria-label above. */}
                <p className="cannon-unlock-text" aria-hidden="true">
                  {s.youUnlockedPrefix}
                  <br />
                  {s.costumeName(cannonUnlock)}!
                </p>
                {cannonUnlockTapReady && (
                  <p className="cannon-unlock-tap" aria-hidden="true">{s.tapToContinue}</p>
                )}
              </div>
            )}

            {/* One button, up to four jobs, in the order a player meets them:
                Progression (locked, level not cleared yet), Unlock (level
                cleared, on request — replaces the old auto-equip-on-Continue
                flow), Buy (locked, priced), Select/Selected (owned). Buying
                and Unlocking both equip in the same step (`buySkin`/
                `unlockProgressionSkin`), so neither state hands back to a
                Select the player then has to tap again. A wallet that cannot
                afford Buy still gets a live button — the confirm dialog is
                where "not enough" is said, rather than a dead control with
                no explanation on it. */}
            {cannonUnlock ? null : !previewOwned && previewUnlockLevel !== undefined ? (
              previewUnlockRequirementMet ? (
                <button
                  className="skin-equip is-unlock"
                  type="button"
                  onClick={() => unlockProgressionSkin(previewCostume)}
                >
                  <span className="skin-equip-label">{s.unlockLabel}</span>
                </button>
              ) : (
                // Not for sale at any price — no Buy action, just the same
                // "Progression" word the grid card's own price pill shows for
                // this skin, so the two spots on this screen where a price
                // would normally appear agree with each other.
                <div className="skin-equip is-progression" aria-disabled="true">
                  <span className="skin-equip-label">{s.progressionLabel}</span>
                </div>
              )
            ) : !previewOwned ? (
              <button
                className="skin-equip is-buy"
                type="button"
                onClick={() => setSkinBuyConfirm(previewCostume)}
              >
                <span className="skin-equip-label">
                  {s.buyLabel} <EmeraldIcon /> {previewPrice}
                </span>
              </button>
            ) : (
              <button
                className={`skin-equip${justEquippedPulse ? " is-just-selected" : ""}`}
                type="button"
                onClick={selectCostume}
                disabled={previewCostume === costume}
                onAnimationEnd={() => setJustEquippedPulse(false)}
              >
                <span className="skin-equip-label">{previewCostume === costume ? s.selectedLabel : s.selectLabel}</span>
              </button>
            )}

            {!cannonUnlock && (
            <div className="skin-tray">
              <div className="skin-grid">
                {COSTUME_ORDER.map((id) => {
                  const def = COSTUMES[id];
                  const thumbnail = costumeThumbnails[id];
                  // A locked card is still fully previewable — tapping it swaps
                  // the showroom rig the same as any other, so a player can see
                  // what they would be buying before they buy it. Only the
                  // main button below changes.
                  const owned = isCostumeOwned(id);
                  // A `unlockLevel` skin's lock reads out (and shows) which
                  // level clears it rather than a price it was never for sale
                  // at — see `previewUnlockLevel`'s own comment above.
                  const unlockLevel = def.unlockLevel;
                  // Same requirement-met check `previewUnlockRequirementMet`
                  // runs for the previewed skin, but per-card here — the grid
                  // has to show every card's own true state at once, not just
                  // whichever one happens to be previewed right now.
                  const unlockRequirementMet = unlockLevel !== undefined && hasClearedLevel(unlockLevel);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`skin-card${previewCostume === id ? " is-previewing" : ""}${owned ? "" : " is-locked"}`}
                      onClick={() => previewCostumeCard(id)}
                      aria-pressed={previewCostume === id}
                      aria-label={`${s.costumeName(id)}${
                        owned
                          ? (costume === id ? s.equippedSuffix : "")
                          : unlockLevel !== undefined
                            ? unlockRequirementMet
                              ? `, ${s.unlockLabel}`
                              : s.progressionLockedSuffix(unlockLevel)
                            : s.lockedSuffix(costumePrice(id))
                      }${unseenSkins.includes(id) ? s.affordableSuffix : ""}`}
                    >
                      {/* The card-level twin of `.hub-nav-dot`: this specific
                          skin, not just "the Skin tab", is one the wallet can
                          afford and the player has not dismissed yet. A tap
                          anywhere on this card (`previewCostumeCard`) clears
                          it via `markSkinBadgeSeen`, whether or not the player
                          goes on to buy. */}
                      {unseenSkins.includes(id) && <span className="skin-card-dot" aria-hidden="true" />}
                      {thumbnail
                        // A data URL rendered from the rig itself a moment
                        // ago: there is no file for an image loader to
                        // optimise.
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={thumbnail} alt="" />
                        : (
                          <span
                            className={`skin-card-icon${def.flavor === "magic" ? " is-magic" : ""}${id === "hero-cannon" ? " is-hero" : ""}${id === "frost-cannon" ? " is-frost" : ""}`}
                          >
                            <CostumeIcon id={id} />
                          </span>
                        )}
                      {owned
                        ? costume === id && <span className="skin-card-tick" aria-hidden="true">✓</span>
                        : unlockLevel !== undefined ? (
                          <span className={`skin-card-price is-progression${unlockRequirementMet ? " is-unlock" : ""}`} aria-hidden="true">
                            {unlockRequirementMet ? s.unlockLabel : s.progressionLabel}
                          </span>
                        ) : (
                          <span className="skin-card-price" aria-hidden="true">
                            <EmeraldIcon /> {costumePrice(id)}
                          </span>
                        )}
                    </button>
                  );
                })}
              </div>
            </div>
            )}
          </div>
        )}

        {/* The Gallery: a full-screen takeover, same footing as the skin
            picker and Shop either side of it rather than the small
            `.hub-panel` bottom sheet this used to be — the hub screen behind
            it is unmounted entirely while this is up (see the
            `tab !== "gallery"` guard on it above). Four thumbnails per row
            (`.hub-gallery`'s own `grid-template-columns`), same card content
            as before (name, lock badge, milestone reward) — only the frame
            around them changed size. No close button of its own, same
            reasoning as the skin picker and Shop: `.hub-nav` stays mounted
            over this screen too, so tapping any other tab is how you leave. */}
        {tab === "gallery" && (
          <div className="gallery-screen" role="dialog" aria-label={s.galleryTitle}>
            <div className="gallery-heading">
              <h2>{s.galleryTitle}</h2>
            </div>
            <div className="hub-gallery">
              {playables.map((entry, index) => {
                // Sequential unlock: the first level is always open, every
                // one after needs the level right before it (in this same
                // list, not level id order) actually cleared — "đã đi qua"
                // means played to the end, not just visited. Editor-authored
                // levels sit after the built-ins in `playables`, so they
                // fall in line behind clearing every built-in one too,
                // rather than needing a rule of their own.
                const unlocked = index === 0 || hasClearedLevel(playables[index - 1].level.id);
                // Every 10th level (by id, not position) is a milestone —
                // shown with its own reward pill so it reads as a goal
                // worth playing toward, using the exact number a win would
                // actually pay out (same lookup `raw`'s own reward uses
                // above: a designer's CSV override or the difficulty
                // formula, PLUS the decade bonus `levelMilestoneBonus` adds
                // on top). Shown even before it unlocks, as a teaser.
                const isMilestone = entry.level.id % 10 === 0;
                const milestoneReward = isMilestone
                  ? (getLevelRewardOverride(entry.level.id) ?? levelGoldReward(computeLevelDifficulty(entry.level).score)) +
                    levelMilestoneBonus(entry.level.id)
                  : null;
                // The skin this level hands over on its first clear, if any
                // (`hero-cannon` at level 20 today) — shown as its own badge
                // regardless of whether this card also happens to be a gold
                // milestone, so a level that is both never has to pick one.
                const unlocksCostume = costumeUnlockedByLevel(entry.level.id);
                return (
                  <button
                    key={entry.level.id}
                    type="button"
                    className={`${index === levelIndex ? "is-active" : ""}${unlocked ? "" : " is-locked"}`.trim()}
                    onClick={() => pickFromGallery(index)}
                    disabled={!unlocked}
                    aria-current={index === levelIndex ? "true" : undefined}
                    title={
                      unlocked
                        ? `${s.levelName(entry.level.name)}${entry.fromEditor ? s.fromEditorSuffix : ""}`
                        : s.lockedCardTitle
                    }
                  >
                    <span className="hub-gallery-thumb">
                      {unlocked && <PixelThumb level={entry.level} />}
                      {!unlocked && (
                        <span className="hub-gallery-lock" aria-hidden="true">
                          {index + 1}
                        </span>
                      )}
                      {isMilestone && (
                        <span className="hub-gallery-milestone" aria-hidden="true">
                          <CoinIcon /> +{milestoneReward}
                        </span>
                      )}
                      {unlocksCostume && (
                        <span className="hub-gallery-costume-badge" aria-hidden="true">
                          {costumeThumbnails[unlocksCostume]
                            // The same live-rig render the skin picker's own
                            // cards use (`costumeThumbnails`), so the badge
                            // shows what the skin actually looks like rather
                            // than a generic line-art stand-in. Falls back to
                            // the icon only for the one session where this
                            // level's card renders before the Skin tab has
                            // ever been opened — see `costumeThumbnails`'s own
                            // comment for why it starts out empty.
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={costumeThumbnails[unlocksCostume]} alt="" />
                            : <CostumeIcon id={unlocksCostume} />}
                        </span>
                      )}
                    </span>
                    <b>{unlocked ? s.levelName(entry.level.name) : s.lockedLabel}</b>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Modes: a full-screen takeover, same footing as Gallery/Shop/Skin
            around it (the hub screen behind it is unmounted entirely while
            this is up — see the `tab !== "modes"` guard on it) rather than
            the small `.hub-panel` bottom sheet this used to be under its old
            name, "Customize" (see `HUB_TABS`'s own comment). Two states now
            instead of one placeholder:
              - `!zenPickerOpen`: the two mode cards — Zen Mode (real) and
                Theme Mode (still the exact "not built yet" placeholder this
                whole screen used to be, on request: theme content — sorting
                by a picked country's motifs — is real production work, not
                a code change, so it stays a locked card for now).
              - `zenPickerOpen`: the Zen level list (`zenPlayables`), laid out
                exactly like the Gallery (`.hub-gallery`) but with every card
                always unlocked — Zen has no progression to gate on.
            A back button only while the Zen level list is open — it steps
            back exactly one level, to the two mode cards (on request: "sẽ có
            thể quay lại từ zen/theme mode"). The two-cards screen itself
            dropped its own back button (on request: "Ở sảnh chính chọn
            modes, không cần để icon back") — `.hub-nav`'s other tabs are
            already right there for leaving Modes entirely, so a second way
            to do the exact same thing on the very first screen was
            redundant; the Zen list still needs one of its own since it is a
            level *inside* Modes that none of the other hub tabs know how to
            step back out of. Its own click handler resets `zenPickerOpen`
            the same way `hub-nav`'s tap handler does, for the same reason.
            `&& !playing` on top of the `tab` check (unlike Gallery/Shop/
            Skin, which never need one): every OTHER hub tab's own Play
            button only exists on the Home tab, so `playing` and `tab
            !== "home"` never coincide there — `openZenLevel` breaks that
            invariant on purpose (tapping a level in THIS screen starts play
            directly, with `tab` still `"modes"`), so this is the one screen
            that has to guard against it explicitly or it would stay
            rendered, full-bleed, on top of the level being played. */}
        {tab === "modes" && !playing && (
          <div className="modes-screen" role="dialog" aria-label={zenPickerOpen ? s.zenModeTitle : s.modesTitle}>
            <div className="modes-heading">
              {zenPickerOpen && (
                <button
                  type="button"
                  className="modes-back-btn"
                  onClick={() => setZenPickerOpen(false)}
                  aria-label={s.back}
                  title={s.back}
                >
                  <BackIcon />
                </button>
              )}
              <h2>{zenPickerOpen ? s.zenModeTitle : s.modesTitle}</h2>
              {/* Always present regardless of which Modes state is showing —
                  a quick explainer of what each card/mode actually does,
                  read before committing to tapping one. */}
              <button
                type="button"
                className="modes-help-btn"
                onClick={() => setModesHelpOpen(true)}
                aria-label={s.modesHelpAria}
                title={s.modesHelpAria}
              >
                ?
              </button>
            </div>
            {/* Two big rounded-rectangle image buttons, stacked, rather than
                the small side-by-side icon cards this used to be — on
                request: "Tôi muốn nó là 1 nút bấm hình chữ nhật bo góc".
                Zen Mode gets its own artwork (`ZenModeThumbnail.png`, real
                pixel-art scene) as the button's own background, filling the
                whole shape edge to edge; Theme Mode has no art yet, so it
                keeps the same rounded-rectangle silhouette (same size,
                same border) with a flat locked fill instead of a photo, so
                the two still read as one matched pair of buttons rather
                than two different kinds of thing. */}
            {!zenPickerOpen && (
              <div className="modes-stack">
                <button type="button" className="modes-image-btn" onClick={() => setZenPickerOpen(true)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/icons/ZenModeThumbnail.png" alt="" className="modes-image-btn-art" />
                  <span className="modes-image-btn-label">
                    <span aria-hidden="true">🧘</span> {s.zenModeButton}
                  </span>
                </button>
                <button
                  type="button"
                  className="modes-image-btn is-locked"
                  disabled
                  title={s.notBuiltYet}
                >
                  <span className="modes-image-btn-placeholder" aria-hidden="true">🗺️</span>
                  <span className="modes-image-btn-label">
                    <span aria-hidden="true">🔒</span> {s.themeModeButton}
                  </span>
                </button>
              </div>
            )}
            {zenPickerOpen && (
              zenPlayables.length === 0 ? (
                <div className="modes-empty">
                  <p>{s.zenEmptyBlurb}</p>
                </div>
              ) : (
                <div className="hub-gallery">
                  {zenPlayables.map((entry, index) => (
                    <button
                      key={entry.level.id}
                      type="button"
                      onClick={() => openZenLevel(index)}
                      title={`${s.levelName(entry.level.name)}${entry.fromEditor ? s.fromEditorSuffix : ""}`}
                    >
                      <span className="hub-gallery-thumb">
                        <PixelThumb level={entry.level} />
                      </span>
                      <b>{s.levelName(entry.level.name)}</b>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {/* The Modes screen's own "?" popup — a plain info card, same overlay
            family as `.settings-screen` (dim scrim, centered card), just for
            reading rather than acting on. Gated on `modesHelpOpen` alone
            (not also `tab === "modes"`) the same way `.settings-screen`
            below is gated on `settingsOpen` alone — it can only ever be
            opened from inside the Modes screen, so there is nothing to
            protect against by adding a redundant tab check here too. */}
        {modesHelpOpen && (
          <div
            className="modes-help-screen"
            role="dialog"
            aria-modal="true"
            aria-label={s.modesHelpTitle}
            onClick={(event) => {
              if (event.target === event.currentTarget) setModesHelpOpen(false);
            }}
          >
            <div className="modes-help-card">
              <div className="modes-help-card-header">
                <h2>{s.modesHelpTitle}</h2>
                <button
                  type="button"
                  className="modes-help-close"
                  onClick={() => setModesHelpOpen(false)}
                  aria-label={s.back}
                  title={s.back}
                >
                  <CancelIcon />
                </button>
              </div>
              <div className="modes-help-card-body">
                <p>
                  <span aria-hidden="true">🧘</span> <b>{s.zenModeButton}</b> — {s.zenModeBlurb}
                </p>
                <p>
                  <span aria-hidden="true">🔒</span> <b>{s.themeModeButton}</b> — {s.notBuiltYet}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* The Shop: a full-screen takeover, same footing as the skin
            picker above rather than a small `.hub-panel` card floating over
            the picture — the hub screen behind it is unmounted entirely
            while this is up (see the `tab !== "shop"` guard on it). ONE
            unified screen now (2026-09d), no more Gems/Coins tabs — on
            request: "Không chia ra 2 tab mà để vô thành 1 UI hết". Section
            order top to bottom is the whole redesign's other half of the
            ask ("có điều để những thứ mua ở coins ở cuối cùng"): every
            real-money item (Special Offers, Bundles, buy-Coins, buy-Hearts)
            first, the Boosters grid — the one purchase flow that spends a
            currency the player actually earned by playing, not real money —
            LAST, where it used to be its own separate "Coins tab". No close
            button of its own, same reasoning as the skin picker: `.hub-nav`
            stays mounted over this screen too, so tapping any other tab is
            how you leave. */}
        {tab === "shop" && (
          <div className="shop-screen" role="dialog" aria-label={s.shopTitle}>
            <div className="shop-heading">
              <h2>{s.shopTitle}</h2>
            </div>

            {/* Its own scroll container, separate from `.shop-screen` itself
                (which no longer scrolls — see that class's own comment) — so
                the heading above stays put while everything below scrolls
                underneath, and `.shop-iap-toast` below can pin to the screen
                without scrolling away with whatever section is in view. */}
            <div className="shop-scroll">
            <div className="shop-panel">
              {/* Real-money offers/bundles/packs. None of it is wired to an
                  actual payment processor — there is no account or server in
                  this prototype (see economy.ts's own top-of-file note) — so
                  every price pill here just surfaces `notifyIapComingSoon`'s
                  toast instead of charging anything or moving a balance.
                  Gems are gone entirely (2026-09d) — every offer/bundle now
                  sells some mix of coins, hearts and a small Blue Emerald
                  top-up instead (see `SPECIAL_OFFERS`/`BUNDLES`'s own
                  comment for the quantities and the reasoning behind them). */}
              {/* Every current Special Offer sells hearts (see `SPECIAL_OFFERS`'s
                  own comment) — `visibleOffers` drops any offer that does
                  while hearts are still locked (on request: "nếu chưa có
                  heart currency thì không hiện những bundle, hay shop heart
                  trong shop"), which today empties the whole list, so the
                  section itself disappears too rather than showing an empty
                  head. A future coins/emerald-only offer would still show
                  here even before hearts unlock — only offers that actually
                  include hearts are the ones being withheld. */}
              {visibleOffers.length > 0 && (
              <div className="shop-section">
                <div className="shop-section-head">
                  <h3>{s.specialOffers}</h3>
                  <p>{s.limitedTimeBundles}</p>
                </div>
                {/* Stacked top to bottom, not a side-scrolling rail — every
                    offer is visible without a swipe, the same "no hidden
                    shelf" reasoning the Bundles list below already follows. */}
                <div className="offer-stack">
                  {visibleOffers.map((offer) => (
                    <div key={offer.id} className={`offer-card is-${offer.id === "starter" ? "teal" : "green"}`}>
                      {/* `offer-tag` (left, "First purchase"/"Weekend only") answers
                          "why is this here"; `offer-value-badge` (right, 2026-09f)
                          answers "why should I buy it" — the anchoring number made
                          visible instead of only baked into the coin/heart amounts,
                          see `SpecialOffer.valuePercent`'s own comment above. */}
                      <div className="offer-head">
                        <span className="offer-tag">{s.offerTag(offer.id)}</span>
                        <span className="offer-value-badge">{s.offerValueBadge(offer.valuePercent)}</span>
                      </div>
                      <h4>{s.offerName(offer.id)}</h4>
                      <div className="offer-contents">
                        {offer.coins != null && (
                          <>
                            <CoinIcon /> {offer.coins.toLocaleString("en-US")}
                          </>
                        )}
                        {offer.hearts != null && (
                          <>
                            {offer.coins != null && <span className="offer-plus">+</span>}
                            <HeartIcon /> {offer.hearts.toLocaleString("en-US")}
                          </>
                        )}
                        {offer.emeralds != null && (
                          <>
                            {(offer.coins != null || offer.hearts != null) && <span className="offer-plus">+</span>}
                            <EmeraldIcon /> {offer.emeralds.toLocaleString("en-US")}
                          </>
                        )}
                        {offer.bonus && <span className="offer-plus">{s.offerFlag(offer.bonus)}</span>}
                      </div>
                      <button type="button" className="buy-btn" onClick={notifyIapComingSoon}>
                        {offer.price}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              )}

              {/* Every Bundle sells hearts too (`BUNDLES`'s own comment —
                  it is not an optional field there the way it is on
                  `SpecialOffer`), so the whole section is withheld outright
                  rather than filtered item by item — same request as
                  `visibleOffers` above. */}
              {heartsUnlocked && (
              <div className="shop-section">
                <div className="shop-section-head">
                  <h3>{s.bundlesTitle}</h3>
                  <p>{s.bundleContents}</p>
                </div>
                <div className="bundle-list">
                  {BUNDLES.map((bundle) => (
                    <div key={bundle.id} className={`bundle-row${bundle.flag ? " is-best" : ""}`}>
                      <div className="bundle-icon"><CoinIcon /></div>
                      <div className="bundle-mid">
                        {bundle.flag && <div className="bundle-flag">{s.offerFlag(bundle.flag)}</div>}
                        <div className="bundle-amount">
                          {bundle.coins.toLocaleString("en-US")} {s.coinsSuffix}
                          {bundle.bonus && <span className="bundle-bonus">{bundle.bonus}</span>}
                        </div>
                        <div className="bundle-sub">
                          <HeartIcon /> {bundle.hearts} {s.heartsSuffix} · <EmeraldIcon /> {bundle.emeralds.toLocaleString("en-US")} {s.emeraldSuffix}
                        </div>
                      </div>
                      <button type="button" className="bundle-price" onClick={notifyIapComingSoon}>
                        {bundle.price}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              )}

              <div className="shop-section" ref={coinPackSectionRef}>
                <div className="shop-section-head">
                  <h3>{s.coinsTitle}</h3>
                  <p>{s.buyCoinsDirectly}</p>
                </div>
                <div className="pack-grid">
                  {COIN_PACKS.map((pack) => (
                    <div key={pack.id} className={`pack-card${pack.flag ? " is-flag" : ""}`} data-flag={pack.flag && s.offerFlag(pack.flag)}>
                      <CoinIcon />
                      <div className="pack-amount">
                        {pack.coins.toLocaleString("en-US")}
                        {pack.bonus && <span className="pack-bonus">{pack.bonus}</span>}
                      </div>
                      <button type="button" className="pack-price" onClick={notifyIapComingSoon}>
                        {pack.price}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hearts sold directly, its own section beside Coins — on
                  request: "Ngoài coins ra giờ sẽ có mục mua riêng". Same
                  `pack-grid` layout as Coins, capped at `MAX_HEARTS` per
                  pack (see `HEART_PACKS`'s own comment for why). Withheld
                  entirely before hearts unlock (level 10) — same request as
                  `visibleOffers`/the Bundles section above: selling a
                  currency the player cannot even see or use yet would just
                  be confusing, not tempting. */}
              {heartsUnlocked && (
              <div className="shop-section" ref={heartPackSectionRef}>
                <div className="shop-section-head">
                  <h3>{s.heartsTitle}</h3>
                  <p>{s.buyHeartsDirectly}</p>
                </div>
                <div className="pack-grid">
                  {HEART_PACKS.map((pack) => (
                    <div key={pack.id} className={`pack-card${pack.flag ? " is-flag" : ""}`} data-flag={pack.flag && s.offerFlag(pack.flag)}>
                      <HeartIcon />
                      <div className="pack-amount">{pack.hearts.toLocaleString("en-US")}</div>
                      <button type="button" className="pack-price" onClick={notifyIapComingSoon}>
                        {pack.price}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              )}

              {/* Boosters — the one purchase flow that actually spends
                  something (gold earned by playing, not real money). Moved
                  to the very end of the unified Shop screen on request; this
                  used to be its own "Coins tab", separate from everything
                  real-money above it. `boostersSectionRef` is what the
                  `hub-nav`'s own Shop hint-dot scrolls to now, since there is
                  no tab to switch to any more. */}
              <div className="shop-section" ref={boostersSectionRef}>
                <div className="shop-section-head">
                  <h3>{s.boostersTitle}</h3>
                </div>
                <div className="shop-grid">
                  {/* Chain Sort withheld until level 5 — its own tutorial
                      level — is reached, i.e. level 4 cleared
                      (`CHAIN_SORT_UNLOCK_LEVEL_ID`'s own comment). Radius
                      Overcharge and Prism Shot stay visible from the very
                      start: their own tutorial IS level 3 itself, so
                      nothing before it has taught them either, but the Shop
                      already sold them pre-onboarding and nobody asked to
                      change that half — Chain Sort is the one card that
                      used to appear here before a player had any idea the
                      booster system existed at all. */}
                  {(["radiusOvercharge", "prismShot", "chainSort"] as const)
                    .filter((type) => type !== "chainSort" || hasClearedLevel(CHAIN_SORT_UNLOCK_LEVEL_ID - 1))
                    .map((type) => {
                    const price = boosterPrice(type);
                    const owned = wallet.boosters[type];
                    const canAfford = wallet.gold >= price;
                    return (
                      <div key={type} className="shop-card">
                        {/* The one-line pitch (`s.boosterDesc`) dropped out of the
                            card itself — name only, per feedback that the card
                            should read as clean as the sketch it started from —
                            but stays reachable as a hover tooltip rather than
                            disappearing outright. */}
                        <b className="shop-card-name" title={s.boosterDesc(type)}>{s.boosterName(type)}</b>
                        <div className={`shop-card-frame is-${type === "radiusOvercharge" ? "radius" : "prism"}`}>
                          <span className="shop-card-icon">
                            <BoosterIcon type={type} />
                          </span>
                          {/* Owned count from the old row layout, kept as a
                              small circle badge overlapping the square frame's
                              own top-right corner rather than dropped — still
                              worth knowing at a glance, just not part of the
                              sketch's three elements. A bare number, not
                              "×N" — the circle shape is what says "count"
                              now, the glyph doesn't have to. */}
                          {owned > 0 && (
                            <span className="shop-card-owned" aria-hidden="true">{owned}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="shop-buy-btn"
                          disabled={!canAfford}
                          onClick={() => {
                            setBuyQty(1);
                            setBuyConfirm(type);
                          }}
                          aria-label={s.buyBoosterAria(s.boosterName(type), price, owned)}
                        >
                          <CoinIcon /> {price}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            </div>

            {/* Pinned to the screen itself, outside `.shop-scroll` above —
                `pushToast`'s own `.sand-toast` cannot be reused here (it
                renders inside `.scene-wrap`, underneath this screen's opaque
                background), and a snackbar that scrolled away with whatever
                section is in view would miss the tap that triggered it. */}
            {iapNotice && (
              <div className="shop-iap-toast" role="status">{s.iapComingSoon}</div>
            )}
          </div>
        )}

        {/* The Shop's own confirm step, one purchase at a time (§ the
            `buyConfirm` state comment above): tapping a price pill no longer
            spends gold on the spot, it opens this asking "buy this?" with a
            quantity stepper (0-99, `buyQty`) and the numbers that quantity
            implies — what they already have, and the total cost — then
            Yes/No, side by side rather than stacked (`.result-actions.is-row`)
            so this reads as a single either/or choice, not a primary action
            with an escape hatch below it the way "Play again"/"Home" does.
            Reuses `.result-screen`/`.result-card`, same "one card, centred,
            everything else locked out" shape the win/loss and daily-login
            dialogs already use, rather than a bespoke confirm of its own.
            Gated on `tab === "shop"` too, not just `buyConfirm`, so a stale
            confirm from before a tab switch can never reappear over a
            different screen — see the effect that clears it on tab change. */}
        {tab === "shop" && buyConfirm && (
          <div className="result-screen" role="dialog" aria-modal="true" aria-label={s.buyBoosterQuestion(s.boosterName(buyConfirm))}>
            <div className="result-card confirm-card">
              <h2>{s.buyBoosterQuestion(s.boosterName(buyConfirm))}</h2>
              <div className="confirm-info">
                <div className="confirm-info-row">
                  <span>{s.currentlyOwn}</span>
                  <strong>{wallet.boosters[buyConfirm]}</strong>
                </div>
                <div className="confirm-info-row">
                  <span>{s.buying}</span>
                  <span className="confirm-qty-stepper">
                    <button
                      type="button"
                      className="confirm-qty-btn is-prev"
                      disabled={buyQty <= 0}
                      onPointerDown={() => startQtyHold(() => setBuyQty((qty) => Math.max(0, qty - 1)))}
                      onPointerUp={stopQtyHold}
                      onPointerLeave={stopQtyHold}
                      onPointerCancel={stopQtyHold}
                      onClick={() => stepQtyOnClick(() => setBuyQty((qty) => Math.max(0, qty - 1)))}
                      aria-label={s.decreaseQuantity}
                    >
                      <StepperArrow direction="prev" />
                    </button>
                    <strong className="confirm-qty-value">{buyQty}</strong>
                    <button
                      type="button"
                      className="confirm-qty-btn is-next"
                      disabled={buyQty >= buyQtyCap}
                      onPointerDown={() => startQtyHold(() => setBuyQty((qty) => Math.min(buyQtyCap, qty + 1)))}
                      onPointerUp={stopQtyHold}
                      onPointerLeave={stopQtyHold}
                      onPointerCancel={stopQtyHold}
                      onClick={() => stepQtyOnClick(() => setBuyQty((qty) => Math.min(buyQtyCap, qty + 1)))}
                      aria-label={s.increaseQuantity}
                    >
                      <StepperArrow direction="next" />
                    </button>
                  </span>
                </div>
                <div className="confirm-info-row">
                  <span>{s.totalCost}</span>
                  <strong><CoinIcon /> {buyConfirmPrice * buyQty}</strong>
                </div>
              </div>
              <div className="result-actions is-row">
                <button
                  type="button"
                  disabled={buyQty <= 0}
                  onClick={() => {
                    const type = buyConfirm;
                    const qty = buyQty;
                    const owned = wallet.boosters[type];
                    // The wallet notifies its own subscribers on a
                    // successful buy, so `wallet.gold`/`.boosters` above are
                    // already the post-purchase numbers by the time this
                    // toast reads `owned` — but `owned` was captured before
                    // the click, so the message still has to add the batch
                    // itself.
                    if (buyBoosterCharges(type, qty)) {
                      pushToast(s.toastBoughtBooster(s.boosterName(type), qty, owned + qty), "good");
                    } else {
                      pushToast(s.toastNotEnoughCoins, "warn");
                    }
                    setBuyConfirm(null);
                  }}
                >
                  {s.yesBuy}
                </button>
                <button type="button" className="is-quiet" onClick={() => setBuyConfirm(null)}>
                  {s.no}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Buying a skin gets the same confirm the Shop's boosters get — a
            single unconfirmed tap should never spend a currency, and emerald
            is scarcer than gold. Gated on `tab === "skin"` as well as on the
            state itself, same as the Shop's dialog: a confirm left open
            behind a tab switch must not reappear on the way back. */}
        {tab === "skin" && skinBuyConfirm && (
          <div className="result-screen" role="dialog" aria-modal="true" aria-label={s.buySkinQuestion(s.costumeName(skinBuyConfirm))}>
            <div className="result-card confirm-card">
              <h2>{s.buySkinQuestion(s.costumeName(skinBuyConfirm))}</h2>
              <div className="confirm-info">
                <div className="confirm-info-row">
                  <span>{s.price}</span>
                  <strong><EmeraldIcon /> {costumePrice(skinBuyConfirm)}</strong>
                </div>
                <div className="confirm-info-row">
                  <span>{s.youHave}</span>
                  <strong><EmeraldIcon /> {wallet.emeralds}</strong>
                </div>
              </div>
              <div className="result-actions is-row">
                <button
                  type="button"
                  disabled={wallet.emeralds < costumePrice(skinBuyConfirm)}
                  onClick={() => buySkin(skinBuyConfirm)}
                >
                  {s.yesBuy}
                </button>
                <button type="button" className="is-quiet" onClick={() => setSkinBuyConfirm(null)}>
                  {s.no}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* The reward chest: its own full-screen takeover over everything else,
            playing the sequence `chest`'s state machine drives — the closed
            chest spins on the spot, settles, the lid hinges back, and the
            emerald bursts out of it. The amount and the Collect button only
            appear at the "revealed" phase, so nothing spoils the opening. */}
        {chest && (
          <div className="reward-screen" role="dialog" aria-modal="true" aria-label={s.rewardChestAria}>
            {/* Deliberately empty, the same way `.skin-stage` is: everything
                that happens in this space — the chest, the light out of its
                mouth, the emeralds it throws and where they land — is the 3D
                stage the engine draws on the canvas BEHIND this screen
                (`setChestShowcase` / `ChestStage`). All this does is claim that
                stage a spot in the layout so the caption and the button below
                never ride up over it. */}
            <div className="reward-stage" aria-hidden="true" />
            <p className="reward-caption">
              {chest.phase === "revealed" ? s.rewardUnlocked : s.opening}
            </p>
            {chest.phase === "revealed" && (
              <>
                <p className="reward-amount">
                  <EmeraldIcon /> {chest.amount}
                </p>
                <button type="button" className="reward-collect" onClick={() => setChest(null)}>
                  {s.collect}
                </button>
              </>
            )}
          </div>
        )}

        {/* The bottom bar itself, pulled out of `.hub-screen` so it stays
            mounted over the skin picker too (that screen used to unmount it
            along with the rest of `.hub-screen` — the one thing every hub
            screen shares became the one thing that vanished on skin). Gated
            on `homeVisible` alone, same as `.hub-screen`/`.skin-screen`
            themselves, so it fades out with them rather than outliving the
            screen it belongs to. */}
        {homeVisible && !chest && !cannonUnlock && (
          <nav className={`hub-nav${playing ? " is-leaving" : ""}`} aria-label={s.sectionsNav}>
            {HUB_TABS.map((entry) => (
              <button
                key={entry}
                type="button"
                className={entry === tab ? "is-active" : ""}
                data-tab={entry}
                onClick={() => {
                  // Force-close the daily-login modal the instant the player
                  // taps away to a different hub tab (on request — it used
                  // to just sit there, un-gated on `tab`, so it kept
                  // covering whichever screen the player switched to
                  // underneath it). Only on an actual switch (`entry !==
                  // tab`): tapping the tab already active is a no-op, not a
                  // "leaving" gesture. Lights `dailyLoginMissedClaim` (see
                  // its own doc comment) only if today's reward genuinely
                  // wasn't claimed yet — a reopen-after-claim (gift button,
                  // "see tomorrow isn't up yet") interrupted this way has
                  // nothing left to remind the player about.
                  if (dailyLogin && entry !== tab) {
                    setDailyLoginOverride(null);
                    if (!dailyLogin.claimedToday) setDailyLoginMissedClaim(true);
                  }
                  setTab(entry);
                  // Leaving Zen Mode: any tab OTHER than Modes means "I want
                  // something else now" — reset both `playingZen` (so `raw`
                  // falls back to the main list) and `zenPickerOpen` (so a
                  // later tap back into Modes shows the two mode buttons
                  // again, not straight back into the level list).
                  if (entry !== "modes") {
                    setPlayingZen(false);
                    setZenPickerOpen(false);
                  }
                  // The Shop's own hint dot: a tap here is exactly the
                  // "go buy the boosters you just tried" action it was
                  // asking for, so scroll straight to the Boosters section
                  // at the end of the Shop and clear the dot — same "a look
                  // is enough to dismiss it" contract as
                  // `previewCostumeCard`'s `markSkinBadgeSeen` above.
                  if (entry === "shop" && boosterShopHint) {
                    setScrollToBoosters(true);
                    setBoosterShopHint(false);
                    setBoosterShopHintState(false);
                  }
                }}
                aria-current={entry === tab ? "page" : undefined}
                aria-label={`${HUB_TAB_NAME[entry]}${entry === "skin" && unseenSkins.length > 0 ? s.skinTabHasOfferSuffix : ""}${entry === "shop" && boosterShopHint ? s.shopTabHasBoosterHintSuffix : ""}${entry === "home" && dailyLoginMissedClaim ? s.homeTabHasDailyLoginHintSuffix : ""}`}
                title={HUB_TAB_NAME[entry]}
              >
                <span className="hub-nav-bubble">
                  <HubIcon tab={entry} active={entry === tab} />
                  {/* One skin the wallet can now afford and the player has
                      not yet dismissed (`unseenAffordableSkins`) is enough to
                      light this — it says "something changed in Skin", not
                      "buy now", so it stays lit even mid-preview until that
                      card is actually looked at. */}
                  {entry === "skin" && unseenSkins.length > 0 && (
                    <span className="hub-nav-dot" aria-hidden="true" />
                  )}
                  {/* Same dot, same class — see `dailyLoginMissedClaim`'s own
                      doc comment for exactly when this lights up. */}
                  {entry === "home" && dailyLoginMissedClaim && (
                    <span className="hub-nav-dot" aria-hidden="true" />
                  )}
                  {/* Same dot, same class, different trigger — see
                      `boosterShopHint`'s own doc comment above. */}
                  {entry === "shop" && boosterShopHint && (
                    <span className="hub-nav-dot" aria-hidden="true" />
                  )}
                </span>
              </button>
            ))}
          </nav>
        )}

        {/* The one unified Settings card — see its own comment in
            globals.css. Reachable from the exact same gear button either
            way, hub or mid-play (both just flip `settingsOpen`), so
            Sound/Vibration and the dev-only level editor live in exactly one
            place. Opening it mid-play also pauses the engine (see the
            `settingsOpen`/`playing` effect above `restart`) — the old
            in-play menu doubled as a pause screen and this replaces it. */}
        {settingsOpen && (
          <div
            className="settings-screen"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            // A tap on the scrim itself (not one that bubbled up from the
            // card) dismisses the same way the corner cancel icon does — the
            // same "tap outside a sheet to close it" gesture the daily-login
            // card below already uses.
            onClick={(event) => {
              if (event.target === event.currentTarget) setSettingsOpen(false);
            }}
          >
            <div className="settings-card">
              <div className="settings-card-header">
                <h2 id="settings-title">{s.settingsTitle}</h2>
                <button
                  type="button"
                  className="settings-close"
                  onClick={() => setSettingsOpen(false)}
                  aria-label={s.closeSettings}
                >
                  <CancelIcon />
                </button>
              </div>
              {/* Mid-play only: the hub has no in-progress run to leave or
                  redo, so these two big round buttons — the old in-play
                  menu's Home/Restart, minus the level-grid picker that used
                  to sit beside them — only make sense while `playing`. */}
              {playing && (
                <div className="settings-round-actions">
                  <button
                    type="button"
                    className="settings-round-button"
                    onClick={() => { setSettingsOpen(false); goHome(); }}
                    aria-label={s.homeAction}
                    title={s.homeAction}
                  >
                    <img className="settings-round-button-icon" src="/icons/ReturnMainHubIcon.png" alt="" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="settings-round-button"
                    onClick={() => { setSettingsOpen(false); if (tryStartAttempt()) restart(); }}
                    aria-label={s.restartAction}
                    title={s.restartAction}
                  >
                    <img className="settings-round-button-icon" src="/icons/ReplayIcon.png" alt="" aria-hidden="true" />
                  </button>
                </div>
              )}
              <div className="settings-body">
                {soundSupported() && (
                  <div className="settings-row">
                    <span className="settings-row-label">
                      <Glyph name={soundOn ? "sound-on" : "sound-off"} className="icon-glyph settings-row-icon" /> {s.sound}
                    </span>
                    <button
                      type="button"
                      className={`settings-toggle${soundOn ? " is-on" : ""}`}
                      role="switch"
                      aria-checked={soundOn}
                      aria-label={s.soundAria(soundOn)}
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
                      <Glyph name="vibrate" className="icon-glyph settings-row-icon" /> {s.vibration}
                    </span>
                    <button
                      type="button"
                      className={`settings-toggle${vibrationOn ? " is-on" : ""}`}
                      role="switch"
                      aria-checked={vibrationOn}
                      aria-label={s.vibrationAria(vibrationOn)}
                      onClick={() => {
                        const next = !vibrationOn;
                        setHapticsEnabled(next);
                        setVibrationOn(next);
                      }}
                    />
                  </div>
                )}
                {/* Real now, not the cosmetic "EN ▾" placeholder this used to
                    be — a tap cycles to the next entry in `LANGUAGES` (only
                    two today, so this is a toggle in practice, but it reads
                    correctly however many languages that list ever grows
                    to). Tried as a native `<select>` dropdown first; reverted
                    on request — a plain button, and no arrow glyph on it
                    either, just the language's own name. `setLanguage`
                    (i18n.ts) both persists the choice and notifies
                    `subscribeLanguage`'s listeners, which is what updates
                    `language` above — same one-writer contract
                    Sound/Vibration's own modules use, just reactive instead
                    of read-once. */}
                <div className="settings-row">
                  <span className="settings-row-label">
                    <Glyph name="globe" className="icon-glyph settings-row-icon" /> {s.language}
                  </span>
                  <button
                    type="button"
                    className="settings-select"
                    aria-label={`${s.language}: ${LANGUAGE_NAME[language]}`}
                    onClick={() => {
                      setLanguage(LANGUAGES[(LANGUAGES.indexOf(language) + 1) % LANGUAGES.length]);
                    }}
                  >
                    {LANGUAGE_NAME[language]}
                  </button>
                </div>

                {/* A continuous value, not a toggle, so this is the one row
                    that wraps to a second line for a full-width slider rather
                    than fitting a control beside the label. Persisted through
                    aim-sensitivity.ts the same way Sound/Vibration persist
                    through their own modules; applied to the live engine by
                    the effect next to `setIdle` above, since a fresh engine
                    (every level start/restart) forgets it otherwise. */}
                <div className="settings-row settings-row--slider">
                  <span className="settings-row-label">
                    <Glyph name="target" className="icon-glyph settings-row-icon" /> {s.aimSensitivity}
                    <span className="settings-row-value">{aimSensitivity.toFixed(1)}x</span>
                  </span>
                  <input
                    type="range"
                    className="settings-slider"
                    min={MIN_CONTROL_SENSITIVITY}
                    max={MAX_CONTROL_SENSITIVITY}
                    step={0.1}
                    value={aimSensitivity}
                    aria-label={s.aimSensitivity}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setAimSensitivity(next);
                      setAimSensitivityState(next);
                    }}
                  />
                </div>

                {/* Collapsed behind one button by default — the dev-tools
                    grid below is only for testing, so it stays out of the
                    way of the Sound/Vibration/Language rows above until a
                    tester actually asks for it. */}
                <button
                  type="button"
                  className="settings-section-title settings-devtoggle"
                  aria-expanded={devOptionsOpen}
                  onClick={() => setDevOptionsOpen((open) => !open)}
                >
                  GameDevOption
                  <Glyph
                    name="chevron-down"
                    className={`icon-glyph settings-devtoggle-chevron${devOptionsOpen ? " is-open" : ""}`}
                  />
                </button>
                {devOptionsOpen && (
                <>
                {/* Two per row, smaller — these six are all "one tap, no
                    typing" rows, so pairing them up reads fine at half width.
                    The two rows below that take a typed value (Jump to
                    level, Day offset) and "Reset entire game" stay full
                    width: an input needs the room, and the reset stays big
                    and separate on purpose (see its own comment). */}
                <div className="settings-devlink-grid">
                  <a href="/editor" className="settings-devlink">
                    <Glyph name="pencil" /> Level editor
                  </a>
                  {/* Paired with "Level editor" above (2026-09g ask,
                      "unlock all map nên ngang hàng với level editor") —
                      both are ways to get straight at every level, one by
                      building, one by unlocking. Clears every level in
                      `playables`, front to back, so the gallery's own
                      sequential-unlock check
                      (`hasClearedLevel(playables[index-1].level.id)` above)
                      reads every card as open at once — for eyeballing the
                      whole gallery grid without playing up to it level by
                      level. Marks first-clear (and its gold payout) for each
                      one, same as actually winning it would; that is the
                      simplest way to make `hasClearedLevel` true. Reloads
                      immediately after, same as `resetEntireGame`/
                      `applyDevDateOffset` above: `hasClearedLevel` is read
                      straight from localStorage in the gallery's render, not
                      from React state, so nothing here would otherwise
                      trigger a re-render that shows it. */}
                  <button
                    type="button"
                    className="settings-devlink"
                    onClick={() => {
                      for (const entry of playables) markLevelCleared(entry.level.id);
                      window.location.reload();
                    }}
                  >
                    <Glyph name="target" className="icon-glyph" /> Unlock all maps
                  </button>
                  <button type="button" className="settings-devlink" onClick={() => addGold(500)}>
                    <CoinIcon /> +500 gold
                  </button>
                  <button type="button" className="settings-devlink" onClick={() => resetGold()}>
                    <CoinIcon /> Reset gold
                  </button>
                  {/* `setHearts` re-reads storage immediately rather than
                      waiting for the 1-second timer/`heartsStoreVersion`
                      effect, so the HUD chip updates the instant this is
                      tapped. */}
                  <button
                    type="button"
                    className="settings-devlink"
                    onClick={() => { spendHeart(devNow().getTime()); setHearts(getHeartsState(devNow().getTime())); }}
                  >
                    <HeartIcon /> -1 heart
                  </button>
                  <button
                    type="button"
                    className="settings-devlink"
                    onClick={() => { resetHearts(); setHearts(getHeartsState(devNow().getTime())); }}
                  >
                    <HeartIcon /> Refill hearts
                  </button>
                  {/* Fills the bar to a claimable chest in one tap, without
                      having to win five levels first — the only way to reach
                      the reward screen (and the emerald behind it) while
                      testing. */}
                  <button type="button" className="settings-devlink" onClick={() => fillRewardTrack()}>
                    <ChestIcon /> Full reward track
                  </button>
                  <button type="button" className="settings-devlink" onClick={() => resetRewardTrack()}>
                    <EmeraldIcon /> Reset reward track
                  </button>
                  {/* Mirror of "Relock skins" below: owns every skin in
                      `COSTUME_ORDER` instead of putting them back behind
                      their price, for previewing the skin picker fully
                      unlocked without clearing the levels that normally
                      hand them out. Reloads for the same reason the row
                      above does. */}
                  <button
                    type="button"
                    className="settings-devlink"
                    onClick={() => {
                      for (const id of COSTUME_ORDER) unlockCostume(id);
                      window.location.reload();
                    }}
                  >
                    <EmeraldIcon /> Acquire all skins
                  </button>
                  {/* Puts every priced skin back behind its price. Does not
                      refund anything — it exists to get back to the locked
                      state the buy flow starts from, not to undo a purchase. */}
                  <button
                    type="button"
                    className="settings-devlink"
                    onClick={() => {
                      resetOwnedCostumes();
                      setSelectedCostume(getSelectedCostume());
                      setCostume(getSelectedCostume());
                    }}
                  >
                    <EmeraldIcon /> Relock skins
                  </button>
                </div>
                {/* Jumps straight into any level by its id (the number the
                    HUD and level name already show), skipping the gallery's
                    own unlock/progression check — the one place in this
                    section that needs a value typed in rather than a single
                    tap, so it is a row of its own instead of a plain
                    `.settings-devlink` button. */}
                <div className="settings-devlink settings-devlink-goto">
                  <Glyph name="target" className="icon-glyph" />
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={playables.length}
                    placeholder={`Level (1-${playables.length})`}
                    aria-label="Jump to level number"
                    value={devLevelInput}
                    onChange={(event) => setDevLevelInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") jumpToLevel(); }}
                    className="settings-devlink-input"
                  />
                  <button type="button" className="settings-devlink-go" onClick={jumpToLevel}>
                    Go
                  </button>
                </div>
                {/* A day offset, not a real calendar picker — the only thing
                    daily-login logic (`getDailyLoginState`/`claimDailyLogin`
                    in economy.ts, via `devNow()`) actually needs to be
                    exercised is "today plus/minus N days", so that is the one
                    value this row takes. Reloads immediately on Apply — see
                    `applyDevDateOffset`'s own comment for why a React state
                    update alone would not actually move "today" everywhere
                    that reads it. */}
                <div className="settings-devlink settings-devlink-goto">
                  <Glyph name="calendar" className="icon-glyph" />
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Day offset (e.g. 1, -1)"
                    aria-label="Daily-login test date offset, in days"
                    value={devDateOffsetInput}
                    onChange={(event) => setDevDateOffsetInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") applyDevDateOffset(); }}
                    className="settings-devlink-input"
                  />
                  <button type="button" className="settings-devlink-go" onClick={applyDevDateOffset}>
                    Apply
                  </button>
                </div>
                {/* One tap that grants everything at once, instead of
                    working through the grid above row by row: every level
                    (same as "Unlock all maps"), every skin (same as
                    "Acquire all skins"), and a generous stack of every
                    booster charge. Marking every level cleared includes
                    `HEARTS_UNLOCK_LEVEL_ID`, so hearts (and every heart-gated
                    Bundle/Special Offer row in the Shop) come unlocked too
                    as a side effect — nothing else here needs to touch that
                    flag directly. Kept out of the "one tap, no typing" grid
                    above and given the accent colour (`.is-highlight`),
                    positioned right before "Reset entire game" (2026-09g
                    ask: "all content nên phía reset entire game") since the
                    two rows are each other's opposite — grant everything vs.
                    wipe everything — and reads clearest sitting together. */}
                <button
                  type="button"
                  className="settings-devlink is-highlight"
                  onClick={() => {
                    for (const entry of playables) markLevelCleared(entry.level.id);
                    for (const id of COSTUME_ORDER) unlockCostume(id);
                    for (const type of BOOSTER_TYPES) addBoosterCharges(type, 50);
                    window.location.reload();
                  }}
                >
                  <ChestIcon /> Unlock all content
                </button>
                {/* The whole-game factory reset — every persisted piece of
                    progress this section's other buttons reset one at a
                    time, in one tap, plus the date tool above (see
                    `resetEntireGame`'s own comment for the full list).
                    Last in the list and its own colour (`.is-danger` below)
                    so it does not read as just another "reset gold"/"relock
                    skins" row a tester might tap without thinking — this one
                    actually starts the browser over as a brand-new install. */}
                <button type="button" className="settings-devlink is-danger" onClick={resetEntireGame}>
                  <Glyph name="trash" className="icon-glyph" /> Reset entire game
                </button>
                </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* WIN and FAIL are two different screens now, not one card with a
            swapped headline — WIN is the celebration (rays, a bouncier pop,
            Continue straight into the next level, an X to leave instead of a
            second full-width button) and FAIL stays the plain status readout
            it always was (Play again / Home). Reward money and its fly-to-
            badge animation never appear here either way — see
            `pendingHomeReward`'s own comment for why that waits for Home. */}
        {state.result?.kind === "WIN" && !winReveal && !skinTryPrompt && (
          <div className="result-screen is-win" role="dialog" aria-modal="true">
            {/* Purely ambient — behind the card (`.result-card.is-win` keeps
                its own `z-index: 1`), so it never competes with the card for
                taps. Covers the whole screen, not just the strip behind the
                card — see WIN_CONFETTI's own comment. */}
            <div className="win-confetti" aria-hidden="true">
              {WIN_CONFETTI.map((piece, i) => (
                <span
                  key={i}
                  className="win-confetti-piece"
                  style={{
                    left: `${piece.left}%`,
                    width: `${piece.size}px`,
                    height: `${piece.size * 1.5}px`,
                    animationDelay: `${piece.delay}s`,
                    animationDuration: `${piece.duration}s`,
                    background: piece.color,
                    "--drift": `${piece.drift}px`,
                  } as React.CSSProperties}
                />
              ))}
            </div>

            <div className="win-frame">
              {/* The two party horns and the cannon badge from
                  `/public/decorate` — purely decorative dressing for the
                  frame-cleared moment, so all three sit outside the card's
                  own `overflow: hidden` in sibling layers instead of inside
                  it. Two layers, not one, because the reference layout puts
                  the assets on either side of the card in depth: the cannon
                  is BEHIND it (centred on the top edge, its base tucked out
                  of sight behind the mint header so it reads as standing
                  behind the card — it must never cover the headline), the
                  horns are IN FRONT (anchored past the bottom corners,
                  overlapping the card's lower edge, firing outward/up).
                  Neither horn is mirrored — each is already drawn facing the
                  right way for its own corner. */}
              <div className="win-decor is-behind" aria-hidden="true">
                <span className="win-decor-cannon">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/decorate/DecorateFInishLevel3.png" alt="" />
                </span>
              </div>

              <div className="win-decor is-front" aria-hidden="true">
                <span className="win-decor-horn is-left">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/decorate/DecorateFInishLevel2.png" alt="" />
                </span>
                <span className="win-decor-horn is-right">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/decorate/DecorateFInishLevel1.png" alt="" />
                </span>
              </div>

              <div className="result-card is-win">
                <div className="result-card-header">
                  <h2>{s.frameCleared}</h2>
                  {(playingZen || onboardingLockLifted) && (
                    <button type="button" className="result-close-btn" onClick={goHome} aria-label={s.backToHome}>
                      <CancelIcon />
                    </button>
                  )}
                </div>
                <div className="result-card-body">
                  {/* Zen Mode pays no gold at all — its own quiet line
                      instead of "+0 gold", which would read as a shortfall
                      rather than the deliberate "not the point" it is. */}
                  {playingZen ? (
                    <p className="result-gold-earned">{s.zenCleared}</p>
                  ) : (
                    <p className="result-gold-earned">
                      <CoinIcon /> {s.goldEarned(wonGold)}
                    </p>
                  )}
                  {hasNextLevel && (
                    <div className="result-actions">
                      {/* A win that just made a progression skin eligible
                          (`pendingLevelUnlock`) holds Continue back one more
                          tap — instead of moving on immediately (or the old
                          flow's auto-equip-and-celebrate), it opens
                          `skinTryPrompt` and lets the player answer for
                          themselves. Every other win continues the same way
                          it always has, running `triggerLevelFtue` for the
                          level about to open — a report that level 3's
                          booster tutorial never showed when reached via
                          Continue (only via Home's Play tap) traced back to
                          this exact button never running that check at all;
                          see the function's own comment. */}
                      <button
                        type="button"
                        onClick={() => {
                          if (pendingLevelUnlock) {
                            setSkinTryPrompt(pendingLevelUnlock);
                            setPendingLevelUnlock(null);
                            return;
                          }
                          openLevel(levelIndex + 1);
                          triggerLevelFtue(expandLevelForPixelBoard(playables[levelIndex + 1].level));
                        }}
                      >
                        {s.continueLabel}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* The "you unlocked X — want to try it now?" prompt (on request —
            replaces the old flow's immediate auto-equip-and-celebrate on
            Continue, which never gave the player a "not now"). "No" just
            continues into the next level exactly like an ordinary win, same
            as `hasNextLevel`'s Continue button above — the skin stays owned
            but earned-rather-than-unlocked (its Skin screen card now shows a
            live Unlock button instead of the disabled Progression label,
            since its own level just cleared). "Equip" leaves the level
            entirely via `goHome()` and lands on the Skin screen with this
            skin already previewed, so the player finishes the unlock
            themselves (`unlockProgressionSkin`) and gets the same
            spin-and-glow reveal a Shop purchase gets. */}
        {state.result?.kind === "WIN" && !winReveal && skinTryPrompt && (
          <div className="result-screen is-win" role="dialog" aria-modal="true" aria-label={s.skinTryQuestion(s.costumeName(skinTryPrompt))}>
            <div className="win-frame">
              <div className="result-card is-win">
                <div className="result-card-header">
                  <h2>{s.skinTryQuestion(s.costumeName(skinTryPrompt))}</h2>
                </div>
                <div className="result-card-body">
                  <div className="result-actions">
                    <button
                      type="button"
                      onClick={() => {
                        const id = skinTryPrompt;
                        setSkinTryPrompt(null);
                        setPreviewCostume(id);
                        goHome();
                        setTab("skin");
                      }}
                    >
                      {s.equipLabel}
                    </button>
                    <button
                      type="button"
                      className="is-quiet"
                      onClick={() => {
                        setSkinTryPrompt(null);
                        openLevel(levelIndex + 1);
                        triggerLevelFtue(expandLevelForPixelBoard(playables[levelIndex + 1].level));
                      }}
                    >
                      {s.noLabel}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {state.result?.kind === "FAIL" && (
          <div className="result-screen" role="dialog" aria-modal="true">
            <div className="result-card">
              <h2>{s.outOfShots}</h2>
              <p>{s.clearedPercent(cleared, state.remainingCells)}</p>
              <div className="result-actions">
                <button type="button" onClick={() => { if (tryStartAttempt()) restart(); }}>
                  {s.playAgain}
                </button>
                <button type="button" className="is-quiet" onClick={goHome}>
                  {s.home}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* The tutorial overlay: opened once automatically, by `startPlaying`,
            the first time a level with `tutorial` content is played on this
            browser. Sits above everything else in `.game-frame` (result
            screen included, though the two are never open together — a
            fresh board has no result yet) so the very first shot is never
            taken blind. */}
        {playing && tutorialOpen && level.tutorial && (
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
                  {s.gotIt}
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
            Now a real calendar grid for the current month (`getDailyLoginCalendar`)
            instead of a 7-chip streak strip — every cell IS a real date, so
            "tomorrow" in the grid is actually tomorrow. Monday-Friday are
            plain cells (all worth the same flat gold, no amount shown any
            more — see `DAILY_LOGIN_REWARDS` in economy.ts), Saturday/Sunday
            are the one special (gold-washed) tier but pay NO gold at all —
            only the free booster charge, shown as its own icon.
            `.is-past`/`.is-today`/`.is-claimed` carry all the status a line
            of text used to repeat in words. No "Later"/"Close" text button:
            the corner `.result-close-btn` is the one dismiss action, same as
            the WIN card's own X. */}
        {!playing && !chest && dailyLogin && (
          <div
            className="result-screen"
            role="dialog"
            aria-modal="true"
            aria-label={s.dailyLoginAria}
            // A tap on the scrim itself (not one that bubbled up from the
            // card) dismisses the same way the corner X does — the standard
            // "tap outside a sheet to close it" gesture, on top of that X
            // rather than instead of it.
            onClick={(event) => {
              if (event.target === event.currentTarget) setDailyLoginOverride(null);
            }}
          >
            <div className="daily-login-frame">
              <div className="result-card daily-login-card">
                <div className="daily-login-header">
                  <h2>{s.dailyLoginTitle}</h2>
                  <button
                    type="button"
                    className="result-close-btn"
                    onClick={() => setDailyLoginOverride(null)}
                    aria-label={s.close}
                  >
                    <CancelIcon />
                  </button>
                </div>
                <div className="daily-login-header-strip" />
                <div className="daily-login-body">
                  {/* Derived from `dailyCalendar` itself rather than a fresh
                      `devNow()` call — `devNow()` reads the dev date-offset
                      tool's `localStorage` entry, invisible to the server
                      (`typeof window === "undefined"` there), so calling it
                      directly here would render a different month during
                      SSR than the client hydrates with (a real hydration
                      mismatch) the moment that offset is non-zero. Any
                      current-month cell's own `date` is exactly as
                      hydration-safe as `dailyCalendar` already is — empty
                      (so no title) until the real grid swaps in right after
                      mount, same as every other value on this modal. */}
                  {(() => {
                    const firstCell = dailyCalendar[0];
                    if (!firstCell) return null;
                    return <div className="daily-login-month-title">{s.monthTitle(new Date(`${firstCell.date}T12:00:00`))}</div>;
                  })()}
                  {/* A dark, square-celled grid (per the ask — "grid đen, ô
                      vuông", "phóng to ô") that SCROLLS on its own
                      (`overflow-y: auto`, capped height) so the player swipes
                      down to see further days instead of everything being
                      squeezed to fit unscrolled. 5 cells a row now, not 7 —
                      no weekday header any more ("không đánh Mon->Sun, chỉ
                      đánh dấu ngày"): each cell's own day-of-month, as an
                      ordinal ("1st"/"2nd"/"13th" — `ordinalDay`), is the only
                      date label, and with 5 columns instead of 7 in the same
                      card width each cell is visibly bigger. No coin amount
                      is shown any more either — every weekday pays the same
                      flat gold and the weekend pays none at all, so a
                      per-cell number would not say anything worth reading. */}
                  <div className="daily-login-calendar-scroll">
                    <div className="daily-login-calendar">
                      {dailyCalendar.map((cell) => {
                        // Mon-Fri are plain now — no perk, no amount shown
                        // (every weekday pays the same flat gold, so there is
                        // nothing worth calling out per cell). The weekend
                        // (Sat/Sun) carries the gold cell wash — that alone
                        // marks it as the special tier, no "WEEKEND" text
                        // label needed on top — plus a free booster charge
                        // (`dailyLoginBoosterPerk`: Saturday grants Radius
                        // Overcharge, Sunday grants Prism Shot, taking turns
                        // across the weekend instead of both days handing out
                        // the same one). The month's 13th is its own "lucky
                        // day" on top of that split: it grants Chain Sort
                        // regardless of weekday. Either way the perk is shown
                        // as the booster's own icon, large and centred (no
                        // coin glyph to share the cell with any more), rather
                        // than its name spelled out.
                        const isWeekend = cell.weekday >= 5;
                        const className = [
                          "daily-login-cell",
                          cell.isToday && "is-today",
                          cell.isPast && "is-past",
                          cell.isFuture && "is-future",
                          cell.isClaimed && "is-claimed",
                          isWeekend && "is-weekend",
                        ].filter(Boolean).join(" ");
                        return (
                          <div
                            key={cell.date}
                            className={className}
                            // The coin-flight animation's launch point
                            // (`claimDailyLoginWithFlight`) — on the cell
                            // itself rather than the coin glyph below, since
                            // a booster-perk cell has no coin glyph to anchor
                            // to at all.
                            ref={cell.isToday ? todayCoinRef : undefined}
                          >
                            <span className="daily-login-cell-day">{ordinalDay(cell.dayOfMonth)}</span>
                            {cell.isClaimed ? (
                              <span className="daily-login-cell-check" aria-hidden="true">✓</span>
                            ) : cell.boosterPerk ? (
                              <span
                                className="daily-login-perk-icon"
                                aria-label={s.dailyLoginPerkTag(s.boosterName(cell.boosterPerk))}
                                title={s.dailyLoginPerkTag(s.boosterName(cell.boosterPerk))}
                              >
                                <BoosterIcon type={cell.boosterPerk} />
                              </span>
                            ) : (
                              cell.reward > 0 && (
                                // The coin glyph alone, no amount printed
                                // under/next to it any more (per the
                                // 2026-09e ask) — every weekday pays the
                                // same flat gold, so the icon alone is
                                // enough to say "this day pays coins".
                                <span className="daily-login-cell-coin" aria-hidden="true">
                                  <CoinIcon />
                                </span>
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {dailyLogin.streak > 1 && (
                    <div className="daily-login-streak">{s.dailyLoginStreak(dailyLogin.streak)}</div>
                  )}
                  {/* Claim only — no "Later"/"Close" text button any more, the
                      corner X above is the one dismiss action every card gets
                      for free. Already claimed today: nothing to claim, so no
                      bottom action at all, just the X. */}
                  {!dailyLogin.claimedToday && (
                    <div className="result-actions">
                      <button type="button" onClick={claimDailyLoginWithFlight}>
                        {/* Weekend: no gold at all (`dailyLogin.reward` is 0),
                            the booster is the entire reward, so the button
                            names that instead of "Claim 0 coins". */}
                        {dailyLogin.reward > 0
                          ? s.claimCoins(dailyLogin.reward)
                          : s.claimBooster(s.boosterName(dailyLogin.boosterPerk ?? "prismShot"))}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
