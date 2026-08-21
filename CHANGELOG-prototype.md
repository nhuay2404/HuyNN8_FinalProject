# Nhật ký thay đổi — 3D Cannon Sort prototype

Ghi lại mọi thay đổi từ lúc bắt đầu phiên làm việc (bản concept `update_concept`, khi
`outputs/3d-cannon-sort.html` còn chưa tồn tại) tới bản hiện tại.

**Bản hiện tại:** `outputs/3d-cannon-sort.html` — 861.616 bytes, 5 màn, một file HTML chạy
offline bằng `file://`, không cần server và không cần mạng.

**Trạng thái kiểm tra:** 117/117 test pass · typecheck sạch phần `app/` và `work/` · lint sạch.

---

## 1. Dựng lại bản build và sửa pipeline

| Việc | Chi tiết |
|---|---|
| Dựng lại file HTML | Repo chưa có `node_modules` và chưa có file build nào; cài lại dependency rồi build lại từ source. |
| Sửa đường dẫn esbuild hard-code | `work/build-standalone.mjs` import esbuild bằng đường dẫn pnpm cố định (`node_modules/.pnpm/esbuild@0.28.2/...`) nên lệnh trong README không chạy được với layout npm. Đổi thành `import esbuild from "esbuild"` và thêm `esbuild@0.28.2` vào `devDependencies`. |
| Sửa lỗi lint tồn đọng | `work/standalone-entry.tsx` import `React` nhưng không dùng (do `jsx: react-jsx`). Bỏ import, lint sạch hoàn toàn. |
| Sửa lỗi tiềm ẩn về tham số dòng lệnh | `readSheet()` từng đọc `process.argv[2]` trực tiếp. Khi `build-standalone.mjs` import nó, `argv[2]` lại là *tên file HTML xuất ra* — nghĩa là `node work/build-standalone.mjs ten-khac.html` sẽ hiểu nhầm tên đó là đường dẫn quyển sổ màn chơi. Đổi thành tham số truyền tường minh. |

**Số liệu dung lượng đã đo** (để tham chiếu khi scale lên 50 màn):

| Thành phần | Raw (minified) | % bundle |
|---|---|---|
| three.js | 529.299 B | 69% |
| React + react-dom | 192.568 B | 25% |
| Toàn bộ code game | ~43.500 B | 6% |
| Data 5 màn (dạng bảng) | ~1.000 B | 0,1% |

Đã đo thêm: đổi `import * as THREE` sang named import **không** tiết kiệm được gì
(529.309 B vs 529.299 B) — `WebGLRenderer` kéo theo gần như toàn bộ library.

---

## 2. Sửa lỗi core gameplay

### 2.1 Crosshair ngắm sai khối (nghiêm trọng — lừa người chơi)

Súng tính đường bay tới một điểm trên **mặt phẳng phẳng đặt ở độ sâu tâm cụm**, không
phải tới khối đang nằm dưới tâm ngắm. Khi cụm bị xoay, các khối không còn cùng độ sâu
nên mục tiêu lệch khỏi khối mắt người chơi đang thấy.

Đo trên bản đang chạy: tâm thẻ goal ở y=29 nên đỉnh vòng cung cũ rơi ra ngoài khung, và
**cách cũ chỉ khớp 12/39 điểm** thử — gần 7/10 lần súng nhắm sang khối khác.

Sửa: `raycastBlockSurfacePoint()` bắn một tia thật từ camera qua đúng điểm tâm ngắm, tìm
khối chạm đầu tiên trong không gian đã xoay của cụm, rồi lấy điểm chạm đó làm mục tiêu.
Chỉ khi tâm ngắm không rơi lên khối nào mới lùi về cách tính mặt phẳng cũ.

Kết quả đo lại: **39/39 điểm khớp**, kể cả khi cụm xoay nghiêng nhiều. Đã bắn thật qua
đúng pipeline game để xác nhận (nhắm khối đỏ → 3 khối đỏ bị phá, goal ĐỎ lên 3/6).

### 2.2 Điều khiển hai ngón cùng lúc

`canStartAim()` và `canRotateModel()` chặn chéo nhau: đang xoay thì không ngắm được và
ngược lại. Bỏ hai điều kiện chặn chéo đó — tay trái xoay model, tay phải ngắm bắn, đồng
thời.

Giữ nguyên một chốt an toàn: **không xoay được khi đạn đang bay**, vì `sweepBlocks` kiểm
tra vị trí cụm ở *thời điểm hiện tại* mỗi bước, nên xoay giữa đường bay sẽ khiến đạn rơi
vào khối khác với khối đã ngắm — đúng lại vấn đề công bằng mà mục 2.1 vừa sửa.

Đã xác nhận trong game: model và joystick cùng ở trạng thái active một lúc; bắn xong thì
xoay bị chặn cho tới khi đạn kết thúc.

### 2.3 Vòng đời máy vẽ (rò WebGL context)

`renderer` là field của engine nên mỗi instance tạo một WebGL context mới, và `dispose()`
gọi `renderer.dispose()` nhưng **không** gọi `forceContextLoss()` — three.js không giải
phóng context ở `dispose()`. Chrome chỉ cho ~16 context sống; 50 màn cộng chơi lại là
chắc chắn chạm ngưỡng (canvas đen).

Sửa: thêm `app/game/renderer-pool.ts` giữ **đúng một** context cho cả trang; engine mượn
khi vào màn, trả lại khi rời màn; có hàm dọn hẳn gọi cả `dispose()` và
`forceContextLoss()`. Có chống trường hợp engine cũ trả muộn giật canvas của engine mới.

Đã đo: chơi lại 3 lần liên tiếp → số context tạo ra vẫn là **1** (code cũ sẽ là 4), trong
trang vẫn đúng 1 canvas và vẫn nằm đúng trong khung 3D.

### 2.4 Pool đạn

Mỗi phát bắn trước đây tạo mới `SphereGeometry` + material rồi dispose. Giờ dùng chung một
geometry/material và tái sử dụng tối đa 8 viên.

---

## 3. Giao diện

### 3.1 Goal và Batch nổi bật hơn

Người chơi không để ý phần goal. Đã làm lại:

- Thẻ goal to hơn (52px), viền màu 2px, nền gradient theo màu goal, quầng sáng nhẹ.
- Icon khối 24px kiểu 3D, số đếm 24px, **thanh tiến trình** dưới mỗi thẻ.
- Số đếm "pop" mỗi lần tăng.
- Hàng dự trữ có nhãn `DỰ TRỮ n/2`, ô 32px, ô trống là dấu `+`, ô đầy hiện `×n`.
- Đầy 2/2 thì nhãn chuyển màu cam và nhấp nháy cảnh báo.
- Lùi hẳn khỏi rìa: `--hud-inset` 14px, `--hud-height` 92px, HUD tránh cụm nút công cụ.
- Máy nhỏ (`max-height: 730px`) tự thu gọn; máy hẹp (`max-width: 360px`) ẩn chữ "DỰ TRỮ"
  giữ lại icon và số để ô dự trữ không bị bóp.

### 3.2 Goal xong thì biến mất

Trước hiện thẻ "XONG". Giờ ô goal đã hoàn thành và hết queue thì **không vẽ gì**; hết toàn
bộ goal thì cả hàng goal biến mất (đúng đoạn auto-clear). Ô đã xong vẫn để lại một cell
rỗng vô hình để thẻ còn đang chơi không bị nhảy sang trái.

### 3.3 Block bay vào goal bị tràn khỏi màn hình

Đỉnh vòng cung tính cứng "cao hơn điểm cao nhất 48px". Tâm thẻ goal ở y=29 → đỉnh rơi vào
**y = −19**, vượt mép trên khung nên khối bị cắt mất giữa đường. Ô dự trữ ở y=81 nên
apex=33, vẫn trong khung — khớp đúng việc lỗi chỉ xuất hiện ở phần goal.

Sửa: module mới `app/game/sort-flight.ts` kẹp mọi điểm của đường bay (điểm đi, đỉnh cung,
điểm đến) trong khung với lề 14px. Còn chỗ thì vẫn nhấc đủ 48px; sát mép thì cung tự hạ
thấp lại. Điểm xuất phát cũng được kẹp nên khối không "pop" từ ngoài vùng nhìn.

### 3.4 Xoá nền đen, làm tươi màu

- Bỏ hẳn đĩa đất đen, vòng halo và lưới sàn — model và pháo nổi trên nền CSS.
- Nền khung: gradient indigo → xanh mòng, thêm hai vùng sáng radial.
- Bảng màu khối rực hơn và tách hue rõ hơn (đỏ `#ff3d4d`, xanh lá `#24e07f`, vàng
  `#ffd21f`, xanh dương `#2f9dff`, tím `#9d5cff`, cam `#ff8a1f`); trước đó tím và đỏ dễ
  lẫn trên nền tím.
- Sáng hơn: hemisphere + key light mạnh hơn, sương mù đổi theo nền, pháo và accent sáng lại.
- Vị trí khối giờ tính tâm từ chính hình khối thay vì hardcode theo prism 4×3×2, nên mọi
  kích thước màn đều cân giữa (trước đó màn 2 và 3 bị lệch tâm).

### 3.5 Rung phản hồi (haptics)

`app/game/haptics.ts`. Web không có API điều khiển cường độ — `navigator.vibrate()` chỉ
nhận độ dài và nhịp, nên "mạnh/nhẹ" ở đây là dài/ngắn và mấy nhịp.

| Sự kiện | Nhịp (ms) |
|---|---|
| Đạn trúng | 25 |
| Goal hoàn thành | 30–50–45 |
| Tạo ô dự trữ | 40 |
| Dự trữ đầy 2/2 | 50–70–50 |
| Thắng | 50–60–50–60–120 |
| Thua | 200 |

Từng khối rơi vào ô có nhịp riêng ngắn hơn (18ms, giảm dần 2ms, tối thiểu 10ms, tối đa 6
nhịp) để một loạt đọc thành nhiều tiếng tách rời chứ không thành một tiếng rè dài.

Có công tắc trong Cài đặt, lưu bằng `localStorage`, tự ẩn nếu thiết bị không hỗ trợ (iOS
Safari không có Vibration API — là giới hạn nền tảng).

---

## 3b. Menu HUB (mới)

Mở file HTML giờ ra màn menu trước, không vào thẳng level.

- **Tên level** ở trên, **nút cài đặt** tròn góc phải, **Skin** và **Shop** xếp dọc bên trái, và
  **TAP TO PLAY** ở dưới. Cả màn hình là vùng bấm để chơi. Không có viền quanh model.
  (Lúc này cả hai nút bên trái đều chỉ để trưng chỗ; **Skin** đã có màn thật ở mục 5c, **Shop**
  vẫn là placeholder.)
