"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  dailyLoginReward,
  DAILY_LOGIN_REWARDS,
  devNow,
  getDailyLoginState,
  getDevDateOffsetDays,
  getWallet,
  hasClearedLevel,
  levelGoldReward,
  markLevelCleared,
  resetClearedLevels,
  resetDailyLogin,
  resetGold,
  resetWallet,
  setDevDateOffsetDays,
  SERVER_REWARD_TRACK,
  SERVER_WALLET,
  subscribeWallet,
  type RewardTrackState,
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
import type { BoosterType, SandColor, SandGameState, SandLevelConfig } from "./game/sand-types";
import { advanceLoading, finishLoading } from "./loading-screen";
import { getLanguage, LANGUAGES, LANGUAGE_NAME, setLanguage, subscribeLanguage, t, type Strings } from "./i18n";

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

// Booster name/description copy (booster-radius-prism-spec.md §7.1's toast
// language, and the Shop's one-line pitch) now lives in i18n.ts as
// `s.boosterName`/`s.boosterDesc` — see `Strings` there — so both follow
// whichever language is current instead of being fixed English records.

/**
 * The Shop's Gems tab — real-money offers, none of it wired to an actual
 * payment processor yet (see `notifyIapComingSoon` at the call site).
 * `wallet.gems` itself is a display-only starter balance (`STARTER_GEMS` in
 * economy.ts) until something in the game actually spends it, same as gold
 * before boosters made it real.
 */
type SpecialOffer = { id: string; name: string; tag: string; gems: number; coins?: number; bonus?: string; price: string };
const SPECIAL_OFFERS: readonly SpecialOffer[] = [
  { id: "starter", name: "Islander's Starter Pack", tag: "First purchase", gems: 500, coins: 1200, price: "$4.99" },
  { id: "weekend", name: "Weekend Gem Rush", tag: "Weekend only", gems: 1400, bonus: "+35% extra", price: "$9.99" },
];

/** Each bundle sells both currencies together — gems, the hard currency the
 * Gems tab otherwise sells alone, plus a coin top-up so a single purchase
 * also covers something spendable today. */
type Bundle = { id: string; gems: number; coins: number; bonus?: string; flag?: string; price: string };
const BUNDLES: readonly Bundle[] = [
  { id: "b1", gems: 80, coins: 400, price: "$0.99" },
  { id: "b2", gems: 500, coins: 2500, bonus: "+10%", price: "$4.99" },
  { id: "b3", gems: 1200, coins: 6000, bonus: "+20%", flag: "Most popular", price: "$9.99" },
  { id: "b4", gems: 2600, coins: 13000, bonus: "+35%", price: "$19.99" },
  { id: "b5", gems: 7000, coins: 35000, bonus: "+50%", flag: "Best value", price: "$49.99" },
];

/** Coin-only packs, priced the way mobile-game coin ladders usually are:
 * $0.99 up to $99.99, each tier's bonus a little steeper than the last. */
