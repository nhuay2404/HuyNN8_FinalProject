# Cách viết một level

Nguồn: `app/game/sand-types.ts` (`SandLevelConfig`), `app/game/sand-rules.ts`
(`SAND_COLOR_BY_LETTER`, `KEY_LETTER`, `parseSandLevel`), `design/levels/sand-levels.ts`.

Level nào cũng có thể vẽ bằng **editor** ở `/editor` — đó là cách nhanh nhất, xem
[level-editor.md](level-editor.md). Phần dưới đây là để viết tay hoặc để đọc hiểu level đã có.

## Một level là gì

Một level là `RADIUS_GAMEPLAY` (xem [radius-shot-rule.md](radius-shot-rule.md)) spread ra, cộng
phần nội dung của chính nó:

```ts
export const myLevel: SandLevelConfig = {
  ...RADIUS_GAMEPLAY,
  id: 99,
  name: "Tên level",
  frame: { width: 12, height: 14 },
  rows: [ /* xem bên dưới */ ],
  ammoQueue: ["red", "green", "yellow"],
  sortRadius: 2.5,
  shotLimit: 26,
  pixelScale: 5,
};
```

Muốn thêm level vào danh sách file sẽ đưa vào build thì thêm vào mảng `BUILT_IN_LEVELS` trong
`design/levels/sand-levels.ts` (xem [design/levels/README.md](../../design/levels/README.md)).

## Bức tranh: `rows`

Một ký tự một ô, hàng trên cùng viết trước, `.` là ô trống. Toạ độ: `x` chạy trái → phải, `y` chạy
dưới → trên, `y = 0` nằm trên đáy khung.

| Mã | Màu |
| --- | --- |
| `R` | đỏ (red) |
| `G` | xanh lá (green) |
| `Y` | vàng (yellow) |
| `B` | xanh dương (blue) |
| `P` | tím (purple) |
| `O` | cam (orange) |
| `C` | xanh ngọc (cyan) |
| `M` | hồng (pink) |
| `L` | xanh chanh (lime) |
| `N` | nâu (brown) |

Chữ thường của một trong mười mã trên (`r`, `g`, ...) là cát **bị khoá** thay vì bị bắn tự do —
xem [lock-and-key.md](lock-and-key.md). Chữ `K` là **chìa khoá**, không phải một màu.

SandBody **không** khai báo riêng: body chính là vùng 4-connected cùng màu trong bức tranh
(`adjacencyMode: ORTHOGONAL_4`). Hai vùng cùng màu vẽ dính nhau đơn giản là một body, không có cách
nào biểu diễn chúng thành hai.

### Bức tranh phải đứng yên sẵn

Cát vẽ lơ lửng sẽ sụp ngay frame đầu, và cái người chơi nhìn thấy sẽ không phải cái đã author. Tự
kiểm bằng `runGrainSettle(bodies, frame)` — xem [settle-solver.md](settle-solver.md).

## Bánh xe đạn: `ammoQueue`

Danh sách này chỉ là **thứ tự khởi đầu** — dưới luật cycle-until-cleared nó là một bánh xe, không
phải một hàng đợi hữu hạn (xem [radius-shot-rule.md](radius-shot-rule.md)).

Hai lỗi bắt buộc phải tránh, cả hai đều là **ván không thể thắng nhưng game không hề báo gì** nếu
viết tay và không qua editor:

- Màu có trong tranh nhưng không có trong `ammoQueue` — vùng cát đó không bao giờ được bắn tới.
- Màu có trong `ammoQueue` nhưng không có trong tranh — viên đạn mở màn không có gì để bắn.

## Bán kính và ngân sách: `sortRadius`, `shotLimit`

`sortRadius` tính bằng blueprint cell, được scale cùng board bởi `expandLevelForPixelBoard`.
`shotLimit` **là** độ khó của level — đừng chọn bằng cảm tính, dùng
[difficulty-measurement.md](difficulty-measurement.md) (nút **Measure difficulty** trong editor).

## Độ phân giải mô phỏng: `pixelScale`

Board ship thật là một `HTMLCanvasElement` runtime, không phải mesh 3D — xem
[rendering-pixel-board.md](rendering-pixel-board.md). `pixelScale` là hệ số phóng nguyên từ
blueprint (`rows`) lên board pixel thật. Level có sẵn dùng `5` (12×14 blueprint → 60×70 pixel).
Phóng to đều theo bội số nguyên không thể làm sai puzzle: số vùng, độ liền kề và các lần merge giữ
nguyên y hệt, chỉ nhiều pixel nhỏ hơn hợp thành (test: `tests/sand-pixel-board.test.ts`).

## Tuỳ chọn: `wind`, `keyFriction`, `requiresBooster`, `notes`, `tutorial`

- `wind` — xem [wind.md](wind.md). Bỏ trống (`undefined`/`null`) là trời lặng suốt màn.
- `keyFriction` (0–1) — độ ì của chìa khoá khi trượt ngang, xem [lock-and-key.md](lock-and-key.md).
  Chỉ có ý nghĩa nếu tranh có chữ `K`.
- `requiresBooster` — danh sách `BoosterType` mà level không thể clear nếu thiếu (spec §5, xem
  [booster-radius-prism-spec.md](booster-radius-prism-spec.md)). **Hiện chưa có gì đọc trường này**
  — đây là data flag chờ một solver/validator tương lai, không phải cơ chế đang chạy.
- `notes` — ghi chú tự do cho người đọc file, không được engine đọc.
- `tutorial` — overlay hướng dẫn hiện một lần khi level được mở lần đầu (`title` + `steps`), trạng
  thái đã-xem lưu ở `localStorage` theo `id`. Bỏ trống nếu level không dạy gì mới.
- `ftueGesture` — FTUE bằng cử chỉ thay vì chữ: `true` vẽ một icon tay-kéo lặp lại đè lên joystick
  thật (không phải một hộp chữ), tự tắt ngay khi người chơi chạm lần đầu vào aim-zone
  (`AIM_TOUCHED`), và ẩn cả khay booster suốt level đó — badge số đạn/màu đạn vẫn hiện. Khác
  `tutorial`, đây **không** phải "hiện một lần rồi thôi": nó hiện lại mỗi khi app bị kill rồi mở lại
  (tính bằng `sessionStorage` — phiên mới thì trống), hoặc khi đã hơn
  `FTUE_GESTURE_REPLAY_AFTER_MS` (6 giờ) kể từ lần hiện gần nhất dù app chưa hề bị kill (tính bằng
  `localStorage`, key `sand-cannon:v1:ftue-gesture-last-shown`, theo `id`). Xem
  `shouldShowFtueGesture`/`markFtueGestureShown` trong `SandGame.tsx`, doc comment của trường này
  trong `sand-types.ts`, và `defaultLevel`/Level 1 trong `sand-levels.ts` — level duy nhất bật cờ
  này, cố tình chỉ có một màu cát để bài học duy nhất là ngắm-và-bắn không bị pha loãng.