- **Model của level hiện tại tự xoay** trong menu. Dùng đúng engine và đúng cụm khối của
  level, không phải ảnh hay model riêng. Pháo ẩn đi để menu chỉ còn cụm khối như bản vẽ.
- Trong menu, engine **chặn toàn bộ thao tác gameplay** (không ngắm, không xoay tay, không
  bắn) — chặn ở tầng engine chứ không chỉ nhờ overlay che.
- Bấm TAP TO PLAY: **level vào ngay trên frame đó**, cụm khối **snap về orientation cố
  định tức thì**, và các nút menu (tên level, Skin, Shop, chữ TAP TO PLAY, khung) bay ra
  khỏi màn hình theo hướng mép gần nhất. Nút cài đặt đứng yên. Overlay đang bay ra không
  ăn input nữa nên người chơi nhanh tay có thể ngắm ngay.
- Menu vẫn xoay khi mở hộp thoại cài đặt (spin nằm ngoài nhánh paused).

### Intro khi vào level

Trong menu cụm khối được thu nhỏ về 62%. Bấm play thì chạy một intro dài **1 giây**:
cụm khối vừa zoom về 100% vừa slerp về đúng orientation gốc, và ụ pháo **trồi lên từ dưới
khung** (bắt đầu ở mốc 30% của intro) chứ không hiện đột ngột. HUD goal và batch cũng trồi
lên tại chỗ (không bay từ ngoài vào), batch trễ hơn goal một nhịp.

Người chơi chỉ bắn được **sau khi intro kết thúc**. Lý do: `sweepBlocks` kiểm tra cụm ở vị
trí *hiện tại* mỗi bước, nên một phát bắn giữa lúc model còn đang zoom sẽ bị xử theo một
model đang di chuyển — đúng lại vấn đề công bằng mà mục 2.1 đã sửa. Intro đứng yên khi mở
hộp thoại và chạy tiếp khi đóng.

Cũng đã bỏ viền trắng mờ quanh model trong menu.

Hai nút cài đặt và chơi lại cũng trồi lên cùng nhịp với HUD, nút thứ hai trễ 0,07 giây.

**Một lỗi thật do bạn phát hiện qua ảnh:** crosshair vẫn hiện mờ trong menu. Nguyên nhân là
`resize()` (do ResizeObserver gọi) chạy `showIdleCrosshair()` và bật lại crosshair *sau* khi
menu đã tắt nó. Máy tôi không tái hiện được vì khung xem bị ẩn nên ResizeObserver không bao
giờ chạy ở đó. Đã sửa tại gốc: `showIdleCrosshair()` giờ toggle theo trạng thái menu/intro
thay vì luôn `add`, nên mọi đường gọi đều an toàn. Đã đo lại bằng cách gọi thẳng `resize()`
trong menu (đúng đường gây lỗi): crosshair vẫn tắt; tắt suốt intro; và chỉ hiện lại ở frame
intro kết thúc.

Đã đo từng mốc trong game: scale 0.62 → 0.78 → 0.88 → 0.95 → 0.99 → 1.00; quaternion y về
đúng −0.1789 (giá trị orientation gốc); pháo −5.18 → −4.83 → −3.13 → −1.98 → −1.78; và
`canInteract` chỉ thành `true` ở frame intro kết thúc. MutationObserver cũng bắt được HUD
bật class trồi lên rồi tự tắt sau 713 ms.

**Đã bỏ khỏi in-game:** nút hiển thị số level, và việc kéo thả file CSV. Cả hai chuyển vào
nút cài đặt của Menu HUB: danh sách màn + nút mở file `.csv`/`.tsv`, và kéo thả chỉ nhận
khi đang ở menu (một cú thả lạc trong lúc chơi không thể đổi bàn giữa đường đạn).

**Trong game**, hộp thoại cài đặt có thêm nút **Về Menu**. Rời level giữa dở thì level được
dựng lại từ đầu, nên menu luôn hiện cụm khối nguyên vẹn chứ không phải bàn đã phá nửa.

Đã kiểm chứng trong game: layout đúng bản vẽ (tên level giữa trên, cài đặt góc phải trên,
Skin/Shop bên trái, khung giữa, TAP TO PLAY dưới); model xoay thật (quaternion y đổi liên
tục qua 60 frame); bấm play thì snap về đúng orientation cố định và **giữ nguyên sau 120
frame**; thanh HUD ẩn trong menu và hiện lại khi vào game; thao tác hai ngón hoạt động lại
sau khi vào level; "Về Menu" đưa về menu với crosshair tắt và vẫn đúng 1 canvas.

---

### Animation từ ô dự trữ vào goal

Trước đây khi một goal mở ra và ô dự trữ có đúng màu đó, phần nạp diễn ra **tức thì** ngay
trong cùng một phép tính: ô dự trữ biến mất, goal nhảy số, có khi nhảy luôn sang goal kế
tiếp — người chơi không kịp hiểu chuyện gì vừa xảy ra.

Giờ mỗi lần nạp là một nhịp riêng: các khối bay từ ô dự trữ sang thẻ goal, **và state chỉ
được áp sau khi bay xong**. Nghĩa là trong lúc bay, ô dự trữ vẫn hiện đủ số và goal vẫn chưa
tăng — không thể có cảnh goal đã sang cái mới trong khi khối còn đang bay.

Một cascade (nạp xong goal này lại mở goal khác cũng có sẵn dự trữ) được diễn **từng bước**,
mỗi bước một lần bay, nên người chơi đọc được cả chuỗi thay vì thấy mọi thứ xảy ra một lúc.

**Thời lượng luôn dưới 1 giây** như bạn yêu cầu, kể cả khi ô dự trữ chứa nhiều khối: nhịp
giữa các khối tự co lại theo số lượng thay vì để cái đuôi dài ra. Trường hợp xấu nhất là
760 + 60 = 820 ms; với 3 khối là 620 ms. Có test tính đủ các mức 1, 2, 4, 6, 12 và 40 khối
để chắc không có số lượng nào vượt 1 giây.

Về mặt code: luật auto-fill được tách thành `nextBatchAutoFill` (mô tả bước kế tiếp, không
sửa gì) và `applyBatchAutoFill` (áp đúng một bước). `resolveCluster` vẫn chạy trọn cascade
như cũ bằng chính hai hàm đó, nên hành vi luật không đổi và toàn bộ test luật cũ vẫn xanh;
chỉ engine gọi bản từng-bước để chèn animation vào giữa. Có test so hai đường đi và bắt buộc
chúng kết thúc ở cùng một state, nên chúng không thể lệch nhau về sau.

Đã đo trong game: sau phát bắn làm mở goal đỏ, engine giữ `flightPending` suốt ~48 frame với
ô dự trữ còn nguyên `×3` và goal đỏ vẫn `0/3`; hết nhịp bay thì ô dự trữ mới rỗng và goal mới
hoàn thành.

---

### Nhấp nháy khi chuyển từ menu vào game (chỉ thấy trên điện thoại)

Nguyên nhân chính: nút TAP TO PLAY phủ **toàn khung** (`inset: 0`), và điện thoại vẽ một lớp
**tap highlight** mờ lên đúng vùng của phần tử vừa được chạm — nghĩa là lên cả màn hình, ngay
tại thời điểm chuyển màn. Desktop không có cơ chế này nên tôi không thấy trong mọi lần kiểm
trước đó.

Sửa: `-webkit-tap-highlight-color: transparent` đặt trên `body`. Thuộc tính này được kế thừa
nên bao luôn cả vùng kéo xoay model và vùng ngắm bắn, không riêng các nút.

Sửa thêm hai nguồn nhấp nháy khác ở cùng thời điểm:

- Chữ TAP TO PLAY đang chạy nhịp nhấp nháy vô hạn; khi anim bay ra thay thế thuộc tính
  `animation`, giá trị bị *snap* về style gốc (độ mờ nhảy từ 0,58 lên 1) rồi mới mờ dần. Đã
  tách nhịp nhấp nháy sang một span con nên hai anim không còn tranh nhau.
- Nút phủ toàn màn hình thì mọi viền focus trên nó cũng là viền toàn màn hình. Một số điện
  thoại coi cú chạm là `:focus-visible`. Đã tắt viền trong lúc menu bay ra.

Đã đo trong trình duyệt: `-webkit-tap-highlight-color` = `rgba(0, 0, 0, 0)` trên body, nút play,
nút cài đặt và cả hai vùng kéo; lúc chuyển màn thì chữ chạy `hub-exit-down` còn nhịp nhấp nháy
vẫn chạy độc lập trên span con, nền mờ dần, viền focus `none`.

**Chưa kiểm được bằng máy thật:** khung xem của tôi không mô phỏng cú chạm ngón tay, nên tôi
sửa theo đúng cơ chế đã xác định và đo giá trị cuối. Bạn thử lại trên điện thoại giúp tôi.

---

## 3c. Toàn bộ ngôn ngữ chuyển sang tiếng Anh

Mọi chữ người chơi đọc được giờ là tiếng Anh: HUD (`BATCH`, `COMPLETE`), hộp thoại cài đặt,
hộp xác nhận, màn thắng/thua, danh sách màn, thông báo kéo thả, mọi nhãn trợ năng
(`aria-label`), tên màu (`RED`, `GREEN`…), và **cả thông báo lỗi của quyển sổ** — những dòng
này hiện ngay trong game khi file CSV có lỗi nên chúng cũng là ngôn ngữ trong game.

Đổi luôn ở tầng dưới: `lang="vi"` thành `lang="en"` trong file HTML và trang dev, mô tả
`<meta>`, dòng `<noscript>`, lý do thất bại từ engine (`Out of shots`, `No batch slot left`),
nhật ký sự kiện trong `rules.ts`, và thông báo lỗi của `npm run levels`.

Tên màn trong quyển sổ cũng dịch sang tiếng Anh (`Interleaved layers`, `Split purple goal`,
`Barrel test`, `Link test`) cùng phần ghi chú và các dòng chú thích đầu file — đây là dữ liệu
của bạn nên đổi tên thoải mái.

Có một test chặn hồi quy: nó quét các file người chơi đọc được và **fail nếu còn ký tự tiếng
Việt** ngoài comment code.

### Vị trí nút

- Hộp xác nhận khởi động lại: **No bên trái, Yes bên phải**. Focus vào No (lựa chọn an toàn).
- Màn kết thúc: **Replay level bên trái, Next level bên phải**.

