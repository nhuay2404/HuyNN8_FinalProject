# Thưởng vàng theo từng level

Nguồn: `app/game/level-rewards.ts`, `public/design/level-rewards.csv`, `app/game/economy.ts`
(`levelGoldReward`), `app/SandGame.tsx`.

## Công thức mặc định

Mọi level, cho tới khi có ai chỉnh tay, trả thưởng theo công thức dựa trên điểm độ khó — xem
[difficulty-measurement.md](difficulty-measurement.md#2-computeleveldifficulty-level-difficultyts--điểm-0100-cho-danh-sách-editor):

```ts
levelGoldReward(score) = round((5 + score * 0.3) / 5) * 5
```

`score` là `computeLevelDifficulty(level).score` (0–100). Kết quả nằm trong khoảng **5** (score 0)
đến **35** (score 100), làm tròn tới bội số của 5 để hai level gần nhau không trả ra số lẻ trông
tuỳ tiện. Được cân chỉnh (2026-09) sao cho một level độ khó trung bình (score 50) trả đúng **20
vàng** — `BOOSTER_PRICE.radiusOvercharge / 5` — tức chơi khoảng 5 level (lần đầu thắng) là đủ mua 1
lượt Radius Overcharge/Prism Shot. Xem [economy-and-wallet.md](economy-and-wallet.md) và GDD.md §10.

Được tính trên `raw` — level ở scale blueprint như tác giả viết, không phải `level` đã mở rộng lên
pixel board — cùng scale với chính `computeLevelDifficulty` mà editor dùng để xếp hạng danh sách.

### Thưởng mốc hàng chục (10/20/30/40/50)

Cộng thêm vào số trên (bất kể tới từ công thức hay CSV override), chỉ ở lần thắng đầu tiên, là
`levelMilestoneBonus(levelId)` — 0 với mọi level không phải mốc, và một số tăng dần (65→75→90→100→115)
ở 5 level mốc 10/20/30/40/50 — xem [economy-and-wallet.md](economy-and-wallet.md#thưởng-mốc-hàng-chục-level-102030405).

## Override tay qua CSV

Level nào cần một con số khác công thức thì thêm một dòng vào `public/design/level-rewards.csv`:

```csv
id,name,reward
1,Level 1,10
```

- `id` phải khớp `SandLevelConfig.id`.
- `name` chỉ để người đọc file dễ theo dõi — game **không đọc** cột này.
- Level nào không có dòng trong bảng thì tự tính theo công thức ở trên — không bắt buộc điền hết
  mọi level.

Cơ chế fetch/poll giống hệt `economy.csv` (xem
[economy-and-wallet.md](economy-and-wallet.md)) — `level-rewards.ts` fetch runtime, poll mỗi 4 giây
trong khi tab mở, không có server thì rơi về công thức, không lỗi.

## Trả đúng một lần

Một level trả thưởng đúng **lần đầu tiên thắng** trên trình duyệt này (`markLevelCleared` trả `true`
lần đầu, `false` từ lần thứ hai). Chơi lại một level dễ không phải là cách cày vàng vô hạn — số
thưởng có ý nghĩa chính vì nó được đo theo độ khó thật, farming vô hạn sẽ phá hỏng ý nghĩa đó.
Trạng thái "đã thắng" lưu ở `localStorage`, tách riêng khỏi ví.
