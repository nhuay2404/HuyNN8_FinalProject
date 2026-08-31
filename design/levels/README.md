# Level design

Thư mục này tách nội dung level ra khỏi engine (`app/game/`) — đây là chỗ **tự tay chỉnh** danh
sách level mà không cần đụng vào logic game.

## `sand-levels.ts`

- `BUILT_IN_LEVELS` — danh sách level thật sự người chơi thấy được (đến từ `EDITOR_LEVELS`, khối
  giữa hai marker `// ==== Editor-shipped levels ====` / `// ==== End editor-shipped levels ====`).
  **Đừng sửa tay bên trong khối này** — nó bị ghi đè toàn bộ mỗi lần bấm "Ship to sand-levels.ts"
  trong editor (xem dưới).
- `defaultLevel` — level mặc định duy nhất khi chưa ship gì từ editor.
- `sandBloom`, `lockAndKey`, `crosswind` — **không** nằm trong `BUILT_IN_LEVELS`. Đây là fixture cho
  test suite (`tests/sand-radius.test.ts`, `sand-mechanics.test.ts`, `sand-boosters.test.ts`,
  `sand-pixel-board.test.ts`) khai thác đúng hình dạng của chúng — đừng đưa vào roster hay đổi hình
  dạng mà không kiểm lại các test đó trước.

## Cách thêm/sửa một level

1. **Cách khuyên dùng** — vẽ ở `/editor`, bấm **Ship to sand-levels.ts** (cần chạy
   `npm run level-writer` song song với `npm run dev`). Xem
   [docs/features/level-editor.md](../../docs/features/level-editor.md).
2. **Viết tay** — thêm một object `SandLevelConfig` mới (spread `RADIUS_GAMEPLAY`) và đẩy vào
   `BUILT_IN_LEVELS`. Xem format đầy đủ ở
   [docs/features/level-format.md](../../docs/features/level-format.md).

Trước khi ship/commit một level, đo độ khó thật bằng nút **Measure difficulty** trong editor thay
vì chọn `shotLimit` bằng cảm tính — xem
[docs/features/difficulty-measurement.md](../../docs/features/difficulty-measurement.md).

## Liên quan

- Thưởng vàng khi thắng một level cụ thể: sửa `public/design/level-rewards.csv`, xem
  [design/economy/README.md](../economy/README.md).