type CoinPack = { id: string; coins: number; bonus?: string; flag?: string; price: string };
const COIN_PACKS: readonly CoinPack[] = [
  { id: "c1", coins: 1_000, price: "$0.99" },
  { id: "c2", coins: 2_200, price: "$1.99" },
  { id: "c3", coins: 6_000, bonus: "+10%", price: "$4.99" },
  { id: "c4", coins: 13_000, bonus: "+20%", price: "$9.99" },
  { id: "c5", coins: 28_000, bonus: "+30%", flag: "Popular", price: "$19.99" },
  { id: "c6", coins: 80_000, bonus: "+45%", price: "$49.99" },
  { id: "c7", coins: 180_000, bonus: "+60%", flag: "Best value", price: "$99.99" },
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
 * costume (`costumes.ts`). `customize` is named here because the bar it
 * belongs to is being built now, but nothing behind it exists yet — it says
 * so when opened rather than pretending.
 */
const HUB_TABS = ["shop", "skin", "home", "gallery", "customize"] as const;
type HubTab = (typeof HUB_TABS)[number];

/** `HUB_TAB_NAME`/`HUB_TAB_BLURB`'s replacement, built inside the component
 * from `s` (see `i18n.ts`) rather than kept as module-level constants — the
 * name and blurb have to follow whichever language is current. `shop` and
 * `skin` have no blurb read at runtime any more (they have real panels now)
 * but keep an entry so this stays a total `Record<HubTab, string>`. */
function hubTabNames(s: Strings): Record<HubTab, string> {
  return { shop: s.tabShop, skin: s.tabSkin, home: s.tabHome, gallery: s.tabGallery, customize: s.tabCustomize };
}
function hubTabBlurbs(s: Strings): Record<HubTab, string> {
  return { shop: "", skin: "", home: "", gallery: "", customize: s.customizeBlurb };
}

/** One small shape set per tab (Gallery and Customize — the other three now
 * use a real photographic asset instead, see `TAB_PHOTO_ICON` below), line
 * art at rest and filled solid the instant its tab is active — a single
 * toggle in globals.css
 * (`.hub-nav-icon`'s `fill`/`stroke`, flipped by `.is-active`) rather than
 * two different icons, so every path here is drawn once and has to work
 * both ways: recognisable as an outline (no individual `fill`/`stroke` on
 * any path — they inherit the toggle from the `<svg>` itself) and still
 * read as a solid silhouette once filled, even though the odd fine line
 * (the palette's paint dabs) is only ever going to show up in the outline
 * version — normal for an outline/filled icon pair, the same way a filled
 * Material icon carries less line detail than its own outline variant.
 * Shapes stay off-centre/off-angle on purpose rather than built from a
 * mirrored primitive. */
/** Tabs whose icon is a real photographic asset (`/public/icons/*.png`)
 * rather than the hand-drawn line art `HubIcon` draws for the rest —
 * Customize is the only one still on that shared path below. Home got the
 * reference house artwork first; Shop, Skin and Gallery followed with their
 * own matching pieces (a shopping cart, a cannon on a coat hanger, a framed
 * picture). */
const TAB_PHOTO_ICON: Partial<Record<HubTab, string>> = {
  home: "/icons/HomeIcon.png",
  shop: "/icons/ShoppingCartIcon.png",
  skin: "/icons/CannonSkinIcon.png",
  gallery: "/icons/GalleryIcon.png",
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

function HubIcon({ tab, active }: { tab: HubTab; active: boolean }) {
  const photoSrc = TAB_PHOTO_ICON[tab];
  if (photoSrc) return <PhotoTabIcon src={photoSrc} active={active} />;
  return (
    <svg className="hub-nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
 * language the player already knows. Real artwork now
 * (`/public/icons/RadiusIncreaseIcon.png`, `/public/icons/PrismChargeIcon.png`)
 * rather than hand-drawn SVG, same as `CancelIcon`/`ReturnMainHubIcon` — one
 * component so the in-play HUD tray and the Shop cards stay on the same
 * glyph automatically.
 */
function BoosterIcon({ type }: { type: BoosterType }) {
  const src = type === "radiusOvercharge" ? "/icons/RadiusIncreaseIcon.png" : "/icons/PrismChargeIcon.png";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`booster-icon${type === "prismShot" ? " is-prism" : ""}`} src={src} alt="" aria-hidden="true" />
  );
}

/** A card icon per cannon costume, drawn in currentColor like the other
 * line-art here — a plain barrel for the classic cannon, the same barrel
 * ringed with rune ticks for the rune cannon, and topped with a small
 * three-point pennant for the hero cannon, so a card reads as "what this
 * skin does" at a glance even without the live 3D model behind it. */
function CostumeIcon({ id }: { id: CostumeId }) {
  const isRune = id === "rune-cannon";
  const isHero = id === "hero-cannon";
  return (
    <svg className={`costume-icon${isRune ? " is-rune" : ""}${isHero ? " is-hero" : ""}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
type ChromeGlyph = "menu" | "sound-on" | "sound-off" | "vibrate" | "globe" | "pencil" | "target" | "trash" | "calendar";

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

/** The reward chest on the home screen's own track button — the flat icon
 * (`/public/icons/ChestIcon.png`). The chest that actually OPENS is not this:
 * it is a 3D rig the engine draws (`chest-model.ts`, built to match this same
 * artwork), so the button and the reward screen show one object in two
 * places rather than two different chests. */
function ChestIcon() {
  return <img className="chest-icon" src="/icons/ChestIcon.png" alt="" aria-hidden="true" />;
}

/** The Shop's hard-currency glyph — a faceted gem, drawn the same way
 * `CoinIcon` is (a flat `currentColor` fill plus a darker line for the
 * facets) so the two currencies read as one family at a glance despite the
 * different shape. */
function GemIcon() {
  return (
    <svg className="gem-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.2 18.4 8 15 20.4H9L5.6 8Z" fill="currentColor" />
      <path
        d="M12 3.2 18.4 8H5.6ZM5.6 8 9 20.4M18.4 8 15 20.4M12 3.2 9 8M12 3.2 15 8"
        fill="none"
        stroke="#1c4d54"
        strokeWidth="1"
        strokeLinejoin="round"
      />
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
    .filter((draft) => draft.importedFromId === undefined)
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
const SERVER_DAILY_LOGIN: DailyLoginState = { day: 0, reward: DAILY_LOGIN_REWARDS[0], claimedToday: false };

let cachedInitialDailyLogin: DailyLoginState | null = null;

function readInitialDailyLogin(): DailyLoginState {
  if (!cachedInitialDailyLogin) cachedInitialDailyLogin = getDailyLoginState(devNow());
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

/** Nothing to subscribe to: the snapshot is read once and never changes. */
const noopSubscribe = () => () => {};

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

  // The engine simulates and reports state at pixel resolution — every number
  // this component reads off `state` (remainingCells above all) is in those
  // terms, so the level it reasons about here has to be expanded the same way,
  // not the small authored blueprint. Expansion is idempotent, so handing this
  // already-expanded config to the engine below costs nothing extra.
  const raw = playables[Math.min(levelIndex, playables.length - 1)]?.level ?? BUILT_IN_LEVELS[0];
  const level = useMemo(() => expandLevelForPixelBoard(raw), [raw]);

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
  // Bumped once per Radius Overcharge impact (`BOOSTER_IMPACT`) — the actual
  // shake is a CSS animation restarted by the effect below keyed on this
  // number, not a class this state directly renders, since the same class
  // held constant across two bumps would not replay the animation on its
  // own (on request: "rung chuyển toàn HUD").
  const [radiusShakeBump, setRadiusShakeBump] = useState(0);
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
  // The Shop's two tabs — Gems (real-money offers/bundles/coin packs, none
  // of it wired to a payment processor yet) and Coins (the booster store
  // above, spending the real, earned-by-playing currency). Coins is the
  // default: it is the one tab that actually does something today.
  const [shopTab, setShopTab] = useState<"gems" | "coins">("coins");
  // A small "not live yet" notice for every Gems-tab buy button — there is no
  // payment processor behind any of them, so tapping one cannot silently do
  // nothing; it has to say why. Its own state rather than reusing `toast`
  // above: `toast` renders inside `.scene-wrap`, which sits underneath the
  // Shop screen's own opaque background and would never be seen from here.
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
  const todayCoinRef = useRef<HTMLSpanElement | null>(null);
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
  /** Claims today's reward, then flies a handful of coins from the day
   * strip's highlighted cell to the hub's gold badge before the number
   * there ticks up — the visual payoff `claimDailyLogin` itself has no
   * opinion on, since `economy.ts` only deals in numbers. */
  const claimDailyLoginWithFlight = useCallback(() => {
    const goldBefore = wallet.gold;
    const claimed = claimDailyLogin(devNow());
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
  // buying more — tapping it jumps straight to the Gems tab's own "Coins"
  // section (real-money packs, `COIN_PACKS`), not just the tab itself, since
  // that section sits below Special Offers and would otherwise need a manual
  // scroll to find. `coinPackSectionRef` is what gets scrolled into view;
  // `scrollToCoinPacks` just remembers the intent across the tab switch
  // (`shopTab` flipping to "gems" unmounts/remounts the Coins tab's content,
  // so the scroll can only happen once that new content exists).
  const coinPackSectionRef = useRef<HTMLDivElement | null>(null);
  const [scrollToCoinPacks, setScrollToCoinPacks] = useState(false);
  const openCoinPacks = useCallback(() => {
    setTab("shop");
    setShopTab("gems");
    setScrollToCoinPacks(true);
  }, []);
  useEffect(() => {
    if (!scrollToCoinPacks || tab !== "shop" || shopTab !== "gems") return;
    coinPackSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollToCoinPacks(false);
  }, [scrollToCoinPacks, tab, shopTab]);
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
  const HUB_TAB_BLURB = hubTabBlurbs(s);
  // The one unified Settings card (see globals.css's own comment on
  // `.settings-screen`) — opened from the same gear button either way,
  // `!playing` (the hub) or mid-play (`.settings-wrap`'s in-play button),
  // so there is exactly one place Sound/Vibration/the level editor live.
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  // version counter) — the Shop panel's price and the daily-login modal's
  // 7-day strip both read `boosterPrice`/`dailyLoginReward` directly during
  // render rather than through `subscribeWallet`, so without this a poll
  // pickup would sit in the module cache unseen until some unrelated
  // re-render happened to read it fresh.
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
  // celebrating, or null the rest of the time. Shared by two triggers now
  // (on request — a level-clear unlock has to get the same reveal a fresh
  // Shop purchase does): `buySkin` sets it from the skin screen, and the
  // "Frame cleared" card's Continue button sets it too, further down, once
  // `pendingLevelUnlock` says a level just unlocked one. Cleared only by
  // `dismissCannonUnlock` (the player's own tap) — there is no timer that
  // closes this on its own, the reveal is meant to hold until they actually
  // move past it.
  const [cannonUnlock, setCannonUnlock] = useState<CostumeId | null>(null);
  // Set alongside `cannonUnlock` only by the level-clear trigger, never by
  // `buySkin` — the level index `dismissCannonUnlock` should open once the
  // reveal closes, instead of just closing it and leaving the player
  // sitting on the "Frame cleared" card underneath. `null` means "this
  // reveal came from the skin screen, just close it" (`buySkin`'s own case).
  const [cannonUnlockAdvanceTo, setCannonUnlockAdvanceTo] = useState<number | null>(null);
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
          // A shot can land on sand and still take nothing — the disc simply
          // found none of its colour in reach. That looks like a bug unless it
          // is said out loud.
          pushToast(s.toastNoColorInRange(s.colorName(event.ammo)), "warn");
          break;
        case "MISS":
          // A shot that never reached sand costs nothing (MISS_IS_FREE_TEMP),
          // and the player has to be told, or a missing shot is the only clue.
          pushToast(event.hitFrame ? s.toastHitFrame : s.toastMissedFrame, "warn");
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
    // Both overlays are already gated on `playing` at the call site, so
    // leaving either `true` here could not leak onto the hub screen — this
    // is just so a level left mid-tutorial/mid-FTUE doesn't quietly resume
    // showing it the instant Play is tapped again, the way it would if a
    // player had actually dismissed it before leaving.
    setTutorialOpen(false);
    setFtueGestureOpen(false);
    setFreezeFtueStep(null);
  }, [level]);

  const openLevel = useCallback((index: number) => {
    setChosenIndex(index);
    setState(createSandGameState(expandLevelForPixelBoard(playables[index].level)));
    setToast(null);
    setArmedBooster(null);
    setRunId((id) => id + 1);
  }, [playables]);

  /** The reveal's own close — only reachable once `cannonUnlockTapReady`, so
   * a tap cannot skip past the name before the prompt inviting one exists.
   * Advances to the next level afterward when this reveal came from a
   * level-clear unlock (`cannonUnlockAdvanceTo` set, by the "Frame cleared"
   * card's own Continue button below) — the skin-screen purchase case
   * (`buySkin`) leaves it `null` and this just closes as it always has. */
  const dismissCannonUnlock = useCallback(() => {
    engine?.stopUnlockCelebration();
    setCannonUnlock(null);
    if (cannonUnlockAdvanceTo !== null) {
      const next = cannonUnlockAdvanceTo;
      setCannonUnlockAdvanceTo(null);
      openLevel(next);
    }
  }, [engine, cannonUnlockAdvanceTo, openLevel]);

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
  }, [devLevelInput, playables, openLevel]);

  /**
   * GameDevOption's "reset entire game" button — every piece of persisted
   * player progress (wallet, first-clears, the daily-login streak, the
   * reward track, owned/equipped skins) back to a brand-new install, plus
   * the dev date-offset tool below so a full reset does not leave "today"
   * quietly nudged. Reloads immediately after rather than trying to patch
   * every already-rendered piece of state by hand — several of these
   * (`cachedInitialDailyLogin`, the reward track's cached snapshot, the
   * wallet cache) are only ever read fresh once per page load, the same
   * reasoning `applyDevDateOffset` below relies on.
   */
  const resetEntireGame = useCallback(() => {
    resetWallet();
    resetClearedLevels();
    resetDailyLogin();
    resetRewardTrack();
    resetOwnedCostumes();
    setDevDateOffsetDays(0);
    try {
      window.localStorage.removeItem(TUTORIALS_SEEN_KEY);
      window.localStorage.removeItem(FREEZE_FTUE_SEEN_KEY);
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
    if (level.ftueGesture) {
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
    if (level.ftueFreezeDemo && level.ftueFreezeTargets?.length
      && !loadSeenFreezeFtue().has(level.id)) {
      markFreezeFtueSeen(level.id);
      setFreezeFtueStep("intro");
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
  // A skin this exact WIN just unlocked (`costumeUnlockedByLevel`), waiting
  // on the "Frame cleared" card's own Continue tap before its reveal shows —
  // see the Continue button below, which is what turns this into the same
  // `cannonUnlock` celebration a Shop purchase gets. Ownership itself is
  // already granted the moment WIN lands (`unlockCostume` below); this is
  // purely "there is a reveal owed".
  const [pendingLevelUnlock, setPendingLevelUnlock] = useState<CostumeId | null>(null);
  if (state.result !== lastHandledResult) {
    // The reward track counts every win, replays included — unlike the gold
    // above, which pays first-clears only. See the reward-track section header
    // in `economy.ts` for why the two differ.
    if (state.result?.kind === "WIN") recordLevelPlayed();
    if (state.result?.kind === "WIN" && markLevelCleared(raw.id)) {
      const granted = getLevelRewardOverride(raw.id) ?? levelGoldReward(computeLevelDifficulty(raw).score);
      addGold(granted);
      suppressGoldSyncRef.current = true;
      setPendingHomeReward((sum) => sum + granted);
      setWonGold(granted);
      // A progression skin tied to this level (`hero-cannon`/level 20 today)
      // is granted right here, on the very win that clears it — same beat as
      // the gold above. The player just does not see it until they tap
      // Continue on the card that is about to show — see `cannonUnlock`.
      const unlockedCostume = costumeUnlockedByLevel(raw.id);
      if (unlockedCostume && !isCostumeOwned(unlockedCostume)) {
        unlockCostume(unlockedCostume);
        setPendingLevelUnlock(unlockedCostume);
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
  // close button (see the result screen below).
  const hasNextLevel = levelIndex + 1 < playables.length;

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
            thing on that frame besides the chest. */}
        {!chest && !cannonUnlock && !winReveal && (
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
            grid; Skin and Customize dropped it on request, to keep those two
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
              aria-label={s.dailyLoginAria}
              title={s.dailyLoginAria}
            >
              <img className="gift-button-icon" src="/icons/LoginIcon.png" alt="" aria-hidden="true" />
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
              Also gated on `!level.ftueGesture`: a level whose one lesson is
              "aim and shoot" should not show a second control nobody has
              explained yet — see `ftueGesture`'s doc comment. */}
          {playing && !level.ftueGesture && !winReveal && (
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
                    aria-label={s.boosterAria(s.boosterName(type), charges)}
                    aria-pressed={armedBooster === type}
                    title={s.boosterAria(s.boosterName(type), charges)}
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
              Rendered here, inside `.scene-wrap`, rather than as a sibling of
              `.result-screen` further down — `engine.screenPointForGrid`
              returns coordinates in `.scene-host`'s own space (the same one
              `.aim-crosshair` is positioned in, both children of this same
              `.scene-wrap`), which sits inset from `.game-frame`'s top edge
              by the HUD bar's height. A sibling of `.result-screen` spans the
              *whole* frame instead, HUD included, so the exact same `left`/
              `top` pixel values would land too high by that inset — this is
              the one spot in the tree where they land in the right place. */}
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
                return (
                  <div
                    className="ftue-freeze-spotlight"
                    style={{ left: `${spot.x}px`, top: `${spot.y}px` }}
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
        </div>

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
            `.hub-panel` bottom sheet floating over the picture. */}
        {homeVisible && !chest && tab !== "skin" && tab !== "shop" && tab !== "gallery" && (
          <div
            className={`hub-screen${playing ? " is-leaving" : ""}`}
            role="group"
            aria-label={s.homeScreenAria}
            aria-hidden={playing || undefined}
          >

            {tab === "home" ? (
              <div className="hub-actions">
                <button
                  type="button"
                  className="hub-play-btn"
                  onClick={startPlaying}
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
            ) : (
              // Not a click-through backdrop: while a section is open, tapping
              // anywhere off it goes back to the picture rather than starting a
              // level the player never chose.
              <button
                className="hub-scrim"
                type="button"
                onClick={() => setTab("home")}
                aria-label={s.closeTab(HUB_TAB_NAME[tab])}
              />
            )}

            {/* Kept off the home tab itself — the cannon and the level name
                would otherwise sit on top of the picture the moment it starts
                turning, which is the one thing this screen is meant to show off. */}
            {tab !== "home" && <h2 className="hub-level-name">{s.levelName(level.name)}</h2>}

            {tab !== "home" && (
              <div className="hub-panel is-empty" role="group" aria-label={HUB_TAB_NAME[tab]}>
                <h3>{HUB_TAB_NAME[tab]}</h3>
                <p>{HUB_TAB_BLURB[tab]}</p>
                <p className="hub-panel-note">{s.notBuiltYet}</p>
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
                <p className="cannon-unlock-text" aria-hidden="true">{s.youUnlocked(s.costumeName(cannonUnlock))}</p>
                {cannonUnlockTapReady && (
                  <p className="cannon-unlock-tap" aria-hidden="true">{s.tapToContinue}</p>
                )}
              </div>
            )}

            {/* One button, three jobs, in the order a player meets them: Buy
                (locked), Select (owned but not worn), Selected (worn). Buying
                equips in the same step (`buySkin`), so the Buy state never
                hands back to a Select the player then has to tap again. A
                wallet that cannot afford it still gets a live button — the
                confirm dialog is where "not enough" is said, rather than a
                dead control with no explanation on it. */}
            {cannonUnlock ? null : !previewOwned && previewUnlockLevel !== undefined ? (
              // Not for sale at any price — no Buy action, just the same
              // "Progression" word the grid card's own price pill shows for
              // this skin, so the two spots on this screen where a price
              // would normally appear agree with each other.
              <div className="skin-equip is-progression" aria-disabled="true">
                <span className="skin-equip-label">{s.progressionLabel}</span>
              </div>
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
                            ? s.progressionLockedSuffix(unlockLevel)
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
                            className={`skin-card-icon${def.flavor === "magic" ? " is-magic" : ""}${id === "hero-cannon" ? " is-hero" : ""}`}
                          >
                            <CostumeIcon id={id} />
                          </span>
                        )}
                      {owned
                        ? costume === id && <span className="skin-card-tick" aria-hidden="true">✓</span>
                        : unlockLevel !== undefined ? (
                          <span className="skin-card-price is-progression" aria-hidden="true">
                            {s.progressionLabel}
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
                // above: a designer's CSV override, or the difficulty
                // formula). Shown even before it unlocks, as a teaser.
                const isMilestone = entry.level.id % 10 === 0;
                const milestoneReward = isMilestone
                  ? getLevelRewardOverride(entry.level.id) ?? levelGoldReward(computeLevelDifficulty(entry.level).score)
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

        {/* The Shop: a full-screen takeover now, same footing as the skin
            picker above rather than a small `.hub-panel` card floating over
            the picture — the hub screen behind it is unmounted entirely
            while this is up (see the `tab !== "shop"` guard on it). One card
            per booster: the name, a rounded-square frame holding a circle
            with that booster's own icon (`BoosterIcon`, the exact glyph the
            in-play HUD tray and the aim ring already use — no separate shop
            art), and a price pill below the frame (denomination + coin icon,
            not a floating row) — the design as sketched, not the old
            icon/name/price row. No close button of its own, same reasoning
            as the skin picker: `.hub-nav` stays mounted over this screen
            too, so tapping any other tab is how you leave. */}
        {tab === "shop" && (
          <div className="shop-screen" role="dialog" aria-label={s.shopTitle}>
            <div className="shop-heading">
              <h2>{s.shopTitle}</h2>
              {/* Only shown on the Gems tab — gems have no other readout
                  anywhere else in the game yet (unlike gold's persistent
                  `.hub-gold-badge`, top-left on every hub screen including
                  this one), so there is no "always on" corner for it to
                  live in instead. */}
              {shopTab === "gems" && (
                <div className="shop-gem-badge" aria-label={s.gemsAria(wallet.gems)}>
                  <GemIcon />
                  <strong>{wallet.gems}</strong>
                </div>
              )}
            </div>

            <div className="shop-tabs" role="tablist" aria-label={s.shopCurrencyTabsAria}>
              <button
                type="button"
                role="tab"
                aria-selected={shopTab === "gems"}
                className={`shop-tab-btn is-gems${shopTab === "gems" ? " is-active" : ""}`}
                onClick={() => setShopTab("gems")}
              >
                {s.gemsTab}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={shopTab === "coins"}
                className={`shop-tab-btn is-coins${shopTab === "coins" ? " is-active" : ""}`}
                onClick={() => setShopTab("coins")}
              >
                {s.coinsTab}
              </button>
            </div>

            {/* Its own scroll container, separate from `.shop-screen` itself
                (which no longer scrolls — see that class's own comment) — so
                the heading/tabs above stay put while a tab's content scrolls
                underneath, and `.shop-iap-toast` below can pin to the screen
                without scrolling away with whatever panel is open. */}
            <div className="shop-scroll">
            {/* The Gems tab: real-money offers, bundles and coin packs. None
                of it is wired to an actual payment processor — there is no
                account or server in this prototype (see economy.ts's own
                top-of-file note) — so every price pill here just surfaces
                `notifyIapComingSoon`'s toast instead of charging anything or
                moving a balance. Gems themselves are the one currency nothing
                in the game spends yet, per the brief: sold, not spendable. */}
            {shopTab === "gems" && (
              <div className="shop-panel">
                <div className="shop-section">
                  <div className="shop-section-head">
                    <h3>{s.specialOffers}</h3>
                    <p>{s.limitedTimeBundles}</p>
                  </div>
                  {/* Stacked top to bottom, not a side-scrolling rail — every
                      offer is visible without a swipe, the same "no hidden
                      shelf" reasoning the Bundles list below already follows. */}
                  <div className="offer-stack">
                    {SPECIAL_OFFERS.map((offer) => (
                      <div key={offer.id} className={`offer-card is-${offer.id === "starter" ? "teal" : "green"}`}>
                        <span className="offer-tag">{s.offerTag(offer.id)}</span>
                        <h4>{s.offerName(offer.id)}</h4>
                        <div className="offer-contents">
                          <GemIcon /> {offer.gems.toLocaleString("en-US")}
                          {offer.coins != null && (
                            <>
                              <span className="offer-plus">+</span>
                              <CoinIcon /> {offer.coins.toLocaleString("en-US")}
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

                <div className="shop-section">
                  <div className="shop-section-head">
                    <h3>{s.bundlesTitle}</h3>
                    <p>{s.gemsAndCoinsTogether}</p>
                  </div>
                  <div className="bundle-list">
                    {BUNDLES.map((bundle) => (
                      <div key={bundle.id} className={`bundle-row${bundle.flag ? " is-best" : ""}`}>
                        <div className="bundle-icon"><GemIcon /></div>
                        <div className="bundle-mid">
                          {bundle.flag && <div className="bundle-flag">{s.offerFlag(bundle.flag)}</div>}
                          <div className="bundle-amount">
                            {bundle.gems.toLocaleString("en-US")} {s.gemsSuffix}
                            {bundle.bonus && <span className="bundle-bonus">{bundle.bonus}</span>}
                          </div>
                          <div className="bundle-sub">
                            <CoinIcon /> {bundle.coins.toLocaleString("en-US")} {s.coinsSuffix}
                          </div>
                        </div>
                        <button type="button" className="bundle-price" onClick={notifyIapComingSoon}>
                          {bundle.price}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

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
              </div>
            )}

            {/* The Coins tab: the original booster shop, unchanged — the one
                real, spendable purchase flow in the game. */}
            {shopTab === "coins" && (
              <div className="shop-panel">
                <div className="shop-grid">
                  {(["radiusOvercharge", "prismShot"] as const).map((type) => {
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
            )}
            </div>

            {/* Pinned to the screen itself, outside `.shop-scroll` above —
                `pushToast`'s own `.sand-toast` cannot be reused here (it
                renders inside `.scene-wrap`, underneath this screen's opaque
                background), and a snackbar that scrolled away with whatever
                panel is open would miss the tap that triggered it. */}
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
                onClick={() => setTab(entry)}
                aria-current={entry === tab ? "page" : undefined}
                aria-label={`${HUB_TAB_NAME[entry]}${entry === "skin" && unseenSkins.length > 0 ? s.skinTabHasOfferSuffix : ""}`}
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
                    onClick={() => { setSettingsOpen(false); restart(); }}
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

                <h3 className="settings-section-title">GameDevOption</h3>
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
                  <button type="button" className="settings-devlink" onClick={() => addGold(500)}>
                    <CoinIcon /> +500 gold
                  </button>
                  <button type="button" className="settings-devlink" onClick={() => resetGold()}>
                    <CoinIcon /> Reset gold
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
        {state.result?.kind === "WIN" && !winReveal && (
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
                  <button type="button" className="result-close-btn" onClick={goHome} aria-label={s.backToHome}>
                    <CancelIcon />
                  </button>
                </div>
                <div className="result-card-body">
                  <p className="result-gold-earned">
                    <CoinIcon /> {s.goldEarned(wonGold)}
                  </p>
                  {hasNextLevel && (
                    <div className="result-actions">
                      {/* A win that just unlocked a progression skin
                          (`pendingLevelUnlock`) holds Continue back one more
                          tap — instead of moving on immediately, it equips
                          the new cannon and hands off to the same
                          `cannonUnlock` spin-and-glow reveal a Shop purchase
                          plays (on request — the two are meant to match),
                          with `cannonUnlockAdvanceTo` set so dismissing it is
                          what actually calls `openLevel`. Every other win
                          continues the same way it always has. */}
                      <button
                        type="button"
                        onClick={() => {
                          if (pendingLevelUnlock) {
                            setSelectedCostume(pendingLevelUnlock);
                            setCostume(pendingLevelUnlock);
                            setCannonUnlock(pendingLevelUnlock);
                            setCannonUnlockAdvanceTo(levelIndex + 1);
                            engine?.playUnlockCelebration();
                            setPendingLevelUnlock(null);
                            return;
                          }
                          openLevel(levelIndex + 1);
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

        {state.result?.kind === "FAIL" && (
          <div className="result-screen" role="dialog" aria-modal="true">
            <div className="result-card">
              <h2>{s.outOfShots}</h2>
              <p>{s.clearedPercent(cleared, state.remainingCells)}</p>
              <div className="result-actions">
                <button type="button" onClick={restart}>
                  {s.playAgain}
                </button>
                <button type="button" className="is-quiet" onClick={goHome}>
                  {s.home}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* The level-20-style progression reveal — shown once the player has
            tapped Continue on the "Frame cleared" card that just unlocked a
            skin (`pendingLevelUnlock`, set there). On request, this is now
            the SAME spin-and-glow `cannon-unlock-banner` reveal a Shop
            purchase gets (`buySkin`'s own block further down, inside
            `.skin-screen`), not a plain equip/decline dialog — the Continue
            button already equipped the cannon and started
            `playUnlockCelebration()` before setting `cannonUnlock`, so all
            this has to do is show the same banner over the level's own
            scene instead of the skin screen's. `cannonUnlockAdvanceTo` being
            non-null is what distinguishes this trigger from `buySkin`'s (see
            `dismissCannonUnlock`'s own comment) — `playing` on top of that
            just guards against ever rendering both this and the skin
            screen's own copy at once, which should not be reachable anyway
            since the skin screen only mounts on the hub. */}
        {playing && cannonUnlock && cannonUnlockAdvanceTo !== null && (
          <div className="result-screen">
            <div
              className="cannon-unlock-banner"
              role="button"
              tabIndex={0}
              onClick={() => {
                if (cannonUnlockTapReady) dismissCannonUnlock();
              }}
              aria-label={`${s.youUnlocked(s.costumeName(cannonUnlock))}${cannonUnlockTapReady ? ` ${s.tapToContinue}.` : ""}`}
            >
              <p className="cannon-unlock-text" aria-hidden="true">{s.youUnlocked(s.costumeName(cannonUnlock))}</p>
              {cannonUnlockTapReady && (
                <p className="cannon-unlock-tap" aria-hidden="true">{s.tapToContinue}</p>
              )}
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
            The day strip already says everything a status line below it
            used to repeat in words (which day, how much, whether it's
            claimed — `.is-today`/`.is-past` carry that visually), so this
            card is just the strip and the one action that matters — Claim,
            full stop. No "Later"/"Close" text button any more: the corner
            `.result-close-btn` is the dismiss action now, same as the WIN
            card's own X, so a player who does not want to claim today just
            closes the card instead of choosing between two ways to say the
            same thing. */}
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
                  {/* The week reads as three tiers now, not seven identical
                      chips: days 1-3 are dressed as the early "hời" days (a
                      warm value badge, per the ask), 4-6 stay the plain
                      chip the whole strip used to be, and day 7 breaks out
                      into its own full-width hero card below — the one
                      reward the whole week is building toward, sized and
                      coloured so a player cannot mistake it for "just
                      another day". Values are still whatever
                      `DAILY_LOGIN_REWARDS`/the sheet says — this only
                      changes how each tier is dressed, not what it pays. */}
                  <div className="daily-login-strip">
                    {DAILY_LOGIN_REWARDS.slice(0, 6).map((_, index) => {
                      const isToday = index === dailyLogin.day;
                      const isPast = index < dailyLogin.day || (isToday && dailyLogin.claimedToday);
                      const isValue = index < 3;
                      return (
                        <div
                          key={index}
                          className={`daily-login-day${isValue ? " is-value" : ""}${isToday ? " is-today" : ""}${isPast ? " is-past" : ""}`}
                        >
                          {isValue && <span className="daily-login-value-tag" aria-hidden="true">{s.greatValue}</span>}
                          <span className="daily-login-label">{s.dayLabel(index + 1)}</span>
                          <span ref={isToday ? todayCoinRef : undefined}>
                            <CoinIcon />
                          </span>
                          <strong>{dailyLoginReward(index)}</strong>
                        </div>
                      );
                    })}
                  </div>
                  {(() => {
                    const index = 6;
                    const isToday = index === dailyLogin.day;
                    const isPast = index < dailyLogin.day || (isToday && dailyLogin.claimedToday);
                    return (
                      <div
                        className={`daily-login-hero${isToday ? " is-today" : ""}${isPast ? " is-past" : ""}`}
                      >
                        <span className="daily-login-hero-tag" aria-hidden="true">{s.bestReward}</span>
                        <span className="daily-login-hero-body">
                          <span className="daily-login-hero-icon" ref={isToday ? todayCoinRef : undefined}>
                            <CoinIcon />
                          </span>
                          <span className="daily-login-hero-text">
                            <span className="daily-login-label">{s.dayLabel(index + 1)}</span>
                            <strong>{dailyLoginReward(index)}</strong>
                          </span>
                        </span>
                      </div>
                    );
                  })()}
                  {/* Claim only — no "Later"/"Close" text button any more, the
                      corner X above is the one dismiss action every card gets
                      for free. Already claimed today: nothing to claim, so no
                      bottom action at all, just the X. */}
                  {!dailyLogin.claimedToday && (
                    <div className="result-actions">
                      <button type="button" onClick={claimDailyLoginWithFlight}>
                        {s.claimCoins(dailyLogin.reward)}
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
