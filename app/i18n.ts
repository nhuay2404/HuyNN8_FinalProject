// The game's two languages — English (the language every string in this file
// used to be hardcoded in) and Vietnamese, the player's own request. Not a
// generic i18n framework: `Strings` below is one flat, hand-written interface
// naming every piece of player-facing copy `SandGame.tsx` renders, and `EN`/
// `VI` are two literal objects satisfying it — the compiler is what keeps them
// in lockstep (a key missing from either fails to typecheck), the same
// contract the sound/haptics preferences already use for their own boolean,
// just wider.
//
// Deliberately excluded: the Settings screen's own `GameDevOption` section
// (level editor link, +500 gold, jump-to-level, ...) — tools for whoever is
// testing the build, never shown to a player choosing a language — and every
// code comment in this file, which no player ever sees either.

import type { BoosterType, SandColor } from "./game/sand-types";

export type Language = "en" | "vi";

export const LANGUAGES: readonly Language[] = ["en", "vi"];

export const LANGUAGE_NAME: Record<Language, string> = {
  en: "English",
  vi: "Tiếng Việt",
};

const STORAGE_KEY = "sand-cannon:v1:language";

function readStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === "vi" ? "vi" : "en";
  } catch {
    // A file:// page or a privacy mode can refuse storage outright; English
    // is the safe default rather than throwing the whole screen blank.
    return "en";
  }
}

let language = readStoredLanguage();
const languageListeners = new Set<() => void>();

export function getLanguage(): Language {
  return language;
}

/** `SandGame.tsx`'s `useSyncExternalStore` subscribe function — fires on any
 * language change, the same shape `subscribeWallet` in economy.ts uses for
 * its own store. Real (not a no-op) on purpose: unlike `boot`/the initial
 * daily-login read, this has to update the whole screen the instant the
 * Settings row is tapped, not just on the next unrelated re-render. */
export function subscribeLanguage(listener: () => void) {
  languageListeners.add(listener);
  return () => languageListeners.delete(listener);
}

export function setLanguage(next: Language) {
  language = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice just will not survive a reload — same fallback every
      // other guarded preference in this game accepts.
    }
  }
  for (const listener of languageListeners) listener();
}

/** Every piece of copy the game renders to a player, in the shape both
 * language packs below have to fill in identically. A plain string is fixed
 * copy; a function is copy built around a value the caller only has at
 * render time (a name, a count, a price). */
export interface Strings {
  // ---- Hub tabs & nav ------------------------------------------------------
  tabShop: string;
  tabSkin: string;
  tabHome: string;
  tabGallery: string;
  tabModes: string;
  sectionsNav: string;
  closeTab: (tabName: string) => string;
  skinTabHasOfferSuffix: string;
  shopTabHasBoosterHintSuffix: string;
  homeTabHasDailyLoginHintSuffix: string;
  notBuiltYet: string;
  modesTitle: string;
  modesBlurb: string;
  /** The Zen Mode card on the Modes screen. */
  zenModeButton: string;
  zenModeBlurb: string;
  /** The Zen level picker's own screen title (replaces `modesTitle` while it's open). */
  zenModeTitle: string;
  /** Shown instead of the Zen level grid when there are no Zen levels yet (should not normally happen — `BUILT_IN_ZEN_LEVELS` always ships at least one — but a build with that array emptied, or every saved Zen draft currently invalid, falls back to this rather than an empty screen). */
  zenEmptyBlurb: string;
  /** The Theme Mode card on the Modes screen — always paired with `notBuiltYet`, never clickable. */
  themeModeButton: string;
  /** The WIN card's own line for a Zen clear, replacing `goldEarned` — Zen Mode pays no gold. */
  zenCleared: string;
  homeScreenAria: string;
  /** The Modes screen's own "?" button — its aria-label/title, and the popup card's title. */
  modesHelpAria: string;
  modesHelpTitle: string;

  // ---- Home / level ----------------------------------------------------------
  levelButtonLabel: (id: number) => string;
  playLevelAria: (levelName: string) => string;
  levelName: (rawName: string) => string;
  progressionChest: string;
  openRewardChestAria: (amount: number) => string;
  rewardTrackAria: (filled: number, total: number) => string;

  // ---- Currency pills --------------------------------------------------------
  coinsAria: (amount: number) => string;
  emeraldAria: (amount: number) => string;
  /** The hearts HUD chip, once unlocked (level 10) — `count` current, `max` the tank size (`MAX_HEARTS`). */
  heartsAria: (count: number, max: number) => string;
  /** The toast when a Play/Restart tap is blocked at 0 hearts — `mmss` the same `m:ss` format. */
  outOfHearts: (mmss: string) => string;

