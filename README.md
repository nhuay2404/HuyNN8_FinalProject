# 3D Sand Cannon Sort — playable prototype

Prototype puzzle WebGL 3D theo brief `sand_cannon_concept.md`. Người chơi bắn đạn màu vào một bức
tranh cát 3D nằm trong khung tĩnh; cát bị lấy đi thì phần còn lại rơi xuống.

Bản pivot này thay hoàn toàn core cũ (xoay model, Goal/Batch, Weak Point, Rainbow Target). Những
thứ đó đã bị gỡ khỏi source, không phải chỉ tắt đi.

## Một bộ luật: bắn theo bán kính

Hai gameplay thử nghiệm trước đây (bắn cả vùng với settle cohesive, và bắn cả vùng với grain fall)
**đã bị gỡ khỏi source**, không phải chỉ tắt đi. Chỉ còn luật bán kính.

Phát bắn nhắm vào một **chỗ**, không phải một vùng. Nó lấy mọi hạt cùng màu nằm trong đĩa bán kính
quanh điểm chạm — kể cả khi đĩa với sang nhiều vùng khác nhau, và chỉ lấy phần nằm trong đĩa. Bắn
giữa mảng thì khoét thủng, bắn rìa chỉ gặm được vài hạt. Đĩa được vẽ thành vòng tròn bám crosshair
lúc ngắm và loé lên chỗ đạn rơi.

Queue là một **bánh xe**: bắn xong, nếu màu đó vẫn còn cát trên board thì viên đạn quay lại cuối
hàng; màu vừa sạch hẳn thì rời bánh xe luôn. Nên không bao giờ có đạn chết, và **ngân sách duy nhất
là số lượt bắn** — đó cũng là nơi độ khó của một màn nằm.

Phát bắn không lấy được gì (trong bán kính không có màu đó) **vẫn tiêu một lượt**; cả đĩa rung để
báo tầm với vừa trượt. Bắn hụt khung hoặc trúng thành khung thì **không** tiêu lượt.

Thắng khi khung sạch cát. Thua khi hết lượt mà **sau khi phát cuối đã resolve và cát đã settle
xong** vẫn còn cát. Có restart.

### Mọi luật nằm trong `RADIUS_GAMEPLAY`

Trước đây mỗi level tự khai tám dòng policy giống hệt nhau. Giờ chúng gom vào một object duy nhất
trong `sand-types.ts`, và một level chỉ còn mang **nội dung của chính nó**: bức tranh, bánh xe màu,
bán kính, ngân sách lượt, độ phân giải. Đổi một quyết định thiết kế là đổi một dòng, và level do
editor xuất ra cũng ngắn đúng bằng thứ nó thật sự mô tả.

Các hằng đó vẫn được **đặt tên** chứ không inline, vì mỗi cái là câu trả lời cho một Open Decision
trong brief mà người thiết kế chưa chốt hẳn.

## Level editor

Mở ở `/editor` (hoặc bấm nút ✎ trong game).

| Tính năng | Chi tiết |
| --- | --- |
| Vẽ tranh pixel | Canvas theo grid, 6 màu trong palette, công cụ Brush / Fill / Eraser, Undo-Redo (kèm Ctrl+Z) |
| Kích thước tuỳ ý | Rộng 6–24, cao 6–28 ô blueprint. Đổi kích thước **neo theo đáy khung**, vì cát nằm trên sàn |
| Bánh xe đạn | Chỉ nạp được màu đã vẽ; sắp xếp thứ tự bằng ↑ ↓; nút **Match picture** dựng lại wheel từ tranh |
| Số lượt bắn | Ô `Shots`, kèm nút **Measure difficulty** đo thật (xem dưới) |
| Nhiều level | Danh sách bên trái: New / Duplicate / Delete. Lưu tự động vào trình duyệt |
| Thử trong game | Nút **Test in game** mở thẳng level đó. Mọi draft hợp lệ cũng hiện trong level switcher |
| Đưa vào source | Nút **Export TypeScript** sinh sẵn khối code, copy vào clipboard |

### Hai lỗi editor bắt buộc phải chặn

Cả hai đều đến từ bánh xe đạn, và cả hai đều là **ván không thể thắng nhưng game không hề báo gì**:

- **Màu có trong tranh nhưng không có trong wheel** — vùng cát đó không bao giờ được bắn tới, nên
  khung không bao giờ sạch.
- **Màu có trong wheel nhưng không có trong tranh** — viên đạn mở màn không có gì để bắn.

