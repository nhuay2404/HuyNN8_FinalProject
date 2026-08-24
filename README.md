# 3D Cannon Sort — playable prototype

Prototype puzzle WebGL 3D với một cụm 24 cube màu tĩnh có thể xoay tự do 360 độ.

## Gameplay hiện tại

- Kéo trong vùng model để xoay cụm block theo ngang và dọc.
- Chạm vùng aim để đặt floating joystick; kéo để điều khiển crosshair rồi thả để bắn.
- Lực bắn cố định. Crosshair bám theo joystick, không tự snap vào block; dấu `+`/`×` báo quỹ đạo trúng hoặc hụt.
- Projectile chạm block đầu tiên và claim toàn bộ connected component cùng màu theo FACE_6.
- Cụm bị bắn bay lên, thu nhỏ; từng cube sprite tiếp tục bay vào đúng Goal hoặc Batch.
- Có hai active Goal và một kho Batch giữ tối đa `batch_blocks` block (mặc định 8). Kho đầy vẫn hợp lệ; **thua khi kho đầy mà phát bắn tiếp theo không đưa được gì vào goal đang mở** — cả claim phải vào kho và không còn chỗ. Hàng batch pulse ở mức đầy là cảnh báo.
- Settings điều chỉnh riêng sensitivity xoay model và ngắm bắn. Restart có modal xác nhận.

Concept đầy đủ nằm trong `outputs/final_concept.md`.

## Chạy source

Yêu cầu Node.js 22.13 trở lên.

```bash
npm install
npm run dev
```

Build production và chạy regression test:

```bash
npm run build
npm test
```

Tạo lại artifact HTML offline:

```bash
node work/build-standalone.mjs
```

File chơi canonical là `outputs/3d-cannon-sort.html`; mở trực tiếp bằng `file://` hoặc double-click, không cần localhost và không cần mạng.

## Quyển sổ màn chơi

`work/levels.tsv` là nơi duy nhất khai báo màn chơi: một dòng là một màn, mở được bằng Excel hoặc Google Sheets. Cột trống nghĩa là dùng mặc định.

| Cột | Ý nghĩa |
| --- | --- |
| `level` | Số màn, không được trùng |
| `name` | Tên hiển thị trong danh sách màn |
| `dims` | `x` × `y` × `z`, ví dụ `4x3x2` |
| `layers` | Một ký tự là một block: `\|` ngăn lớp theo z, `/` ngăn hàng theo y (hàng trên viết trước), `.` là ô trống. Màu: `R G Y B P O K A` |
| `goal_order` | Thứ tự mở goal, ví dụ `R,G,Y,B,P,O`. Để trống thì xếp theo số block giảm dần |
| `goal_split` | Chẻ một màu thành nhiều goal, ví dụ `P:3+3`. Tổng phải bằng số block màu đó |
| `goal_slots`, `batch_blocks`, `shot_limit` | Ghi đè mặc định `2`, `8`, không giới hạn. `batch_blocks` đếm **block** đang giữ trong kho, không đếm số batch, và không được nhỏ hơn cụm lớn nhất của màn |
| `weak_points` | Các điểm `x.y.z:FACE`, ngăn nhau bằng `~`. Mỗi cụm cùng màu nối FACE_6 cần 1–3 điểm |
| `rainbow_target_count`, `rainbow_spawn_gap`, `rainbow_target_duration` | Số Rainbow Target, khoảng xuất hiện và số giây tồn tại; để trống dùng mặc định |
| `notes` | Ghi chú cho người, game không đọc |

Số lượng goal luôn được suy ra từ số block trong `layers`, nên rule "inventory từng màu bằng đúng tổng goal cùng màu" không thể sai. Dòng nào có lỗi thì màn đó không được nạp, kèm thông báo chỉ rõ số dòng và nguyên nhân.

Mã màu hiện có: `R` đỏ, `G` xanh lá, `Y` vàng, `B` xanh dương, `P` tím, `O` cam,
`K` đen mực và `A` xám tro. Dùng `K` cho đen vì `B` đã dành cho Blue; cặp `K/A` giúp dựng viền
và mảng trung tính của tranh pixel mà không làm đổi palette sáu màu cũ.

### Đặt Weak Point theo tư thế mặc định

