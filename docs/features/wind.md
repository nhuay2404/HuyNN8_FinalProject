# Wind

Nguồn: `app/game/sand-types.ts` (`WindConfig`, `WindPhase`, `WindZone`), `app/game/sand-rules.ts`.

Đây là data của level, không phải một nhánh code riêng: level không khai `wind` đọc và chạy y hệt
như trước khi cơ chế này tồn tại — xem [radius-shot-rule.md](radius-shot-rule.md).

## `wind: { phases: [...] }`

Một **vòng lặp các pha**, chạy hết rồi quay lại từ đầu. Mỗi pha khai báo năm thứ:

| Trường | Nghĩa |
| --- | --- |
| `direction` | `"left"` / `"right"` — đặt tên theo *cát đi đâu*, không phải gió đến từ đâu |
| `durationMs` | thổi trong bao lâu |
| `cooldownMs` | lặng gió bao lâu sau đó, trước khi pha kế tiếp bắt đầu |
| `power` | một cơn gust đẩy cát bao nhiêu ô (đơn vị blueprint cell) |
| `zone` | hình chữ nhật gió với tới (`{ x, y, width, height }`, `x`/`y` là góc dưới-trái); `null` là cả khung |

Một pha là **một quãng thời tiết**, không phải một cú đẩy: nó gust liên tục suốt `durationMs`. Nhờ
tách "thổi bao lâu" khỏi "đẩy mạnh bao nhiêu" mà "gió nhẹ kéo dài" và "một cú tát" là hai thứ khác
nhau viết được. Một pha thì level lúc nào cũng thổi một hướng; nhiều pha thì là một pattern người
chơi học được.

## Gió tương tác với solver rơi thế nào

Gió đẩy cát rồi trả board về **đúng solver rơi cũ** (xem [settle-solver.md](settle-solver.md)), nên
cát bị thổi khỏi mép vẫn rơi y như cát vẫn rơi. Lưu ý phần rơi đó **không bị giới hạn bởi zone**:
gió với tới đâu là chuyện của gió, còn trọng lực là của cả khung — cát bị thổi ra rìa zone vẫn rơi
xuyên qua ranh giới đó.

Cát khoá không nhúc nhích khi có gió; chìa khoá thì có (xem [lock-and-key.md](lock-and-key.md)),
nên gió tự nó có thể mở một ổ khoá.

## Gió không tiêu lượt, không làm thua

Gió **không tiêu lượt** và không bao giờ làm thua, vì ngân sách (`shotLimit`) chỉ động khi người
chơi bắn — xem [radius-shot-rule.md](radius-shot-rule.md).

## Đồng hồ nằm ở engine

`sand-rules.ts` không có đồng hồ — luật rơi vẫn là pure function không thời gian thật. Đồng hồ pha
nằm ở `SandCannonEngine.ts`. Engine không bao giờ cho gió nổi giữa lúc đạn đang bay hay cát đang
rơi: board người chơi ngắm phải là board viên đạn hạ xuống. Đồng hồ pha vẫn chạy trong lúc đó, nên
cơn gió bị hoãn đến ngay khi board thuộc về người chơi trở lại.

## Đơn vị scale

`power` và `zone` tính bằng blueprint cell nên được `expandLevelForPixelBoard` scale cùng board;
`durationMs`/`cooldownMs` là thời gian thật nên **không** scale — xem
[level-format.md](level-format.md#độ-phân-giải-mô-phỏng-pixelscale).

## Vẽ trong editor

Mục **Wind** dựng cả vòng lặp: thêm/xoá/đảo thứ tự pha, và bấm tiêu đề một pha thì **zone của nó vẽ
đè lên tranh** — bốn con số trong sidebar thì không hình dung được, hình chữ nhật trên chính bức
tranh thì có.

## Level thử: `Crosswind`

`crosswind` trong `design/levels/sand-levels.ts` — không nằm trong `BUILT_IN_LEVELS`/roster người
chơi thấy được, chỉ là fixture cho `tests/sand-mechanics.test.ts`.