Vì thế cả hai là **error** (không phải warning), và cả hai sửa được bằng một nút **Fix wheel**, do
wheel suy được từ tranh. Level nào còn error thì không xuất hiện trong level switcher của game —
đưa vào chỉ là đặt bẫy.

Ngoài ra editor cảnh báo khi tranh **chưa đứng yên**: cát vẽ lơ lửng sẽ sụp ngay frame đầu, nên cái
người chơi thấy không phải cái đã vẽ. Nút **Settle it** thả tranh xuống đúng trạng thái nghỉ, không
thêm không mất hạt nào.

### Đo độ khó, không đoán

Ngân sách lượt **chính là** độ khó, nên chọn nó bằng cảm tính là chọn độ khó bằng cảm tính. Nút
**Measure difficulty** chạy hai model chơi trên **đúng solver của game** (`resolveShot`):

| Model | Câu hỏi nó trả lời |
| --- | --- |
| Chơi giỏi — luôn chọn đĩa lấy được nhiều hạt nhất | Sàn tối thiểu: bao nhiêu lượt là đủ nếu đọc board tốt |
| Chơi ẩu — bắn đại vào một ô đúng màu | Ngân sách có thật sự phạt được sự cẩu thả không |

Editor kết luận thành một trong bốn: **unclearable / too-tight / good / too-easy**, và gợi ý một
ngân sách để chơi giỏi còn dư 6 lượt.

Hai model chạy ở **độ phân giải blueprint**, không phải pixel. Điều này đúng chứ không phải đi tắt:
`expandLevelForPixelBoard` phóng cả tranh lẫn bán kính theo cùng một hệ số nguyên, nên đĩa phủ đúng
cùng một tỉ lệ của cùng một bức tranh — puzzle giống hệt nhau về hình học. Chạy trên vài trăm ô thay
vì vài nghìn là thứ khiến nút này bấm xong có kết quả ngay.

### Đưa một level vào source

Level lưu trong trình duyệt là đủ để chơi và thử. Muốn nó sống qua việc xoá cache trình duyệt thì
bấm **Export TypeScript**, dán khối vừa copy vào `app/game/sand-levels.ts`, rồi thêm tên nó vào
mảng `BUILT_IN_LEVELS`.


## Chạy source

Yêu cầu Node.js 22.13 trở lên.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

## Kiến trúc: logic tách khỏi visual

Đây là ràng buộc quan trọng nhất của brief, và nó là ranh giới file:

| File | Vai trò |
| --- | --- |
| `app/game/sand-types.ts` | Chỉ có type. Không chứa giá trị runtime nào |
| `app/game/sand-rules.ts` | Toàn bộ luật: connectivity, radius sort, settle solver, win/fail, mở rộng độ phân giải. Không có three.js, không có DOM, không có đồng hồ |
| `app/game/SandCannonEngine.ts` | Khung, cannon, projectile, input 3D — và một canvas pixel 2D **phát lại** kết quả mà solver đã quyết |
| `app/game/sand-levels.ts` | Level ship kèm build, và mảng `BUILT_IN_LEVELS` |
| `app/game/level-drafts.ts` | Model level của editor: lưu trữ, validate, settle, sinh TypeScript |
| `app/game/level-analysis.ts` | Hai model chơi để đo độ khó. Dùng chung bởi editor và test |
| `app/SandGame.tsx` | Chọn level, HUD ammo, badge khoá input, màn thắng/thua, restart |
| `app/LevelEditor.tsx` | Toàn bộ giao diện editor |

`runGrainSettle()` trả về một **danh sách bước** chứ không chỉ trả board cuối.
Renderer diễn lại đúng danh sách đó, nên cái người chơi nhìn thấy chính là quá trình solver đã
chạy — không phải một animation được dựng song song. Có test dựng lại board bằng tay từ danh sách
bước và so với board solver trả ra.

### Board là một canvas pixel 2D thật, đặt trong khung 3D

Bức tranh cát **không còn** là mesh 3D. Nó là một `HTMLCanvasElement` runtime — mỗi ô grid logic
đúng một pixel canvas, tô bằng `CanvasRenderingContext2D`, dán lên một `THREE.PlaneGeometry` duy
nhất nằm trong khung. `texture.magFilter/minFilter = NearestFilter` giữ cạnh pixel sắc nét thay vì
mờ đi khi phóng to — đúng chất "board pixel" chứ không phải ảnh 2D bị blur.

