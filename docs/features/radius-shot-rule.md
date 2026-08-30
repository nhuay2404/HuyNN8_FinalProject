# Luật cốt lõi: bắn theo bán kính + bánh xe đạn

Nguồn: `app/game/sand-types.ts` (`RadiusGameplayPolicy`, `RADIUS_GAMEPLAY`), `app/game/sand-rules.ts`.

## Một bộ luật duy nhất

Hai gameplay thử nghiệm trước đây (bắn cả vùng với settle cohesive, và bắn cả vùng với grain fall)
đã bị gỡ khỏi source, không phải chỉ tắt đi. Mọi level trong build này chạy dưới đúng một policy:
`RADIUS_GAMEPLAY` (`sand-types.ts`). Đổi một quyết định thiết kế là đổi một dòng trong object đó,
không phải sửa rải rác trong solver.

## Phát bắn: lấy một đĩa, không phải cả vùng

Phát bắn nhắm vào một **chỗ**, không phải một vùng. Nó lấy mọi hạt cùng màu nằm trong đĩa bán kính
quanh điểm chạm (`cellsInRadius` trong `sand-rules.ts`) — kể cả khi đĩa vươn sang nhiều vùng khác
nhau, và chỉ lấy phần nằm trong đĩa. Bắn giữa mảng thì khoét thủng, bắn rìa chỉ gặm được vài hạt.

Đây là chỗ code **cố tình đi ngược** brief gốc (`sand_cannon_concept.md` §5, vốn chốt một phát trúng
màu xoá toàn bộ connected body và cấm rõ việc chỉ xoá "một bán kính quanh impact"). Quyết định có
chủ ý, chọn hướng market-style sau khi so ba gameplay cạnh nhau — không phải sơ suất.

## Bánh xe đạn (`ammoRule: CYCLE_UNTIL_COLOR_CLEARED_TEMP`)

Queue là một **bánh xe**: bắn xong, nếu màu đó vẫn còn cát trên board thì viên đạn quay lại cuối
hàng; màu vừa sạch hẳn thì rời bánh xe luôn. Vì vậy không bao giờ có đạn chết (một màu trong wheel
mà không còn gì để bắn), và **ngân sách duy nhất là số lượt bắn** (`shotLimit`) — đó cũng là nơi độ
khó của một màn nằm. Editor chặn việc author ra một level có thể sinh đạn chết
(`deadBulletPolicy: VALIDATOR_ONLY_TEMP`) — xem
[level-format.md](level-format.md) và [level-editor.md](level-editor.md).

## Miss vẫn tốn lượt, trượt khung thì không (`missAmmoPolicy: MISS_IS_FREE_TEMP`)

Phát bắn không lấy được gì (trong bán kính không có màu đang cầm) **vẫn tiêu một lượt**; cả đĩa
rung để báo tầm với vừa trượt. Bắn hụt khung hoặc trúng thành khung thì **không** tiêu lượt.

## Adjacency và tie-break

- `adjacencyMode: ORTHOGONAL_4` — chỉ chạm cạnh mới nối, chạm góc không nối.
- `slideTieBreak: LEFT_FIRST_TEMP` — một rule global khi cát trượt chéo mà cả hai bên đều trống:
  trái thắng, luôn luôn (xem [settle-solver.md](settle-solver.md)).

## Win / fail

Win kiểm tra trước, fail kiểm tra sau — phát cuối dọn sạch khung là **thắng**, không phải hoà. Thắng
khi khung sạch cát (`remainingCells === 0`). Thua khi hết lượt mà **sau khi phát cuối đã resolve và
cát đã settle xong** vẫn còn cát.

## Một projectile một lượt

Không bắn được khi state đang ở `PROJECTILE_FLYING`, `HIT_RESOLUTION`, hoặc `SETTLING` — chỉ bắn
được ở `READY`.

## Mọi trường của `RadiusGameplayPolicy`

| Trường | Giá trị | Ý nghĩa |
| --- | --- | --- |
| `adjacencyMode` | `ORTHOGONAL_4` | Open Decision 1 & 2 |
| `settlePolicy` | `GRAIN_FALL_TEMP` | Open Decision 3 — xem [settle-solver.md](settle-solver.md) |
| `slideTieBreak` | `LEFT_FIRST_TEMP` | Open Decision 4 & 5 |
| `missAmmoPolicy` | `MISS_IS_FREE_TEMP` | Open Decision 6 & 7 |
| `deadBulletPolicy` | `VALIDATOR_ONLY_TEMP` | Open Decision 12 — editor chặn ngay lúc author, không có runtime fallback |
| `shotRule` | `RADIUS_SORT_TEMP` | Ngoài brief — xem phần "Một bộ luật duy nhất" ở trên |
| `ammoRule` | `CYCLE_UNTIL_COLOR_CLEARED_TEMP` | Ngoài brief |
| `nextPreviewCount` | `3` | Open Decision 9 — số viên đạn tiếp theo hiện trong HUD |
| `cannonConfigRef` | `"prototype-classic-cannon"` | §20 — cannon giữ nguyên control/ballistics từ bản pre-pivot |

Mọi trường có hậu tố `_TEMP` là một Open Decision trong brief **chưa chốt hẳn**, không phải
hardcode tuỳ tiện — mỗi cái là câu trả lời tạm thời cho một câu hỏi thiết kế còn mở.