### Nút cài đặt đồng nhất

Nút cài đặt ở menu trước đây là hình tròn 48px, trong game là bo góc 44px. Giờ nút ở menu
dùng lại đúng class `.icon-button` của trong game, chỉ giữ phần định vị riêng — nên kích
thước, hình dạng, màu và cả vị trí **giống hệt nhau** và nút không nhảy khi chuyển màn.

Đã đo cả hai: 44×44, bo góc 12px, `rgba(255,255,255,.1)`, cách mép trên 13px và mép phải 17px.

---

## 4. Hệ thống màn chơi (mới)

Trước đây chỉ có một màn viết tay trong `app/game/level-01.ts`, mỗi màn lặp lại 15 field
policy.

### 4.1 Quyển sổ bảng tính

`app/game/level-format.ts` — một màn là một dòng. Đọc được **cả TSV và CSV**, tự nhận
diện dấu phân cách ở dòng tiêu đề (Tab, phẩy, hoặc **chấm phẩy** — Excel tiếng Việt lưu
CSV bằng chấm phẩy), và hiểu ô có dấu ngoặc kép do Excel tự thêm.

| Cột | Nghĩa |
|---|---|
| `level` | Số màn, bắt buộc, không trùng |
| `name` | Tên hiện ở màn chọn |
| `dims` | Kích thước `4x3x2` (rộng × cao × sâu) |
| `layers` | Hình khối, 1 ký tự = 1 ô. `/` ngăn hàng (hàng trên trước), `\|` ngăn lớp sâu, `.` là ô trống. Chữ HOA = khối thường, **chữ thường = có barrel** |
| `barrel_layers` | Tăng số lớp barrel cho một cụm: `0.0.1:3`, tối đa 3 lớp |
| `links` | Nối hai cụm: `0.0.0>0.0.1`, nhiều cặp cách nhau bằng `;` |
| `goal_order` | Thứ tự màu vào queue goal; để trống thì máy tự sắp theo số lượng |
| `goal_split` | Chẻ một màu thành nhiều đơn: `P:3+3` |
| `goal_slots` `batch_slots` `shot_limit` | Override; để trống dùng mặc định |
| `notes` | Ghi chú, máy không đọc |

Toạ độ dùng dấu chấm và các cặp cách nhau bằng chấm phẩy để **cả ô không có dấu phẩy**,
nên khi lưu CSV không cần đóng ngoặc.

### 4.2 Goal tự sinh từ inventory

Không ai gõ tay số lượng goal nữa: máy đếm khối từng màu trong `layers` rồi sinh đơn hàng.
Bất biến "tổng goal mỗi màu = số khối màu đó" trở thành **không thể sai**. Sổ chỉ khai báo
thứ tự (`goal_order`) và cách chẻ (`goal_split`).

### 4.3 Validate trước khi chạy

Báo lỗi kèm số dòng, và **dòng nào có lỗi thì bỏ hẳn** chứ không nạp nửa vời: sai số ô so
với `dims`, ký tự màu lạ, trùng toạ độ, trùng số màn, `goal_split` cộng không khớp, hai
goal cùng màu mở cùng lúc, link trỏ vào ô trống / sai định dạng / trỏ hai lần vào một cụm
/ nối chuỗi, `barrel_layers` ngoài 1–3 hoặc trỏ vào cụm không có barrel.

### 4.4 Ba đường nạp màn

1. **Kéo thả** file `.tsv`/`.csv` vào game đang mở — chơi thử ngay, không build.
2. `npm run levels` (hoặc `node work/sync-levels.mjs work/levels.csv`) — đẩy vào bản build.
   Data nằm ở khối `<script id="levels">` **không bị minify** nên sửa tay được trực tiếp
   trong file HTML đã ship.
3. Fallback ba tầng để game luôn khởi động được: khối nhúng trong HTML → bản đi kèm build
   → màn gốc trong source.

Lưu ý nền tảng: `fetch('./levels.csv')` bị chặn trên `file://`, nên bắt buộc phải kéo thả
hoặc chọn file, không thể tự đọc file nằm cạnh HTML.

### 4.5 Màn hình chọn màn

Nút số ở góc phải mở danh sách 5 màn (tên + số khối), có nút mở file `.tsv`/`.csv`, và
hiện data đang đọc từ nguồn nào.

---

## 5. Hai cơ chế mới: Barrel và Link

Theo `6.barrel-link-block-draft_claude.md` và các quyết định đã chốt.

### 5.1 Barrel

- Vỏ **đục hoàn toàn**, không thấy màu bên trong (§1.4.1).
- **Tối đa 3 lớp**, màu vỏ báo số lớp còn lại (§1.4.2): 3 lớp `#1c1d22` đen → 2 lớp
  `#74777f` xám → 1 lớp `#d8dae0` xám trắng. Đã đo đúng cả ba mức trong game.
- Không có khung viền sáng (§1.4.4). Bề mặt là texture kim loại (vệt xước + viền + 4 bu
  lông) **vẽ bằng canvas lúc chạy** — không cần file ảnh ngoài, giữ nguyên một file HTML.
  Palette chỉ xám→đen.
- Barrel **không tính** vào inventory (§1.4.3); màu khối bên trong vẫn tính bình thường.
- Mỗi lần phá chỉ **bong một lớp**, dù bắn trực tiếp hay claim cụm kề bên.
- Cả hai đường đều chỉ phá vỏ, **không claim trong cùng phát** (§1.3): bắn trực tiếp vào
  barrel, hoặc claim cụm kề barrel.
- Một barrel bọc **một cụm**, nên phá vỏ là bong cho cả cụm chứ không riêng một ô.
- Khối có barrel vẫn chắn đạn và vẫn ngắm được.

### 5.2 Link

- Bắn cụm A thì cụm B chết theo, nhưng là **hai giao dịch riêng** (§2.4.1) — ô dự trữ mỗi
  ô một màu nên hai màu không thể gộp. Mỗi bên đi theo luật goal/batch bình thường.
- **Bị barrel chặn** (§2.4.2): nếu B còn barrel thì bắn A **không phá được gì** — cả cặp
  bị giữ. Phản hồi: đạn trúng, cả hai cụm giật lên tại chỗ (đã đo: 8 khối giật).
- Hai ô dự trữ đã đầy mà cần thêm → **dùng đúng luật fail hiện có** (§2.4.5), không thêm
  luật mới.
- A khớp goal mà B không → B tạo ô dự trữ theo luật thường (§2.4.6).
- Hiện chỉ cho **cặp đôi**, chưa cho chuỗi A→B→C (§2.4.3 chưa chốt); nối chuỗi thì quyển
  sổ báo lỗi ngay chứ không âm thầm chạy.
- Hiển thị (§2.4.4): **móc nối là model thật** — tấm kim loại + đầu bu lông tối + vòng
  móc. Ban đầu bắt vào **mọi mặt lộ ra** của cả hai cụm; xem mục 5.2b bên dưới, giờ là
  **một cái nẹp duy nhất** cho mỗi cặp. Khối có barrel thì nẹp đặt xa hơn để **đè lên vỏ**,
  và tự tụt vào sát khối khi vỏ bong hết.

### 5.2b Nẹp ở mọi giao điểm của cặp link, không phải mỗi khối một mốc

Bắt móc vào mọi mặt lộ ra nghĩa là một cặp 8 khối mang mấy chục cái móc: model trông như bị
đóng đinh khắp mặt, và **không có chỗ nào đọc ra là "hai khối này nối với nhau"**. Giờ mỗi
**giao điểm** giữa hai cụm là một cái nẹp: hai đế bắt vít trên mặt ngoài của hai khối, một
thanh sống chạy qua khe giữa chúng, một collar ở giữa thanh.

**Nẹp ở đâu.** Ở **mọi chỗ hai cụm chạm mặt nhau**, và ở mỗi chỗ đó thì bắt lên **mọi mặt
ngoài mà giao điểm ấy có** — cặp được bolt lại theo cả đường ghép, chứ một cái nẹp ở một góc
thì đọc ra là "một khối bị buộc" chứ không phải "hai hình được ghép". Giao điểm chỉ tính tiếp
xúc **mặt–mặt qua cụm này sang cụm kia**, không bao giờ tính trong lòng một cụm, và mỗi đường
ghép tìm từ một phía nên không có nẹp nào bị bắt hai lần.

Đo trên level 5: hai cụm chạm nhau ở **4 giao điểm**, tổng **6 cái nẹp** — 2 trên mặt trên,
2 trên sườn, 2 dưới đáy.

Vì sao không phải 4: mỗi giao điểm ban đầu chỉ lấy **một** mặt tốt nhất của nó, nên các nẹp
tản ra mỗi cái một mặt, và nhìn vào **một** mặt của model thì có giao điểm có nẹp, có giao
điểm không — đọc ra như mối ghép làm dở. Cụ thể giao điểm `x=0,y=1` để trống cả mặt trên và
sườn −x, nó chọn mặt trên, nên sườn −x chỉ còn 1 nẹp trong khi mặt đó có 2 giao điểm. Giờ nó
nhận cả hai.

Nếu hai cụm được đặt **rời nhau** (không chạm mặt) thì quay về một cái nẹp duy nhất, bắc qua
cặp khối gần nhau nhất; chọn cặp đó theo thứ tự ưu tiên: khoảng cách → mặt nào dễ thấy hơn →
id (để một màn luôn dựng ra đúng một cái nẹp).

**Chọn mặt nào.** Mặt phải vuông góc với trục link, và phải **trống ở cả hai khối** — nếu
không thì nẹp nằm lọt trong cụm, đúng như cái khe giữa hai khối dính mặt. Thứ tự trong danh
sách là thứ tự dễ thấy (dùng khi phải chọn một): camera đứng ở **+z** và ở trên cao, còn
orientation gốc xoay model cho sườn +x hướng về phía lens, nên: trước → trên → sườn +x →
sườn −x → sau → mặt dưới. Giao điểm **không có mặt ngoài nào** — nằm lọt giữa một đường ghép
rộng — vẫn được một cái nẹp, để không giao điểm nào bị bỏ trống.

**Đặt lại mỗi frame.** Nẹp không phải con của khối nào: sóng phá vỡ có thể đẩy riêng một
đầu, vỏ barrel có thể bong ở một đầu, và `recenterModelPivot()` dịch cả hai. Nên mỗi frame
nẹp được đặt lại từ hai vị trí khối đang có: thanh sống scale theo đúng khe, hai đế lùi ra
theo `barrelLeft` của khối nó bám. Chính vì vậy `peelShell()` không còn phải chỉnh gì nữa.