Khung, cannon, ánh sáng, camera **không đổi gì** — vẫn 3D thật như trước. Chỉ riêng bức tranh cát
bên trong khung chuyển từ hàng nghìn mesh grain sang một texture phẳng.

**Gameplay grid CHÍNH LÀ pixel grid**, không có hai lớp độ phân giải giả vờ đồng bộ với nhau. Một
level được viết ở kích thước blueprint nhỏ, dễ đọc (7×8, 12×14); `expandLevelForPixelBoard()` mở
rộng nó theo `pixelScale` **một lần** khi engine khởi tạo, và mọi luật sau đó — connectivity, xoá
vùng, bán kính, win/lose — chạy thẳng trên các pixel đã mở rộng. Không có gì "giả mịn" cho đẹp mắt
trong khi logic thật vẫn thô; độ phân giải thấy được và độ phân giải quyết định đều là một.

Phóng to đều theo bội số nguyên không thể làm sai puzzle: một vùng blueprint trở thành khối
`pixelScale × pixelScale` liền màu, nên số lượng vùng, độ liền kề và các lần merge giữ nguyên y
hệt — chỉ nhiều pixel nhỏ hơn hợp thành. Có test khẳng định điều này (`sand-pixel-board.test.ts`):
số vùng, số vùng theo màu, và việc board mở rộng vẫn đứng yên như bản gốc.

### Va chạm: giao cắt mặt phẳng, không quét từng ô

Vì cát giờ là một mặt phẳng duy nhất, việc dò trúng ô nào không cần quét AABB của từng ô như trước
(vốn tốn O(số ô) mỗi khung hình lúc ngắm và lúc đạn bay). Giờ chỉ là một phép giao cắt tia với MỘT
mặt phẳng: giải ra điểm chạm, quy đổi sang toạ độ pixel, tra thẳng trong lưới. `PROJECTILE_RADIUS`
vẫn cho một chút dung sai — nếu pixel đúng tâm trống, tìm pixel có cát gần nhất trong bán kính đó.

### Texture: HSV jitter từng pixel

Mỗi pixel được lệch nhẹ saturation/lightness so với màu gốc của ô, **cố định khi sinh ra** — kỹ
thuật mượn nguyên bản từ `Pixel.GetDrawColor()` của UniSand. Hue không bao giờ bị đụng: lệch đủ để
thấy sẽ bắt đầu đọc thành màu gameplay khác.

Saturation lệch ±0.10, lightness ±0.09 — gần với con số gốc của UniSand, vì cát mịn đủ nhỏ và đủ
dày để đốm màu đọc thành kết cấu thật, đúng tinh thần ảnh chụp game sandsort thị trường.

`pixelScale` quyết định độ mịn: level có sẵn dùng `5` (12×14 blueprint → 60×70 pixel). Editor tự
chọn hệ số lớn nhất giữ board dưới ngân sách ~4.500 pixel đã đo, và cho override thủ công.

## Settle solver — cát rơi theo từng hạt