Tọa độ bắt đầu từ `0`: `x` chạy **trái → phải**, `y` chạy **dưới → trên**, `z` chạy
**sau → trước**. Trong `layers`, lớp đầu tiên là `z=0`; trong mỗi lớp, hàng trên cùng được
viết trước dù nó có giá trị `y` lớn nhất.

| FACE nên dùng | Mã cũ tương đương | Mặt của block ở tư thế gốc |
| --- | --- | --- |
| `FRONT` | `PZ` | phía trước, hướng `+z` |
| `BACK` | `NZ` | phía sau, hướng `-z` |
| `RIGHT` | `PX` | bên phải, hướng `+x` |
| `LEFT` | `NX` | bên trái, hướng `-x` |
| `TOP` | `PY` | phía trên, hướng `+y` |
| `BOTTOM` | `NY` | phía dưới, hướng `-y` |

Ví dụ `4.6.7:FRONT~3.7.4:TOP` đặt hai Weak Point lên block `(4,6,7)` và `(3,7,4)`.
Tên mặt thuộc hệ tọa độ cục bộ của Puzzle và xoay cùng block; nó không đổi theo phía đang hướng vào
camera sau khi người chơi xoay. Nếu ngay sát mặt đó còn một block active, Weak Point nằm giữa hai
block: parser cảnh báo, marker bị che và hiệu ứng bung chỉ chạy sau khi block che đã rời đi.

`work/levels.csv` là bản CSV mirror để xem/sửa bằng Excel. Nguồn canonical vẫn là
`work/levels.tsv`; chạy `npm run levels` sẽ kiểm tra TSV rồi tạo lại CSV, bản bundled và data trong
HTML offline. Nếu đang thử trực tiếp một CSV export, có thể chạy
`node work/sync-levels.mjs work/levels.csv`, nhưng cần chép thay đổi về TSV trước lần build canonical.

Model có đường kính xoay 3D lớn hơn `5.4` world unit sẽ tự scale đồng đều khi chơi; tọa độ, mặt Weak
Point, cluster và hit box vẫn cùng scale nên file CSV không cần thêm cột kích thước hiển thị. Dùng
đường chéo ba trục giữ model trong frame ở mọi góc xoay; các board nhỏ giữ nguyên scale `1`.

Ba cách sửa một màn, từ nhanh tới chậm:

1. Sửa `work/levels.tsv` (hoặc file `.tsv` export từ Excel) rồi **kéo thả file vào game đang mở**. Không cần build, không cần terminal. Nút số ở góc phải mở danh sách để nhảy thẳng tới màn cần thử.
2. `npm run levels` — kiểm tra quyển sổ, cập nhật bản dùng cho `npm run dev`, và ghi lại khối level trong `outputs/3d-cannon-sort.html` mà không bundle lại.
3. `node work/build-standalone.mjs` — build lại toàn bộ; build sẽ fail nếu quyển sổ có lỗi.

Trong file HTML đã build, level data nằm ở khối `<script id="levels" type="text/tab-separated-values">` và không bị minify, nên vẫn sửa tay được rồi reload để hotfix. Lưu ý: `fetch` bị chặn với `file://` nên game không tự đọc được file `.tsv` nằm cạnh nó — phải kéo thả hoặc bấm "Mở file .tsv" trong danh sách màn.

## Rule chính

- Fixture fallback `app/game/level-01.ts`: solid prism `4 × 3 × 2`, tổng 24 block; campaign row 1 có thể là màn thử nghiệm riêng.
- Adjacency: FACE_6 (`±X`, `±Y`, `±Z`), không nối diagonal.
- Inventory từng màu phải bằng chính xác tổng Goal cùng màu.
- Overfill hợp lệ; phần dư tạo Batch.
- Giới hạn Batch đếm **block**, không đếm record: một Batch 6 block tốn 6, không tốn 1.
- Batch auto-fill được phép dùng một phần và ưu tiên record cũ nhất trong prototype. Batch cùng màu từ hai shot khác nhau vẫn không gộp.
- Cooldown: 400 ms; shot limit: không giới hạn.

Các policy mang hậu tố `_TEMP` trong source vẫn là quyết định prototype, chưa phải luật production cuối.