Lúc cặp bị claim, **cả đường ghép rời ra cùng lúc**: mọi cái nẹp của link group đó bị lấy
khỏi danh sách rồi rơi theo đúng đường mảnh vỡ của vỏ barrel, mỗi cái một seed riêng nên
chúng không rơi giống hệt nhau. Vì lấy khỏi danh sách nên cụm còn lại chết trong cùng phát
bắn không làm cái nào rơi lần thứ hai. `BlockRuntime.linkFittings` đã bỏ khỏi type.

### 5.3 Mảnh vụn rơi

Vỏ barrel vỡ thành mảnh nhỏ rơi xuống theo trọng lực, xoay, nhỏ dần rồi tự dọn. Móc nối
cũng vậy: khi cụm bị claim thì móc rời ra và rơi, không bay theo khối.

Đã đo: một cụm 4 khối bong vỏ sinh **28 mảnh** (7 mảnh/khối), rơi rồi dọn sạch còn 0 —
không rò rỉ. Một cặp link bị hạ: **32 móc → 32 mảnh rơi**, không còn móc nào dính lại.

### 5.4 Hai màn test

| Màn | Nội dung |
|---|---|
| **4. Test barrel** | Tím 1 lớp (có cụm xanh lá ngay trên để test đường gián tiếp) và xanh dương 3 lớp đặt cách ra, chỉ phá được bằng bắn trực tiếp nên dải màu đen→xám→trắng không bị cắt ngang. |
| **5. Test link** | Đỏ ↔ tím, tím có 1 lớp barrel. Bắn đỏ lúc đầu không phá được; bong vỏ tím (bắn trực tiếp, hoặc claim cụm vàng kề bên) rồi bắn đỏ mới hạ cả cặp. Thứ tự goal là Đỏ, Cam, Vàng, Tím nên còn dạy thêm quyết định thời điểm bắn cặp link. |

Đã chơi thử thật cả hai màn qua đúng pipeline game, không phải chỉ chạy test.

---

## 5b. Phản hồi khi phá vỡ, khói tiếp đất, và chuyển màn liền mạch

### 5b.1 Sóng đẩy ngược lan ra từ chỗ vỡ

Trước đây chỉ đúng lớp khối đang **kề mặt** cụm bị phá mới bị đẩy, cùng lúc, cùng lực — nhìn
ra là một vòng khối giật nhẹ rồi hết.

Giờ lực đi ra theo từng vòng: vòng kề chỗ vỡ đẩy trước, vòng ngoài đẩy sau
`WAVE_RING_DELAY` = 0,05 s mỗi vòng, và mỗi vòng chỉ còn `WAVE_FALLOFF` = 0,6 lực của vòng
trong. Tắt khi còn dưới `WAVE_MIN_AMPLITUDE` = 0,14 (khoảng 4 vòng), nên cụm lớn cỡ nào thì
sóng cũng không chạy mãi. Hàm cũ `kickAdjacentBlocks` đổi tên thành `sendBreakWave` cho đúng
việc nó làm.

Một vòng chỉ được đánh dấu "đã tới" **sau khi thu xong cả vòng** — nếu đánh dấu ngay trong
lúc thu thì hai khối cùng vòng sẽ truyền sóng cho nhau và một mặt sóng biến thành một vệt bò
chậm qua cụm.

Hướng đẩy vẫn như cũ: vector rời khỏi mặt tiếp xúc trộn với hướng bật ra khỏi tâm model, nên
khối luôn đi ra xa chỗ vỡ chứ không đi vào.

### 5b.2 Khói trắng khi đạn tiếp đất

Mỗi phát đạn **đáp** đều bung khói: **tròn** (`SphereGeometry`), không đèn (`MeshBasicMaterial`), trắng
`#ffffff`, và **tan bằng cách co lại chứ không mờ dần**. Đây là chỗ dễ sai nhất: nếu để khói
mờ dần bằng alpha thì nó xám đi trên nền xanh, không còn là trắng solid; nếu để vật liệu ăn
đèn thì cái hộp trắng bị nhuộm xanh theo đèn chính của sân.

Hai kiểu khói:

| Kiểu | Khi nào | Hình |
|---|---|---|
| Khói va chạm | Đạn đụng khối — kể cả phát chỉ bong vỏ barrel, hoặc phát bị cặp link chặn | 7 cụm, bung lên |
| Khói tiếp đất | Đạn lọt dưới cụm và chạm sàn `GROUND_Y` = −1,92 | 9 cụm, thấp và toả ngang |

Khói va chạm bung **trước** các nhánh xử lý trong `handleHit`, nên không nhánh nào bỏ sót nó.
Sàn nằm dưới chân pháo và cách khối thấp nhất một khoảng an toàn, nên việc chạm sàn không bao
giờ giành mất một phát bắn đáng lẽ trúng khối: vòng quét khối luôn chạy trước.

Hình học và vật liệu khói dùng chung cho cả engine, nằm trong `disposables` như mảnh vỡ vỏ.
Puff không xoay: quả cầu scale đều thì xoay hướng nào cũng y như cũ, xoay chỉ tốn frame.

### 5b.2c Đạn bắn trượt thì nhỏ dần khi rơi, và có vệt rơi

Phát bắn không trúng gì trước đây cứ giữ nguyên kích cỡ rồi bị xoá khỏi màn — đọc ra là "viên
đạn bị lấy đi", không phải "viên đạn rơi mất". Giờ khi **đang đi xuống**:

- **Nhỏ dần theo độ cao còn lại tới sàn**: đầy cỡ khi còn cách sàn `PROJECTILE_FALL_FADE_SPAN`
  = 1,4 đơn vị, xuống còn 22% lúc chạm sàn. Đo bằng cách project ra pixel trên canvas
  643×862: đoạn nhỏ dần bắt đầu ở **y≈396–566px** và chạm sàn ở **y≈490–693px** tuỳ độ sâu —
  tức nằm gọn ở phần dưới khung, thấy được cả đoạn co lại lẫn cú tiếp đất.
- **Vệt rơi**: một puff nhỏ mỗi `FALL_TRAIL_INTERVAL` = 0,085 s, sống `FALL_TRAIL_LIFETIME` =
  0,22 s (ngắn hơn khói va chạm 0,46 s, nên `SmokePuff` giờ mang `life` riêng từng puff — để
  chung một hằng số thì vệt rơi biến thành một sợi dây trắng đặc kéo theo đạn). Nhịp tính
  theo **thời gian bay**, không theo frame, nên vệt trông như nhau ở mọi tốc độ.

**Làm mỏng vệt (lần 2).** Bản đầu vệt bị dày. Nguyên nhân chính không phải mật độ mà là puff
trail dùng chung đường "phình rồi co" của khói va chạm: nó sinh ra ở 35% cỡ rồi **to lên**, nên
các puff phía sau đạn càng lúc càng béo — thành một cái nêm loe ra chứ không phải một vệt. Giờ
`spawnSmoke()` nhận thêm `startScale`: khói va chạm vẫn nở từ 35% lên đủ cỡ, còn puff trail
sinh ra **đủ cỡ luôn rồi chỉ co lại**. Kèm ba số nhỏ lại: nhịp 0,055 → 0,085 s, đời 0,3 →
0,22 s, cỡ `PROJECTILE_RADIUS × 1,7` → `× 0,95` (nhỏ hơn chính viên đạn), toả ngang 0,22 →
0,14.

Đo lại ở tốc độ rơi ~9 đơn vị/giây:

| | Puff cùng lúc | Khoảng cách giữa puff | Đường kính | Tỉ lệ phủ dọc vệt |
|---|---|---|---|---|
| Trước | ~5,5 | ~0,49 | ~0,255 | 52% |
| Sau | ~2,6 | ~0,77 | ~0,142 | 19% |

Hai chốt an toàn:

- **Chỉ đổi cỡ vẽ.** Vòng quét va chạm vẫn dùng `PROJECTILE_RADIUS`, không đọc scale của mesh,
  nên viên đạn nhỏ lại không bao giờ làm đổi thứ nó đáng lẽ trúng — đúng lỗi công bằng mà mục
  2.1 đã sửa.
- **Reset scale khi bắn.** Đạn dùng pool, mesh vừa co lại sẽ được trao cho phát sau, nên
  `fire()` set lại `scale = 1`; thiếu dòng này thì phát tiếp theo bay ra bé tí.

### 5b.2b Bỏ nhãn hit feedback `[Green +2]`

Nhãn nổi lên giữa màn mỗi lần claim một cụm đã **bỏ hẳn**, không phải ẩn đi: bỏ luôn callback
`onBurst` và `burstKey` trong engine, state `burst` và khối JSX trong UI, `.burst-label` cùng
keyframe `burst-up` trong CSS, và `colorLabel()` trong `rules.ts` — hàm này chỉ tồn tại để in
tên màu lên đúng cái nhãn đó. Phản hồi khi phá vỡ giờ nằm hết ở sóng đẩy, khói, mảnh vỡ, rung,
và các khối bay vào goal.

Nhãn `COMPLETE / Auto clear` lúc xong màn là overlay khác, vẫn giữ.

### 5b.3 Xong màn thì vào thẳng màn sau

Nút **Next level** không quay về Menu Hub nữa. Màn mới hiện ra ngay tại chỗ, và cụm khối tự
giới thiệu bằng một entrance riêng: bắt đầu ở `HANDOFF_MODEL_SCALE` = 0,7 (đã zoom out) và
xoay sẵn nửa vòng, rồi trong **0,7 s** vừa xoay về vừa lớn lại đúng transform gốc. HUD của màn
mới trôi lên cùng lúc, nên tất cả đọc thành một động tác.

Nửa vòng xoay chạy bằng **góc quanh trục dọc**, không bằng slerp: 180° không có cung nào ngắn
hơn cung nào, nên slerp sẽ chọn chiều xoay theo dấu quaternion thay vì theo thiết kế.

Entrance được bật **trong đúng effect vừa dựng engine**, và engine vẽ lại một frame ngay tại
đó — nếu để chậm một frame thì màn mới sẽ loé lên ở dáng hoàn chỉnh trước khi entrance bắt đầu.
Input vẫn khoá tới khi cụm dừng hẳn (`introActive`), y như intro từ menu.

### 5b.3b Sửa pháo bị giựt lúc chuyển màn

Ba nguyên nhân, sửa cả ba:

**1. Pháo bay lại vào khung.** Entrance ban đầu dùng chung đường với intro từ menu: pháo tụt
xuống `CANNON_INTRO_DROP` = 3,4 rồi trồi lên. Nhưng chuyển màn thì pháo **chưa từng rời khung**
— và frame chuyển màn là frame nặng nhất cả game (dựng engine mới, commit lại cây React, layout
lại HUD), nên một cú trượt 3,4 đơn vị là chỗ mấy frame dài đó hiện ra rõ nhất. Giờ cờ
`introRaisesCannon` chỉ bật cho intro từ menu; chuyển màn thì pháo đứng nguyên tại
`cannonRestY`.

**2. Turret bị quay theo cụm đang bay.** `resetCannonDirection()` giải hướng nghỉ bằng cách
**raycast vào cụm khối**, nên gọi lúc cụm còn đang xoay và đang lớn dần sẽ ra một hướng đã sai
ngay khi frame được vẽ, rồi lúc entrance kết thúc lại giải lần nữa và giật về. Callback đầu tiên
của `ResizeObserver` rơi đúng vào khoảng 0,7 s đó — đây mới là cái "giựt giựt" của nòng pháo.
`resize()` giờ bỏ qua việc giải lại hướng khi `introActive`, chỉ intro lúc kết thúc mới giải một
lần trên cụm đã đứng yên.

**3. Frame chuyển màn bị tính vào animation.** `frameDelta` của frame đó là chi phí dựng màn,
không phải một bước animation, nên entrance mở đầu bằng một cú nhảy đúng bằng độ chậm của lần
swap. Giờ frame đầu của mọi intro chỉ dùng để đặt lại đồng hồ (`introClockPending`), easing bắt
đầu từ frame sạch tiếp theo.

---

## 5c. Hệ thống cosmetic (mới)

Nút **Skin** trong menu trước đây là placeholder `disabled`. Giờ nó mở màn chọn skin, và có hai
món dùng được: **Field Cannon** (khẩu pháo cũ) và **Star Wand** (bàn tay cầm đũa phép).

### 5c.1 Rig tách khỏi engine

`buildCannon()` giờ chỉ dựng **khung**: vị trí `cannonRoot`, `turret`, `barrelPivot`, và
`muzzleAnchor` ở `z = -2.18`. Phần "đang mặc gì" nằm ở module mới `app/game/cosmetics.ts`, mỗi
skin là một `build(groups)` gắn mesh vào bốn group đó.

**Chốt an toàn quan trọng:** rig **không được** chạm `muzzleAnchor` — thậm chí không được nhận
nó, `CosmeticRigGroups` không có field đó. Đầu đũa phép được mô hình để chạm đúng `z = -2.18`.
Nhờ vậy hai skin bắn **cùng một đường đạn**; skin không bao giờ là lý do một phát bắn trượt. Có
test soi cả hai chiều: `cosmetics.ts` không có `muzzleAnchor`, `FIXED_LAUNCH_SPEED`,
`PROJECTILE_RADIUS` hay `GRAVITY` trong phần code (comment thì được).

Rig tự tạo geometry/material riêng, **không** dùng đồ module-level: vòng teardown của engine quét
scene và dispose những gì nó thấy, nên geometry dùng chung sẽ bị giải phóng dưới chân màn sau —
đúng cái bẫy mà `disposables` đang canh. `setCosmetic()` tháo rig cũ và dispose đúng những mesh đó.

### 5c.2 Đũa phép: bộ hiệu ứng riêng, thay hẳn khói

Thêm hệ hạt `sparkles` bên cạnh `smoke`/`debris`: octahedron không đèn (đọc ra là **ánh sáng**,
không phải nhựa sơn màu), 4 màu, quay, có trọng lực riêng, tan bằng co lại. Mọi chỗ trước đây gọi
khói giờ hỏi một câu duy nhất `isMagic()`:

| Lúc | Field Cannon | Star Wand |
|---|---|---|
| Bắn | recoil | recoil + chùm sáng ở đầu đũa |
| Đang bay | vệt trắng, **chỉ khi đi xuống** | tia phép **suốt đường bay** |
| Đáp vào khối | khói tròn trắng | bling bling (12 hạt, bay ra, `gravity -2.4`) |
| Rớt ngoài tầm, chạm sàn | khói tiếp đất toả ngang | pháo hoa nhỏ (18 hạt, `gravity -7`, cộng 3 hạt lõi sáng 0,16 s) |

Khác nhau giữa bling và pháo hoa nằm ở trọng lực: bling **bay lơ lửng**, pháo hoa **rơi xuống**.
Có test so đúng hai con số đó, vì nếu chúng giống nhau thì hai khoảnh khắc đọc ra như nhau.

Viên đạn cũng đổi màu theo skin (vàng nhạt / hồng), dùng chung geometry và pool như cũ.

### 5c.3 Preview: dùng lại engine, không mở context thứ hai

Trang giữ **đúng một** WebGL context (mục 2.3), nên preview không tạo canvas riêng.
`setShowcase(true)` ẩn cụm khối, dời rig vào giữa vùng preview và cho nó lắc chậm + tự bắn mỗi
1,4 s. Vị trí chọn bằng cách **project bốn góc rig ra pixel**: rig chiếm 26–55% chiều cao khung và
dưới nửa chiều rộng, nên nằm gọn trong vùng preview và không đè lên khay thẻ.

Vòng tự bắn dùng `showcaseShots` **riêng**, không đi qua `fire()`: `fire()` tăng `state.shotIndex`,
đặt cooldown và có thể bật FAIL khi hết lượt — không được phép xảy ra sau một cái menu. Demo shot
không đọc/ghi `state`, không gọi `handleHit`, và `canInteract()` thêm `!this.showcase`. Mesh demo
mượn đúng pool đạn, nên `dispose()` phải gọi `clearShowcaseShots()` trước vòng quét — nếu không
vòng quét sẽ dispose geometry đạn dùng chung cho cả trang.

### 5c.4 Thumbnail là ảnh render thật

`getCosmeticThumbnails(renderer)` dựng từng rig trong scene tạm (đèn riêng — một `Object3D` chỉ
thuộc một scene), render vào `WebGLRenderTarget` 192² với clear alpha 0, `readRenderTargetPixels`,
lật dọc (WebGL đọc từ dưới lên, canvas ghi từ trên xuống) rồi `toDataURL`. Trả render target và
clear alpha về đúng giá trị cũ, dispose target, cache lại cho cả trang. Texture đặt
`SRGBColorSpace`, nếu không thẻ sẽ tối hơn model trên màn.

Đã đo trên bản chạy thật, bằng cách đọc lại data URL và tính bounding box theo alpha:

| Thẻ | Bounding box | Tâm | Diện tích | Bị cắt mép |
|---|---|---|---|---|
| Field Cannon | x 18–173, y 40–176 | 96,108 | 36% | không |
| Star Wand | x 26–165, y 49–154 | 96,102 | 22% | không |

Tâm ngang đúng 96/192 ở cả hai (lần đo đầu lệch phải 18px nên đã bỏ offset x của rig; camera cũng
kéo gần từ 5,6 xuống 5,1 để thẻ đầy hơn).

### 5c.5 Màn chọn

Không dùng `.modal-overlay`: overlay đó có nền đục, sẽ che đúng cái rig mà màn này tồn tại để
trưng. Thay vào đó `.cosmetic-screen` với vùng giữa **trong suốt** và `pointer-events: none`, và
`.hub-screen` bị đánh `inert` để tap-to-play không ăn tap. Escape/Tab dùng lại đúng khuôn của
dialog cũ (`cycleFocus()` giờ là helper chung cho cả settings và màn skin).

Bấm thẻ chỉ **xem trước** (rig đổi ngay trong preview), nút dưới preview mới là **áp dụng** — nên
nút mới có nghĩa khi đọc "Selected" hay "Select", và đóng màn mà chưa áp dụng thì rig quay về món
đang mặc. Lưới có 2 thẻ thật + 6 ô khóa `disabled`, chip kim cương là trang trí (như nút Shop).
Lựa chọn lưu ở `cannon-sort:v1:cosmetic`.

Đã kiểm trên bản chạy (bằng DOM, không cần rAF): mở màn → 8 thẻ, 6 ô khóa đều `disabled`,
hai thumbnail là PNG data URL thật; bấm thẻ đũa → tiêu đề đổi "Star Wand", nút thành "Select";
bấm Select → `localStorage` = `magic-wand`, nút thành "Selected", tick nhảy sang thẻ 2; Escape →
đóng. Console không lỗi (trừ cảnh báo `navigator.vibrate` của Chrome vì tôi bấm bằng script chứ
không phải tap thật — `haptics.ts` đã catch sẵn).

### 5c.6 Làm lại đũa phép, và dọn UI hub khỏi màn skin

**Đũa phép trông như cái pittong.** Hai chỗ sai. Cây đũa quá ngắn và quá mập (shaft `r 0.055–0.09`
dài 2,05) với một ngôi sao vàng `0.2` gắn ở đầu; và bàn tay dựng ở cỡ khẩu pháo (palm `r 0.42`,
cẳng tay `r 0.34–0.4`) nên chính bàn tay thành khối lớn nhất trong rig, chiếm luôn silhouette.

Làm lại theo kiểu đũa Harry Potter: **thuôn dần suốt chiều dài**, không có ngôi sao.

| Phần | Trước | Sau |
|---|---|---|
| Thân đũa | `r 0.055–0.09`, dài 2,05 | tay cầm `r 0.088–0.062` dài 0,52 + thân thuôn **`r 0.055 → 0.018`** dài 1,62 |
| Đầu đũa | ngôi sao vàng `r 0.2` + 2 hạt hồng | một hạt sáng `r 0.05` đúng tại muzzle |
| Bàn tay | palm `r 0.42`, 4 ngón `r 0.075` | palm `r 0.24`, 3 ngón `r 0.048` |
| Cẳng tay | `r 0.34–0.4`, dài 0,55 | `r 0.2–0.24`, dài 0,5 |
| Gỗ | tím `#3a2a4d` | gỗ nâu `#40291c` tay cầm, `#6b4a2f` thân, 2 vòng đai mảnh |

Hướng thuôn có một bẫy: `CylinderGeometry(radiusTop, radiusBottom)` sau khi `rotation.x = π/2` thì
**radiusBottom nằm ở −z**, tức là ở đầu đũa — nên muốn nhỏ ở đầu thì số nhỏ phải đứng thứ hai.

Đã đo lại trên thumbnail đã render, đếm pixel đặc theo từng hàng từ đầu đũa xuống:

| Hàng | y60 | y70 | y80 | y90–100 | y110–140 |
|---|---|---|---|---|---|
| Bề rộng | 4px | 7px | 36px | 42px | 77–140px |