Một cellular automaton falling-sand đúng nghĩa, tham khảo trực tiếp từ
[UniSand](https://github.com/etopuz/UniSand) (MIT): mỗi pixel rơi thẳng nếu ô dưới trống, không thì
lăn xuống chéo — trái trước phải sau. Lăn chéo còn đòi ô **bên cạnh** cũng trống, nếu không hạt sẽ
chui lọt qua khe chéo giữa hai hạt khác.

Chạy **thật** ở độ phân giải hiển thị, không phải một lớp trình diễn phủ lên lưới thô hơn.

Một pass là mọi hạt di chuyển được một bước, và **cả pass là một step**: một cột cát rút mười bốn
hàng phải là mười bốn nhịp cát chảy, không phải hai trăm cú giật riêng lẻ. Board được quét từ đáy
lên nên hạt vừa rơi không bị xử lý hai lần trong cùng một pass.

Body được suy lại từ đầu sau khi rơi xong: cohesion đã bỏ thì không có gì để giữ, và hai vùng cùng
màu chạm nhau đơn giản là **một** connected component. Nhãn body chỉ đúng ở thời điểm cuối, nên
renderer được báo một lần bằng step `REINDEX` khép lại cascade.

**Vì sao phải bỏ cohesion.** Luật bán kính khoét lỗ vào giữa một mảng cát. Với solver giữ liền khối
(bản cũ, đã gỡ), mảng cát phía trên cái lỗ đó treo lại thành một cái vòm — đúng theo rule Phase C
của brief, nhưng nhìn như lỗi chứ không như cát. Đây là Open Decision 3, và bản này chọn đầu bên
kia của nó.


## Quyển sổ màn chơi

Level nào cũng có thể vẽ bằng **editor** ở `/editor` — đó là cách nhanh nhất. Muốn viết tay thì một
level là một object trong `app/game/sand-levels.ts`, spread `RADIUS_GAMEPLAY` rồi khai phần nội
dung. Bức tranh viết bằng `rows`, hàng trên cùng viết trước, một ký tự một ô, `.` là ô trống:

| Mã | Màu |
| --- | --- |
| `R` | đỏ |
| `G` | xanh lá |
| `Y` | vàng |
| `B` | xanh dương |
| `P` | tím |
| `O` | cam |

SandBody **không** khai báo riêng: body chính là vùng 4-connected cùng màu trong bức tranh. Nhờ vậy
Open Decision 15 được trả lời bằng chính cách biểu diễn — hai vùng cùng màu vẽ dính nhau đơn giản
là một body, không có cách nào biểu diễn chúng thành hai.

Toạ độ: `x` chạy trái → phải, `y` chạy dưới → trên, `y = 0` nằm trên đáy khung.

### Bức tranh phải đứng yên sẵn

Cát vẽ lơ lửng sẽ sụp ngay frame đầu, và cái người chơi nhìn thấy sẽ không phải cái đã author. Bức
tranh của level có sẵn lấp kín khung nên ổn định theo cấu trúc; editor thì cảnh báo và có nút
**Settle it** thả tranh xuống trạng thái nghỉ.

Viết tay thì tự kiểm bằng `runGrainSettle(bodies, frame)` — không có step `GRAIN_PASS` nào nghĩa là
board đã đứng yên.

### Level có sẵn — `Sand Bloom`

Khung 12 × 14 blueprint (60 × 70 pixel mô phỏng), 4 màu, bán kính `2.5`, giới hạn **26 lượt**.

Con số 26 là đo chứ không phải đoán — bằng đúng `analyseLevel` mà editor gọi:

| Model | Kết quả |
| --- | --- |
| Chơi giỏi — luôn chọn đĩa lấy nhiều hạt nhất | **19 lượt**, thắng, dư 7 |
| Chơi ẩu — bắn đại vào ô đúng màu | thắng 8/12 lần |

Có test giữ kết luận này: nếu chơi giỏi không còn dư ≥ 3 lượt, hoặc chơi ẩu thắng mọi lần, test đỏ.


## Rule đã chốt

- Adjacency: `ORTHOGONAL_4`. Chạm góc không nối.
- Phát bắn lấy mọi hạt cùng màu trong đĩa bán kính quanh điểm chạm — không phải cả vùng.
- Phát bắn không lấy được gì vẫn tiêu một lượt, board không đổi.
- Một projectile một lượt. Không bắn trong `PROJECTILE_FLYING`, `HIT_RESOLUTION`, `SETTLING`.
- Win kiểm tra trước, fail kiểm tra sau — phát cuối dọn sạch khung là thắng, không phải hoà.

## Hai map mechanic đang thử

Cả hai đều là **data của level**, không phải nhánh code riêng: level không dùng tới chúng đọc và chạy
y hệt như trước khi chúng tồn tại.

**Lock & Key.** Chữ thường trong tranh (`y`, `p`, …) là cát **bị khoá**: vẫn là cát — có màu, chiếm ô,
đỡ cát khác, tính vào điều kiện thắng — nhưng không rơi và đĩa bắn không nhìn thấy. Vì không rơi nên nó
lơ lửng giữa khung. Chữ `K` là **chìa khoá**, một sprite pixel cứng: nó rơi như cát nhưng cả khối cùng
đi, vì một chìa khoá vỡ thành từng hạt ở lần rơi đầu tiên thì không còn là một vật thể. Chìa khoá chạm
vào ô khoá nào thì **cả vùng khoá liền kề đó** tan băng cùng lúc, và chìa khoá mất đi.

Một màu bị khoá **toàn bộ** sẽ không được bánh xe phát ra (`shootableColors`) — phát viên đạn đó ra thì
đúng là dead bullet mà `deadBulletPolicy` sinh ra để cấm — và nó quay lại bánh xe ngay khi khoá mở.

**Wind.** `wind: { everyMs, direction, strength }` trong level. Cứ `everyMs` một lần, gió đẩy mọi hạt
cát rời sang ngang `strength` ô rồi trả board về đúng solver rơi cũ — nên cát bị thổi khỏi mép vẫn rơi
y như cát vẫn rơi. Cát khoá không nhúc nhích; chìa khoá thì có, nên gió tự nó có thể mở một ổ khoá.
Gió **không tiêu lượt** và không bao giờ làm thua, vì ngân sách chỉ động khi người chơi bắn.

Đồng hồ nằm ở engine chứ không ở rules — `sand-rules.ts` vẫn không có đồng hồ. Engine cũng không bao
giờ cho gió nổi giữa lúc đạn đang bay: board người chơi ngắm phải là board viên đạn hạ xuống (§21).

Một lưu ý khi tự vẽ level có khoá: cát chỉ đứng yên khi mỗi cột mép cao hơn cột bên cạnh **tối đa 1 ô**,
nên một khối vuông đặt trên một slab hẹp sẽ lăn khỏi sườn của chính nó ở frame đầu. Nút chặn của
`Lock & Key` thụt vào một ô mỗi tầng vì lý do đó, không phải để cho đẹp.

Hai level thử: `Lock & Key` và `Crosswind` trong `sand-levels.ts`. Editor vẽ được cả hai — nút
`❄ Locked` là *modifier của cọ* (khoá là một trạng thái của màu, nên phải vẽ bằng một màu), nút `Key`
là một tool riêng, và mục **Wind** ở panel settings.

## Policy tạm — Open Decision chưa chốt

Mọi điểm brief để mở đều nằm trong config với hậu tố `_TEMP`, không hardcode rải rác trong solver.
Đổi quyết định thiết kế là đổi một dòng.

Tất cả nằm trong `RADIUS_GAMEPLAY` (`sand-types.ts`), không rải rác trong solver.

| Trường | Giá trị hiện tại | Open Decision |
| --- | --- | --- |
| `adjacencyMode` | `ORTHOGONAL_4` | 1, 2 |
| `settlePolicy` | `GRAIN_FALL_TEMP` | 3 |
| `slideTieBreak` | `LEFT_FIRST_TEMP` — rule global, trái thắng | 4, 5 |
| `missAmmoPolicy` | `MISS_IS_FREE_TEMP` — hụt khung và trúng thành khung đều không tiêu lượt | 6, 7 |
| `nextPreviewCount` | `3` | 9 |
| `deadBulletPolicy` | `VALIDATOR_ONLY_TEMP` — editor chặn ngay lúc author | 12 |
| `shotRule` | `RADIUS_SORT_TEMP` | **ngoài brief** |
| `ammoRule` | `CYCLE_UNTIL_COLOR_CLEARED_TEMP` | **ngoài brief** |
| `pixelScale` | mỗi level tự khai (level có sẵn: `5`) | ngoài brief — độ phân giải mô phỏng, đo bằng benchmark |

**Hai dòng "ngoài brief" là chỗ bản này cố tình đi ngược tài liệu.** Brief chốt ở §5 rằng một phát
trúng màu xoá toàn bộ connected body, và nói thẳng là **không** được chỉ xoá "một bán kính quanh
impact". Bản này làm đúng điều bị cấm đó, vì đã chọn hướng market-style sau khi so ba gameplay
cạnh nhau. Đây là quyết định có chủ ý, không phải sơ suất — nhưng nó là chỗ code và brief lệch
nhau, nên cần biết khi đọc lại tài liệu.

Về Open Decision 17 (settle bao lâu thì quá lâu): thay vì cắt ngang bằng snap-to-stable, cả cascade
được ép vào một budget thời gian. Settle hai bước chạy chậm và đọc được; sụp đổ bốn mươi bước chạy
nhanh nhưng vẫn diễn đủ từng bước theo đúng thứ tự. Không bước nào bị bỏ.

### Đạn chết không tồn tại

Màu nào sạch hẳn thì rời khỏi bánh xe ngay, nên viên đạn trên tay luôn còn cát để bắn. Có test đi
hết một ván và kiểm tra điều này ở từng lượt. Editor chặn nốt đầu còn lại: một màu có trong wheel
mà không có trong tranh là **error**, không cho vào game.

## Chưa có trong bản này

Meta progression, economy, special sand, đổi/skip đạn, booster, random queue, Z-layer gameplay,
full granular rigidbody simulation, âm thanh. Đây đúng phạm vi
MVP mà brief đặt ra (§34).
