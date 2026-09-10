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

import type { SandColor } from "./game/sand-types";

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
  tabCustomize: string;
  sectionsNav: string;
  closeTab: (tabName: string) => string;
  skinTabHasOfferSuffix: string;
  notBuiltYet: string;
  customizeBlurb: string;
  homeScreenAria: string;

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

  // ---- Ammo HUD ----------------------------------------------------------------
  colorName: (color: SandColor) => string;
  shotsLeftWithNext: (remaining: string, color: string, next: string) => string;
  shotsLeftOnly: (remaining: string) => string;
  nothing: string;

  // ---- Boosters ----------------------------------------------------------------
  boosterName: (type: "radiusOvercharge" | "prismShot") => string;
  boosterDesc: (type: "radiusOvercharge" | "prismShot") => string;
  boosterAria: (name: string, left: number) => string;
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
  toastNoColorInRange: (color: string) => string;
  toastHitFrame: string;
  toastMissedFrame: string;
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
  /** The Skin screen's label for a `unlockLevel` skin — replaces the emerald
   * price everywhere one would otherwise show (the grid card's price pill,
   * the main preview panel's own locked button), since the skin is not for
   * sale at any price. */
  progressionLabel: string;
  /** Same skin's aria-only equivalent of `lockedSuffix`, read out with the
   * skin's own name the same way — "clear Level 20" rather than a price that
   * does not apply to it. */
  progressionLockedSuffix: (level: number) => string;

  // ---- Gallery -----------------------------------------------------------------
  galleryTitle: string;
  lockedCardTitle: string;
  lockedLabel: string;
  fromEditorSuffix: string;
  // ---- Shop --------------------------------------------------------------------
  shopTitle: string;
  gemsAria: (amount: number) => string;
  shopCurrencyTabsAria: string;
  gemsTab: string;
  coinsTab: string;
  specialOffers: string;
  limitedTimeBundles: string;
  bundlesTitle: string;
  gemsAndCoinsTogether: string;
  coinsTitle: string;
  buyCoinsDirectly: string;
  gemsSuffix: string;
  coinsSuffix: string;
  offerName: (id: string) => string;
  offerTag: (id: string) => string;
  /** `SpecialOffer.bonus`/`Bundle.bonus`/`CoinPack.bonus`/`.flag` are plain
   * English strings in `SandGame.tsx`'s own mock IAP data (`+35% extra`,
   * `Most popular`, `Best value`, ...) — this maps the ones that carry actual
   * words rather than just a percentage, falling back to the input unchanged
   * for anything not recognised (a percentage on its own, or a flag added
   * later this map has not caught up with yet). */
  offerFlag: (raw: string) => string;
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
  sound: string;
  soundAria: (on: boolean) => string;
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

  // ---- Daily login -----------------------------------------------------------------
  dailyLoginAria: string;
  dailyLoginTitle: string;
  close: string;
  dayLabel: (n: number) => string;
  claimCoins: (amount: number) => string;
  /** Days 1-3's small badge — one short word, since the pill it sits on is
   * only as wide as a sixth of the card (layout only, per the request; the
   * actual amounts are tuned separately). */
  greatValue: string;
  /** Day 7's own badge, on the full-width hero card — "this is the reward
   * the whole week is building toward". */
  bestReward: string;
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
  tabCustomize: "Customize",
  sectionsNav: "Sections",
  closeTab: (tabName) => `Close ${tabName}`,
  skinTabHasOfferSuffix: " — a skin you can afford is waiting",
  notBuiltYet: "Not built yet.",
  customizeBlurb: "Where the frame, the sand texture and the board's colours would be set.",
  homeScreenAria: "Home screen",

  levelButtonLabel: (id) => `Level ${id}`,
  playLevelAria: (levelName) => `Play ${levelName}`,
  levelName: (rawName) => rawName,
  progressionChest: "Progression Chest",
  openRewardChestAria: (amount) => `Open reward chest — ${amount} Blue Emerald`,
  rewardTrackAria: (filled, total) => `Reward track — ${filled} of ${total} levels`,

  coinsAria: (amount) => `${amount} coins — buy more`,
  emeraldAria: (amount) => `${amount} Blue Emerald`,

  colorName: (color) => EN_COLOR_NAME[color],
  shotsLeftWithNext: (remaining, color, next) => `${remaining} ${color} shots left, next up ${next}`,
  shotsLeftOnly: (remaining) => `${remaining} shots left`,
  nothing: "nothing",

  boosterName: (type) => (type === "radiusOvercharge" ? "Radius Overcharge" : "Prism Shot"),
  boosterDesc: (type) => (type === "radiusOvercharge"
    ? "Doubles the sorting disc for one shot."
    : "One shot takes every colour in reach, not just the one loaded."),
  boosterAria: (name, left) => `${name} — ${left} left`,
  shotInFlight: "Shot in flight",
  sandSettling: "Sand settling",
  freezeCooldown: (shots) => `Frozen — ${shots} shot${shots === 1 ? "" : "s"} left`,
  freezeLabel: "FREEZE",

  toastNotEnoughEmerald: "Not enough Blue Emerald",
  toastNoColorInRange: (color) => `No ${color} in range — shot spent`,
  toastHitFrame: "Hit the frame — no shot spent",
  toastMissedFrame: "Missed the frame — no shot spent",
  toastLockOpened: "Lock opened — the sand is free",
  toastBoosterArmed: (name) => `${name} armed — next shot`,
  toastBoosterCancelled: (name) => `${name} cancelled`,
  toastBoughtBooster: (name, qty, owned) => `Bought ${name} ×${qty} — ${owned} owned`,
  toastNotEnoughCoins: "Not enough coins",

  dragToAim: "Drag to aim, release to fire",
  dragToAimCaption: "Drag to aim · release to fire",

  costumeName: (id) => (id === "rune-cannon" ? "Rune Cannon" : id === "hero-cannon" ? "Hero Cannon" : "Field Cannon"),
  costumeTagline: (id) =>
    id === "rune-cannon" ? "Charge. Sparkle. Repeat." : id === "hero-cannon" ? "Quest. Aim. Onward." : "Load. Aim. Boom.",
  buyLabel: "Buy",
  selectLabel: "Select",
  selectedLabel: "Selected",
  equippedSuffix: ", equipped",
  lockedSuffix: (price) => `, locked — ${price} Blue Emerald`,
  affordableSuffix: ", you can afford this",
  youUnlocked: (name) => `You unlocked ${name}!`,
  tapToContinue: "Tap to continue",
  ftueFreezeIntro: "This is a Freeze Orb — hit it and it locks the whole pile in place!",
  ftueFreezeExplainThaw: "To break the freeze, clear every bit of sand in its colour!",
  ftueFreezeOutro: "That's it — that's how Freeze Orb works!",
  progressionLabel: "Progression",
  progressionLockedSuffix: (level) => `, locked — clear Level ${level}`,

  galleryTitle: "Gallery",
  lockedCardTitle: "Clear the level before this one to unlock",
  lockedLabel: "Locked",
  fromEditorSuffix: " (from the editor)",

  shopTitle: "Shop",
  gemsAria: (amount) => `${amount} gems`,
  shopCurrencyTabsAria: "Shop currency tabs",
  gemsTab: "Gems",
  coinsTab: "Coins",
  specialOffers: "Special Offers",
  limitedTimeBundles: "Limited-time bundles",
  bundlesTitle: "Bundles",
  gemsAndCoinsTogether: "Gems and coins together",
  coinsTitle: "Coins",
  buyCoinsDirectly: "Buy coins directly — no gems needed",
  gemsSuffix: "Gems",
  coinsSuffix: "Coins",
  offerName: (id) => (id === "starter" ? "Islander's Starter Pack" : "Weekend Gem Rush"),
  offerTag: (id) => (id === "starter" ? "First purchase" : "Weekend only"),
  offerFlag: (raw) => raw,
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
  sound: "Sound",
  soundAria: (on) => `Sound ${on ? "on" : "off"}`,
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

  dailyLoginAria: "Daily login reward",
  dailyLoginTitle: "Daily Login",
  close: "Close",
  greatValue: "Hot",
  bestReward: "Best reward",
  dayLabel: (n) => `Day ${n}`,
  claimCoins: (amount) => `Claim ${amount} coins`,
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
  tabCustomize: "Tuỳ chỉnh",
  sectionsNav: "Điều hướng",
  closeTab: (tabName) => `Đóng ${tabName}`,
  skinTabHasOfferSuffix: " — có skin bạn đủ tiền mua",
  notBuiltYet: "Chưa xây dựng xong.",
  customizeBlurb: "Nơi bạn sẽ chỉnh khung tranh, chất liệu cát và màu sắc của bảng.",
  homeScreenAria: "Màn hình chính",

  levelButtonLabel: (id) => `Màn ${id}`,
  playLevelAria: (levelName) => `Chơi ${levelName}`,
  levelName: (rawName) => rawName.replace(/^Level\s+/i, "Màn "),
  progressionChest: "Rương Tiến Trình",
  openRewardChestAria: (amount) => `Mở rương phần thưởng — ${amount} Blue Emerald`,
  rewardTrackAria: (filled, total) => `Thanh tiến trình — ${filled}/${total} màn`,

  coinsAria: (amount) => `${amount} xu — mua thêm`,
  emeraldAria: (amount) => `${amount} Blue Emerald`,

  colorName: (color) => VI_COLOR_NAME[color],
  shotsLeftWithNext: (remaining, color, next) => `Còn ${remaining} phát ${color}, tiếp theo ${next}`,
  shotsLeftOnly: (remaining) => `Còn ${remaining} phát`,
  nothing: "không có gì",

  boosterName: (type) => (type === "radiusOvercharge" ? "Tăng Bán Kính" : "Bắn Đa Sắc"),
  boosterDesc: (type) => (type === "radiusOvercharge"
    ? "Nhân đôi vòng tròn phân loại cho một phát bắn."
    : "Một phát lấy mọi màu trong tầm bắn, không chỉ màu đang nạp."),
  boosterAria: (name, left) => `${name} — còn ${left}`,
  shotInFlight: "Đạn đang bay",
  sandSettling: "Cát đang lắng",
  freezeCooldown: (shots) => `Đóng băng — còn ${shots} lượt`,
  freezeLabel: "FREEZE",

  toastNotEnoughEmerald: "Không đủ Blue Emerald",
  toastNoColorInRange: (color) => `Không có màu ${color} trong tầm — vẫn mất một phát`,
  toastHitFrame: "Trúng khung — không mất phát",
  toastMissedFrame: "Trượt ra ngoài khung — không mất phát",
  toastLockOpened: "Đã mở khoá — cát được tự do",
  toastBoosterArmed: (name) => `Đã kích hoạt ${name} — phát bắn tới`,
  toastBoosterCancelled: (name) => `Đã huỷ ${name}`,
  toastBoughtBooster: (name, qty, owned) => `Đã mua ${name} ×${qty} — hiện có ${owned}`,
  toastNotEnoughCoins: "Không đủ xu",

  dragToAim: "Kéo để ngắm, thả để bắn",
  dragToAimCaption: "Kéo để ngắm · thả để bắn",

  costumeName: (id) => (id === "rune-cannon" ? "Pháo Rune" : id === "hero-cannon" ? "Pháo Anh Hùng" : "Pháo Chiến Trường"),
  costumeTagline: (id) =>
    id === "rune-cannon" ? "Nạp phép. Lấp lánh. Lặp lại." : id === "hero-cannon" ? "Phiêu lưu. Ngắm. Tiến bước." : "Nạp đạn. Ngắm. Bùm.",
  buyLabel: "Mua",
  selectLabel: "Chọn",
  selectedLabel: "Đã chọn",
  equippedSuffix: ", đang trang bị",
  lockedSuffix: (price) => `, đang khoá — ${price} Blue Emerald`,
  affordableSuffix: ", bạn đủ tiền mua",
  youUnlocked: (name) => `Bạn đã mở khoá ${name}!`,
  tapToContinue: "Chạm để tiếp tục",
  ftueFreezeIntro: "Đây là Freeze Orb — bắn trúng nó sẽ khoá cả đống cát lại!",
  ftueFreezeExplainThaw: "Muốn phá băng? Dọn sạch hết cát cùng màu với nó!",
  ftueFreezeOutro: "Vậy đó — Freeze Orb hoạt động như thế!",
  // Kept in English on purpose — "Progression" per the design ask, the same
  // way "Blue Emerald" above stays untranslated.
  progressionLabel: "Progression",
  progressionLockedSuffix: (level) => `, đang khoá — hoàn thành Level ${level}`,

  galleryTitle: "Bộ sưu tập",
  lockedCardTitle: "Hoàn thành màn trước để mở khoá",
  lockedLabel: "Đã khoá",
  fromEditorSuffix: " (từ trình chỉnh sửa)",

  shopTitle: "Cửa hàng",
  gemsAria: (amount) => `${amount} đá quý`,
  shopCurrencyTabsAria: "Tab tiền tệ cửa hàng",
  gemsTab: "Đá quý",
  coinsTab: "Xu",
  specialOffers: "Ưu Đãi Đặc Biệt",
  limitedTimeBundles: "Gói ưu đãi có thời hạn",
  bundlesTitle: "Combo",
  gemsAndCoinsTogether: "Đá quý và xu cùng lúc",
  coinsTitle: "Xu",
  buyCoinsDirectly: "Mua xu trực tiếp — không cần đá quý",
  gemsSuffix: "Đá quý",
  coinsSuffix: "Xu",
  offerName: (id) => (id === "starter" ? "Gói Khởi Đầu Islander" : "Gói Đá Quý Cuối Tuần"),
  offerTag: (id) => (id === "starter" ? "Mua lần đầu" : "Chỉ cuối tuần"),
  offerFlag: (raw) => VI_OFFER_FLAG[raw] ?? raw,
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
  sound: "Âm thanh",
  soundAria: (on) => `Âm thanh ${on ? "bật" : "tắt"}`,
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

  dailyLoginAria: "Phần thưởng điểm danh",
  dailyLoginTitle: "Điểm Danh Hằng Ngày",
  close: "Đóng",
  greatValue: "Hời",
  bestReward: "Quà xịn nhất",
  dayLabel: (n) => `Ngày ${n}`,
  claimCoins: (amount) => `Nhận ${amount} xu`,
};

const PACKS: Record<Language, Strings> = { en: EN, vi: VI };

/** `t(language).someKey` (or `.someKey(...)` for the parameterised ones) —
 * every call site reads this the same way regardless of which language is
 * active, so a component never has to branch on `language` itself. */
export function t(lang: Language): Strings {
  return PACKS[lang];
}
