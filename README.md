# 3D Cannon Sort — playable prototype

Prototype puzzle WebGL 3D với một cụm 24 cube màu tĩnh có thể xoay tự do 360 độ.

## Gameplay hiện tại

- Kéo trong vùng model để xoay cụm block theo ngang và dọc.
- Chạm vùng aim để đặt floating joystick; kéo để điều khiển crosshair rồi thả để bắn.
- Lực bắn cố định. Crosshair bám theo joystick, không tự snap vào block; dấu `+`/`×` báo quỹ đạo trúng hoặc hụt.
- Projectile chạm block đầu tiên và claim toàn bộ connected component cùng màu theo FACE_6.
- Cụm bị bắn bay lên, thu nhỏ; từng cube sprite tiếp tục bay vào đúng Goal hoặc Batch.
- Có hai active Goal và hai Batch slot. Trạng thái `2/2` vẫn hợp lệ; chỉ thua khi cần tạo Batch thứ ba.
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
| `layers` | Một ký tự là một block: `\|` ngăn lớp theo z, `/` ngăn hàng theo y (hàng trên viết trước), `.` là ô trống. Màu: `R G Y B P O` |
| `goal_order` | Thứ tự mở goal, ví dụ `R,G,Y,B,P,O`. Để trống thì xếp theo số block giảm dần |
| `goal_split` | Chẻ một màu thành nhiều goal, ví dụ `P:3+3`. Tổng phải bằng số block màu đó |
| `goal_slots`, `batch_slots`, `shot_limit` | Ghi đè mặc định `2`, `2`, không giới hạn |
| `notes` | Ghi chú cho người, game không đọc |

Số lượng goal luôn được suy ra từ số block trong `layers`, nên rule "inventory từng màu bằng đúng tổng goal cùng màu" không thể sai. Dòng nào có lỗi thì màn đó không được nạp, kèm thông báo chỉ rõ số dòng và nguyên nhân.

Ba cách sửa một màn, từ nhanh tới chậm:

1. Sửa `work/levels.tsv` (hoặc file `.tsv` export từ Excel) rồi **kéo thả file vào game đang mở**. Không cần build, không cần terminal. Nút số ở góc phải mở danh sách để nhảy thẳng tới màn cần thử.
2. `npm run levels` — kiểm tra quyển sổ, cập nhật bản dùng cho `npm run dev`, và ghi lại khối level trong `outputs/3d-cannon-sort.html` mà không bundle lại.
3. `node work/build-standalone.mjs` — build lại toàn bộ; build sẽ fail nếu quyển sổ có lỗi.

Trong file HTML đã build, level data nằm ở khối `<script id="levels" type="text/tab-separated-values">` và không bị minify, nên vẫn sửa tay được rồi reload để hotfix. Lưu ý: `fetch` bị chặn với `file://` nên game không tự đọc được file `.tsv` nằm cạnh nó — phải kéo thả hoặc bấm "Mở file .tsv" trong danh sách màn.

## Rule chính

- Level 01: solid prism `4 × 3 × 2`, tổng 24 block.
- Adjacency: FACE_6 (`±X`, `±Y`, `±Z`), không nối diagonal.
- Inventory từng màu phải bằng chính xác tổng Goal cùng màu.
- Overfill hợp lệ; phần dư tạo Batch.
- Batch auto-fill được phép dùng một phần và ưu tiên record cũ nhất trong prototype.
- Cooldown: 400 ms; shot limit: không giới hạn.

Các policy mang hậu tố `_TEMP` trong source vẫn là quyết định prototype, chưa phải luật production cuối.