Tức đầu đũa **4–7px**, vùng bàn tay 36–42px, đĩa rune 77–140px — silhouette của một cây đũa, không
phải một cái cán. Thẻ chiếm 18% (trước 22%, hụt đi vì đũa mảnh hơn), tâm ngang vẫn đúng 96/192,
không bị cắt mép.

**Dọn UI hub khỏi màn skin.** Trước đây màn skin nằm **đè lên** menu, mà vùng giữa lại trong suốt,
nên tên level ("Prism 4x3x2"), nút Skin, nút Shop, nút cài đặt và cả chữ TAP TO PLAY đều lòi qua và
đánh nhau với cái skin đang trưng. Giờ màn skin **thay thế** menu: `{screen === "hub" && !cosmeticOpen && ...}`
— menu unmount hẳn, nên không cần `inert` nữa. Chip kim cương tím bỏ luôn khỏi cả JSX và CSS.

Kéo theo một chỗ phải sửa: đóng màn thì focus trả về nút Skin, nhưng lúc `closeCosmetics()` chạy
thì nút đó **chưa được mount lại**, nên `ref` còn trỏ vào node đã tháo. Giờ đặt cờ
`cosmeticClosingRef` rồi một effect trả focus sau khi menu quay lại. Đã kiểm: đóng màn →
`document.activeElement` là nút "Skin", tên level và các nút hiện lại đầy đủ.

Còn lại trên màn skin: tiêu đề, tagline, nút X, nút Selected, và khay thẻ. Đúng bằng
`document.body.innerText`: `STAR WAND | Point. Sparkle. Repeat. | ✕ | Selected | ✓ | 🔒 ×6`.

### 5c.7 Đũa dày lại, bỏ tấm phẳng, tuốt lại cho mịn

Bản 5c.6 thuôn quá tay: đầu đũa còn `r 0.018`, nhìn ra sợi dây chứ không ra cây đũa. Giữ hướng
thuôn nhưng cho nó bề dày thật.

| Phần | 5c.6 | Giờ |
|---|---|---|
| Thân | `r 0.055 → 0.018` | **`r 0.085 → 0.05`** |
| Tay cầm | `r 0.088–0.062` | `r 0.115–0.088`, thêm **pommel cầu** bọc đầu cắt |
| Hạt đầu đũa | `r 0.05` | `r 0.062` |

Đo lại bằng cách đếm pixel đặc theo hàng trên thumbnail: đầu đũa **10–13px** (trước 4–7px), vùng
bàn tay 40–49px. Tức thân đũa còn khoảng 1/4 bề rộng bàn tay — chắc tay nhưng vẫn là đũa.

**Bỏ tấm phẳng màu solid trên ụ.** 4 cái rune trên đĩa là `BoxGeometry(0.19, 0.03, 0.19)` với
material không đèn — tức là **tấm phẳng một màu**, xoay góc nào cũng chỉ là một miếng màu đặc dán
trên đĩa. Thay bằng **hai vòng tròn đồng tâm** (`TorusGeometry`): vẫn đọc ra vòng phép, nhưng là
hình khối tròn có ăn sáng. Có test khoá: `buildMagicWand` không được có `BoxGeometry`.

**Tuốt cho mịn.** Số segment trước đây là số lúc mới dựng khối thô, mà rig này chiếm cỡ 1/3 màn
hình nên các mặt cắt hiện thành cạnh vát rõ. Giờ nâng hết, và bọc lại các đầu cắt hở:

| | Trước | Sau |
|---|---|---|
| Đế pháo (cylinder) | 24 | 44 |
| Vòng đế / muzzle / collar (torus) | 8×24, 8×20 | 16×44, 16×36 |
| Cradle (sphere) | 18×12 | 32×20 |
| Nòng (cylinder) | 18 | 32 |
| Đĩa rune | 28 | 48 + vành torus 14×56 |
| Bàn tay / cẳng tay | 14×10, 14 | 24×16, 24 |
| Ngón (capsule) | 4×8 | 6×14 |

Thêm hai khối bọc đầu cắt: **breech** cầu ở đuôi nòng pháo, và **elbow** cầu ở đầu ống tay áo —
trước đó cả hai kết thúc bằng một mặt phẳng tròn lộ ra.

Có test kiểm **sàn segment theo từng loại geometry** (cylinder ≥ 20, sphere ≥ 16×12, torus ≥ 12×24,
capsule ≥ 6×14) quét toàn bộ `cosmetics.ts`, nên lần sau ai thêm hình mới mà để số thấp là đỏ ngay.
Thumbnail đo lại: cannon 36%, wand 20%, tâm ngang đúng 96/192 ở cả hai, không cắt mép.

### 5c.8 Bỏ cái "mụn" trên bàn tay, và crosshair pháp trận cho đũa

**Cái nhô lên là ngón cái.** Đo lại bằng chính phương trình mặt cầu bàn tay (r 0.25, scale
`1 / 0.88 / 1.3`, tâm z −0.32):

| Khối | Đầu khối x | Mặt cầu tại đó | Kết quả |
|---|---|---|---|
| Ngón cái | 0,234 | 0,195 | **chọc ra 0,039** → đọc thành một cái mụn |
| Ngón 1 | 0,155 | 0,227 | nằm trong lòng cầu |
| Ngón 2 | 0,155 | 0,238 | nằm trong lòng cầu |
| Ngón 3 | 0,155 | 0,210 | nằm trong lòng cầu |

Tức bốn khối ngón tay: một cái chọc ra thành mụn, ba cái **hoàn toàn vô hình** — geometry chết,
vẫn tốn draw call. Bỏ cả bốn, để lại đúng một khối cầu làm bàn tay nắm. Ở cỡ này (bàn tay ~0,5 đơn
vị so với khối 0,92) ngón tay mô hình không sống được; một khối nắm mịn đọc ra "đang cầm" tốt hơn.

**Crosshair pháp trận.** Crosshair là DOM (`.aim-crosshair` + `::before`/`::after` + `.aim-crosshair-core`),
nên skin đũa chỉ cần một class: `buildCosmeticRig()` toggle `is-magic` — một chỗ duy nhất, nên cả
lần dựng đầu và mọi lần đổi skin đều đúng. CSS định nghĩa lại đúng ba element đó thành vòng phép:

- `::before` → vòng ngoài 36px liền
- `::after` → vòng trong 23px nét đứt, tự quay 6s
- `.aim-crosshair-core::after` → 4 vạch rune quanh vòng, làm bằng `repeating-conic-gradient` mask
  thành một dải mỏng, quay ngược 9s (có cả `-webkit-mask` cho Safari)
- mọi vòng đều có viền tối hai mặt (`box-shadow` ngoài + inset) — đúng lý do crosshair cũ là trắng
  viền đen: phải đọc được cả trên khối màu nhạt lẫn trên nền tối

Một chỗ phải nghĩ thêm: trạng thái "không có gì để bắn" của crosshair cũ là **xoay 45° thành dấu
×**, mà vòng tròn xoay 45° thì không thấy gì. Nên với đũa, trạng thái đó chuyển thành **đổi màu
hồng-đỏ + co lại 0,88**, còn trúng đích thì vòng ngoài chuyển vàng sáng.

Đã kiểm trên bản chạy: skin đũa → `.aim-crosshair` có class `is-magic`, `::before` resolve ra
36px `border-radius: 50%`, vòng trong 23px `dashed` chạy `rune-spin 6s`, vạch rune 46px có
conic-gradient + mask và chạy `reverse`; bấm sang thẻ pháo → class `is-magic` mất, `::before` trở
về thanh `26px × 6px` bán kính 2px; đóng màn (chưa Select) → quay lại `is-magic` đúng món đang mặc.
Console sạch.

### 5c.9 Bàn tay dựng lại ở cỡ model pháo, tay áo dài ra

Mục 5c.8 bỏ hết ngón vì ở cỡ cũ (khối cầu `r 0.25`) không ngón nào sống được. Giờ phóng lên **cỡ
model pháo** và dựng lại thành bàn tay thật.

Điểm mấu chốt không phải scale mà là **bố cục**: ngón chỉ sống nếu **không bao giờ nằm trong lòng
bàn tay**. Nên lòng bàn tay là một **phiến** (`r 0.46`, scale `0.95/0.55/1.2` → **0,87 × 0,51 × 1,10**,
cùng hạng với nòng pháo 0,48–0,76 và cradle 1,24), mặt trên phiến nằm ngay dưới trục đũa, và 4 khớp
ngón là một dãy capsule **nằm trên** mặt đó, mỗi cái giữ silhouette riêng. Ngón cái chạy dọc thân
đũa ở mặt bên, ra ngoài bề rộng phiến.

Đo lại từng khối so với mặt cầu tại đúng vị trí của nó:

| Khối | Nhô khỏi lòng bàn tay | Đáy khối |
|---|---|---|
| Khớp 1 | 0,152 | ôm vào tay cầm |
| Khớp 2 | 0,132 | ôm vào tay cầm |
| Khớp 3 | 0,112 | ôm vào tay cầm |
| Khớp 4 | 0,092 | ôm vào tay cầm |
| Ngón cái | 0,082 | chạy dọc z −0,60..−0,12 |

Bẫy tôi tự sập một lần: lần đầu so ngón cái với **bề rộng lớn nhất** của phiến (0,399) nên tưởng nó
bị chìm, trong khi phải so với mặt cầu **tại đúng y,z của nó** (0,343) — cùng loại lỗi đã tạo ra cái
mụn ở 5c.8, chỉ ngược dấu.

**Tay áo dài ra**: `r 0.21–0.25` dài 0,5 → **`r 0.30–0.36` dài 1,15** (2,3×), thêm một đường viền
gấu ở giữa và cầu bọc đầu ống. Project ra pixel để chắc nó không che mất chỗ chơi: trong game, gấu
tay áo ở **y 654 trên khung cao 575** — tức chạy hẳn ra ngoài mép dưới, đọc thành cánh tay từ ngoài
màn hình đưa vào; còn trong preview thì cả cánh tay nằm trong khung (cuff 259, gấu 319, đầu đũa 164).

Thumbnail đo lại: wand fill **25%** (trước 20%), vùng bàn tay 41–91px theo hàng (trước 40–49px),
đầu đũa vẫn 5–11px, không cắt mép.

### 5c.10 Bỏ bàn tay: skin thứ hai thành **ụ súng phép thuật**

Bàn tay bị bỏ hẳn. Hai lý do, và cả hai đều là lý do lẽ ra phải thấy trước khi dựng:

