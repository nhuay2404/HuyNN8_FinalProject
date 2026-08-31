# Settle solver — cát rơi theo từng hạt

Nguồn: `app/game/sand-rules.ts` (`runGrainSettle` và các hàm liên quan), `app/game/sand-types.ts`
(`SettleStep`, `SettleOutcome`).

## Cellular automaton falling-sand thật

Tham khảo trực tiếp từ [UniSand](https://github.com/etopuz/UniSand) (MIT): mỗi pixel rơi thẳng nếu
ô dưới trống, không thì lăn xuống chéo — trái trước phải sau (`slideTieBreak: LEFT_FIRST_TEMP`, xem
[radius-shot-rule.md](radius-shot-rule.md)). Lăn chéo còn đòi ô **bên cạnh** cũng trống, nếu không
hạt sẽ chui lọt qua khe chéo giữa hai hạt khác.

Chạy **thật** ở độ phân giải hiển thị (pixel board), không phải một lớp trình diễn phủ lên lưới
thô hơn — xem [rendering-pixel-board.md](rendering-pixel-board.md).

## Một pass là một step

Mọi hạt di chuyển được một bước trong một pass, và **cả pass là một `SettleStep` kiểu `GRAIN_PASS`**:
một cột cát rút mười bốn hàng phải là mười bốn nhịp cát chảy, không phải hai trăm cú giật riêng lẻ.
Board được quét từ đáy lên nên hạt vừa rơi không bị xử lý hai lần trong cùng một pass.

`runGrainSettle()` trả về một **danh sách bước** (`SettleStep[]`) chứ không chỉ trả board cuối.
Renderer diễn lại đúng danh sách đó, nên cái người chơi nhìn thấy chính là quá trình solver đã
chạy — không phải một animation dựng song song. Có test dựng lại board bằng tay từ danh sách bước
và so với board solver trả ra.

## Vì sao bỏ cohesion (Open Decision 3)

Body được suy lại từ đầu sau khi rơi xong: cohesion đã bỏ thì không có gì để giữ, và hai vùng cùng
màu chạm nhau đơn giản là **một** connected component. Nhãn body chỉ đúng ở thời điểm cuối, nên
renderer được báo một lần bằng step `REINDEX` khép lại cascade.

Luật bán kính khoét lỗ vào giữa một mảng cát. Với solver giữ liền khối (bản cũ, đã gỡ), mảng cát
phía trên cái lỗ đó treo lại thành một cái vòm — đúng theo rule Phase C của brief gốc, nhưng nhìn
như lỗi chứ không như cát. Đây là Open Decision 3, và bản này chọn đầu bên kia của nó:
`settlePolicy: GRAIN_FALL_TEMP`.

## Bốn loại `SettleStep`

| Kind | Ý nghĩa |
| --- | --- |
| `GRAIN_PASS` | Một pass rơi/lăn — danh sách `{ from, to }` các ô di chuyển, có thứ tự |
| `REINDEX` | Gán lại body id cho từng ô sau khi mọi thứ đã đứng yên, không di chuyển gì |
| `KEY_MOVE` | Một chìa khoá dịch một ô, cả khối cùng lúc — xem [lock-and-key.md](lock-and-key.md) |
| `UNLOCK` | Một vùng khoá tan băng khi chìa khoá chạm tới — xem [lock-and-key.md](lock-and-key.md) |

## Ngân sách thời gian cho cascade (Open Decision 17)

Thay vì cắt ngang bằng snap-to-stable, cả cascade được ép vào một budget thời gian ở tầng engine
(không phải ở `sand-rules.ts` — file này không có đồng hồ). Settle hai bước chạy chậm và đọc được;
sụp đổ bốn mươi bước chạy nhanh nhưng vẫn diễn đủ từng bước theo đúng thứ tự. Không bước nào bị bỏ.

## Tự kiểm một level đã "đứng yên" chưa

Cát vẽ lơ lửng sẽ sụp ngay frame đầu, và cái người chơi nhìn thấy sẽ không phải cái đã author.
Viết tay thì tự kiểm bằng `runGrainSettle(bodies, frame)` — không có step `GRAIN_PASS` nào nghĩa là
board đã đứng yên. Editor có nút **Settle it** làm việc này tự động — xem
[level-editor.md](level-editor.md).
