# Level editor

Nguồn: `app/LevelEditor.tsx`, `app/game/level-drafts.ts`, `scripts/level-writer.mjs`.

Mở ở `/editor` (hoặc bấm nút ✎ trong game).

| Tính năng | Chi tiết |
| --- | --- |
| Vẽ tranh pixel | Canvas theo grid, palette 10 màu, công cụ Brush / Fill / Eraser, Undo-Redo (kèm Ctrl+Z) |
| Kích thước tuỳ ý | Rộng 6–24, cao 6–28 ô blueprint. Đổi kích thước **neo theo đáy khung**, vì cát nằm trên sàn |
| Bánh xe đạn | Chỉ nạp được màu đã vẽ; sắp xếp thứ tự bằng ↑ ↓; nút **Match picture** dựng lại wheel từ tranh |
| Số lượt bắn | Ô `Shots`, kèm nút **Measure difficulty** đo thật — xem [difficulty-measurement.md](difficulty-measurement.md) |
| Nhiều level | Danh sách bên trái: New / Duplicate / Delete. Lưu tự động vào trình duyệt (`localStorage`) |
| Thử trong game | Nút **Test in game** mở thẳng level đó. Mọi draft hợp lệ cũng hiện trong level switcher |
| Đưa vào source | Nút **Ship to sand-levels.ts** ghi thẳng level vào `design/levels/sand-levels.ts`, không cần copy-paste (xem bên dưới) |
| Khoá màu | Nút `🔒 Locked` — modifier của cọ, không phải tool riêng, xem [lock-and-key.md](lock-and-key.md) |
| Đóng dấu chìa khoá | Nút `Key` — đóng dấu cả hình chìa khoá lởm chởm, không quét từng ô, xem [lock-and-key.md](lock-and-key.md) |
| Gió | Mục **Wind** — thêm/xoá/đảo thứ tự pha, zone vẽ đè lên tranh khi bấm tiêu đề pha, xem [wind.md](wind.md) |
| Zen Mode | Checkbox **🧘 Zen Mode level** — bật thì `Shots` bị vô hiệu hoá (luôn không giới hạn khi chơi), level chỉ hiện trên danh sách Zen trong game (Modes → Zen Mode), không lẫn vào level switcher chính. Bảng 24 swatch màu cũng đổi thành 1 color picker tự do (snap về màu gần nhất khi vẽ), và import ảnh bỏ qua `Max colours` — luôn khớp màu chính xác nhất có thể. Xem [zen-mode.md](zen-mode.md) |

Lưới trong editor **chính là board pixel thật** (mặc định 60×70), `pixelScale` luôn là `1` trong
editor và ô chọn scale đã bị bỏ — không còn chuyện author nhìn một bức 12 ô nhưng game chạy một bức
60 pixel. `expandLevelForPixelBoard` vẫn còn dùng cho level viết tay
(`design/levels/sand-levels.ts` dùng `pixelScale: 5`) và cho migration draft cũ trong
`localStorage`.

## Hai lỗi editor bắt buộc phải chặn

Cả hai đều đến từ bánh xe đạn (xem [radius-shot-rule.md](radius-shot-rule.md)), và cả hai đều là
**ván không thể thắng nhưng game không hề báo gì**:

- **Màu có trong tranh nhưng không có trong wheel** — vùng cát đó không bao giờ được bắn tới.
- **Màu có trong wheel nhưng không có trong tranh** — viên đạn mở màn không có gì để bắn.

Vì thế cả hai là **error** (không phải warning), sửa được bằng nút **Fix wheel** (wheel suy được từ
tranh). Level nào còn error thì không xuất hiện trong level switcher của game.

Ngoài ra editor cảnh báo khi tranh **chưa đứng yên** (xem [settle-solver.md](settle-solver.md)).
Nút **Settle it** thả tranh xuống đúng trạng thái nghỉ, không thêm không mất hạt nào.

## Đưa một level vào source

Level lưu trong `localStorage` là đủ để chơi và thử — mở lại `/editor` sau này, level vẫn còn
nguyên ở đó. Muốn nó sống qua việc xoá cache trình duyệt hoặc một checkout mới thì bấm
**Ship to sand-levels.ts**: nút này ghi thẳng khối `SandLevelConfig` vào
`design/levels/sand-levels.ts` và thêm nó vào mảng `EDITOR_LEVELS`/`BUILT_IN_LEVELS`, không cần
copy-paste tay. Ship lại cùng một level (cùng tên) sẽ cập nhật đúng khối đó tại chỗ thay vì tạo bản
trùng.

Nút này gọi tới một server Node nhỏ chạy riêng (`scripts/level-writer.mjs`), vì dev/build target
của project này là Cloudflare Workers (`worker/index.ts`) — runtime đó không có filesystem thật,
nên một route trong `app/` không bao giờ ghi được file. Chạy server đó một lần, để song song với
`npm run dev`:

```bash
npm run level-writer
```

Nếu server chưa chạy, nút sẽ báo lỗi và gợi ý lệnh trên; **Copy TypeScript** vẫn còn đó làm phương
án thủ công.