  // ---- Ammo HUD ----------------------------------------------------------------
  colorName: (color: SandColor) => string;
  shotsLeftWithNext: (remaining: string, color: string, next: string) => string;
  shotsLeftOnly: (remaining: string) => string;
  nothing: string;

  // ---- Boosters ----------------------------------------------------------------
  boosterName: (type: BoosterType) => string;
  boosterDesc: (type: BoosterType) => string;
  boosterAria: (name: string, left: number) => string;
  /** The HUD tray button's label once that booster is out of charges
   * mid-match — it becomes a buy-one-charge button instead of an arm
   * button (see `SandGame.tsx`'s `booster-hud`), `price` in gold. */
  boosterBuyAria: (name: string, price: number) => string;
  /** The booster tray's own gold balance chip (SandGame.tsx's `.booster-hud-gold`) — read-only, unlike `coinsAria`'s "buy more" hub chip. */
  boosterTrayGoldAria: (amount: number) => string;
  shotInFlight: string;
  sandSettling: string;
  /** The Freeze Map bar's aria-label — `shots` is how many shots are left
   * with the board frozen. */
  freezeCooldown: (shots: number) => string;
  /** Short label printed directly on the Freeze Map bar itself (on request)
   * — unlike `freezeCooldown` above, this has no shot count baked in, since
   * it sits on screen the whole time the bar is visible rather than being
   * read once by a screen reader. */
  freezeLabel: string;

  // ---- Toasts --------------------------------------------------------------------
  toastNotEnoughEmerald: string;
  // `toastNoColorInRange`/`toastHitFrame`/`toastMissedFrame` used to live
  // here — a NO_MATCH/MISS engine event now flashes `.miss-flash` instead
  // of pushing a text toast (see SandGame.tsx's `missFlashBump`).
  toastLockOpened: string;
  toastBoosterArmed: (name: string) => string;
  toastBoosterCancelled: (name: string) => string;
  toastBoughtBooster: (name: string, qty: number, owned: number) => string;
  toastNotEnoughCoins: string;

  // ---- FTUE gesture ---------------------------------------------------------------
  dragToAim: string;
  dragToAimCaption: string;

  // ---- Skin picker --------------------------------------------------------------
  costumeName: (id: string) => string;
  costumeTagline: (id: string) => string;
  buyLabel: string;
  selectLabel: string;
  selectedLabel: string;
  equippedSuffix: string;
  lockedSuffix: (price: number) => string;
  affordableSuffix: string;
  youUnlocked: (name: string) => string;
  /** Same announcement as `youUnlocked`, split at its natural verb/name
   * boundary — SandGame.tsx's visible `.cannon-unlock-text` renders this on
   * its own line above the skin's own name (on request: "'You unlocked'
   * xuống dòng 'X cannon'"), while `youUnlocked` itself stays intact for the
   * one-line aria-label a screen reader gets instead. */
  youUnlockedPrefix: string;
  tapToContinue: string;
  /** Level 31's freeze-orb tutorial (`SandLevelConfig.ftueFreezeDemo`), one
   * string per callout beat — see `SandGame.tsx`'s `freezeFtueStep`. Shown
   * before the orb is ever shot, spotlighting it. */
  ftueFreezeIntro: string;
  /** Shown right after the scripted shot freezes the board, before the
   * scripted shots that clear it. */
  ftueFreezeExplainThaw: string;
  /** Shown once the freeze has thawed, right before control hands back to
   * the player. */
  ftueFreezeOutro: string;
  /** Level 3's booster tutorial (`SandLevelConfig.ftueBoosterDemo`) — see
   * `SandGame.tsx`'s `boosterFtueStep`. Shown spotlighting the Radius
   * Overcharge button, inviting the player to actually tap and arm it
   * themselves (no scripted stand-in shot, no separate "outro" — they fire
   * their own shot with it, then the tutorial moves straight to Prism Shot). */
  ftueBoosterRadiusIntro: string;
  /** Shown spotlighting the Prism Shot button, same "tap it yourself"
   * invitation as `ftueBoosterRadiusIntro`. */
  ftueBoosterPrismIntro: string;
  /** Level 5's Chain Sort tutorial (`SandLevelConfig.ftueChainSortDemo`) —
   * see `SandGame.tsx`'s `chainSortFtueStep`. Same "tap it yourself"
   * invitation as `ftueBoosterRadiusIntro`/`ftueBoosterPrismIntro` now (on
   * request, this tutorial was redesigned to match theirs): shown
   * spotlighting the real Chain Sort button, inviting the player to tap and
   * arm it for real, then fire their own shot with it. */
  ftueChainSortIntro: string;
  /** The Skin screen's label for a `unlockLevel` skin — replaces the emerald
   * price everywhere one would otherwise show (the grid card's price pill,
   * the main preview panel's own locked button), since the skin is not for
   * sale at any price. */
  progressionLabel: string;
  /** Same skin's aria-only equivalent of `lockedSuffix`, read out with the
   * skin's own name the same way — "clear Level 20" rather than a price that
   * does not apply to it. */
  progressionLockedSuffix: (level: number) => string;
  /** Replaces `progressionLabel` once the skin's own `unlockLevel` has
   * actually been cleared — the main preview button (and the grid card's
   * mini pill) becomes a real tappable "Unlock" action at that point instead
   * of staying a disabled label forever. */
  unlockLabel: string;
  /** The "Frame cleared" card's follow-up prompt (SandGame.tsx's
   * `skinTryPrompt`) once a level-progression skin's own level was just
   * cleared for the first time — asks whether to go try it on the spot
   * rather than auto-equipping and celebrating immediately. */
  skinTryQuestion: (name: string) => string;
  /** The prompt's two answers — "Equip" sends the player to the Skin screen
   * to actually unlock it there (same `cannon-unlock-banner` reveal a Shop
   * purchase gets); "No" just continues to the next level, leaving the skin
   * earned-but-not-yet-unlocked (shows as a tappable Unlock card later). */
  equipLabel: string;
  noLabel: string;

