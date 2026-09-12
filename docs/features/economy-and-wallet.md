# Economy: vàng, booster, Daily Login

Nguồn: `app/game/economy.ts`, `app/game/economy-config.ts`, `public/design/economy.csv`,
`app/SandGame.tsx` (Shop, Daily Login modal).

Toàn bộ state là **client-only** — không có account hay server (`db/schema.ts` cố tình để rỗng) —
sống trong `localStorage`.

## Ví (`Wallet`)

```ts
type Wallet = { gold: number; boosters: Record<BoosterType, number> };
```

`getWallet()` / `getGold()` / `getBoosterCount(type)` đọc; `addGold`, `spendGold`,
`addBoosterCharges`, `spendBoosterCharge`, `buyBoosterCharge` ghi. `subscribeWallet(listener)` là
seam cho `useSyncExternalStore`.

## Số mặc định — và cách hand-tune chúng

Mỗi hằng số dưới đây là **fallback**: số thật luôn đi qua `public/design/economy.csv`
(`economy-config.ts`) trước, chỉ rơi về hằng số khi sheet không có dòng cho key đó. Xem
[design/economy/README.md](../../design/economy/README.md) để biết cách sửa file CSV.

| Hằng số | Giá trị mặc định | Key trong `economy.csv` |
| --- | --- | --- |
| `STARTER_GOLD` | 100 | `starterGold` |
| `STARTER_BOOSTER_CHARGES.radiusOvercharge` | 1 | `starterBoosterRadiusOvercharge` |
| `STARTER_BOOSTER_CHARGES.prismShot` | 1 | `starterBoosterPrismShot` |
| `STARTER_BOOSTER_CHARGES.chainSort` | 1 | `starterBoosterChainSort` |
| `BOOSTER_PRICE.radiusOvercharge` | 100 | `boosterPriceRadiusOvercharge` |
| `BOOSTER_PRICE.prismShot` | 100 | `boosterPricePrismShot` |
| `BOOSTER_PRICE.chainSort` | 150 | `boosterPriceChainSort` |
| `DAILY_LOGIN_REWARDS[T2..CN]` | 10, 12, 15, 18, 20, 30, 40 | `dailyLoginDay1`..`dailyLoginDay7` |
| `LEVEL_MILESTONE_BONUS[10,20,30,40,50]` | 65, 75, 90, 100, 115 | `levelMilestoneBonus10`..`levelMilestoneBonus50` |

Radius Overcharge và Prism Shot cùng giá 100 vàng; Chain Sort đắt hơn (150) — nó không chỉ to/rộng
hơn một cú bắn thường mà có thể dọn sạch cả một mảng liền kề bất kể kích thước. Xem
[booster-radius-prism-spec.md](booster-radius-prism-spec.md) cho khác biệt công năng giữa các loại.

`economy-config.ts` fetch CSV lúc runtime và poll lại mỗi 4 giây trong khi tab đang mở/visible, nên
sửa CSV rồi lưu là số mới lên mà không cần build lại (F5 hoặc chờ 4s là thấy). Không có server để
fetch (mở bằng `file://`, hoặc build standalone) thì rơi về hằng số mặc định, không lỗi gì hiện ra.

### Wallet mới tạo tự cập nhật theo CSV tới muộn

Vì fetch CSV là bất đồng bộ còn lần đọc ví đầu tiên thì đồng bộ, một ví **vừa mới tạo** (chưa từng
kiếm/tiêu một xu nào) sẽ tự tạo lại theo số mới nếu CSV load xong sau đó — `applyStarterOverrideIfFresh`.
Một ví đã có hoạt động thật (đã kiếm/mua gì đó) thì **không bao giờ** bị một sửa đổi CSV sau này
đụng vào — chỉ số khởi đầu của một máy hoàn toàn mới mới di chuyển theo sheet.

## Thưởng vàng khi thắng level

Xem [level-rewards.md](level-rewards.md) — công thức `levelGoldReward` dùng điểm độ khó từ
[difficulty-measurement.md](difficulty-measurement.md), và chỉ trả **một lần duy nhất** trên mỗi
level (`markLevelCleared`/`hasClearedLevel`) — chơi lại không được thưởng thêm.

**Cân bằng lại (2026-09):** công thức được chỉnh lại để **chơi khoảng 5 level (lần đầu thắng) là đủ
mua 1 lượt Radius Overcharge/Prism Shot** (100 vàng) — một level độ khó trung bình (điểm 50) trả đúng
20 vàng = `BOOSTER_PRICE.radiusOvercharge / 5`. Khoảng trả: 5 (điểm 0) đến 35 (điểm 100), làm tròn 5.

### Thưởng mốc hàng chục (level 10/20/30/40/50)

