# Board là một canvas pixel 2D thật, đặt trong khung 3D

Nguồn: `app/game/SandCannonEngine.ts`, `app/game/sand-color.ts`, `app/game/renderer-pool.ts`.

## Không phải mesh 3D

Bức tranh cát **không** là mesh 3D gồm hàng nghìn khối grain. Nó là một `HTMLCanvasElement` runtime
— mỗi ô grid logic đúng một pixel canvas, tô bằng `CanvasRenderingContext2D`, dán lên một
`THREE.PlaneGeometry` duy nhất nằm trong khung. `texture.magFilter/minFilter = NearestFilter` giữ
cạnh pixel sắc nét thay vì mờ đi khi phóng to — đúng chất "board pixel" chứ không phải ảnh 2D bị
blur.

Khung, cannon, ánh sáng, camera **không đổi gì** — vẫn 3D thật. Chỉ riêng bức tranh cát bên trong
khung chuyển từ hàng nghìn mesh grain sang một texture phẳng.

## Gameplay grid CHÍNH LÀ pixel grid

Không có hai lớp độ phân giải giả vờ đồng bộ với nhau. Một level được viết ở kích thước blueprint
nhỏ, dễ đọc (7×8, 12×14); `expandLevelForPixelBoard()` mở rộng nó theo `pixelScale` **một lần** khi
engine khởi tạo, và mọi luật sau đó — connectivity, xoá vùng, bán kính, win/lose — chạy thẳng trên
các pixel đã mở rộng. Không có gì "giả mịn" cho đẹp mắt trong khi logic thật vẫn thô; độ phân giải
thấy được và độ phân giải quyết định đều là một. Xem [level-format.md](level-format.md) cho
`pixelScale`.

Phóng to đều theo bội số nguyên không thể làm sai puzzle: một vùng blueprint trở thành khối
`pixelScale × pixelScale` liền màu, nên số lượng vùng, độ liền kề và các lần merge giữ nguyên y hệt
— chỉ nhiều pixel nhỏ hơn hợp thành. Có test khẳng định điều này
(`tests/sand-pixel-board.test.ts`).

## Va chạm: giao cắt mặt phẳng, không quét từng ô

Vì cát giờ là một mặt phẳng duy nhất, việc dò trúng ô nào không cần quét AABB của từng ô như trước
(vốn tốn O(số ô) mỗi khung hình lúc ngắm và lúc đạn bay). Giờ chỉ là một phép giao cắt tia với MỘT
mặt phẳng: giải ra điểm chạm, quy đổi sang toạ độ pixel, tra thẳng trong lưới. `PROJECTILE_RADIUS`
vẫn cho một chút dung sai — nếu pixel đúng tâm trống, tìm pixel có cát gần nhất trong bán kính đó.

## Texture: HSV jitter từng pixel

Mỗi pixel được lệch nhẹ saturation/lightness so với màu gốc của ô, **cố định khi sinh ra** — kỹ
thuật mượn nguyên bản từ `Pixel.GetDrawColor()` của UniSand (`sand-color.ts`). Hue không bao giờ bị
đụng: lệch đủ để thấy sẽ bắt đầu đọc thành màu gameplay khác.

Saturation lệch ±0.10, lightness ±0.09 — gần với con số gốc của UniSand, vì cát mịn đủ nhỏ và đủ
dày để đốm màu đọc thành kết cấu thật, đúng tinh thần ảnh chụp game sandsort thị trường.

`pixelScale` quyết định độ mịn: level có sẵn dùng `5` (12×14 blueprint → 60×70 pixel). Editor tự
chọn hệ số lớn nhất giữ board dưới ngân sách ~4.500 pixel đã đo, và cho override thủ công.

## Renderer pool

`renderer-pool.ts` giữ **1 WebGLRenderer duy nhất** cho toàn trang qua `acquireRenderer()`/
`releaseRenderer()`. Vòng đời cũ (mỗi lần chơi lại tạo `new THREE.WebGLRenderer()` mới mà không giải
phóng context, khiến Chrome giới hạn ~16 context sống cùng lúc rồi màn hình đen sau nhiều lần
restart) đã bị thay bằng mượn/trả về pool; `dispose()` gọi `dispose()` rồi `forceContextLoss()` khi
thật sự không còn ai dùng.