  // ---- Gallery -----------------------------------------------------------------
  galleryTitle: string;
  lockedCardTitle: string;
  lockedLabel: string;
  fromEditorSuffix: string;
  // ---- Shop --------------------------------------------------------------------
  // One unified screen now (2026-09d), no more Gems/Coins tabs — see
  // `SandGame.tsx`'s Shop screen for the section order (offers, bundles, buy
  // coins, buy hearts, THEN boosters at the very end).
  shopTitle: string;
  specialOffers: string;
  limitedTimeBundles: string;
  bundlesTitle: string;
  bundleContents: string;
  coinsTitle: string;
  buyCoinsDirectly: string;
  heartsTitle: string;
  buyHeartsDirectly: string;
  boostersTitle: string;
  coinsSuffix: string;
  heartsSuffix: string;
  emeraldSuffix: string;
  offerName: (id: string) => string;
  offerTag: (id: string) => string;
  /** `SpecialOffer.bonus`/`Bundle.bonus`/`CoinPack.bonus`/`.flag` are plain
   * English strings in `SandGame.tsx`'s own mock IAP data (`+35% extra`,
   * `Most popular`, `Best value`, ...) — this maps the ones that carry actual
   * words rather than just a percentage, falling back to the input unchanged
   * for anything not recognised (a percentage on its own, or a flag added
   * later this map has not caught up with yet). */
  offerFlag: (raw: string) => string;
  /** The value-anchoring badge on each `SpecialOffer` card (2026-09f, on
   * request — "offer nên có [...] giá trị lợi ích để hook người chơi"): "buy
   * this offer's coins/hearts separately and it would cost `percent`% MORE"
   * — the classic anchoring play the slide deck's "Mỏ neo" section
   * describes, made visible instead of only baked into the numbers. See
   * `SpecialOffer.valuePercent`'s own comment in `SandGame.tsx` for how
   * `percent` is computed. */
  offerValueBadge: (percent: number) => string;
  iapComingSoon: string;
  buyBoosterAria: (name: string, price: number, owned: number) => string;
  buyBoosterQuestion: (name: string) => string;
  currentlyOwn: string;
  buying: string;
  totalCost: string;
  decreaseQuantity: string;
  increaseQuantity: string;
  yesBuy: string;
  no: string;
  buySkinQuestion: (name: string) => string;
  price: string;
  youHave: string;

  // ---- Reward chest --------------------------------------------------------------
  rewardChestAria: string;
  rewardUnlocked: string;
  opening: string;
  collect: string;

  // ---- Settings ------------------------------------------------------------------
  settingsTitle: string;
  closeSettings: string;
  homeAction: string;
  restartAction: string;
  musicVolume: string;
  sfxVolume: string;
  vibration: string;
  vibrationAria: (on: boolean) => string;
  language: string;
  aimSensitivity: string;

  // ---- Result screens --------------------------------------------------------------
  frameCleared: string;
  backToHome: string;
  goldEarned: (amount: number) => string;
  continueLabel: string;
  outOfShots: string;
  clearedPercent: (pct: number, remainingGrains: number) => string;
  playAgain: string;
  home: string;
  gotIt: string;
  /** Generic "go back one step" — the Modes screen's own back button today. */
  back: string;