`levelMilestoneBonus(levelId)` cộng THÊM vào thưởng thường của level đó, chỉ ở lần thắng đầu tiên,
tại 5 level mốc `LEVEL_MILESTONE_LEVELS = [10, 20, 30, 40, 50]`:

| Level mốc | Bonus (vàng) | Tỉ lệ so với 1 booster |
| --- | --- | --- |
| 10 | 65 | ≈ 2/3 giá Radius Overcharge/Prism Shot (100) |
| 20 | 75 | ≈ 3/4 giá Radius Overcharge/Prism Shot (100) |
| 30 | 90 | ≈ 3/4 giá 120 (mốc trung gian tự chọn) |
| 40 | 100 | ≈ 2/3 giá Chain Sort (150) |
| 50 | 115 | ≈ 3/4 giá Chain Sort (150) |

Tăng dần qua từng mốc, luôn nằm trong khoảng 2/3–3/4 giá 1 booster — đủ gần để người chơi cảm thấy
"gần mua được booster rồi" chứ không phải một khoản lặt vặt. Override từng mốc qua
`economy.csv` (`levelMilestoneBonus10`..`levelMilestoneBonus50`). Gallery (`SandGame.tsx`) hiển thị
pill thưởng mốc = thưởng thường + bonus, kể cả trước khi level đó unlock (làm mồi nhử).

## Daily Login

Giờ gắn liền với **lịch thật** — không còn là chu kỳ 7 ngày tự lặp mà không quan tâm hôm nay là thứ
mấy. `dailyLoginReward(weekday)` (weekday: 0 = Thứ Hai .. 6 = Chủ Nhật, tính từ `Date` thật của máy)
quyết định thưởng của **hôm nay**, độc lập với streak — modal render nguyên một **lưới các ngày trong
tháng hiện tại** (`getDailyLoginCalendar`), ngày nào cũng là ngày thật. `weekday` chỉ dùng để tra
`reward`/`boosterPerk`, KHÔNG hiển thị lên UI — lưới không còn đánh dấu Thứ Hai→Chủ Nhật, chỉ đánh số
ngày trong tháng (2026-09b).

| Thứ | Vàng | Ưu đãi thêm |
| --- | --- | --- |
| T2 (Thứ Hai) | 10 | — |
| T3 (Thứ Ba) | 12 | — |
| T4 (Thứ Tư) | 15 | — |
| T5 (Thứ Năm) | 18 | — |
| T6 (Thứ Sáu) | 20 | — |
| T7 (Thứ Bảy) | 30 | +1 Prism Shot (cuối tuần) |
| CN (Chủ Nhật) | 40 | +1 Prism Shot (cuối tuần, cao nhất tuần) |

T2–T6 ("5 ngày đầu tuần") bình thường — chỉ vàng, tăng dần nhẹ, không tag không ưu đãi. T7–CN (cuối
tuần) là tier đặc biệt DUY NHẤT: vàng cao nhất tuần **và** kèm 1 lượt Prism Shot miễn phí
(`DAILY_LOGIN_BOOSTER_PERK`, cả hai ngày cùng loại booster — trước đây từng luân phiên 3 loại ở 3
ngày đầu tuần, đã bỏ theo yêu cầu 2026-09b).

`computeDailyLoginState(record, now)` là hàm thuần:

- `weekday`/`reward`/`boosterPerk` tính thẳng từ ngày thật hôm nay, **không phụ thuộc** record.
- `claimedToday`: đúng khi hôm nay có trong `record.claimedDates` (lưu từng ngày đã claim thật, cắt
  còn 60 ngày gần nhất — đủ để tô dấu ✓ đúng trên lưới tháng đang hiển thị).
- `streak`: giữ nguyên nếu hôm nay đã claim hoặc gap tới hôm nay ≤ 1 ngày; **reset về 0** nếu bỏ lỡ
  2+ ngày. Tăng thêm 1 chỉ khi `claimDailyLogin` thực sự claim thành công.

`getDailyLoginCalendar(now)` trả về lưới ô phẳng — ĐÚNG các ngày thật của tháng đó, từ ngày 1 tới
ngày cuối, không đệm ngày tháng lân cận nữa (khác bản 2026-09a — bản đó pad tới bội số 7 để thẳng
hàng Thứ Hai→Chủ Nhật; giờ layout 5 ô/hàng nên không cần thẳng hàng thứ nữa, không cần đệm). Mỗi ô có
`date`, `dayOfMonth`, `weekday` (chỉ để tra cứu, không hiển thị), `reward`, `boosterPerk`,
`isToday`/`isPast`/`isFuture`, `isClaimed` (đúng ngày đó nằm trong `claimedDates`, không suy luận từ
"trước hôm nay").