1. **Bàn tay là hình mà người chơi đã biết thuộc lòng.** Mọi phiên bản gần-đúng của nó đọc ra là
   "bàn tay làm dở", chứ không phải "bàn tay cách điệu" — trong khi một cái súng trên ụ thì không có
   mốc so sánh nào để mà sai.
2. **Bàn tay phải dựng ở cỡ bàn tay**, nên nó luôn nhỏ hơn hẳn khẩu pháo mà nó thay thế; hai skin
   không bao giờ trông như cùng một hạng vật thể.

Skin thứ hai giờ là **ụ súng phép** — đúng ba khối mà khẩu pháo có, cùng kích thước, khác chất liệu:

| Khối | Field Cannon | Rune Cannon |
|---|---|---|
| Bệ | cylinder `1.08–1.3 × 0.48` | **y hệt**, đá tím + vòng rune phát sáng + vòng trong vàng |
| Ổ súng | cầu `r 0.62` scale `1/0.72/1` | **y hệt**, kèm 2 tinh thể nạp ở hai bên |
| Nòng | cylinder `0.34 → 0.22`… | dài **2,35 y hệt**, nhưng **thuôn về phía miệng** |
| Miệng nòng | torus tối + collar vàng | tinh thể tụ sáng ngay tại muzzle + vòng halo lơ lửng |

Chỗ tạo ra khác biệt khi nhìn nhanh chính là **đảo hướng thuôn**: pháo thường **loe ra** ở miệng
(`0.24 → 0.38`), còn nòng phép **thu lại** (`0.34 → 0.22`) rồi kết thúc bằng tinh thể. Có test chốt
đúng hai chiều đó, cộng với việc hai skin phải dùng **cùng bệ và cùng chiều dài nòng** — nếu ai làm
lệch cỡ như bản bàn tay thì test đỏ.

Tên hiển thị đổi thành **Rune Cannon** / "Charge. Sparkle. Repeat.", nhưng **id vẫn là `magic-wand`**
vì đó là thứ đang nằm trong storage của người chơi; đổi id là âm thầm reset lựa chọn của họ.

### 5c.10b Đóng màn skin xong vẫn còn particle chạy nốt

`setShowcase(false)` dọn **viên đạn demo** (`clearShowcaseShots`) nhưng không dọn **hạt mà mấy phát
đạn đó đã sinh ra**. Hạt sống độc lập với viên đạn: khói 0,46s, bling 0,5s, pháo hoa **0,72s**. Nên
bắn xong mà đóng màn ngay thì Menu Hub thừa hưởng nguyên một chùm hạt không liên quan gì đến nó.

Sửa: thêm `clearParticles()` — bỏ mọi puff và sparkle khỏi scene rồi rỗng hai mảng — và gọi nó
trong `setShowcase()` **trước nhánh rẽ**, tức là **cả hai chiều**: menu không nhận chùm hạt của
picker, và picker cũng không mở ra ngay giữa cái đuôi của thứ gì khác.

Kèm một chỗ cùng loại: phát demo cuối để lại nòng **đang giật giữa đường**, mà hàm giảm recoil chạy
tiếp trên bất cứ thứ gì rig làm sau đó. Nên khi rời showcase cũng reset `recoil = 0` và
`barrelVisual.position.z = 0`.

Geometry/material của hạt dùng chung cho cả engine và được giải phóng một lần trong `dispose()`, nên
ở đây chỉ tháo node ra khỏi scene, không dispose.

Đo lại thumbnail — đây là con số trả lời trực tiếp yêu cầu "cỡ na ná field cannon":

| Thẻ | Bounding box | Diện tích | Tâm |
|---|---|---|---|
| Field Cannon | **155 × 136** | 36% | 96,108 |
| Rune Cannon | **155 × 130** | 35% | 96,111 |

Bề rộng bằng nhau đúng 155px, diện tích lệch 1%. Bản bàn tay trước đó là 145 × 99 và 25%.

### 5c.11 Sửa khối ở đuôi nòng trồi ra trồi vào lúc bắn

Bắn thì `barrelVisual` bị đẩy lùi 0,23 đơn vị (recoil). Khối nào **nằm sát bề mặt ổ súng** sẽ chui
vào rồi trồi ra theo mỗi phát bắn — đúng cái nhấp nháy ở đuôi.

Tôi dựng lại phương trình ellipsoid của ổ súng rồi soi **từng điểm cực trị** của từng khối, lấy 21
mẫu dọc quãng giật, xem điểm nào **đổi trạng thái** trong/ngoài. Kết quả trên bản cũ:

| Khối | Kết quả |
|---|---|
| Đuôi nòng pháo (đỉnh vành) | ẩn → **hiện** khi giật |
| Cầu breech, khẩu pháo (cực sau) | ẩn → **hiện** |
| Cầu breech, nòng phép (cực sau) | ẩn → **hiện** |
| Collar, cả hai | không đổi trạng thái (không phải nguyên nhân) |

Đáng nói là cái collar: tôi từng đoán nó là thủ phạm và đã thử dời ra `z −0.55`, đo lại thì **chính
cú dời đó mới sinh ra pop** (giật vào làm nó chìm hẳn vào ổ). Đo trước, sửa sau.

Hai sửa:

1. **Bỏ cầu breech ở cả hai rig.** Nó được thêm ở mục 5c.7 để bọc mặt cắt sau của nòng, nhưng ở
   trạng thái nghỉ nó **đã nằm hẳn trong ổ** — tức vô hình — và chỉ hiện ra đúng lúc giật. Mặt cắt
   sau của nòng thì ổ súng vốn đã che kín.
2. **Ổ súng tự suy ra độ dẹt** thay vì đặt tay. Thêm `housingYScale(barrelBackRadius, barrelBackZ,
   housingRadius)`: trả về độ dẹt **thấp nhất** vẫn che kín vành sau của nòng ở cuối quãng giật,
   cộng 10% biên. Ra `0.877` cho khẩu pháo và `0.926` cho nòng phép (trước đó cả hai đặt tay
   `0.72` — chính là chỗ hụt). Nòng phép cũng thu bán kính gốc `0.34 → 0.26` cho vừa luật này.

Đo lại với đúng số mà code sinh ra: **0 điểm pop** trên cả hai rig, suốt cả quãng giật.

Ba thứ được khoá lại để đừng tái diễn:

- `RECOIL_TRAVEL` giờ là hằng số có tên ở engine (thay `* 0.23` rải rác), và `cosmetics.ts` giữ một
  bản cùng giá trị — có test so **hai file phải bằng nhau**, vì clearance giải theo sai số thì vô
  nghĩa.
- Test bắt buộc độ dẹt ổ súng phải đến **từ `housingYScale(...)`**, không được là số viết tay.
- Test bắt buộc không rig nào có `breech` trở lại.

Luật này viết hẳn thành comment ở đầu `cosmetics.ts`: *khối gắn trên nòng phải **hoặc luôn trong,
hoặc luôn ngoài** mặt ổ súng trong cả quãng giật — cái nào đi từ trong ra ngoài thì mỗi phát bắn sẽ
hiện ra từ hư không.*

---

## 5d. Màn hình loading (mới)

### 5d.1 Có cần không, và cần cho cái gì

Đo bản build: **841 KB một file**, trong đó **795 KB là JS đã minify**, CSS 33 KB, và **0 request ra
ngoài** — không link, không font, không ảnh. Nên:

- **Không cần** cho việc tải: không có gì để tải, và cũng **không có tiến trình nào để đo**.
- **Nhưng có một khoảng trống thật.** CSS nằm inline trong `<head>` nên nền gradient vẽ được sau
  ~34 KB; rồi browser mới compile + chạy 795 KB JS, dựng React, dựng engine, tạo WebGL context,
  compile shader. Suốt khoảng đó người chơi nhìn **nền xanh trống trơn, không một chữ**.

### 5d.2 Cách làm: markup, không phải JavaScript

Màn loading nằm trong **markup**. Đây là điểm quyết định: nếu để JS vẽ thì nó xuất hiện **cùng lúc**
với game mà nó lẽ ra phải che — tức vô dụng. Đo trên file build: loader nằm ở byte **37 KB**, bundle
bắt đầu ở **43 KB**, nên browser vẽ được nó trước khi phải compile ~795 KB còn lại.

Art là **inline SVG**, không phải ảnh. Ảnh chụp game nhúng vào file đơn sẽ cộng vài trăm KB và
**phải decode xong mới vẽ được** — chậm hơn chính cái nó đang che. SVG dựng lại đúng bố cục trong
ảnh mẫu (cụm khối 4×3 có mặt trên và mặt bên, khẩu pháo bị cắt ở góc dưới trái, các khối nhỏ bay
lơ lửng, vệt sáng) bằng polygon, tốn **4,7 KB**.

Một string, hai chỗ dùng: `app/layout.tsx` (bản dev, server-render nên nằm trong HTML đầu tiên) và
`work/build-standalone.mjs` (bản một file). Viết hai lần thì chắc chắn lệch nhau, nên có test chốt
cả hai đều dùng `LOADING_SCREEN_MARKUP` và bản build **không được** có bản copy riêng.

### 5d.3 Thanh tiến trình chạy theo mốc thật

Không có gì để tải nên tôi **không làm bar giả chạy theo timer**. Bar nhảy theo bốn mốc, mỗi mốc là
một việc đã thực sự xong:

| Mốc | Là gì | Bar |
|---|---|---|
| (markup) | frame đầu đã vẽ | 10% |
| `boot` | dòng đầu của bundle chạy được — tức đã compile xong 795 KB | 34% |
| `mount` | React mount xong, sheet màn chơi đọc xong | 58% |
| `engine` | engine dựng scene và vẽ frame đầu | 86% |
| `ready` | xong, bắt đầu mờ đi | 100% |

`advanceLoading()` **không bao giờ đi lùi** (mốc có thể tới lộn thứ tự khi hot-reload, mà bar tụt thì
đọc ra là đang lỗi). Bar có transition 0,32s để cú nhảy không bị giật, và một vệt sáng chạy dọc phần
đã đầy — vệt đó là **trang trí duy nhất** ở đây, còn vị trí đầu là mốc thật. Test cấm `setInterval`
và `Math.random` trong module này.

Text là `LOADING` + ba dấu chấm nhấp nháy lệch pha, cũng nằm trong markup.

### 5d.4 Dọn đi cho sạch

Xong thì loader **rời khỏi document**, không phải để trong suốt nằm trên game — nằm lại thì nó ăn
mất cú tap đầu tiên. `is-done` bật `pointer-events: none` ngay khi bắt đầu mờ, rồi `remove()` sau
420ms.