  // ---- Daily login -----------------------------------------------------------------
  dailyLoginAria: string;
  dailyLoginTitle: string;
  close: string;
  dayLabel: (n: number) => string;
  claimCoins: (amount: number) => string;
  /** The Claim button's label on a weekend day (`dailyLogin.reward` is 0 — booster only, no gold to name). */
  claimBooster: (boosterName: string) => string;
  /** The weekend's booster-perk icon's accessible name/tooltip ("+1 <booster>") — the cell itself shows only the icon. */
  dailyLoginPerkTag: (boosterName: string) => string;
  /** The current streak, shown under the calendar once it is 2+. */
  dailyLoginStreak: (days: number) => string;
  /** The month name shown above the calendar grid. */
  monthTitle: (date: Date) => string;
}

const EN_COLOR_NAME: Record<SandColor, string> = {
  red: "RED",
  green: "GREEN",
  yellow: "YELLOW",
  blue: "BLUE",
  purple: "PURPLE",
  orange: "ORANGE",
  cyan: "CYAN",
  pink: "PINK",
  lime: "LIME",
  brown: "BROWN",
  white: "WHITE",
  black: "BLACK",
  grass: "GRASS",
  teal: "TEAL",
  skyblue: "SKY BLUE",
  indigo: "INDIGO",
  magenta: "MAGENTA",
  crimson: "CRIMSON",
  darkbrown: "DARK BROWN",
  violet: "VIOLET",
  navy: "NAVY",
  emerald: "EMERALD",
  rust: "RUST",
  mint: "MINT",
};

const VI_COLOR_NAME: Record<SandColor, string> = {
  red: "ĐỎ",
  green: "XANH LÁ",
  yellow: "VÀNG",
  blue: "XANH DƯƠNG",
  purple: "TÍM",
  orange: "CAM",
  cyan: "XANH NGỌC",
  pink: "HỒNG",
  lime: "XANH CHANH",
  brown: "NÂU",
  white: "TRẮNG",
  black: "ĐEN",
  grass: "XANH CỎ",
  teal: "XANH LỤC LAM",
  skyblue: "XANH DA TRỜI",
  indigo: "CHÀM",
  magenta: "HỒNG CÁNH SEN",
  crimson: "ĐỎ SON",
  darkbrown: "NÂU ĐẬM",
  violet: "TÍM HOA CÀ",
  navy: "XANH HẢI QUÂN",
  emerald: "XANH LỤC BẢO",
  rust: "ĐỎ GẠCH",
  mint: "XANH BẠC HÀ",
};