Ngày local theo đồng hồ máy người chơi (`YYYY-MM-DD`), không phải UTC, để lịch theo đúng ngày thật
của họ.

### Giao diện: lưới đen, ô vuông to, 5 ô/hàng, tự cuộn (kéo xuống xem thêm)

`SandGame.tsx` render lưới bằng CSS grid **5 cột** (2026-09b — trước đó là 7 cột thẳng hàng thứ, xem
`CHANGELOG-prototype.md` #172) trong một khối riêng nền tối (`.daily-login-calendar-scroll`) — không
còn nằm trong palette pastel chung của card, cố tình để đọc thành "một tấm lịch" riêng biệt bên trong
card. Mỗi ô là hình vuông (`aspect-ratio: 1`); khoảng cách `gap` 4px trên nền tối chính là các đường
kẻ lưới đen giữa ô, không cần border riêng từng ô. **Không còn header thứ** — chỉ số ngày trong tháng
(`dayOfMonth`) ở góc mỗi ô. Bớt từ 7 xuống 5 cột trong cùng bề ngang card khiến mỗi ô to hơn hẳn
("phóng to ô"). Khối cuộn có `max-height` cố định (190px, đủ hé lộ một phần hàng kế tiếp) +
`overflow-y: auto`, nên người chơi **kéo xuống (swipe)** để xem hết các ngày còn lại của tháng thay
vì mọi thứ bị ép co vừa khung.

**Bẫy hydration cần tránh khi sửa phần này:** `getDailyLoginCalendar`/`devNow()` đọc thẳng
`localStorage`, chỉ có thật trên client — gọi trực tiếp trong JSX lúc render sẽ khiến lần render đầu
tiên phía client (hydration) trả về khác với HTML server đã render (server luôn thấy
`claimedDates`/offset rỗng), React báo lỗi "Hydration failed...". Cách né: y hệt pattern
`initialDailyLogin`/`SERVER_DAILY_LOGIN` đã có — `dailyCalendar` đi qua `useSyncExternalStore` với
`SERVER_DAILY_CALENDAR` (mảng rỗng cố định) làm snapshot server, `readInitialDailyCalendar` cache một
lần lúc mount làm snapshot client; claim xong thì set qua `dailyCalendarOverride` (state React) chứ
không gọi lại hàm đọc storage ngay trong render. Tiêu đề tháng cũng không gọi `devNow()` trực tiếp —
suy ra từ `date` của Ô ĐẦU TIÊN trong `dailyCalendar` (đã hydration-safe sẵn, và giờ luôn là ngày 1
của tháng vì không còn ô đệm), vì dev date-offset tool chỉ tồn tại phía client, gọi `devNow()` thẳng
trong JSX sẽ lệch giữa server/client mỗi khi offset khác 0.

## Hearts (lượt chơi) — 2026-09c

Một currency thứ tư, KHÔNG nằm trong `Wallet` (không đi qua `addGold`-shaped logic) — sống trong kho
riêng `sand-cannon:v1:hearts`, hồi theo đồng hồ thật thay vì kiếm được bằng cách chơi. Nguồn:
`app/game/economy.ts` (mục "hearts (lives)"), HUD trong `app/SandGame.tsx`.

| Hằng số | Giá trị |
| --- | --- |
| `HEARTS_UNLOCK_LEVEL_ID` | 10 — chưa qua level này thì hearts coi như không tồn tại: không hiện chip HUD, Play không tốn gì |
| `MAX_HEARTS` | 5 |
| `HEART_REGEN_MINUTES` | 30 — mỗi tim thiếu hồi sau 30 phút |

**"1 lượt chơi" nghĩa là gì:** tốn đúng 1 tim ở 3 nơi — nút Play trên Home, "Play again" ở card FAIL,
nút Restart trong Settings lúc đang chơi (`tryStartAttempt` trong `SandGame.tsx`, gọi trước
`startPlaying()`/`restart()`, chặn hành động nếu trả về `false`). KHÔNG tốn tim khi: bấm Continue sau
WIN sang level kế (đang chơi liên tục, không phải một lượt mới), các `restart()` do FTUE tự động gọi
(demo hướng dẫn, không phải người chơi chủ động chơi lại), và **toàn bộ Zen Mode** (thiết kế vốn không
giới hạn — xem [zen-mode.md](zen-mode.md)).

**Hồi tim** — `computeHeartsState(record, now)`, hàm thuần cùng kiểu với `computeDailyLoginState`:
lưu `{ hearts, regenStartedAt }`; mỗi khoảng `HEART_REGEN_MS` trôi qua kể từ `regenStartedAt` là +1
tim (tối đa `MAX_HEARTS`), phần dư là thời gian còn lại tới tim tiếp theo. Đầy tank thì
`regenStartedAt: null`, không đếm ngược gì. `spendHeart(now)` chốt lại record về đúng trạng thái hiện
tại trước khi trừ — trừ đúng lúc tim vừa hồi xong vẫn tính đúng.

**HUD:** chip tim đặt CÙNG HÀNG với coin/emerald (`.hub-currency-row`), chỉ hiện khi unlock. Số tim
hiện tại là một badge nhỏ đè lên icon (không phải số trong pill như coin/emerald), pill cạnh bên chỉ
xuất hiện khi thiếu tim, hiện đếm ngược `m:ss` tới tim kế tiếp — tự chạy nhờ `setInterval` 1 giây
trong `SandGame.tsx` khi đã unlock.

**Bẫy hydration đã tránh (cùng bài học Daily Login #170):** `isHeartsUnlocked()`/`getHeartsState()`
đều đọc `localStorage`. `heartsUnlocked` đi qua `useSyncExternalStore` với snapshot server cố định
`false` (đúng cho mọi lần SSR — hearts chỉ unlock sau khi chơi thật). Giá trị tim/đếm ngược
(`hearts` state) khởi tạo bằng `SERVER_HEARTS` (tank đầy) và chỉ được tính lại TRONG một `useEffect`
(không bao giờ chạy lúc SSR/hydrate) — không phải một `useMemo` gọi thẳng `getHeartsState()` mỗi
render, cái sẽ đọc storage thật ngay ở lần render đầu tiên phía client và lệch với server.

**Unlock giữa phiên:** `heartsUnlockedOverride` (state React) được set `true` ngay tại beat thắng level
10 lần đầu, để chip HUD hiện ra NGAY trong phiên đó — không cần reload (khác `initialHeartsUnlocked`,
chỉ đọc storage một lần mỗi lần tải trang).

## Shop — 1 màn thống nhất, Gems đã bỏ hẳn (2026-09d)

Nguồn: `app/SandGame.tsx` (Shop screen), `app/game/economy.ts` (`Wallet` không còn field `gems`).

**Gems bị xoá khỏi toàn bộ game**, không chỉ khỏi UI Shop — `Wallet.gems`, `STARTER_GEMS`,
`getGems()` đã xoá hẳn khỏi `economy.ts`. Gems trước đó chưa từng có logic thật (chỉ hiển thị số,
không kiếm/tiêu/thanh toán được ở đâu), nên xoá không kéo theo tác dụng phụ nào — `readWallet()` vẫn
đọc được ví cũ có field `gems` thừa trong `localStorage` (JSON thêm 1 property vô hại, không crash).

**Không còn 2 tab (Gems / Coins)** — `shopTab` state đã xoá hẳn. Shop giờ là MỘT màn cuộn dọc, thứ tự
cố định từ trên xuống:

1. `SPECIAL_OFFERS` — 2 ưu đãi, mỗi cái bán Coins (tuỳ chọn) + Hearts (tuỳ chọn) + Blue Emerald (tuỳ
   chọn) — field nào có mặt mới render, không phải cả 3 luôn bắt buộc (vd ưu đãi cuối tuần không có
   coins).
2. `BUNDLES` — 5 mốc giá, LUÔN bán cả 3: Coins (giữ nguyên số của bundle cũ), Hearts (tăng dần, trần ở
   `MAX_HEARTS` — không mốc nào bán nhiều tim hơn bể chứa giữ được), Blue Emerald (top-up nhỏ, không
   đủ 1 skin ở mốc rẻ).
3. `COIN_PACKS` — mua xu trực tiếp, y nguyên 7 mốc cũ, gắn `ref` để nút vàng ở HUD (`openCoinPacks`)
   cuộn thẳng tới.
4. `HEART_PACKS` (mới) — mua tim trực tiếp, 3 mốc (1/3/5, mốc cao nhất "Full refill") — trần ở
   `MAX_HEARTS` vì không có chỗ chứa tim vượt quá bể.
5. **Boosters** — luồng mua DUY NHẤT thật sự tiêu được (vàng kiếm từ chơi) — chuyển xuống **cuối
   cùng** của màn hình, gắn `ref` để hint-dot của `hub-nav` (từng chuyển tab "Coins") giờ cuộn thẳng
   tới thay vì đổi tab.

Không có logic real-money nào được nối thật (`notifyIapComingSoon` vẫn chỉ là toast "chưa hoạt
động") — thay đổi lần này thuần là cơ cấu lại UI + đổi thành phần Gems→Hearts+Emerald trong dữ liệu
mock, không phải một tính năng thanh toán mới.