CSS của nó **không được dựa vào token nào của app** (`var(--panel)`, `var(--accent)`…): về phía
browser, nó được style trước khi phần còn lại của app tồn tại. Có test soi đúng điều đó.

Đã kiểm trên bản chạy:

- loader **có trong HTML server trả về**, SVG parse sạch, đúng 12 mặt trước của cụm khối, có chữ
  `LOADING`, có bar, khởi điểm `--loading-progress:10%`
- map giá trị → bề rộng thật: `10% → 21px · 34% → 73px · 58% → 124px · 86% → 184px · 100% → 214px`
  trên track 215px (phải tắt transition mới đọc được, vì tab này không có frame để transition chạy)
- `.is-done` cho `pointer-events: none`
- sau khi game mount: loader **đã không còn trong DOM**, console sạch

Chưa kiểm được bằng mắt: dáng SVG (cụm khối, khẩu pháo) và **thời gian thật** của khoảng trống —
muốn số đó phải mở file trên máy thật rồi đọc `performance`. Ở đây pane không compositing nên không
có first-paint để lấy.

---

## 6. Test

Từ 10 test lên **117 test**, 16 file:

| File | Nội dung |
|---|---|
| `game-rules.test.ts` | Luật goal/batch/overfill/fail (có từ trước) |
| `aim-source-regression.test.mjs` | Crosshair không snap vào block (có từ trước) |
| `aim-target-regression.test.mjs` | Đường bay nhắm khối dưới tâm ngắm, không phải mặt phẳng cố định |
| `renderer-lifecycle.test.mjs` | Engine mượn máy vẽ dùng chung, không tạo context mới; đạn dùng pool |
| `sort-flight.test.mjs` | Quỹ đạo bay nằm trong khung ở mọi thứ tự sprite, mọi mép, khung nhỏ bất thường |
| `multi-touch-regression.test.mjs` | Xoay và ngắm không chặn nhau, nhưng vẫn chặn khi đạn đang bay |
| `haptics.test.mjs` | Nhịp rung, giảm dần khi nhiều khối rơi, tắt/bật |
| `level-sheet.test.mjs` | Parser bảng, TSV/CSV/chấm phẩy, mọi lỗi được báo, `.csv` và `.tsv` cho ra màn giống nhau |
| `barrel-link.test.mjs` | Barrel layers, link expand cả cụm, mọi lỗi link/barrel, và hai màn test đúng thiết kế |
| `batch-flight.test.mjs` | Nhịp bay dưới 1 giây ở mọi số lượng, engine tự đi từng bước cascade, mọi thứ khác đứng chờ trong lúc bay, và sprite dựng đúng giữa hai đầu |
| `menu-hub.test.mjs` | Menu chặn gameplay, model xoay ngoài nhánh paused, menu thu nhỏ model, intro zoom kết thúc đúng transform gốc và chỉ mở input sau đó, đã bỏ nút level, CSV chỉ nhận ở menu, có đường về menu |
| `impact-feel.test.mjs` | Sóng đẩy đi ra từng vòng (yếu dần, trễ dần, vòng chỉ đánh dấu sau khi thu xong), vòng chưa tới thì khối đứng im, khói tròn trắng solid tan bằng co lại chứ không mờ, mọi nhánh `handleHit` đều bung khói, chạm sàn không giành mất phát trúng khối, đạn rơi thì nhỏ dần theo độ cao và nhả vệt theo thời gian bay (chỉ đổi cỡ vẽ, pool reset scale), nhãn hit feedback đã bị bỏ khỏi UI-engine-CSS |
| `loading-screen.test.mjs` | Loader là markup chứ không do JS vẽ và không có asset để tải, một string dùng cho cả bản dev và bản một file, trong template nó đứng trước bundle, bar nhảy theo mốc thật và không đi lùi (không timer, không random), xong thì rời khỏi DOM và tắt pointer-events, CSS không dựa vào token nào của app |
| `cosmetics.test.mjs` | Hai skin và fallback khi id lạ, hai rig cùng bệ và cùng chiều dài nòng còn hướng thuôn thì ngược nhau (pháo loe, nòng phép thu), đóng màn skin thì hạt của nó bị dọn theo (cả hai chiều) và recoil được reset, không khối nào trên nòng cắt mặt ổ súng trong quãng giật (`RECOIL_TRAVEL` khớp giữa hai file, độ dẹt ổ phải do `housingYScale` giải, không có `breech` trở lại), rig không có tấm phẳng (`BoxGeometry`) và mọi hình tròn đạt sàn segment theo loại, đầu đũa không mảnh dưới ngưỡng, crosshair đũa là vòng phép (toggle một chỗ, dispose trả class, trạng thái "không trúng" đổi màu thay vì xoay 45°), màn skin thay thế menu chứ không đè lên (không còn tên level/Skin/Shop/currency lòi qua) và focus trả về nút Skin sau khi menu mount lại, lưu localStorage đúng khuôn haptics, skin không chạm muzzle/không có hằng số gameplay, swap skin dispose rig cũ, đũa phép thay hẳn khói (bling bay lơ lửng vs pháo hoa rơi), sparkle chạy trong fixed-step, demo shot trong preview không chạm state, thumbnail render bằng đúng renderer và cache một lần, nút Skin mở màn không dùng modal-overlay, thẻ xem trước còn nút mới áp dụng |
| `link-bridge.test.mjs` | Nẹp ở mọi giao điểm của cặp link và trên mọi mặt ngoài của từng giao điểm (không tính giao điểm trong lòng một cụm), level 5 ra đúng 4 giao điểm / 6 nẹp và sườn nhìn thấy được bắt đủ cả hai giao điểm, giao điểm không có mặt ngoài vẫn được một nẹp, hai cụm rời nhau vẫn có một nẹp chọn theo khoảng cách → mặt dễ thấy → id, đặt lại mỗi frame từ vị trí khối thật, claim thì cả đường ghép rơi đúng một lần |
| `level-handoff.test.mjs` | Nút Next level vào thẳng màn sau chứ không qua menu, entrance bật trong đúng effect dựng engine và chỉ một lần, màn mới zoom out + xoay nửa vòng trong 0,7 s, nửa vòng chạy bằng góc chứ không slerp, pháo đứng yên khi chuyển màn nhưng vẫn trồi lên khi vào từ menu, không ai giải lại hướng pháo lúc cụm còn đang bay, frame đầu của intro chỉ đặt lại đồng hồ |

Chạy: `npm test` · `npm run lint` · `npx tsc -p tsconfig.json`

---

## 7. Còn mở, cần bạn chốt

1. **§2.4.3 chuỗi link** — link chỉ nối hai cụm, hay nối được dây dài? Ví dụ chuỗi: đỏ →
   tím → cam, bắn đỏ thì tím chết, tím lại kéo cam chết theo; một phát ba cụm và phải tính
   chỗ chứa cho ba màu cùng lúc. Hiện chặn chuỗi.
2. **§2.4.2 cách hiểu** — tôi hiểu là **cả cặp bị khoá** (bắn A không phá được gì). Nếu ý
   bạn là "A vỡ, B ở lại" thì đổi một dòng.
3. **Barrel lồng nhau** — hiện 3 lớp là 3 lớp của *cùng một* vỏ (đổi màu), không phải ba
   vỏ lồng vẽ chồng nhau.
4. **Hàng dự trữ ở đoạn auto-clear** — hàng goal đã biến mất nhưng hàng `DỰ TRỮ 0/2` vẫn
   nằm đó (rỗng). Muốn sạch hoàn toàn thì ẩn luôn.
5. **Repo chưa có git.** Trong phiên này `work/levels.tsv` từng bị mất khỏi ổ đĩa và tôi
   phải khôi phục từ bản đã đóng gói trong `levels-sheet.ts`. Nên `git init` để có mạng an
   toàn.
6. **Nếu cần file nhỏ hơn**: nén gzip tự giải trong HTML đưa 815 KB về ~278 KB (dùng
   `DecompressionStream`, vẫn chạy offline); bỏ React viết HUD thuần tiết kiệm thêm
   ~193 KB; tự viết micro-renderer thay three.js thì về ~90 KB nhưng tốn 2–4 ngày và nhiều
   rủi ro.

---

## 8. Dọn file trùng (21/08)

Trong repo có một **bản copy cũ của chính nó** ở `3d-cannon-sort-source/`. Không xoá theo cảm tính:
tôi hash từng file rồi đối chiếu với cây đang làm việc.

| | |
|---|---|
| Số file trong bản copy | 49 (không tính `node_modules`) |
| Giống hệt cây hiện tại | 27 |
| Cùng đường dẫn, nội dung **cũ hơn** | 22 |
| **Chỉ tồn tại trong bản copy** | **0** |

Không file nào là duy nhất ở đó, và 22 file khác biệt đều là bản cũ (ví dụ `CannonSortEngine.ts`
1.867 dòng ngày 20/08 so với 2.959 dòng hiện tại). Nên xoá không mất gì.

Nó còn đang **gây hại thật**, không chỉ chiếm chỗ: `tsconfig.json` include `**/*.ts` và chỉ exclude
`node_modules`, nên bản copy **bị typecheck và lint cùng** — mọi lỗi `cloudflare:workers` bị báo hai
lần, và `tsc` phải làm gấp đôi việc. Sau khi xoá:

| | Trước | Sau |
|---|---|---|
| `tsc --noEmit` | timeout ở 300s | **8,7s** |
| Số dòng lỗi (đều là lỗi cũ trong `db/`, `worker/`) | 6 | 3 |

Xoá thêm `.pnpm-store/` (3 file, 40 KB): cache của pnpm còn sót, mà dự án dùng npm
(`package-lock.json` + `node_modules`).

**Giữ lại, kèm lý do** — mấy thứ trông như trùng nhưng không phải:

| Thứ | Vì sao giữ |
|---|---|
| `work/levels.csv` cạnh `levels.tsv` | `tests/level-sheet.test.mjs` đọc nó để chứng minh CSV và TSV cho ra màn giống nhau |
| `app/game/level-01.ts` | `level-source.ts` và hai file test đang import |
| `outputs/3d-cannon-sort-source.zip` | Là zip của đúng bản copy vừa xoá, tức **bản lưu trữ duy nhất còn lại** của trạng thái cũ (181 KB) |
| `.openai/hosting.json` | Config deploy, 35 byte, không phải file trùng |
| `tsconfig.tsbuildinfo` | Cache incremental; xoá thì `tsc` lần sau chậm lại |

Đã kiểm sau khi xoá: 117/117 test pass, lint sạch, build ra file y hệt (861.616 bytes).