const EN: Strings = {
  tabShop: "Shop",
  tabSkin: "Skin",
  tabHome: "Home",
  tabGallery: "Gallery",
  tabModes: "Modes",
  sectionsNav: "Sections",
  closeTab: (tabName) => `Close ${tabName}`,
  skinTabHasOfferSuffix: " — a skin you can afford is waiting",
  shopTabHasBoosterHintSuffix: " — go stock up on the boosters you just tried",
  homeTabHasDailyLoginHintSuffix: " — you still haven't claimed today's login reward",
  notBuiltYet: "Not built yet.",
  modesTitle: "Modes",
  modesBlurb: "Where the different ways to play would be picked from.",
  zenModeButton: "Zen Mode",
  zenModeBlurb: "Unlimited shots, unlimited boosters — just for the picture.",
  zenModeTitle: "Zen Mode",
  zenEmptyBlurb: "No Zen levels yet.",
  themeModeButton: "Theme Mode",
  zenCleared: "Cleared — no rush, no score.",
  modesHelpAria: "What are Modes?",
  modesHelpTitle: "About Modes",
  homeScreenAria: "Home screen",

  levelButtonLabel: (id) => `Level ${id}`,
  playLevelAria: (levelName) => `Play ${levelName}`,
  levelName: (rawName) => rawName,
  progressionChest: "Progression Chest",
  openRewardChestAria: (amount) => `Open reward chest — ${amount} Blue Emerald`,
  rewardTrackAria: (filled, total) => `Reward track — ${filled} of ${total} levels`,

  coinsAria: (amount) => `${amount} coins — buy more`,
  emeraldAria: (amount) => `${amount} Blue Emerald`,
  heartsAria: (count, max) => `${count} of ${max} hearts`,
  outOfHearts: (mmss) => `Out of hearts — next one in ${mmss}`,

  colorName: (color) => EN_COLOR_NAME[color],
  shotsLeftWithNext: (remaining, color, next) => `${remaining} ${color} shots left, next up ${next}`,
  shotsLeftOnly: (remaining) => `${remaining} shots left`,
  nothing: "nothing",

  boosterName: (type) =>
    type === "radiusOvercharge" ? "Radius Overcharge" : type === "prismShot" ? "Prism Shot" : "Chain Sort",
  boosterDesc: (type) =>
    type === "radiusOvercharge"
      ? "Doubles the sorting disc for one shot."
      : type === "prismShot"
        ? "One shot takes every colour in reach, not just the one loaded."
        : "Clears the whole connected mass of that colour, corners included — no radius limit.",
  boosterAria: (name, left) => `${name} — ${left} left`,
  boosterBuyAria: (name, price) => `Buy 1 ${name} — ${price} gold`,
  boosterTrayGoldAria: (amount) => `${amount} gold`,
  shotInFlight: "Shot in flight",
  sandSettling: "Sand settling",
  freezeCooldown: (shots) => `Frozen — ${shots} shot${shots === 1 ? "" : "s"} left`,
  freezeLabel: "FREEZE",

  toastNotEnoughEmerald: "Not enough Blue Emerald",
  toastLockOpened: "Lock opened — the sand is free",
  toastBoosterArmed: (name) => `${name} armed — next shot`,
  toastBoosterCancelled: (name) => `${name} cancelled`,
  toastBoughtBooster: (name, qty, owned) => `Bought ${name} ×${qty} — ${owned} owned`,
  toastNotEnoughCoins: "Not enough coins",

  dragToAim: "Drag to aim, release to fire",
  dragToAimCaption: "Drag to aim · release to fire",

  costumeName: (id) =>
    id === "rune-cannon"
      ? "Rune Cannon"
      : id === "hero-cannon"
        ? "Hero Cannon"
        : id === "frost-cannon"
          ? "Frost Cannon"
          : id === "spider-cannon"
            ? "Web-Slinger Cannon"
            : id === "viking-cannon"
              ? "Viking Cannon"
              : id === "cat-cannon"
                ? "Cat Cannon"
                : "Field Cannon",
  costumeTagline: (id) =>
    id === "rune-cannon"
      ? "Charge. Sparkle. Repeat."
      : id === "hero-cannon"
        ? "Quest. Aim. Onward."
        : id === "frost-cannon"
          ? "Chill. Aim. Shatter."
          : id === "spider-cannon"
            ? "Sling. Aim. Web 'em up."
            : id === "viking-cannon"
              ? "Raid. Aim. Plunder."
              : id === "cat-cannon"
                ? "Pounce. Aim. Purr."
                : "Load. Aim. Boom.",
  buyLabel: "Buy",
  selectLabel: "Select",
  selectedLabel: "Selected",
  equippedSuffix: ", equipped",
  lockedSuffix: (price) => `, locked — ${price} Blue Emerald`,
  affordableSuffix: ", you can afford this",
  youUnlocked: (name) => `You unlocked ${name}!`,
  youUnlockedPrefix: "You unlocked",
  tapToContinue: "Tap to continue",
  ftueFreezeIntro: "This is a Freeze Orb — hit it and it locks the whole pile in place!",
  ftueFreezeExplainThaw: "To break the freeze, clear every bit of sand in its colour!",
  ftueFreezeOutro: "That's it — that's how Freeze Orb works!",
  ftueBoosterRadiusIntro: "This is Radius Overcharge — it doubles your blast radius for one shot. Tap it to arm it!",
  ftueBoosterPrismIntro: "This is Prism Shot — it clears every colour in reach, not just the one you're holding. Tap it to arm it!",
  ftueChainSortIntro: "This is Chain Sort — it clears the whole connected patch of that colour, corners included, no radius limit. Tap it to arm it!",
  progressionLabel: "Progression",
  progressionLockedSuffix: (level) => `, locked — clear Level ${level}`,
  unlockLabel: "Unlock",
  skinTryQuestion: (name) => `You unlocked ${name}! Want to try it now?`,
  equipLabel: "Equip",
  noLabel: "No",

  galleryTitle: "Gallery",
  lockedCardTitle: "Clear the level before this one to unlock",
  lockedLabel: "Locked",
  fromEditorSuffix: " (from the editor)",

  shopTitle: "Shop",
  specialOffers: "Special Offers",
  limitedTimeBundles: "Limited-time bundles",
  bundlesTitle: "Bundles",
  bundleContents: "Coins, hearts and Blue Emerald together",
  coinsTitle: "Coins",
  buyCoinsDirectly: "Buy coins directly",
  heartsTitle: "Hearts",
  buyHeartsDirectly: "Top up hearts directly",
  boostersTitle: "Boosters",
  coinsSuffix: "Coins",
  heartsSuffix: "Hearts",
  emeraldSuffix: "Blue Emerald",
  offerName: (id) => (id === "starter" ? "Islander's Starter Pack" : "Weekend Heart Rush"),
  offerTag: (id) => (id === "starter" ? "First purchase" : "Weekend only"),
  offerFlag: (raw) => raw,
  offerValueBadge: (percent) => `+${percent}% value`,
  iapComingSoon: "Real-money purchases aren't live in this build yet.",
  buyBoosterAria: (name, price, owned) => `Buy ${name} for ${price} coins${owned > 0 ? `, ${owned} owned` : ""}`,
  buyBoosterQuestion: (name) => `Buy ${name}?`,
  currentlyOwn: "Currently own",
  buying: "Buying",
  totalCost: "Total cost",
  decreaseQuantity: "Decrease quantity",
  increaseQuantity: "Increase quantity",
  yesBuy: "Yes, buy",
  no: "No",
  buySkinQuestion: (name) => `Buy ${name}?`,
  price: "Price",
  youHave: "You have",

  rewardChestAria: "Reward chest",
  rewardUnlocked: "Reward unlocked",
  opening: "Opening…",
  collect: "Collect",

  settingsTitle: "Settings",
  closeSettings: "Close settings",
  homeAction: "Home",
  restartAction: "Restart",
  musicVolume: "Music",
  sfxVolume: "Sound Effects",
  vibration: "Vibration",
  vibrationAria: (on) => `Vibration ${on ? "on" : "off"}`,
  language: "Language",
  aimSensitivity: "Aim sensitivity",

  frameCleared: "FRAME CLEARED!",
  backToHome: "Back to home",
  goldEarned: (amount) => `+${amount} gold earned`,
  continueLabel: "Continue",
  outOfShots: "OUT OF SHOTS",
  clearedPercent: (pct, remainingGrains) => `${pct}% cleared — ${remainingGrains} grains still in the frame.`,
  playAgain: "Play again",
  home: "Home",
  gotIt: "Got it",
  back: "Back",

  dailyLoginAria: "Daily login reward",
  dailyLoginTitle: "Daily Login",
  close: "Close",
  dailyLoginPerkTag: (boosterName) => `+1 ${boosterName}`,
  dailyLoginStreak: (days) => `${days}-day streak`,
  monthTitle: (date) => date.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  dayLabel: (n) => `Day ${n}`,
  claimCoins: (amount) => `Claim ${amount} coins`,
  claimBooster: (boosterName) => `Claim +1 ${boosterName}`,
};

