# Lock & Key

Nguồn: `app/game/sand-rules.ts`, `app/game/sand-types.ts` (`SandKey`, `keyFriction`),
`app/game/sand-sprites.ts` (`KEY_SPRITE`, `PADLOCK_SPRITE`).

Đây là data của level, không phải một nhánh code riêng: level không dùng tới lock & key đọc và chạy
y hệt như trước khi cơ chế này tồn tại — xem [radius-shot-rule.md](radius-shot-rule.md).

## Cát khoá

Chữ thường trong tranh (`y`, `p`, …) là cát **bị khoá**: vẫn là cát — có màu, chiếm ô, đỡ cát khác,
tính vào điều kiện thắng — nhưng không rơi và đĩa bắn không nhìn thấy. Vì không rơi nên nó lơ lửng
giữa khung. Xem bảng mã màu ở [level-format.md](level-format.md).

Một màu bị khoá **toàn bộ** sẽ không được bánh xe phát ra (`shootableColors`) — phát viên đạn đó ra
thì đúng là dead bullet mà `deadBulletPolicy` sinh ra để cấm — và nó quay lại bánh xe ngay khi khoá
mở.

Cát khoá vẽ **tối đi** chứ không nhuộm màu: màu bên dưới vẫn phải đọc được, vì đó chính là viên đạn
bánh xe sẽ phát khi khoá mở.

## Chìa khoá

Chữ `K` là **chìa khoá**, một sprite pixel cứng: nó rơi như cát nhưng cả khối cùng đi, vì một chìa
khoá vỡ thành từng hạt ở lần rơi đầu tiên thì không còn là một vật thể. Chìa khoá chạm vào ô khoá
nào thì **cả vùng khoá liền kề đó** tan băng cùng lúc (bước `UNLOCK`, xem
[settle-solver.md](settle-solver.md)), và chìa khoá mất đi.

Chìa khoá là một silhouette lởm chởm vẽ tay (`KEY_SPRITE`, `sand-sprites.ts`), không phải hình
tròn — nó trượt trên cát, không lăn. Vật lý của chìa khoá là vật lý của cát, áp cho cả khối: rơi
thẳng khi dưới trống, trượt chéo khi không, và bị gió thổi ngang (xem [wind.md](wind.md)). Khác
biệt duy nhất là tính cứng — một nước đi chỉ xảy ra khi *mọi* ô đích đều hợp lệ cùng lúc, nên một
chìa khoá có ô nằm ngoài khung thì không nhúc nhích được (editor chặn không cho đặt như vậy).

Vì là một sprite vẽ tay cố định chứ không phải công thức hình học, cỡ chỉnh theo **bội số nguyên**
của chính sprite đó (`spriteCells(KEY_SPRITE, scale)`, giống `PADLOCK_SPRITE`) — không có khái niệm
"to thêm một pixel" cho một hình lởm chởm.

## `keyFriction` — độ trơn trượt

`keyFriction` (0–1, trường trong `SandLevelConfig`, mục "Key friction" trong editor) quyết định độ
trơn trượt — `0` là trơn tối đa (trượt ngay khi có đường đi), `1` là ì (chờ vài pass mới trượt). Chỉ
cản **chuyển động ngang** — rơi thẳng đứng không bao giờ bị chậm lại, đúng như ma sát thật chỉ tác
động dọc theo bề mặt tiếp xúc, không bao giờ chống lại trọng lực.

Cơ chế: mỗi lần chìa khoá có cơ hội trượt/bị gió thổi mà chưa đi, nó "chờ" thêm một pass; đủ
`round(friction × 4)` pass thì mới thực sự di chuyển. Không khai `keyFriction` mặc định là `0` —
trơn trượt cao nhất.

## Vẽ trong editor

- Nút `🔒 Locked` là *modifier của cọ*, không phải tool riêng — khoá là một trạng thái của một màu,
  nên phải vẽ bằng một màu.
- Nút `Key` **đóng dấu** cả hình chìa khoá lởm chởm, không phải quét từng ô: chìa khoá là một
  *shape*, và game gom các ô `K` liền nhau thành một vật thể (mọi ô phải liền nhau 4-hướng, nếu
  không `parseSandLevel` sẽ tách thành nhiều chìa khoá). Bấm lại lên một chìa khoá đã có thì **nhấc
  nó lên**; đổi cỡ = nhấc, chỉnh, đặt lại.

Preview của editor tính cỡ ổ khoá ở **độ phân giải board thật** rồi thu lại để vẽ, chứ không tính ở
cỡ blueprint — game dán icon lên board đã mở rộng, nên tính ở cỡ blueprint sẽ cho editor và game
bất đồng về chỗ nào đủ to để có ổ khoá. Ổ khoá **bỏ hẳn** khi vùng quá nhỏ — một ổ khoá tràn ra
ngoài chỗ nó đang chú thích thì đọc thành rác.

## Lưu ý khi tự vẽ

Cát chỉ đứng yên khi mỗi cột mép cao hơn cột bên cạnh **tối đa 1 ô**, nên một khối vuông đặt trên
một slab hẹp sẽ lăn khỏi sườn của chính nó ở frame đầu — xem
[settle-solver.md](settle-solver.md#tự-kiểm-một-level-đã-đứng-yên-chưa).

## Level thử: `Lock & Key`

`lockAndKey` trong `design/levels/sand-levels.ts` — không nằm trong `BUILT_IN_LEVELS`/roster người
chơi thấy được, chỉ là fixture cho `tests/sand-mechanics.test.ts` và `tests/sand-boosters.test.ts`.
