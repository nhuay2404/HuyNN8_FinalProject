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
| `BOOSTER_PRICE.radiusOvercharge` | 60 | `boosterPriceRadiusOvercharge` |
| `BOOSTER_PRICE.prismShot` | 100 | `boosterPricePrismShot` |
| `DAILY_LOGIN_REWARDS[0..6]` | 10, 15, 20, 25, 30, 40, 80 | `dailyLoginDay1`..`dailyLoginDay7` |

Prism Shot giá cao hơn Radius Overcharge vì là buff mạnh hơn hẳn: Radius Overcharge nhân đôi bán
kính, Prism Shot bỏ hẳn điều kiện đúng màu — xem
[booster-radius-prism-spec.md](booster-radius-prism-spec.md).

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

## Daily Login

Chu kỳ 7 ngày, **lặp lại** chứ không leo thang mãi — leo thang trong tuần thưởng việc quay lại ngày
mai, lặp lại giới hạn việc chỉ dựa vào đăng nhập thay vì chơi level. Cố tình nhỏ hơn cả một level dễ
(20–30 vàng hầu hết các ngày): đây là bonus vì ghé qua, không phải cách kiếm chính — bảng level mới
là cách chính.

`computeDailyLoginState(record, now)` là hàm thuần quyết định streak:

- Gap = 0 ngày (đã claim hôm nay) → giữ nguyên `day`, `claimedToday: true`.
- Gap = 1 ngày → tăng `day` lên 1, quấn vòng về 0 sau ngày 7 (giữ trọn tuần, không đếm ngược về 0).
- Gap ≥ 2 ngày hoặc chưa từng claim → reset về `day: 0` — **streak vỡ thì bắt đầu lại từ đầu**, cố
  ý.

Ngày local theo đồng hồ máy người chơi (`YYYY-MM-DD`), không phải UTC, để streak theo đúng lịch của
họ.