/** `Strings.offerFlag`'s Vietnamese lookup — see that key's own comment. */
const VI_OFFER_FLAG: Record<string, string> = {
  "+35% extra": "+35% thêm",
  "Most popular": "Phổ biến nhất",
  "Best value": "Giá tốt nhất",
  "Popular": "Phổ biến",
};

const VI: Strings = {
  tabShop: "Cửa hàng",
  tabSkin: "Skin",
  tabHome: "Trang chủ",
  tabGallery: "Bộ sưu tập",
  tabModes: "Chế độ",
  sectionsNav: "Điều hướng",
  closeTab: (tabName) => `Đóng ${tabName}`,
  skinTabHasOfferSuffix: " — có skin bạn đủ tiền mua",
  shopTabHasBoosterHintSuffix: " — mua thêm booster bạn vừa dùng thử",
  homeTabHasDailyLoginHintSuffix: " — bạn chưa nhận phần thưởng đăng nhập hôm nay",
  notBuiltYet: "Chưa xây dựng xong.",
  modesTitle: "Chế độ",
  modesBlurb: "Nơi bạn sẽ chọn các chế độ chơi khác nhau.",
  zenModeButton: "Zen Mode",
  zenModeBlurb: "Bắn thoải mái, không giới hạn đạn hay booster — chỉ để thư giãn.",
  zenModeTitle: "Zen Mode",
  zenEmptyBlurb: "Chưa có level Zen nào.",
  themeModeButton: "Theme Mode",
  zenCleared: "Đã dọn xong — không tính thời gian, không tính điểm.",
  homeScreenAria: "Màn hình chính",
  modesHelpAria: "Các chế độ là gì?",
  modesHelpTitle: "Giới thiệu các chế độ",

  levelButtonLabel: (id) => `Màn ${id}`,
  playLevelAria: (levelName) => `Chơi ${levelName}`,
  levelName: (rawName) => rawName.replace(/^Level\s+/i, "Màn "),
  progressionChest: "Rương Tiến Trình",
  openRewardChestAria: (amount) => `Mở rương phần thưởng — ${amount} Blue Emerald`,
  rewardTrackAria: (filled, total) => `Thanh tiến trình — ${filled}/${total} màn`,

  coinsAria: (amount) => `${amount} xu — mua thêm`,
  emeraldAria: (amount) => `${amount} Blue Emerald`,
  heartsAria: (count, max) => `${count}/${max} tim`,
  outOfHearts: (mmss) => `Hết tim — tim tiếp theo sau ${mmss}`,

  colorName: (color) => VI_COLOR_NAME[color],
  shotsLeftWithNext: (remaining, color, next) => `Còn ${remaining} phát ${color}, tiếp theo ${next}`,
  shotsLeftOnly: (remaining) => `Còn ${remaining} phát`,
  nothing: "không có gì",

  boosterName: (type) =>
    type === "radiusOvercharge" ? "Tăng Bán Kính" : type === "prismShot" ? "Bắn Đa Sắc" : "Dọn Liên Hoàn",
  boosterDesc: (type) =>
    type === "radiusOvercharge"
      ? "Nhân đôi vòng tròn phân loại cho một phát bắn."
      : type === "prismShot"
        ? "Một phát lấy mọi màu trong tầm bắn, không chỉ màu đang nạp."
        : "Dọn sạch cả mảng cát cùng màu liền kề, kể cả nằm xéo — không giới hạn bán kính.",
  boosterAria: (name, left) => `${name} — còn ${left}`,
  boosterBuyAria: (name, price) => `Mua 1 ${name} — ${price} vàng`,
  boosterTrayGoldAria: (amount) => `${amount} vàng`,
  shotInFlight: "Đạn đang bay",
  sandSettling: "Cát đang lắng",
  freezeCooldown: (shots) => `Đóng băng — còn ${shots} lượt`,
  freezeLabel: "FREEZE",

  toastNotEnoughEmerald: "Không đủ Blue Emerald",
  toastLockOpened: "Đã mở khoá — cát được tự do",
  toastBoosterArmed: (name) => `Đã kích hoạt ${name} — phát bắn tới`,
  toastBoosterCancelled: (name) => `Đã huỷ ${name}`,
  toastBoughtBooster: (name, qty, owned) => `Đã mua ${name} ×${qty} — hiện có ${owned}`,
  toastNotEnoughCoins: "Không đủ xu",

  dragToAim: "Kéo để ngắm, thả để bắn",
  dragToAimCaption: "Kéo để ngắm · thả để bắn",

  costumeName: (id) =>
    id === "rune-cannon"
      ? "Pháo Rune"
      : id === "hero-cannon"
        ? "Pháo Anh Hùng"
        : id === "frost-cannon"
          ? "Pháo Băng Giá"
          : id === "spider-cannon"
            ? "Pháo Tơ Nhện"
            : id === "viking-cannon"
              ? "Pháo Viking"
              : id === "cat-cannon"
                ? "Pháo Mèo"
                : "Pháo Chiến Trường",
  costumeTagline: (id) =>
    id === "rune-cannon"
      ? "Nạp phép. Lấp lánh. Lặp lại."
      : id === "hero-cannon"
        ? "Phiêu lưu. Ngắm. Tiến bước."
        : id === "frost-cannon"
          ? "Đóng băng. Ngắm. Vỡ tan."
          : id === "spider-cannon"
            ? "Bắn tơ. Ngắm. Tóm gọn."
            : id === "viking-cannon"
              ? "Cướp bờ. Ngắm. Thu chiến lợi phẩm."
              : id === "cat-cannon"
                ? "Vồ mồi. Ngắm. Gừ gừ."
                : "Nạp đạn. Ngắm. Bùm.",
  buyLabel: "Mua",
  selectLabel: "Chọn",
  selectedLabel: "Đã chọn",
  equippedSuffix: ", đang trang bị",
  lockedSuffix: (price) => `, đang khoá — ${price} Blue Emerald`,
  affordableSuffix: ", bạn đủ tiền mua",
  youUnlocked: (name) => `Bạn đã mở khoá ${name}!`,
  youUnlockedPrefix: "Bạn đã mở khoá",
  tapToContinue: "Chạm để tiếp tục",
  ftueFreezeIntro: "Đây là Freeze Orb — bắn trúng nó sẽ khoá cả đống cát lại!",
  ftueFreezeExplainThaw: "Muốn phá băng? Dọn sạch hết cát cùng màu với nó!",
  ftueFreezeOutro: "Vậy đó — Freeze Orb hoạt động như thế!",
  ftueBoosterRadiusIntro: "Đây là Radius Overcharge — tăng gấp đôi bán kính bắn cho 1 phát! Chạm vào để trang bị!",
  ftueBoosterPrismIntro: "Đây là Prism Shot — dọn sạch mọi màu trong tầm bắn, không chỉ màu đang cầm! Chạm vào để trang bị!",
  ftueChainSortIntro: "Đây là Chain Sort — dọn sạch cả mảng cát cùng màu liền kề, kể cả nằm xéo, không giới hạn bán kính! Chạm vào để trang bị!",
  // Kept in English on purpose — "Progression" per the design ask, the same
  // way "Blue Emerald" above stays untranslated.
  progressionLabel: "Progression",
  progressionLockedSuffix: (level) => `, đang khoá — hoàn thành Level ${level}`,
  unlockLabel: "Mở khoá",
  skinTryQuestion: (name) => `Bạn đã nhận ${name}! Muốn thử luôn không?`,
  equipLabel: "Trang bị",
  noLabel: "Không",

  galleryTitle: "Bộ sưu tập",
  lockedCardTitle: "Hoàn thành màn trước để mở khoá",
  lockedLabel: "Đã khoá",
  fromEditorSuffix: " (từ trình chỉnh sửa)",

  shopTitle: "Cửa hàng",
  specialOffers: "Ưu Đãi Đặc Biệt",
  limitedTimeBundles: "Gói ưu đãi có thời hạn",
  bundlesTitle: "Combo",
  bundleContents: "Xu, tim và Blue Emerald cùng lúc",
  coinsTitle: "Xu",
  buyCoinsDirectly: "Mua xu trực tiếp",
  heartsTitle: "Tim",
  buyHeartsDirectly: "Nạp thêm tim trực tiếp",
  boostersTitle: "Booster",
  coinsSuffix: "Xu",
  heartsSuffix: "Tim",
  emeraldSuffix: "Blue Emerald",
  offerName: (id) => (id === "starter" ? "Gói Khởi Đầu Islander" : "Gói Tim Cuối Tuần"),
  offerTag: (id) => (id === "starter" ? "Mua lần đầu" : "Chỉ cuối tuần"),
  offerFlag: (raw) => VI_OFFER_FLAG[raw] ?? raw,
  offerValueBadge: (percent) => `+${percent}% giá trị`,
  iapComingSoon: "Giao dịch tiền thật chưa hoạt động trong bản build này.",
  buyBoosterAria: (name, price, owned) => `Mua ${name} với ${price} xu${owned > 0 ? `, đang có ${owned}` : ""}`,
  buyBoosterQuestion: (name) => `Mua ${name}?`,
  currentlyOwn: "Đang có",
  buying: "Mua",
  totalCost: "Tổng chi phí",
  decreaseQuantity: "Giảm số lượng",
  increaseQuantity: "Tăng số lượng",
  yesBuy: "Đồng ý mua",
  no: "Không",
  buySkinQuestion: (name) => `Mua ${name}?`,
  price: "Giá",
  youHave: "Bạn đang có",

  rewardChestAria: "Rương phần thưởng",
  rewardUnlocked: "Đã mở phần thưởng",
  opening: "Đang mở…",
  collect: "Nhận",

  settingsTitle: "Cài đặt",
  closeSettings: "Đóng cài đặt",
  homeAction: "Trang chủ",
  restartAction: "Chơi lại",
  musicVolume: "Nhạc nền",
  sfxVolume: "Hiệu ứng âm thanh",
  vibration: "Rung",
  vibrationAria: (on) => `Rung ${on ? "bật" : "tắt"}`,
  language: "Ngôn ngữ",
  aimSensitivity: "Độ nhạy ngắm",

  frameCleared: "ĐÃ DỌN SẠCH KHUNG!",
  backToHome: "Về trang chủ",
  goldEarned: (amount) => `+${amount} vàng`,
  continueLabel: "Tiếp tục",
  outOfShots: "HẾT ĐẠN",
  clearedPercent: (pct, remainingGrains) => `Đã dọn ${pct}% — còn ${remainingGrains} hạt cát trong khung.`,
  playAgain: "Chơi lại",
  home: "Trang chủ",
  gotIt: "Đã hiểu",
  back: "Quay lại",

  dailyLoginAria: "Phần thưởng điểm danh",
  dailyLoginTitle: "Điểm Danh Hằng Ngày",
  close: "Đóng",
  dailyLoginPerkTag: (boosterName) => `+1 ${boosterName}`,
  dailyLoginStreak: (days) => `Chuỗi ${days} ngày`,
  monthTitle: (date) => `Tháng ${date.getMonth() + 1}, ${date.getFullYear()}`,
  dayLabel: (n) => `Ngày ${n}`,
  claimCoins: (amount) => `Nhận ${amount} xu`,
  claimBooster: (boosterName) => `Nhận +1 ${boosterName}`,
};

const PACKS: Record<Language, Strings> = { en: EN, vi: VI };

/** `t(language).someKey` (or `.someKey(...)` for the parameterised ones) —
 * every call site reads this the same way regardless of which language is
 * active, so a component never has to branch on `language` itself. */
export function t(lang: Language): Strings {
  return PACKS[lang];
}
