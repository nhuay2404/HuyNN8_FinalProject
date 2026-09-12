# Nhật ký thay đổi — 3D Cannon Sort prototype

Ghi lại mọi thay đổi từ lúc bắt đầu phiên làm việc (bản concept `update_concept`, khi
`outputs/3d-cannon-sort.html` còn chưa tồn tại) tới bản hiện tại.

**Bản hiện tại:** `outputs/3d-cannon-sort.html` — 932.486 bytes, 2 level cát (falling-sand pixel puzzle —
xem mục 102 trở đi và bộ nhớ dự án về đợt pivot bỏ hẳn cơ chế Cannon Sort cũ), một file HTML chạy offline
bằng static server/`file://`, không cần server và không cần mạng lúc chơi.

**Trạng thái kiểm tra:** 123/123 test pass (`npm test`) · `tsc --noEmit` sạch · build standalone sạch,
không log lỗi console khi mở bản xuất.

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

> **Đã bị bỏ ở mục 13.** Toàn bộ mục này giữ lại làm lịch sử: Barrel và Link không còn
> trong source, và hai màn test của chúng đã bị xoá. Đọc mục 13 trước khi dựa vào bất kỳ
> chi tiết nào dưới đây.

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

Từ 10 test lên **152 test**, 18 file:

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
| `batch-flight.test.mjs` | Nhịp bay dưới 1 giây ở mọi số lượng, engine tự đi từng bước cascade, mọi thứ khác đứng chờ trong lúc bay, và sprite dựng đúng giữa hai đầu |
| `batch-ui.test.mjs` | Kho dự trữ là **một** khay chứ không phải hàng slot (không còn `data-batch-slot`, không in chữ số nào), caption đếm block so với budget chứ không đếm record so với slot, con số vẫn tới screen reader qua `aria-label`, khay giữ màu neutral vì nó chứa nhiều màu cùng lúc còn pip lấy màu từ record của nó, khay có lip đáy dày hơn vách và giữ đúng 32px, pip lấy cột từ `--pips` với `minmax(0, 1fr)` nên hai hàng pip luôn vừa lòng khay, cụm làm tràn bị từ chối **trước** nhánh shot-limit nên không tốn đạn và được kiểm lại ở lúc va chạm, và bàn chơi không còn nước đi thì kết thúc màn |
| `menu-hub.test.mjs` | Menu chặn gameplay, model xoay ngoài nhánh paused, menu thu nhỏ model, intro zoom kết thúc đúng transform gốc và chỉ mở input sau đó, đã bỏ nút level, CSV chỉ nhận ở menu, có đường về menu |
| `impact-feel.test.mjs` | Sóng đẩy đi ra từng vòng (yếu dần, trễ dần, vòng chỉ đánh dấu sau khi thu xong), vòng chưa tới thì khối đứng im, khói tròn trắng solid tan bằng co lại chứ không mờ, mọi nhánh `handleHit` đều bung khói, chạm sàn không giành mất phát trúng khối, đạn rơi thì nhỏ dần theo độ cao và nhả vệt theo thời gian bay (chỉ đổi cỡ vẽ, pool reset scale), nhãn hit feedback đã bị bỏ khỏi UI-engine-CSS |
| `result-screen.test.mjs` | Kết thúc màn là panel có khung chứ không phải tấm phủ, anim trồi ra bằng translateZ và cần perspective ở cha, card pop trễ sau backdrop, pháo hoa chỉ khi thắng và nằm sau panel, bảng tia tính một lần không random, lớp tia không ăn tap, và **mọi lý do thua đều có một câu copy riêng** (panel đọc theo `result.reason`, không in cứng câu batch-slot cho cả trường hợp hết đạn) |
| `loading-screen.test.mjs` | Loader là markup chứ không do JS vẽ và không có asset để tải, một string dùng cho cả bản dev và bản một file, trong template nó đứng trước bundle, bar nhảy theo mốc thật và không đi lùi (không timer, không random), xong thì rời khỏi DOM và tắt pointer-events, CSS không dựa vào token nào của app |
| `cosmetics.test.mjs` | Hai skin và fallback khi id lạ, hai rig cùng bệ và cùng chiều dài nòng còn hướng thuôn thì ngược nhau (pháo loe, nòng phép thu), đóng màn skin thì hạt của nó bị dọn theo (cả hai chiều) và recoil được reset, không khối nào trên nòng cắt mặt ổ súng trong quãng giật (`RECOIL_TRAVEL` khớp giữa hai file, độ dẹt ổ phải do `housingYScale` giải, không có `breech` trở lại), rig không có tấm phẳng (`BoxGeometry`) và mọi hình tròn đạt sàn segment theo loại, đầu đũa không mảnh dưới ngưỡng, crosshair đũa là vòng phép (toggle một chỗ, dispose trả class, trạng thái "không trúng" đổi màu thay vì xoay 45°), màn skin thay thế menu chứ không đè lên (không còn tên level/Skin/Shop/currency lòi qua) và focus trả về nút Skin sau khi menu mount lại, lưu localStorage đúng khuôn haptics, skin không chạm muzzle/không có hằng số gameplay, swap skin dispose rig cũ, đũa phép thay hẳn khói (bling bay lơ lửng vs pháo hoa rơi), sparkle chạy trong fixed-step, demo shot trong preview không chạm state, thumbnail render bằng đúng renderer và cache một lần, nút Skin mở màn không dùng modal-overlay, thẻ xem trước còn nút mới áp dụng |
| `level-handoff.test.mjs` | Nút Next level vào thẳng màn sau chứ không qua menu, entrance bật trong đúng effect dựng engine và chỉ một lần, màn mới zoom out + xoay nửa vòng trong 0,7 s, nửa vòng chạy bằng góc chứ không slerp, pháo đứng yên khi chuyển màn nhưng vẫn trồi lên khi vào từ menu, không ai giải lại hướng pháo lúc cụm còn đang bay, frame đầu của intro chỉ đặt lại đồng hồ |

Chạy: `npm test` · `npm run lint` · `npx tsc -p tsconfig.json`

---

## 7. Còn mở, cần bạn chốt

1. ~~**§2.4.3 chuỗi link**~~ — **đóng ở mục 13**, Link đã bị bỏ.
2. ~~**§2.4.2 cách hiểu**~~ — **đóng ở mục 13**, Link đã bị bỏ.
3. ~~**Barrel lồng nhau**~~ — **đóng ở mục 13**, Barrel đã bị bỏ.
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

---

## 9. Icon cho nút Skin

Nút **Skin** giờ có hình **ụ súng** thay vì chỉ có chữ: inline SVG 24×24, dựng bằng đúng ba khối mà
model trong game có — bệ ngang, ổ súng, nòng chếch lên 38° — kèm hai vòng vàng (vòng đế và vòng gần
miệng nòng) đúng như accent của khẩu pháo thật. Vẽ chứ không nạp ảnh, như mọi hình khác trong build.

Hai chi tiết đáng ghi:

- **`fill="var(--accent)"` không chạy trong presentation attribute của SVG** — `var()` chỉ resolve
  khi đến từ một khai báo CSS. Nên phần vàng mang class `hub-side-icon-accent` và màu được set trong
  `globals.css`. Có test cấm `fill="var(` quay lại trong file icon.
- **Chữ "Skin" vẫn giữ**, và icon là `aria-hidden`: tên đọc được của nút là chữ, không phải hình —
  một cái icon đứng một mình thì không nói được nó mở màn nào.

Browser tool mất kết nối đúng lúc này nên tôi **raster hoá icon bằng node** để kiểm: dựng lại đúng
phép `rotate(38 12.7 8.8)` rồi test từng điểm trên lưới 48×48 và in ra ASCII. Kết quả đo:

| | |
|---|---|
| Bounding box của mực | x 3,3–20,8 · y 2,8–21,8 (viewBox 0–24) |
| Bị cắt mép | không |
| Diện tích phủ | 31% |
| Tâm mực | 12,0 / 12,3 (tâm hộp 12/12) |

Nút **Shop** vẫn chỉ có chữ và vẫn `disabled` — đúng trạng thái thật của nó. Hai nút dùng chung một
`min-height` (58px) nên dù một cái có icon một cái không thì vẫn bằng nhau trong cột.

---

## 10. Làm lại UI kết thúc màn

Trước đây màn kết thúc là **một tấm phủ toàn khung** với nền `rgba(15,21,64,.9)` và nội dung xếp
thẳng lên đó — không có khung, không có gì đọc ra là một vật thể, và nó chỉ fade vào nên hiện ra
"từ đâu không biết".

Giờ nó là **một panel**:

- **Có khung**: `.result-card` rộng 300px, viền 2px vàng (đỏ khi thua), bo 26px, nền gradient, kèm
  bóng đổ và một vòng sáng mỏng bên ngoài. Backdrop giờ chỉ còn việc **làm tối và giữ panel ở giữa**
  — toàn bộ nội dung (medal, tiêu đề, mô tả, nút) nằm trong card.
- **Anim trồi ra theo chiều sâu**: `.result-overlay` đặt `perspective: 720px` (khối z cần một 3D
  context từ cha, thiếu nó thì cú pop xẹp thành scale phẳng), và card chạy `result-pop`:
  `translateZ(-300px) translateY(30px) scale(.82)` → vọt qua `translateZ(34px) scale(1.03)` → về
  `translateZ(0)`. Chính đường đi hình cone đó làm nó đọc ra là **trồi ra khỏi khung** chứ không phải
  hiện dần. Card pop **trễ 0,05s** sau backdrop, nên người chơi thấy nó *đang tới* thay vì đã ở đó.
- **Medal cũng có nhịp riêng**: xoay từ −24° và scale 0,3 lên, vọt 1,12 rồi về đúng −6° như cũ.
- **Pháo hoa** (chỉ khi thắng — thua thì không có gì để ăn mừng): 18 tia DOM bung ra từ **phía sau
  panel**, mỗi tia mang `--spark-angle`, `--spark-distance`, `--spark-delay`, `--spark-color` riêng
  nên **một keyframe dùng lại 18 lần** thay vì 18 keyframe. `rotate` trước rồi `translateY` sau, nên
  một góc lái cả đường bay. Bảng tia tính **một lần ở module scope**, không `Math.random` trong
  render — burst mà đổi mỗi lần re-render thì sẽ nhấp nháy. Lớp pháo hoa đặt `z-index: 0` và
  `pointer-events: none`, dưới card (`z-index: 1`), nên nó không bao giờ ăn cú tap dành cho nút.
- **Nút xếp dọc, full width** thay vì flex-wrap (trong khung 300px thì hai nút luôn bị xuống dòng lệch
  nhau). Thứ tự DOM giữ nguyên: Replay trước, Next sau — vẫn là "đường về trước, đường đi sau", và
  đó cũng là thứ tự tab.

Đo hình học của burst: tia bay xa **124–190px** từ tâm card, tức bắt đầu **nằm dưới panel** (bán kính
card 150px) rồi bay ra ngoài viền. Kiểm cả hai khổ khung — 430×860 và 360×740 — **không tia nào chạy
quá mép**, nên không bị cắt cụt.

Kiểm thêm bằng script đối chiếu **mọi tên animation trong CSS với `@keyframes` tương ứng**: 23 khối
keyframes, không có animation nào trỏ vào tên không tồn tại (một tên sai chính tả thì animation im
lặng không chạy, không báo lỗi gì).

Chưa kiểm được bằng mắt: lần này **không có browser nào khả dụng** (preview pane mất, extension Chrome
chưa kết nối), nên phần cảm giác của cú pop và mật độ pháo hoa cần bạn xem trên bản build.

### 10b. Màn kết thúc chừa ra một dải ở đỉnh khung

Overlay kết thúc màn đang là **con của `.scene-wrap`**, mà `.scene-wrap` được inset xuống dưới HUD:

```
inset: calc(max(var(--hud-inset), env(safe-area-inset-top)) + var(--hud-height) + 10px) 0 0
```

tức **14 + 92 + 10 = 116px** (còn hơn nữa nếu máy có safe area). `inset: 0` của overlay vì thế tính
từ mốc đã tụt 116px — dải HUD ở đỉnh không bị che, đúng vệt sáng trong ảnh. Kèm theo đó
`.scene-wrap` có `overflow: hidden`, nên pháo hoa còn bị cắt ở mép trên.

Sửa: đưa overlay ra làm **em của `.scene-wrap`**, ngang hàng với các dialog, để `inset: 0` tính theo
cả khung. Không cần đổi CSS.

Test cho chuyện này không kiểm được bằng regex đơn thuần (nó là chuyện **lồng nhau**), nên có một
scanner nhỏ đi qua các token `<div>`/`</div>` để tìm thẻ đóng khớp của `.scene-wrap` rồi khẳng định
overlay nằm sau đó. Và tôi chạy scanner đó trên **bản trong git** để chắc là test bắt được lỗi thật:

| Bản | Kết quả |
|---|---|
| Bản đã commit (trước khi sửa) | overlay **INSIDE** `.scene-wrap` → test đỏ |
| Bản hiện tại | overlay OUTSIDE → test xanh |

---

## 11. Màn skin: nút Select nhỏ lại, đáy model không bị tối

**Nút Select/Selected** bị bự: `min-width 168px`, `padding 13px 30px`, `font-size 16px`. Giờ là
`124px` / `9px 22px` / `13px` — khoảng **74% bề rộng và 74% chiều cao**, tức còn ~55% diện tích.
"Selected" ở cỡ chữ mới rộng khoảng 104px nên vẫn vừa trong `min-width` 124px.

**Đáy model bị tối** là do scrim của `.cosmetic-screen`, không phải do vật liệu model. Gradient cũ
ramp lên `.78` ở mốc 72% chiều cao khung, mà rig thì chiếm **26–55%** — nên phần đế nằm đúng chỗ
gradient bắt đầu tối. Đo alpha của scrim tại từng mốc:

| % chiều cao khung | Trước | Sau | |
|---|---|---|---|
| 26% | 0,12 | 0,12 | rig |
| 35% | 0,11 | 0,10 | rig |
| 45% | 0,10 | 0,07 | rig |
| **55%** | **0,34** | **0,07** | **đáy rig — chỗ bị tối** |
| 60% | 0,47 | 0,12 | nút Select |
| 68–100% | 0,68–0,94 | 0,18–0,40 | khay thẻ tự vẽ nền của nó |

Chỗ tối nhất trên dải rig: **0,34 → 0,12**, giảm 64%. Phần dưới không cần scrim nặng vì
`.cosmetic-tray` đã có nền riêng (`rgba(15,22,62,.86)`).

Có test parse **chính chuỗi gradient** trong CSS, nội suy alpha rồi khẳng định scrim ≤ 0,2 trên cả
dải 26–55%, và vẫn > 0,4 ở đỉnh để tiêu đề còn đọc được. Giá trị cũ 0,34 tại mốc 55% sẽ làm test đỏ,
nên nó bắt đúng lỗi vừa sửa.
---

## 12. Làm lại UI batch: từ nhãn đếm thành khay chứa block

Slot batch cũ là một pill cao 32px chứa **một** ô vuông 14px cộng chữ `×N`. Một cube tĩnh không phản
ánh việc batch dày lên qua từng phát bắn, và số lượng thì phải **đọc** mới biết. Nó là phần nhàm nhất
của HUD.

Giờ mỗi slot là một **khay chứa**: bao nhiêu block thì bấy nhiêu pip nằm trong khay, **không còn chữ
số nào trên màn hình**.

| | Trước | Sau |
|---|---|---|
| Vật thể | pill bo tròn | khay: vách 2px, **lip đáy 4px** |
| Nội dung | 1 cube 14px + chữ `×N` | N pip 11px, một pip là một block |
| Số lượng | đọc từ chữ số | đếm từ số pip |
| Lòng khay | tint theo màu batch (`transparent 70→86%`) | tối neutral `rgba(6,10,32,.5→.72)` |
| Màu batch nằm ở | nền + viền | viền + vành `0 0 0 3px` |
| Slot rỗng | dấu `+` | khay với 3 ổ chờ mờ |
| Chiều cao | 32px | **32px, không đổi** |

Lòng khay tối neutral là chủ ý, không phải cho đẹp: nền tint màu batch làm pip lẫn vào chính nền của
nó, mà cả 6 màu block đều phải đọc được ở 11px. Màu dời ra viền và vành sáng.

### 12.1 Pip phải tự co, vì batch có thể chứa nhiều hơn khay

5 màn hiện tại cluster lớn nhất là **6 block** (cụm R màn 1, cụm P màn 3), nhưng `level-format.ts`
cho phép tới **12** trong khung `4x3x2` — nên không thể chọn cứng một cỡ pip.

Đo trên viewport 375px: slot rộng **81,3px**, trừ vách và padding còn **67,3px** lòng khay. Nên cột
lấy từ `--pips` (JS set `count <= 6 ? count : ceil(count/2)`) và mỗi cột là `minmax(0, 1fr)` với pip
`max-width: 11px`. Pip tự nhỏ lại khi chật thay vì tràn ra ngoài:

| Số block | Cột | Hàng | Cỡ pip |
|---|---|---|---|
| 1–5 | = số block | 1 | 11px |
| 6 | 6 | 1 | 9,5px |
| 7–10 | 4–5 | 2 | 11px |
| 11–12 | 6 | 2 | 9,5px |
| 13–14 | 7 | 2 | 7,9px |

Đo cả dải **1 → 14 block**: không trường hợp nào pip vượt khỏi vách khay, theo cả trục ngang và dọc.

Hai breakpoint dễ vỡ cũng đã đo:

- **width 360px**: caption ẩn chữ "BATCH" nên slot *rộng ra* thành 100px — 12 pip vẫn 11px, không tràn.
- **height ≤ 730px**: slot xuống 28px, lòng khay còn 22px nên pip bị chặn ở 9px — 12 pip xếp 2 hàng vẫn vừa.

Vì chiều cao slot giữ đúng 32px, `--hud-height` (92px) không phải đổi và `.scene-wrap` không mất một
pixel nào.

### 12.2 Chuyển động và accessibility

Mỗi block mới rơi vào khay bằng `@keyframes pip-drop` riêng. Pip key theo index nên **chỉ viên vừa
tới** chạy animation, các viên đã nằm trong khay đứng im — trước đây cả slot nháy lại mỗi lần count
đổi.

Chữ số rời khỏi màn hình thì phải đi vào label, không thì screen reader mất thông tin: slot đầy có
`aria-label="RED batch, 3 blocks"`, slot rỗng có `aria-label="Empty batch slot"`, các pip là
`aria-hidden`. Số ít đọc đúng "1 block" chứ không phải "1 blocks".

### 12.3 Đường bay không được đứt

`handleBatchFlight` đo slot qua `[data-batch-id]` và cluster bay vào slot qua `[data-batch-slot]`.
Đổi ruột slot mà mất một trong hai thì **render vẫn đúng nhưng animation chết im lặng** — nên cả hai
attribute được giữ nguyên và có test khẳng định chúng còn trong JSX.

Tầng hình của batch trước đây là hệ thống UI duy nhất **không có test nào** (goal, result, cosmetic,
loading đều có). Thêm `tests/batch-ui.test.mjs`: 4 test chốt lại "không in chữ số", label cho screen
reader, hai mốc neo đường bay, và việc pip không thể tràn khỏi khay (test tự tính `2 × cỡ pip + gap`
phải nhỏ hơn lòng khay, nên đổi vách/lip/cỡ pip lệch nhau là đỏ ngay).

---

## 13. Bỏ mechanic Barrel và Link

Hai cơ chế của mục 5 bị bỏ hẳn khỏi source, không phải tắt bằng cờ.

| Việc | Chi tiết |
|---|---|
| `app/game/types.ts` | Bỏ `BlockSpec.barrelLayers`, `BlockSpec.linkGroup`, `BlockRuntime.barrelLeft`, `BlockRuntime.barrelShell` |
| `app/game/level-format.ts` | Bỏ cột `barrel_layers` và `links` cùng parser/validator của chúng, bỏ `MAX_BARREL_LAYERS`. Chữ thường trong `layers` giờ chỉ là block thường (parser đọc không phân biệt hoa thường) |
| `app/game/CannonSortEngine.ts` | **−25.225 ký tự.** Bỏ vỏ barrel (geometry, 3 material theo độ sâu, `peelShell`, `peelBarrelAround`, `breakBarrelsTouching`), toàn bộ nẹp link (`buildLinkBridges`, chọn mặt gắn, `updateLinkBridges` mỗi frame, `dropLinkBridge`, `claimLinkedClusters`, `coveredLinkPartner`), và điều kiện tách cụm theo biên vỏ trong `findCluster` |
| Hệ debris | Cũng đi theo: `spawnShellDebris` và `dropLinkBridge` là **hai** người dùng duy nhất của nó, nên vỏ và nẹp biến mất thì `DebrisPiece`, `updateDebris`, `addDebris` và `makePlatingTexture` thành code chết |
| Màn 4 và 5 | Xoá khỏi sheet. Chúng chỉ tồn tại để test hai cơ chế này ("Barrel test", "Link test"), nên giữ lại là giữ hai bàn chơi không còn ý nghĩa |
| Test | Xoá `tests/barrel-link.test.mjs` và `tests/link-bridge.test.mjs`, bỏ khỏi script `test` |

**Cái bẫy khi làm việc này**: `app/game/cosmetics.ts` có **46 chỗ** chứa chữ "barrel" nhưng đó là
**nòng súng** (`barrelPivot`, `barrelVisual`, `barrelBackRadius`), không liên quan gì tới vỏ bọc
block. Hai thứ trùng tên hoàn toàn. Việc xoá chỉ đi theo đúng danh sách identifier của block, và
verification có một bước riêng để xác nhận pháo vẫn còn nòng.

Kích thước bản build giảm **869.254 → 857.889 bytes**.

### 13.1 Một bug tự tiêu theo

`createBatchOrFail` đặt `id: `batch-${shotIndex}``, còn `handleHit` từng resolve cụm bị bắn **và**
cụm link cùng một `shotIndex`. Nếu cả hai bên đều phải park thì hai record mang **cùng một id**, và
`applyBatchAutoFill` tra record theo id — nó sẽ rót batch **sai màu** vào goal. Màn 5 không chạm tới
được trạng thái đó nên bug ở dạng tiềm ẩn. Bỏ Link thì một phát bắn chỉ còn đúng một claim, nên id
lại là duy nhất và không cần sửa gì thêm.

(Tôi gặp đúng lỗi này khi viết script mô phỏng: truyền `shotIndex: 1` cho mọi claim làm 10.776/20.160
thứ tự bắn của màn 1 "không thắng được". Không phải lỗi sản phẩm, nhưng nó cho thấy hậu quả của id
trùng là gì.)

---

## 14. Batch: giới hạn đổi từ 2 slot sang budget block

Giới hạn cũ đếm **record**: một batch giữ 1 block hay 12 block đều chiếm đúng một slot
(`rules.ts`, `state.batches.length >= level.batchCapacity`). Brute-force **toàn bộ** thứ tự bắn của
các màn qua chính `rules.ts` cho thấy đó là proxy sai — peak slot và peak block lệch nhau tới **4
lần**: có đường giữ 8 block trong đúng 2 slot, có đường cần 5 slot mà chỉ giữ 14 block. Luật cũ phạt
*số màu* người chơi hoãn và mù hoàn toàn với *khối lượng* hoãn: park 14 block thì sống, park 3 block
lại thua.

Thêm nữa, mục 12 đã đổi HUD sang khay đếm bằng pip = block, nên `2/2` và "12 pip" là hai đơn vị
không liên quan nằm cùng một hàng. Giờ con số và cái hình đo cùng một thứ.

### 14.1 Chọn con số 8

Tỉ lệ thứ tự bắn thắng được, brute-force đầy đủ (20.160 / 2.520 / 90 thứ tự phân biệt):

| Budget | Màn 1 | Màn 2 | Màn 3 |
|---|---|---|---|
| 4 | 19,5% | 58,6% | 86,7% |
| 6 | 41,0% | 83,3% | 100% |
| **8** | **58,9%** | **100%** | **100%** |
| 10 | 82,3% | 100% | 100% |
| 14 | 100% | 100% | 100% |
| *luật cũ (2 slot)* | *37,2%* | *58,6%* | *100%* |

**8 là giá trị nhỏ nhất không làm bất kỳ đường thắng nào hiện tại trở thành thua** — đã kiểm trực
tiếp: 0 regression trên cả ba màn. **Sàn cứng là 4**, bằng cụm lớn nhất còn lại (Y×4, B×4, G×4 ở màn
1): không gì chia một cụm ra nhiều phần trong kho, nên budget dưới cỡ cụm là một nước đi hợp lệ mà
không cách nào chơi được. Áp lực tự nhiên của ba màn trải 6→14 nên để **theo màn**: cột
`batch_blocks` với default 8, và validator ở `level-format.ts` chặn giá trị nhỏ hơn cụm lớn nhất —
cùng tinh thần `checkGoalWindows`.

### 14.2 Gộp phép chia đang bị nhân đôi

`resolveCluster` và `CannonSortEngine.createSortAnimation` tự tính `min(count, goalRemaining)` và
phần dư **một cách độc lập**, và bản engine lặng lẽ bỏ chặng batch khi hết chỗ nên một phát bắn "chết"
chỉ animate phần goal. Giờ cả hai — cộng thêm kiểm tra hợp lệ lúc ngắm — đọc **một** hàm
`planClusterSplit()` trong `rules.ts`, nên animation không thể mô tả một phép chia mà state không
ghi lại.

### 14.3 Không gộp record cùng màu

Chỉ **đơn vị đo** capacity đổi. Record vẫn tách theo shot, `batchPriority: OLDEST_FIRST_TEMP` vẫn có
nghĩa, auto-fill từng phần vẫn giữ nguyên. Đảo thêm luật non-merge sẽ là một quyết định thiết kế thứ
hai, không cần thiết cho thay đổi này.

### 14.4 Điều kiện thua: kho đầy và phát bắn không giải quyết được queue

Kho đầy **không** tự gây thua. Thua khi một phát bắn tạo ra claim mà kho không chứa nổi phần dư của
nó — nói theo hướng người chơi cảm nhận: **kho đầy mà phát tiếp theo không đưa được gì vào goal đang
mở**. Cảnh báo là hàng batch pulse ở mức đầy (đúng cái §14.4 của concept đã thiết kế), không phải một
trạng thái crosshair mới; phát bắn vẫn nổ, và hậu quả là mất màn.

Ba trường hợp, tách rõ:

| Kho | Phát bắn | Kết quả |
|---|---|---|
| còn chỗ | bất kỳ | bình thường, phần dư vào kho |
| đầy | cụm khớp goal đang mở, goal nhận hết | **không thua** — queue tiến, và nếu goal đó hoàn thành thì cascade còn rút kho xuống |
| đầy | cụm không khớp goal nào | **FAIL** `"Reserve full"` — cả claim phải vào kho, mà không còn chỗ |

Còn một ca thứ tư trên lý thuyết: cụm vừa nạp được một phần vào goal, vừa có phần dư không vừa kho.
Ca đó **quyết định bởi thứ tự transaction** (`overfillTransaction`, vẫn là câu hỏi treo trong
`final_concept.md` §20). Đã đo: nó xảy ra **0 lần** trên toàn bộ trạng thái của cả ba màn — vì cụm
của ba màn chia đúng khớp goal nên phần dư chỉ có thể là *toàn bộ* claim hoặc *không có gì*. Nên
thứ tự hiện tại (`CREATE_EXCESS_THEN_ADVANCE_TEMP`) giữ nguyên và câu hỏi treo vẫn để treo, thay vì
chốt một luật mà dữ liệu hiện tại không phân biệt được.

Cùng lượt này bỏ hẳn cơ chế "chặn phát bắn" đã dựng trước đó: crosshair không còn tra kho
(`aimReserveBlocked`, `claimFitsReserve`), `fire()` không còn cổng chặn, `handleHit` không kiểm lại
lúc va chạm, và `checkReserveDeadlock` bị xoá — không còn gì bị từ chối thì không còn dead end để
phát hiện. `jostleCluster` cũng đi theo: hai người gọi nó là nhánh link và nhánh từ chối, cả hai đã
mất.

Một chi tiết nhỏ nhưng quan trọng: `createSortAnimation` giờ **vẫn vẽ** chặng bay vào kho kể cả khi
phần dư không vừa. Trước đây nó lặng lẽ bỏ chặng đó, nên phát bắn định mệnh không có animation gì —
cụm biến mất rồi panel hiện ra. Giờ người chơi thấy đúng những khối đã làm mình mất màn.

### 14.5 HUD: giá đỡ đúng bằng budget, không còn con số nào

Thứ bị giới hạn là một tổng số block, nên có **một** vật chứa — và nó vẽ ra **đúng `batch_blocks` ô**,
luôn đủ cả ô trống. Ô đã dùng là block màu, ô trống là socket mờ cùng hình dạng. "Còn bao nhiêu chỗ"
thành thứ để **đếm**, không phải thứ để đọc.

Chip `BATCH 0/8` bị bỏ hoàn toàn: cả glyph, cả chữ, cả chữ số. Con số chỉ còn sống trong
`aria-label` của giá đỡ (`"Reserve, 3 of 8 blocks used"`), nên screen reader không mất gì.

| | Trước | Sau |
|---|---|---|
| Bên trái hàng | chip `BATCH n/8` (~109px) | không còn gì |
| Vật chứa | khay 170px, chỉ vẽ pip đã có | giá đỡ 289px, vẽ đủ 8 ô |
| Ô trống | không vẽ | socket mờ, cùng hình, không animation |
| Cỡ ô | 11px | **22px** — ngang `.cube-icon` của goal (24px) |
| Số lượng | pip đếm được | ô đếm được, cả đã dùng lẫn còn trống |

Bỏ luôn cơ chế gập hai hàng (`trayColumns`, `TRAY_SINGLE_ROW_MAX`). Hàng giờ rộng cả HUD nên một
hàng là đủ, và gập hai hàng lại **sai**: cap ô đã lên 22px, hai ô xếp dọc cần 46px trong lòng giá chỉ
26px — đúng lỗi tôi tạo ra rồi bắt được khi đo. Một cột một ô, `minmax(0, 1fr)` lo phần co.

Lòng giá còn bị kẹp `max-width: calc(var(--pips) * 34px)` và căn giữa: budget 4 mà dàn hết 289px thì
trông rỗng ngay cả khi đầy, mà hạ `batch_blocks` xuống sát sàn là việc mục 16.1 khuyên làm. Đo từ
budget 4 tới 30: luôn một hàng, ô giữ 22px cho tới khi hết chỗ rồi co xuống 7,2px ở budget 30, không
trường hợp nào tràn khỏi vách.

Giá giữ màu neutral thay vì lấy `--batch`: nó chứa nhiều màu cùng lúc nên tint vách sẽ phải chọn một
màu thắng hoặc nhoè hết — màu thuộc về ô. Mỗi ô đã dùng mang `data-batch-id` của record nó thuộc về,
nên batch bay vào goal vẫn đo được từ đúng những ô đang rời đi.

Sửa luôn một lỗi copy sẵn có: panel kết thúc màn in cứng câu "That shot needed a new batch slot but
both were taken" cho **mọi** thất bại, kể cả thua vì hết đạn. Giờ mỗi lý do có một câu riêng.

---

## 15. Sửa crash goal trùng màu (goal_split)

**Nghiêm trọng: đây là crash, không phải thua.** 48/720 thứ tự bắn hợp lệ của màn 3 làm game **throw**
`Invalid level data: active goals must use different colors`.

Nguyên nhân: `checkGoalWindows` chỉ duyệt các **cửa sổ goal liền kề**, nhưng hai slot goal tiến
**độc lập**. Với queue `purple3, orange6, red6, purple3` và 2 slot, slot 0 còn giữ goal #1 (purple)
trong khi slot 1 đi #2 → #3 → #4 (cũng purple). Validator lúc author cho qua một màn mà runtime có thể
crash.

Sửa ở runtime chứ không loại màn: `nextGoalIntoSlot` thấy goal kế tiếp trùng màu với một goal đang mở
ở slot khác thì **để slot rỗng và không tiêu index queue**, rồi thử lại mỗi khi có goal hoàn thành
(`fillWaitingSlots`). `activeGoals[slot] = null` đã là trạng thái được hỗ trợ (nhánh queue cạn) và
UI đã render `.goal-slot-empty` — không cần dựng gì mới.

Đã kiểm: **90/90** thứ tự phân biệt của màn 3 giờ đều thắng, 0 throw, và test khẳng định nhánh chờ
thực sự được đi qua (một test không bao giờ chạm nhánh đó thì không chứng minh được gì).

Trên cả ba màn, tổng cộng **22.770 thứ tự bắn** chạy qua `rules.ts`: 0 crash.

---

## 16. Điều còn mở sau thay đổi này

### 16.1 Màn 2 và màn 3 vẫn không thể thua

Đã duyệt **toàn bộ không gian trạng thái** của cả ba màn dưới luật ở mục 14.4, đếm từng nước đi khả dĩ
ở mỗi trạng thái:

| Màn | Trạng thái | Nước đi | Nước an toàn | **Nước thua** | Trạng thái có nước thua | Trạng thái không còn nước an toàn |
|---|---|---|---|---|---|---|
| 1 | 194 | 695 | 627 | **68** | 44 | **0** |
| 2 | 88 | 228 | 228 | **0** | 0 | 0 |
| 3 | 31 | 61 | 61 | **0** | 0 | 0 |

Đọc bảng này theo hai chiều:

- **Màn 1 giờ thua được** — 68 nước đi kết thúc màn, rải trên 44 trong 194 trạng thái. Nhưng cột cuối
  bằng 0 nghĩa là **không trạng thái nào hết nước an toàn**: người chơi luôn có đường đi tiếp, thua là
  do chọn sai chứ không do bị dồn vào chân tường.
- **Màn 2 và màn 3 vẫn không thể thua.** Không trạng thái nào của chúng đạt tới "kho đầy mà cụm còn
  lại không khớp goal nào". Lý do ở 16.2: cụm chia quá khớp goal, nên kho gần như không bao giờ bị dồn.
  Muốn hai màn này có sức căng thì phải sửa **dữ liệu màn**, không phải sửa luật — bật `shot_limit`,
  hạ `batch_blocks` về sát sàn 4, hoặc thiết kế cụm lệch goal. Tôi không tự chọn hộ vì ba hướng đổi
  độ khó khác nhau.

### 16.2 Kho dự trữ hiếm khi bị chạm tới

**Kho dự trữ hiếm khi bị chạm tới ở 3 màn còn lại.** Mọi cụm trong ba màn chia **đúng khớp** goal
(goal R6 ↔ hai cụm R3+R3, goal Y4 ↔ cụm Y4…), nên `excess` không bao giờ phát sinh: kho chỉ có block
khi người chơi **chủ động** bắn cụm không khớp goal. Budget 8 vì thế hiếm khi là thứ chặn họ. Muốn
budget có sức nặng thật thì cụm phải lệch goal — cần thiết kế lại dữ liệu màn, không phải sửa luật.

`outputs/final_concept.md` §10.1 vẫn ghi "Capacity tính theo số record/batch, không theo số block", và
nó **không** nằm trong danh sách "còn mở" §20 của tài liệu đó. Mục 14 đảo lại một rule đã được ghi là
chốt, nên đây là một quyết định thiết kế mới. Tài liệu đó đã lệch source từ trước (không biết gì về
sheet, cosmetic, hay khay pip) nên chỉ được đánh dấu superseded, không viết lại.

---

## 17. Weak Point & Rainbow Climax Hook (22/08)

Thay core claim “bắn trúng mặt nào cũng phá” bằng hook trong
`weakpoint_rainbow_hook.md`, đồng thời giữ nguyên transaction goal/dự trữ hiện tại. Barrel và Link
đã được loại ở mục 13 nên không quay lại dưới tên khác.

### 17.1 Weak Point là object world-space, không phải icon HUD

- Mỗi connected cluster FACE_6 cùng màu được author 1–3 điểm theo `x.y.z:FACE`.
- Bullseye gồm bốn vòng tròn dùng chung geometry/material, là child của đúng block nên xoay cùng
  model và bị geometry phía trước che thật.
- Normal và Rainbow Target Event chỉ claim khi impact đúng mặt (mục 18.1 đã bỏ điều kiện vùng bullseye). Dấu `+` vẫn
  chỉ báo trajectory chạm block/target; HUD giải thích rõ nó không xác nhận Weak Point.
- Bắn sai mặt không tạo sort transaction: cả cluster rung, đạn bật ngược rồi biến mất. Trong
  Rainbow Climax, cùng impact đó claim cluster — phase được đọc tại **thời điểm impact**.

~~Hitbox prototype rộng hơn hình: visual radius bằng 21% cạnh block, hit radius bằng 28%.~~
**Đã bỏ ở mục 18.1** — điều kiện trúng giờ là *cả mặt*, và bullseye chỉ còn là hình minh hoạ.

### 17.2 Main timer và state machine

- `round_time` đọc từ sheet; timer chỉ bắt đầu sau intro, dừng khi pause và giảm trong cả ba phase.
- Về 0 tạo FAIL `Time up` ngay; prototype tạm cho `TIME_UP` ưu tiên cùng physics step với impact.
- Event chỉ trigger một lần khi countdown đi qua `rainbow_trigger` (baseline 25 giây).
- Clock helper snap sai số IEEE-754 nên các mốc 25/8/5 giây kết thúc đúng tick 3900/480/300;
  timing lẻ không chia hết 1/60 được substep ngay tại boundary, giữ phase-at-impact chính xác.
- Row có `round_time <= rainbow_trigger` bị reject toàn bộ theo policy tạm
  `REQUIRE_ROUND_TIME_ABOVE_TRIGGER_TEMP`, thay vì tự suy diễn “event ngay lúc vào màn”.

### 17.3 Ba Rainbow Target 3D

- Target dùng mesh trụ mỏng + ba vòng màu trên world-space plane giữa cannon và model.
- Timeline baseline đúng A 0–4 s, B 2–6 s, C 4–8 s; cả 12 path normalized đã được mã hóa, gồm
  horizontal, diagonal và quadratic arc.
- Player vẫn rotate/aim/bắn model trong event. Target và block cạnh tranh bằng first physical hit;
  target ở trước sẽ giữ viên đạn, không cho xuyên tới model.
- Collision và crosshair prediction sweep chuyển động tương đối projectile–target theo đúng path;
  preview target động refresh 12 Hz để giữ phản hồi đúng mà không chạy solver nặng ở 60 Hz.
- Mỗi target có latch single-use, hit một lần cộng đúng `rainbow_reward_sec` (baseline +5 s) vào
  bank riêng và không đổi main timer. Policy prototype hiện tại: target trúng biến mất ngay bằng
  burst; tie collision chính xác ưu tiên target để kết quả deterministic.

### 17.4 Rainbow Climax và HUD

- Khi target cuối rời màn hình, Climax nhận 0/5/10/15 s theo số hit. Bank 0 được resolve atomic để
  không bật/tắt FX một frame.
- Weak Point ẩn; mọi mặt active block đều claim cluster; occlusion, first impact, goal, overfill,
  dự trữ và điều kiện thua giữ nguyên.
- Main timer và Climax timer giảm song song. Hết Climax thì marker của các block còn active hiện lại.
- Cannon đổi màu rainbow theo thời gian; background có 18 streak pháo hoa CSS nhẹ, pause cùng game.
- HUD tách ba khái niệm: main TIME, hit count + BANK ở event, và countdown CLIMAX. Nền phase đổi rõ
  nhưng particle giữ opacity thấp để không che màu block. Readout BANK/Climax là live region,
  gradient có backing tối đủ tương phản, và viewport landscape thấp không còn bị `min-height` cắt.
- Mọi result dùng chung cleanup: nhả pointer capture, trả projectile về pool, bỏ pending flight và
  tắt Target/Climax FX, tránh đạn hoặc nền rainbow đứng hình dưới result panel.

### 17.5 Level data và validator

Thêm tám cột:

`round_time`, `weak_points`, `rainbow_trigger`, `rainbow_target_count`, `rainbow_spawn_gap`,
`rainbow_target_duration`, `rainbow_reward_sec`, `rainbow_paths`.

Validator reject nguyên row nếu tọa độ không có block, face sai, trùng `coordinate+face`, cluster có
0 hoặc >3 Weak Point, path ngoài 1–12, số path lệch target count, header lạ/trùng/cũ, hay timing vi
phạm policy trên. Weak Point hướng vào ô đang có block phát warning non-fatal; nếu block che cùng
cluster FACE_6, validator nâng thành `HIGH-RISK` vì point đó không thể tự mở và cluster cần một route
Weak Point khác có thể tiếp cận.
Ba level bundled đã có lần lượt 8/8/6 Weak Point hợp lệ và cùng baseline `90/25/3/2/4/5`.

### 17.6 Build, metadata và test

- `outputs/3d-cannon-sort.html` được build lại từ source, chứa code hook và level columns mới; file
  canonical hiện 889.967 bytes và vẫn chạy offline bằng `file://`.
- Thêm social card `public/og.png` cùng metadata Open Graph/X dùng host thật của request.
- Thêm unit test cho 12 path, hit circle theo cả sáu face, phase-at-impact, timeline/bank/trigger;
  test parser atomic; test tích hợp engine/HUD/CSS; và test chính file HTML có hook/data mới.
- Kết quả cuối: **151/151 pass**, ESLint sạch, targeted TypeScript sạch và `vinext build` thành công.

### 17.7 Policy prototype còn chờ playtest/sign-off

- Wrong-face ricochet chỉ là feedback rồi despawn; hitbox bullseye rộng hơn visual 28%/21%.
- Target trúng biến mất ngay; first-contact quyết định target/block và exact tie ưu tiên target.
- Target plane tạm đặt ở world `z=0.45`; `rainbow_target_count` author được số dương bất kỳ nhưng
  baseline/UI đang tối ưu cho ba target A/B/C.
- Result trong Event/Climax kết thúc hook ngay, bỏ target/bank/FX còn lại. `TIME_UP` vẫn ưu tiên cả
  fixed step chứa mốc 0 theo policy ở trên.
- HUD hiện tại là bản cụ thể để playtest; hook vẫn dùng haptic chung theo impact/progress/result,
  chưa chốt bộ audio/haptic riêng cho từng Weak Point, wrong-face, target và chuyển phase.

---

## 18. Weak Point: mặt trong, đạn bật ra, và khiên xanh

Bốn thay đổi cho hook ở mục 17, theo yêu cầu.

### 18.1 Điều kiện trúng là cả một mặt, bullseye chỉ còn là hình minh hoạ

Trước: claim khi impact đúng mặt **và** nằm trong bán kính bullseye (visual 21% cạnh block, hit 28%).
Sau: claim khi impact **đúng mặt**, ở bất kỳ đâu trên mặt đó.

Lý do bỏ bán kính, không phải chỉ vì đơn giản hơn: ngắm một đường bay 3D vào một cái đĩa nhỏ trên
một khối đang xoay là mức chính xác mà camera **không hiển thị nổi** — và hai con số vốn không bằng
nhau, nên vòng tròn người chơi thấy chưa bao giờ là vùng thật sự được tính. Giờ luật đọc được thẳng
từ model: mặt nào có dấu thì bắn vào mặt đó.

| | Trước | Sau |
|---|---|---|
| Hàm luật | `isBullseyeHit({ localPoint, impactedFace, weakPointFace, blockSize, hitRadiusRatio })` | `isWeakPointFaceHit({ impactedFace, weakPointFace })` |
| Hằng số | `WEAK_POINT_VISUAL_RADIUS_RATIO` 0.21 + `WEAK_POINT_HIT_RADIUS_RATIO` 0.28 | chỉ còn visual 0.21, và **không** nằm trong đường tính hit |
| HUD | "Hit a bullseye to break" | "Hit a marked face to break" |

`WEAK_POINT_HIT_RADIUS_RATIO` và `LocalPoint3` bị xoá vì không còn ai đọc. Có test khẳng định module
**không** còn export tên nào chứa `HIT_RADIUS`, và `projectileHitWeakPoint` **không** được nhắc tới
`RADIUS` — nếu bán kính bò lại vào đường tính hit thì đỏ ngay.

### 18.2 Weak Point ở mặt trong

Format vốn đã cho phép: parser chỉ **cảnh báo** khi một điểm nằm trên mặt áp vào block khác, vì đó có
thể là routing không gian có chủ ý. Nên đây là thay đổi **dữ liệu màn**, không phải code.

Thêm 15 điểm mặt trong (màn 1: 7, màn 2: 4, màn 3: 4). Mỗi cluster **giữ nguyên** điểm mặt ngoài đã
có và được thêm một điểm mặt trong — chủ ý, vì hai cluster mà điểm duy nhất của chúng lại áp vào nhau
sẽ **deadlock**: không bên nào phá được bên nào.

Đã đo lại toàn bộ khả năng tiếp cận, mô phỏng đúng cách người chơi phải đi (chỉ cluster có điểm hở
mới claim được, claim xong mới mở ra điểm bên dưới):

| Màn | Cluster | Weak Point | Hở lúc bắt đầu | Bị che | Cluster bị kẹt |
|---|---|---|---|---|---|
| 1 | 8 | 15 | 8 | 7 | **0** |
| 2 | 8 | 12 | 8 | 4 | **0** |
| 3 | 6 | 10 | 6 | 4 | **0** |

Mọi cluster đều có ít nhất một đường vào ngay từ đầu, và cả ba màn dọn xong trong **một wave** — điểm
mặt trong là lối đi *thêm*, không phải cửa ải bắt buộc. Test mới khẳng định cả ba điều: có điểm bị
che, không điểm nào HIGH-RISK (áp vào cluster của chính nó), và mỗi màn còn ít nhất một điểm hở.

### 18.3 Đạn bật ra khi trúng Weak Point

Trước, phát bắn **thành công** là phát duy nhất đạn biến mất ngay (`removeProjectile`), trong khi phát
sai mặt lại có `startRicochet` bật ngược. Nghĩa là cú đánh đúng có phản hồi *yếu nhất* trong hai
loại, và đọc ra như block hút mất viên đạn chứ không phải bị phá.

Giờ cả hai đường đều gọi `startRicochet`. Có test đếm đúng **hai** call site và khẳng định
`handleHit` **không** còn `removeProjectile` — Rainbow Target thì vẫn giữ `removeProjectile` riêng
của nó, đó là hành vi khác và không bị đụng.

Kèm theo: `createSortAnimation` vẫn vẽ chặng bay vào kho kể cả khi phần dư không vừa (mục 14.4), nên
không có xung đột giữa hai thay đổi.

### 18.4 Khiên xanh khi trúng vùng không phải Weak Point

Block bị bắn sai mặt giờ khoác một lớp guard xanh dương (`0x49b8ff`) — cái người chơi game nào cũng
đọc ra là "chỗ này được bảo vệ".

- Là một `BoxGeometry` cạnh **1.16× block**, nên đọc ra là *lớp bọc quanh* khối chứ không phải đổi màu khối.
- `MeshBasicMaterial` unlit: key light của scene sẽ biến material có shading thành một tint mặt bình thường.
- Là **child của block mesh**, nên nó nhún theo đúng cú rung mà chính impact đó tạo ra, không lơ lửng ở chỗ block vừa rời đi.
- Đắp lên **block bị bắn**, không phải cả cluster: cú rung đã nói "cả nhóm này đứng vững", cái khiên nói "chỗ này".
- Bắn phát thứ hai vào cùng block thì **restart** cái flash, không xếp thêm một lớp — hai lớp sẽ nhân đôi opacity và đọc ra như một khối đặc.
- Tắt dần trong 0,44 s theo `(1 - progress) ** 1.6` và phình nhẹ 10%, nên block trông như *bị đẩy lại* chứ không phải chỉ được tô màu.
- Block bị claim thì bỏ khiên ngay, để nó không bay theo debris.

Mỗi flash có material riêng (opacity phải chạy độc lập khi nhiều block cùng có khiên) và tự
`dispose()` khi hết — có test khẳng định điểm này, vì thiếu nó là rò material mỗi phát bắn.

### 18.5 Đã kiểm được gì, và chưa kiểm được gì

Đo trong game thật, bằng probe tạm rồi xoá:

- Khiên spawn ở `opacity 0.62`, mờ xuống 0.49, scale bò từ 1 lên 1.014 — đúng đường cong đã viết.
- Bắn lại cùng block: vẫn **1** khiên. Bắn hai block khác nhau: **2** khiên cùng tồn tại. Đúng luật không-stack theo block.
- Đạn bật ra ở phát sai mặt: `ricochets` lên 1.
- 39 phát liên tiếp không claim được gì — không phải màn bị chặn, mà là chuyện **ngắm** (xem dưới).

**Chưa kiểm được trong game:** đạn bật ra ở phát **đúng** mặt. Nó là đúng cùng một lời gọi
`startRicochet`, và test chốt cả hai call site, nhưng tôi không lái được automation vào một mặt có dấu.

Lý do, và đây là điều đáng chú ý cho thiết kế màn: **envelope của pháo không với tới hàng trên của
model.** Đo bằng cách giữ joystick và quét: crosshair chỉ với được dải y ≈ 291–457 (và bão hoà ở
y = 228.8), trong khi bullseye `3.2.1:PZ` nằm ở y ≈ 246 — **ngoài tầm**. Camera lại đứng ở phía
`+z`, nên bốn điểm hở nhìn thấy được đều là mặt `PZ`; các điểm `NZ` nằm ở mặt sau. Với bán kính
rộng thì chuyện này còn tha được; với điều kiện trúng-đúng-mặt thì nó thành rào thật, và người chơi
buộc phải xoay model. Không phải bug của thay đổi này — nhưng nó vừa trở nên quan trọng hơn nhiều, và
nên được cân nhắc khi author `weak_points` ở hàng trên.

## 19. Rainbow Climax làm lại: buff một phát, đường bay tự do, bỏ timer (23/08)

Mục 17 dựng Rainbow quanh một **đồng hồ round**: countdown 90 s, đi qua mốc 25 s thì mở event, ba
target bay theo 12 đường author sẵn, mỗi hit cộng +5 s vào một *bank*, rồi vào **phase Climax** dài
0/5/10/15 s mà trong đó mọi mặt block đều phá được. Về 0 thì FAIL `Time up`.

Toàn bộ mô hình đó bị bỏ. Rainbow mới không phải một phase có thời lượng, mà là một **buff một phát**:
bắn trúng target thì **phát kế tiếp bỏ qua Weak Point của block**. Đây là thay đổi luật, không phải
đổi hình — nó xoá một điều kiện thua, xoá cơ chế trigger, và thay phase machine ba trạng thái bằng
một cờ boolean.

### 19.1 Đã chốt trước khi làm

| Điểm | Chốt |
|---|---|
| Timer | **Bỏ hẳn.** Round không giới hạn thời gian, không còn FAIL `Time up` |
| Spawn target | **Ngẫu nhiên có seed**, rải trong round |
| Cộng dồn | **Không.** Trúng 2 target vẫn 1 phát. Không hết hạn, giữ tới khi bắn |
| Tiêu buff | **Chỉ phát va vào block.** Bắn trượt / rơi sàn không mất buff |

Round giờ **không có độ dài**, nên "rải trong round" không còn khoảng nào để rải lên. Thay bằng
**khoảng cách seeded giữa các target**: target đầu ở giây `gap × (0,5…1,0)`, mỗi target sau cách
`gap × (0,5…1,5)`, tổng đúng `rainbow_target_count`. Deterministic theo seed của màn và không phụ
thuộc round dài bao lâu. Màn 1 ra lịch thật: 7,20–11,70 s · 17,59–22,09 s · 27,28–31,78 s.

### 19.2 Đường bay tự do

`RAINBOW_PATHS` (bảng 12 path) và cột `rainbow_paths` bị bỏ. Thay bằng `rainbowWanderAt(seed, progress)`:
tổng **ba sin** lệch pha/tần số lấy từ seed, nên không target nào trùng hình và không cái nào là một
đường thẳng hay một cung đơn. Tổng được **taper bằng `sin(pi·t)`**, ghim điểm vào/ra về đúng độ cao
seeded — thiếu nó thì target hiện ra đã lệch khỏi đường của chính nó, đọc ra như một glitch.

Test chốt điểm này bằng **dấu của curvature ba điểm**: một đường thẳng có sai phân cấp hai luôn bằng 0,
một cung đơn có sai phân cấp hai không đổi dấu. Đường bay phải đổi dấu cả hai chiều.

**Giữ nguyên** `rainbowTargetMotionsForInterval` + `sweepRainbowTargets` giải trong hệ quy chiếu của
target (`relativeFrom`/`relativeTo`) — đó là thứ làm cho việc bắn một mục tiêu đang bay là chính xác,
và nó không liên quan gì tới phase.

### 19.3 Dải bay phải là dải *bắn tới được*, không phải dải *nhìn thấy*

Đây là phát hiện đáng kể nhất của lượt này, và là một lỗi tôi tự tạo rồi tự bắt.

Bản đầu cho target bay ở `v` **0,26–0,72** — nghe hợp lý vì nó nằm gọn trong màn hình. Nhưng đo lại
envelope của pháo trên máy 375×812 bằng cách giữ joystick và quét: crosshair chỉ với được `y ≈ 186–453`,
tức `v ≈ 0,10–0,48`. Nghĩa là target như seed 104 (`v` 0,6–0,77) **nằm ngoài tầm bắn hoàn toàn** —
người chơi thấy nó, ngắm theo nó, và không bao giờ bắn tới được.

Chỉnh lại: entry/exit `0,16 + hash × 0,26`, clamp `WANDER_V_LOW = 0,12` / `WANDER_V_HIGH = 0,48`.
Test tên `"a flight stays inside the band the cannon can reach"` quét 60 seed × 21 mốc và chốt dải này.
Đây cũng là mặt khác của rào đã ghi ở mục 18.5: envelope pháo không với tới hàng trên của model.

### 19.4 Bia tròn 7 màu

`buildRainbowTargets()` trước dựng cylinder + 3 ring (hồng/lục lam/vàng). Giờ là **7 ring đồng tâm**
theo thứ tự quang phổ (`0xff3b45, 0xff8a1f, 0xffdf57, 0x24e07f, 0x2f9dff, 0x4b45d8, 0xb45cff`), ring
trong cùng là một `CircleGeometry` đặc, dùng chung geometry/material như cũ. Số ring là hằng số một chỗ.

### 19.5 Buff một phát

```ts
private weakPointBypassArmed = false;   // thay cho hookPhase + rainbowBankSeconds
```

- `armWeakPointBypass()` **gán `true`**, không tăng số — test chốt hàm này không được chứa `++` hay `+= 1`,
  vì đó chính là cách "không cộng dồn" bị phá trong một lần sửa sau này.
- `resolveBlockImpact(bypassArmed, faceHit)` → `CLAIM_CLUSTER` khi `bypassArmed || faceHit`.
- Đọc-rồi-tiêu nằm **cùng một chỗ** trong `handleHit`. Điều này bắt buộc vì `continuousFire` cho nhiều
  đạn bay cùng lúc: một viên rời nòng lúc còn buff có thể chạm **sau** khi viên khác đã tiêu nó. Cờ
  được đọc tại **thời điểm impact**, không phải lúc bắn — nên nếu hai viên cùng chạm trong một bước,
  chỉ viên đầu dùng được buff.
- `handleMiss` và nhánh chạm sàn **không** chạm vào cờ — test chốt điểm này.

### 19.6 Visual

| Yêu cầu | Cách làm |
|---|---|
| Pháo hoa rơi | Dùng lại `.climax-fireworks` + `@keyframes climax-fall`, đổi điều kiện render sang `bypassArmed` |
| Wave cầu vồng | Dùng lại `@keyframes rainbow-status` trên `.bypass-banner-wave` |
| Text | `.bypass-banner` — "Next shot ignores Weak Points", `role="status"` `aria-live="polite"` |
| Lớp cầu vồng ngoài ụ súng | **Đổi cách làm.** Trước là `updateRainbowCannonColors()` hue-cycle chính material của cannon — đó là *đổi màu súng*, không phải *lớp bọc*. Giờ là một `SphereGeometry(1.16)` translucent unlit, **child của `cannonRoot`** nên nhún theo recoil/aim, `CanvasTexture` cầu vồng vẽ runtime và scroll offset |
| Weak Point ẩn | `setRainbowVisualState()` đã làm đúng việc này, chỉ đổi thứ điều khiển nó sang `bypassArmed` |

**Băng buff không làm xê dịch layout.** Nó `position: absolute` ở
`top: calc(… + var(--hud-height) + 4px)`, nên `--hud-height` giữ nguyên bất kể armed hay không — nếu
nó chiếm chỗ trong `.hud-top` thì scene 3D sẽ giật mỗi lần armed.

### 19.7 Phần bỏ

- **Dải status trên cùng** (`section.hook-status`): `TIME` readout, tên phase + phụ đề, và
  `rainbow-readout` — chip `PRECISION` **chính là** phần tử này ở nhánh thứ ba, nên bỏ PRECISION và bỏ
  readout là cùng một việc. Chết theo: `formatRoundTime`, `hookPhaseLabel`, `rainbowReadoutLabel`.
- `--hud-height` **140 → 92px**, mobile **126 → 86px** (= 40 strip + 8 gap trả lại cho scene 3D), cùng
  ~22 selector của strip và `@keyframes timer-urgent`.
- **Đồng hồ round và điều kiện thua theo thời gian**: `failTimeUp`, `mainTimeRemaining`, dòng `"Time up"`
  trong `FAIL_BODY`.
- **Phase machine và bank**: `GameplayHookPhase`, `WeakPointHookPhase`, `rainbowBankSeconds`,
  `beginRainbowTargetEvent`, `finishRainbowTargetEvent`, `prepareHookRuntimeStep`,
  `finishHookRuntimeStep`, `considerBoundary`/`hookStepDelta`, và trong `rainbow-hook.ts`:
  `RAINBOW_PATHS`, `RainbowPathId`, `evaluateRainbowPath`, `createRainbowTargetTimeline`,
  `getRainbowEventDuration`, `getActiveRainbowTargets`, `advanceHookCountdown`, `advanceHookElapsed`,
  `climaxSecondsForHits`, `didCrossRainbowTrigger`, `HOOK_TIME_EPSILON_SECONDS`, `RAINBOW_BASELINE`.
  Có một test chốt **mọi tên trên đều `undefined`**, để chúng không lặng lẽ quay lại.
- **4 cột sheet**: `round_time`, `rainbow_trigger`, `rainbow_reward_sec`, `rainbow_paths` — vào
  `RETIRED_COLUMNS` (18 → 14 cột) nên sheet cũ **báo lỗi rõ** thay vì âm thầm rơi về default. Quan
  trọng vì `level-source.ts` ưu tiên đọc sheet nhúng trong file HTML đã ship.
- `updateRainbowCannonColors`, `cannonMaterialColors`, `captureCannonMaterialColors` — cache màu chỉ
  tồn tại để hoàn nguyên rig sau hue-cycle; lớp bọc nằm *trên* rig nên không có gì phải hoàn nguyên.

### 19.8 Cái bẫy: vòng lặp physics nằm trong state machine

`updateTimedGameplayStep()` **là nơi duy nhất `updateProjectile` được gọi**. Nó không chỉ đếm đồng hồ —
nó chia nhỏ fixed step tại các mốc phase rồi tích phân đạn trong từng sub-step, để một cú va chạm luôn
dùng đúng phase tại thời điểm nó xảy ra. Bỏ state machine mà không để ý là **đạn ngừng bay**.

Cách làm: giữ hàm đó làm nơi tích phân đạn, lột sạch phần đồng hồ, thành một step phẳng — tiến
`roundElapsed` → dựng motion → `updateProjectile` → `updateRainbowTargets`. **Bỏ luôn sub-step**: nó chỉ
tồn tại để giữ "phase tại thời điểm impact" chính xác, mà buff giờ là một boolean đọc tại impact, không
phải một phase có biên. Có test chốt trong engine **chỉ có đúng một** call site `updateProjectile`.

### 19.9 Hai lỗi đã sửa trong lúc làm

- **Tie-break so sánh chuỗi.** Hai target va cùng lúc thì tie-break dùng `target.id < best.target.id`,
  nên từ 10 target trở lên `"rainbow-target-10"` đứng trước `"rainbow-target-2"`. Đổi sang `spawnIndex`.
- **`3.0.0:NZ` không phải mặt trong.** Với block ở `z=0`, `NZ` hướng ra *xa* model — nó là mặt ngoài.
  Đã đổi thành `3.0.0:PZ`.

`emitHookState` trước re-render HUD ~10 lần/giây cho các giá trị UI không còn đọc (signature gồm cả
`mainTimeRemaining` làm tròn 0,1 s). `HookSnapshot` co lại còn một cờ → HUD chỉ render lại vài lần mỗi
round. Đây là lợi ích thật, không phải dọn cho đẹp.

### 19.10 Đã kiểm được gì trong game thật

375×812, lái bằng pointer event tổng hợp, closed-loop: tính vị trí target bằng đúng công thức của
`rainbow-hook.ts` rồi lái crosshair tới đó. Vị trí target trên màn **chính là** `(u·W, v·H)`, vì
`targetPlanePointAt` đặt target lên plane bằng cách nghịch đảo tia camera qua đúng pixel đó.

- Bia **7 màu**, đường bay không thẳng, và **bắn trúng được** sau khi chỉnh dải ở 19.3.
- Trúng target → banner "NEXT SHOT IGNORES WEAK POINTS" + wave, **18** hạt pháo hoa rơi, `is-rainbow-armed`
  trên `.game-frame`, lớp cầu vồng quanh ụ súng, và **không còn bullseye nào trên model** (Weak Point ẩn hết).
- `--hud-height` giữ **92px** cả khi armed → **không xê dịch layout**.
- **Phép thử có đối chứng** cho buff, cùng một điểm ngắm `(150, 258)` — một mặt `PZ` không có Weak Point
  nào author trên đó:
  - Unarmed, hai phát: `claimed=false` → đạn bật ra. Xác nhận mặt này thật sự không có dấu.
  - Armed, cùng điểm đó: `claimed=true` (RED 0 → 3) và `armedAfter=false` → buff hoạt động **và** bị tiêu.
- **Bắn trượt**: một điểm đã chứng minh là không khí (unarmed bắn vào đó không claim gì) → `claimed=false`
  và **buff còn nguyên** (`armed=true`).
- **Chơi tới 96 s: `result=null`** — không có FAIL `Time up`. Round thật sự không giới hạn thời gian.
- Breakpoint 360×780 và 375×700: `--hud-height` chuyển 92 → 86px, banner luôn cách HUD 4px, không tràn
  ngang lẫn dọc.
- Console không có lỗi của game. Hai lỗi còn lại đều là artifact của automation: `navigator.vibrate` bị
  Chrome chặn vì pointer tổng hợp không phải gesture thật, và `setPointerCapture` `NotFoundError` trace
  về `<anonymous>` — chính script tôi inject, vì pointerId tổng hợp không phải pointer đang hoạt động.

`npm test` **149/149**, `npm run lint` sạch. `npx tsc` còn 3 lỗi **có từ trước** ở `db/index.ts` và
`worker/index.ts` (thiếu type Cloudflare Workers: `cloudflare:workers`, `Fetcher`, `D1Database`) —
không thuộc file nào của lượt này.

### 19.11 Rủi ro phải nói rõ

- **Bỏ timer thì màn 2 và 3 không thể thua được nữa.** Đo ở mục 16.1: chúng có **0** nước thua trên
  toàn bộ không gian trạng thái, nên `Time up` là điều kiện thua duy nhất còn sót của chúng. Màn 1 vẫn
  thua được (68 nước, qua `Reserve full`). Bạn đã chọn phương án này sau khi tôi nêu, nên tôi làm đúng
  vậy và ghi lại — muốn hai màn đó thua được thì cần `shot_limit`, hạ `batch_blocks`, hoặc thiết kế lại cụm.
- **Mất cảnh báo hết giờ.** `.round-clock.is-urgent` là thứ duy nhất báo sắp hết thời gian; bỏ timer thì
  không còn gì để báo — nhưng cũng không còn gì để thua, nên điều này tự triệt tiêu.
- **Title trang vẫn là `3D Cannon Sort — Weak Point & Rainbow Climax`.** "Climax" giờ không còn là một
  phase nào trong luật. Test marker HTML không còn assert title (nó chốt `"Next shot ignores Weak Points"`,
  `"weak_points"`, `"rainbow_target_count"`), nên đổi title là một dòng — tôi để nguyên vì bạn chưa yêu cầu.
- **`outputs/final_concept.md` và `README.md` không hề nhắc Weak Point / Rainbow.** Hai file đó đang lệch
  source từ trước lượt này; tôi không viết lại chúng ở đây.

---

## 20. Rainbow Objective: đường thẳng, bia 3D và thời lượng 6 giây (23/08)

Rainbow Target được chỉnh lại để người chơi đọc chuyển động và phản ứng va chạm rõ hơn. Luật thưởng
không đổi: bắn trúng vẫn cấp đúng một lần bỏ qua Weak Point cho impact block kế tiếp.

### 20.1 Quỹ đạo tuyến tính

- `rainbowWanderAt(seed, progress)` được thay bằng `rainbowLinearAt(seed, progress)`.
- Seed chỉ chọn hướng trái/phải và hai đầu mút nằm trong dải cannon bắn tới được.
- Mọi điểm giữa hai đầu mút dùng nội suy tuyến tính; không còn harmonic, sine, đổi curvature hoặc
  chuyển động lượn phức tạp.
- Target vẫn bắt đầu và kết thúc ngoài khung để không pop vào/ra giữa màn hình.
- Swept collision vẫn dùng segment target đi qua trong từng fixed step, nên đổi visual path không làm
  giảm độ chính xác của first-contact giữa projectile, target và block.

### 20.2 Bia là model 3D có chiều sâu

- Thân bia dùng `CylinderGeometry` dày `0.30 world unit`, thay cho đĩa mỏng `0.13` trước đó.
- Thêm vành `TorusGeometry` ở cả mặt trước và mặt sau.
- Bia nghiêng nhẹ `±0.14 rad` theo seed để cạnh bên và chiều sâu vẫn đọc được khi nó hướng về camera.
- Bảy vòng màu ở mặt trước được giữ nguyên; collider vẫn là sphere bao phủ toàn bộ silhouette để
  thao tác bắn không trở nên khó hơn vì phần trang trí mới.

### 20.3 Impact animation

Trước: target đặt `visible=false` ngay trong `handleRainbowTargetHit`, nên quả bóng chạm vào một hình
biến mất tức thời.

Giờ: target khóa `hit` ngay để không thể nhận thưởng lần hai, nhưng giữ hình trong `0.46 s`:

1. Lưu position, quaternion và hướng velocity của projectile tại impact.
2. Nén chiều sâu, nở nhẹ hai trục mặt bia.
3. Đẩy bia `0.32 world unit` theo hướng bay của bóng và thêm wobble giảm dần.
4. Thu nhỏ bia ở cuối animation rồi mới ẩn.

Projectile vẫn dừng ở Rainbow Target và buff vẫn được arm ngay tại impact; animation chỉ là feedback,
không trì hoãn gameplay transaction.

### 20.4 Duration 6 giây

- Default `rainbow_target_duration`: `4.5 → 6` giây.
- Cả ba level bundled và hai sheet authoring `.tsv/.csv` đều ghi `6` rõ ràng.
- Spawn gap giữ `12` giây và target count giữ `3`; thay đổi này chỉ cho mỗi bia thêm thời gian xuất hiện.

### 20.5 Regression coverage

- Pure test chốt quỹ đạo có second difference bằng `0` trên cả `u` và `v`.
- Test chốt target luôn nằm trong dải cao có thể bắn tới và vẫn đi từ ngoài cạnh này sang ngoài cạnh kia.
- Source regression chốt body có depth, hai rim, hit không ẩn tức thì và impact có push/wobble/compression.
- Sheet regression chốt baseline mới `3 / 12 / 6`.

Kết quả sau khi rebuild:

- `npm test`: **150/150 pass**.
- `npm run lint`: sạch.
- `npm run build`: thành công; chỉ còn warning chunk lớn có từ bundle Three/React hiện tại.
- `outputs/3d-cannon-sort.html`: đã bundle lại từ source mới, `883848 bytes`, chứa ba level duration `6`.
- `npx tsc --noEmit`: vẫn chỉ có ba lỗi ambient Cloudflare đã tồn tại trước lượt này
  (`cloudflare:workers`, `Fetcher`, `D1Database`), không phát sinh lỗi gameplay mới.

---

## 21. Rainbow hitbox rộng hơn và Weak Point dùng vết nứt (23/08)

### 21.1 Rainbow Objective dễ bắn trúng hơn

- Bán kính model bia giữ `0.46 world unit`.
- `RAINBOW_TARGET_COLLIDER_RADIUS`: `0.50 → 0.65`.
- Swept collision vẫn cộng `PROJECTILE_RADIUS = 0.15`, nên bán kính va chạm hiệu dụng tăng
  `0.65 → 0.80 world unit` — rộng hơn khoảng `23%` so với trước.
- Aim prediction và projectile runtime cùng đọc một constant, vì vậy dấu `+` và kết quả bắn thật
  không bị lệch nhau.
- First physical contact với block vẫn giữ nguyên; thay đổi chỉ mở rộng vùng bắt target, không thêm
  target-priority rule.

Mức `0.65` được chọn để có vùng đệm rõ quanh vành bia nhưng không biến target nằm giữa cannon và model
thành một vật cản chiếm phần lớn màn hình.

### 21.2 Weak Point đổi từ bullseye sang vết nứt

Marker block cũ dùng bốn `CircleGeometry` đồng tâm, dễ làm người chơi hiểu rằng phải bắn trúng đúng
bán kính của bullseye dù luật hiện tại tính **toàn bộ mặt**.

Marker mới:

- Dùng một `BufferGeometry` bất quy tắc gồm 12 nhánh nứt và một chip nhỏ ở tâm.
- Hai lớp geometry dùng chung cho mọi Weak Point: outline xanh-trắng rộng phía dưới và lõi xanh đen
  phía trên, để đọc được trên cả sáu màu block.
- Không còn `CircleGeometry` hoặc `RingGeometry` trong `buildWeakPoints()`.
- Footprint presentation tăng từ `0.21 → 0.32` cạnh block để hình vết nứt dễ nhận ra trên mobile.
- Vẫn parent trực tiếp vào block và xoay theo normal của mặt được author.
- Hit test không đọc geometry hoặc kích thước decal; `isWeakPointFaceHit` vẫn chỉ so sánh
  `impactedFace === weakPointFace`.

### 21.3 Regression coverage

- Test chốt collider Rainbow là `0.65`, lớn hơn model `0.46`, và swept collision cộng bán kính bóng.
- Test chốt Weak Point dựng từ crack mesh, có hai lớp, không còn primitive vòng tròn.
- Test chốt kích thước decal `0.32` chỉ là presentation và toàn bộ mặt vẫn là vùng hit.

Kết quả sau khi rebuild:

- `npm test`: **151/151 pass**.
- `npm run lint`: sạch.
- `npm run build`: thành công; warning chunk lớn không thay đổi.
- `outputs/3d-cannon-sort.html`: đã bundle lại, `884580 bytes`.
- `npx tsc --noEmit`: vẫn chỉ có ba lỗi ambient Cloudflare cũ
  (`cloudflare:workers`, `Fetcher`, `D1Database`).

---

## 22. Rainbow Objective bay chậm hơn: duration 7 giây (23/08)

- Default `rainbow_target_duration`: `6 → 7` giây.
- Cả ba level bundled và hai sheet authoring `.tsv/.csv` đều đổi sang `7`.
- Quỹ đạo vẫn là cùng một đoạn thẳng và đi cùng quãng đường, nên tốc độ trung bình giảm khoảng `14.3%`.
- Target count `3`, spawn gap `12 giây`, hitbox `0.65` và impact animation `0.46 giây` giữ nguyên.
- Regression test cập nhật baseline thành `3 / 12 / 7` và chốt mỗi spawn window tồn tại đúng `7 giây`.

Kết quả sau khi rebuild:

- `npm test`: **151/151 pass**.
- `npm run lint`: sạch.
- `npm run build`: thành công.
- `outputs/3d-cannon-sort.html`: đã bundle lại, `884580 bytes`, cả ba level dùng duration `7`.

---

## 23. Làm mới vết nứt Weak Point và mở rộng hitbox Rainbow (23/08)

### 23.1 Vết nứt nổi bật và có chiều sâu hơn

- Bỏ bố cục nhánh đều dễ đọc thành biểu tượng; marker mới có một khe nứt chéo chính cùng các nhánh
  phụ mọc bất đối xứng.
- Mỗi đoạn được dựng thành trapezoid có độ rộng đầu/cuối riêng, thuôn dần tới `0.002` ở ngọn để
  không còn đầu nứt vuông, cụt.
- Thêm hốc vỡ bảy đỉnh và ba mảnh tam giác tách rời để mặt block trông như vật liệu thật sự bị phá.
- Ba lớp dùng chung cho mọi marker:
  - glow cam `0xff7a18`, additive và opacity `0.28`;
  - rãnh tối `0x160906` để giữ tương phản trên block sáng;
  - lõi vàng nhạt `0xfff0ad` để đọc rõ trên block tối.
- Tông cam–vàng phân biệt Weak Point với effect khiên xanh của cú bắn sai mặt.
- Footprint presentation tăng `0.32 → 0.37` cạnh block. Đây vẫn chỉ là hình chỉ dẫn; hit rule vẫn
  tính toàn bộ mặt được author.
- Mỗi marker có góc xoay trong khoảng `±0.35 rad`, có thể mirror theo trục X và dùng seed từ tọa độ/
  face, nên đa dạng nhưng giữ nguyên giữa các lần chơi.
- Chỉ lớp glow pulse nhẹ theo phase riêng; rãnh và lõi đứng yên để vết nứt vẫn bám chắc vào bề mặt,
  không tạo cảm giác cả icon đang phồng lên.

### 23.2 Rainbow Objective dễ bắn trúng hơn

- Bán kính model nhìn thấy giữ `0.46 world unit`.
- `RAINBOW_TARGET_COLLIDER_RADIUS`: `0.65 → 0.80`.
- Cộng với `PROJECTILE_RADIUS = 0.15`, bán kính swept collision hiệu dụng tăng `0.80 → 0.95 world unit`.
- Crosshair raycast, aim prediction và collision khi projectile bay đều dùng cùng constant; vùng báo
  ngắm được và vùng trúng thật không lệch nhau.
- Quỹ đạo linear, duration `7 giây`, model 3D và impact animation giữ nguyên.

### 23.3 Regression coverage và bundle

- Test chốt geometry có nhánh taper, hốc/mảnh vỡ, ba lớp tương phản, biến thể deterministic và chỉ
  pulse riêng glow.
- Test chốt collider `0.80`, effective radius `0.95`, đồng thời kiểm tra cả aim raycast và hai nhánh
  swept collision đều dùng bán kính mới.
- `npm test`: **151/151 pass**.
- ESLint: sạch trên toàn bộ source, test và tooling của project (loại các thư mục artifact/cache).
- `npm run build`: thành công; chỉ còn warning chunk lớn có từ bundle Three/React hiện tại.
- `outputs/3d-cannon-sort.html`: đã bundle lại từ source mới, `885901 bytes`.
- `npx tsc --noEmit`: vẫn chỉ có ba lỗi ambient Cloudflare đã tồn tại trước lượt này
  (`cloudflare:workers`, `Fetcher`, `D1Database`), không phát sinh lỗi gameplay mới.

---

## 24. Weak Point trở lại bullseye và level có nhịp mở khóa (23/08)

### 24.1 Bullseye dùng chung logo với Rainbow Target

Thiết kế vết nứt ở mục 23 được thay thế hoàn toàn theo feedback mới:

- Weak Point trở lại dạng bullseye phẳng, world-space và vẫn parent vào đúng mặt block.
- Tách `createSpectrumRingGeometries()` để Weak Point và mặt trước Rainbow Target dùng chính xác cùng
  bảy vòng màu `RAINBOW_RING_COLORS`.
- Bullseye block có thêm viền trắng `0xf4ecff`; sáu `RingGeometry` và một `CircleGeometry` tạo tâm kín.
- Geometry/material được tạo một lần rồi dùng chung cho mọi Weak Point, không cấp phát theo từng block.
- Bỏ toàn bộ crack mesh, chip, glow, xoay/mirror và pulse animation của mục 23.
- Footprint presentation giảm `0.37 → 0.32` cạnh block để đĩa tròn có khoảng thở ở bốn cạnh.
- Hit rule không đổi: bullseye chỉ minh họa mặt cần bắn; impact ở bất kỳ vị trí nào trên đúng mặt đó
  vẫn phá được cluster.

### 24.2 Từ marker tùy chọn sang reveal route có chủ đích

Trước lượt này, cả ba level đều có một Weak Point lộ sẵn cho **mọi** cluster. Các Weak Point nằm giữa
hai block chỉ là marker phụ, nên người chơi không thật sự cần phá blocker để mở đường.

Level data mới áp dụng nhịp sau:

- Chính xác **một Weak Point cho mỗi FACE_6 cluster**, giảm nhiễu và làm mỗi vị trí có ý nghĩa.
- Mỗi level chỉ có **hai cluster reachable lúc bắt đầu**, khớp đúng hai goal đang hiển thị.
- Những Weak Point còn lại nằm trên mặt trong và được mở theo từng wave ngắn sau khi một cluster liên
  quan rời đi.
- Dependency luôn khác màu, không tự che trong cùng cluster và không tạo vòng khóa.
- Level 1 và 3 giữ route thỏa mãn liên tục, có thể hoàn thành mà không dùng reserve; Level 2 mới đặt
  đúng một reasoning beat bắt buộc sau bốn cluster thuận goal.
- Ở beat đó, Weak Point Red phía sau bị Yellow che. Goal đang là Green + Red nhưng không còn cluster
  cùng màu nào reachable, nên người chơi phải phá Yellow ×2, tạm gửi hai block vào reserve, rồi phá
  Red vừa lộ. Khi goal Yellow mở, batch đã gửi tự xả và route trở lại nhịp thuận ngay.
- Không level nào cần Rainbow bypass để giải được.

Reveal waves đã author:

- Level 1: `Red + Green → Red + Orange → Yellow → Purple + Blue → Orange`.
- Level 2: `Red + Blue → Blue + Yellow + Green → Green + Yellow → Red`.
- Level 3: `Purple + Orange → Orange + Red + Red → Purple`.

`work/levels.tsv`, `work/levels.csv`, bundled sheet và `level-01.ts` đã được đồng bộ với cùng tọa độ.

### 24.3 Validator và regression coverage

- Thêm `auditWeakPointRoutes()` để tính các reveal wave từ face và block đang che.
- Parser cảnh báo nếu một màu goal mở đầu không có cluster reachable ngay.
- Parser phát hiện cả vòng khóa khác màu kiểu A che B/B che A, thay vì chỉ cảnh báo mặt bị che bởi
  chính cluster của nó.
- Regression chốt mỗi shipped cluster có đúng một marker, hai lựa chọn đầu khớp active goals, mọi
  dependency đều reachable và có tối thiểu ba nhịp reveal.
- Test duyệt toàn bộ state graph và tối thiểu hóa số lượt off-goal: Level 1/3 có minimum `0`, riêng
  Level 2 có minimum `1`, nên reasoning beat không thể bị né bằng một thứ tự bắn khác.
- Ba canonical route được chạy qua transaction thật và đều kết thúc `WIN/allClear`: Level 1/3 giữ
  reserve `0`; Level 2 lên đúng `2/8` ở lượt Yellow bắt buộc rồi tự xả về `0` ngay sau lượt Red.
- Test visual chốt Weak Point và Rainbow Target gọi cùng helper bullseye, không còn symbol crack/pulse.

Kết quả sau khi rebuild:

- `npm test`: **153/153 pass**.
- ESLint: sạch trên toàn bộ source, test và tooling của project (loại các thư mục artifact/cache).
- `npm run build`: thành công; chỉ còn warning chunk lớn có từ bundle Three/React hiện tại.
- `outputs/3d-cannon-sort.html`: đã bundle lại từ source và sheet mới, `884530 bytes`.
- `npx tsc --noEmit --incremental false`: vẫn chỉ có ba lỗi ambient Cloudflare đã tồn tại trước lượt này
  (`cloudflare:workers`, `Fetcher`, `D1Database`), không phát sinh lỗi gameplay mới.

---

## 25. Logo Weak Point đúng key art và tutorial ba concept (23/08)

### 25.1 Weak Point dùng màu logo target của block

- Tách lại hai hệ nhận diện: bia Rainbow bay tiếp tục dùng spectrum bảy màu, còn Weak Point trên
  block dùng target mark trong key art của game.
- Marker mới gồm hai vòng trắng `0xffffff`; tâm và khoảng trống trong logo trong suốt để màu block
  tự trở thành nền.
- Thêm hai keyline navy `0x10152f` mảnh phía sau để logo vẫn nổi trên block Yellow/Orange mà không
  biến thành một bullseye cầu vồng khác.
- Geometry/material vẫn được dùng chung cho mọi marker và parent trực tiếp vào đúng mặt block.
- Luật hit không đổi: toàn bộ mặt được author là Weak Point; bán kính của logo chỉ có tác dụng minh họa.
- Bia Rainbow 3D, hitbox mở rộng, đường bay linear, duration 7 giây và impact animation giữ nguyên.

### 25.2 Ba bài tutorial độc lập

Thêm nút **Tutorial** ở hub và ba bài học chạy trực tiếp trên engine thật:

1. **Cannon & 3D model** — chỉ hiện model, cannon, vùng input/crosshair và coach card. Người chơi phải
   kéo xoay đủ quãng đường, kéo ngắm đủ biên độ rồi thả để bắn. Goal, Reserve, Weak Point, Rainbow,
   toolbar và result UI đều không được render.
2. **Sort & reserve** — chỉ mở Goal + Reserve. Route bắt buộc `Red → Blue → Red`: Red đầu tiên tiến
   Goal, Blue được giữ trong Reserve, Red cuối hoàn tất Goal và kích hoạt Blue auto-fill. Weak Point
   và Rainbow không được tạo.
3. **Weak Point & Rainbow Climax** — ẩn Goal + Reserve, mở marker Weak Point. Sau khi phá đúng mặt Red,
   ba Rainbow Target mới bắt đầu bay; trong bước chờ target mọi block đều được bảo vệ. Hit target sẽ
   arm Climax, sau đó cú bắn Blue trên bất kỳ mặt nào tiêu một charge và hoàn tất bài.

Mỗi bước được khóa bằng event gameplay thật (`MODEL_ROTATED`, `AIM_DRAGGED`, `SHOT_FIRED`, tiến độ
sort/batch, Weak Point clear, Rainbow hit và bypass used), nên người chơi không thể bấm Next để bỏ qua
concept hoặc hoàn tất bước bằng thao tác sai thứ tự. Coach card, step dots, gesture ghost và focus
animation chỉ hướng dẫn phần đang học; overlay không chặn drag vào engine.

Ba `LevelConfig` tutorial có ID `9001–9003`, nằm riêng trong source và không được chèn vào
`work/levels.tsv`, vì vậy campaign, sheet import và validator của level designer không bị thay đổi.
Các engine option dùng cho tutorial đều có default giữ nguyên hành vi campaign.

### 25.3 Regression coverage và bundle

- Thêm test reducer/action order, ma trận UI của ba chapter, color gate, inventory/config và việc các
  ID tutorial không xuất hiện trong campaign sheet.
- Chạy transaction thật xác nhận route `Red → Blue vào Reserve → Red → Blue auto-fill` kết thúc
  `WIN/allClear` và Reserve trở về `0`.
- Test source chốt UI không liên quan bị loại khỏi DOM, Rainbow chỉ bật sau bước Weak Point, campaign
  giữ default engine cũ và HTML offline chứa đủ ba tutorial cùng sheet chính xác.
- `npm test`: **160/160 pass**.
- ESLint: sạch trên toàn bộ source, test và tooling của project (loại các thư mục artifact/cache).
- `npm run build`: thành công; chỉ còn warning chunk lớn từ bundle Three/React hiện tại.
- `outputs/3d-cannon-sort.html`: đã bundle lại, **901.431 bytes**, gồm 3 campaign level và 3 tutorial.
- `npx tsc --noEmit --incremental false`: vẫn chỉ có ba lỗi ambient Cloudflare đã tồn tại trước lượt này
  (`cloudflare:workers`, `Fetcher`, `D1Database`), không phát sinh lỗi gameplay mới.

## 26. Tutorial làm lại: dạy đúng một luật, và không che chỗ chơi (23/08)

Ba vấn đề, và vấn đề đầu là vấn đề thật sự nghiêm trọng — không phải chuyện hình.

### 26.1 Tutorial cũ dạy sai luật rồi tự phủ định

`tutorialPresentation` cũ trả về `allowAnyBlockFace: chapter <= 1` và `showWeakPoints: chapter === 2`.
Nghĩa là:

| Lesson | Bullseye trên block | Bắn mặt nào cũng phá |
|---|---|---|
| 1. Controls | **không** | **có** |
| 2. Sort & Reserve | **không** | **có** |
| 3. Weak Point | có | không |

Người chơi bắn hai lesson đầu với luật "chỗ nào cũng được", rồi lesson 3 hiện bullseye ra và đổi luật.
Đó không phải dạy tuần tự — đó là dạy một luật **không tồn tại trong game**, rồi buộc người chơi phải
*quên đi*. Campaign chưa bao giờ cho bắn mặt bất kỳ.

Giờ cả ba lesson đều `allowAnyBlockFace: false` và `showWeakPoints: true`. Có test quét cả ba chương
để chốt điểm này, vì nó là loại thứ dễ bị nới lại cho "dễ vào" rồi tái lập đúng cái bẫy cũ.

Kéo theo là phải author `weak_points` cho hai level tutorial đầu:

- **Lesson 1** (`controls`): cặp vàng và cặp đỏ có mark ở mặt `PZ` — mặt hướng về người chơi, nên phát
  đầu tiên không cần khéo. Cặp **xanh nằm sau cặp vàng**, nên mark của nó đặt ở `NZ` — mặt sau. Đây là
  điều làm cho bước "xoay model" **có việc để làm**: xoay để *tìm mark*, thay vì xoay vì được bảo xoay.
- **Lesson 2** (`sort-batch`): một hàng ba block, cả ba mark đều `PZ`. Lesson này nói về *cụm đi đâu*,
  không phải về tìm mặt, nên mark không được thêm độ khó nào.
- **Lesson 3**: đỏ được thêm mark thứ hai (cả hai block đều `PZ`) để bước "Hit the mark" không đòi ngắm
  chính xác. Xanh **giữ đúng một mark ở `NX`** — mặt bên. Đó chính là lý do bypass đáng giá: nếu xanh
  cũng có mark ở mặt trước thì bước bypass chỉ là một lối tắt cho cú bắn đã sẵn có.

Thứ tự dạy giờ là: *luật* (mark) → *đích đến* (goal/reserve) → *ngoại lệ* (bypass). Lesson 3 dạy một
ngoại lệ của luật người chơi đã biết, chứ không phải lật lại luật.

### 26.2 Chrome tutorial không còn che chỗ chơi

Cũ: một `header` cao 48px ở trên, một `tutorial-coach` card ở dưới cao ~120px, và HUD bị đẩy xuống
`top: 82px` để tránh header. Card dưới **che hẳn ụ súng** — đúng thứ mà lesson 1 đang dạy người chơi dùng.

Mới, theo hướng bạn đề xuất: **màn đen mờ + khoanh vùng + text + mũi tên**.

- **Scrim và vòng khoanh là cùng một element.** `.tutorial-spot` là một hình có
  `box-shadow: 0 0 0 2000px rgba(4,7,26,.72)` — spread lớn hơn frame, nên nó tự tô tối mọi thứ *bên
  ngoài* nó. Cái lỗ là lỗ thật, không phải một vùng sáng hơn vẽ đè lên một lớp phủ.
- **Lỗ mang hình của thứ nó soi.** Vòng tròn cho vùng trong scene; **bo góc** cho phần tử HUD. Bản đầu
  tôi dùng vòng tròn cho tất cả và thanh reserve (rộng 343, cao 32) cần bán kính 116 để chứa — vòng đó
  **nuốt luôn hàng goal phía trên**. Đo được, sửa được.
- **Cue là một pill**: pictogram + 3–4 chữ + 3 dot bước, kèm **mũi tên chỉ ngược về vòng**. Nó tự đặt
  **phía đối diện** vòng so với giữa frame (`is-below` / `is-above`), nên không bao giờ nằm lên thứ nó
  đang chỉ.
- **Tiến độ tổng** là 3 đoạn cao **3px** sát mép trên, kiểu story. **Nút ✕** ngồi đúng ô mà bánh răng
  settings dùng trong màn thật. Cả hai **không đẩy gì cả** — `.hud-top` giữ nguyên vị trí bình thường,
  và rule `.game-frame.is-tutorial:not(.is-tutorial-no-hud) .hud-top { top: 82px }` bị xoá.
- Lesson ẩn HUD thì trả lại luôn dải 92px đó cho scene 3D, thay vì để trống chỗ cho một thanh không có.

### 26.3 Vị trí vòng khoanh phải **đo**, không được đoán

Đây là phần tốn công nhất và đáng ghi lại.

Goal card và thanh reserve có vị trí phụ thuộc `--hud-height` và safe-area, nên chúng được
`getBoundingClientRect()` thật. Nhưng model nằm trong **canvas** — không có element nào để đo. Bản đầu
tôi dùng phân số chiều cao scene (`0.20`, rồi `0.24`). Đo lại trong game: tâm cụm ở `y ≈ 272` còn vòng
ở `y = 206` — **lệch ~70px**, vì camera không đóng khung cụm ở giữa scene.

Nên engine có thêm `modelScreenBounds()`: chiếu **tám góc** của `Box3` bao các block đang active qua
`camera.project()`. Chính xác ở mọi kích thước màn hình, và **đổi theo model khi nó xoay** — nên vòng
được cập nhật bằng rAF trong lúc bước "Find the mark" đang chạy, chỉ `setState` khi lệch quá 1px. Đo
trong game: vòng là 272px ở lesson 1, và co còn **200px** ở bước cuối lesson 3 khi chỉ còn cặp xanh.

Chiếu tám góc, không phải hai, vì điểm rộng nhất trên màn của một cụm đã xoay không nhất thiết là một
trong hai góc dựng nên cái box.

Riêng `.aim-zone` thì ngược lại: nó **quá lớn** (375×351) — viền theo nó thì chẳng làm tối gì và chẳng
chỉ vào đâu. Nên giữ **tâm đo được** của nó và vẽ một vòng 224px lên ụ súng.

### 26.4 Bỏ wall of text, dùng pictogram

`TutorialStepCopy` cũ có `title` + `body` + `hint` — ba dòng chữ mỗi bước, ví dụ *"Drag directly across
the blocks. Turn the puzzle to inspect faces that the camera cannot see yet."* Giờ mỗi bước là:

| | |
|---|---|
| `glyph` | Pictogram vẽ bằng **inline SVG** trên lưới 24×24, ăn `currentColor` |
| `caption` | **3–4 chữ**, là *tên* của pictogram chứ không phải câu |
| `described` | Câu đầy đủ, **chỉ dành cho screen reader** qua `aria-label` |

Chín pictogram: `rotate` (mũi tên vòng trên một khối), `drag`, `release`, `goal` (khối → khay đích),
`reserve` (khối → khay chờ), `autosort`, `mark` (khối có bullseye), `rainbow` (bia nhiều vòng),
`bypass` (bullseye bị gạch). Vẽ bằng path, **không phải emoji** — emoji render khác nhau trên từng nền
tảng — và **không fetch asset**, vì bản offline không được phép.

Đây là chỗ tôi cố ý không cắt: xoá chữ khỏi màn hình mà xoá luôn khỏi accessibility tree thì screen
reader chỉ còn nghe "Find the mark" mà không biết phải làm gì. Câu vẫn còn, chỉ là không hiện. Test
chốt cả hai chiều: caption phải 2–4 chữ và ≤24 ký tự, `described` phải dài hơn caption, và ba field
`title`/`body`/`hint` phải **không còn tồn tại**.

Chữ trên tay chỉ (`DRAG TO ROTATE` / `DRAG & RELEASE`) cũng bỏ — caption đã nói điều đó rồi, tay chỉ
lo diễn tả động tác.

### 26.5 Từng bước soi vào đâu

| Lesson | Bước | Vòng khoanh | Caption |
|---|---|---|---|
| 1 | 1 | Cụm block (chiếu thật, theo model xoay) | Find the mark |
| 1 | 2–3 | Ụ súng (tâm `.aim-zone`, vòng 224px) | Drag to aim → Release to fire |
| 2 | 1 | Hàng goal (bo góc, khít) | Match the goal |
| 2 | 2 | Thanh reserve (bo góc, khít) | No match waits |
| 2 | 3 | Hàng goal | Reserve auto-sorts |
| 3 | 1 | Cụm block | Hit the mark |
| 3 | 2 | Dải bay của Rainbow Target | Hit the rainbow |
| 3 | 3 | Cụm block còn lại | Now any face |

Lesson xong thì **scrim tắt hẳn** — hiện một tick và một nút (`Next` / `Finish`), không có đoạn văn nào
giải thích rằng nó đã xong.

### 26.6 Đã kiểm được gì trong game thật

375×812, lái bằng pointer event tổng hợp, chạy trọn cả ba lesson:

- **Lesson 1**: vòng model `272×272` bo `50%`, cue **below**; xoay quá ngưỡng → `Drag to aim`, vòng
  chuyển sang ụ súng `224×224`, cue **above**; kéo rồi nhả → `Release to fire` → hoàn thành.
- **Lesson 2**: `Match the goal` vòng bo góc `311×72` ở `y=4` (hàng goal); bắn đỏ →
  `No match waits`, vòng `311×52` ở **`y=64`** (thanh reserve — phần tử khác, đo đúng); bắn xanh →
  `Reserve auto-sorts` về `311×72`; bắn đỏ còn lại → hoàn thành.
- **Lesson 3**: `Hit the mark` vòng `242×242`; bắn mặt có mark của đỏ → `Hit the rainbow` (nên
  `WEAK_POINT_CLEARED` chạy đúng với mark mới); trúng Rainbow Target ở `p=0.50` → `Now any face`,
  **banner armed**; bắn xanh ở mặt **không có dấu** → claim được, **banner tắt** (bypass bị tiêu), nút
  đổi thành `Finish →`.
- **Bullseye hiện từ lesson 1**, và ở lesson 3 nhìn thấy rõ **đỏ có mark, xanh không** — đúng cái làm
  cho bước bypass có nghĩa.
- Breakpoint **375×700** và **360×780**: cue nằm trọn trong frame, rail không chạm nút ✕, không tràn
  ngang. Vòng model tự co theo cụm (`239px` ở màn 700, `262px` ở màn 780, `200px` khi chỉ còn cặp xanh).
- Tab sạch: console **không có lỗi của game**. Còn lại là artifact automation (`navigator.vibrate` bị
  Chrome chặn vì pointer tổng hợp không phải gesture thật, và `setPointerCapture NotFoundError` trace về
  `<anonymous>` — script tôi inject).

`npm test` **160/160**, `npm run lint` sạch. `npx tsc` vẫn 3 lỗi **có từ trước** ở `db/index.ts` và
`worker/index.ts` (thiếu type Cloudflare Workers).

### 26.7 Hai điều đáng nói

- **Bước "Hit the rainbow" chỉ khoanh được *dải bay*, không khoanh được chính target.** Target bay tự do
  qua cả chiều ngang màn hình; một vòng bám theo nó sẽ là một vòng chạy loạn khắp màn. Vòng hiện tại đặt
  ở giữa dải bay, tức "để mắt ở đây". Nếu muốn bám sát thì cần một API tương tự `modelScreenBounds()`
  cho target đang active — làm được, nhưng tôi không tự mở rộng phạm vi.
- **Lesson 1 vẫn có ba goal và hai reserve slot trong level config** mà chương đó cố tình ẩn HUD, nên
  người chơi phá cụm mà không thấy nó đi đâu. Đúng ý đồ (chưa dạy tới), nhưng nghĩa là lesson 1 có thể
  kết thúc với reserve đầy mà không ai biết — không thành vấn đề vì lesson kết thúc ngay sau phát đầu.

## 27. Năm màn đầu theo đường cong onboarding của game puzzle (24/08)

Trước lượt này màn 1 là `Prism 4x3x2`: 24 block, 6 màu, 8 cụm, 5 đợt blocker. Đó là một màn giữa
game đứng ở vị trí màn đầu. Giờ năm màn đầu đi theo đúng đường cong quen thuộc của game puzzle:
giới thiệu → biến thể → mở rộng → kết hợp → tốt nghiệp.

### 27.1 Năm màn, mỗi màn một việc

| # | Tên | Hình | Block | Dạy điều gì | Bonus |
|---|---|---|---|---|---|
| 1 | First contact | 2x2x1 | 4 | Bắn vào mark → cụm bay vào goal. Hai mark hướng thẳng người chơi, hai goal đều mở, không có gì để cất | 0 |
| 2 | Turn to look | 2x2x1 | 4 | Đúng hành động đó, nhưng **một mark nằm sau lưng** — phải xoay model mới bắn được | 0 |
| 3 | Park it | 1x2x2 | 4 | **Reserve**, và bị buộc chứ không phải được mời: bức tường Vàng che mark của cả hai goal đang mở | 0 |
| 4 | Read the order | 2x2x2 | 8 | Kết hợp: một mark mặt trước, một mark sau lưng, và Đỏ nằm khuất sau Vàng nên **thứ tự mới là bài toán** | 1 |
| 5 | Full sweep | 3x2x2 | 12 | Tốt nghiệp: goal bị chia (`Y:2+2`), blocker, mark sau lưng, và reserve chật đủ để **thua được** | 3 |

Ba màn đã ship **không bị xoá** — chúng lùi xuống thành 6, 7, 8 (`Prism 4x3x2`, `Interleaved layers`,
`Split purple goal`). Người dùng chỉ yêu cầu năm màn đầu, nên tôi không tự ý bỏ nội dung đã author.

Màn 3 là màn duy nhất trong ramp có nước đi **bắt buộc lệch goal**: cụm duy nhất với tới được lại
không có goal nào nhận, nên nó phải vào reserve, và khi goal Đỏ xong thì goal Vàng mở ra và reserve
**tự rót vào**. Đó là cách duy nhất để dạy reserve mà không cần một dòng chữ nào.

### 27.2 Phát hiện: mặt của mark quyết định có phải xoay hay không

Bản đầu tôi cho màn 2 một mark ở mặt hông (`1.1.0:PX`) với ý "mark có thể nằm ở mặt bên". Bắn thử
trong game thì phát nào cũng dội. Lý do: **đạn luôn bay tới từ phía camera**. Ụ súng nằm giữa camera
và model, nên một quả đạn nhắm vào mặt `PX` vẫn chạm mặt `PZ` trước — mặt trước nằm trên đường bay.

Nên mặt của mark không phải chuyện trang trí, nó là **luật chơi**:

- `PZ` (mặt đang hướng về người chơi): bắn được ngay.
- `PX`, `NX`, `NZ`, `PY`, `NY`: **phải xoay mặt đó ra trước đã**.

Vì thế màn 2 đổi thành `1.1.0:PZ~0.0.0:NZ` — một mark ở nơi người chơi mong đợi, một mark phải xoay.
Bản `PX~NZ` cũ bắt xoay cho **cả hai** cụm, nặng hơn "một biến thể nhỏ" khá nhiều. Nhịp xoay của ramp
giờ là: màn 1 không xoay, màn 2 xoay một lần, màn 3 không xoay, màn 4 và 5 mỗi màn một lần.

### 27.3 Phát hiện: slab cao 1 ô thì không đọc được hình

Màn 3 bản đầu là `2x1x2` — hai ô ngang, **một** ô cao, hai ô sâu. Camera nhìn nó gần như từ trên
xuống, nên các mặt trước bị bóp thành những hình bình hành mỏng và **không thấy bullseye nào**. Một
màn nhập môn mà không đọc được mark thì vô nghĩa.

Đổi thành `1x2x2`: một ô ngang, hai ô cao, hai ô sâu — một bức tường dựng đứng, mặt trước hướng thẳng
camera. Cùng một bài toán ("tường Vàng che mark phía sau"), nhưng nhìn là hiểu.

Bài học chung khi author: **chiều cao là chiều đọc được**. Model cao 2 ô trở lên thì mặt trước rõ; cao
1 ô thì camera biến nó thành cái mặt bàn.

### 27.4 `rainbow_target_count` giờ nhận 0

Cột này dùng `parsePositiveInteger`, nên `0` bị báo lỗi và ô trống thì rơi về mặc định 3. Nghĩa là
**không thể** author một màn không có Rainbow Target. Ba màn đầu dạy một luật mỗi màn, mà một bia bonus
bay ngang màn hình trong lúc đó là một thứ thứ hai để nhìn.

Thêm `parseNonNegativeInteger` cho riêng cột này. Ô trống vẫn là mặc định; `0` giờ là một giá trị được
author thật. Engine và `createRainbowSpawnSchedule` đã hỗ trợ `targetCount: 0` từ trước (ba màn
tutorial vẫn dùng), chỉ có cái cổng ở sheet là chặn.

Số bonus theo ramp: `0, 0, 0, 1, 3`. Có test chốt đúng dãy này.

### 27.5 Luật pacing trong test phải đổi, không phải đổi màn

`tests/level-sheet.test.mjs` có một test bắt **mọi** màn phải thoả:

```js
assert.equal(audit.waves[0]?.length, level.activeGoalSlots);   // đúng 2 cụm mở đầu
assert.ok(audit.waves.length >= 3);                            // ít nhất 3 đợt blocker
```

Hai điều kiện đó **loại trừ một màn nhập môn về mặt định nghĩa**: màn 1 chỉ có 2 cụm, cả hai đều bắn
được ngay, nên nó có đúng **1** đợt. Đây là chỗ tôi phải chọn: bóp màn 1 cho vừa test, hay sửa test cho
đúng ý đồ thiết kế mới. Tôi chọn cái thứ hai — một màn đầu có chuỗi blocker ba lớp thì không còn là màn
đầu.

Test giờ giữ nguyên phần bất biến cho mọi màn (một mark mỗi cụm; không cụm nào bị vây trong một chu
trình) và đọc **hình dạng đợt theo từng màn** từ một bảng: `1, 1, 2, 2, 2, 5, 4, 3`. Màn 3 được đánh
dấu `forcesReserveFirst`, và test chốt rằng **mọi** goal mở đầu của nó đều bị che — thiếu điều đó thì
màn 3 không còn dạy reserve nữa. Các màn khác bị chốt điều ngược lại: không goal mở đầu nào được thiếu
cụm để bắn.

Thêm hai chốt cho chính cái ramp: số block và số bonus của màn sau **không được thấp hơn** màn trước,
để độ khó không lặng lẽ tụt.

Sửa kèm theo:

- **Route chuẩn** cho 8 màn (fixture cũ có 3). Route của màn 3 ghi rõ `parkedAfter: [2, 0, 0]` — reserve
  nhận 2 block rồi được rót lại về 0 ở nước sau. Test này mô phỏng bằng chính engine luật thật, nên nó
  là bằng chứng cả 8 màn **giải được và all-clear**.
- `minimumOffGoalClears` giờ kỳ vọng 1 ở màn 3 và màn 7 (trước là chỉ màn 2 — chính là màn 7 bây giờ).
- Test `goal_split` trong `game-rules.test.ts` neo vào `level.id === 3`; màn split giờ là **8**, nên nó
  đi theo cái split chứ không theo số thứ tự.
- Test "row 1 khớp file viết tay" đổi sang **row 6**: `level01.ts` vẫn phải là bàn `Prism` giàu màu vì
  nó là fallback offline **và** là fixture của gần như toàn bộ `game-rules.test.ts` (reserve 8, đỏ 6/7,
  vàng 4/9...). Thu nó thành bàn 4 block sẽ phá khoảng 20 test không liên quan gì tới lượt này.
- Cảnh báo "mark bị che" 16 → **20** (màn 3 thêm 2, màn 4 và 5 mỗi màn 1).

### 27.6 `levels.csv` giờ được sinh ra, không viết tay

Có một test chốt `work/levels.csv` phải parse ra **đúng** cùng bộ level với `work/levels.tsv`. Giữ hai
file bằng tay chính là cách chúng lệch — và tôi lệch ngay trong lượt này: bản CSV đầu tôi quote cả dòng
comment, biến `# Level sheet...` thành một cell có dấu ngoặc kép, nên parser đọc dòng 1 thành header và
cả file sập.

`work/sync-levels.mjs` giờ tự viết lại `levels.csv` từ `levels.tsv` (chỉ khi nguồn là file .tsv — trỏ
vào .csv thì nó đang đọc chính cái bản sao đó). Dòng `#` được copy **nguyên văn**: parser bỏ qua mọi
dòng bắt đầu bằng `#`, nên quote nó vào là phá file.

### 27.7 Đã kiểm được gì trong game thật

375×812, lái bằng pointer event tổng hợp:

- **Màn 1**: thắng bằng **đúng 2 phát** vào hai mark hướng trước, "Perfect sorting! All clear", reserve
  giữ nguyên 0. Không cần xoay.
- **Màn 2**: mark của Đỏ ở mặt trước bắn được ngay; cụm Xanh **không** bắn được cho tới khi xoay model
  đưa mặt `NZ` ra trước, sau đó claim được. Đây cũng là chỗ phát hiện luật ở 27.2.
- **Màn 3**: thấy đúng bài học — Vàng bị **cất vào reserve** (pip vàng hiện trong khay) và sau đó mark
  của Đỏ với Xanh **lộ ra**, đúng cái mà bức tường Vàng đang che.
- **Màn 4**: mark của Vàng ở mặt trước; phá Vàng xong thì **mark của Đỏ hiện ra** — blocker hoạt động
  đúng. Xanh có mark sau lưng nên phải xoay. Màn thắng với "Perfect sorting".
- **Màn 5**: vào được và đọc đúng trạng thái mở đầu — `GREEN 0/2` và `YELLOW 0/2` với reserve `0/4`.
  Hai goal Vàng **2** (không phải một goal 4) là bằng chứng `goal_split Y:2+2` hoạt động.
- Cả 8 màn: `npm run levels` báo **0 error**, và test route mô phỏng qua engine luật thật cho **cả 8**
  màn đều WIN + all-clear với số block trong reserve khớp từng nước.

`npm test` **160/160**, `npm run lint` sạch. `npx tsc` vẫn 3 lỗi **có từ trước** ở `db/index.ts` và
`worker/index.ts`.

### 27.8 Điều phải nói rõ

- **Màn 5 là màn đầu tiên có thể thua.** `batch_blocks 4` bằng đúng cụm lớn nhất, nên cất cụm 4 block
  là đầy khay; một cú lệch goal nữa là FAIL `Reserve full`. Bốn màn trước **không thể thua** — có ý đồ,
  nhưng nghĩa là người chơi gặp cái thua đầu tiên ở màn 5.
- **Màn 5 chưa được chơi hết bằng tay.** Tôi xác nhận nó vào được và trạng thái mở đầu đúng, nhưng
  không lái tay tới lúc thắng. Tính giải được chốt bằng test route chạy trên engine luật thật. Lý do là
  automation **mù với bullseye**: nó không đọc được mark nằm ở đâu nên phải quét-và-xoay, tốn rất nhiều
  lượt mỗi màn. Cùng lý do đó, tôi không khẳng định gì thêm về độ khó thực tế của màn 5.
- **Hub không có bộ chọn màn.** Muốn tới màn N phải thắng N-1 màn trước, nên không kiểm nhanh được một
  màn ở giữa.
- **Đường cong này chỉ là năm màn đầu.** Màn 6 nhảy từ 12 block lên 24 block và từ 2 lên 5 đợt blocker —
  một bước khá dốc. Nếu muốn mượt thì cần thêm vài màn ở giữa, nhưng đó là ngoài phạm vi yêu cầu.

## 28. Rainbow Climax thành của hiếm, và goal cuối lướt về chỗ (24/08)

### 28.1 Vấn đề: bonus đang là trạng thái bình thường

Trước lượt này màn nào cũng `rainbow_target_count 3` với `rainbow_spawn_gap` mặc định 12. Tính ra lịch
thật của bàn `Prism`: target đầu ở **6,0s**, rồi cái tiếp cách 6–18s, mỗi cái trên màn 7s. Nghĩa là
cái này vừa rời màn thì cái sau đã tới — và một thứ xuất hiện liên tục thì không còn là thưởng, nó là
nền. Cộng lại cả chiến dịch có **13** target.

Tệ nhất là màn tutorial: `spawnGapSeconds: 2` với `targetDurationSeconds: 7`, nên ba target **chồng lên
nhau** — một bài học về việc bắt *một* cái bia lại thành ba cái chen nhau.

### 28.2 Luật mới, viết thẳng trong sheet

Rule nằm ngay trong phần comment đầu `work/levels.tsv` (và bản `.csv` mirror):

- **Tối đa 1 target mỗi màn.** Không bao giờ 2.
- **Phần lớn màn để 0.** `target_count` chỉ được bật khi round đủ dài để xứng một phần thưởng.
- `rainbow_spawn_gap` **kiêm luôn vai "sớm nhất là bao giờ"**: target đầu rơi vào `gap × 0,5…1,0` giây.
  Nên gap lớn trên màn dài là cách giữ nó ra khỏi phần mở đầu.

Kết quả trên 8 màn:

| Màn | Count | Gap | Target xuất hiện |
|---|---|---|---|
| 1–4 (ramp dạy chơi) | **0** | — | không có |
| 5 Full sweep | 1 | 24 | 15,3–22,3s |
| 6 Prism 4x3x2 | 1 | 30 | 19,9–26,9s |
| 7 Interleaved layers | **0** | — | không có |
| 8 Split purple goal | 1 | 24 | 23,0–30,0s |

**Tổng cả chiến dịch: 3 target** (trước là 13), sớm nhất là giây **15,3** (trước là 6,0).

Tutorial giữ **3** lần thử — một phát trượt không được làm kẹt bài học — nhưng gap 2 → **9**, nên mỗi
lúc chỉ một cái trên màn.

### 28.3 Chỗ tôi làm khác ví dụ của bạn, và vì sao

Bạn nêu mẫu `0, 0, 1, 0, 1`. Tôi làm `0, 0, 0, 0, 1` cho năm màn đầu — tức **màn 3 không có** thay vì
có một.

Lý do: hai yêu cầu của bạn ("hiếm" và "đừng quá sớm") xung đột nhau ở đúng màn 3. Màn 3 có **4 block**,
xong trong khoảng 3 phát. Muốn nó không sớm thì gap phải ≥24, tức target đầu ở 12–24s — round đã kết
thúc trước đó, nên bonus **không bao giờ xuất hiện**. Còn muốn nó xuất hiện thật thì gap phải ~12, tức
target ở 6,0s — đúng cái "quá sớm" bạn vừa nói. Tôi đo cả hai phương án rồi mới chọn.

Nên tôi giữ nguyên **tinh thần** (hiếm, có màn bỏ trống, mỗi màn nhiều nhất 1) và bỏ bonus khỏi cả bốn
màn dạy chơi. Chỗ bỏ trống trong mẫu giờ nằm ở màn 7. Nếu bạn vẫn muốn màn 3 có một cái thì chỉ cần đổi
`rainbow_target_count` của row 3 thành `1` và `rainbow_spawn_gap` thành `12` — nhưng nó sẽ hiện ở giây 6.

### 28.4 Test chốt luật, không chỉ chốt giá trị

Ba assertion mới trong `tests/level-sheet.test.mjs`, để cái lỗi vừa rồi không lặng lẽ quay lại:

- `targetCount <= 1` cho **mọi** màn, kèm câu giải thích tại sao.
- Số màn có bonus không được vượt **một nửa** tổng số màn.
- Màn nào có bonus thì `spawnGapSeconds >= 24`, tức không có gì rơi vào 12 giây đầu.
- Dãy `[0, 0, 0, 0, 1, 1, 0, 1]` được chốt nguyên văn, nên thêm/bớt một bonus là phải sửa test có ý thức.

Bỏ assertion cũ "số bonus của màn sau không thấp hơn màn trước" — nó vốn dùng để giữ ramp không tụt độ
khó, nhưng một mẫu hiếm **phải** có chỗ trống, nên hai điều đó không thể cùng đúng. Ramp giờ chỉ còn bị
chốt bằng số block.

`app/game/level-01.ts` sửa theo row 6 (`1 / 30 / 7`) — có test so từng field giữa hai bản.

### 28.5 Goal cuối cùng lướt về cột đầu

Trước đây ô goal đã xong vẫn giữ chỗ trong grid, có chủ ý: để cái goal còn lại **không** bị xê ngang.
Nhưng khi chỉ còn *một* goal thì chẳng còn gì phải giữ chỗ cho, và một cái card đứng lẻ ở bên phải đọc
ra như lỗi layout chứ không phải như tiến độ.

Giờ: còn hai goal thì vẫn giữ ô trống như cũ; còn **một** goal thì ô trống bị bỏ hẳn, card nhận cột đầu,
và nó **lướt** sang đó.

Chuyển động kiểu cartoon, không phải nội suy thẳng — đo bằng cách lấy mẫu `transform` từng frame trong
game thật:

```
x: 149,7 → 70,0 → 9,8 → -9,8 → +2,6 → +2,4 → -1,7 → 0
```

Nó **chạy quá mốc** tới −9,8px rồi nảy lại hai lần trước khi dừng. Kèm theo:

- **Squash/stretch**: `scaleX` vọt lên 1,05 lúc phanh rồi thụt xuống 0,97 lúc nảy.
- **Tilt** tối đa 2,5°. Không có cái tilt này thì squash đọc ra như glitch chứ không như quán tính.

Khoảng đường đi được viết bằng **chiều rộng của chính card** (`calc(100% + 10px)` = một cột + gap), nên
nó đúng ở mọi bề rộng màn hình mà không cần đo. Đo thực tế: bắt đầu ở 149,7px = 140 (cột) + 10 (gap) ✓.

Hai chỗ phải cẩn thận:

- `.goal-card.is-full` cũng khai `animation:`, nên một goal vừa đầy đúng lúc goal bên cạnh xong sẽ bị
  rule này **ghi đè mất glow**. Có thêm rule `.is-sliding-home.is-full` khai cả hai animation.
- Hai chỗ bay (`[data-goal-slot]`) đọc rect từ DOM đang hiển thị, nên trong lúc card đang lướt thì block
  bay tới **đúng chỗ card đang ở**. Bỏ ô trống cũng không làm hỏng chúng: chúng chỉ nhắm vào slot đang
  có goal thật.
- Tutorial chương 2 có `activeGoalSlots: 1`, nên goal duy nhất luôn ở index 0 → **không** có animation
  chạy oan.

### 28.6 Đã kiểm được gì

- Lịch spawn thật của cả 8 màn tính bằng chính `createRainbowSpawnSchedule`: tổng **3** target, sớm nhất
  **15,3s**, 5 màn không có gì.
- Animation goal: chơi thật màn 1, bắn Đỏ trước để Xanh còn lại một mình ở cột phải. Trước cú claim có
  2 card (`left 0` và `left 150`, không có ô trống). Sau đó chỉ còn 1 card, `animationName` là
  `goal-slide-home`, và nó kết thúc ở **`left: 0`** với **đúng bề rộng 140** — tức lướt sang cột đầu mà
  không đổi kích thước.
- Đường cong lấy mẫu 44 frame, có overshoot / squash / tilt như trên.
- `npm test` **160/160**, `npm run lint` sạch, `npx tsc` vẫn 3 lỗi có từ trước ở `db/` và `worker/`.

Chưa kiểm: một cú claim làm **đầy goal đúng lúc** goal bên cạnh xong (nhánh `.is-sliding-home.is-full`).
Nó là hai rule CSS cạnh nhau và tôi không lái được automation vào đúng frame đó.

## 29. Block bo góc và sáng hơn (24/08)

### 29.1 Bo góc

Block trước là `BoxGeometry(0.92)` — cạnh cứng. Giờ là `RoundedBoxGeometry` từ
`three/examples/jsm/geometries/RoundedBoxGeometry.js`, với bán kính **16% cạnh** và **3 segment** mỗi góc.

Lý do dùng addon thay vì tự dựng: `RoundedBoxGeometry` **extends `BoxGeometry`**, nên
`BlockRuntime.mesh` giữ nguyên kiểu `THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>` và không
một dòng nào của phần collision phải đổi. `@types/three` có sẵn `.d.ts` cho nó nên `tsc` không cần
`any`. Tự viết một rounded box đúng normal/UV là việc thật, mà đây là code đã kiểm nhiều năm.

**Vật lý vẫn là hình hộp, có chủ ý.** `sweepBlocks` và `impactedFace` đều giải theo box, và điều kiện
trúng Weak Point là "đúng một mặt". Nếu bo góc lan sang cả collision thì luật "trúng mặt" sẽ có một vùng
mờ ở mỗi cạnh — không đọc được và không dạy được. Bo góc ở đây thuần là thứ người chơi nhìn thấy.

Mặt phẳng còn lại của mỗi mặt vẫn rộng `0.92 - 2×0.147 = 0.626`, còn decal bullseye chỉ `0.21 × 0.92 =
0.193`, nên dấu vẫn nằm gọn trong phần phẳng, không bị bò lên chỗ cong.

Chọn bán kính, và đây là chỗ tôi đoán sai: tôi thử **0.16**, thấy trong game bo quá nhẹ nên tự đẩy lên
**0.2**. Bạn xem rồi chọn lại **0.16** — nên đó là giá trị đang chạy. Cái tôi đọc là "gần như không thấy"
thì ở mắt bạn là đủ, và bo nhẹ hơn thì cụm càng liền khối, điều quan trọng vì cả game dựa trên việc đọc
được đâu là một cụm. Trần trên vẫn là khoảng hở ở góc (spacing 1.02 so với cạnh 0.92): bo càng sâu thì
các block càng rời ra thành hạt riêng lẻ.

**Lớp khiên xanh bo theo cùng profile.** Nó là một vỏ `1.16×` bọc quanh block; để vỏ cạnh cứng trên một
block đã bo thì bốn góc sẽ hở ra bốn cái nêm sáng không có gì phía sau.

### 29.2 Sáng hơn

`MeshLambertMaterial` chỉ có diffuse, nên mặt nào quay khỏi key light thì tối hẳn — đọc ra như bẩn chứ
không ra khối. Giờ mỗi block lấy **chính màu của nó** làm `emissive` ở `emissiveIntensity 0.2`.

Cách này nhấc các mặt trong tối lên mà không làm bẹt các mặt đang được chiếu sáng. Tôi **không** tăng
đèn scene: `HemisphereLight 1.75` và `DirectionalLight 2.25` chiếu cả ụ súng, nên tăng lên là sáng lây
sang thứ không ai yêu cầu.

Cũng **không** đổi `COLOR_HEX`: bảng màu này trùng khớp từng hex với `COLOR_META` mà HUD dùng cho chip
goal, nên đổi nó là đổi luôn định danh màu trên toàn UI. Emissive chỉ đổi cách render, màu gốc giữ
nguyên, nên chip goal ↔ block vẫn khớp.

**Một cái bẫy phải sửa kèm.** `emissive` đã được dùng từ trước cho hai việc:

- `releaseCluster` đặt `emissiveIntensity = 0.55` cho block vừa bị claim khi nó bay đi.
- Break-wave (`clearNeighborKick` và vòng update) đặt `emissiveIntensity = 0` ở **ba** chỗ để trả block
  về trạng thái nghỉ.

Ba chỗ đó giờ phải trả về `BLOCK_EMISSIVE_INTENSITY`, không phải 0 — nếu không thì **mọi block từng bị
một đợt sóng phá chạm qua sẽ tối vĩnh viễn** so với block bên cạnh. Đây là loại lỗi chỉ hiện sau vài cú
bắn nên rất dễ lọt.

Và `0.2` được chọn để nằm rõ dưới `0.55`: cú flash lúc bị claim vẫn phải nổi hơn trạng thái nghỉ, chênh
2,75× là đủ đọc.

### 29.3 Đã kiểm được gì

- Nhìn trong game ở hai bàn khác nhau: màn 1 (4 block) và tutorial lesson 1 (6 block, 2 lớp). Góc bo
  đọc rõ, màu sáng hơn hẳn bản trước, và cụm vẫn liền khối.
- Bullseye vẫn tương phản tốt trên nền màu đã sáng hơn, kể cả trên vàng.
- Bắn thật một cụm: claim chạy đúng, block bay đi bình thường — tức đổi geometry không ảnh hưởng
  collision, đúng như dự tính.
- `npm test` **160/160**, `npm run lint` sạch, `npx tsc` vẫn 3 lỗi có từ trước ở `db/` và `worker/`.

**Chưa kiểm:** đúng frame của cú flash `0.55` lúc claim. Nó chỉ tồn tại vài frame và tôi không chụp
được; quan hệ `0.2 < 0.55` là đọc từ code chứ không phải đo từ ảnh.

**Chưa xem:** bàn dày nhất (màn 6, 24 block). Rủi ro tôi nêu ở 29.1 — góc bo làm block rời thành hạt —
sẽ rõ nhất ở đó, mà tới được màn 6 thì phải thắng 5 màn trước. Ở 6 block hai lớp thì nó vẫn liền khối,
và ở 0.16 thì rủi ro đó còn thấp hơn nữa so với lúc tôi viết đoạn này.

Ảnh in-game ở 29.3 chụp lúc bán kính còn là 0.2; hình dạng hiện tại bo nhẹ hơn thế.

## 30. Tutorial: màn mờ là để đọc, không phải để chơi qua nó (24/08)

Ba yêu cầu hoá ra là ba trường hợp của **cùng một luật**: màn mờ tồn tại để người chơi đọc một điều.
Ngay khi họ bắt đầu *làm* điều đó thì nó thành thứ chắn đường. Nên thay vì ba chỗ vá riêng, luật này
được viết một lần trong `tutorial.ts`.

### 30.1 `scrimHidden` sống theo chương, không theo bước

Thêm `scrimHidden` vào `TutorialProgress`, và một hàm `tutorialScrimVisible(progress)` mà UI đọc thay
vì tự dựng lại điều kiện.

Nó **sticky theo chương** chứ không reset mỗi bước, và đây là điểm quan trọng: "Drag to aim" và
"Release to fire" là **một cử chỉ liên tục**. Nếu reset theo bước thì màn mờ sẽ quay lại chen vào giữa
lúc người chơi đang giữ tay kéo — nhá đen ngay trên cú bắn đang thực hiện.

Ba nguồn tắt nó:

| Chương | Tắt khi |
|---|---|
| 1. Controls | Ngón tay **vừa chạm** aim zone (bước "Drag to aim") |
| 2. Sort | Cái tap **rời thẻ cuối** |
| 3. Weak Point | **Bắt được** Rainbow Target |

Ring và scrim là cùng một element, nên tắt scrim là tắt luôn ring — cố ý: tới lúc đó người chơi đã đọc
xong, và một cái vòng treo trên bàn đã sáng thì chỉ còn là vật cản.

### 30.2 `AIM_TOUCHED`: phát trên cú chạm, không phải trên khoảng kéo

Engine có event mới `AIM_TOUCHED`, phát trong `onAimPointerDown` **trước** lời gọi `setPointerCapture`.
Thứ tự đó không phải tuỳ tiện: capture có thể throw trên một pointer mà browser không còn theo dõi, và
nếu đặt sau thì cú throw sẽ mang theo cả phần còn lại của handler.

Bước "Find the mark" **không** tắt màn mờ khi chạm ụ súng — cờ `dimDropsOnAimTouch` chỉ bật ở hai bước
ngắm. Vòng khoanh lúc đó vẫn đang giải thích một cử chỉ người chơi chưa làm.

### 30.3 Sort lesson: đọc ba thẻ rồi mới chơi

Trước đây mỗi beat bị chặn sau một phát bắn của chính nó. Nghĩa là **cái thẻ giải thích reserve chỉ
tới sau khi đã có một cụm nằm trong đó rồi** — giải thích một việc đã xảy ra.

Giờ ba thẻ được đọc trước, mỗi tap một thẻ, và tap rời thẻ cuối tắt màn mờ rồi trao bàn cho người chơi.
Chương này vì thế có **4 bước** chứ không 3, nên `TUTORIAL_STEP_COUNT` bị thay bằng
`tutorialStepCount(chapter)` — các chương dài khác nhau là chuyện có thật, hằng số một giá trị chỉ che nó đi.

- Thẻ nào cũng `advance: "tap"`, và trong lúc đó **cả frame hút cú tap** (`.tutorial-tap-catcher`), nên
  đọc một thẻ không đồng thời là bắn một phát.
- Bước thứ tư (`focus: null`, `advance: "event"`) kết thúc bằng **LEVEL_WON**. Nếu lesson đóng ngay sau
  cái tap cuối thì cái bàn sẽ chẳng còn ý nghĩa gì.
- Một chevron nhấp nháy nói rằng còn tap được nữa — dấu hiệu, không phải thêm chữ.

### 30.4 Bàn sort phải làm ba beat thành **bắt buộc**

Đây là phần "sửa lại cấu trúc puzzle". Bàn cũ là một hàng `Red, Blue, Red` với cả ba mark tự do. Đọc
xong ba thẻ rồi chơi, người chơi hoàn toàn có thể bắn **Red, Red, Blue** — và như thế chỉ thấy *hai*
trong ba beat: goal Red xong thì goal Blue mở ra, nên Blue đi thẳng vào goal và **không có gì từng được
cất vào reserve**. Ba thẻ hứa ba việc mà bàn chỉ giao hai.

Bàn mới là `1x2x2` — một cột dựng đứng, hai lớp sâu:

- Red trước-trên `(0,1,1)`, mark `PZ` — tự do
- Blue trước-dưới `(0,0,1)`, mark `PZ` — tự do
- Red sau-dưới `(0,0,0)`, mark `PZ` — **bị Blue che**

Red là **hai cụm một block riêng biệt** (không kề nhau: lệch cả y và z), nên nó không thể xong trong một
claim; và cụm Red thứ hai nằm sau Blue. Không còn đường nào tới cuối mà không claim Blue **trong lúc
Red còn thiếu một block** — đúng khoảnh khắc không có goal nào mở cho Blue và nó buộc phải vào reserve.

Bản đầu tôi ép thứ tự bằng cách đặt mark của Red thứ hai ở mặt `NX`. Nó chạy được nhưng bắt **xoay
model** trong một bài học nói về chỗ cụm đi tới — theo đúng luật ở mục 27.2 thì mark ở mặt hông chỉ bắn
được sau khi xoay mặt đó ra trước. Cách dùng chiều sâu đạt cùng kết quả với **mọi mark hướng camera**.

Có test riêng chốt tính chất này qua `auditWeakPointRoutes`: 3 cụm, đợt 1 là `[blue, red]`, đợt 2 là
`[red]`. Nếu ai đó sau này gỡ blocker thì test đỏ, kèm câu giải thích tại sao nó ở đó.

### 30.5 Một lỗi tôi tự tạo trong chính lượt này

Bỏ khoá màu theo bước cho chương sort bằng cách cho `tutorialAllowedColor` trả `null`. Nhưng option vẫn
được cài:

```ts
canClaimColor: engineTutorialChapter > 0 ? (color) => tutorialAllowedColor(...) === color : undefined
```

`null === color` là **luôn false**, nên **không cụm nào trên bàn claim được nữa**. Bàn trông chơi được
mà không chơi được — tôi chỉ phát hiện khi lái thử trong game thấy bắn 10 phát mà goal không nhích.

Sửa: chỉ chương Weak Point cài predicate. Ở đó `null` vẫn có nghĩa "không cụm nào" — bước Rainbow muốn
người chơi bắn cái bia, không phải một cụm — nên hành vi cũ giữ nguyên. Test giờ chốt phạm vi
`engineTutorialChapter === 2` kèm lý do.

### 30.6 Rainbow tới ngay sau cú phá cụm đỏ

`createRainbowSpawnSchedule` có thêm `firstSpawnSeconds`: khi truyền vào thì target đầu tới đúng lúc đó
thay vì `gap × 0,5…1,0`. Các target sau vẫn dùng gap, nên các lần thử lại còn giãn.

Engine nhận qua option `rainbowFirstSpawnSeconds`, và tutorial truyền **0,35s** cho chương 3. Lesson bật
target ngay khi bước Weak Point xong; bảo người chơi bắn một cái bia rồi để họ nhìn trời trống sáu giây
thì đọc ra là game hỏng.

### 30.7 Đã kiểm được gì trong game thật

- **Chạm để tắt màn mờ**: `Find the mark` có scrim → `Drag to aim` vẫn có → **chạm ụ súng** thì
  `scrim=false` ngay và cue nổi lên trên, bàn hiện rõ hoàn toàn. Sau khi nhả tay nó **không** quay lại.
- **Ba thẻ sort theo tap**, đo từng bước: thẻ 1 ring ở hàng goal (`311x72`), tap → thẻ 2 ring nhảy xuống
  **thanh reserve** (`311x52`, một phần tử khác, đo đúng), tap → thẻ 3 về hàng goal, tap → `Now clear it`,
  **scrim=none**, tap catcher biến mất.
- **Ba beat xảy ra đúng thứ tự đã kể** khi chơi bàn mới: `RED 1/2` → `Reserve 1/1` → goal rỗng và
  `Reserve 0/1`, rồi lesson đóng bằng cú thắng (`complete=true`).
- **Rainbow tới ngay**: ảnh chụp cho thấy bia đã nằm trong vòng khoanh ngay sau cú phá cụm đỏ, và đo
  được nó bắt được **0,82 s** sau claim (0,35 s spawn + thời gian quét của tôi).
- `npm test` **162/162**, `npm run lint` sạch, `npx tsc` vẫn 3 lỗi có từ trước ở `db/` và `worker/`.

**Chưa kiểm trong game:** màn mờ tắt *đúng lúc bắt được* Rainbow Target. Cơ chế đã được test ở tầng
reducer (`RAINBOW_HIT` đặt `scrimHidden`), và đường render là cùng một `tutorialScrimVisible` mà trường
hợp chạm-ngắm đã chứng minh trên màn hình — nhưng tôi không bắn trúng được cái bia đang bay. Automation
của tôi mù với vị trí bia: nó lọc theo dải `y` mà dải đó lại trùm cả cụm blue, nên phần lớn phát bắn đi
vào blue (đang bị khoá màu) và cả ba cửa sổ target trôi qua.

## 31. Giữ để đưa cụm về vị trí ban đầu (24/08)

Xoay model là cách duy nhất để tìm mark ở mặt sau, nhưng xoay rồi thì không có đường về — người chơi
phải tự xoay ngược lại bằng mắt. Giờ **giữ tay trên cụm** là nó tự quay về đúng pose lúc màn mở ra.

### 31.1 Phân biệt giữ với kéo

Hai cử chỉ dùng chung một vùng chạm, nên chúng phải loại trừ nhau chứ không cùng nổ:

- `MODEL_HOLD_MS = 460` — đủ dài để một cú kéo không bao giờ vấp vào, đủ ngắn để đọc ra là một cái
  nhấn chứ không phải một cuộc chờ.
- `MODEL_HOLD_SLOP = 12px` — ngón tay trên kính không bao giờ đứng yên tuyệt đối, mà cử chỉ xoay thì
  bắt đầu quay model **từ pixel đầu tiên**. Ngưỡng này hấp thụ rung tay mà không nuốt một cú xoay thật.
  Đi quá ngưỡng là `cancelModelHold()`: từ đó press không còn cửa nào để thành recentre.

Đếm bằng **frame clock**, không bằng `setTimeout`. Không phải vì pause — mà vì không có timer handle nào
để làm mất qua một lần dispose hay một cú đổi màn. Còn pause thì `pause()` đã gọi `clearModelGesture()`
nên press đang chờ bị bỏ hẳn; nó không thể nổ muộn lúc resume.

### 31.2 Kết thúc cử chỉ **trước** khi bắt đầu quay về

Khi hold nổ, `clearModelGesture()` chạy trước `recentreModel()`. Nếu để cử chỉ còn sống thì rung tay của
ngón đang tì trên kính sẽ **huỷ đúng cái animation vừa được yêu cầu**, để cụm đứng lại giữa đường. Sau
đó ngón tay còn đó cũng không điều khiển gì nữa cho tới khi nhấc lên và nhấn lại.

Ngược lại thì có: chạm lại vào cụm **giành quyền** từ một cú quay về đang chạy (`modelResetFrom = null`
trong `onModelPointerDown`), nên người chơi không phải đợi animation xong mới xoay tiếp được.

Animation là slerp 0,42s với cùng ease-out cubic mà intro dùng, và kết ở đúng `defaultModelOrientation`
chứ không phải một giá trị slerp làm tròn.

### 31.3 Event vẫn phát khi cụm đã thẳng

`recentreModel()` phát `MODEL_RESET` **trước** khi kiểm góc lệch, rồi mới bỏ qua phần animation nếu cụm
đã vuông. Nó báo *việc người chơi làm*, không phải *thứ gì đã dịch chuyển*. Hai lý do:

- Một cú nhấn không cho câu trả lời nào đọc ra là hỏng.
- Bước tutorial dạy cử chỉ này sẽ **kẹt vĩnh viễn** nếu người chơi thử nó lúc cụm đang thẳng.

### 31.4 Cái vòng đầy dưới ngón tay

Một cú nhấn 460ms mà không có gì hiện lên thì y như không có gì xảy ra. Nên `.model-input-zone` nhận
class `is-holding` cùng `--hold-x/--hold-y` (điểm chạm) và `--hold-ms`, rồi CSS vẽ một vòng đầy dần
ngay tại đó.

`--hold-ms` được engine ghi từ **chính hằng số nó đang đếm**, nên thứ người chơi nhìn đầy lên đúng là
cái hold đang được đo — không phải hai con số cạnh nhau chờ lệch nhau.

### 31.5 Dạy trong tutorial

Chương Controls thêm một bước, đặt **ngay sau bước xoay** — đó là lúc duy nhất cụm đang lệch và người
chơi có lý do muốn nó thẳng lại:

1. Find the mark (xoay)
2. **Hold to reset** ← mới
3. Drag to aim
4. Release to fire

Chương này giờ **4 bước**; nhờ đã đổi sang `tutorialStepCount(chapter)` ở mục 30 nên không cần sửa gì
thêm về cấu trúc. Kèm theo:

- Glyph mới `recenter`: một khối vuông với các tia hướng vào trong.
- Biến thể gesture mới `hold`: giữ bàn tay, thay hai mũi tên quét bằng **một vòng đầy rồi lặp lại** —
  một cú nhấn không có quãng đường nào để vẽ.
- Bước này `focus: "model"` và **không** có `dimDropsOnAimTouch`: chạm vào ụ súng ở đây không tắt màn
  mờ, vì vòng khoanh đang nói về cụm chứ không phải về pháo.

Test chốt cả hai chiều: bước aim **không thể** vượt qua bước recentre, và `AIM_TOUCHED` ở bước recentre
không làm gì cả.

### 31.6 Đã kiểm được gì trong game thật

Trong màn chơi thường (không phải tutorial), sau khi xoay cụm đi xa:

- **Kéo không kích hoạt**: nhấn, di quá slop, rồi giữ **45 frame (~750ms)** — `holding=false` ngay sau
  cú di, và cụm không quay về.
- **Nhấn yên thì kích hoạt**: `holding=true` với `--hold-x: 160px`, `--hold-ms: 460ms`; sau ~750ms cả
  `is-holding` và `is-dragging` đều đã tắt (cử chỉ kết thúc trước cú quay), và ảnh chụp cho thấy cụm về
  đúng pose mở đầu.
- **Trong tutorial**: `Find the mark` (gesture `rotate`) → xoay → `Hold to reset` (gesture **`hold`**)
  → giữ → `Drag to aim` (gesture `aim`), và dãy dot hiện **4** bước.
- Tab sạch: console không có lỗi của game, chỉ còn `navigator.vibrate` bị Chrome chặn vì pointer tổng
  hợp không phải gesture thật.

`npm test` **162/162**, `npm run lint` sạch, `npx tsc` vẫn 3 lỗi có từ trước ở `db/` và `worker/`.

**Chưa kiểm bằng tay:** nhấn giữ rồi mở dialog giữa lúc đang chờ. `pause()` gọi `clearModelGesture()`
nên press bị bỏ — đọc từ code, không phải đo từ máy.

## 32. Weak Point bung nhẹ khi lộ ở mặt ngoài (24/08)

### 32.1 Một chuyển động nhỏ, không thêm ánh sáng hay hạt

Mỗi lần Weak Point chuyển từ nhịp ẩn sang hiện, logo bắt đầu ở scale **0,90**, nở qua
**1,025** rồi về đúng **1,00** trong **0,24 giây**. Đây chỉ là chuyển động của riêng logo:
không đổi emissive của block, không chớp opacity và không sinh particle. Vì vậy nó đủ để mắt bắt được
nhịp xuất hiện nhưng không tranh sự chú ý với va chạm, khiên hoặc Rainbow Target.

Logo được khởi tạo ở trạng thái ẩn tới fixed step đầu tiên. Nếu để `THREE.Group` dùng mặc định
`visible=true`, frame dựng engine có thể vẽ tất cả Weak Point trước khi nhịp blink đầu tiên kịp được
tính — một flash ngắn nhưng đi ngược đúng ý "không quá nổi bật".

### 32.2 "Mặt ngoài" là topology của Puzzle, không phải mặt hướng camera

Từ mặt `PX/NX/PY/NY/PZ/NZ`, engine lấy đúng ô kề một bước theo pháp tuyến của mặt đó:

- ô trống hoặc block ở đó đã `active=false` → Weak Point được coi là lộ, lần xuất hiện kế tiếp có pop;
- block kề vẫn active → Weak Point đang kẹp giữa hai block, logo giữ scale thường và **không có hiệu ứng**;
- nếu block che vừa bị phá trong lúc logo đang ở nhịp sáng, trạng thái `wasExposed` tạo đúng một pop ở
  fixed step kế tiếp thay vì chờ hết cả chu kỳ blink.

Quy tắc không đọc camera: một mặt `NZ` quay khỏi người chơi nhưng không có block che vẫn là mặt ngoài.
Nó cũng đọc cờ `active`, không chỉ kiểm tra có key trong `blockMap`, vì block đã phá vẫn được giữ trong
map để phục vụ các hệ thống khác. Luật hit cả mặt Weak Point không thay đổi; exposure chỉ điều khiển
chuyển động thu hút chú ý.

### 32.3 Regression đã khóa

- Test pure đi qua đủ 6 hướng, ô trống, neighbor active, neighbor inactive và block ở phía đối diện.
- Test tích hợp chốt thời lượng/biên scale nhỏ, chỉ scale logo, reset chính xác về `1`, không dùng
  particle/opacity/emissive, và lúc Rainbow bypass trả logo lại vẫn đi qua cùng exposure gate.
- Hai suite liên quan: **28/28 pass**.
- Full suite đầu tiên lộ một test haptic phụ thuộc line ending LF (`;\n`), trong khi checkout Windows
  dùng CRLF. Regex được sửa thành `;\r?\n`; đây chỉ là độ bền của test, không đổi haptic hay gameplay.
- Pipeline standalone còn phát hiện `public/chapter-medieval-siege.png` bị thiếu dù ảnh vẫn nằm trong
  bản HTML offline cũ. Asset PNG gốc được giải mã nguyên vẹn từ chính data URI đó (kiểm tra PNG magic)
  và khôi phục về `public/` để lần đóng gói kế tiếp không còn phụ thuộc vào artifact cũ.

**Đã kiểm trong lượt này:** 164/164 test pass, lint sạch, production build sạch và file HTML offline
đã đóng gói lại thành công (920.580 bytes). Preview cục bộ được kiểm lại chung với thay đổi level kế tiếp.

## 33. CSV dễ đặt mặt Weak Point + thử nghiệm Umbrella ở riêng màn 1 (24/08)

### 33.1 Tên mặt đọc được theo tư thế gốc

`weak_points` vẫn dùng địa chỉ `x.y.z:FACE` để gắn chính xác vào một block, nhưng `FACE` nay nhận
thêm tên không phân biệt hoa/thường: `FRONT`, `BACK`, `RIGHT`, `LEFT`, `TOP`, `BOTTOM`. Parser chuẩn
hóa chúng lần lượt về `PZ`, `NZ`, `PX`, `NX`, `PY`, `NY`, nên runtime và các CSV cũ không đổi.

Phần hướng dẫn trong `work/levels.tsv`/CSV mirror và README ghi rõ: `x` trái→phải, `y` dưới→trên,
`z` sau→trước, tất cả bắt đầu từ 0. Tên mặt thuộc block trong tư thế mặc định của Puzzle và xoay cùng
block, không chạy theo camera. Ví dụ mới: `4.6.7:FRONT~3.7.4:TOP`.

### 33.2 Chỉ màn 1 được scale để thử

Row 1 đổi thành **Umbrella Trial** kích thước `9x8x9`, **132 block**, **6 màu**, 6 goal tuần tự
(`Y20, O34, B26, P20, R16, G16`) và `batch_blocks=38`. HUD vẫn chỉ mở 2 goal cùng lúc để không kéo
layout hiện có thành nhiều hàng. Màn dài có 1 Rainbow Target, xuất hiện muộn với `spawn_gap=36`;
màn 2–8 không đổi gameplay/data.

Không chỉ khó hơn về kích thước: Green là Weak Point duy nhất lộ ở mở màn trong khi hai goal `Y/O`
đều bị che. Người chơi bắt buộc bắn **G16** vào batch, rồi chuỗi mặt gắn theo block mở lần lượt
`G → Y → O → B → P → R`; khi goal Green vào cửa sổ cuối, 16 block trong batch tự điền về goal.
Năm Weak Point nằm giữa hai màu ở đầu round vừa tạo reveal chain, vừa trực tiếp thử rule “bị kẹp thì
không bung”; không có cycle và không cần Rainbow bypass.

### 33.3 Auto-fit để model lớn vẫn ngắm được

Bounds chiếm chỗ của Umbrella là `7,04 × 8,06 × 7,04` world unit; scale gameplay `1` sẽ bị cắt ngang
trên viewport dọc. Engine nay đo ba span từ chính tọa độ block, lấy đường chéo xoay 3D và chỉ thu đồng
đều model vượt ngưỡng `5,4`, đưa Umbrella về khoảng **0,422**. Board Prism có đường chéo `5,326` và
mọi màn nhỏ hiện có vẫn đúng scale `1`. Dùng đường chéo thay cho trục dài nhất nên model vẫn nằm trong
frame khi người chơi xoay một cạnh/đường chéo bất kỳ ra trước.

Scale fit được đặt trước frame render đầu, dùng làm đích chính xác của cả intro menu lẫn handoff; scale
menu/handoff trở thành tỉ lệ của đích đó. Vì toàn bộ `modelRoot` cùng scale, block, collider và Weak Point
giữ nguyên tương quan — CSV không cần thêm thông số trình bày và aim/hit không lệch khỏi hình.
Contract test của menu cũng đổi đích intro từ literal `1` sang `playModelScale`, để không thể vô tình
phóng level lớn trở lại kích thước bị cắt ở frame cuối.

Hai chỗ đổi parent/coordinate được bù scale rõ ràng: bán kính projectile chia cho `playModelScale` khi
sweep chuyển từ world sang local, còn block bung khỏi `modelRoot` lưu `baseScale` ngay sau `scene.attach`
và co từ đúng kích thước đó. Nhờ vậy auto-fit không làm hitbox khó hơn và block không phóng lớn ở frame
đầu của hiệu ứng văng.

Lệnh lint toàn repo còn quét các probe CDP chụp ảnh dùng một lần trong `work/gdd-capture/` (thư mục đã
gitignore) và báo 16 lỗi không thuộc app. ESLint nay bỏ đúng thư mục probe này; source app, test và các
script build/level còn lại vẫn nằm trong phạm vi lint. `.vinext/` cũng được thêm vào ignore vì đây là
output production sinh tự động; nếu không, lint sau build phải quét lại toàn bộ bundle và có thể không
kết thúc trong thời gian hợp lý.

Regression mới khóa đủ sáu alias, việc normalize về mã trục canonical và phát hiện trùng giữa alias
với mã cũ (ví dụ `FRONT` + `PZ`). Test cũng khóa toàn bộ inventory/goal của màn thử nghiệm, chữ ký
tổng quan của màn 2–8 và các marker hướng dẫn trong HTML offline. Route chuẩn khóa đúng batch `16` qua bốn
bước, auto-fill về `0`, sáu wave reveal và đúng một lượt off-goal bắt buộc; bộ giải exhaustive vẫn phải
chứng minh được đường thắng.

**Kiểm tra sau reveal chain:** `npm run levels` đồng bộ thành công TSV → CSV → bundled source → HTML;
năm cảnh báo mặt bị che và cảnh báo hai goal mở đầu chưa chạm được ngay đều là chủ đích của chuỗi reveal.
Toàn bộ **169/169 test pass** cả trước và sau khi dựng lại artifact; lint sạch; production build sạch;
HTML offline tạo lại thành công ở **923.576 bytes** với đủ 8 màn; preview cục bộ trả **HTTP 200**. Audit
raw diff xác nhận cả bảy dòng màn 2–8 không đổi; chỉ dòng gameplay/data của màn 1 được thử nghiệm.

---

## 34. Thêm một level tranh pixel 3D theo palette tham chiếu (24/08)

Thêm đúng một campaign row mới, **Level 9 — Pixel Spark Portrait**; level 1–8 không bị sửa. Model là
phù điêu `13x13x2`, tổng **187 block**: lớp sau tạo khung/tranh pixel, lớp trước nâng mắt, má, vùng sáng
vàng và mảng cam để hình vẫn có chiều sâu khi xoay. Bảng màu bổ sung hai màu thật thay vì giả lập bằng
tím/xanh: `K = black/ink` (`#1b1d24`) và `A = ash gray` (`#6b6f76`); `Y/O/R` giữ nguyên tông vàng,
cam, đỏ của ảnh tham chiếu. Màu đen dùng near-black để viền còn bắt sáng trên playfield tối.

Inventory/goal là `Y51 → O30 → A23 → R4 → K79`, hai goal cùng mở và Batch `74` — đúng bằng cụm lớn
nhất. Chín cụm FACE_6 có đúng chín Weak Point. Hai marker Ink đặt dưới lớp Yellow/Orange nên bị che ở
frame đầu, không chạy hiệu ứng; sau khi pigment tương ứng rời đi, mặt trở thành exterior và marker mới
bung nhẹ. Route canonical gồm chín lượt, không buộc dùng Batch và kết thúc WIN/all-clear. Auto-fit dự kiến
đưa tranh về khoảng `0.289` để cả khung vuông vẫn nằm trong vùng xoay.

Parser, renderer và HUD đều nhận hai màu mới; README/legend giải thích `K/A`. Regression được mở rộng để
khóa ID `1..9`, toàn bộ chữ ký portrait, inventory/goal, hai wave reveal, canonical route, số warning mặt
bị che, rarity Rainbow và marker trong HTML offline.

**Kiểm tra hoàn tất:** `npm run levels` nạp đúng **9 level**, sinh lại CSV/bundled source và vá HTML;
Level 9 chỉ tạo đúng hai warning mặt Ink bị che đã chủ đích, không có error hay blocker cycle. Toàn bộ
**169/169 test pass** cả trước và sau khi dựng artifact; lint sạch; production build sạch; standalone HTML
tạo lại thành công ở **925.172 bytes** với `levels: 9`; preview cục bộ trả **HTTP 200**. Regression route
thực thi đủ chín cụm, Batch luôn `0`, kết thúc WIN/all-clear và xác nhận Level 1–8 giữ nguyên chữ ký.

---

## 35. Pivot sang Sand Cannon Sort — thay hẳn kiến trúc block bằng cát pixel (25/08)

Kiến trúc block-cluster ở mục 1–34 (`app/GamePrototype.tsx`, `app/game/CannonSortEngine.ts`,
`app/game/level-format.ts`, `app/game/rules.ts`, `app/game/cosmetics.ts`, `app/game/rainbow-hook.ts`,
`app/game/tutorial.ts` và toàn bộ test đi kèm) bị gỡ bỏ hoàn toàn, thay bằng gameplay cát: bắn một quả
đạn màu vào khung tranh vẽ bằng pixel cát, đĩa bán kính quanh điểm chạm hút hết cát cùng màu trong tầm,
phần cát còn lại rơi/lăn xuống theo solver falling-sand (`app/game/sand-rules.ts`,
`app/game/SandCannonEngine.ts`). Đi kèm là một editor level mới ngay trong app
(`app/LevelEditor.tsx`, `app/game/level-drafts.ts`, `app/game/level-analysis.ts`) để vẽ tranh, validate
màu chết và chấm độ khó trước khi lưu vào danh sách level chơi được. `README.md` viết lại toàn bộ để mô
tả rule đã chốt, mở decision và benchmark `pixelScale` của kiến trúc mới; các file changelog/README nói
về block-cluster ở trên vẫn giữ nguyên làm nhật ký, không sửa lại theo hồi tố.

Merge fast-forward vào `main`: 52 file đổi, +4.881/−12.428 dòng.

---

## 36. Bắn được vào ô trống trong khung, không chỉ vào cát (25/08)

`resolveShot` trước đó coi một cú bắn là **MISS** bất cứ khi nào điểm chạm không rơi đúng lên một hạt
cát — kể cả khi điểm đó vẫn nằm hẳn trong khung tranh, chỉ là phần trống phía trên đống cát hoặc một lỗ
do phát trước đào ra. Người chơi ngắm vào khu vực đó thấy crosshair và vòng bán kính biến mất, không bắn
được, dù về mặt luật một đĩa bán kính đặt ở đó vẫn hoàn toàn hợp lệ và có thể hút được cát nằm chếch bên
dưới.

Sửa ở hai lớp. `ShotHit.bodyId` (`app/game/sand-rules.ts`) nay nhận `null` — "chạm vào không khí trong
khung" là một kết quả hợp lệ, khác với "đạn bay ra khỏi khung/trúng khung" mới thật sự là MISS.
`resolveShot` chỉ còn coi là miss khi `hit` là `null`; có `hit` nhưng không có `bodyId` vẫn resolve bình
thường, đĩa bán kính (`cellsInRadius`, giới hạn đúng `level.sortRadius`, không phải vô hạn) vẫn quét
quanh toạ độ đó. Ở `SandCannonEngine.ts`, `planeHit()` đổi từ "chỉ trả kết quả khi có pixel cát tại ô đó"
sang "trả toạ độ ô lưới cho mọi điểm nằm trong biên khung, `cell` chỉ là thông tin phụ có thể null" —
kéo theo crosshair, `is-target-valid`, vòng ngắm (`aimRing`) và tâm hiệu ứng khi bắn trúng
(`handleImpact`) đều dùng toạ độ ô thay vì chờ có cell.

Thêm test `"a shot into empty air inside the frame still sorts what the disc reaches"`
(`tests/sand-radius.test.ts`): bắn một phát mở đường trước để tạo khoảng trống, tìm một ô trống có màu
đạn đang cầm trong tầm bán kính, bắn vào đó và so kết quả `removed` với `cellsInRadius` tính tay — khớp
tuyệt đối, `hitBody` là `null`, và lượt vẫn bị trừ đúng một.

Nhân tiện phát hiện một sửa đổi chưa commit từ trước (không phải của phiên này) đổi bán kính đĩa từ
`level.sortRadius` thành `Infinity` — mỗi phát hút sạch toàn bộ màu đó trên bàn, bỏ luật bán kính. Đã trả
lại `level.sortRadius` vì ngược với yêu cầu "sort trong radius" và làm hỏng 3 test có sẵn.

**Kiểm tra:** 56/56 test pass (`npm test`, thêm 1 test mới so với 55 trước đó). `npx tsc --noEmit` không
phát sinh lỗi mới (lỗi còn lại ở `work/standalone-entry.tsx` là tàn dư import module đã xoá ở mục 35,
không liên quan). Xác nhận trực tiếp trên preview: ngắm vào vùng nâu trống phía trên cát hiện crosshair +
vòng bán kính, bắn ra tiêu đúng một lượt và đổi đạn kế tiếp trên HUD.

---

## 37. Mô hình súng mang đạn: buồng nạp phát sáng, viền họng súng, đạn preview lăn vào (25/08)

Trước đó mô hình 3D của súng không nói gì về việc nó đang cầm đạn màu gì — thông tin đó chỉ nằm ở HUD.
Thêm ba phần vào `SandCannonEngine.ts`, tất cả gắn vào `barrelPivot` (xoay/nghiêng theo nòng, nhưng
không giật lùi theo `barrelVisual` khi bắn — viên đạn *kế tiếp* không được giật theo phát vừa rời nòng):

- **Buồng nạp** (`buildAmmoFeed`): một khoang trụ trong suốt ở đoạn nối thân–nòng, chứa quả cầu đạn tô
  đúng màu ammo hiện tại (`SAND_COLOR_HEX`), quầng glow additive bọc ngoài và một `PointLight` thật hắt
  màu lên vỏ súng quanh đó. Quầng sáng "thở" theo sin ~1,5 Hz (`CHAMBER_GLOW_HZ`) để súng đã nạp đạn
  không bao giờ đứng hình.
- **Viền họng súng**: một vòng torus mảnh quanh miệng nòng (`MUZZLE_BAND_RADIUS = 0.42`, phải lớn hơn
  bán kính nòng tại đó — thử `0.29` lúc đầu bị chìm lọt vào trong, không thấy được), tô màu ammo đang
  sẵn sàng bắn, chuyển xám khi hết đạn.
- **Đạn preview lăn vào buồng**: các quả cầu nhỏ hơn xếp trên một ray dốc phía sau buồng nạp, đúng thứ
  tự và màu của `NEXT` trên HUD. Bắn xong buồng rỗng ngay (`chamberLoaded = false`); chỉ khi ván trở về
  `READY` (cùng thời điểm §21 mở khoá input) viên kế mới được nạp — cả hàng trượt lên một slot theo
  easing ease-out, viên mới nở dần vào buồng kèm một nhịp loé glow. Góc xoay của mỗi quả cầu buộc theo
  quãng đường đã đi (`rotation.x = -quãng đường / bán kính`) để đọc ra là đang *lăn*, không phải trượt.

Vị trí buồng nạp (`CHAMBER_POSITION`) đặt phía trước cụm cradle thay vì phía sau: camera nhìn súng từ
trên-sau xuống, đặt buồng lùi ra sau cradle như thử ban đầu khiến cả buồng và ray rơi ra ngoài khung
nhìn.

**Kiểm tra:** 56/56 test pass, không đổi so với mục 36 (thay đổi thuần trình bày, không đụng luật).
Xác nhận trực tiếp trên preview: bắn một phát BLUE, HUD chuyển sang YELLOW/cam/xanh lá — mô hình súng
đồng bộ đúng thứ tự và màu ở cả ba phần (buồng nạp vàng phát sáng, viền họng vàng, ray xếp cam→xanh lá→
lam).

---

## 38. HUD bỏ CURRENT/NEXT, thay bằng thanh tiến độ dọc theo từng màu (26/08)

Sau mục 37, mô hình súng đã tự nói nó đang cầm đạn gì và hàng chờ có gì — HUD lặp lại đúng thông tin đó
là thừa. Bỏ hẳn hai ô `CURRENT` và `NEXT` (`app/SandGame.tsx`), chỉ giữ `SHOTS`. Kéo theo đó, các class
`.ammo-bullet`, `.ammo-pip`, `.ammo-queue`, `.ammo-last` và hai keyframes `bullet-load`/`pip-shift` bị
xoá khỏi `app/globals.css`; `currentAmmo`/`nextAmmo` không còn được import trong `SandGame.tsx`.

Thay vào chỗ trống là một **thanh tiến độ dọc cho mỗi màu có trong tranh**, fill từ dưới lên theo phần
cát màu đó đã được dọn khỏi khung. Không hiện phần trăm, không hiện số ô — cả điểm của một thanh là
liếc một cái là đủ, có con số bên cạnh thì người chơi sẽ đọc số thay vì nhìn thanh. Thanh nào càng đầy
thì **càng dày**: `width` nội suy từ `9px` (0%) tới `20px` (100%) theo cùng biến `--fill` điều khiển
chiều cao phần fill, nên mức tiến độ vẫn đọc được khi nhìn thoáng qua hoặc với người không phân biệt
được hai tông màu cạnh nhau.

Vài quyết định đáng ghi:

- **Mốc đo là riêng từng màu**, không phải toàn bức tranh: một màu chỉ có chục hạt phải đọc là *xong*
  khi chục hạt đó hết, chứ không phải một vệt mỏng bên cạnh màu chiếm nửa khung.
- **Thứ tự thanh theo `SAND_COLORS` canonical**, không theo hàng chờ đạn — nếu theo hàng chờ thì thanh
  sẽ nhảy ngang mỗi lần một màu sạch hẳn và rời bánh xe.
- **Track rỗng vẫn được tô nhạt màu của nó** (`color-mix` 84% trong suốt). Lần đầu để track trắng mờ
  thì một thanh chưa ai chạm vào không cho biết nó đang chờ màu nào.
- Phần fill bo tròn **chỉ ở đỉnh**, để track bo tròn + `overflow: hidden` lo phần đáy — bo tròn cả hai
  đầu khiến thanh mới fill một ít trông như viên thuốc trôi lơ lửng trong ống.
- `role="progressbar"` + `aria-valuenow` vẫn mang con số cho screen reader; yêu cầu bỏ số là bỏ **trên
  màn hình**, không phải bỏ với người dùng trợ năng.

**Kiểm tra:** 56/56 test pass (thay đổi thuần HUD, không đụng luật). Xác nhận trực tiếp trên preview
sau 7 phát bắn: HUD chỉ còn `SHOTS 20`; bốn thanh đọc GREEN 18% (rộng 10,9px), YELLOW 15% (10,6px),
BLUE 46% (14,1px), ORANGE 0% (9px) — bề dày tăng đúng theo mức fill.

---

## 39. Home screen trở lại, với bức tranh pixel thay cho khối lập phương xoay (26/08)

Bản pivot ở mục 35 bỏ luôn menu hub của kiến trúc cũ — game vào thẳng màn chơi. Dựng lại home screen
theo đúng hình dạng cũ (`hub-screen` / `hub-tap` / `hub-level-name` / `TAP TO PLAY`, kể cả keyframes
`hub-enter` và `hub-play-pulse`), nhưng đổi phần trung tâm: trước là một khối lập phương 3D xoay tại
chỗ, giờ là **chính bức tranh pixel của level**.

Điểm mấu chốt về mặt kiến trúc: home screen **không vẽ đè** lên scene, nó *đóng khung* scene. Không có
canvas hay ảnh thumbnail riêng nào được dựng cho màn hình này — thứ người chơi nhìn thấy ở giữa là
scene three.js thật, đang render bức tranh trong khung của nó, chỉ là không được chơi. Thêm
`setIdle(boolean)` vào `SandCannonEngine` để nói đúng điều đó: khác với `pause()` của tab bị ẩn,
`setIdle(true)` vẫn để scene được render (vì tranh chính là artwork của home screen), chỉ dừng phần
*chơi* — không tick, không ngắm, và gỡ luôn crosshair khỏi một màn hình chẳng có gì để nhắm.

Thanh nút dưới đáy, trái sang phải: **Shop · Skin · Home · Gallery · Customize**. Trong đó:

- **Home** là chính màn hình này — chạm bất kỳ đâu để vào chơi.
- **Gallery** là thật: liệt kê mọi level kèm thumbnail pixel dựng từ `level.rows` của **blueprint gốc**
  (không phải board đã mở rộng — mở rộng trước rồi render sẽ tốn hàng trăm ô cho mỗi thumbnail để hiện
  đúng bức ảnh đó). Chọn một bức thì home screen đổi sang bức đó ở trạng thái chưa chơi.
- **Shop / Skin / Customize** chưa có gì đằng sau. Chúng mở một panel nói rõ mục đó dùng để làm gì và
  **"Not built yet"** — thanh nút được yêu cầu dựng bây giờ, còn nội dung thì chưa tồn tại, nên chúng
  nói thẳng thay vì giả vờ.

Vài chi tiết đi kèm: nút `⌂` được thêm vào cột công cụ trong màn chơi và một nút `Home` vào màn kết
quả, để có đường về; về home luôn dựng lại board sạch, vì home screen hứa hẹn bức tranh *như lúc được
vẽ ra*. HUD và cột công cụ bị `hidden` khi đang ở home — không cái nào trong đó là sự thật trước khi
level thực sự bắt đầu. Khi một mục đang mở, nền không phải backdrop bấm-xuyên-qua mà là một nút đóng
mục đó, để chạm ra ngoài không khởi động một level người chơi chưa hề chọn. Handler `visibilitychange`
nay cũng xét `playing`: một tab quay lại không được trao quyền điều khiển cho người đang nhìn menu.

**Kiểm tra:** 56/56 test pass, lint sạch, `npx tsc` không lỗi mới. Xác nhận trực tiếp trên preview:
home screen hiện tên level, tranh pixel và thanh 5 nút với Home đang active; Gallery liệt kê đúng 3
level kèm thumbnail và đánh dấu level đang chọn; Shop mở panel placeholder đúng nội dung; chạm play thì
HUD + cột công cụ hiện ra và engine bỏ trạng thái idle — đo được `paused: true` lúc ở home và
`paused: false` 60ms sau khi chạm, thao tác ngắm bắt đầu bình thường ngay sau đó.

*(Ghi chú môi trường: preview pane của công cụ tự động báo `document.hidden === true` giữa các lệnh,
nên handler tab-ẩn pause engine liên tục và `requestAnimationFrame` gần như không chạy. Đây là hành vi
đúng của game, không phải lỗi — chỉ cần biết khi test bằng automation.)*

---

## 40. Hai map mechanic để playtest: Lock & Key, và gió (26/08)

Cả hai được cài **hoàn toàn bằng data của level**, không phải nhánh code song song. Một level không
dùng tới chúng đọc và chạy y hệt như trước khi chúng tồn tại, và cả hai vẫn nằm trong đúng
`RADIUS_GAMEPLAY` cũ.

### Lock & Key

Bảng chữ cái của tranh được mở rộng theo cách không tốn thêm kênh dữ liệu nào: **chữ thường là cát bị
khoá** (`p` là tím đóng băng), **`K` là chìa khoá**. Cả hai sống sót qua `expandLevelForPixelBoard`
nguyên vẹn vì bước mở rộng chỉ nhân bản chữ cái.

Cát khoá **vẫn là cát**: có màu, chiếm ô, đỡ cát khác và tính vào điều kiện thắng. Nó chỉ không rơi và
không bị đĩa bắn nhìn thấy (`cellsInRadius` nhận thêm tham số `frozen` và loại hẳn chúng ra — cát khoá
không phải mục tiêu cứng mà là thứ đĩa *không thấy*, nên bắn vào ổ khoá vẫn hút được cát rời cùng màu
xung quanh). Vì không rơi nên nó lơ lửng giữa khung, đúng yêu cầu.

Chìa khoá là một **sprite pixel cứng**, không phải hạt cát: cả khối cùng di chuyển hoặc không ai đi.
Một chìa khoá vỡ vụn thành từng pixel ở lần rơi đầu tiên thì không còn đọc ra là một vật thể, mà cơ chế
này nói về việc một vật thể *đến được một chỗ*. Chạm vào ô khoá nào thì **cả vùng khoá liền kề** tan
băng cùng lúc — mở nửa vùng sẽ đọc thành "chìa khoá trượt" — và chìa khoá mất đi.

Solver được viết lại quanh một `World` dùng chung (`sand-rules.ts`): mỗi vòng chạy lần lượt *cát rơi →
chìa khoá rơi → kiểm tra mở khoá*, lặp tới khi đứng yên. Ba thứ này nuôi nhau nên không thể chạy tuần tự
tách rời: cát rơi làm chìa khoá tụt xuống, chìa khoá tụt xuống mở ổ khoá, ổ khoá mở ra là một đống cát
mới không còn gì đỡ. Hai `SettleStep` mới, `KEY_MOVE` và `UNLOCK`, để renderer phát lại đúng thứ tự đó.

**Sửa kèm một lỗ hổng luật:** một màu bị khoá *toàn bộ* mà vẫn được bánh xe phát ra thì đúng là dead
bullet mà `deadBulletPolicy` sinh ra để cấm. `shootableColors` nay chỉ tính màu còn ít nhất một hạt
chưa khoá, và `advanceQueue` cho màu đó **quay lại** bánh xe ngay khi khoá mở — nếu chỉ biết loại bỏ thì
màu vừa được giải phóng sẽ vĩnh viễn không có đạn để bắn.

### Gió

`wind: { everyMs, direction, strength }` trên level. Một cơn gió đẩy mọi hạt cát rời sang ngang
`strength` ô (quét từ mép xuôi gió vào, nếu không cát dồn cục), rồi trả board thẳng về **đúng solver rơi
cũ** — nên cát bị thổi khỏi mép rơi y như cát vẫn rơi, và level có gió vẫn đoán trước được hệt như level
không gió. Cát khoá không nhúc nhích. Chìa khoá thì có, nên gió tự nó có thể mở một ổ khoá — có test
khoá đúng hành vi đó.

Gió **không tiêu lượt** và không bao giờ làm thua: ngân sách chỉ động khi người chơi bắn. Đồng hồ nằm ở
engine chứ không ở rules (`sand-rules.ts` vẫn đúng lời hứa "không có đồng hồ"), và engine không bao giờ
cho gió nổi giữa lúc đạn đang bay hay cát đang rơi — board người chơi ngắm phải là board viên đạn hạ
xuống, đúng thứ §21 sinh ra để bảo vệ. Bộ đếm vẫn chạy trong lúc đó, nên cơn gió bị hoãn sẽ đến ngay khi
board thuộc về người chơi trở lại.

### Trình bày và editor

Cát khoá được vẽ phủ sương băng thở nhẹ ~0,55 Hz (cả vùng thở như một tấm, không phải từng hạt lấp lánh)
và giữ nguyên màu gốc bên dưới, vì màu đó là thứ bánh xe phải chuẩn bị đạn cho. Chìa khoá vẽ màu vàng
kim — không màu nào trong palette là vàng kim — và vẽ **sau cùng**, để chìa khoá nằm trong hốc không bị
cát lấp mất. Mở khoá thì loé trắng rồi trở về màu thật.

Editor: nút `❄ Locked` là **modifier của cọ** chứ không phải tool riêng (khoá là một *trạng thái của
một màu*, nên phải vẽ bằng một màu), `Key` là tool riêng, và có mục **Wind** trong panel settings.
Validate và "settle" của editor nay đều nhận lock/key, nếu không một slab đứng yên *vì bị khoá* sẽ bị
báo nhầm là đang sụp. Thêm hai luật author: khoá mà không có chìa là **error** (cát đó không bao giờ
giải phóng được), chìa mà không có khoá là warning.

### Hai lỗi thật tìm được khi playtest

1. **Gió thổi ngay trên home screen.** Effect `setIdle` chỉ phụ thuộc `[playing, runId]`, nên khi engine
   bị dựng lại vì một lý do khác thì engine mới không bao giờ được báo là đang idle — và nó chạy tiếp
   sau màn hình chính, tự thổi bay bức tranh của chính nó. Sửa bằng cách bỏ `engineRef` và giữ engine
   trong **state**, để chính instance engine làm dependency: một engine mới luôn được báo, ngay trong
   commit nó xuất hiện. (Ref không thể làm dependency — đó chính là cái bẫy.)
2. **`4% cleared` ngay khi mở màn Lock & Key.** `startingCells` đếm mọi ký tự khác `.`, nên hai ô chìa
   khoá bị tính là cát trong mẫu số nhưng không bao giờ nằm ở tử số.

Nhân tiện bọc `setPointerCapture` của canvas editor trong try/catch, giống hệt lý do engine đã làm từ
trước: capture ném lỗi với con trỏ trình duyệt không theo dõi, và mất cả nét vẽ vì chuyện đó thì không
đáng.

**Kiểm tra:** 71/71 test pass (thêm `tests/sand-mechanics.test.ts`, 15 test mới, và đưa file này vào
`npm test`); lint sạch; `npx tsc` không lỗi mới. Xác nhận trực tiếp trên preview: `Lock & Key` — bắn nút
chặn vàng → chìa khoá rơi → slab tan băng → tím đổ xuống sàn **và viên đạn tím xuất hiện trên ray**;
`Crosswind` — cảnh báo "Gust incoming →", đống cát dịch dần sang phải qua từng cơn, `SHOTS` không đổi;
home screen của cả hai đứng yên hoàn toàn.

---

## 41. Gió thành một vòng lặp pha, dựng được trong editor (26/08)

Mục 40 chốt gió ở dạng một cơn đơn lẻ: `{ everyMs, direction, strength }`. Nó chỉ tả được "cứ X giây
lại thổi một hướng", không tả được một *pattern*. Thay bằng một **vòng lặp các pha**, `wind: { phases }`,
chạy hết danh sách rồi quay lại đầu. Mỗi pha khai báo năm thứ đúng như yêu cầu: `direction`,
`durationMs`, `cooldownMs`, `power`, `zone`.

Điểm thiết kế đáng ghi: một pha là **một quãng thời tiết**, không phải một cú đẩy. Nó gust lặp lại suốt
`durationMs` (cách nhau tối thiểu `WIND_GUST_INTERVAL_MS`, và luôn chờ board đứng yên). Tách "thổi bao
lâu" khỏi "đẩy mạnh bao nhiêu" là lý do "gió nhẹ kéo dài" và "một cú tát" trở thành hai thứ khác nhau
viết được; nếu chỉ có một con số `strength` thì cả hai là cùng một thứ.

`zone` là hình chữ nhật tính bằng blueprint cell, `null` là cả khung. Một hạt được thổi khi nó **bắt
đầu** trong zone — bị mang thêm một ô ra ngoài mép chính là hình ảnh đúng của một ranh giới gió; nếu
chặn lại thì đó là một bức tường, không phải thời tiết. Và phần **rơi thì không bị zone giới hạn**: gió
với tới đâu là chuyện của gió, còn trọng lực là của cả khung. Có test riêng cho điều này trên một board
6×3 dựng tay, vì trên level thật cát bị thổi dọc đỉnh đồi rồi rơi *xuyên qua* đáy zone — đúng nhưng làm
nhiễu hẳn thứ đang cần đo (test đầu tiên mình viết đã chết vì đúng chuyện đó).

`power` và `zone` được `expandLevelForPixelBoard` scale cùng board; `durationMs`/`cooldownMs` là thời
gian thật nên **không** scale — có test khoá cả ba.

`Crosswind` viết lại thành ba pha để thấy vòng lặp dùng để làm gì: đẩy phải dài trên cả khung → một cú
tát trái ngắn và mạnh **chỉ ở nửa trên**, nên đỉnh đồi bị hất về còn chân đồi thì không → rồi trôi phải
nhẹ. Sự kiện engine tách thành `WIND_INCOMING` / `WIND_START` / `WIND` / `WIND_END`, HUD báo "Wind
picking up →" trước và "The air is still" khi pha kết thúc.

**Editor** dựng cả vòng lặp: mỗi pha là một thẻ có thêm/xoá/đảo thứ tự (thứ tự *chính là* vòng lặp, nên
danh sách được đánh số và sắp xếp được, không phải một nhúm setting rời), năm trường ở trên, và bấm tiêu
đề pha thì **zone của nó vẽ đè lên tranh** — bốn con số trong sidebar thì không hình dung được, hình chữ
nhật trên chính bức tranh thì có. Validate thêm luật cho từng pha (power ≥ 1, thổi ≥ 0,2s, cảnh báo khi
nghỉ < 0,6s hoặc zone tràn ra ngoài khung). Draft cũ trong localStorage được **migrate** chứ không bị
bỏ: một cơn `everyMs` cũ dịch thành vòng lặp một pha thổi 0,8s rồi nghỉ nốt phần còn lại của chu kỳ —
đúng thứ nó vẫn luôn làm. Export TypeScript in ra khối `wind.phases` dán thẳng được.

**Một lỗi thật, không thuộc phần gió, sửa luôn vì nó chặn chính việc kiểm chứng.** Điều hướng client
sang `/editor` để lại một màn loading **mới** đè lên trang đã mount xong: màn loading được server-render
trong root layout (chủ đích, để nó nằm trong HTML đầu tiên trình duyệt vẽ), nhưng cái giá là một lần
điều hướng client sẽ dựng lại layout và chèn một cái mới — sau khi trang bên dưới đã gọi `finishLoading`.
Không gì gỡ nó nữa. `loading-screen.ts` nay ghi nhớ rằng loading đã xong, và từ đó bất kỳ màn loading nào
xuất hiện thêm đều là đồ cũ: một `MutationObserver` gỡ nó ngay. `advanceLoading` cũng thành no-op sau
khi đã xong — một trang mount sau đó không được bắt đầu đổ đầy lại một thanh chẳng còn gì để chờ.

**Kiểm tra:** 76/76 test pass (thêm 5 test cho vòng lặp, zone và scale); lint sạch; `npx tsc` không lỗi
mới. Xác nhận trực tiếp trên editor: bật gió → hai thẻ pha với đủ năm trường, đổi hướng/bật zone cập
nhật đúng summary (`← 2.0s · rest 3.5s · power 1 · zoned`), chọn pha thì zone vẽ lên canvas (đo pixel:
trong zone bị nhuộm xanh, ngoài zone giữ nguyên màu cát), draft cũ migrate thành `0.8s · rest 4.2s`, và
Export TypeScript in ra đúng khối `phases`.

---

## 42. Chìa khoá có hình chìa khoá thật, cát khoá tối đi và đeo ổ khoá (26/08)

Hai thứ đến giờ mới chỉ là *quy ước màu*: chìa khoá là mấy ô vàng tuỳ tác giả quét ra, cát khoá là một
lớp sương xanh nhạt. Cả hai giờ là hình vẽ thật.

**`app/game/sand-sprites.ts` — một chỗ duy nhất cho cả hai hình.** Chúng được vẽ hai lần (engine lên
board pixel thật, editor lên canvas preview), nên để hai bản sao là mở đường cho việc editor đặt được
một chìa khoá mà game vẽ ra hình khác. `KEY_SPRITE` là vòng khuyên rỗng + thân + ngạnh, 3×5 — nhỏ nhất
mà vẫn đọc ra là chìa khoá thay vì một cục. Vòng khuyên rỗng có chủ đích: cái lỗ chính là thứ làm
silhouette đọc được, và cát cứ việc nằm trong đó. Mọi ô đều liền nhau 4-hướng, và **điều đó bắt buộc** —
`parseSandLevel` gom ô `K` theo connectivity, nên một sprite có pixel rời sẽ âm thầm biến thành hai chìa
khoá. Có test khoá đúng tính chất này cho cả hai sprite.

**Tool Key thành công cụ đóng dấu, có chỉnh cỡ.** Chìa khoá là một *shape*, nên quét tay là sai từ gốc:
tác giả sẽ có một chìa khoá mà mình chưa từng chọn silhouette. Nút `Key` giờ đóng dấu cả hình; cạnh nó
là `− key ×N +`, chỉ hiện khi đang cầm tool đó. Bấm lại lên một chìa khoá đã có thì **nhấc nguyên khối
lên** — đó chính là cách đổi cỡ: nhấc, chỉnh, đặt lại. Dấu được canh giữa điểm bấm rồi đẩy ngược vào
trong khung, nên đặt sát mép vẫn ra nguyên con.

Trong lúc test phát hiện ×3 trên board 12×14 bị **cắt cụt âm thầm** (chìa khoá cao 15 ô, khung cao 14).
Cỡ tối đa nay bị chặn theo kích thước khung — một chìa khoá bị cắt là một silhouette *khác*, không phải
một chìa khoá to — và giới hạn được áp lại lúc đóng dấu chứ không chỉ lúc bấm nút, vì khung có thể bị
thu nhỏ sau khi đã chọn cỡ.

**Cát khoá: tối đi, không nhuộm màu.** `LOCK_DARKEN = 0.62` nhân thẳng vào màu hạt thay cho lớp sương
xanh cũ. Lý do không dùng một lớp nhuộm màu: màu bên dưới vẫn phải đọc được, vì nó chính là viên đạn
bánh xe sẽ phát khi khoá mở — làm tối thì nói được "ngoài cuộc chơi" mà vẫn giữ nguyên hue. Bỏ luôn nhịp
"thở" của lớp sương: người dùng yêu cầu một cái nhìn cụ thể, và icon ổ khoá gánh phần ý nghĩa rồi.

**Ổ khoá vẽ giữa mỗi vùng khoá.** Scale vừa vùng, có chừa lề, và **bỏ hẳn** khi vùng quá nhỏ — một ổ
khoá tràn ra ngoài chỗ nó đang chú thích thì đọc thành rác. Chỉ vẽ phần rơi trúng ô đang khoá, vì một
vùng không nhất thiết là hình chữ nhật. Có bóng đổ 1 pixel dưới cả ổ khoá lẫn chìa khoá, vì cả hai nằm
trên nền cát mà renderer không được chọn màu. Vùng khoá chỉ tính lại khi tập ô khoá thay đổi (một lần
lúc load, một lần mỗi ổ khoá mở), không phải mỗi frame.

Level `Lock & Key` vẽ lại quanh sprite: chìa khoá là `KEY_SPRITE` scale 1, slab dày 3 ô thay vì 2 để ổ
khoá có chỗ hiện, và plug rộng 6 ô để chìa khoá — vốn cứng — bị chặn cả ba hướng xuống, xuống-trái và
xuống-phải.

**Một chỗ lệch nữa tự tìm ra khi so hai bên:** editor tính cỡ ổ khoá ở độ phân giải *blueprint* còn game
tính ở độ phân giải *pixel*. Với slab 8×3 ở `pixelScale: 5`, game hiện ổ khoá còn editor thì không. Nay
editor tính ở đúng độ phân giải board thật rồi thu lại để vẽ (toạ độ icon trả về theo đơn vị "một ô
blueprint", nên vẽ được ở cỡ nhỏ hơn một ô). Đó chính là loại drift mà module sprite dùng chung sinh ra
để chặn.

**Kiểm tra:** 79/79 test pass (thêm 3 test: hai sprite liền khối, scale không đổi hình, và ổ khoá vừa
slab của level đang ship). Lint sạch, `npx tsc` không lỗi mới. Xác nhận trực tiếp: trong game `Lock &
Key` hiện chìa khoá vàng có vòng khuyên rỗng và slab tối đen đeo ổ khoá trắng ở giữa, bắn xong slab tan
băng thành tím sáng bình thường và đạn tím vào buồng; trong editor đóng dấu được chìa khoá ×1 và ×2 đúng
silhouette, `+` bị chặn ở ×2 trên board 12×14, bấm lại nhấc nguyên chìa khoá, và vùng khoá hiện ổ khoá ở
độ phân giải khớp game.

---

## 43. Editor vẽ ở đúng độ phân giải board, cọ chỉnh cỡ được (26/08)

Cho tới giờ editor vẽ một **blueprint** nhỏ — mặc định 12×14 — rồi game phóng nó lên bằng `pixelScale`
lúc load. Đó là một lời nói dối tác giả phải tự giữ trong đầu: họ đặt một bức tranh 12 ô còn game chạy
một bức 60 pixel, nên **không thứ gì họ vẽ ra đúng là thứ sẽ được chơi** — một ô trong tool là một khối
5×5 trong game, và mọi thứ tinh hơn thế đơn giản là không vẽ được.

Lưới trong editor giờ **chính là board pixel thật**. Mặc định 60×70 (đúng cỡ level đang ship),
`pixelScale` luôn `1`, và ô chọn scale trong panel settings đã bị bỏ — không còn hệ số nào nằm giữa cái
được vẽ và cái được chơi để mà chọn. Bounds đổi từ 6–24 / 6–28 sang **12–90 / 12–100 pixel**;
`PIXEL_BUDGET` vẫn là 4.500 nhưng giờ đúng nghĩa là ngân sách *cảnh báo*, vì một board 90×100 vượt nó mà
vẫn hợp lệ.

Cái giá phải trả là **cỡ cọ**, và đó chính là thứ được yêu cầu: `− brush Npx +` cạnh tool Brush/Eraser,
nib vuông canh giữa con trỏ (lệch lên-trái ở cỡ chẵn để con trỏ luôn nằm trong nét của chính nó), cắt
theo biên khung chứ không cuộn vòng. Mặc định 5px — đúng bằng một ô blueprint cũ, nên một nét cọ vẫn là
đơn vị mà tác giả đã quen.

Lưới cũng phải đổi: một đường kẻ mỗi pixel không còn là lưới mà là một lớp xám phủ. Lưới mảnh chỉ vẽ khi
mỗi ô ≥ 9px màn hình, còn lưới guide mỗi 10 pixel thì luôn có để đếm.

**Draft cũ được migrate, không bị bỏ.** `expandDraftToPixels` phóng một draft blueprint đúng bằng hệ số
game vốn sẽ phóng nó — cùng `sortRadius` và cùng gió — rồi đặt `pixelScale: 1`. Nghĩa là nó cho ra chính
bức tranh tác giả vẫn đang chơi, không phải một bức khác. Hàm này idempotent, và `loadDrafts` chạy nó
cho mọi draft đọc lên. `expandLevelForPixelBoard` vẫn còn nguyên cho level viết tay — `sand-levels.ts`
vẫn dùng `pixelScale: 5`.

### Chìa khoá: cỡ tính bằng pixel, vật lý được chứng minh

Cỡ chìa khoá giờ tính bằng **board pixel**: mặc định ×5 → `key 15×25px · ×5`, đúng cỡ chìa khoá của
level đang ship. Nhãn hiện **cả hai con số** vì tỉ lệ là thứ nút đang chỉnh còn cỡ pixel là thứ tác giả
đang hình dung. Trần tỉ lệ nâng từ 4 lên 16 (ở độ phân giải pixel, ×1 là một chấm 3 pixel), vẫn bị chặn
theo kích thước khung.

Phần vật lý — gravity, rơi, trượt, bay theo gió — thực ra **đã chạy từ mục 40**; cái thiếu là bằng chứng
nó chạy. Thêm 5 test trên board nhỏ đủ để phát biểu đáp án chính xác thay vì mô tả:

- rơi tự do tới khi có thứ chặn, và **rơi từng ô một** (≥ 7 bước `KEY_MOVE`, không teleport)
- trượt khỏi mép thay vì cân bằng trên góc, và tới nơi với đủ từng pixel nó xuất phát
- gió mang nó đi đúng `power` ô rồi trọng lực vẫn kéo nó xuống
- **tính cứng**: bắc ngang một khe rộng 1 ô mà cát sẽ lọt qua
- đổi tỉ lệ ra cùng một vật thể, chỉ to hơn — không vỡ thành nhiều mảnh

Test cuối tìm ra một tính chất đáng biết: **một chìa khoá có ô nằm ngoài khung thì không nhúc nhích
được**, vì một nước đi cứng đòi *mọi* ô đích hợp lệ và ngoài biên tính là bị chặn. Editor đã chặn không
cho đặt như vậy (`maxKeyScale` + clamp gốc), nhưng level viết tay thì cần biết.

**Kiểm tra:** 86/86 test pass (5 test vật lý chìa khoá, 1 test migration, và cập nhật loạt test editor
sang bounds pixel). Lint sạch, `npx tsc` không lỗi mới. Xác nhận trực tiếp trên editor: draft mới là
60×70 với guide grid mỗi 10; cọ 15px vẽ đúng 225 ô; đóng dấu chìa khoá ×5 ra đúng 275 ô (11 pixel sprite
× 25) và hiện đúng silhouette. Migration: nạp một draft 12×14 `pixelScale: 5` kiểu cũ → editor mở ra
60×70, 300 hạt (12 × 25), `sortRadius` 2,5 → 12,5, gió `everyMs: 5000` → pha `0.8s · rest 4.2s ·
power 5`; và level đó chơi được trong game.

---

## 44. Chìa khoá thành viên tròn lăn được, có friction chỉnh trong editor (26/08)

Bỏ hẳn silhouette chìa khoá cũ (vòng khuyên + thân + ngạnh). `sand-sprites.ts` thêm `circleCells(radius)`
— sinh trực tiếp một đĩa đặc bán kính tính bằng **board pixel**, không còn qua bước "sprite nhỏ cố định
rồi nhân bội số nguyên" như trước. Đó cũng là câu trả lời cho câu hỏi "sao không chỉnh được từng pixel
như grain cát": bản cũ chỉ nhảy theo bội số của một sprite 3×5, giờ bán kính tăng 1 là đĩa to thêm đúng
1 pixel mọi hướng — đúng đơn vị một hạt cát vốn đã là. Ngưỡng khoảng cách dùng `r² + r×0.4` thay vì `r²`
thuần, vì phép thử tâm-pixel ở đúng `r²` làm rụng 4 ô đầu trục và để đĩa chỉ còn liền 8-hướng ở vòng eo
— `parseSandLevel` cần liền 4-hướng để đọc cả đĩa là một chìa khoá.

**Vật lý lăn** không phải xây mới — solver rơi/trượt chéo cho cả khối đã có từ mục 40, chỉ đổi hình dạng
cầm trên tay. Cái thêm thật sự là **friction**: `keyFriction` (0–1) trên level, chỉnh bằng slider trong
mục mới "Key friction" của editor. Cơ chế: tách `moveKey` (di chuyển vô điều kiện) khỏi `keyCanMove`
(kiểm tra thuần), rồi thêm `rollKey` — mỗi lần một nước đi **ngang** khả thi mà chưa được đi, nó tăng bộ
đếm chờ `world.keyRollWait`; đủ `round(friction × 4)` lần chờ mới thực sự di chuyển và reset bộ đếm. Rơi
thẳng đứng (`dx=0`) không bao giờ qua cổng này — friction chỉ cản cái ngang, giống ma sát thật không bao
giờ chống lại trọng lực. Bộ đếm dùng chung giữa lăn tự nhiên (`keyPass`) và bị gió thổi (`windPass`), vì
cả hai đều là "đi ngang" và một chìa khoá nặng phải cưỡng cả hai như nhau.

Một tính chất hay: vì vòng settle có ngân sách pass rất lớn (`frame.width * frame.height`), friction chỉ
**làm chậm nhịp lăn** — không đổi vị trí nghỉ cuối cùng một khi có đủ thời gian để hoàn tất. Có test
khoá đúng điều đó (cùng kịch bản, friction 0 và 1, vị trí nghỉ cuối giống hệt nhau); friction chỉ thật
sự cắt bớt quãng đường trong một cửa sổ *giới hạn* như một cơn gió (`strength` cố định), nên bài test
đo tác dụng thật của nó ở đó.

**Editor:** cỡ chìa khoá đổi từ "ratio ×N của sprite" sang "bán kính, ±1px mỗi lần bấm" — trực tiếp trả
lời câu hỏi thứ hai. Nhãn hiện đường kính (`key ⌀17px`). Đóng dấu/nhấc vẫn hoạt động y hệt (generic trên
danh sách ô, không quan tâm hình gì).

**Renderer:** chìa khoá vẽ như một quả cầu thật — sáng ở giữa (`KEY_HIGHLIGHT_RGB`), tối dần ra mép
(`KEY_EDGE_RGB`), cộng một **chấm đánh dấu đỏ xoay theo rìa** để "đang lăn" nhìn thấy được chứ không chỉ
là dịch chuyển. Góc xoay tích luỹ trong `keyRotation` (một `Map<id, radians>`), cập nhật mỗi bước
`KEY_MOVE` có `dx≠0` bằng `dx / radius` — rơi thẳng đứng không làm nó xoay, đúng vật lý một quả bóng thả
rơi không tự quay.

Level `Lock & Key` vẽ lại: `K` giờ là `circleCells(1)` (một dấu cộng 5 ô, bounding box 3×3) đặt ở
rows2-4 thay vì rows0-4 cũ, nghỉ đúng trên nút chặn vàng như trước.

**Kiểm tra:** 88/88 test pass (thêm 9 test: rơi/trượt/gió/tính cứng cho hình tròn, 2 test friction, và
đổi bộ test sprite cũ sang kiểm circleCells liền khối + tăng dần theo bán kính); lint sạch; `npx tsc`
không lỗi mới. Xác nhận trực tiếp: trong game, `Lock & Key` hiện chìa khoá tròn có shading cầu và chấm
đỏ, slab tối vẫn đeo icon khoá; bắn nút chặn thấy hạt vàng giảm đúng tỉ lệ. Trong editor: đóng dấu chìa
khoá tròn (không phải chữ K) tại đúng vị trí bấm, nút `−` đổi bán kính đúng 1px mỗi lần (17→15), slider
friction đồng bộ đúng với draft (`Friction 0.7`), và Export TypeScript in đúng dòng `keyFriction: 0.7,`.

---

## 45. Chìa khoá thành sprite tròn 2D thật, không còn rasterize thành pixel (26/08)

Mục 44 vẽ chìa khoá tròn bằng cách tô từng ô lưới của canvas cát theo đúng shading một quả cầu — đọc ra
là tròn, nhưng dưới đáy vẫn là các ô vuông rời rạc ghép lại (mosaic), không phải một vật thể mượt. Yêu
cầu lần này: chìa khoá không còn là pixel nữa.

Vật lý và dữ liệu **không đổi** — `circleCells(radius)` vẫn sinh footprint đĩa cho solver rơi/trượt/va
chạm, editor vẫn vẽ theo lưới để canh vị trí. Cái đổi chỉ là **cách vẽ trong game thật**: chìa khoá giờ
là một `THREE.Mesh` riêng (`THREE.CircleGeometry(1, 40)`, đơn vị, scale theo bán kính từng key), không
còn đi qua `writePixel` vào canvas cát. Toàn bộ khối vẽ pixel cũ (~35 dòng shading theo rim + rotation
mark) bị xoá khỏi `redrawSand`.

Texture bake **một lần, dùng chung cho mọi key**: gradient vàng sáng-giữa/tối-mép vẽ bằng
`createRadialGradient` trên một canvas 128×128 riêng, cộng một chấm đỏ đánh dấu ở rìa. Chỉ transform
(`position`/`scale`/`rotation.z`) khác nhau giữa các key — không có gì cần nhân bản theo instance.

`updateKeyMeshes()` chạy mỗi tick: đọc lại `this.keys` (vẫn là nguồn sự thật từ solver, không đổi) và
đặt lại vị trí/scale/góc xoay của mesh tương ứng. Vật lý vẫn rời rạc theo lưới — solver không biết gì về
"sprite" — nhưng hình ảnh giờ liên tục và mượt, không giật theo từng ô khi lăn.

Dọn kèm: bỏ 4 hằng màu pixel (`KEY_RGB`, `KEY_EDGE_RGB`, `KEY_HIGHLIGHT_RGB`, `KEY_MARK_RGB`) không còn
dùng; texture không nằm trong danh sách `track()` (chỉ nhận geometry/material) nên được dispose riêng;
mesh của mỗi key được gỡ khỏi scene ngay khi `UNLOCK` xảy ra và khi engine `dispose()`.

**Kiểm tra:** 88/88 test pass (không đổi — bộ test nằm ở tầng rules, không phụ thuộc cách renderer vẽ);
lint sạch; `npx tsc` không lỗi mới. Xác nhận trực tiếp: `Lock & Key` hiện chìa khoá là một hình tròn
mượt thật (không còn cạnh răng cưa của pixel), gradient sáng-tối rõ và chấm đánh dấu; bắn nút chặn vàng
thấy sprite vẫn đứng đúng vị trí trong lúc cát bên dưới bị bào mỏng. Editor không đổi hành vi — vẫn vẽ
lưới để canh vị trí lúc thiết kế.

---

## 46. Chìa khoá quay lại thành một silhouette lởm chởm, không tròn không lăn (26/08)

Người dùng gửi một ảnh tham chiếu — một hình pixel gồ ghề (một notch, một thanh ngang bắc cầu, hai
"chân" thõng xuống) — và yêu cầu bỏ hẳn hình tròn của mục 44/45, thay bằng đúng shape đó, cùng độ trơn
trượt cao trên cát.

**Gỡ toàn bộ hệ thống mesh tròn của mục 45.** `SandCannonEngine.ts` từng có một `THREE.Mesh` riêng cho
mỗi chìa khoá (`keyGeometry`/`keyMaterial`/`keyTexture` dùng chung, texture bake gradient + chấm đánh
dấu, đồng bộ vị trí/scale/góc xoay mỗi tick qua `layoutKeyMesh`/`updateKeyMeshes`) — toàn bộ khối đó bị
xoá (`buildKeys`, `buildKeyTexture`, `keyWorldRadius`, `spawnKeyMesh`, `layoutKeyMesh`, `updateKeyMeshes`,
`disposeKeyMesh`, và field `keyRotation`/`keyMeshes`/`keyMeshRadius`/`keyGeometry`/`keyMaterial`/
`keyTexture`). Một mesh tròn tham số hoá không có cách nào đại diện một silhouette lởm chởm — cách đúng
là quay lại vẽ thẳng các ô của chìa khoá lên canvas cát, y hệt cách một hạt cát hay icon ổ khoá đã được
vẽ: một lớp bóng đổ 1px (`KEY_SHADOW_RGB`) rồi lớp vàng phẳng (`KEY_RGB`) đè lên, không tô cầu, không
đánh dấu góc xoay — một hình lởm chởm trượt thì không có "góc quay" nào để vẽ.

**`sand-sprites.ts`: `circleCells`/`circleDiameter` bị xoá, `KEY_SPRITE` trở lại** — nhưng là một hình
mới, không phải bản vòng-khuyên-thân-ngạnh của mục 42. Ba hàng: `.....##` (notch trên) / `.######` (thanh
ngang bắc cầu toàn bộ) / `..#.##.` (hai chân, một chân đơn và một chân đôi). Thanh giữa bắt buộc phải nối
liền mọi phần — nếu không notch trên và hai chân dưới sẽ tách rời nhau, phá vỡ yêu cầu liền-khối-4-hướng
mà `parseSandLevel` cần để đọc cả hình là một chìa khoá (đã tự kiểm bằng tay lúc thiết kế và bắt được lỗi
này ở bản nháp đầu).

**Editor quay lại mô hình sprite + bội số nguyên**, y hệt cách `PADLOCK_SPRITE` đã scale từ mục 42: nút
`− key 28×12px · ×4 +`. Không còn khái niệm "bán kính +1px" của mục 44 — phóng to một silhouette vẽ tay
theo từng pixel sẽ phá hình, chỉ phóng theo khối `scale×scale` mới giữ nguyên được silhouette.

**Level `Lock & Key` vẽ lại quanh sprite mới**, và đây là chỗ tốn công nhất: đặt sai plug/slab hai lần
trước khi ổn định. Lần đầu nới plug bằng đúng bề rộng slab (8 ô, khớp hoàn toàn) tưởng là an toàn hơn —
sai: cạnh ngoài của plug khi đó có đường chéo-xuống mở ra khoảng không hoàn toàn trống (không còn slab
đỡ bên dưới nữa), nên hai hạt vàng ở mép trượt chéo ra ngoài ngay từ frame đầu (`frozen sand hangs in
mid-air` báo 5 bước non-REINDEX thay vì 0). Plug hẹp hơn slab — thụt vào ít nhất 1 cột mỗi bên, đúng
thiết kế gốc của mục 40 — mới giữ an toàn: đường chéo từ mép plug vẫn rơi trúng slab bên dưới, không rơi
ra khoảng trống. Chìa khoá 7 ô rộng cũng theo đó **tràn ra ngoài plug 1 cột bên trái** — chủ đích để lại,
vì một vật rắn có ô không được đỡ vẫn hợp lệ (không giống cát), và test xác nhận nó vẫn nằm yên.

**Friction giữ nguyên nghĩa từ mục 45**, không đổi cơ chế — chỉ đổi tên gọi trong tài liệu từ "lăn" sang
"trượt" cho khớp shape mới. Level không khai `keyFriction` nên mặc định 0 — trơn trượt cao nhất, đúng
yêu cầu.

**Test:** thay hẳn bộ test dựa trên `circleCells` bằng bộ dựa trên `KEY_SPRITE`. Một lỗi test tự phát
hiện: so sánh hình chìa khoá đã đặt trên level với `spriteCells(KEY_SPRITE,1)` thô — nhưng sprite tự vẽ
tay có các hàng lùi vào khác nhau (không hàng nào bắt đầu ở cột 0), nên toạ độ thô của `spriteCells`
không tự động quy về gốc `(0,0)` như ô đã đặt trên level vẫn được; phải chuẩn hoá cả hai theo đúng gốc
riêng của chúng trước khi so. Ba test vật lý khác (rơi tự do, gió thổi, tựa trên một chân) đo được số
liệu khác con số cũ do shape bất đối xứng mới trôi lệch một cột khi rơi/trượt — không phải lỗi, là hệ quả
tất định của hình dạng, cập nhật lại con số mong đợi sau khi chạy thực tế xác nhận.

**Kiểm tra:** 87/87 test pass; lint sạch; `npx tsc` không lỗi mới. Xác nhận trực tiếp: trong game `Lock &
Key` hiện chìa khoá vàng silhouette lởm chởm (không tròn) với bóng đổ, slab vẫn tối đen đeo icon ổ khoá;
trong editor đóng dấu ra đúng silhouette đó tại vị trí bấm, nhãn hiện `key 28×12px · ×4` đúng bội số
nguyên thay vì bán kính.

---

## 47. Ship toàn bộ level từ editor thẳng vào `sand-levels.ts`, không cần copy-paste (27/08)

Trước đây "Export TypeScript" chỉ sinh sẵn một khối code rồi copy vào clipboard — tác giả vẫn phải tự mở
`sand-levels.ts`, dán, và tự tay thêm tên vào `BUILT_IN_LEVELS`. Yêu cầu: bấm một nút là xong, không cần
copy-paste, và level trong editor mất đi sau lần ship kế tiếp cũng phải biến mất khỏi file — không được
tồn đọng như rác.

**Vì sao không thể làm bằng một API route trong `app/`.** Dev/build target của project là Cloudflare
Workers (`worker/index.ts`, `wrangler.toml`); runtime đó không có filesystem thật, kể cả lúc chạy dev —
một route ở `app/api/...` gọi `fs.readFile`/`writeFile` sẽ luôn lỗi, không phải vấn đề permission mà là
API không tồn tại theo đúng nghĩa nó cần. Giải pháp: một server Node thuần chạy **tách riêng**,
`scripts/level-writer.mjs`, khởi động bằng `npm run level-writer`, song song với `npm run dev`. Editor gọi
tới nó qua `fetch("http://localhost:4787/ship-levels")`.

**Ghi đè toàn bộ, không cộng dồn.** Bản đầu ship từng level một (mỗi lần chỉ ghi đúng level đang chọn) —
lỗi lộ ra ngay khi dùng thật: ship xong level A rồi xoá A trong editor, level A vẫn nằm lì trong file mãi
mãi, vì không có gì để nói "level này không còn nữa". Sửa: nút đổi tên thành **"Ship all levels to
sand-levels.ts"**, mỗi lần bấm gửi *toàn bộ* danh sách draft đang có trong editor (bỏ qua draft nào còn
lỗi validate), và server **ghi đè hoàn toàn** một khối riêng trong file thay vì thêm nối đuôi. Khối đó
được khoanh vùng bằng hai marker `// ==== Editor-shipped levels ====` / `// ==== End editor-shipped
levels ====`; mọi thứ giữa hai marker bị xoá và viết lại mới từ đầu mỗi lần ship, còn ba level viết tay
(`sandBloom`, `lockAndKey`, `crosswind`) nằm ngoài khối nên không bị đụng tới. `EDITOR_LEVELS` — mảng các
const vừa sinh — được spread vào `BUILT_IN_LEVELS: [...sandBloom, lockAndKey, crosswind, ...EDITOR_LEVELS]`,
nên số level hiện trong game luôn đúng bằng số level đang có trong editor tại thời điểm ship gần nhất.

**Ba lỗi bắt được khi tự tay ship-thử nhiều vòng, trước khi tới tay người dùng:**

- **Line ending.** File giữ CRLF, còn regex/khối chèn ban đầu hard-code `\n` — khiến bước "đã có khai báo
  này chưa" luôn báo *chưa có* dù thật ra có, sinh ra khai báo trùng tên. Sửa: dò `eol` thật của file
  (`\r\n` hay `\n`) rồi build toàn bộ khối bằng `\n` thường, chỉ convert sang `eol` đúng **một lần duy
  nhất** ở bước cuối — convert nhiều lần sẽ biến `\r\n` sẵn có thành `\r\r\n`.
- **Thứ tự khai báo.** Một bản nháp giữa chừng cập nhật *nội dung* của một `const` đã tồn tại nhưng không
  *dời vị trí* nó — nếu const đó nằm sau dòng `BUILT_IN_LEVELS` mà mảng lại tham chiếu tới nó thì
  TypeScript báo "used before its declaration". Ghi đè trọn khối theo marker giải quyết luôn vấn đề này:
  toàn bộ const editor-ship luôn nằm liền trước `BUILT_IN_LEVELS`.
- **Trùng tên.** Hai level cùng tên (ví dụ hai lần bấm "+ New" chưa đổi tên) sinh cùng một định danh
  const — số thứ hai được hậu tố `2`, `3`... (`uniqueExportNames`) để không đè lẫn nhau trong cùng một
  lần ship.

**Kiểm tra:** làm trực tiếp qua trình duyệt thật với `npm run dev` + `npm run level-writer` chạy song
song — ship 1 level (khớp), thêm level thứ hai rồi ship lại (2 level, tên tự hậu tố không trùng), xoá một
level rồi ship lại (file rút đúng về 1 level, level đã xoá biến mất). `npx tsc --noEmit` sạch và
`npm test` 87/87 pass sau mỗi vòng. File được đưa về trạng thái sạch (`EDITOR_LEVELS: []`) sau khi kiểm
tra xong, vì các level dùng để test không phải nội dung thật.

---

## 48. Vòng bán kính nổi bật hơn, và khung tranh hết nghiêng về phía sau (27/08)

Hai phản hồi độc lập trong cùng một yêu cầu: vòng tròn báo bán kính đĩa bắn quá mờ, khó thấy; và khung
tranh 2D nhìn "nghiêng về phía sau" như một tấm bảng bị đổ.

**Vòng bán kính** (`buildSortRings`, `SandCannonEngine.ts`): viền dày từ `cell*0.14` lên `cell*0.26`, độ
mờ của viền ngắm từ `0.42` lên `0.85`. Thêm một vòng thứ ba — `aimRingGlow`, cùng tâm nhưng bán kính lớn
hơn, màu vàng ngà ấm (`0xfff2c4`), `THREE.AdditiveBlending` — nằm dưới viền chính để tạo quầng sáng. Một
viền phẳng đọc giống nhau trên mọi màu cát bên dưới, nhưng chỉ quầng sáng mới thực sự kéo mắt người chơi
tới nó giữa một bức tranh nhiều màu.

**Khung tranh nghiêng:** không phải bản thân khung bị xoay — `frameRoot` không có `rotation` nào cả. Nguyên
nhân là góc nhìn camera: `camera.position(0, 4.7, 13.4)` nhìn xuống điểm `(0, 0.45, 0.8)` tạo độ dốc
xuống khoảng 18,6° lên một mặt phẳng thẳng đứng — hiệu ứng keystone kinh điển (cạnh trên rộng hơn cạnh
dưới trong ảnh chụp) khiến khung đọc thành "đổ về sau" dù hình học của nó vẫn thẳng. Đổi
`camera.position(0, 3.3, 13.6)` và `lookAt(0, 1, -0.5)`, hạ độ dốc còn khoảng 9,3° — đo lại bằng chính
ảnh chụp preview: khung từ hình thang rõ rệt (đỉnh ~311px, đáy ~269px) về gần chữ nhật thật.

**Kiểm tra:** 87/87 test pass, `tsc` sạch. Xác nhận trực tiếp qua browser preview (cả Sand Bloom lẫn Lock
& Key): khung không còn hình thang, vòng ngắm hiện rõ viền dày + quầng sáng khi kéo aim-zone.

---

## 49. Chìa khoá đổi hình: đầu tròn — cổ — ba răng, thay silhouette lởm chởm của mục 46 (27/08)

Người dùng gửi ảnh chụp trong game hỏi vì sao chìa khoá có "khoảng hở", và yêu cầu vẽ lại shape, chấp
nhận chìa khoá lớn hơn một chút.

**Nguyên nhân khoảng hở:** không phải bug — `KEY_SPRITE` của mục 46 (`.....##` / `.######` / `..#.##.`)
có khoảng trống thật giữa "chân đơn" và "chân đôi" theo đúng chủ đích thiết kế. Nhưng ở `pixelScale: 5`,
mỗi khoảng trống đó phóng thành một mảng 5×5 pixel màu nền — đủ to để đọc thành "lỗ hổng" thay vì "răng
chìa khoá".

**Thiết kế lại `KEY_SPRITE`** (`sand-sprites.ts`) thành 7×6, tăng từ 7×3: đầu tròn đặc (`.#####.` /
`#######` / `.#####.`), cổ thon (`...#...`), rồi bệ răng liền khối (`.#####.`) đỡ ba răng tách nhau
(`.#.#.#.`) — toàn bộ phần đầu và cổ giờ đặc hoàn toàn, khoảng hở duy nhất còn lại nằm đúng chỗ ba răng,
giống một chiếc chìa khoá thật.

**`LOCK_PICTURE`** (`sand-levels.ts`) vẽ lại quanh hình mới, giữ nguyên nguyên tắc từ mục 46 (bounding
box tràn ra ngoài plug 1 cột bên trái). Vì sprite cao gấp đôi (6 hàng thay vì 3), `frame.height` của
level tăng từ 14 lên 17 — chỉ thêm hàng trống ở phía trên chìa khoá, nên toạ độ y (tính từ sàn) của
plug/slab/floor không đổi, không cần sửa gì ở các test đang ghim toạ độ đó.

**Test vật lý** (rơi tự do, gió thổi, gió đưa chìa vào ổ khoá) được đo lại bằng số liệu thật thay vì suy
đoán: chạy trực tiếp `runGrainSettle`/`runWindGust` với sprite mới qua một script scratch, lấy toạ độ
thực tế rồi mới cập nhật giá trị mong đợi trong test — đúng cách làm đã thành lệ của dự án.

**Kiểm tra:** 87/87 test pass, `tsc` sạch. Xác nhận trực tiếp trong game: chìa khoá hiện đầu tròn — cổ —
ba răng, nhận diện được ngay là hình chìa khoá.

---

## 50. Chìa khoá đổi lại thành đĩa tròn đặc, theo ảnh mẫu người dùng chọn (27/08)

Người dùng gửi ảnh hai shape cạnh nhau — một hình tròn vàng và hình bow-cổ-răng của mục 49 — yêu cầu bỏ
hình bên phải (bow-cổ-răng), dùng hình bên trái (hình tròn) thay thế.

**`KEY_SPRITE` đổi thành đĩa tròn 7×7 đặc hoàn toàn** (`..###..` / `.#####.` / ba hàng `#######` /
`.#####.` / `..###..`), không còn khoảng hở nào ngoài viền ngoài của chính hình tròn. `LOCK_PICTURE` vẽ
lại lần nữa, `frame.height` tăng tiếp 17→18 để chứa hình cao hơn 1 hàng.

**Test vật lý gãy khi đổi shape, và lý do khác mục 49:** hình tròn cao 7 hàng khiến các test dùng khung
nhỏ (`height: 12`) với điểm bắt đầu cũ (`y: 6`) đặt đỉnh chìa khoá ra ngoài trần khung — gió không di
chuyển được vật thể ở vị trí không hợp lệ, bắt được qua một script debug riêng đo trực tiếp
`runWindGust`. Sửa bằng cách hạ điểm bắt đầu trong test xuống `y: 5`. Test "chỉ đỡ một chân" của mục 49
cũng phải viết lại: đáy hình tròn giờ là một cạnh phẳng 3 ô chứ không phải các chân tách rời, nên đổi
sang đo "chỉ đỡ đúng cột giữa của đáy" (`centreLocalX`), xác nhận lại bằng số đo thật thay vì suy đoán.

**Kiểm tra:** 87/87 test pass (sau khi sửa 3 test vật lý gãy), `tsc` sạch. Xác nhận trực tiếp trong game
và qua level switcher: chìa khoá hiện đúng dạng đĩa tròn như ảnh mẫu.

---

## 51. Chìa khoá tròn có animation lăn khi trượt (27/08)

Yêu cầu tiếp theo sau khi chìa khoá đổi thành hình tròn: cho nó quay khi trượt xuống cát, đúng cảm giác
một vật tròn đang lăn.

Vì chìa khoá được rasterise thẳng lên canvas cát (`redrawSand`) chứ không phải mesh 3D riêng, "lăn" được
mô phỏng bằng một **điểm sáng (glint) chạy quanh viền** thay vì xoay hình thật. Thêm
`keyRotation: Map<string, number>` lưu góc quay tích luỹ mỗi chìa khoá; trong `applyStep` (bước
`KEY_MOVE`), mỗi lần dịch chuyển `(dx, dy)` tính bán kính từ bounding box hiện tại rồi cộng dồn góc quay
`(dx - dy) / radius` — công thức lăn-không-trượt xấp xỉ trên lưới rời rạc, vẫn cho chìa khoá "quay" cả
khi rơi thẳng đứng chứ không chỉ khi trượt ngang. `redrawSand` dùng góc đó để tính một điểm trên viền,
tìm ô thật gần điểm đó nhất trong chính hình chìa khoá và tô màu `KEY_GLINT_RGB` (kem sáng) thay vì
`KEY_RGB`. Dọn `keyRotation` khi ổ khoá mở (`UNLOCK`) để không rò rỉ state.

**Kiểm tra:** 87/87 test pass, `tsc` sạch. Xác nhận cơ chế bằng cách replay lại đúng vụ rơi thật của level
`Lock & Key` qua `runGrainSettle` + logic tô glint y hệt engine — góc quay và ô glint đổi đúng sau mỗi
bước `KEY_MOVE`. Ghi chú: level `Lock & Key` hiện tại chìa khoá chỉ rơi 1 nấc ngắn (thẳng xuống slab ngay
bên dưới) nên hiệu ứng chỉ xoay nhẹ ~19°/lần — cần một quãng rơi/trượt dài hơn (rơi xa hơn, hoặc bị gió
thổi) mới thấy điểm sáng chạy rõ nhiều vòng quanh viền.

---

## 52. Bỏ bóng đổ lệch của chìa khoá — sửa khoảng hở ở đáy (27/08)

Người dùng gửi ảnh chụp gần chìa khoá, hỏi vì sao có khoảng hở ở phía dưới, yêu cầu sửa ngay.

**Không phải lỗi ở shape** — `KEY_SPRITE` (đĩa tròn của mục 50) vẫn đối xứng hoàn hảo, đã kiểm lại bằng
script dựng ASCII từ chính sprite. Nguyên nhân là cách vẽ bóng đổ trong `redrawSand`: mỗi ô chìa khoá
từng được vẽ hai lớp — một bản sao màu nâu tối (`KEY_SHADOW_RGB`) lệch xuống-phải 1 pixel, rồi lớp vàng
phẳng đè lên đúng vị trí gốc (không lệch). Với hình khối như icon ổ khoá, cách này cho bóng đổ đẹp; nhưng
với **hình tròn**, lớp vàng chỉ che đúng phần chồng lấn — phần bóng nâu lệch ra ngoài rìa dưới và rìa
phải không được che, đọc thành một vệt màu khác thường chạy dọc đáy, giống như bị khuyết một miếng.

**Sửa:** bỏ hẳn lớp đổ bóng lệch cho riêng chìa khoá (icon ổ khoá phía trên vẫn giữ nguyên bóng đổ của
nó, không đụng tới). Chìa khoá giờ chỉ còn 2 lớp: vàng nền (`KEY_RGB`) + glint xoay từ mục 51. Xoá luôn
hằng `KEY_SHADOW_RGB` không còn dùng.

**Kiểm tra:** 87/87 test pass, `tsc` sạch. Xác nhận trực tiếp trên preview: viền tròn liền mạch, không
còn vệt tối bất thường ở đáy hay cạnh phải.

---

## 53. Dọn 3 lỗi lint có sẵn từ trước (27/08)

Ba lỗi `npm run lint` phát hiện được nhưng không phải do các thay đổi trong các mục 48–52 — xác nhận qua
`git show HEAD:...` trước khi sửa, để chắc là dọn nợ cũ chứ không phải che giấu lỗi mới:

- `LevelEditor.tsx:1321` — dấu nháy đơn trong "this one level's block" chưa escape (`react/no-unescaped-
  entities`), sửa thành `&apos;`.
- `tests/sand-mechanics.test.ts:27` — import `spriteHeight`, `spriteWidth` không còn được dùng ở bất kỳ
  test nào trong file, bỏ khỏi danh sách import.
- `tests/sand-mechanics.test.ts:241` — biến `state` trong test "a level with still air is untouched by
  the wind rule" được gán nhưng không đọc lại, bỏ luôn dòng gán.

**Kiểm tra:** `npm run lint` sạch hoàn toàn (0 lỗi, trước đó 4 lỗi). `tsc` sạch, 86/87 test pass (không
đổi so với trước khi dọn).

---

## 54. Bỏ UI thanh tiến độ theo màu, chỉ giữ SHOTS; scale bức tranh to hơn (27/08)

Hai yêu cầu trong cùng một lượt: bỏ hàng thanh dọc báo tiến độ từng màu (thêm ở mục 38) khỏi HUD, chỉ giữ
số lượt bắn; và phóng to bức tranh, để vòng bán kính ngắm (mục 48) tự scale theo cho tương xứng.

**Bỏ thanh tiến độ:** xoá `colorProgress`/`startingByColor` (hai `useMemo` tính % từng màu đã sạch) và
toàn bộ JSX `.color-bars` trong `SandGame.tsx`; dọn theo import `SAND_COLORS` không còn dùng, và xoá CSS
`.color-bars`/`.color-bar`/`.color-bar i` trong `globals.css`. `.ammo-row` đơn giản còn lại đúng khối
SHOTS.

**Scale bức tranh:** `FIT_WIDTH`/`FIT_HEIGHT` (`SandCannonEngine.ts`) — kích thước world-space mà bức
tranh được fit vào, quyết định `this.cell` (kích thước 1 ô lưới) — tăng từ `4.45`/`5.2` lên `6.1`/`7.1`.
Vòng bán kính ngắm vốn tính theo `this.sortRadius * this.cell` nên tự lớn theo đúng tỉ lệ, không cần sửa
gì thêm ở `buildSortRings`.

**Kiểm tra:** `tsc` sạch, lint sạch, 86/87 test pass (1 lỗi không liên quan — `BUILT_IN_LEVELS.length`
đếm cứng bằng 3 nhưng một tiến trình khác vừa ship thêm 1 level qua mục 47 nên giờ là 4; để nguyên, ngoài
phạm vi mục này). Xác nhận trực tiếp: bức tranh to hơn rõ rệt, không tràn/che HUD hay cannon.

---

## 55. Súng hết bị che, hộp SHOTS thu gọn lại (27/08)

Sau mục 54, ảnh chụp người dùng gửi cho thấy hai vấn đề: súng bị khung tranh che một phần, và súng bị cắt
cụt ở mép dưới màn hình; đồng thời hộp SHOTS quá to so với nội dung của nó.

**Khung tranh chồng lên súng:** `FIT_WIDTH`/`FIT_HEIGHT` của mục 54 (`6.1`/`7.1`) khiến đáy khung
(`FRAME_CENTER_Y - FIT_HEIGHT/2 = -2.5`) tụt xuống thấp hơn cả gốc súng (`CANNON_ROOT_POSITION.y =
-1.78`), nơi trước đó luôn có một khoảng đệm. Hạ bớt độ phóng to xuống `FIT_WIDTH: 5.4`, `FIT_HEIGHT:
6.15` — vẫn lớn hơn bản gốc trước mục 54, nhưng chừa lại khoảng đệm giữa đáy tranh và súng.

**Súng bị cắt ở mép dưới màn hình:** không phải do khung tranh — đo trực tiếp bằng `getBoundingClientRect`
thì thấy đây là giới hạn không gian dọc của chính khung nhìn camera trên tỉ lệ khung hình hẹp (điện
thoại dọc), khiến mô hình súng (đặc biệt phần buồng nạp đạn phía dưới) không đủ chỗ. Tăng
`camera.fov` cho nhánh `aspect < 0.62` (màn hình dọc) từ `40` lên `44` trong `resize()` — góc nhìn rộng
hơn kéo thêm không gian dọc vào khung hình, đủ để cả khẩu súng lọt vào mà không cần phóng to thêm khung
tranh.

**Hộp SHOTS:** `.ammo-row` trước đó `justify-content: flex-end` bên trong một khối kéo dài hết chiều
ngang HUD — chữ "SHOTS/26" bị dạt sang phải, để lại khoảng trống lớn bên trái. Đổi `align-self: flex-end`
để hộp co lại vừa đúng nội dung.

**Kiểm tra:** `tsc` sạch, lint sạch, 86/87 test pass (không đổi). Xác nhận trên viewport điện thoại giả
lập 390×844 lẫn 586×915: toàn bộ súng hiện đầy đủ có khoảng đệm rõ với khung tranh, không còn bị cắt ở
mép dưới; hộp SHOTS gọn vừa nội dung.

---

## 56. Bức tranh cao hơn, gom điều khiển vào nút Settings, SHOTS chuyển sang trái (27/08)

Ba yêu cầu trong một lượt: đặt bức tranh cao hơn để chừa thêm chỗ hiện súng; gom các nút Home/Editor
level/Restart/chọn màn vào một nút cài đặt duy nhất ở góc phải trên; và chuyển SHOTS sang rìa trái, thu
gọn kiểu UI game casual.

**Bức tranh cao hơn:** `FRAME_CENTER_Y` (`SandCannonEngine.ts`) từ `1.05` lên `1.95` — đẩy khung tranh
lên cao trong world-space, chừa nhiều khoảng trống phía dưới cho súng đọc to và rõ hơn hẳn.

**Gom nút vào Settings** (`SandGame.tsx`, `globals.css`): thêm state `menuOpen`; thay 3 icon rời
(⌂/✎/⟲, khối `.game-tools` cũ) và hàng nút chọn màn trong `.board-row` bằng một nút `⚙` duy nhất
(`.settings-wrap`/`.settings-button`). Bấm vào mở `.settings-menu` — tên level + % cleared, hàng nút
chọn màn dạng vòng tròn, rồi ba hàng hành động Home/Level editor/Restart. Một `.settings-backdrop` trong
suốt phủ toàn màn hình khi menu mở, bấm ra ngoài là đóng; menu cũng tự đóng khi bấm Home hoặc chọn màn
khác. Việc đóng menu khi rời màn chơi được đặt thẳng trong `goHome` (gọi `setMenuOpen(false)` cùng lúc
với `setPlaying(false)`) thay vì một `useEffect` riêng theo dõi `playing` — bản đầu dùng effect bị ESLint
`react-hooks/set-state-in-effect` chặn vì gọi `setState` đồng bộ ngay trong effect, nên chuyển logic đó
vào thẳng hàm xử lý sự kiện.

**SHOTS chuyển trái, thu gọn:** `.hud-top`/`.ammo-row` cũ (khối chữ nhật 2 hàng) thay bằng `.shots-badge`
— một pill nhỏ ghim cố định góc trái trên, gồm một chấm tròn màu vàng (icon viên đạn, gradient tô sáng
giữa) cạnh số lượt bắn. `--hud-height` giảm từ `106px` xuống `44px` để vùng cảnh 3D bắt đầu sớm hơn, đúng
bằng chiều cao thật của badge mới.

**Kiểm tra:** `tsc` sạch, lint sạch (sau khi sửa lỗi effect), 86/87 test pass (không đổi). Xác nhận trên
viewport 390×844: tranh cao hơn rõ, súng to và đầy đủ, SHOTS gọn bên trái, nút ⚙ mở đúng menu với đủ
chức năng (chọn màn — thử chuyển sang Crosswind thành công, Home, Level editor, Restart) và đóng đúng
khi bấm ra ngoài hoặc sau khi chọn xong.

---

## 57. Vòng đế súng đổi màu theo đạn sắp bắn (27/08)

Người dùng gửi ảnh chụp cận cảnh súng, chỉ ra vòng vàng ở đế không đổi màu theo đạn như vòng ở miệng nòng
(`muzzleBand`) đã làm.

**Nguyên nhân:** vòng đế (`ring`, `buildCannon`) dùng chung vật liệu `accent` (vàng cố định) với vòng
trang trí nhỏ ở đầu nòng — không đổi màu độc lập được. Tách nó ra vật liệu riêng, đổi tên field thành
`this.baseRing`, rồi trong `syncAmmoModel` — đúng chỗ `muzzleBand` đã đổi màu theo đạn hiện tại — thêm
một dòng cập nhật `baseRing` theo cùng logic: `SAND_COLOR_HEX[current]` khi còn đạn, xám `0x6a6f8f` khi
hàng chờ đã hết.

**Kiểm tra:** `tsc` sạch, lint sạch, 86/87 test pass (không đổi). Không chụp được ảnh xác nhận trực quan
trong lượt này vì browser pane không hiển thị được ở phía người dùng lúc đó — xác minh dựa trên rà soát
code và việc đây là bản sao chính xác của cơ chế `muzzleBand` đã hoạt động đúng từ trước.

---

## 58. Home Menu: bức tranh xoay vòng lặp, ẩn súng + tên level, nút "Play Level X" bo tròn (27/08)

Ba yêu cầu cho Home Menu: (1) bức tranh pixel xoay vòng lặp trong lúc chờ ở menu, và xoay về đúng vị trí
mặc định trong khoảng 1 giây khi người chơi bấm vào chơi; (2) che UI cây súng và tên level trên Home; (3)
bỏ "Tap to play", thay bằng nút "Play Level X" (X là level hiện tại) bo tròn.

**Xoay bức tranh:** `SandCannonEngine.updateFrameSpin` xoay `frameRoot.rotation.y` liên tục khi màn hình
đang idle (home). Khi `setIdle(false)` được gọi (bấm Play), thay vì bật lại gameplay ngay, engine ghi
nhận góc xoay hiện tại rồi easing (easeOutCubic) đưa `rotation.y` về 0 trong 1 giây — `paused` chỉ được mở
khoá **sau khi** xoay xong, vì toàn bộ toán ngắm/bắn giả định `frameRoot` không xoay; bắn giữa lúc đang
xoay sẽ trúng sai ô.

**Ẩn súng + tên level:** `cannonRoot.visible` mặc định `false` lúc dựng cảnh, chỉ bật `true` khi vào
gameplay (`setIdle`). Bỏ hẳn `<h2 className="hub-level-name">` khỏi tab home trong `SandGame.tsx` (vẫn
giữ ở các tab khác).

**Nút Play:** thay `<span>TAP TO PLAY</span>` bằng `<span className="hub-play-btn">Play Level
{level.id}</span>` — nút pill bo tròn `999px`, nền gradient vàng-cam giống các nút CTA khác trong game
(`.result-card button`), vẫn nằm trong vùng tap toàn màn hình để giữ target chạm lớn.

**Kiểm tra:** `tsc --noEmit` sạch. Verify qua dev server: text đổi đúng "Play Level 1", DOM không còn tên
level ở home, bấm nút chuyển đúng sang trạng thái chơi (HUD súng hiện, home screen biến mất), không lỗi
console. Không chụp được ảnh xoay 3D trực quan vì browser pane trong session không compositing được.

---

## 59. Xoay nhanh hơn, mặt sau khung tranh cũng hiện bức tranh (27/08)

Phản hồi cho mục 58: xoay chậm quá, và khi khung quay ra sau chỉ thấy tấm backing tím trơn thay vì bức
tranh.

**Tốc độ:** `IDLE_SPIN_SECONDS_PER_TURN` giảm từ 26 xuống 10 giây/vòng.

**Mặt sau:** thêm mesh thứ hai `sandMeshBack`, dùng chung geometry và texture (`sandTexture`) với
`sandMesh`, nhưng xoay `rotation.y = Math.PI` và đặt ở phía ngoài tấm backing (`BACKING_Z_RATIO -
BACKING_DEPTH_RATIO / 2 - 0.1`) để không bị tấm backing che khi nhìn từ trước. Xoay nguyên mesh 180° thay
vì chỉ lật gương tại chỗ — đây là kỹ thuật chuẩn cho vật hai mặt trong three.js: khi người xem đứng ở phía
sau (bản thân góc nhìn cũng là một phép lật gương), hai phép lật cộng lại triệt tiêu nhau nên hình hiện
đúng chiều, không bị ngược.

**Kiểm tra:** `tsc --noEmit` sạch, verify qua dev server không lỗi console.

---

## 60. Thanh nav dưới: nút được chọn phình to đẩy nút khác, bỏ text (27/08)

Yêu cầu đầu tư UI cho thanh Shop/Skin/Home/Gallery/Customize: nút đang chọn phình to, đẩy các nút khác
dịch bớt, icon nút bị đẩy vẫn phải nằm giữa, và bỏ chữ tên tab bên dưới icon.

`.hub-nav` đổi từ CSS grid 5 cột cố định sang flexbox; mỗi nút `flex: 1 1 0%`, nút `.is-active` có
`flex-grow: 2.15` (transition mượt) nên nó nở ra và các nút khác tự co lại nhường chỗ thay vì đứng yên
trong ô cố định. Icon luôn canh giữa bằng `display:flex; align-items/justify-content:center` nên dù nút
rộng hay hẹp, icon không lệch (đã đo `centeredOffset = 0` ở mọi trạng thái). Bỏ `<span>{tên tab}</span>`
khỏi JSX, chuyển tên tab sang `aria-label`/`title`. Nút active nhận thêm nền gradient vàng-cam cùng
tông với các nút CTA khác, icon phóng to nhẹ (23px → 27px).

**Kiểm tra:** `tsc --noEmit` sạch; verify qua dev server bằng cách đọc computed style sau khi tắt
transition (vì transition CSS bị treo giữa chừng trong tab preview không được composite của session này) —
đúng thiết kế: chỉ nút active có `flex-grow: 2.15`, các nút khác `1`.

---

## 61. Animation chuyển cảnh Home → chơi: UI menu thu nhỏ/trượt ra, súng lắp ráp bay vào (27/08)

Phản hồi: chuyển từ menu sang chơi UI biến mất đột ngột, "gắt". Yêu cầu nút Play thu nhỏ lại, thanh nav
trượt xuống ra khỏi màn hình như hoạt hình, và súng xuất hiện bằng animation bay từ ngoài vào kèm hiệu ứng
các bộ phận được lắp ghép.

**UI home thoát mượt:** thêm state `homeVisible` ở `SandGame.tsx`, lag theo `playing` — khi bấm Play, home
screen vẫn ở lại DOM thêm 480ms (`HOME_EXIT_MS`) với class `is-leaving` để animation kịp chạy trước khi bị
gỡ khỏi cây React: nút Play co nhỏ lại và mờ dần (`hub-play-btn-exit`: scale → 0.15), overlay tối mờ dần
(`hub-tap-exit`), thanh nav trượt xuống mất hẳn khỏi màn hình (`hub-nav-exit`: `translateY(130%)`). Toàn
bộ home screen khoá tương tác (`pointer-events: none`) ngay khi bắt đầu thoát.

**Súng lắp ráp bay vào:** `startCannonEntrance`/`updateCannonEntrance` trong `SandCannonEngine`. Cả cụm
súng (`cannonRoot`) trồi lên từ phía dưới khung tranh (easeOutCubic, ~0.8s). Riêng tháp pháo + nòng
(`turret`) rơi từ trên xuống khớp vào đế, bắt đầu trễ hơn một nhịp và có hiệu ứng nảy quá đà rồi ổn định
(hàm `easeOutBack`, công thức chuẩn overshoot) — tạo cảm giác các bộ phận vừa được lắp ráp khớp vào nhau
thay vì cả khối trượt vào cùng lúc.

**Kiểm tra:** `tsc --noEmit` sạch. Verify qua dev server: đúng `animation-name` (`hub-play-btn-exit`,
`hub-tap-exit`, `hub-nav-exit`) khi bấm Play, home screen gỡ khỏi DOM sau ~480ms, không lỗi console suốt
chuỗi entrance + xoay-về-mặc-định + mở khoá gameplay.

---

## 62. Giai đoạn sand settling: bỏ box+text, chỉ còn 3 chấm; súng mờ dần khi bận (27/08)

Yêu cầu: bỏ khung + chữ "SAND SETTLING" trong lúc cát đang settle, chỉ để dấu 3 chấm có animation; đồng
thời giảm opacity của súng trong lúc đó.

**Settle badge:** bỏ hẳn border/background/padding và `<span>` chữ, chỉ còn 3 `<i>` tròn nhỏ nảy so le
theo nhịp (`settle-dot-bounce`). Text mô tả trạng thái vẫn giữ dưới dạng `aria-label` (ẩn khỏi màn hình)
để không mất khả năng đọc cho screen reader.

**Súng mờ khi bận:** `collectCannonMaterials` quét một lần lúc dựng cảnh qua toàn bộ mesh dưới
`cannonRoot`, ghi lại opacity/transparent gốc của từng material. Mỗi frame, `updateCannonFade` easing
opacity của tất cả về ~32% (`CANNON_BUSY_OPACITY`) khi phase đang ở `PROJECTILE_FLYING` / `HIT_RESOLUTION`
/ `SETTLING` / `MERGING`, và trả lại đúng opacity gốc từng phần khi về `READY` — nhân theo tỉ lệ nên phần
vốn đã hơi trong suốt (vỏ buồng đạn) vẫn trong suốt hơn phần đặc theo đúng tỉ lệ cũ. Vầng sáng + đèn buồng
đạn (tự nhấp nháy theo nhịp thở riêng mỗi frame) được nhân thêm hệ số fade này ngay trong công thức của nó
thay vì bị ghi đè chồng chéo bởi một hệ thống riêng.

**Kiểm tra:** `tsc --noEmit` sạch. Verify CSS/DOM của badge đúng thiết kế qua dev server (không còn
box/text, 3 chấm với đúng animation). Phần fade súng lúc cát thật sự đang settle không mô phỏng được đầy
đủ trong session này vì cần raycast 3D thật để bắn đạn.

---

## 63. Khói trắng bùng ở nòng súng khi bắn (27/08)

Yêu cầu: thêm hiệu ứng khói trắng solid, dạng khối tròn, bùng ra ở nòng súng mỗi lần bắn.

Thêm pool 6 khối `IcosahedronGeometry` bọc `MeshBasicMaterial` trắng đục, blending thường (không cộng
sáng như đèn/glow, để đúng tinh thần "solid" chứ không phải hào quang) — `buildMuzzleSmoke`. Mỗi lần
`fire()` chạy, `spawnMuzzleSmoke(muzzleWorldPos, hướngĐạn)` bắn cả pool ra cùng lúc: mỗi khối lệch ngẫu
nhiên quanh trục bắn (toạ độ vuông góc dựng từ hướng đạn), có lực đẩy về phía trước riêng, tuổi thọ
(0.26–0.46s) và kích thước tối đa riêng — để cả cụm đọc thành một đám khói lởm chởm chứ không phải 6 bản
sao giống hệt nhau. `updateMuzzleSmoke` mỗi tick nới khối theo easing (giãn nhanh lúc đầu như khí nén xì
ra), mờ dần về cuối. Pool nằm trực tiếp trong `scene`, không gắn theo `barrelPivot`, vì khói thật không
dính theo nòng súng giật lùi.

**Kiểm tra:** `tsc --noEmit` sạch. Verify qua dev server (tab trình duyệt sạch, không cache lỗi HMR cũ):
không lỗi console suốt chuỗi bấm Play → súng lắp ráp → mở khoá gameplay. Không mô phỏng được một phát bắn
thật (cần raycast 3D đầy đủ) để chụp khói lúc nổ, nên xác nhận chủ yếu qua rà soát code hình học và luồng
gọi hàm.

---

## 64. Sửa tốc độ cát rơi lúc nhanh lúc "bị delay" (27/08)

Phản hồi: quan sát thấy animation cát rơi khi settle đôi lúc nhanh, đôi lúc như bị khựng/delay, không đều.

**Nguyên nhân:** `perStep` (thời lượng mỗi bước settle) được tính bằng cách chia đều một ngân sách cố định
(`SETTLE_BUDGET_MS = 1350ms`) cho số bước `timed`, rồi kẹp trong khoảng `[SETTLE_STEP_MIN_MS,
SETTLE_STEP_MAX_MS]` = `[15, 58]`ms. Sàn 15ms/bước chỉ đúng ý đồ khi số bước vừa phải — với cascade lớn
(sập một mảng to, hàng trăm bước `GRAIN_PASS`), sàn này không có trần chặn tổng thời gian: 300 bước × 15ms
= 4.5 giây, đúng cảm giác "delay" người dùng thấy. Ngược lại cascade rất nhỏ (vài bước) bị kẹp lên trần
58ms/bước, tổng chỉ còn 60–300ms, cảm giác "quá nhanh".

**Sửa:** thêm hằng số `SETTLE_TOTAL_MAX_MS = 1900` và gom logic tính `perStep` (trước đó lặp lại y hệt ở
cả `handleImpact` lẫn `updateWind`) vào một hàm dùng chung `settleStepMs(timed)`: lấy giá trị nhỏ hơn giữa
công thức ngân sách/kẹp cũ và `SETTLE_TOTAL_MAX_MS / timed`. Với cascade siêu lớn, `perStep` tự động giảm
xuống dưới sàn 15ms để tổng thời gian không bao giờ vượt ~1.9 giây, thay vì chạy lì tới nhiều giây.

**Kiểm tra:** `tsc --noEmit` sạch, `npm test` không có test nào pin cứng các hằng số thời gian này nên
không ảnh hưởng. Verify qua dev server không lỗi console.

---

## 65. UI/UX pastel chill theo ảnh tham chiếu; tăng saturation, bỏ pulse nút Play, đổi font Super Pandora (28/08)

Yêu cầu ban đầu: dựa trên loạt ảnh reference (game xếp bóng theo màu kiểu casual, nền pastel, card bo
tròn, nút phẳng không gradient/shadow), làm lại toàn bộ UI/UX theo hướng đó — màu pastel, trơn láng, bo
tròn nhẹ nhàng "chill", được phép chỉnh sửa thêm và đổi màu cát/súng nếu hợp tông.

**Đổi toàn bộ palette** (`globals.css` `:root`): `--ink`, `--muted`, `--panel`, `--line`, `--accent`
(xanh lá "go"), `--danger` (đỏ san hô "quit"), `--gold` (coin), `--locked`, `--bg` (nền xanh ngọc pastel).
Xoá sạch `gradient(`/`box-shadow` khỏi toàn bộ UI game (nút Play, nút kết quả next/quit, settings menu,
thanh nav dưới, toast, HUD...) — thay bằng fill phẳng + border đậm hơn một tông kiểu "sticker outline".
Bo tròn tăng nhẹ ở card/panel/nút (18→20, 22→24, 14→16px...). Level Editor được tách token riêng
(`--ink`/`--panel`/... khai báo lại ngay trong `.editor-shell`) để giữ nguyên theme tối cũ, không bị vỡ
layout do dùng chung biến với game.

**Đổi màu cát + súng cho hợp tông** (`SandCannonEngine.ts`): 6 màu cát (`SAND_COLOR_HEX`) chuyển sang tông
pastel-candy; súng đổi thân xanh dương pastel, phần tối tím-navy nhạt, accent vàng khớp `--gold`; khung
tranh từ xám/gỗ sang trắng phẳng + backing xanh ngọc nhạt; fog + ánh sáng chỉnh lại khớp nền mới.

**Phản hồi ngay sau đó, xử lý trong cùng đợt:**
- *"Màu nhợt/tái hơn ảnh reference, mất độ tươi rực"* — tăng saturation toàn bộ: token CSS, 6 màu cát,
  màu súng/khung tranh/fog, kể cả loading screen (nền + thanh progress) cho đồng bộ.
- *"Nút Play Level X không có hiệu ứng Pulse"* — xoá animation + keyframe `hub-play-pulse` không dùng
  nữa, nút đứng yên tới khi chạm vào.
- *"Dùng font [Super Pandora]"* — copy file font người dùng gửi vào `public/fonts/SuperPandora.ttf`,
  khai báo `@font-face`, đặt làm font chính cho `body` (toàn game, fallback Arial nếu lỗi load). Level
  Editor giữ font hệ thống vì là công cụ nhập liệu dày đặc số/chữ nhỏ, không hợp font display.

**Kiểm tra:** `tsc --noEmit` sạch, `npm test` không phát sinh lỗi mới (1 fail còn lại từ trước, không liên
quan). Verify bằng screenshot thật qua dev server (home screen, trong game, settings menu, gallery) — màu
sắc tươi rực rõ rệt, `document.fonts` xác nhận font load thành công, computed style xác nhận hết
animation trên nút Play, và grep xác nhận không còn `gradient`/`box-shadow` nào trong UI game (chỉ còn
trong `.editor-*` đã cô lập riêng).

---

## 66. Bỏ hiệu ứng giảm opacity của súng khi sand settling (28/08)

Phản hồi: yêu cầu bỏ hẳn tính năng cannon busy-fade đã thêm trước đó (mục 62) — súng không còn mờ đi lúc
game đang bận (bắn/settling/merge) nữa.

Xoá toàn bộ: hằng số `CANNON_FADE_PHASES`/`CANNON_BUSY_OPACITY`/`CANNON_FADE_SECONDS`, field
`cannonMaterials`/`cannonFade`, method `collectCannonMaterials()` và `updateCannonFade()`, lệnh gọi trong
`animate()`. Vầng sáng + đèn buồng đạn (vốn bị nhân thêm hệ số fade) trả về đúng công thức gốc. Súng giờ
giữ nguyên độ hiển thị 100% xuyên suốt mọi phase. Dấu 3 chấm báo "đang bận" (mục 62) không đổi, vẫn giữ
nguyên.

**Kiểm tra:** `tsc --noEmit` sạch, `npm test` không có lỗi mới. Verify qua dev server: không lỗi console
suốt chuỗi bấm Play → súng lắp ráp → mở khoá gameplay.

---

## 67. Đẩy khung tranh + dấu 3 chấm lên, chừa dải trống cho Booster HUD (28/08)

Yêu cầu: dịch khung tranh pixel cát (và vị trí dấu 3 chấm "sand settling") lên trên, để chừa một khoảng
trống đặt Booster HUD sau này, ở giữa ụ súng và bức tranh.

`FRAME_CENTER_Y` (`SandCannonEngine.ts`) — toạ độ Y trong world space của khung tranh — tăng từ `1.95` lên
`2.5` (súng giữ nguyên `CANNON_ROOT_POSITION`, nên khoảng cách hai bên tự nới ra đúng phần khung nhường).
`.settle-badge` (`globals.css`) dịch theo, `top: 16px` → `6px`, để bám sát mép trên khung tranh mới thay vì
lơ lửng ở chỗ cũ.

Trần `2.5` không phải số tuỳ ý: camera cố định (`camera.position`/`lookAt` không đổi theo `FRAME_CENTER_Y`),
nên đẩy khung lên quá cao sẽ khiến mép trên bức tranh bị cắt khỏi khung nhìn (FOV) ở tỉ lệ khung hình hẹp
nhất mà `resize()` tạo ra (khung game rộng cố định 430px, cao tối thiểu 680px → tỉ lệ ~0.63, rơi vào nhánh
FOV 37° hẹp hơn). Tính bằng lượng giác (góc lệch so với trục nhìn của camera, so với nửa FOV) rồi verify
lại bằng cách dựng dev server, ép đúng tỉ lệ khung hình rủi ro đó, và đọc trực tiếp giá trị alpha từng pixel
của canvas (không chụp ảnh được — pane preview không hiển thị trong phiên làm việc): mép trên bức tranh còn
cách viền khung hình ~15px, chưa bị cắt.

**Kiểm tra:** không đổi logic gameplay, không có test bộ nào pin cứng các hằng số 3D này nên `npm test`
không ảnh hưởng. Verify hình học bằng công thức tay + đo canvas pixel thật trên dev server, không verify
được bằng mắt do giới hạn của Browser pane trong phiên này.

---

## 68. Thêm 2 booster: Radius Overcharge & Prism Shot (28/08)

Theo `booster-radius-prism-spec.md`: hai buff một-lượt-bắn, loại trừ lẫn nhau, chưa giới hạn số lần dùng
(giai đoạn test).

**Rules layer** (`sand-types.ts`, `sand-rules.ts`):
- `BoosterType` (`"radiusOvercharge" | "prismShot"`) và `requiresBooster?: BoosterType[]` trên
  `SandLevelConfig` — cờ dữ liệu cho màn khó cần booster mới giải được (mục 5 spec); chưa có solver nào
  trong repo để phải sửa, nên chỉ là placeholder sẵn sàng cho sau này.
- `cellsInRadius(..., options?: { matchColor })` — `matchColor: false` là Prism Shot, tái dùng đúng tham số
  `frozen` sẵn có (Lock & Key), không thêm điều kiện lọc mới.
- `effectiveSortRadius(level, booster)` — nhân đôi bán kính cho Radius Overcharge, **chặn trần ở đường chéo
  khung tranh** (trả lời câu hỏi mở §7.3 của spec).
- `resolveShot(level, state, hit, booster?)` — tham số thứ 4, optional nên không phá test cũ.
- `getBoosterCharges(type)` → `Infinity` cho cả hai loại (đặt trong `Record` để sau đổi số hữu hạn không
  phải sửa chỗ gọi).

**Engine** (`SandCannonEngine.ts`):
- `armBooster(type)` public: khoá lẫn nhau đúng theo spec §3 (giả định đã duyệt) — bấm nút còn lại hoặc bấm
  lại nút đang chờ đều là no-op, không có cách huỷ giữa chừng.
- Buff tiêu ngay khi đạn rời nòng (giả định §7.1 đã duyệt), bất kể phát đó trúng hay trượt.
- Hiệu ứng: vòng viền ngoài buồng nạp + họng súng (xanh dương cho Radius, dải 7 màu quang phổ dựng từ 7
  mesh hình quạt cho Prism — tái dùng đúng ý tưởng asset Rainbow Target/Weak Point cũ đã bỏ); viên đạn to
  hơn 1.6x cho Radius, đổi màu theo thời gian (hue-cycle) cho Prism thay vì để lại vệt hạt đầy đủ (đơn giản
  hoá so với "vệt cầu vồng" nêu trong spec); vòng ngắm (`aimRing`) tự phóng to đúng tỉ lệ khi Radius đang
  armed, tái dùng ngôn ngữ hình ảnh có sẵn thay vì vẽ thêm ring mới.

**UI** (`SandGame.tsx`, `globals.css`): 2 nút tròn không chữ, icon SVG vẽ tay (vòng nét đứt + mũi tên 4 góc
cho Radius; viên đạn bọc 7 dải màu cho Prism, dùng chung mảng màu `PRISM_SPECTRUM_HEX` export từ engine để
nút và súng luôn khớp màu), disable khi buff kia đang armed hoặc khi input đang khoá (busy). Toast "armed —
next shot" khi bấm. Chỗ trống dành cho badge số lượng sau này (chưa hiển thị số, đúng spec §4).

**Test:** thêm `tests/sand-boosters.test.ts` (9 test: matchColor, effectiveSortRadius có/không trần,
getBoosterCharges, resolveShot với/không booster — dựng oracle bằng chính `cellsInRadius`/
`effectiveSortRadius` rồi so khớp, cùng phong cách các file test cũ), gắn vào script `npm test`.

**Kiểm tra:** 96 test tổng (95 pass, 1 fail — lỗi đếm số level có sẵn từ trước, xác nhận bằng `git stash`
là không liên quan), `tsc --noEmit` và `eslint` sạch trên mọi file đã sửa. Phần hiệu ứng 3D (ring buồng
nạp, đạn boost) không verify được bằng ảnh chụp trong phiên này.

---

## 69. Booster HUD: từ 2 nút rời hai bên súng sang 1 khay hình viên thuốc (28/08)

Phản hồi: vị trí 2 nút booster đặt hai bên hông súng (mục 68) không đúng ý — người dùng minh hoạ lại bằng
ảnh: một khay HUD hình viên thuốc nằm gọn trong khoảng trống giữa bức tranh và súng (khoảng trống đã chừa ở
mục 67), hai nút xếp cạnh nhau bên trong.

`.booster-hud` (`globals.css`) — khay bo tròn `border-radius:999px`, viền + nền kiểu "sticker" giống
`.shots-badge`/`.settings-menu` sẵn có, rộng `min(74%, 300px)`, canh giữa theo chiều ngang, đặt ở
`top: var(--booster-hud-y, 63%)` bên trong `.scene-wrap` — đúng dải đã chừa. Hai nút bên trong đổi từ tự
định vị `position:absolute` từng cái (mục 68) sang layout `flex` bên trong khay; class đổi tên
`is-left`/`is-right` → `is-radius`/`is-prism` (không còn ý nghĩa vị trí). `SandGame.tsx` bọc 2 nút trong
`<div className="booster-hud">`.

Tỉ lệ `63%` không phải đoán mò — dịch ngược từ đúng tấm ảnh minh hoạ người dùng gửi (đo tỉ lệ khay trong
ảnh so với khung cảnh), sau đó verify bằng `getBoundingClientRect()` thật trên dev server: khay lên đúng
kích thước/vị trí tính toán.

**Kiểm tra:** `tsc --noEmit`, `eslint`, `npm test` (96 test, 95 pass — vẫn 1 fail có sẵn không liên quan)
đều sạch. Verify layout bằng DOM rect thật trên dev server, không verify được bằng ảnh chụp.

---

## 70. Sửa HUD đè lên khung tranh; thu nhỏ súng để không che HUD khi kéo nòng lên (28/08)

Phản hồi: sau mục 69, khay Booster HUD đè lên một phần đáy bức tranh; súng khi kéo nòng lên hết cỡ (tăng
elevation) cũng vươn tới che khay HUD.

- **Đẩy khung tranh lên thêm:** `FRAME_CENTER_Y` (`SandCannonEngine.ts`) từ `2.5` → `2.6` — mức trần an
  toàn tối đa đã tính ở mục 67 (quá mức này mép trên bức tranh bắt đầu bị cắt ở tỉ lệ khung hình hẹp nhất).
- **Thu nhỏ khay HUD:** `.booster-hud`/`.booster-btn`/`.booster-icon` (`globals.css`) — khay từ
  `min(74%,300px)` xuống `min(64%,240px)`, nút từ 42px xuống 36px, icon 24px xuống 21px, padding/gap giảm
  theo tỉ lệ; `--booster-hud-y` giữ `65%` (mép trên khay lùi xuống đáng kể vì khay đã nhỏ lại).
- **Thu nhỏ mô hình súng:** thêm hằng số `CANNON_MODEL_SCALE = 0.8`, áp vào `cannonRoot.scale` trong
  `buildCannon()` — toàn bộ súng (đế, tháp pháo, nòng) co lại 20% quanh đúng gốc toạ độ cục bộ của nó, nên
  khi kéo nòng lên hết cỡ, đầu nòng vươn tới thấp hơn trước, chừa khoảng cách với khay HUD phía trên.

Tính lại bằng công thức hình học đã dùng ở mục 67: trước khi sửa, mép dưới bức tranh và mép trên khay HUD
đè lên nhau ~10px (đúng như phản hồi); sau khi sửa, mép dưới bức tranh cao hơn mép trên khay HUD ~13px,
không còn đè.

**Kiểm tra:** `tsc --noEmit`, `eslint`, `npm test` (96 test, 95 pass, 1 fail có sẵn không liên quan) đều
sạch. Verify vị trí khay bằng `getBoundingClientRect()` thật trên dev server, khớp tính toán. Phần súng thu
nhỏ và hành vi kéo nòng lên không verify được bằng ảnh chụp trong phiên này — cần người dùng tự kiểm tra
trực quan.

---

## 71. Level editor: mở rộng bảng màu cát (6→10 màu) và thêm import ảnh PNG/JPEG (28/08)

Yêu cầu: "hoàn thiện level editor — thêm option input ảnh PNG/JPEG vào rồi tự động xuất ra thành hình ảnh
cho level, ngoài ra thêm nhiều màu vào phần pick màu".

**Mở rộng bảng màu** (`sand-types.ts`, `SandCannonEngine.ts`, `sand-rules.ts`, `level-drafts.ts`,
`LevelEditor.tsx`, `SandGame.tsx`): từ 6 màu (`red green yellow blue purple orange`) lên 10, thêm
`cyan pink lime brown`. Mỗi màu một chữ cái riêng trong bảng chữ cái tranh vẽ (`C M L N`, không đụng `K` đã
dành cho key). Grep toàn repo xác nhận đúng 4 chỗ định nghĩa `Record<SandColor, ...>` exhaustive phải sửa
(`SAND_COLOR_HEX`, `LETTER_BY_SAND_COLOR`, `SAND_COLOR_BY_LETTER`, hai bản `COLOR_NAME` ở editor và game) —
không có chỗ nào khác trong codebase giả định cứng 6 màu.

**Import ảnh** (`LevelEditor.tsx`): nút "🖼️ Import image" cạnh canvas, input file ẩn
(`accept="image/png,image/jpeg"`). Khi chọn file: vẽ ảnh lên canvas ẩn đúng kích thước board, scale kiểu
*cover* (lấp đầy khung, cắt phần thừa — như CSS `background-size:cover`, tránh để lại viền trống người
dùng phải tự tô), rồi map từng pixel sang màu bảng gần nhất bằng khoảng cách RGB bình phương
(`nearestSandColor`). Pixel trong suốt hoặc gần trắng (checkbox "Skip white background", mặc định bật)
thành ô trống thay vì bị tô đặc. Sau khi import, tự chạy `syncQueueToPicture` để bánh xe đạn khớp ngay với
màu vừa import — cả việc import gộp thành một bước undo.

**Kiểm tra:** 96 test pass, `eslint` sạch trên các file sửa. Verify trực tiếp trên dev server: dựng một
ảnh PNG tổng hợp (nửa đỏ nửa xanh dương) rồi dispatch qua `<input type="file">` bằng `DataTransfer` thật,
đọc lại "grains painted"/ammo wheel sau khi import — khớp đúng logic (wheel tự thêm cả Purple/Brown do viền
ảnh bị làm mờ khi trình duyệt scale). Paint thử cả 10 swatch màu mới lên canvas không lỗi.

---

## 72. Giảm jitter texture cát (2 lượt), đổi màu pink cho dễ phân biệt với đỏ (28/08)

Phản hồi 2 lượt liên tiếp: "texture cát quá jitter, đôi lúc không nhìn được — ví dụ jitter đỏ na ná jitter
hồng", sau đó "giảm hơn nữa".

`sand-color.ts` — `SAND_SATURATION_JITTER`/`SAND_LIGHTNESS_JITTER` (hằng số dùng chung bởi game canvas và
editor preview) giảm 2 lượt: `0.1/0.09` (gốc, port từ UniSand) → `0.06/0.05` → `0.03/0.025`.

Riêng cặp đỏ/hồng: giảm jitter một mình không đủ vì hai màu gốc đã gần nhau cả về hue (352° vs 326°, cách
26°) lẫn lightness (65% vs 68%, cách 3 điểm) — jitter không đụng tới hue nên không thể tự tách hai màu ra
xa hơn. `SandCannonEngine.ts` đổi `pink` từ `0xff5cb8` sang `0xe689d6`: nhạt hơn, bớt bão hoà, ngả tím
nhiều hơn (hue ~310°, cách đỏ 42° thay vì 26°), để độ sáng/bão hoà làm việc thay hue.

**Kiểm tra:** 96 test pass. Verify bằng cách tô thật một mảng đỏ + một mảng hồng trên canvas editor, đọc
`getImageData` thật rồi so dải giá trị: kênh xanh dương (B) của đỏ nằm trong `[78,161]`, của hồng nằm trong
`[204,232]` — hai dải không chồng nhau, tách biệt dưới mọi mức jitter chứ không chỉ tách biệt "trung bình".

---

## 73. Joystick: bỏ hành vi huỷ khi kéo về giữa (28/08)

Phản hồi: "bỏ chức năng joystick sẽ huỷ khi drag về chính giữa".

`SandCannonEngine.ts` — trước đây joystick đã "armed" (đủ xa để tính là một cú ngắm thật) sẽ tự un-arm nếu
kéo ngược lại vào trong bán kính `JOYSTICK_CANCEL_RADIUS` (14px) quanh điểm bắt đầu, và thả tay gần tâm
cũng bị chặn bắn bởi cùng bán kính đó ở `onAimPointerUp`. Sửa: bỏ hẳn logic un-arm giữa chừng —
`aimArmed` giờ "dính" (sticky), một khi vượt `JOYSTICK_ARM_RADIUS` (18px) một lần thì giữ nguyên tới khi
thả tay bất kể có kéo ngược về gần tâm hay không; bỏ luôn điều kiện `releaseDistance > JOYSTICK_CANCEL_RADIUS`
ở `onAimPointerUp`. Hằng số `JOYSTICK_CANCEL_RADIUS` xoá hẳn vì hết chỗ dùng. Việc "chưa kéo đủ xa thì thả
tay không bắn" vẫn giữ nguyên (an toàn khỏi bắn nhầm khi chạm nhẹ) — chỉ bỏ đúng phần "đã ngắm rồi kéo về
giữa = huỷ".

**Kiểm tra:** 96 test pass, `eslint` sạch. Không verify được bằng thao tác kéo-bắn thật trong phiên này:
pointer event tổng hợp cần vòng lặp `requestAnimationFrame` của engine chạy để cập nhật
`displayedAimArmed`, nhưng tab Browser pane ở trạng thái `document.hidden=true` (pane không hiển thị phía
người dùng trong phiên làm việc) khiến trình duyệt tự tạm dừng RAF — xác nhận qua `document.hidden` và một
test đối chứng (một cú kéo-bắn bình thường, không liên quan gì tới thay đổi, cũng không bắn được trong
cùng điều kiện). Đã trace tay logic mới khớp đúng ý đồ; cần người dùng tự bắn thử để xác nhận cuối.

---

## 74. Sửa lỗi Gallery: thumbnail level lưu từ editor bị cắt chỉ còn một dải nhỏ (28/08)

Phản hồi kèm ảnh chụp: thumbnail "Level 2" (một level lưu từ editor) trong Gallery chỉ hiện vài pixel màu
ở mép trên, phần còn lại mất hẳn.

Nguyên nhân: `.pixel-thumb` (`globals.css`) tính `aspect-ratio: var(--cols, 12) / 14` — số `14` hard-code
khớp riêng level mẫu cũ (Sand Bloom, 12×14). Level lưu từ editor vẽ ở đúng độ phân giải board thật (vd
60×70) chứ không phải blueprint nhỏ, nên tỉ lệ sai bét: khung thumbnail bị bóp xuống cao bằng khung tính
cho 14 hàng trong khi nội dung có 70 hàng, `overflow:hidden` cắt mất khoảng 80% phía dưới.

Sửa: `PixelThumb` (`SandGame.tsx`) truyền thêm biến CSS `--rows: level.frame.height` cạnh `--cols` sẵn có;
CSS đổi thành `aspect-ratio: var(--cols,12) / var(--rows,14)`.

**Kiểm tra:** 96 test pass. Verify bằng cách tiêm một draft tổng hợp 60×70 (đúng hình dạng level lỗi) vào
`localStorage`, đọc `getComputedStyle`/`getBoundingClientRect` thật của thumbnail trước/sau: trước khi sửa
container cao chỉ ~22.7px (tỉ lệ sai `60/14`) trong khi cần ~113.5px mới đủ chứa 70 hàng; sau khi sửa
container đúng 113.5px, chứa đủ cả 4.200 ô.

---

## 75. Thêm vạch chia giữa các nút bottom nav (28/08)

Yêu cầu kèm ảnh: thêm vạch kẻ mảnh giữa các nút (Shop/Skin/Home/Gallery/Customize) ở thanh nav dưới cùng.

`globals.css` — `.hub-nav button:not(:last-child)::after`: vạch dọc 1px, cao 44% chiều cao nút, mờ dần ở
hai đầu (gradient), đặt ngay trong khoảng `gap` sẵn có giữa các nút chứ không phải border trên chính nút —
nên không cộng thêm bề rộng và không cần tắt riêng cho nút đang active (nút active chỉ phóng to bubble bên
trong, khung nút không đổi vị trí).

**Kiểm tra:** 96 test pass. Verify bằng `getComputedStyle(button, '::after')` thật trên dev server: đúng
4/5 nút có vạch (không có sau nút cuối), kích thước/gradient khớp CSS.

---

## 76. Đồng bộ màu quả bóng đếm đạn theo màu súng, thêm anim cartoon khi đổi màu (28/08)

Yêu cầu kèm ảnh, chia làm 2 lượt phản hồi.

**Lượt 1 — tô màu theo đạn đang nạp:** `SandGame.tsx` đọc `currentAmmo(level, state)` (đầu hàng đợi
`state.queue`), tô nền `.shots-icon` (chấm tròn trong badge đếm đạn) theo màu đó, `aria-label` nói rõ tên
màu.

**Lượt 2 — "đổi màu cùng lúc với lúc súng đổi màu, thêm anim cartoon":** phát hiện badge đổi màu SỚM hơn
súng thật. `state.queue` (React state) cập nhật ngay khi `resolveShot` chạy xong (gọi `onState` ngay lúc va
chạm), còn quả bóng buồng nạp 3D (`chamberBall`) chỉ đổi màu sau khi *toàn bộ animation lắng cát chạy
xong* — `SandCannonEngine.advanceBeats` chỉ gán `this.state = resolved` (thứ `syncAmmoModel` đọc để tô màu
buồng nạp) ở bước cuối, sau khi hết các "beat" rơi/lắng. Sửa bằng state phái sinh `ammoAnim`: giữ nguyên
màu cũ suốt các phase bận (`PROJECTILE_FLYING/HIT_RESOLUTION/SETTLING/MERGING` — đúng tập `BUSY_PHASES` sẵn
có), chỉ cho màu mới đi qua khi game rảnh lại — khớp đúng thời điểm engine tự cập nhật buồng nạp.

**Anim cartoon:** `@keyframes shots-icon-pop` (`globals.css`) — squash nhỏ + xoay lệch, overshoot phóng to,
rồi lắc nhẹ về đúng tỉ lệ (kiểu "exaggerate rồi settle" hoạt hình cổ điển, cùng tinh thần với
`hub-bubble-pop` đã có). Gắn qua React `key={ammoAnim.bump}` (biến đếm tăng mỗi lần màu thật sự đổi) để
remount `<span>` — bảo đảm anim chạy lại mỗi lần đổi màu kể cả khi bánh xe quay vòng về đúng màu vừa hiện
(className không đổi sẽ không tự replay animation CSS).

**Kiểm tra:** 96 test pass, `eslint` sạch (mẫu "set state trong lúc render" hợp lệ theo React docs, không
bị rule `react-hooks/set-state-in-effect` gắn cờ vì không nằm trong effect). Verify trên dev server: không
có warning "Maximum update depth" trong console (loại trừ vòng lặp render), màu ban đầu đúng blue khớp
`SAND_COLOR_HEX.blue` và `aria-label`, `animationName` đọc được đúng là `shots-icon-pop`.

---

## 77. Level editor: đồ thị tổng quan độ khó tất cả màn chơi (28/08)

Yêu cầu: "trong level editor để đồ thị tổng quan độ khó các màn chơi, chấm theo tiêu chí: độ rộng board,
số lượng màu, màu có xen kẽ nhiều không, số lượng đạn, radius phát bắn".

**`level-difficulty.ts`** (file mới) — `computeDifficulty(draft)`: 5 tiêu chí quy về `[0,1]` rồi lấy trung
bình × 100, trọng số bằng nhau (đúng 5 tiêu chí người dùng liệt kê, không thiên vị cái nào):
- `size` — số pixel board / (MAX_WIDTH × MAX_HEIGHT)
- `colors` — số màu dùng / 10 màu bảng (mục 71)
- `interleaving` — số vùng liên thông cùng màu (`parseSandLevel` — đúng thuật toán 4-connected game dùng để
  chia thân/body) chia cho số màu; 1 vùng/màu (khối liền một mảng) = 0 điểm, càng nhiều vùng rời rạc/màu
  càng tiến về 1 (trần ở 6 vùng/màu)
- `ammo` — `shotLimit` so với số vùng cần dọn; ≤1 đạn/vùng là chật nhất (1 điểm), ≥4 đạn/vùng là rộng rãi
  (0 điểm)
- `radius` — `sortRadius` so với cạnh ngắn của board; ≥35% cạnh ngắn là rộng rãi (0 điểm)

Điểm quy ra nhãn: Easy (<25) / Medium (<50) / Hard (<75) / Very hard.

**`LevelEditor.tsx`/`globals.css`** — mục "Difficulty overview" trong panel Levels, mỗi màn một hàng: tên,
thanh ngang dài theo điểm và tô màu theo bậc (tái dùng đúng 4 màu bảng cát xanh lá→vàng→cam→đỏ thay vì bịa
màu mới), điểm số + nhãn; hover ra tooltip breakdown 5 tiêu chí; bấm vào hàng chọn màn đó (giống list level
bên trên, cùng logic). Điểm cache theo *object identity* của draft (`WeakMap` module-level, cùng kiểu với
`cachedDrafts` sẵn có trong file) — sửa một màn chỉ thay đúng entry đó trong mảng `drafts`, các màn khác
giữ nguyên tham chiếu nên không phải tính lại cả danh sách mỗi nét vẽ.

**Kiểm tra:** 96 test pass, `tsc --noEmit` và `eslint` sạch (bản đầu dùng `useRef` làm cache bị rule mới
`react-hooks/refs` chặn — "không được đọc ref lúc render" — nên đổi sang `WeakMap` module-level, cùng mẫu
`cachedDrafts` đã có sẵn trong file). Verify trên dev server: màn khởi tạo mặc định ra điểm 47/10/0/0/43 →
Easy; tiêm một màn tổng hợp 10 màu xen kẽ dày đặc, 8 đạn, radius 1 ra đúng 47/100/100/100/95 → Very hard;
bấm vào hàng "Very hard" chuyển đúng màn đang chọn ở cả list level bên trên và ô Name.

---

## 78. Coin HUD: đổi màu nền vàng nhạt, icon vàng đậm hơn (28/08)

Tiếp theo coin badge góc trên-trái đã có sẵn từ trước (mục HUD tiền, `.hud-top-left`/`.coin-badge` trong
`SandGame.tsx`/`globals.css`). Yêu cầu: "Background HUD tiền phải màu vàng nhạt, còn icon đồng xu có thể
có màu vàng đậm hơn".

`globals.css` — `.coin-badge`: nền đổi từ `var(--panel)` (trắng) sang `#fff3c4` (vàng nhạt). `.coin-icon`
(màu đĩa xu, `fill="currentColor"` trong `CoinIcon`, `SandGame.tsx`): đổi từ `var(--gold)` (#ffc233) sang
`#e0a512` (vàng đậm hơn) để nổi bật trên nền mới; viền và các chi tiết bên trong ring vẫn giữ nguyên màu
hard-code sẵn trong SVG (#c98a1c), không đổi.

**Kiểm tra:** không verify được trên dev server thật lần này — một phiên chat khác đang chạy `vinext dev`
trên đúng thư mục này (cổng 3000), và vinext tự chặn chạy 2 instance song song trên cùng project dù đổi
sang cổng khác (`autoPort`), nên tab trình duyệt của phiên này không mở lại được server để chụp màn hình.
Xuất một file HTML mock tái tạo đúng CSS/markup của `.hud-top-left` + `.coin-badge` + `CoinIcon` (cùng giá
trị màu, viền, bo góc, kích thước) để xem trước kết quả, gửi kèm cho người dùng; cần người dùng tự refresh
dev server đang chạy sẵn (HMR) để xác nhận cuối trên trang thật.

---

## 79. Kinh tế vàng: thưởng theo màn, Shop mua booster giới hạn số lượng, Daily login (29/08)

Yêu cầu lớn: người chơi nhận vàng sau khi thắng 1 màn (kèm UI báo số vàng nhận được), vàng dùng mua
booster ở Shop (booster giờ giới hạn số lượng, cần UI mua thật), tự cân bằng số vàng/màn + giá booster
cho roadmap 50 level, và tính toán + lập luận cho Daily login.

**Phát hiện trước khi viết dòng nào:** `sand-rules.ts` đã có sẵn đúng cái móc cho việc này — `armBooster`
trong `SandCannonEngine.ts` đã gọi `getBoosterCharges(type) <= 0` để chặn, và `BOOSTER_CHARGES_TEMP` (khi
đó `Infinity` cho cả hai) có comment để sẵn: "the day this becomes finite (spent from a currency or a level
grant), each booster gets its own real number here". Cũng đã có `SandLevelConfig.requiresBooster` (chưa ai
đọc) và comment ở `PLACEHOLDER_COINS`: "Placeholder balance until a real coin economy... exists to back
it." Tức là kiến trúc đã chờ sẵn tính năng này từ trước — chỉ cần lắp vào đúng chỗ.

### `app/game/economy.ts` (file mới) — ví tiền người chơi

Toàn bộ kinh tế gói trong 1 module: `gold` + `boosters: Record<BoosterType, number>`, lưu localStorage
(`sand-cannon:v1:wallet`), cùng kiểu SSR-guard `typeof window === "undefined"` như `level-drafts.ts` đã
dùng. Expose qua `getWallet`/`subscribeWallet` (dùng với `useSyncExternalStore`, giống hệt mẫu
`readBoot`/`SERVER_BOOT` sẵn có trong `SandGame.tsx`) nên UI tự re-render mỗi khi ví đổi — thắng màn, mua
Shop, hay claim daily login đều chỉ cần gọi hàm, không cần truyền state qua props.

`sand-rules.ts`'s `getBoosterCharges` giờ delegate sang `economy.ts` thay vì đọc hằng số — giữ nguyên chữ
ký hàm nên `SandCannonEngine.ts` và test cũ không phải đổi import. Thêm `spendBoosterCharge`, gọi đúng 1
chỗ trong `SandCannonEngine.fire()` (spec §7.1: "consumed the instant it leaves the barrel") — KHÔNG trừ
lúc arm, để lỡ arm xong rồi bấm Restart trước khi bắn thì không mất viên đó (engine cũ bị huỷ toàn bộ, engine
mới luôn arm=null).

### Vàng nhận được khi thắng — công thức, không phải số tay

Tái dùng `level-difficulty.ts`'s `computeDifficulty` (điểm 0-100, 5 tiêu chí — board rộng, số màu, độ xen
kẽ, độ chật đạn, bán kính — mục 77 đã có sẵn). Tách `computeLevelDifficulty(level: SandLevelConfig)` ra khỏi
`computeDifficulty(draft)` để dùng được cho cả level đã ship (không chỉ draft đang vẽ).

`levelGoldReward(score) = round5(20 + score)` — 20 vàng ở score 0, 120 vàng ở score 100. Vì sao tuyến tính
1:1 rồi làm tròn 5 thay vì tay chọn số cho từng bậc: 50 level chưa tồn tại, không có gì để "tay chọn" —
công thức tự chấm điểm đúng theo cùng thước đo editor đã dùng, level nào khó hơn tự động trả nhiều hơn,
không cần ai ngồi cân lại mỗi khi thêm level mới.

**Chỉ trả 1 lần - thắng lại (replay) không có vàng** (theo lựa chọn của bạn): `markLevelCleared(id)` - Set
id đã thắng lưu localStorage (`sand-cannon:v1:cleared-levels`, cùng khuôn với `TUTORIALS_SEEN_KEY` sẵn có),
trả về `true` đúng 1 lần duy nhất. Lý do chọn nhánh chặt nhất trong 3 lựa chọn: nếu trả full mỗi lần thắng
lại, người chơi cày đi cày lại đúng 1 level dễ nhất (score thấp, nhưng vẫn ra vàng) là có vàng vô hạn - toàn
bộ ý nghĩa "khó hơn trả nhiều hơn" sụp đổ vì không còn gắn với việc chơi qua nội dung mới. Đánh đổi: người
chơi luyện tập lại 1 màn để né không được thưởng thêm - chấp nhận được vì mục đích của Shop là hỗ trợ level
MỚI khó hơn, không phải một vòng lặp cày vàng.

Ước tính (không phải số đo thật vì 50 level chưa được vẽ): độ khó tăng dần tuyến tính từ level 1 (score
~10) tới level 50 (score ~90) -> điểm trung bình ~50 -> thưởng trung bình `round5(70) = 70` vàng/màn -> chơi
hết 50 màn 1 lượt (mỗi màn chỉ tính 1 lần) ra khoảng 3.000-3.500 vàng tổng đời - con số này TỰ ĐỘNG cập nhật
đúng theo độ khó thật khi 50 level thật được vẽ trong editor, không cần tính lại tay.

### Giá booster ở Shop

| Booster | Giá | Vì sao |
|---|---|---|
| Radius Overcharge | 60 vàng | Nhân đôi bán kính disc (`effectiveSortRadius`) |
| Prism Shot | 100 vàng | Bỏ hẳn luật khớp màu (`matchColor: false` trong `cellsInRadius`) - 1 phát ăn MỌI màu trong tầm, mạnh hơn hẳn một cái vòng to cùng luật khớp màu cũ |

Prism đắt hơn ~67% vì nó không "cùng loại buff, to hơn" - nó bỏ hẳn một luật chơi, tiềm năng dọn nhiều màu
cùng lúc trong 1 phát. Cả hai đều tặng free 1 viên lúc cài đặt lần đầu (`STARTER_BOOSTER_CHARGES`) để người
chơi thấy nó hoạt động trước khi phải trả tiền, khớp tinh thần "Shop là chỗ khám phá khi hết viên, không
phải rào chắn trước một cơ chế chưa từng thấy".

Vàng khởi điểm giữ nguyên **100** (đúng số `PLACEHOLDER_COINS` cũ) - đủ mua ngay 1 Radius Overcharge hoặc
góp một phần Prism Shot ngay từ đầu.

**Rủi ro cần lưu ý khi vẽ 50 level thật:** `SandLevelConfig.requiresBooster` (mục đánh dấu "màn này cần
đúng booster X mới dọn nổi") đã có sẵn nhưng chưa nơi nào đọc. Một khi booster giới hạn số lượng, một người
chơi tiêu hết sạch viên ở màn trước có thể bị kẹt ở màn `requiresBooster` mà không đủ vàng mua thêm ngay -
đây là rủi ro thiết kế nội dung (thứ tự level, không phải công thức), nên khi ai đó vẽ những màn bắt buộc
booster, cần đảm bảo tổng vàng tích luỹ tới đó đủ mua ít nhất 1 viên loại cần, hoặc cân nhắc thêm cơ chế
"tặng 1 viên miễn phí nếu vào màn cần mà đang có 0 viên" sau này.

### Daily login - 7 ngày, lặp lại, không lấn át gameplay

`DAILY_LOGIN_REWARDS = [10, 15, 20, 25, 30, 40, 80]` - tăng dần trong tuần (thưởng quay lại hôm sau), lặp
vòng chứ không tăng vô hạn (chặn việc chỉ đăng nhập ăn vàng mãi mãi thay vì chơi). Trung bình tuần
`220/7 = 31,4` vàng/ngày - CHỦ Ý thấp hơn cả một màn Dễ (~20-45 vàng), vì daily login là phần thưởng "có
mặt", không phải nguồn thu chính; nguồn thu chính vẫn là chơi qua level. Ngày 7 (80 vàng, gần bằng 1 màn
Very hard) là "phần thưởng hoàn thành tuần", đúng mẫu game thưởng streak phổ biến.

Đứt streak (bỏ lỡ từ 2 ngày trở lên) reset về ngày 1 - chọn nhánh đơn giản nhất trong các phương án, tránh
logic ân hạn (grace period) phức tạp không cần thiết cho một tính năng phụ trợ. Ngày tính theo giờ máy
người chơi (`YYYY-MM-DD` local), không theo UTC, để không đứt streak lúc nửa đêm UTC ở múi giờ khác.

Tách riêng `computeDailyLoginState(record, now)` (hàm thuần, không đụng `localStorage`) khỏi
`getDailyLoginState()` (wrapper đọc storage thật) - để test được logic ngày/streak (gap 0/1/từ 2 trở lên,
wrap từ ngày 7 về ngày 1) bằng `node --test` mà không cần `window`, giống cách `level-drafts.ts` chưa từng
test được phần localStorage của nó nhưng phần logic thuần thì test được.

### UI

- **HUD/Result card** (`SandGame.tsx`): thắng lần đầu hiện `+N` kèm icon xu (`.result-reward`); thắng lại
  (replay) hiện "Already cleared - no coins this time" thay vì im lặng - nói rõ lý do thay vì để người chơi
  tưởng bị lỗi.
- **Shop** (tab có sẵn, trước đây chỉ là "Not built yet"): danh sách 2 booster, icon + mô tả 1 dòng + số
  đang sở hữu + nút mua giá bao nhiêu, disable khi không đủ vàng, toast báo kết quả mua.
- **Booster HUD trong màn**: nút giờ disable thêm khi hết viên (ngoài các điều kiện cũ), và badge số viên
  còn lại hiện thật (`spec §4` đã chừa sẵn chỗ này từ lâu, trước giờ luôn rỗng vì booster vô hạn).
- **Daily login modal**: dải 7 ô ngày (đã qua mờ đi, hôm nay nhấp nháy nhẹ), nút Claim hoặc thông báo
  "come back tomorrow"; tự mở đúng 1 lần khi vào hub nếu chưa claim hôm nay, mở lại bất cứ lúc nào qua nút
  🎁 góc trên-phải của hub (chỗ `.settings-wrap` dùng lúc đang chơi, tách class riêng vì hub có z-index 30 -
  dùng lại `.settings-wrap` (z-index 12) sẽ bị chìm dưới màn hub).

Không dùng `useEffect` + `setState` cho cả hai chỗ đọc trạng thái ban đầu (daily login lúc mount, vàng lúc
thắng): daily login dùng đúng mẫu `useSyncExternalStore`/`readBoot`/`SERVER_BOOT` sẵn có; vàng-khi-thắng
dùng đúng mẫu "set state trong lúc render" mà `ammoAnim` đã dùng (mục 76 giải thích rule
`react-hooks/set-state-in-effect` không gắn cờ vì không nằm trong effect) - cả hai đều được canh bằng so
sánh identity nên khối side-effect (`markLevelCleared`/`addGold`) chỉ chạy đúng 1 lần mỗi lần chuyển trạng
thái thật.

**Kiểm tra:** 111 test pass (`tests/sand-economy.test.ts` - file mới, 15 test cho công thức thưởng, cộng/trừ
vàng, mua booster, và toàn bộ nhánh logic streak; `tests/sand-boosters.test.ts` cập nhật bài test
`getBoosterCharges` cho ví thật thay vì `Infinity`), `tsc --noEmit` và `eslint` sạch trên mọi file đụng tới
(1 lỗi `react-hooks/set-state-in-effect` có sẵn từ trước ở `homeVisible`/`HOME_EXIT_MS`, không phải do đợt
này - đã xác nhận bằng `git stash` rồi lint lại bản gốc).

Verify thật trên dev server (`localhost:3000`, không phải mock): mở app -> Daily Login tự bật, bấm Claim ->
100->110 vàng, ô "Day 1" chuyển "claimed", đóng modal không tự bật lại (đã claim). Mở Shop -> mua Radius
Overcharge -> 110->50 vàng, "Owned: 1"->"Owned: 2", toast "Bought Radius Overcharge - 2 owned". Vào màn chơi
-> badge nút booster hiện đúng "2 left"/"1 left". Ép ví về 0 viên qua `localStorage` rồi reload -> cả hai
nút booster disable đúng, nhãn "0 left". Không có lỗi console ở bất kỳ bước nào.

Chưa verify được bằng thao tác thật: bắn trúng để thắng 1 màn và xem dòng "+N" trên result card - công cụ
trình duyệt của phiên này giả lập kéo-thả bằng PointerEvent tổng hợp nhưng không tái tạo đúng góc bắn 3D
(không có ảnh chụp màn hình để nhắm), nên không chắc phát bắn có trúng cát hay không. Đường dẫn này được
tin cậy qua unit test (`levelGoldReward`, `markLevelCleared`, cả hai đã pass) + review code (nối đúng 1
chỗ, 1 lần) chứ chưa qua mắt người chơi thật - nhờ bạn tự chơi thắng 1 màn để xác nhận cuối dòng "+N" hiện
đúng.

---

## 80. Sửa lỗi UI bị thụt vào giữa màn hình khi mở file HTML standalone trên điện thoại (29/08)

Phản hồi kèm ảnh chụp: mở file `outputs/3d-cannon-sort.html` (bản export 1 file duy nhất, mục 71-72 trong
lịch sử dự án) trong trình duyệt trong-app của Facebook (`content://com.facebook...`) trên điện thoại —
toàn bộ UI bị thu nhỏ, nằm lọt thỏm giữa màn hình, chừa một viền màu nền (`--bg`) lớn xung quanh thay vì
lấp đầy màn hình.

**Nguyên nhân:** `.page-shell`/`.game-frame` (`globals.css`) đặt chiều cao bằng đơn vị `dvh`
(`min-height: 100dvh`, `height: min(900px, calc(100dvh - 56px))`). Đơn vị `dvh` khá mới (Chrome ~cuối 2022,
Safari 15.4) — một WebView cũ hơn (trình duyệt trong-app của Facebook thường chạy engine cũ hơn Chrome hệ
thống) không nhận ra `dvh` sẽ coi CẢ khai báo `height`/`min-height` đó là không hợp lệ và **bỏ qua toàn bộ**
dòng đó, chứ không lùi về giá trị nào khác. Kết quả: `.game-frame` không còn `height` nào để áp dụng, tự co
lại theo kích thước nội dung; `.page-shell` dùng `place-items: center` nên căn giữa luôn cái khối đã co nhỏ
đó — đúng hiện tượng "thụt vào trong, chừa rìa" trong ảnh.

**Sửa:** thêm dòng `vh` đứng TRƯỚC dòng `dvh` ở cả 3 chỗ dùng (`globals.css` — `.page-shell`, `.game-frame`,
và `.editor-shell` dù ít liên quan mobile hơn nhưng sửa luôn cho nhất quán). CSS luôn lấy khai báo hợp lệ
**cuối cùng** cho cùng một thuộc tính: trình duyệt không hiểu `dvh` sẽ dùng dòng `vh` (luôn hợp lệ) làm giá
trị thật; trình duyệt hiểu `dvh` sẽ để dòng `dvh` đứng sau ghi đè, đúng bằng lý do khiến `dvh` được chọn ban
đầu (trừ đúng chiều cao thanh công cụ trình duyệt di động, cái `vh` hay tính sai). Thuần cộng thêm, không
đổi hành vi ở trình duyệt đã hỗ trợ `dvh` — không có gì để mất khi sửa.

**Kiểm tra:** 111 test pass (thay đổi thuần CSS, không đụng logic). Verify trên dev server thật
(`localhost:3000`, Chromium hiện đại có hỗ trợ `dvh`): đọc `getComputedStyle` thật của `.page-shell`/
`.game-frame` — `min-height`/`width`/`height` tính đúng theo viewport (`634px`/`243px`/`680px` khớp
`innerHeight`/`innerWidth` 279x634 của khung xem trước), xác nhận việc thêm dòng `vh` không phá layout ở
nơi `dvh` vốn đã chạy đúng. Build lại `outputs/3d-cannon-sort.html` (`node work/build-standalone.mjs`),
`grep` xác nhận dòng `min-height: 100vh; min-height: 100dvh` đã có trong file xuất ra, gửi lại cho người
dùng. Không tái tạo được đúng WebView của Facebook trong phiên này để xác nhận trực quan trên chính môi
trường lỗi — nhờ người dùng tự mở lại file mới trên điện thoại để xác nhận cuối.

---

## 81. Sửa lỗi lint có sẵn từ trước: setState trực tiếp trong effect của homeVisible (29/08)

Việc tách riêng (task được gắn cờ từ mục 79): `npx eslint app/SandGame.tsx` báo lỗi
`react-hooks/set-state-in-effect` ở effect canh `homeExitTimer`/`HOME_EXIT_MS` — gọi thẳng
`setHomeVisible(true)` trong thân effect khi `playing` chuyển về `false`. Xác nhận bằng `git stash` rằng lỗi
này có từ trước, không liên quan đợt kinh tế vàng (mục 79).

**Sửa:** tách phần "về home thì hiện lại NGAY, không animation" ra khỏi effect, chuyển sang đúng khuôn "set
state trong lúc render" mà `ammoAnim` (và `rewardFor`/`dailyLoginOverride` ở mục 79) đã dùng — canh bằng so
sánh `!playing && !homeVisible` nên hội tụ (chạy 1 lần rồi tự tắt điều kiện) chứ không lặp vô hạn. Effect
còn lại chỉ còn việc dọn timer thật (`clearTimeout`) khi `playing` đổi và lên lịch ẩn trễ
(`window.setTimeout(() => setHomeVisible(false), HOME_EXIT_MS)`) khi vào chơi — cả hai đều không phải
`setState` gọi trực tiếp trong thân effect nên không bị rule này gắn cờ.

**Kiểm tra:** 111 test pass, `tsc --noEmit` sạch, `npx eslint app/SandGame.tsx` giờ **0 lỗi** (trước đó 1
lỗi). Verify trên dev server thật: bấm Play → hub biến mất đúng sau ~480ms (animation thoát vẫn chạy đủ
thời gian như cũ); mở Menu → Home → hub hiện lại NGAY LẬP TỨC, không độ trễ (đúng hành vi cũ, không
animation lúc quay về). Không có lỗi console ở bước nào.

---

## 82. Vàng thưởng theo level chuyển ra file CSV riêng, sửa là game tự động cập nhật (29/08)

Yêu cầu: đưa số vàng nhận được mỗi level ra 1 file CSV riêng, sửa trong CSV thì game tự động điều chỉnh
dòng tiền, không cần sửa code.

**`public/level-rewards.csv`** (file mới) - bảng 3 cột `id,name,reward`. `id` phải khớp `SandLevelConfig.id`
(giá trị thực sự dùng để tra cứu); `name` chỉ để người đọc file dễ nhận level nào là level nào, game không
đọc cột này. Level nào KHÔNG có dòng trong bảng này sẽ tự tính theo công thức độ khó có sẵn
(`levelGoldReward`, mục 79) - nên không bắt buộc điền đủ 50 dòng ngay, chỉ cần thêm dòng cho level nào muốn
tự tay chỉnh.

**`app/game/level-rewards.ts`** (file mới) - đọc file CSV ở trên qua `fetch("/level-rewards.csv")` (file
nằm trong `public/` nên được serve như 1 static asset, cả dev server lẫn production `vinext start`), tự
parse thành `Map<id, reward>`. Parser tự viết (không dùng thư viện ngoài vì bảng chỉ có 3 cột đơn giản),
bỏ qua dòng bắt đầu bằng `#` (dùng đúng quy ước comment như `work/levels.csv` cũ), bỏ qua dòng có `id`/
`reward` không phải số hợp lệ thay vì crash.

**Phần "tự động" - không cần sửa code, không cần build lại, không cần F5 lại trang:** sau khi tải CSV lần
đầu, module tự **poll lại mỗi 4 giây** trong lúc tab còn mở và đang hiện (tạm dừng khi tab bị ẩn, dùng
`document.hidden`) - sửa file CSV, lưu lại, chờ tối đa 4 giây là lần thắng level tiếp theo sẽ dùng số mới,
không cần thao tác gì thêm trên trình duyệt. Đã xác nhận qua Network tab: sửa file trên đĩa, request poll
kế tiếp trả về đúng nội dung mới ngay lập tức (Vite serve `public/` trực tiếp từ đĩa, không cache).

`SandGame.tsx` (`rewardFor` - khối tính vàng lúc thắng, mục 79) đổi thành:
`getLevelRewardOverride(raw.id) ?? levelGoldReward(computeLevelDifficulty(raw).score)` - ưu tiên số trong
CSV, fallback về công thức cũ nếu level chưa có dòng nào. Effect gọi `ensureLevelRewardsLoading()` lúc mount
- không gọi `setState` nào trong effect cả (chỉ ghi vào 1 cache ở module-scope), nên không dính rule
`react-hooks/set-state-in-effect` (mục 81) dù nó là 1 effect thật.

**Giới hạn cần biết:** file HTML standalone (`work/build-standalone.mjs`, mục 71-72/80) không đọc được CSV
này - bản export đó không có server để fetch, nên file dựng sẽ lặng lẽ fallback về công thức cũ cho mọi
level (đúng y hệt trước khi tính năng này tồn tại), không lỗi nhưng cũng không nhận được số đã tay chỉnh
trong CSV. Nếu cần cả bản standalone dùng đúng số trong CSV, sẽ phải sửa thêm `work/build-standalone.mjs`
đọc file lúc build và nhúng thẳng bảng vào bundle - chưa làm trong đợt này, nhắm đúng phạm vi "game thật
(dev/production server)" mà yêu cầu nhắc tới.

**Kiểm tra:** 120 test pass (`tests/level-rewards.test.ts` - file mới, 9 test cho parser: đọc đúng, bỏ qua
comment/dòng trống, thứ tự cột không quan trọng, dòng lỗi bị bỏ qua thay vì crash, reward âm bị loại, số lẻ
được làm tròn, thiếu cột id/reward thì không parse gì, và 1 test đọc đúng file CSV thật trong `public/` để
đảm bảo file thật hợp lệ). `tsc --noEmit` và `eslint` sạch. Verify thật trên dev server: mở app, Network tab
thấy request `level-rewards.csv` lặp lại đúng mỗi ~4s; sửa số trong file từ 20 thành 33 bằng tay, đợi 5s,
`fetch` lại file từ console thấy đúng nội dung mới (xác nhận pipeline đọc-từ-đĩa hoạt động) - đã đổi lại 20
sau khi test xong.

---

## 83. Bản standalone (1 file HTML) cũng đọc `level-rewards.csv` — nhúng lúc build (29/08)

Tiếp mục 82: bản export 1-file (`work/build-standalone.mjs`) không có server nên trước đó luôn fallback về
công thức độ khó, bỏ qua CSV. Người dùng xác nhận cần làm luôn phần này.

**`work/build-standalone.mjs`** — đọc thẳng `public/level-rewards.csv` bằng `parseLevelRewardsCsv` (import
trực tiếp từ `app/game/level-rewards.ts`, cùng kiểu Node-đọc-.ts-trực-tiếp script này đã làm với
`BUILT_IN_LEVELS`/`LOADING_SCREEN_MARKUP`), rồi nhúng kết quả vào bundle qua `esbuild`'s `define` — JSON
hoá 2 lớp (`JSON.stringify(JSON.stringify(rows))`) vì `define` chèn nguyên văn dưới dạng source code, nên
cần lớp ngoài để biến JSON thành 1 string-literal JS hợp lệ. File CSV không tồn tại thì build vẫn chạy
(catch về mảng rỗng) — sheet là tùy chọn, thiếu nó chỉ có nghĩa "chưa override gì", không phải lỗi build.

**`work/standalone-entry.tsx`** — gọi `seedLevelRewards(JSON.parse(__EMBEDDED_LEVEL_REWARDS__))` (hằng số
`__EMBEDDED_LEVEL_REWARDS__` do `define` ở trên thay thế) NGAY TRƯỚC khi `SandGame` mount, nên khi hiệu ứng
`ensureLevelRewardsLoading()` của nó chạy, cache đã có sẵn dữ liệu rồi.

**`app/game/level-rewards.ts`** — `__setLevelRewardsForTests` đổi tên thành `seedLevelRewards` (không còn
chỉ dùng cho test nữa — bản standalone giờ gọi thật). Thêm 1 dòng chặn trong `ensureLevelRewardsLoading`:
nếu cache đã có sẵn (đúng trường hợp bản standalone vừa seed) thì bỏ qua hẳn việc bắt đầu fetch/poll — bản
này không có server nên fetch chỉ toàn thất bại, khỏi tốn công và khỏi in ra dòng lỗi network trông như bug
trong console (trên `file://` một request fetch thất bại rất dễ khiến người dùng tưởng game bị lỗi).

**Đánh đổi cần biết:** số trong bản standalone giờ là "đúng số trong CSV, nhưng đông cứng tại thời điểm
build" — sửa CSV rồi phải chạy lại `node work/build-standalone.mjs` để bản HTML mới phản ánh đúng, khác với
bản dev/production server (mục 82) tự cập nhật không cần build lại. Đây là giới hạn tất yếu của một file
HTML tĩnh không có server, không phải thiếu sót có thể sửa thêm.

**Kiểm tra:** 120 test pass (không đổi logic được test, chỉ đổi tên hàm + build script), `tsc --noEmit` và
`eslint` sạch trên mọi file đụng tới. Build thật: `node work/build-standalone.mjs` báo
`"levelRewardOverrides":1`, `grep` xác nhận `"id":1,"reward":20` có mặt trong file HTML xuất ra. Serve file
đó qua static server tạm, mở trong Browser pane thật: game load bình thường, Network tab xác nhận
**không có** request `level-rewards.csv` nào (đúng ý đồ — cache đã được seed sẵn, không cần fetch), không
có lỗi console nào liên quan tới level-rewards.

---

## 84. Vòng radius nhuộm màu đạn (giảm opacity), HUD số đạn lắc lúc bắn (29/08)

Yêu cầu: (1) màu vòng radius luôn theo màu đạn hiện tại, giảm opacity; (2) đúng khoảnh khắc bắn, HUD số
lượng đạn có anim lắc nhẹ.

**Vòng radius theo màu đạn** (`SandCannonEngine.ts`) — cả 3 vòng dùng chung 1 hình học (`buildSortRings`):
vòng xem trước tầm bắn khi đang ngắm (`aimRing`/`aimRingGlow`) và vòng flash lúc trúng (`sortRing`) trước
giờ đều trắng cứng (`0xffffff`) bất kể đạn màu gì. `syncAmmoModel` — hàm đã đồng bộ màu đạn cho buồng nạp,
đai nòng, bệ súng, hàng đạn chờ mỗi khi đạn đổi — giờ nhuộm luôn cả 3 vòng này theo đúng
`SAND_COLOR_HEX[current]`, nên tô màu đúng ngay từ frame đầu tiên (không cần đợi phát bắn nào) và tự cập
nhật mỗi khi đạn trong buồng đổi màu.

Giảm opacity đi kèm (đúng yêu cầu "giảm opacity" — màu bão hoà đầy đủ ở opacity cũ sẽ trông như 1 đĩa đặc
chứ không phải viền chỉ tầm bắn): `aimMaterial` 0.85→0.5, `aimGlowMaterial` 0.4→0.28,
`sortRing`/`hitMaterial` (đỉnh flash lúc trúng) 0.9→0.55 (rút ra hằng số `SORT_RING_PEAK_OPACITY` dùng
chung giữa lúc spawn và lúc fade dần, tránh 2 chỗ chứa cùng 1 con số).

**HUD số đạn lắc lúc bắn** — `SandCannonEngine.ts` đã sẵn có sự kiện `SHOT_FIRED` (bắn ra đúng lúc đạn rời
nòng, trong `fire()`) nhưng `SandGame.tsx` trước giờ bỏ qua nó (rơi vào nhánh `default`). Thêm case xử lý:
bump 1 counter (`shotBump`), gắn làm `key` cho `.shots-badge` — remount đúng kiểu `ammoAnim.bump` đã dùng
cho hiệu ứng đổi màu chấm đạn, chỉ khác là khoá theo "vừa bắn" thay vì "vừa đổi màu". CSS thêm keyframe
`shots-badge-shake` (lắc trái-phải kèm xoay nhẹ, 0.3s, nhanh và nhỏ hơn hẳn `shots-icon-pop` — đây chỉ là
"độ giật của phát bắn", không phải sự kiện lớn như đổi màu đạn), áp trực tiếp vào `.shots-badge` để mỗi lần
remount tự phát lại.

**Kiểm tra:** 120 test pass (không đổi logic pure nào, chỉ engine visual + 1 case xử lý event có sẵn),
`tsc --noEmit` và `eslint` sạch trên `SandCannonEngine.ts`/`SandGame.tsx`. Verify trên dev server: không có
lỗi console khi tải trang và vào màn chơi. Chưa verify được bằng mắt trên trình duyệt thật lần này: công cụ
tự động của phiên này giả lập kéo-thả bằng `PointerEvent` tổng hợp không tái tạo đúng vòng lặp
frame/ballistic-preview engine cần trước khi thả tay để `shouldFire` (`onAimPointerUp`) trả về true — xác
nhận được cử chỉ kéo-thả tới đúng (`is-aiming`→bỏ `is-cancelled` khi vượt bán kính arm→reset lúc thả) nhưng
không chắc phát bắn có thực sự rời nòng hay không, nên không đọc được `getAnimations()` của `.shots-badge`
để xác nhận trực quan. Cả hai thay đổi đều nhỏ, cơ giới, bám sát nguyên xi các điểm móc/khuôn mẫu đã hoạt
động sẵn trong file (màu nhuộm dùng đúng field `SAND_COLOR_HEX[current]` 6 chỗ khác trong cùng hàm đã dùng;
shake dùng đúng khuôn `key`-remount `ammoAnim.bump` đã có) — nhờ bạn tự bắn vài phát để xác nhận cả hai
trực quan trên máy thật.

---

## 85. Tăng lại opacity vòng radius — màu đạn cần rõ hơn (29/08)

Phản hồi mục 84: vòng radius nhuộm màu đạn nhưng ở opacity 0.5/0.28/0.55 thì màu quá mờ, khó thấy rõ đó là
màu gì.

**`SandCannonEngine.ts`** (`buildSortRings`/`SORT_RING_PEAK_OPACITY`) — tăng opacity cả 3 vật liệu: vòng
ngắm `aimMaterial` 0.5→0.75, quầng sáng `aimGlowMaterial` 0.28→0.45, đỉnh flash lúc trúng
`SORT_RING_PEAK_OPACITY` 0.55→0.8. Vẫn thấp hơn mức trắng gốc ban đầu (0.85/0.4/0.9) một chút — giữ đúng
tinh thần "không phải đĩa đặc" của yêu cầu trước, nhưng đủ đậm để nhận ra ngay là màu gì thay vì phải nhìn
kỹ.

**Kiểm tra:** 120 test pass, `eslint` sạch. Thay đổi thuần số (opacity), không đổi logic — độ rõ thực tế
nhờ bạn tự nhìn trên máy để xác nhận đã đủ rõ hay cần chỉnh thêm.

---

## 86. Gộp toàn bộ số kinh tế còn lại (vàng khởi điểm, giá booster, thưởng daily login) vào 1 file CSV (29/08)

Tiếp mục 82/83 (vàng theo level): mục 82 chỉ đưa được "vàng theo level" ra CSV, còn vàng khởi điểm, giá
booster, thưởng daily login 7 ngày vẫn hard-code trong `economy.ts`. Yêu cầu: gộp hết vào 1 file.

**`public/economy.csv`** (file mới) — bảng `key,value` duy nhất cho mọi số kinh tế KHÔNG theo level:
`starterGold`, `starterBoosterRadiusOvercharge`, `starterBoosterPrismShot`, `boosterPriceRadiusOvercharge`,
`boosterPricePrismShot`, `dailyLoginDay1`..`dailyLoginDay7`. Tách riêng khỏi `level-rewards.csv` (khác cấu
trúc: id→reward theo từng level, còn đây là key→value theo tên) — mỗi bảng đúng 1 loại dữ liệu, không gộp
hai hình dạng khác nhau vào cùng 1 file.

**`app/game/economy-config.ts`** (file mới) — y hệt kiến trúc `level-rewards.ts` (fetch + parse + poll mỗi
~4s trong lúc tab mở, seed được cho bản standalone) nhưng tổng quát hơn: đọc key/value chứ không phải
id/reward, nên dùng chung được cho mọi loại số ở đây thay vì phải tách 4 file riêng.

**`economy.ts`** — mỗi hằng số cũ (`STARTER_GOLD`, `STARTER_BOOSTER_CHARGES`, `BOOSTER_PRICE`) giờ chỉ còn
là **giá trị mặc định**; số thật đi qua hàm tương ứng (`boosterPrice(type)`, `dailyLoginReward(dayIndex)`,
và `defaultWallet()` nội bộ dùng `starterGold()`/`starterBoosterCharges()`) — ưu tiên đọc từ
`economy.csv`, rơi về hằng số nếu sheet chưa có dòng đó. `SandGame.tsx` (Shop, modal Daily Login) đổi qua
đọc các hàm này thay vì hằng số thô, nên UI thật sự phản ánh đúng số trong sheet.

**Vấn đề kỹ thuật đáng chú ý — race điều kiện lúc tạo ví lần đầu:** khác với vàng-theo-level (chỉ được đọc
lúc thắng màn, tức là rất lâu sau khi trang đã tải), `starterGold`/`starterBoosterCharges` bị đọc gần như
NGAY khi trang mở (lúc component render lần đầu) — trước khi `fetch` CSV kịp trả lời (fetch luôn bất đồng
bộ, còn render đầu tiên luôn đồng bộ, nên fetch KHÔNG BAO GIỜ có thể xong trước render đầu). Nếu để vậy,
sửa `starterGold` trong CSV sẽ không bao giờ có tác dụng thật sự, vì ví "mới" (mặc định) đã bị cache cứng
từ trước khi sheet load xong.

Sửa bằng `applyStarterOverrideIfFresh` (`economy.ts`) — theo dõi cờ `walletIsFreshDefault` (chỉ true cho 1
ví vừa được tạo mặc định, tắt ngay khi có hoạt động thật: kiếm/tiêu vàng, mua/bắn booster). Khi
`economy.csv` load xong (hoặc poll ra số mới), nếu ví hiện tại vẫn còn "mới tinh chưa đụng tới", nó được
tạo lại đúng theo số trong sheet — nhưng KHÔNG BAO GIỜ đụng vào 1 ví đã có hoạt động thật, dù sau đó sheet
đổi số nữa. Đây là lý do vàng-khởi-điểm/booster-khởi-điểm chỉ ảnh hưởng người chơi MỚI (đúng như thiết kế
economy.ts đã ghi từ mục 79), chứ không phải giới hạn kỹ thuật của tính năng này.

**Bản standalone** (`work/build-standalone.mjs`/`standalone-entry.tsx`) — nhúng luôn cả `economy.csv` cùng
lúc với `level-rewards.csv`, đúng kiến trúc mục 83.

**Kiểm tra:** 134 test pass (`tests/economy-config.test.ts` — file mới, 9 test cho parser, y hệt khuôn
`level-rewards.test.ts`; `tests/sand-economy.test.ts` thêm 5 test cho override booster price/daily login
day/starter gold+booster qua `seedEconomyConfig`). `tsc --noEmit` và `eslint` sạch. Build standalone báo
`"economyConfigOverrides":12` (đúng 12 dòng trong sheet), file HTML xuất ra chứa đúng dữ liệu nhúng.

Verify thật trên dev server (không phải suy luận): xoá `localStorage`, sửa `starterGold` trong CSV thành
777, F5 lại trang — HUD hiện đúng **777** (xác nhận race-condition ở trên đã được xử lý đúng, không chỉ lý
thuyết). Sửa `boosterPriceRadiusOvercharge` thành 45, đợi ~5s (không F5), mở Shop — giá hiện đúng **45**
ngay lập tức (xác nhận poll + `useSyncExternalStore` mới thêm khiến UI Shop tự cập nhật khi đang mở, không
cần rời màn hình). Đã đổi lại cả hai số về mặc định (100/60) và build lại bản standalone sau khi test xong.

---

## 87. Bỏ khoảng hở màu nền quanh khung game trên điện thoại (29/08)

Phản hồi kèm ảnh chụp: mở trên điện thoại, UI bị thụt vào trong, chừa một viền màu nền (`--bg`) đều quanh
4 cạnh thay vì sát mép màn hình. Khác với mục 80 (đó là bug — `dvh` không được hỗ trợ khiến layout co lại
bất ngờ, ảnh có viền lớn bất thường): lần này là đúng-như-CSS-viết, chỉ là thiết kế "khung game như 1 cái
thẻ nổi trên nền màu" (`.page-shell`'s `padding: 18px` + `.game-frame`'s `border-radius: 34px`) không hợp
khi xem trên điện thoại thật — trên màn hình rộng (desktop/tablet) nhìn giống mockup điện thoại nằm trên
nền, nhưng trên chính điện thoại thì chỉ tổ phí diện tích và trông như game bị lỗi không full màn hình.

**Sửa:** thêm 1 breakpoint `@media (max-width: 480px)` (`globals.css`, `480px` = ngay trên mức
`.game-frame`'s cap 430px cộng padding cũ, phủ hết điện thoại dọc mà không đụng tới màn hình rộng) — bỏ
`padding` của `.page-shell`, bỏ `border-radius` của `.game-frame`, và ghi đè `height`/`min-height` của
`.game-frame` về đúng `100vh`/`100dvh` (chiều cao gốc `min(900px, calc(100dvh - 56px))` cố tình chừa
khoảng trống trên-dưới cho đúng cái "thẻ nổi" đang muốn bỏ, nên phải ghi đè luôn chứ không chỉ mỗi
padding/radius).

**Kiểm tra:** 134 test pass (thay đổi CSS thuần, không đụng logic). Verify thật trên dev server, giả lập
khung điện thoại 375×812: `getBoundingClientRect()` của `.game-frame` ra đúng `{left:0, top:0, width:375,
height:812}` — khớp CHÍNH XÁC viewport, không còn khoảng hở nào. Chụp màn hình xác nhận trực quan: HUD vàng
và nút quà nằm sát 2 góc trên, thanh nav sát đáy, không còn viền teal bao quanh. Test lại ở màn rộng 496px
(qua breakpoint) — `padding`/`border-radius` vẫn nguyên 18px/34px như cũ, xác nhận không ảnh hưởng bản
desktop/tablet. Build lại bản standalone, `grep` xác nhận breakpoint có trong file xuất ra.

---

## 88. Sửa UI Daily Login/Booster hiện sai màn, dời nút Daily Login sang cạnh phải (29/08)

3 lỗi báo cùng lúc: (1) UI Daily Login chồng lên UI settings khi đang chơi, (2) UI booster xuất hiện ở màn
hub, (3) đổi vị trí nút Daily Login sang cạnh phải màn hub.

**Nguyên nhân (1) & (2):** cả nút 🎁 (`.hub-gift-wrap`) và khay booster (`.booster-hud`) trước giờ dùng
thuộc tính `hidden={...}` (ẩn bằng CSS) thay vì gỡ hẳn khỏi DOM — về lý thuyết `[hidden]` vẫn thắng nhờ thứ
tự ưu tiên UA-stylesheet, nhưng đây là hành vi ngầm định dựa vào cascade chứ không phải điều JSX nói rõ
ràng, và đúng là 2 UI này lại được đặt chung 1 toạ độ góc trên-phải với `.settings-wrap` (chỉ khác đúng lúc
nào hiện) — hễ có bất kỳ sai lệch nào giữa 2 điều kiện `hidden` đối nghịch nhau (`hidden={playing}` vs
`hidden={!playing}`) trong lúc chuyển trạng thái là chồng lên nhau ngay tại cùng 1 điểm.

**Sửa:** đổi cả hai từ `hidden` sang **render có điều kiện thật sự** (`{!playing && <div>...</div>}` cho
nút Daily Login, `{playing && <div>...</div>}` cho khay booster) — không còn DOM node nào để lộ ra dù cascade
có bất ngờ thế nào, gỡ hẳn thay vì chỉ ẩn.

**Sửa (3):** `.hub-gift-wrap` dời từ góc trên-phải (trùng chỗ `.settings-wrap` dùng lúc chơi — đúng nguyên
nhân gây chồng UI ở trên) sang **cạnh phải, canh giữa theo chiều dọc** (`top:50%; transform:
translateY(-50%)`), tách hẳn khỏi mọi vị trí UI khác dùng lúc đang chơi.

**Kiểm tra:** 134 test pass, `tsc --noEmit`/`eslint` sạch. Verify thật trên dev server: ở màn hub, nút 🎁
nằm đúng cạnh phải giữa màn hình (ảnh chụp xác nhận); bấm Play → đọc DOM thật xác nhận `.hub-gift-wrap`
**không còn trong DOM** (`giftInDom:false`), `.booster-hud` **có trong DOM** (`boosterInDom:true`), nút gear
settings hiện đúng (`display:flex`) — cả 3 đúng như thiết kế, không còn khả năng chồng UI. Quay lại Home →
nút 🎁 xuất hiện lại đúng cạnh phải, khay booster biến mất khỏi DOM hoàn toàn. Build lại bản standalone.

---

## 89. Bỏ hẳn cơ chế Wind — cả trong level editor lẫn trong game (30/08)

Yêu cầu: bỏ cơ chế Wind ra khỏi level editor. Vì Wind là một trong hai "map mechanic" thử nghiệm của dự
án (cùng với Lock & Key — mục 40/41/42/44), và mọi phần khác của game (rules, engine render, level fixture,
test) đều xây trên đúng cùng bộ kiểu dữ liệu mà editor dùng để vẽ nó, nên gỡ Wind khỏi editor mà không gỡ
luôn phần còn lại sẽ để lại code chết: các hàm `runWindGust`/`resolveWind`/`windPass` trong `sand-rules.ts`
và bộ đếm giờ `updateWind` trong engine vẫn tồn tại nhưng không còn cách nào tạo ra `wind` config để gọi
tới chúng nữa. Nên lần này bỏ **toàn bộ** cơ chế, không chỉ phần UI.

**Xoá khỏi từng lớp:**
- `sand-types.ts`: xoá hẳn `WindDirection`/`WindZone`/`WindPhase`/`WindConfig` và field `wind` trên
  `SandLevelConfig` — cùng luôn cả section comment "map mechanics" giờ trống vì chỉ có Wind từng nằm ở đó.
- `sand-rules.ts`: xoá `runWindGust`, `windPass`, `inZone`, `resolveWind`, `scaleWindPhase`, và phần
  `wind: ...` trong `expandLevelForPixelBoard`. `World`/`Fixtures` không đổi — chúng chưa từng cần biết về
  wind, chỉ cần biết về `locked`/`keys`/`friction`.
- `level-drafts.ts`: xoá `defaultWindPhase`, validate 4 lỗi/cảnh báo riêng cho phase Wind, và đoạn
  `normaliseWind` từng dùng để dịch draft Wind đời cũ (`{everyMs, direction, strength}`) — một draft cũ
  còn field `wind` mồ côi trong localStorage giờ chỉ là một property thừa không ai đọc, không crash gì.
- `LevelEditor.tsx`: bỏ hẳn mục **Wind** trong sidebar (bật/tắt, danh sách phase, thêm/xoá/đảo thứ tự,
  chỉnh direction/duration/cooldown/power/zone), state `phaseIndex`, và hình chữ nhật zone từng vẽ đè lên
  canvas.
- `SandCannonEngine.ts`: bỏ đồng hồ pha (`windPhase`/`windRemaining`/`windBlowing`/`windSinceGust`/
  `windWarned`), phương thức `updateWind()` và lệnh gọi nó mỗi `step()`, 4 event `WIND_INCOMING`/
  `WIND_START`/`WIND_END`/`WIND`.
- `SandGame.tsx`: bỏ 2 case xử lý toast `WIND_INCOMING`/`WIND_END`.
- `sand-levels.ts`: xoá hẳn level fixture `crosswind` (level thử wind duy nhất, không nằm trong roster
  chơi được, chỉ tồn tại cho test).
- `globals.css`: xoá khối CSS `.editor-phases`/`.editor-phase-pick`/`.editor-phase-summary`/
  `.editor-phase-add` — không còn JSX nào dùng tới.
- `scripts/level-writer.mjs`: file này **cố tình duplicate** `draftToTypeScript` từ `level-drafts.ts` (chạy
  Node thuần, không qua TypeScript — xem comment đầu file), nên phải sửa tay y hệt, không thì "Ship to
  sand-levels.ts" từ editor sẽ vẫn ghi ra một field `wind:` mà type không còn khai báo.
- `README.md`: xoá đoạn giải thích cơ chế Wind, sửa các câu nhắc "hai map mechanic"/"Lock & Key và
  Crosswind" về chỉ còn một.

**Test:** xoá 13 test chỉ kiểm Wind trong `tests/sand-mechanics.test.ts` (gust cơ bản, xác định, cát khoá
lờ gió, gió mở khoá qua chìa, gió không tiêu lượt, vòng lặp pha, zone, power theo scale, chìa khoá bị gió
thổi, friction cản gió) — 2 test friction còn lại (`friction paces a slide...`) vẫn giữ nguyên vì chúng
kiểm ma sát trên sườn dốc tự nhiên (`runGrainSettle`), không phải trên gió. Gộp test "both mechanic levels
are already at rest" (từng chạy cho cả `lockAndKey` và `crosswind`) thành "the mechanic level is already at
rest" chỉ còn `lockAndKey`. 134 → **121/121 test pass**, `tsc --noEmit` sạch trên toàn repo (chỉ còn 2 lỗi
cloudflare worker type có từ trước, không liên quan), `eslint` sạch trên mọi file đã sửa.

Verify thật trên dev server: mở `/editor`, đọc DOM xác nhận sidebar đi thẳng từ Height sang "Key friction",
không còn mục Wind ở giữa; `fetch('/app/game/sand-rules.ts')` xác nhận module đã build không còn export
`resolveWind`; mở trang chủ `/` xác nhận vẫn load bình thường, có nút "Play Level 1", không lỗi runtime.

---

## 90. Hiệu ứng cát văng khi bắn trúng, anim dọn cát dissolve từng pixel, nới nhịp bắn tiếp, sửa màu nền khung tranh (31/08)

Yêu cầu ban đầu: thêm hiệu ứng hạt cát văng ra khi đạn bắn trúng cát (~0,5s). Qua nhiều vòng chỉnh theo
phản hồi trực tiếp, tính năng đi xa hơn phạm vi ban đầu khá nhiều — ghi lại trạng thái cuối cùng.

**Hiệu ứng cát văng (`spawnSandSpray`/`updateSandSpray`, `SandCannonEngine.ts`):** pool tối đa 18 hạt hình
khối, tái sử dụng theo mẫu `muzzleSmokePuffs` có sẵn. Chỉnh qua nhiều vòng:
- Kích thước và tốc độ: từ "vài pixel lẻ tẻ gần như vô hình" tăng dần lên hạt to rõ (0,9–1,6 lần cell),
  tốc độ/quãng đường/thời gian sống cũng tăng (đời hạt 1,1s thay vì 0,5s ban đầu) để bay xa và ở lại lâu
  hơn trong khung nhìn.
- **Bug che khuất do `depthTest`:** hạt spawn đúng trên bề mặt phẳng của mặt cát nên tuỳ hướng xoay ngẫu
  nhiên, gần nửa số hạt bị chính mặt phẳng cát che mất ngay khi vừa sinh ra (test bằng cách đổi tạm màu hạt
  sang đỏ chói, thấy chỉ 1–2 chấm nhỏ lọt qua). Sửa bằng cách tắt `depthTest` trên vật liệu hạt — vẽ hạt như
  lớp hiệu ứng tiền cảnh, không bị vật lý occlusion của cảnh chi phối.
- **Số lượng theo lượng cát thực sự bị sort**, không phải cứ trúng cát là văng đủ pool: `count =
  clamp(số ô đã dọn, 3, 18)`. Không có hiệu ứng nếu bắn trượt/không khớp màu (`NO_MATCH`) hoặc không dọn
  được ô nào.
- **Không còn phụ thuộc vào ô đúng dưới tâm ngắm:** trước đó chỉ văng khi `cell` (ô cát ngay dưới crosshair)
  khác null, nhưng bắn vào khoảng trống phía trên đống cát vẫn dọn được cát trong bán kính — sửa điều kiện
  kích hoạt về `resolution.removed.length` thay vì `cell`, lấy màu từ ô thật sự bị dọn khi cần.
- **Điểm xuất phát rải trong cả bán kính đã bắn** (`radiusUsed`, phân bố đều trên hình tròn bằng
  `sqrt(random())`), không còn dồn hết vào đúng điểm chạm.
- **Màu:** thử tăng sáng/bão hoà cho nổi bật trên nền cùng tông, nhưng bị yêu cầu trả về đúng màu cát gốc
  (`cell.rgb`) — không chỉnh sửa màu nữa. Với **Prism Shot** (`matchColor: false`, dọn mọi màu trong bán
  kính chứ không riêng màu đạn): thu thập màu thật của **toàn bộ** ô đã dọn, mỗi hạt tự chọn ngẫu nhiên 1
  màu trong tập đó — không còn tô đồng loạt 1 màu khi thực tế đã dọn nhiều màu khác nhau.

**Anim "biến mất" sau khi bị sort (`redrawSand`, `step`):** ban đầu chỉ mờ dần theo màu gốc. Đổi sang chớp
trắng solid rồi mới mờ (0,2s → sau đó kéo dài thành 0,7s theo yêu cầu). Nâng cấp tiếp: mỗi ô cát có
`dyingDelay` — độ trễ khởi động ngẫu nhiên riêng trong cửa sổ `CLEAR_STAGGER_MS` — nên khi bị sort, cả cụm
rã ra theo kiểu lốm đốm (một số ô còn màu gốc, một số đã trắng, một số đã biến mất cùng lúc) giống hiệu ứng
pixel-dissolve tham khảo, thay vì đồng loạt chớp-và-mờ cùng nhịp.

**Nhịp cát rơi/settle (`settleStepMs`):** bỏ hệ ngân sách cũ (`SETTLE_BUDGET_MS` + trần
`SETTLE_STEP_MIN/MAX_MS` + `SETTLE_TOTAL_MAX_MS`) khiến cascade nhỏ rơi nhanh bất thường còn cascade lớn có
thể kéo dài tới 1,9s — thay bằng một cửa sổ cố định `SETTLE_TOTAL_MS = 800`, chia đều cho mọi bước bất kể
cascade to hay nhỏ, nên cát luôn rơi ở một tốc độ nhất quán.

**Nhịp bắn tiếp:** đi qua 2 thái cực trước khi chốt. Ban đầu súng chờ hết toàn bộ chuỗi settle (rơi cát)
mới bắn tiếp được → đổi sang bắn được ngay lập tức không chờ gì (cả anim trắng lẫn anim rơi đều chạy nền) →
theo yêu cầu cuối, chốt ở giữa: chỉ giữ khoá bắn trong đúng khoảng thời gian của anim trắng+dissolve
(`CLEAR_DURATION_MS`, 0,7s) bằng cách nới `nextShotAt` thêm đúng chừng đó khi có cát bị dọn, còn cát rơi
settle ở nền thì không chặn gì thêm.

Bỏ hẳn hiệu ứng đèn flash neon (`spawnImpactFlash`, một `THREE.PointLight` màu theo đạn) lúc đạn đáp
xuống — xoá field, phương thức, và đoạn cập nhật độ sáng trong `step()`. Vòng tròn sort-ring vẫn giữ
nguyên, chỉ bỏ đèn phát sáng.

**Sửa màu nền khung tranh (2 bug riêng, phát hiện qua debug bằng màu chói):**
1. `backingMaterial` (panel sau mặt cát) dùng `MeshLambertMaterial` — ánh sáng scene khá mạnh (Hemisphere
   1,5 + 2 Directional 2,1/0,85) rửa trôi màu xám đậm thành xám nhạt dù đã set màu tối. Đổi sang
   `MeshBasicMaterial` (unlit) để hiện đúng màu bất kể ánh sáng, và thêm `side: THREE.DoubleSide` vì tranh
   được nhìn từ cả 2 mặt (mặt sau lộ ra qua `sandMeshBack` lúc khung xoay ở màn hình chờ).
2. Đổi màu xong vẫn thấy màu cũ **lúc chơi thật** (chỉ đúng khi xoay xem mặt sau ở màn hình chờ) — test
   bằng cách đổi tạm `backingMaterial` sang màu tím/đỏ chói, xác nhận không hề xuất hiện lúc chơi thẳng.
   Phát hiện có một lớp khác — `lip` (dùng `innerMaterial`, màu xanh cyan nhạt `0xc4e8ea`) — nằm gần camera
   hơn `backingMaterial`, che khuất nó hoàn toàn khi nhìn thẳng; `backingMaterial` chỉ lộ ra khi nhìn
   nghiêng hoặc từ mặt sau. Đổi `innerMaterial` sang cùng màu tối `0x101114` (unlit) để nhất quán ở mọi góc
   nhìn, không riêng gì lúc xoay.

**Test:** thay đổi chỉ ở tầng render/hiệu ứng của `SandCannonEngine.ts`, không đụng `sand-rules.ts` nên bộ
test hiện có không đổi — **121/121 test pass**, `eslint` sạch trên file đã sửa, `tsc --noEmit` sạch (chỉ
còn 2 lỗi cloudflare worker type có từ trước, không liên quan). Verify thật nhiều vòng trên dev server: bắn
thử xác nhận hạt cát văng đúng vị trí/số lượng/màu qua từng bản chỉnh; zoom màn hình + chụp đúng khung hình
lúc va chạm để xác nhận anim dissolve chạy lốm đốm từng pixel; bắn liên tiếp qua script mô phỏng pointer
event xác nhận phát thứ 2 (gửi trong cửa sổ 0,7s) bị chặn đúng — không tốn đạn — còn phát thứ 3 (sau khi
cửa sổ hết) bắn được ngay dù cát vẫn đang rơi; vào thẳng màn chơi từ đầu (không qua màn hình chờ) xác nhận
nền tối nhất quán, không còn màu cũ lộ ra.

---

## 91. Vật lý hiệu ứng cát văng: rơi thẳng xuống theo lực hút thay vì bay tứ tán (01/09)

Phản hồi: hiệu ứng cát văng ở mục 90 "nhìn giả quá" — muốn hạt rơi thẳng xuống như đang có một lực hút
mạnh, chứ không bay ra loạn xạ như hiện tại.

**Sửa (`spawnSandSpray`/`updateSandSpray`, `SandCannonEngine.ts`):**
- Bỏ lực bắn ngang toả đều mọi hướng (`SAND_SPRAY_MIN/MAX_SPEED` cũ, 1,2–2,6) — thay bằng một chút rung lắc
  nhẹ (`SAND_SPRAY_JITTER_MIN/MAX_SPEED`, 0,15–0,45) chỉ đủ để các hạt không rơi y hệt nhau, không còn văng
  xa theo phương ngang.
- Giảm cú hất lên ban đầu (`SAND_SPRAY_UP_SPEED`) từ 1,7 xuống 0,55 — chỉ đủ đọc là "vừa bị bung ra" trong
  tích tắc rồi rơi ngay, không còn bay vọt lên.
- Thêm `SAND_SPRAY_GRAVITY_SCALE = 3,2`, nhân trực tiếp vào gia tốc `GRAVITY` áp lên hạt mỗi khung hình —
  kéo hạt xuống nhanh gấp hơn 3 lần trọng lực bình thường của viên đạn, tạo đúng cảm giác "có lực hút mạnh"
  thay vì trôi theo vòng cung chậm rãi như một vụ nổ.

**Test:** không đụng `sand-rules.ts`, bộ test hiện có không đổi (121/121 pass), `eslint`/`tsc --noEmit` sạch
trên file đã sửa. Verify thật trên dev server: bắn thử, zoom màn hình + chụp nhiều khung hình liên tiếp sau
va chạm — xác nhận các hạt giờ chỉ dập dềnh nhẹ tại chỗ rồi rơi thẳng xuống nhanh, gọn trong vùng va chạm,
không còn bay ra xa như trước.

---

## 92. Bỏ hẳn model nạp đạn 3D trên súng, dời preview đạn kế tiếp lên HUD, tăng cỡ + thêm anim trượt (02/09)

Ba yêu cầu liên tiếp trong cùng một mạch phản hồi, cùng hướng "đạn sắp bắn không còn hiện trên khẩu súng
3D nữa — chuyển hết lên HUD 2D góc trên-trái":

1. Kèm ảnh so sánh model súng (viên bi phát sáng nằm trong buồng nạp qua các vòng nòng) với HUD 2D
   ("● 8"): bỏ viên bi buồng nạp (`chamberBall`) khỏi model 3D, thay vào đó kéo dài badge số đạn để hiện
   trước những viên kế tiếp.
2. Kèm ảnh chụp phần nòng súng vẫn còn lộ 2 viên bi xếp hàng phía sau (hàng chờ trên rail): "Bỏ luôn model
   này đi" — bỏ nốt toàn bộ rail/housing/viên chờ còn sót lại, không chỉ viên đã nạp.
3. "Cho kích cỡ màu bóng được chọn to hơn nữa. Và có anim bóng dự bị di chuyển lên slot bóng bắn chính, và
   anim bóng dự bị 2 di chuyển sang slot bóng dự bị 1" — phóng to chấm màu đang nạp trong HUD, thêm animation
   để cảm giác "viên đạn tiếp theo trồi lên buồng nạp" không biến mất hoàn toàn khi rời khỏi model 3D.

**`SandCannonEngine.ts` — bỏ dần đến hết toàn bộ phần model nạp đạn 3D:**
- Bỏ `chamberBall`/`chamberGlow`/`chamberLight` (viên bi buồng nạp, quầng sáng quanh nó, và đèn nó hắt ra) —
  cả field, đoạn dựng mesh trong `buildAmmoFeed()`, đoạn đồng bộ màu trong `syncAmmoModel()`, và đoạn hoạt
  ảnh xoay/nạp trong `updateAmmoModel()`. Giữ lại biến `breath` (nhịp thở dùng chung với overlay booster) và
  field `chamberLoaded` (vẫn cần cho logic thời điểm nạp đạn tiếp theo).
- Bỏ nốt phần còn lại của `buildAmmoFeed()`: hai thanh ray, housing kính trong suốt, 2 vòng rim, throat nối
  xuống nòng, và mảng `feedBalls` (hàng chờ 3D từng lăn dần vào buồng nạp) — cùng các field/hằng số chỉ phục
  vụ chúng (`feedFrameMaterial`, `feedGlassMaterial`, `feedRoll`, `feedSlotPosition()`,
  `FEED_SLOT_SPACING/RISE`, `FEED_BALL_RADIUS`, `FEED_ROLL_SECONDS`). `buildAmmoFeed()` không còn gì để làm
  nên xoá luôn phương thức, chỗ gọi nó đổi thành gọi thẳng `syncAmmoModel()` để khởi tạo màu ban đầu cho
  muzzle band/base ring/vòng bán kính — những phần **không** liên quan tới model nạp đạn nên vẫn giữ nguyên.

**`SandGame.tsx` — HUD badge làm luôn việc mà model 3D từng làm:**
- Thêm `nextAmmo` vào import từ `sand-rules.ts`; thêm `upcomingAmmo` (vài viên kế tiếp sau viên đang nạp).
- Gộp `loadedAmmo` và `upcomingAmmo` vào chung một state `ammoAnim` với một bộ đếm `bump` dùng chung — cả
  hai chỉ đổi cùng lúc (cùng bắt nguồn từ `state.queue`), và giữ cùng độ trễ theo `busy` để badge không đổi
  màu trong lúc phát bắn trước vẫn còn đang chạy hoạt ảnh lắng cát.
- `.shots-badge` JSX: thêm `.shots-upcoming` — một dải chấm nhỏ mờ dần (`.shots-upcoming-dot`, mỗi ô key
  theo `${ammoAnim.bump}-${index}` để React remount và hoạt ảnh chạy lại mỗi khi hàng đợi dịch chuyển) —
  cùng cập nhật `aria-label` liệt kê tên màu các viên kế tiếp.

**`globals.css` — phóng to + thêm hoạt ảnh trượt:**
- `.shots-icon` (chấm màu đang nạp) từ 15px → **30px**, `.shots-badge` cao 36px → 56px, `.shots-upcoming-dot`
  10px → 12px — badge giờ là vật thể duy nhất còn lại ở góc HUD nên có chỗ để đọc như con số đầu bảng.
- `@keyframes shots-icon-pop` thêm thành phần `translateX` (từ +20px trượt về 0) chồng lên hiệu ứng
  squash-and-stretch sẵn có — viên đạn giờ "trượt vào" từ đúng vị trí dải `.shots-upcoming` bên phải nó,
  đọc như viên kế tiếp vừa nhảy từ hàng chờ vào buồng nạp.
- Thêm `@keyframes shots-upcoming-advance` (trượt từ +14px về 0, mờ dần vào) áp cho mọi `.shots-upcoming-dot`
  — mỗi khi hàng đợi dịch, toàn bộ dải chấm đọc như cùng nhau tiến một bước, thay vì màu chỉ đổi tại chỗ.

**Test:** `tsc --noEmit` sạch (chỉ còn 2 lỗi cloudflare worker type có từ trước, không liên quan),
`eslint` sạch trên file đã sửa, **121/121 test pass** (không đụng `sand-rules.ts`). Verify thật trên dev
server: chụp màn hình xác nhận model 3D không còn lộ viên bi/rail nào ở cả Level 1 (đơn sắc) lẫn Level 2
(nhiều màu); đọc DOM `.shots-badge` xác nhận `aria-label`/màu các chấm đúng theo `state.queue` thực tế.
Vì hai tay cầm chạm-kéo (pointer drag) mô phỏng qua công cụ trình duyệt không bắn được (súng dùng
`setPointerCapture` + một vòng lặp trễ một khung hình để xác nhận hướng ngắm), gọi thẳng các phương thức
private của engine (`ballisticSetup()`/`solveAimAtScreenPoint()`/`fire()`) qua console để bắn thật nhiều
phát liên tiếp, rồi dùng Web Animations API (`element.getAnimations()`) bắt đúng thời điểm badge đổi nội
dung — xác nhận `shots-icon-pop` và `shots-upcoming-advance` đều bắt đầu chạy lại từ `currentTime: 0` đúng
khung hình badge cập nhật, khớp với anim "trượt vào slot" mong muốn.

---

## 93. Currency HUD tách riêng khỏi ammo badge, hiệu ứng coin bay khi nhận Daily Login, nền màn chơi đổi màu theo đạn (02/09)

Phần việc này nằm chung một lần commit với mục 92 (cùng đợt dọn HUD đạn) nhưng do một phiên làm việc khác
thực hiện tiếp ngay trên cùng file, không phải trong cuộc hội thoại đang ghi lại ở đây — mô tả lại dưới đây
dựa trên diff và các comment giải thích lý do đã có sẵn trong code, không phải tường thuật trực tiếp.

**`SandGame.tsx`/`globals.css`:**
- Số vàng (`wallet.gold`) tách khỏi góc `hud-top-left` (giờ chỉ còn ammo badge, xem mục 92) sang một badge
  riêng `.hub-gold-badge`/`.hub-gold-wrap`, chỉ hiện ở màn hub (`!playing`) — không còn hiện đè lên HUD lúc
  đang chơi.
- Thêm `displayGold`/`tweenGoldTo`: số vàng hiển thị đếm dần lên bằng `requestAnimationFrame` (ease-out
  cubic, 0,5s) thay vì nhảy số ngay, và một cờ `suppressGoldSyncRef` giữ số cũ trên màn hình trong lúc coin
  bay còn ở giữa không trung.
- `claimDailyLoginWithFlight`: khi nhận thưởng Daily Login, đo `getBoundingClientRect()` của ô ngày đang
  nhận và của `.hub-gold-badge`, sinh 6 `.coin-fly` (`position: fixed`, bay theo `@keyframes coin-fly-move`
  từ điểm xuất phát tới đích qua toạ độ `--dx`/`--dy`) rồi mới gọi `tweenGoldTo` sau 720ms cho coin bay tới
  nơi. Bớt luôn đoạn text nhắc lại bằng lời những gì dải ngày (`.daily-login-day`, `.is-today`/`.is-past`)
  đã thể hiện bằng hình.
- `.game-frame` nhận biến `--ammo-bg` (set inline từ `ammoSky(loadedAmmo)`) làm nền, thay `var(--bg)` cố
  định — nền màn chơi giờ nhuộm nhạt theo đúng màu đạn đang nạp (hàm `ammoSky` làm sáng màu cát gốc lên
  ~62% về phía trắng, cùng tỷ lệ mà `--bg` vốn đã sáng hơn màu cát cyan gốc của nó). Vì tín hiệu màu đạn dời
  sang nền, `muzzleBand`/`baseRing` trong `SandCannonEngine.ts` đổi từ tô theo màu đạn (`syncAmmoModel`)
  sang **cố định** màu vàng đồng bộ với nhau — súng không còn đổi màu viền nòng mỗi lần đạn xoay vòng nữa.

**Đã sửa thêm khi rà lại toàn bộ trước khi ghi log này:** `claimDailyLoginWithFlight` (dùng
`setDailyLoginOverride`) được khai báo *trước* `const [dailyLoginOverride, setDailyLoginOverride] =
useState(...)` trong cùng file — hợp lệ lúc chạy (setter chỉ được gọi từ bên trong callback, sau khi hook đã
chạy xong) nhưng `eslint` báo lỗi truy cập biến trước khi khai báo. Dời khai báo `useState` lên trước
`claimDailyLoginWithFlight` — hành vi không đổi, chỉ đổi thứ tự đọc trong file.

**Test:** `tsc --noEmit` sạch (chỉ còn 2 lỗi cloudflare worker type có từ trước), `eslint` sạch trên toàn
repo (không còn lỗi hoisting), **121/121 test pass**. Phần verify thật trên dev server (coin bay đúng quỹ
đạo, nền đổi màu đúng theo đạn) chưa được lặp lại trong phiên này — chỉ xác nhận qua đọc code/diff và qua
bộ kiểm tra tự động ở trên.

---

## 94. Queue đạn ngẫu nhiên có bảo hiểm (pity), và hint khi người chơi idle giữa trận (02/09)

Yêu cầu: queue đạn "ngẫu nhiên hơn" — cho phép trùng lặp, nhưng có bảo hiểm để một màu không bị bỏ quên quá
lâu, và luôn thấy trước 3 viên kế tiếp; đồng thời khi người chơi đứng yên quá lâu giữa trận, khung tranh cần
lắc để nhắc, kèm highlight sáng lên phần cát cùng màu đạn hiện tại.

**Queue đạn (`sand-rules.ts`, `sand-types.ts`):**
- Bỏ hẳn `advanceQueue` (round-robin cứng: bắn xong màu nào thì màu đó lùi về cuối hàng, không bao giờ trùng
  trong cùng một khung nhìn) — thay bằng `drawAmmo` (rút ngẫu nhiên đều `seededUnit`, không loại trừ lặp lại
  liên tiếp) + `fillQueue` (luôn bù đầy `queue` về đúng `1 + nextPreviewCount` viên sau mỗi phát bắn).
- Bảo hiểm (`drainOverdue`, ngưỡng `AMMO_PITY_LIMIT = 3`): một màu bị bỏ qua 3 lượt liên tiếp thì lượt kế
  tiếp **bắt buộc** phải rút đúng màu đó. Bug đã bắt được lúc viết test: nếu chỉ ép được đúng 1 màu mỗi lượt,
  hai màu cùng chạm ngưỡng một lúc sẽ có một màu vượt quá 3 (thấy rõ qua test debug: `orange waited 4 draws`)
  — sửa bằng cách rút cạn **hết** các màu đang quá hạn trong cùng một lần gọi (`drainOverdue`, sắp theo màu
  chờ lâu nhất trước), rồi mới rút ngẫu nhiên bù cho đủ hàng; nhờ vậy `queue` có thể tạm dài hơn mức tối thiểu
  một, hai màu ở lượt hiếm hoi bị trùng ngưỡng, chứ không bao giờ để một màu chờ quá 3.
- Một màu vừa được mở khoá (chìa khoá) trong lượt vừa rồi được chèn thẳng vào hàng ngay lập tức
  (`previousShootable` so sánh tập màu bắn được trước/sau phát bắn) — không phải chờ ngẫu nhiên hay đủ 3 lượt
  bảo hiểm, giữ đúng cam kết cũ của round-robin.
- Thêm hai field mới vào `SandGameState`: `ammoPity` (số lượt mỗi màu đang bị bỏ qua) và `ammoSeed` (con trỏ
  seed cho `seededUnit`) — cả hai đi theo state nên §9 (cùng state + cùng phát bắn → cùng kết quả) vẫn đúng,
  không cần `Math.random()` thật.
- `level.ammoQueue` không còn quyết định thứ tự mở màn nữa, chỉ còn dùng để validate (mọi màu trong tranh
  phải có trong wheel và ngược lại) — comment ở `sand-types.ts` và `level-fixtures.ts` đã cập nhật lại.

**Test đã viết lại** (giả định thứ tự cố định cũ không còn đúng, phải kiểm invariant mới thay vì kiểm đúng
từng vị trí): `sand-mechanics.test.ts` (thêm `withLoaded` để ghim viên đạn đang nạp cho các test phụ thuộc
đúng màu cụ thể, đổi so khớp thứ tự cố định sang so khớp tập hợp), `sand-boosters.test.ts` (ghim viên đạn mở
màn cho fixture Prism Shot), `sand-radius.test.ts` (viết lại toàn bộ nhóm "the cycling queue" thành: queue
luôn giữ ít nhất đủ preview, một màu có thể lặp liên tiếp *và* không bao giờ chờ quá 3 lượt, màu đã hết không
bao giờ còn xuất hiện trong preview). `tests/level-fixtures.ts`: hạ `sandBloom.shotLimit` từ 26 xuống 24 —
đo được bằng `analyseLevel` rằng khi cho phép lặp, chơi ẩu (`playCareless`) tận dụng được các loạt lặp màu để
thắng đều 8/8 lần thử (trước đó vẫn thua một số lần), hạ 2 phát bù lại đúng độ khó cũ mà không đụng gì khác.

**Idle hint (`SandCannonEngine.ts`):** theo dõi `lastInputAt` (reset khi `pointerdown` vào aim zone hoặc khi
phase quay lại `READY`); `updateIdleHint` chạy mỗi tick trong `step()`, chỉ hoạt động khi `canInteract()` và
không có ngón tay nào đang giữ. Sau `IDLE_HINT_DELAY_SECONDS` giây không thao tác: khung tranh lắc theo
`IDLE_SHAKE_CYCLE` (lắc — dừng — lắc — dừng lâu hơn — lặp lại, cộng thêm vào `frameRoot.rotation.z` cạnh
recoil hiện có, không ghi đè), và `redrawSand()` tô sáng dần viền các pixel cát cùng màu đạn hiện tại
(`NEIGHBOR_OFFSETS` 4 hướng để tìm pixel biên, chỉ pixel biên mới sáng lên chứ không phủ trắng cả khối).
Tắt ngay khi có thao tác thật.

**Test:** `tsc --noEmit` sạch (chỉ còn 3 lỗi cloudflare worker type có từ trước, không liên quan), **123/123
test pass**. Verify thật trên dev server: bắn nhiều phát liên tiếp thấy đạn lặp màu (trước đây không thể),
đứng yên hơn 6 giây (ngưỡng lúc đó) thấy viền cát sáng trắng rõ quanh khối cát cùng màu và khung hơi rung,
chạm vào ngắm là tắt ngay lập tức, không lỗi console liên quan tới thay đổi.

---

## 95. Chỉnh theo phản hồi: bỏ mờ dần màu preview, dời idle hint ra 10 giây, lắc nhẹ và giãn cách hơn (02/09)

Phản hồi sau mục 94: (1) 3 chấm màu preview đạn kế tiếp không nên mờ dần theo khoảng cách — giờ mỗi màu đều
có xác suất như nhau nên mờ dần đọc sai là "càng xa càng ít chắc chắn"; (2) idle hint nên chờ ~10 giây thay
vì 6; (3) lắc đang mạnh quá và hai lần lắc trong một chu kỳ quá sát nhau, cần giãn ra cỡ 4 giây.

**Sửa:**
- `globals.css`: bỏ `.shots-upcoming-dot:nth-child(1/2/3) { opacity: ... }` (0,85/0,6/0,4) — cả 3 chấm giờ
  full độ sáng như nhau.
- `SandCannonEngine.ts`: `IDLE_HINT_DELAY_SECONDS` 6 → 10. `IDLE_SHAKE_TILT` 0,045 → 0,02 (biên độ lắc gần
  một nửa). `IDLE_SHAKE_HZ` 9 → 7 (rung chậm hơn, dịu hơn). `IDLE_SHAKE_CYCLE` đổi từ
  lắc(0,5s)-dừng(1s)-lắc(0,5s)-dừng(2,4s) sang lắc(0,4s)-dừng(4s)-lắc(0,4s)-dừng(7s) — hai lần lắc trong một
  chu kỳ giờ cách nhau đúng khoảng 4 giây, và chu kỳ nghỉ dài cuối cùng đủ lâu để đọc là "đang nghỉ" chứ
  không phải khoảng trống tiếp theo trong mẫu lắc.

**Test:** `tsc --noEmit` sạch (vẫn 3 lỗi cloudflare cũ, không liên quan). Verify trên dev server bằng
`javascript_tool`: `getComputedStyle` trên cả 3 `.shots-upcoming-dot` trả về `opacity: "1"` đồng đều.

---

## 96. Ụ súng vật liệu phẳng, không đổ bóng (02/09)

Yêu cầu: model ụ súng (cả khung ngoài lẫn skin) phải trơn láng, không còn đánh bóng hay đổ bóng theo ánh
sáng.

Ụ súng vốn không dùng vật liệu bóng/specular nào (không `MeshStandardMaterial`/`MeshPhysicalMaterial`,
không `metalness`/`roughness`) — nhưng `MeshLambertMaterial` (diffuse, có pháp tuyến) vẫn đổ một gradient
sáng-tối theo hướng đèn (`HemisphereLight` + hai `DirectionalLight` trong `SandCannonEngine.ts`), đọc như
một dạng "đánh bóng" nhẹ trên các mặt cong.

**Sửa (`costumes.ts`, `SandCannonEngine.ts`):** đổi toàn bộ vật liệu của khung `classic-cannon` và
`rune-cannon` (`body`/`dark`/`accent`/`stone`/`wood`) cùng vòng vàng cố định (`baseRing`) từ
`MeshLambertMaterial` sang `MeshBasicMaterial` — màu phẳng, không phụ thuộc ánh sáng, không còn gradient
sáng-tối trên bề mặt.

**Test:** `tsc --noEmit` sạch (3 lỗi cloudflare cũ, không liên quan).

---

## 97. Idle hint: nhịp thở "zen" hơn, rồi chỉnh theo phản hồi (02/09)

Yêu cầu 1: lớp viền cát nhấp nháy khi người chơi idle (mục 94/95) đang nhấp nháy quá nhanh và gấp — cần
"nhịp thở" nhẹ nhàng, chậm rãi hơn (zen hơn) thay vì chớp tắt.

**Sửa (`SandCannonEngine.ts`):** `IDLE_HIGHLIGHT_HZ` 1,6 → 0,37 (một chu kỳ mờ-sáng-mờ mất ~2,7s thay vì
gần 2 lần/giây), và giới hạn biên độ trong khoảng `IDLE_HIGHLIGHT_FLOOR`/`IDLE_HIGHLIGHT_CEILING` (0,12–0,5)
thay vì dao động hết cỡ 0→1 — viền không bao giờ tắt hẳn cũng không bao giờ chói trắng.

Yêu cầu 2 (phản hồi ngay sau): thích nhịp thở nhưng chưa đủ rõ/nổi bật — đỉnh sáng nên lên hẳn trắng solid,
đáy chỉ cần giảm còn 30% chứ không tắt; đồng thời lắc idle (mục 94) nên nhẹ nhàng hơn nữa.

**Sửa tiếp:** `IDLE_HIGHLIGHT_FLOOR`/`IDLE_HIGHLIGHT_CEILING` đổi thành 0,3 / 1 (đỉnh = trắng solid, đáy =
30%, không bao giờ biến mất). `IDLE_SHAKE_TILT` 0,02 → 0,012, `IDLE_SHAKE_HZ` 7 → 4,5 — lắc mềm và chậm
hơn.

**Test:** `tsc --noEmit` sạch sau cả hai lượt sửa.

---

## 98. Bỏ hiệu ứng rung của HUD số đạn khi bắn (02/09)

Yêu cầu: khi bắn, bỏ animation rung của badge số đạn (`.shots-badge`).

**Sửa:** `globals.css` bỏ `animation: shots-badge-shake` trên `.shots-badge` và xoá hẳn
`@keyframes shots-badge-shake`. `SandGame.tsx` bỏ state `shotBump` (chỉ tồn tại để remount badge qua `key`
replay animation đó), bỏ `setShotBump` trong case `SHOT_FIRED`, bỏ `key={shotBump}` trên badge. Badge vẫn
đổi số/màu chấm đạn bình thường, chỉ không còn giật khi bắn.

**Test:** `tsc --noEmit` sạch, grep xác nhận không còn tham chiếu `shotBump`/`shots-badge-shake` sót lại.

---

## 99. HUD đạn: anim trượt vị trí thay vì blink, và sửa cho đạn cùng màu liên tiếp (02/09)

Yêu cầu 1: dãy chấm đạn sắp tới (`.shots-upcoming-dot`) nên có hiệu ứng *di chuyển* đến vị trí tiếp theo,
không phải hiện ra đột ngột (blink).

**Nguyên nhân:** animation cũ (`shots-upcoming-advance`) trượt vào có 14px kèm mờ dần `opacity: 0 → 1` —
phần mờ dần lấn át phần trượt, đọc như hiện ra tại chỗ hơn là di chuyển.

**Sửa:** `globals.css` — bỏ hẳn phần mờ opacity, chỉ còn trượt đúng một khoảng slot đầy đủ (18px = đường
kính chấm 12px + khoảng cách 6px), giữ opacity 100% suốt animation.

Yêu cầu 2 (phản hồi ngay sau): hai viên đạn *cùng màu* liên tiếp trong queue cũng phải có hiệu ứng trượt
này.

**Nguyên nhân:** `SandGame.tsx` chỉ bump animation (`ammoAnim.bump`, dùng làm `key` để remount) khi
`loadedAmmo !== ammoAnim.color` — nếu hai phát bắn liên tiếp trùng màu đạn đang nạp, điều kiện sai, không
bump, animation bị bỏ qua dù hàng chờ phía sau vẫn thực sự dịch chuyển.

**Sửa:** so sánh cả `loadedAmmo` lẫn toàn bộ mảng `upcomingAmmo` — chỉ cần một trong hai đổi là bump tăng
(xem thêm mục 100 — cách so sánh nội dung này sau đó lại lộ ra một lỗ hổng khác ở Level 1, sửa tiếp ở đó).

**Test:** `tsc --noEmit` sạch cho cả hai lượt sửa.

---

## 100. Giảm số đạn preview còn 2, và làm lại menu in-game (02/09)

Yêu cầu 1: HUD chỉ nên review 2 viên đạn kế tiếp thay vì 3.

**Sửa:** `sand-types.ts` — `RADIUS_GAMEPLAY.nextPreviewCount` 3 → 2 (không có level nào override giá trị
này, áp dụng đồng loạt). `tests/sand-radius.test.ts` đọc `LEVEL.nextPreviewCount` động nên không bị ảnh
hưởng.

Yêu cầu 2: nút menu 3-gạch lúc in-game nên giống hệt nút Settings ở hub; chỉ giữ lại Home và Restart thành
2 nút tròn to; bỏ nút chọn level; bấm nút Settings in-game phải tạm dừng game.

**Sửa (`SandGame.tsx`, `globals.css`):**
- Nút in-game đổi từ icon `menu` (hamburger, mở dropdown riêng) sang icon `gear` giống hệt hub, và mở thẳng
  `.settings-screen` (bỏ hẳn `menuOpen`/`.settings-menu` dropdown cũ gồm tên level, lưới chọn level, và 3
  nút hàng ngang Home/Restart/Settings).
- Thêm `.settings-round-actions` — 2 nút tròn 64px (Home, Restart) ở đầu `.settings-card`, chỉ hiện khi
  `playing`, thay cho phần đó của dropdown cũ. Bấm nút nào cũng đóng settings rồi mới gọi `goHome`/`restart`.
- Thêm effect mới: `settingsOpen && playing` thì gọi `engine.pause()`, đóng lại thì `engine.resume()` (tái
  dùng cơ chế `pause()/resume()` sẵn có của engine, cùng cách tab-visibility đang dùng) — mở Settings giữa
  trận giờ là một pause menu thật sự.
- Dọn CSS chết: xoá `.settings-menu`, `.settings-level(s)`, `.settings-actions`, `.settings-backdrop`.

**Test:** `tsc --noEmit` sạch. Verify trực tiếp trên dev server (`javascript_tool` dispatch click, vì thao
tác qua tool click chuột bị treo trong môi trường này): bấm gear mở đúng card với 2 nút tròn Home/Restart,
không còn lưới chọn level; bấm Restart đóng settings và reset đúng bàn chơi (12/12 đạn).

---

## 101. Sửa HUD đạn không có anim ở Level 1 — level chỉ 1 màu (02/09)

Báo lỗi: ở Level 1, HUD đạn không có animation trượt dù các phát bắn vẫn dịch chuyển hàng chờ.

**Nguyên nhân:** Level 1 chỉ có đúng 1 màu đạn (`ammoQueue: ["blue"]`, `sand-levels.ts`). Cách phát hiện
"hàng đợi đã đổi" ở mục 99 so sánh **nội dung màu** (`loadedAmmo`/`upcomingAmmo` trước–sau có khác nhau
không) — vì level này chỉ toàn màu xanh, nội dung trước/sau mỗi phát bắn luôn giống hệt nhau dù hàng đợi có
thực sự dịch, nên điều kiện không bao giờ đúng, animation không bao giờ chạy suốt cả màn.

**Sửa (`SandGame.tsx`):** đổi tín hiệu phát hiện sang `state.shotsUsed` — bộ đếm tăng đúng 1 lần mỗi khi một
phát bắn được xử lý xong (`spend()` trong `sand-rules.ts`), bất kể màu đạn có đổi hay không:
`const ammoChanged = !busy && state.shotsUsed !== ammoAnim.shotsUsed;` (vẫn giữ guard `!busy` để không phát
animation sớm trong lúc đạn đang settle). Thêm field `shotsUsed` vào state `ammoAnim` để lưu mốc đã animate.

**Test:** `tsc --noEmit` sạch. Không lặp lại được verify bằng thao tác bắn thật trên dev server trong phiên
này — pointer event tổng hợp qua `javascript_tool`/`computer` không được engine coi là input hợp lệ (aim
zone cần pointer event thật/trusted) — xác nhận đúng qua đọc lại code (`shotsUsed` tăng độc lập với màu sắc
ở `spend()`).

---

## 102. Đổi bảng màu 10 màu cát theo palette designer gửi (02/09)

Designer gửi 2 ảnh bảng màu (11 mã hex) yêu cầu áp cho màu tranh, màu đạn, màu chọn trong level editor.

**Sửa:** `SAND_COLOR_HEX` (`SandCannonEngine.ts`) là nguồn duy nhất cho cả 3 chỗ (đã xác nhận qua import ở
`LevelEditor.tsx`/`SandGame.tsx`), nên chỉ cần đổi 10 giá trị hex ở đây. Ánh xạ theo khoảng cách hue gần
nhất, giữ thứ tự vòng tròn màu không chéo nhau ở nhóm xanh lá/cyan/xanh dương/tím (bảng gốc không có xanh lá
hay xanh dương thuần): `red:#FF546C green:#67E0BA yellow:#F4D65E blue:#9692B8 purple:#A28FEA orange:#F69509
cyan:#00A9F7 pink:#FF97B2 lime:#C1EC35 brown:#998757`. Mã `#EB8D62` (cam nhạt, trùng vùng màu `orange`)
không dùng vì dư 1/11.

**Test:** Verify trực tiếp trên dev server — tranh, đạn cannon, 10 ô màu trong level editor đều lên đúng
bảng mới.

---

## 103. Màu thanh tác vụ hub (bottom nav): nền vàng nhạt, icon nâu, nút Home xanh lá khi active (02/09)

**Sửa (`globals.css`):** `.hub-nav` nền đổi `#ffdfa0` → `#FDE59C`. `.hub-nav-icon` stroke đổi từ
`#fde59c` (đồng màu nền cũ) sang `var(--wood-ink)` (nâu). Nút Home lúc active: bubble đổi từ vàng
(`#fde59c`) sang `var(--accent)` (xanh lá dùng chung toàn app), icon dùng `var(--accent-ink)` — 4 tab còn
lại (Skin/Shop/Gallery/Customize) giữ nguyên màu riêng từng tab như cũ.

**Test:** Verify trên preview — nền vàng, icon nâu, riêng nút Home có nền xanh lá khi đang ở tab đó.

---

## 104. Khung tranh phẳng màu nâu (giống chất liệu ụ súng), nền tranh xám nâu nhạt (02/09)

Yêu cầu 1: khung tranh 3D nên phẳng, không đổ bóng/ánh sáng như ụ súng, và màu nâu.

**Nguyên nhân:** `buildFrame()` (`SandCannonEngine.ts`) dựng thanh viền khung bằng `MeshLambertMaterial`
(phản ứng ánh sáng scene → có gradient sáng/tối), trong khi toàn bộ ụ súng dùng `MeshBasicMaterial` (phẳng,
không đổ bóng).

**Sửa:** đổi vật liệu viền khung sang `MeshBasicMaterial`, màu `0xb98a5e` (cùng tông `--wood` đã có trong
`globals.css`).

Yêu cầu 2 (lượt sau): nền phần tranh chưa có cát (mảng phía sau + lip trong khung) nên là xám nâu nhạt thay
vì đen `#101114` cũ — rồi phản hồi tiếp "ánh nâu hơn 1 chút". Chỉnh 2 lần: `#101114` → `#D9D3C6` →
`#D8C6A6` (chốt).

**Test:** Verify trên preview sau mỗi lần đổi màu.

---

## 105. Booster: bấm lại nút đang armed để huỷ, không cần bắn mới thoát được (02/09)

Trước đó spec §3 chỉ cho "bắn đi" là cách duy nhất thoát trạng thái armed (`armBooster` là no-op nếu đã có
booster khác/chính nó đang armed).

**Sửa (`SandCannonEngine.ts`):** `armBooster(type)` — nếu `type` đang chính là booster armed thì huỷ armed
(`armedBooster = null`, không tốn viên vì viên chỉ trừ lúc bắn thật), phát event mới `BOOSTER_DISARMED`
thay vì no-op. Vẫn giữ nguyên tắc không đổi trực tiếp giữa 2 loại booster khác nhau. `SandGame.tsx` thêm
toast "{tên} cancelled" cho event mới. Cập nhật lại `docs/features/booster-radius-prism-spec.md` §3.

**Test:** 123/123 test pass. Verify trên preview: bấm booster đang armed lần 2 → toast "Prism Shot
cancelled", nút hết armed, không mất viên.

---

## 106. Currency HUD bỏ viền/shadow đổi vàng nhạt; nút Settings nền nâu sậm icon trắng (02/09)

**Sửa (`globals.css`):**
- `.hub-gold-badge`: bỏ `border`, bỏ `box-shadow`, nền đổi `var(--panel)` → `#fde59c`.
- Thêm `.settings-button` (scoped riêng, không đụng `.icon-button` dùng chung với nút help/gift): nền
  `var(--wood-ink)`, `color:#fff` (icon bánh răng dùng `currentColor` nên tự đổi trắng theo).

**Test:** Verify trên preview — 2 nút hiện đúng, nút help/gift không bị ảnh hưởng.

---

## 107. Skin picker: model ụ súng nhỏ hơn không đè nút Select; tên/mô tả dời xuống dưới, không ngang hàng
coin (02/09)

**Sửa:**
- `SandCannonEngine.ts` — `SHOWCASE_SCALE` 1.1 → 0.85, `SHOWCASE_POSITION.y` 1.19 → 1.55 (nâng rig lên,
  chừa khoảng trống phía trên nút Select).
- `globals.css` — `.skin-heading` margin-top cộng thêm 54px (đủ chiều cao badge coin + khoảng cách) thay vì
  dùng chung offset với `.hub-gold-badge`.

**Test:** Verify trên preview cả 2 costume ("Field Cannon"/"Rune Cannon") — không còn chồng đè, tên tách
khỏi hàng coin.

---

## 108. Nền skin picker: hoạt ảnh sọc loop riêng từng skin, rồi đồng nhất pattern + giảm tốc (02/09)

Yêu cầu 1: nền showroom trong skin picker nên có hoạt ảnh chạy loop (ví dụ sọc), mỗi skin một kiểu khác
nhau.

**Sửa:** `.game-frame.is-skin-classic`/`.is-skin-magic` (`globals.css`) thêm `repeating-linear-gradient` +
`animation` đổi `background-position` liên tục (kỹ thuật giống nhau, chỉ khác góc/màu/tốc độ mỗi flavour).

Yêu cầu 2 (lượt sau): đồng nhất kiểu pattern giống Rune Cannon cho cả 2 skin, nhưng giảm tốc độ.

**Sửa:** gộp về đúng 1 góc/khoảng cách sọc (`-55deg`, 20px/42px) cho cả 2 (chỉ khác màu tint + nền), gộp về
1 `@keyframes skin-bg-drift` dùng chung, tốc độ chậm hẳn lại còn 60s/vòng (trước 42s/30s).

**Test:** Verify trên preview cả 2 costume sau mỗi lần đổi.

---

## 109. Shop: giao diện full-screen theo mockup (icon tròn, price pill), ẩn nút quà tặng ở Shop (02/09)

Yêu cầu: Shop nên fill toàn màn hình giống Skin hub thay vì card nhỏ nổi ở đáy; mỗi sản phẩm trình bày theo
mockup (hình tròn = icon booster, giá = mệnh giá + icon coin); ẩn nút login reward khi đang ở Shop.

**Sửa (`SandGame.tsx`, `globals.css`):**
- Tách Shop ra khỏi `.hub-screen`/`.hub-panel` (bottom-sheet card cũ), dựng `.shop-screen` full-bleed cùng
  cấp `.skin-screen` — loại `tab==="shop"` khỏi điều kiện render `.hub-screen`.
- Mỗi booster là 1 `.shop-card`: tên phía trên, `.shop-card-frame` (khung vuông bo góc) chứa
  `.shop-card-icon` (hình tròn dùng lại `BoosterIcon` — icon gameplay thật, không vẽ icon riêng), badge số
  lượng sở hữu góc trên-phải, và `.shop-buy-btn` (pill giá + icon coin) bên dưới khung.
- `.hub-gift-wrap` thêm điều kiện `tab !== "shop"` để ẩn hẳn khi đang ở Shop.
- Dọn code chết: CSS `.shop-balance/.shop-list/.shop-item*` cũ, và một lỗi TS còn sót (so sánh
  `tab !== "shop"` thừa, vô nghĩa sau khi đã loại "shop" ở điều kiện ngoài) bị `tsc` bắt được, đã xoá.

**Test:** 123/123 test pass, `tsc --noEmit` sạch. Verify trên preview: full-screen đúng, mua được, ẩn nút
gift đúng lúc ở Shop.

---

## 110. Shop: thêm dialog xác nhận trước khi mua (02/09)

Yêu cầu: bấm mua phải hiện dialog xác nhận — số lượng hiện có, số lượng muốn mua, vàng còn lại sau khi mua,
hỏi lại rồi 2 nút Yes/No.

**Sửa (`SandGame.tsx`, `globals.css`):** bấm price pill không mua ngay nữa, chỉ `setBuyConfirm(type)` mở
dialog (tái dùng khung `.result-screen`/`.result-card` — cùng kiểu dialog thắng/thua, daily-login). Dialog
hiện "Currently own"/"Buying: +1"/"Gold left after", 2 nút Yes ("Yes, buy" — mua rồi đóng)/No (đóng, không
mua). Thêm effect đóng dialog khi rời tab Shop để tránh dialog cũ hiện lại.

**Test:** 123/123 test pass. Verify trên preview: Yes trừ đúng vàng + cộng đúng số lượng, No không mua gì.

---

## 111. Dialog xác nhận mua: chọn số lượng bằng stepper, chặn theo ngân sách, Yes/No nằm ngang (02/09)

4 yêu cầu trong 1 lượt:

1. **Chặn tăng số lượng khi vượt quá vàng hiện có** — thêm `buyBoosterCharges(type, qty)` (`economy.ts`,
   atomic — không đủ tiền thì không trừ gì). `buyQtyCap` (`SandGame.tsx`) tính `min(99, floor(gold/giá))`
   thay vì cứng 99; nút "+" tự disable khi chạm trần.
2. **Đổi hàng "Buying" từ text `+1` thành stepper** 2 nút tam giác 2 bên số lượng, min 0 max 99.
3. **Nhấn giữ để tăng/giảm liên tục** — `startQtyHold`/`stopQtyHold` (`onPointerDown/Up/Leave/Cancel`): giữ
   400ms thì bắt đầu lặp mỗi 90ms tới khi nhả; tap nhanh vẫn chỉ 1 bước qua `onClick`
   (`stepQtyOnClick` chặn double-step bằng cờ `qtyHeldRef`).
4. **Đổi "Gold left after" thành "Total cost"** = giá × số lượng.
5. **Yes/No nằm ngang, Yes bên trái** — thêm `.result-actions.is-row` (`grid-template-columns: 1fr 1fr`),
   chỉ áp cho dialog này (không đụng layout dọc của dialog thắng/thua).

Bonus theo yêu cầu riêng ("nền dialog nên có hoạt ảnh loop giống skin, dạng dot vàng"): `.confirm-card`
thêm `radial-gradient` chấm bi + animation đổi `background-position`, nền vàng nhạt `#fdf3c7`, chấm
`#ffc933`.

**Test:** `tsc --noEmit` sạch (dọn 1 lỗi so sánh union type thừa phát sinh từ #109), 123/123 test pass.
Verify trên preview: cap đúng theo vàng, nút "+" disable khi chạm trần, tăng/giảm 1 bước đúng, nền dot hiện
đúng.

---

## 112. Sửa lỗi vòng oval xanh lá còn sót quanh nút tam giác, tăng size dot nền (02/09)

**Nguyên nhân:** `.confirm-qty-btn` (class đơn, specificity thấp) bị rule dùng chung `.result-card button`
(class+element, specificity cao hơn) đè `background`/`width`/`padding` — chính là cái oval xanh lá + full
width nhìn thấy trong ảnh báo lỗi, dù CSS "xoá nền" đã viết trước đó.

**Sửa (`globals.css`):** nâng độ đặc hiệu selector thành `.confirm-card .confirm-qty-btn` (và các biến thể
`:disabled`/`:active`/`::before`) để thắng `.result-card button` trong mọi trạng thái, kể cả lúc disabled
(bug tương tự tái xuất hiện riêng ở state đó, đã thêm `background:none;border:0` tường minh). Màu tam giác
đổi từ `var(--ink)` (đổi theo theme, có thể thành trắng ở dark mode) sang `var(--wood-ink)` (nâu cố định).
Bán kính dot nền tăng `2.5px` → `4.5px`.

**Test:** Verify trên preview — hết oval, dot to rõ hơn.

---

## 113. Canh giữa số lượng giữa 2 mũi tên trong dialog xác nhận mua (02/09)

Lượt 1 (sai): đoán hình tam giác vẽ bằng CSS border-trick bị lệch khỏi tâm nút do "hộp neo" 0px chỉ có
viền màu ở 1 phía, thêm `margin-left: ∓4px` để bù — hoá ra tính sai chiều/độ lớn, số vẫn không nằm giữa,
người dùng báo lại.

**Sửa đúng (lượt 2):** bỏ hẳn kỹ thuật CSS border-trick. Thêm component `StepperArrow` (`SandGame.tsx`) vẽ
mũi tên bằng `<svg><polygon>` thật trong viewBox 10×10, toạ độ đối xứng tuyệt đối quanh tâm (`x: 2..8`, tâm
`x=5`) cho cả 2 hướng — vì hộp SVG có kích thước khai báo rõ ràng (không phụ thuộc hình vẽ bên trong như
border-trick), `place-items:center` của nút giờ canh giữa chính xác. `globals.css` bỏ toàn bộ CSS
`::before`/margin cũ, thêm `.confirm-qty-arrow { width/height:10px }`.

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify trên preview ở nhiều giá trị số lượng (1, 2) —
khoảng cách 2 bên số luôn bằng nhau.

---

## 114. Sửa lỗi hình hub (bức tranh xoay) lóe lên khi chuyển tab Skin → Shop (02/09)

**Nguyên nhân:** `.shop-screen` dùng chung animation `hub-panel-in` với các panel nhỏ khác — animation này
fade `opacity` từ 0 lên 1 trong 260ms. Khác với panel nhỏ (nổi trên lớp scrim đã làm tối sẵn), `.shop-screen`
là lớp phủ toàn màn hình có nhiệm vụ tự che khung cảnh 3D phía dưới bằng chính nền đục của nó — nên lúc
opacity đang fade từ 0, nền cũng trong suốt theo, để lộ hub phía sau trong chớp nhoáng mỗi lần vào Shop.

**Sửa (`globals.css`):** tạo animation riêng `shop-screen-in` — chỉ animate `transform: translateY` (giữ
hiệu ứng trượt lên), bỏ hẳn phần `opacity` để nền luôn đục 100% suốt animation.

**Test:** 123/123 test pass. Verify: `getComputedStyle('.shop-screen').opacity === "1"` ngay khi màn hiện,
xuyên suốt animation (đảm bảo bằng ngữ nghĩa CSS — property không nằm trong keyframes thì không bị nội suy).

---

## 115. Sửa pipeline build standalone (đường dẫn cũ), xuất lại bản HTML 1 file (02/09)

`work/build-standalone.mjs`/`work/standalone-entry.tsx` là pipeline dựng sẵn để xuất toàn bộ game thành 1
file HTML chạy offline (`outputs/3d-cannon-sort.html`), nhưng đã lỗi thời từ đợt pivot game trước (xem
[Sand pivot] trong bộ nhớ) — không chạy được nữa.

**Nguyên nhân:** 2 đường dẫn hard-code trong `build-standalone.mjs` trỏ vào vị trí cũ, đã dời chỗ từ đợt
pivot: `../app/game/sand-levels.ts` (level data đã dời sang `design/levels/sand-levels.ts`), và
`public/level-rewards.csv`/`public/economy.csv` (2 file cấu hình đã dời vào `public/design/`).

**Sửa:** cập nhật cả 3 đường dẫn cho khớp vị trí hiện tại.

**Kết quả build:** `outputs/3d-cannon-sort.html` — 932.486 bytes, 2 level, 1 level-reward override + 12
economy-config override được nhúng thẳng lúc build (đọc CSV tại build time, không cần server lúc chạy).

**Test:** Build chạy sạch không lỗi. Mở file qua static server cục bộ (giả lập offline, không dùng dev
server) — không có log lỗi console nào, Daily Login/Shop/toàn bộ UI đã chỉnh trong phiên này (màu sắc, nút
Settings nâu, Shop full-screen, dialog xác nhận mua...) đều lên đúng. Nút dev-only (link Level editor trong
Settings) xác nhận không xuất hiện trong bản standalone.

---

## 116. Làm lại màn hình Complete Level (rays, pop-up, Continue/X, tiền chỉ bay khi về home); Gallery khoá theo tiến trình + badge phần thưởng mốc (02/09)

Yêu cầu 1 — màn WIN: có tia sáng (rays) + hiệu ứng pop-up; nút "Continue" sang màn tiếp theo; nút "X" quay
về home; hoạt ảnh bay tiền + số tiền chỉ hiện khi về home (không hiện ngay trên màn WIN, không hiện khi bấm
Continue).

**Sửa (`SandGame.tsx`, `globals.css`):**
- WIN và FAIL giờ là 2 khối JSX tách riêng (trước là 1 card dùng chung, đổi tiêu đề theo `kind`). WIN có
  `.result-rays` (conic-gradient quay chậm sau card) + `.result-card.is-win` (animation `win-pop`, bounce
  overshoot) + nút tròn `.result-close-btn` (icon X, góc trên-phải) + nút "Continue" to (chỉ hiện nếu còn
  màn kế tiếp — `hasNextLevel = levelIndex + 1 < playables.length`, gọi `openLevel(levelIndex + 1)`, ở lại
  `playing` luôn, không qua home). FAIL giữ nguyên "Play again"/"Home" như cũ.
- Gold vẫn được cộng ngay lúc thắng (`addGold`, không đổi) nhưng badge/hoạt ảnh của nó bị hoãn: thêm state
  `pendingHomeReward` (cộng dồn qua nhiều lần Continue liên tiếp) và tái dùng `suppressGoldSyncRef` (cơ chế
  daily-login sẵn có) để giữ `displayGold` không nhảy số ngay. Một effect mới, chỉ chạy khi
  `!playing && tab === "home"`, mới thật sự bay coin (6 hạt, xuất phát giữa màn hình — WIN không có vị trí
  cố định như ô ngày daily-login) rồi `tweenGoldTo(wallet.gold)`. Xoá hẳn `.result-reward`/"Already
  cleared..." (không còn hiển thị số tiền trên màn WIN nữa).
- Bug phát sinh giữa chừng: `.result-close-btn` (1 class) bị `.result-card button` (class+element,
  specificity cao hơn) đè thành pill xanh full-width che luôn tiêu đề — cùng loại lỗi specificity đã gặp ở
  mục 112, sửa bằng cách nâng thành `.result-card .result-close-btn`.

Yêu cầu 2 — Gallery: chỉ màn "đã đi qua" mới mở khoá; hiện phần thưởng lớn ở các màn mốc 10/20/30/40/50.

**Sửa:**
- Mở khoá tuần tự: `hasClearedLevel(playables[index-1].level.id)` (hàm có sẵn trong `economy.ts`, chưa ai
  dùng tới) — màn đầu tiên luôn mở, mỗi màn sau cần màn ngay trước nó (theo thứ tự trong `playables`, không
  phải theo `id`) đã từng thắng. Card khoá: thumbnail xám + mờ (`filter: grayscale(1)`), icon ổ khoá
  (`LockIcon`, SVG mới) đè giữa, chữ "Locked" thay tên, `disabled` (không bấm được).
- Mốc thưởng lớn: `entry.level.id % 10 === 0` (theo id, tổng quát cho mọi mốc chục chứ không hard-code 5 số
  10/20/30/40/50 — hiện game mới có 2 level nên chưa màn nào chạm mốc, nhưng cơ chế đã sẵn sàng khi thêm
  level). Hiện badge tròn góc trên-phải (`.hub-gallery-milestone`, cùng ngôn ngữ "pill đè lên góc" với
  `.shop-card-owned`) với đúng số tiền `getLevelRewardOverride(id) ?? levelGoldReward(...)` — số thật một
  màn đó sẽ trả, không phải số tuỳ ý — hiện cả khi màn còn khoá, như một lời mời gọi.

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify trực tiếp trên dev server: tạm tăng `sortRadius`
(2 → 50) và `shotLimit` (12 → 200) của Level 1/2 trong `design/levels/sand-levels.ts` để chơi thắng thật
được trong hợp lý số lượt thao tác chuột (mặc định quá khó để thắng bằng thao tác giả lập), chơi qua toàn bộ
luồng — thắng Level 1 thấy rays/pop/X đúng vị trí sau khi sửa bug, "Continue" nhảy thẳng sang Level 2 không
hiện tiền, vào Settings bấm Home thấy gold cập nhật đúng số (100→120, +20) đúng lúc về home, Gallery mở khoá
Level 2 sau khi thắng Level 1, thắng nốt Level 2 (màn cuối) chỉ thấy nút X (không có Continue vì hết màn),
gold tiếp tục cộng đúng khi về home lần hai (120→145). Đã revert lại `sortRadius`/`shotLimit` về đúng giá trị
gốc sau khi test xong (`git diff` xác nhận file level không còn thay đổi).

---

## 117. Daily Login: bỏ nút "Later", chỉ còn Claim + dấu X đóng ở góc (02/09)

**Sửa (`SandGame.tsx`, `globals.css`):** bỏ hẳn nút "Later"/"Close" ở `.result-actions`; thêm nút tròn
`.result-close-btn` (tái dùng nguyên component/class đã dựng cho màn WIN ở mục 116) góc trên-phải, gọi
`setDailyLoginOverride(null)` — cùng hành động nút cũ vẫn làm. Card chỉ còn nút "Claim {N} coins" khi chưa
claim hôm nay; đã claim rồi thì không còn nút nào dưới cả, chỉ có X.

Nhân tiện tổng quát hoá: `position: relative` dời từ riêng `.result-card.is-win` lên `.result-card` gốc, để
`.result-close-btn` định vị đúng trong BẤT KỲ card nào dùng nó (WIN, giờ thêm Daily Login), không phải khai
báo lại cho từng biến thể.

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify trên preview cả 2 trạng thái: đã claim hôm nay
(chỉ X, không nút nào khác) và chưa claim (nút Claim + X).

---

## 118. Giao diện Shop: nền vân gỗ, bỏ mô tả booster, giá tiền đổi màu theme, bỏ viền/bóng (02/09)

**Sửa (`SandGame.tsx`, `globals.css`):**
- `.shop-screen` nền đổi từ cream (`var(--hub-navy)`) sang nâu gỗ `#775538` + 3 lớp
  `repeating-linear-gradient` chồng nhau giả vân gỗ (1 vân tối mảnh, 1 vân sáng mờ lệch nhịp để không trùng
  vân tối, 1 vân rộng hơi lệch góc 88deg thay vì thẳng 90deg cho tự nhiên hơn) — không cần ảnh, thuần CSS.
- Bỏ dòng mô tả (`BOOSTER_DESC`) khỏi card, chỉ còn tên — giữ lại nội dung mô tả dưới dạng `title` tooltip
  trên tên (hover vẫn xem được), không xoá hẳn.
- `.shop-buy-btn` (box giá tiền): nền đổi từ xanh lá `var(--accent)` sang vàng `var(--gold)` — theo đúng
  màu "tiền" mà `CoinIcon`/badge coin toàn app đang dùng — chữ đổi từ `var(--accent-ink)` sang nâu đậm
  `var(--gold-ink)`.
- Bỏ hết `border`/`box-shadow` trong toàn bộ Shop: `.shop-heading h2`, `.shop-card-frame`,
  `.shop-card-icon`, `.shop-card-owned`. Vì tên booster giờ nằm trực tiếp trên nền gỗ tối (không còn dòng mô
  tả ngăn cách), đổi màu chữ `.shop-card-name` từ `var(--ink)` (nâu, không đủ tương phản trên nền nâu) sang
  kem sáng `#f7ecd8`.

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify trên preview: nền vân gỗ hiện đúng, card không còn
viền/bóng, giá tiền vàng chữ nâu, tên booster đọc rõ trên nền tối.

---

## 119. Vân gỗ Shop: giảm tần suất và độ đậm (02/09)

Phản hồi ngay sau mục 118: vân gỗ dày/nhiều/đậm quá.

**Sửa (`globals.css`, `.shop-screen`):** tăng gấp đôi khoảng cách giữa các đường vân ở cả 3 lớp
`repeating-linear-gradient` (11→24px, 7→16px, 40→80px) và giảm gần một nửa opacity mỗi lớp (.12→.06,
.05→.03, .06→.03). Vẫn 3 lớp, chỉ thưa và nhạt hơn hẳn.

**Test:** Verify trên preview — vân gỗ giờ nhẹ nhàng, không còn rối mắt.

---

## 120. Sửa lỗi: hint idle (viền trắng) hiện ngay khi vào game nếu đã idle sẵn ở hub (02/09)

Báo lỗi: nhấn Play sau khi đứng yên ở menu hub một lúc thì viền trắng "idle hint" hiện lên NGAY khi vừa vào
game, thay vì chỉ hiện sau khi người chơi idle *trong lúc chơi*.

**Nguyên nhân:** `lastInputAt` (mốc thời gian lần cuối có input, `SandCannonEngine.ts`) chỉ được set lúc
constructor (một lần duy nhất, lúc engine dựng lần đầu — engine sống xuyên suốt cả phiên, không dựng lại mỗi
lần vào level) và lúc có input thật (chạm màn hình, hoặc mỗi khi 1 phát bắn resolve xong). Không có chỗ nào
reset nó lúc `setIdle(false)` (thời điểm rời hub vào chơi) — nên nếu người chơi đứng ở hub quá
`IDLE_HINT_DELAY_SECONDS` (10s) trước khi bấm Play, đồng hồ đếm idle coi như đã hết hạn ngay từ trước, hint
bắn ra ở khung hình đầu tiên của ván chơi. Thêm vào đó, điều kiện `eligible` của `updateIdleHint` chỉ dựa vào
`canInteract()` (không loại trừ lúc đang ở hub qua field `idle`) — dù thực tế `canInteract()` đã tự chặn nhờ
`pause()` được gọi trong `setIdle(true)`, đây vẫn là một lỗ hổng phòng thủ đáng vá.

**Sửa (`SandCannonEngine.ts`):**
- `setIdle(false)` (thời điểm bắt đầu chơi) giờ reset `this.lastInputAt = performance.now()` ngay đầu, cùng
  logic với việc `setPhase` reset nó mỗi khi 1 phát bắn resolve xong — đồng hồ idle giờ luôn tính từ lúc
  thật sự bắt đầu chơi.
- `updateIdleHint`'s `eligible` thêm điều kiện `&& !this.idle` — chặn hẳn khả năng hint chạy lúc đang ở hub,
  không chỉ dựa vào `canInteract()` gián tiếp qua `paused`.

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify bằng debug log tạm (`console.log` trong
`updateIdleHint`, đã xoá sau khi test xong): đứng ở hub 13s rồi bấm Play — không hint, không log. Đứng yên
tiếp trong lúc chơi 10s — hint xuất hiện đúng lúc (log ghi `secsSince: ~10.0`), viền trắng hiện đúng quanh
mép bức tranh.

---

## 121. Thêm outline đen cho quả đạn bắn ra từ cannon (02/09)

**Sửa (`SandCannonEngine.ts`):** thêm `buildProjectileOutline()` — mesh con dùng lại đúng hình cầu
(`SphereGeometry`), phóng to theo tỉ lệ cố định (`PROJECTILE_OUTLINE_SCALE = 1.22`) và lật `side:
THREE.BackSide`, đây là kỹ thuật outline kinh điển không cần shader: ở rìa silhouette, mặt sau của lớp vỏ
to hơn ló ra ngoài quả cầu màu nhỏ hơn nằm phía trước; còn lại thì quả cầu màu che hết — kết quả đọc thành
một viền mỏng, không phải một quả cầu đen đặc. Vì là mesh con nên tự động theo đúng vị trí/scale/visibility
của quả đạn cha (kể cả lúc phồng to do Radius Overcharge), không cần đồng bộ tay ở đâu cả. Geometry + material
outline dùng chung 1 bản duy nhất (lazy, cache lại), áp dụng cho cả đạn bắn thật (`fire()`) lẫn đạn demo ở
showroom chọn skin (`launchShowcaseShot()`).

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify trên preview — quả đạn bay ra có viền đen rõ quanh
mép, cả lúc bắn thật lẫn lúc xem demo trong Skin picker.

---

## 122. Skin picker: thu nhỏ thumbnail card, bỏ viền/bóng khay chứa (02/09)

Báo lỗi: card thumbnail đang preview bị "lấp" bởi phần vân sọc ngay phía trên — công thức chiều cao khay
(`.skin-tray`) trước đó khít tuyệt đối (14px đệm trên + 78px card + 14px đệm dưới = đúng 106px, không dư),
nên card gần như chạm hẳn mép trên của khay, đọc như bị đè bởi nền sọc ngay sát phía trên.

**Sửa (`globals.css`):**
- `.skin-grid` card size 78px → 64px (`grid-auto-columns`).
- `.skin-tray` đệm trên tăng 14px → 20px (nhiều hơn đệm dưới 14px, có chủ đích — chừa khoảng thở rõ ràng
  phía trên card), công thức chiều cao đổi theo (106px → 98px cho đúng tổng 20+64+14).
- Bỏ `border-top: 2px solid var(--line)` và `box-shadow` của `.skin-tray` — theo đúng hướng "phẳng, không
  viền/bóng" đang áp dụng dần cho toàn app.

**Test:** 123/123 test pass. Verify trên preview cả 2 costume — card đủ khoảng thở phía trên, viền xanh
preview hiện trọn vẹn không bị cắt, khay không còn viền/bóng.

---

## 123. Shop redesign: 2 tab Gems (real-money, hiện chỉ để trưng) / Coins (booster shop cũ), dựng từ wireframe (03/09)

Yêu cầu: dựng wireframe Shop lấy cảm hứng Animal Crossing (màu trơn, không gradient/viền/bóng), chia 2 tab
theo loại tiền tệ, sau khi duyệt thì áp thẳng vào code thật (không dừng ở mockup).

**Wallet (`economy.ts`):** thêm `gems: number` vào `Wallet`, hằng số `STARTER_GEMS = 240` — hard currency
mới, thuần hiển thị, chưa có gì tiêu được nó (giống gold hồi trước khi có booster). `getGems()`,
`readWallet()`/`defaultWallet()`/`__resetWalletForTests` cập nhật theo. Không hook qua `economy.csv` vì chưa
cần cấu hình gì (đơn giản hoá có chủ đích).

**Shop screen (`SandGame.tsx`, `globals.css`):**
- State `shopTab: "gems" | "coins"`, mặc định `"coins"` (giữ đúng hành vi hiện có, tab mới là phần thêm).
- Tab **Gems**: Special Offers (2 gói, mỗi gói gems+coins), Gem Bundles (5 mốc 80→7.000 gems, $0.99→$49.99,
  tag "Most popular"/"Best value"), Coins (7 mốc $0.99→$99.99 mua coin trực tiếp). Toàn bộ nút mua chỉ gọi
  `notifyIapComingSoon()` — chưa có payment processor thật, hiện toast "Real-money purchases aren't live in
  this build yet." (`.shop-iap-toast`).
- Tab **Coins**: y nguyên shop booster cũ (Radius Overcharge/Prism Shot), không đổi logic mua.
- `.shop-scroll` tách riêng khỏi `.shop-screen` (screen hết `overflow:auto`, chuyển `overflow:hidden`) — lý
  do: heading/tab-switcher cần đứng yên không cuộn theo, và `.shop-iap-toast` cần một box không-cuộn để ghim
  vào, nếu để chung 1 vùng cuộn thì toast cuộn mất khỏi màn hình cùng nội dung (bug tự phát hiện khi test).
- Token màu mới `--gem`/`--gem-deep`/`--gem-ink` (xanh ngọc/mint) cho hard currency, tách biệt với `--gold`.
- `GemIcon` component mới (kiểu vẽ giống `CoinIcon`: fill phẳng + facet line).

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify trên preview: chuyển tab, cuộn, bấm mua ở tab Gems
ra đúng toast, tab Coins mua booster vẫn hoạt động như cũ không đổi gì.

---

## 124. Shop: Special Offers xếp dọc, Bundle đổi thành gems+coins gộp chung (03/09)

Phản hồi ngay sau mục 123.

**Sửa (`SandGame.tsx`, `globals.css`):**
- `.offer-stack` đổi từ dải cuộn ngang (`overflow-x`) sang xếp dọc từ trên xuống — mỗi offer đọc được không
  cần vuốt ngang.
- Data `BUNDLES` đổi cấu trúc: trước chỉ có `gems`, giờ mỗi gói có cả `gems` **và** `coins` (route qua 1 lần
  mua nhận cả 2 loại tiền) — card bundle hiện thêm dòng phụ `.bundle-sub` (icon coin nhỏ + số coin) dưới số
  gems chính. Section **Coins** (mua coin thuần bằng tiền thật) giữ nguyên không đổi.

**Test:** `tsc --noEmit` sạch, 123/123 test pass.

---

## 125. Home tab: import ảnh thật `HomeIcon.png` thay icon vector (03/09)

Yêu cầu: thay icon Home ở thanh nav dưới bằng đúng ảnh tham khảo (ngôi nhà mái đỏ), không vẽ lại bằng vector.

**`SandGame.tsx`:** `HomeIcon({ active })` — active thì render thẳng `<img src="/icons/HomeIcon.png">` full
màu; không active thì render `<span>` nền `--wood-ink` dùng CSS `mask-image` trỏ **đúng file ảnh đó** để cắt
theo alpha thật của ảnh — silhouette 1 màu nâu sẫm luôn khớp chính xác hình dạng ảnh gốc, không phải bản vẽ
tay gần đúng, và 2 trạng thái không bao giờ lệch nhau vì cùng xuất phát từ 1 file. `HubIcon` tách case
`"home"` ra khỏi khối `<svg>` dùng chung của 4 tab còn lại (kỹ thuật cũ "1 path, CSS toggle fill/stroke"
không áp dụng được cho ảnh raster nhiều màu).

**`globals.css`:** `.home-icon-photo`/`.is-silhouette` mới (kích thước ăn theo `.hub-nav-icon` sẵn có,
`object-fit: contain`, `mask-size/repeat/position: contain/no-repeat/center`).

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify: active hiện đủ màu, các tab khác vẫn active/inactive
đúng như cũ.

---

## 126. Áp ảnh thật cho tab Shop & Skin, refactor icon-ảnh dùng chung (03/09)

**`SandGame.tsx`:** tổng quát hoá mục 125 — map `TAB_PHOTO_ICON: Partial<Record<HubTab, string>>` (tab →
đường dẫn ảnh) và component dùng chung `PhotoTabIcon({ src, active })` thay cho `HomeIcon` riêng. Thêm
`shop: "/icons/ShoppingCartIcon.png"`, `skin: "/icons/CannonSkinIcon.png"`. `HubIcon` giờ tra `TAB_PHOTO_ICON`
trước, có thì trả `PhotoTabIcon`, không thì mới vẽ `<svg>` như cũ (Gallery, Customize).

**`globals.css`:** `.home-icon-photo`/`.is-silhouette` đổi tên thành `.photo-tab-icon` (dùng chung), bỏ
`mask-image` cứng theo 1 file (mỗi tab trỏ ảnh khác nhau) — set qua inline style `WebkitMaskImage`/`maskImage`
theo từng instance. Dọn 3 dòng CSS `fill` chết (Home/Skin/Shop không còn dùng `fill` để tô icon nữa).

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify: Shop active hiện xe đẩy hàng đủ màu, Skin active
hiện cannon-trên-móc-áo đủ màu, cả hai inactive đều ra đúng silhouette nâu sẫm.

---

## 127. Áp ảnh thật cho tab Gallery + icon Coin currency (03/09)

**`SandGame.tsx`:**
- Thêm `gallery: "/icons/GalleryIcon.png"` vào `TAB_PHOTO_ICON`, bỏ case `"gallery"` khỏi `<svg>` dùng chung
  (Customize giờ là tab cuối cùng còn icon vector).
- `CoinIcon()` đổi hẳn từ SVG vẽ tay sang `<img src="/icons/CoinIcon.png">` — icon này không có trạng thái
  active/inactive (giá tiền không "được chọn"), nên chỉ là ảnh tĩnh; mọi nơi dùng `.coin-icon` (badge ví,
  giá booster, gói coin, daily login, coin bay khi nhận thưởng) tự động ăn theo vì đều style qua class, không
  qua element.

**`globals.css`:** dọn nốt dòng `fill` chết còn lại cho Gallery; `.coin-icon` gốc bỏ `color: var(--gold-line)`
(không còn tác dụng với `<img>`), thêm `object-fit: contain`.

**Test:** `tsc --noEmit` sạch, 123/123 test pass.

---

## 128. Nút Daily Login: đổi sang `LoginIcon.png`, hộp vuông bo góc nền mint (03/09)

Yêu cầu: dùng đúng ảnh lịch tham khảo; hộp chứa đổi từ tròn sang vuông bo góc nhẹ, nền mint.

**`SandGame.tsx`:** nút gift render `<img src="/icons/LoginIcon.png">` thay `<Glyph name="gift" />`. Xoá case
`"gift"` khỏi `Glyph`/`ChromeGlyph` (không còn nơi nào dùng).

**`globals.css`:** `.gift-button` mới (override `.icon-button` dùng chung) — `border-radius: var(--r-md)`,
nền mint `#93e6c4`, hover `#7ed8b3`. `.gift-button-icon` 30px, `object-fit: contain`.

**Test:** `tsc --noEmit` sạch, 123/123 test pass.

---

## 129. Gallery: full-screen như Shop/Skin, grid 4 level/hàng (03/09)

Yêu cầu: Gallery đang là bottom-sheet nhỏ (`.hub-panel`) nổi trên hình nền — đổi thành full-screen takeover
giống Shop/Skin, và ép 4 thumbnail/hàng thay vì tự co giãn.

**`SandGame.tsx`:** thêm `.gallery-screen` (cùng tầng `.shop-screen`/`.skin-screen`, loại khỏi điều kiện render
của `.hub-screen`), chuyển nguyên nội dung gallery (thumbnail, khoá theo tiến trình, badge mốc thưởng — logic
không đổi, chỉ đổi khung chứa) sang đó. Ẩn `.hub-gift-wrap` (nút daily login nổi) khi ở tab Gallery, giống
cách Shop đã ẩn — full-screen giờ chiếm đúng góc nút đó từng nổi.

**`globals.css`:** `.hub-gallery` đổi `grid-template-columns` từ `repeat(auto-fill, minmax(96px, 1fr))` sang
`repeat(4, 1fr)` cố định + `width/max-width` khớp `.shop-grid`. `.gallery-screen`/`.gallery-heading` mới, nền
`var(--hub-navy)` (tường cream của hub, không mượn màu gỗ của Shop vì Gallery không phải bề mặt kiếm tiền).

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify: Gallery chiếm hết màn hình, đúng 4 thumbnail/hàng,
nút quà tặng không còn đè lên grid.

---

## 130. Bố cục Hub: thu nhỏ bức tranh, logic đóng Daily Login, ẩn ở Skin/Customize, Settings hiện mọi hub (03/09)

4 yêu cầu trong 1 lượt.

**1. Thu nhỏ bức tranh ở hub, phóng to lại khi Play (`SandCannonEngine.ts`):** hằng số `HUB_FRAME_SCALE =
0.74` — lý do: mép phải bức tranh cỡ thật chạm đúng vào nút daily login nổi bên phải. `buildFrame()` set
scale ban đầu theo `this.idle`. `setIdle(true)` (về hub) co ngay lập tức, cùng kiểu snap-tức-thì với cannon
biến mất (không animate). `setIdle(false)` (bấm Play) tận dụng animation "xoay tranh về góc thẳng" có sẵn
(`spinReturnStart`/`SPIN_RETURN_SECONDS`) — `updateFrameSpin` giờ nội suy thêm `scale` cùng lúc với
`rotation.y`, từ `HUB_FRAME_SCALE` lên 1 trong đúng 1 giây, cùng easing.

**2. Logic nút Daily Login (`SandGame.tsx`):**
- Nút tự ẩn khi modal đang mở (đỡ đè lên card của chính nó).
- Thêm đóng bằng bấm ra ngoài hộp: `onClick` trên `.result-screen` (scrim), chỉ đóng nếu
  `event.target === event.currentTarget` (không đóng khi bấm bên trong card, tránh bấm nhầm khi tương tác nội
  dung). Nút X góc (đã có sẵn) vẫn hoạt động như cũ.

**3. Ẩn nút Daily Login ở Skin & Customize:** gộp điều kiện hiện nút xuống còn đúng 1 dòng `tab === "home"`
(trước đó chỉ loại trừ Shop/Gallery).

**4. Settings hiện ở mọi hub:** bỏ `hidden={tab === "skin"}` trên `.settings-wrap` — lý do ẩn cũ ("Skin có
nút đóng riêng ở góc đó") đã lỗi thời, Skin screen hiện không còn nút đóng riêng nào (chỉ dựa vào `.hub-nav`
để rời màn), nên ẩn gear đi là để trống góc không cần thiết.

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify trên preview: bức tranh nhỏ hẳn ở hub không đè icon,
phóng to mượt khi bấm Play; mở Daily Login rồi bấm ra ngoài đóng được; Skin/Customize không còn nút daily
login; Settings xuất hiện đúng ở Skin.

---

## 131. Sửa lỗi: FTUE gesture / tutorial còn hiện đè lên Home hub sau khi Settings → Home (03/09)

Báo lỗi: mở gợi ý FTUE (kéo-thả) giữa màn, vào Settings bấm Home mà chưa thao tác/đóng gợi ý — gợi ý vẫn tiếp
tục hiện đè lên Home hub.

**Nguyên nhân:** `{ftueGestureOpen && level.ftueGesture && (...)}` và `{tutorialOpen && level.tutorial &&
(...)}` không hề kiểm tra `playing` — 2 overlay này chỉ tắt khi người chơi thật sự chạm vùng ngắm
(`AIM_TOUCHED`) hoặc bấm "Got it", không có đường nào tắt khi rời màn chơi bằng cách khác (nút Home trong
Settings, X màn WIN, Home màn FAIL).

**Sửa (`SandGame.tsx`):** thêm `playing &&` vào cả 2 điều kiện render. Đồng thời reset cả
`setTutorialOpen(false)`/`setFtueGestureOpen(false)` ngay trong `goHome()` (hàm chung mọi đường về Home đều
gọi qua) — không chỉ chặn hiển thị mà còn dọn state, tránh còn "mở ngầm" khi quay lại chơi.

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Tái hiện đúng lỗi rồi xác nhận đã hết: mở FTUE giữa màn →
Settings → Home → không còn overlay nào trên Home hub.

---

## 132. Nút Settings: đổi sang `SettingIcon.png`, sửa lỗi bị cắt góc (03/09)

**`SandGame.tsx`:** `<img src="/icons/SettingIcon.png">` thay `<Glyph name="gear" />`. Xoá case `"gear"` khỏi
`Glyph`/`ChromeGlyph` (không còn nơi nào dùng).

**`globals.css`:** `.settings-button` chuyển nền trong suốt (ảnh đã có sẵn nền vuông bo góc xám đậm riêng),
`.settings-button-icon` 44px `object-fit: contain`. Bug phát sinh ngay lượt đầu: có thêm `border-radius` +
`overflow: hidden` làm "safety clip" — bị báo cắt mất góc ảnh. Sửa: bỏ hẳn `overflow: hidden`/border-radius
khỏi `.settings-button`, không clip gì cả, để `object-fit: contain` (không phải `cover`) là quy tắc kích
thước duy nhất — ảnh hiện nguyên vẹn 100%.

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify: icon hiện đủ 4 góc vuông, không góc nào bị cắt.

---

## 133. FTUE: đổi bàn tay vẽ tay sang ảnh thật `FTUEicon.png` (03/09)

**`SandGame.tsx`:** trong `<svg className="ftue-gesture-glyph">`, thay group `<rect>/<circle>/<rect>/<line>`
dựng tay bằng 1 thẻ `<image href="/icons/FTUEicon.png" x={-33} y={-69} width={72} height={83} />` lồng trong
đúng `<g className="ftue-gesture-hand">` mà animation glide giữa 2 vòng tròn (`ftue-gesture-drag` trong
`globals.css`) đã và đang chạy — không viết lại animation, chỉ đổi nội dung bên trong group. Offset x/y chọn
sao cho đầu ngón trỏ trong ảnh rơi đúng vào gốc toạ độ cục bộ (0,0) của group — đúng quy ước "fingertip tại
gốc" mà các keyframe `translate(ring.cx, ring.cy)` có sẵn đang dùng, nên tay bấm đúng vào 2 vòng tròn không
cần đổi số trong keyframe.

**`globals.css`:** `.ftue-gesture-hand` bỏ `fill`/`stroke` (vô nghĩa với ảnh raster), chỉ còn giữ
`animation`. Xoá `.ftue-gesture-hand-crease` (chi tiết chỉ có ở bản vẽ tay cũ, không còn dùng).

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify trên preview: tay ảnh thật lướt đúng từ vòng A sang
vòng B theo animation gốc, không cần chỉnh lại keyframe.

---

## 134. Đồng bộ mức bo góc mọi nút chrome theo đúng icon Settings (03/09)

Yêu cầu: Daily Login/Coin badge/Play button phải bo góc **cùng mức** với `SettingIcon.png`, không phải đoán
bằng mắt.

**Đo bằng script tạm (`sharp`, xoá sau khi đo xong):** quét kênh alpha của `SettingIcon.png`, tìm bounding
box nội dung thật (1100×1057px trong canvas 1254×1254px), dò điểm chiều rộng dòng ngang chạm mốc "phẳng"
(hết cong góc) — bán kính góc đo được ≈ 200px trên 1100px chiều rộng (~18,2%). Quy đổi sang nút chuẩn 44px
của app: **8px**.

**`globals.css`:** thêm token riêng `--r-chrome: 8px` (không sửa `--r-md` vì token đó dùng chung nhiều chỗ
không liên quan). Áp `var(--r-chrome)` cho `.gift-button`, `.hub-gold-badge`, `.hub-play-btn` (trước đó cả 3
đang dùng `--r-md` = 20px, bo tròn hơn hẳn so với icon Settings thật).

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify trên preview: coin badge, daily login, Play button
và Settings đọc cùng một "độ bo góc" nhất quán.

---

## 135. Bố cục Hub: dời Daily Login xuống dưới Settings, mint nhạt hơn, Play to hơn (03/09)

**`globals.css`:**
- `.hub-gift-wrap` đổi từ căn giữa theo chiều dọc ở mép phải sang nằm ngay dưới `.settings-wrap`
  (`top: calc(hud-inset + 44px + 12px)`, cùng `right`) — 44px là chiều cao nút gear, 12px là khoảng cách.
- `.gift-button` nền `#93e6c4` → `#c9f2e1` (nhạt hơn hẳn), hover `#7ed8b3` → `#b3ecd4`.
- `.hub-play-btn` padding `18px 48px` → `26px 64px`, `font-size` `17px` → `22px`.

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify trên preview: Daily Login xếp đúng dưới Settings,
màu mint nhạt rõ rệt, nút Play to hẳn ra so với trước.

---

## 136. Shop: bỏ vân gỗ, đổi nền phẳng nâu nhạt (03/09)

Đảo ngược một phần mục 118/119: bỏ hẳn kỹ thuật vân gỗ (3 lớp `repeating-linear-gradient`), theo yêu cầu đổi
sang 1 màu phẳng, sáng hơn.

**`globals.css`:**
- `.shop-screen` nền đổi từ `#775538` (nâu gỗ đậm) + 3 lớp vân sang phẳng `#dcc7a8` (nâu nhạt), không
  `background-image` nào cả.
- Kéo theo đổi màu chữ vốn được chọn riêng cho nền tối: `.shop-tab-btn` (tab không active) `#e6d8bf` →
  `var(--ink)`; `.shop-section-head h3` `#f7ecd8` → `var(--ink)`; `.shop-section-head p` `#d8c3a4` →
  `var(--muted)`; `.shop-card-name` `#f7ecd8` → `var(--ink)`. `.shop-tabs` (track chứa tab switcher, nền đen
  mờ `rgba(0,0,0,.18)`) giữ nguyên — vẫn đủ tương phản trên nền mới.

**Test:** `tsc --noEmit` sạch, 123/123 test pass. Verify trên preview cả 2 tab Gems/Coins: nền phẳng không
còn vân, mọi label/badge/card đều đọc rõ trên nền mới.

---

## 137. Khoá bắn trong lúc cát settling; badge 3 chấm hiện đúng suốt animation (03/09)

Trước đây `handleImpact()` trả `phase` về `"READY"` ngay khi shot vừa resolve — animation rơi/settle
(clear flash → grain fall → hold) chỉ là cosmetic, không chặn input. Người chơi có thể bắn tiếp trong lúc
cát còn đang rơi, và badge 3 chấm "đang settling" (`.settle-badge`, đã có sẵn CSS/markup) không bao giờ
hiện vì `phase` không bao giờ thật sự là `SETTLING`.

**`SandCannonEngine.ts`:**
- `handleImpact()`: khi shot phá được cát (`resolution.removed.length > 0`), ghi đè `phase` của state thành
  `"SETTLING"` thay vì giữ nguyên `"READY"` mà `resolveShot` trả về (bỏ qua nếu shot đã kết thúc màn —
  `result` đã có WIN/FAIL thì giữ nguyên).
- `advanceBeats()`: khi hàng đợi beat rỗng (tức animation settle đã chạy xong hết — clear + mọi bước rơi +
  hold), mới chuyển `phase` về `"READY"` và phát lại state. Đây là nơi thật sự trả quyền bắn lại cho người
  chơi, vì `canInteract()`/`canStartAim()` vốn đã chặn theo `phase === "READY"`.
- Sửa lại các comment cũ mô tả sai hành vi ("settle thuần cosmetic, shot sau không cần chờ") cho khớp với
  cơ chế mới.

Không cần sửa UI: `busy` trong `SandGame.tsx` đã tính theo `BUSY_PHASES` (có sẵn `"SETTLING"`) từ trước, nên
badge 3 chấm tự động hiện đúng lúc mà không cần đổi gì ở tầng React.

**Test:** `tsc --noEmit` sạch (không phát sinh lỗi ở `SandCannonEngine.ts`/`SandGame.tsx`/`sand-rules.ts`).
Verify trên preview: bắn một phát trúng cát → badge 3 chấm hiện ngay trên chỗ vừa vỡ; bắn tiếp trong lúc
đang settling bị bơ hoàn toàn (ammo không đổi, không có phát bắn mới); đợi animation rơi xong, badge biến
mất, bắn lại hoạt động bình thường.

---

## 138. Nút Home/Restart trong Settings: dùng `ReturnMainHubIcon.png`/`ReplayIcon.png`, bỏ shape tròn nền (03/09)

`.settings-round-button` (Home/Restart mid-play) đổi từ glyph `Glyph name="home"`/`Glyph name="restart"` vẽ
tay sang ảnh thật, rồi theo yêu cầu tiếp theo bỏ luôn shape hình tròn bọc ngoài — art đã tự mang theo nền
riêng nên nút chỉ còn là vùng chạm trong suốt định vị ảnh.

**`SandGame.tsx`:**
- Hai `<img src="/icons/ReturnMainHubIcon.png">`/`<img src="/icons/ReplayIcon.png">` thay cho `<Glyph
  name="home"/>`/`<Glyph name="restart"/>`.
- Xoá hẳn case `"home"`/`"restart"` khỏi `Glyph()` và khỏi type `ChromeGlyph` — không còn nơi nào dùng nữa.

**`globals.css`:**
- `.settings-round-button`: bỏ `border-radius: 50%`, `border`, `background` — giờ chỉ còn kích thước/canh
  giữa, không còn shape tròn riêng.
- `.settings-round-button-icon`: `width/height` 40px cố định → `100%` (lấp đầy nút, để `object-fit: contain`
  lo phần không crop).

**Test:** `tsc --noEmit` sạch. Verify trên preview: hai nút Home/Restart trong Settings chỉ còn hiện đúng
icon vuông-bo-góc riêng của từng ảnh, không còn viền tròn nền bọc ngoài.

---

## 139. Hub: nút Play → "Level N" thu nhỏ bỏ hiệu ứng breathe, thêm nút Modes cạnh bên (03/09)

Theo yêu cầu đổi bố cục màn Home: nút Play to, màu hồng, tự thở (breathe) và chữ "Play Level N" đổi thành
hai nút nhỏ nằm cạnh nhau — Level bên trái (giữ màu hồng, bỏ animation, chỉ còn "Level N"), Modes bên phải
(nút mới, cùng cỡ, nền `#EEC17E`, hiện chưa có hành vi vì tính năng Modes chưa tồn tại).

**`SandGame.tsx`:**
- `.hub-tap` (button full-bleed bọc `.hub-play-hint > .hub-play-btn`) thay bằng `.hub-actions` (div định vị,
  không phải nút) chứa hai `<button>` thật: `.hub-play-btn` (`onClick={startPlaying}`, text `Level {id}`) và
  `.hub-modes-btn` (text `Modes`, chưa gắn `onClick`).

**`globals.css`:**
- `.hub-play-btn`: bỏ `animation: hub-play-breathe`; `padding`/`font-size` thu nhỏ (26px 64px/22px →
  14px→22px 30px/16px→20px qua vài lượt chỉnh); nền hồng giữ nguyên `#ffcad3`.
- `.hub-modes-btn` (mới): cùng kích thước với `.hub-play-btn`, nền `#EEC17E`, chữ cùng màu `#725653`.
- `.hub-actions`: `display:flex; justify-content:center; gap` (chỉnh qua vài lượt theo phản hồi — 4px quá
  sát, chốt ở 14px), `flex:0 0 auto; white-space:nowrap` trên hai nút con để "Level 1" không bị wrap dòng.
- Xoá `@keyframes hub-play-breathe` (không còn ai dùng); cập nhật animation "thoát màn" (`is-leaving`) trỏ
  sang `.hub-actions`/hai nút mới thay vì `.hub-tap`/`.hub-play-btn` cũ.

**Test:** `tsc --noEmit` sạch. Verify trên preview: hai nút "Level 1"/"Modes" đứng cạnh nhau, cỡ bằng nhau,
không còn hiệu ứng thở nhấp nháy, bấm "Level 1" vẫn vào màn chơi bình thường.

---

## 140. Mở rộng guideline "không stroke/shadow/gradient" ra toàn bộ HUD tĩnh, không chỉ nút bấm (03/09)

Guideline gốc ở đầu `globals.css` chỉ cấm border/box-shadow/gradient trên các nút bấm — panel/modal/badge/
toast tĩnh vẫn được giữ `border`+`--shadow-*`. Audit lại cho thấy mọi nút bấm trong game đã tuân thủ đúng
rule cũ; theo yêu cầu mở rộng, bỏ luôn ngoại lệ đó — toàn bộ chrome tĩnh giờ cũng phẳng, phân biệt bằng màu
nền thay vì viền/đổ bóng. Ngoại lệ duy nhất giữ lại: aim-crosshair/joystick trong lúc chơi (viền cần thiết để
đọc được trên mọi màu cát, không phải hiệu ứng chiều sâu trang trí) và toàn bộ Level Editor (tool dev riêng,
theme tối, ngoài phạm vi).

**`globals.css`:** bỏ `border`/`box-shadow`/`text-shadow`/`filter: drop-shadow` khỏi: `.loading-track`,
`.game-frame` (đổ bóng ở breakpoint tablet/desktop), `.coin-fly .coin-icon`, `.settings-card`/
`.settings-card-header`/`.settings-select`/hàng `.settings-row` (bỏ luôn đường kẻ phân cách), `.shots-badge`
+ highlight nổi trên `.shots-icon` + đường kẻ `.shots-upcoming`, `.ftue-gesture-caption`, `.booster-hud` +
`.booster-badge`, `.sand-toast` (hai biến thể `is-warn`/`is-good` đổi từ border-color sang nền phẳng
`--danger`/`--accent` để vẫn giữ được tín hiệu màu), `.result-card` + `.result-card-header h2` (text-shadow),
`.daily-login-day` (cả biến thể `is-today`), `.hub-level-name`, `.hub-panel`, `.hub-gallery-milestone`,
`.shop-card-owned`, `.skin-heading h2` (đồng bộ với `.shop-heading`/`.gallery-heading` vốn đã phẳng sẵn),
`.skin-card-tick`, `.pixel-thumb`. Xoá luôn 5 token `--shadow-chip/btn/panel/modal/press` ở `:root` (không
còn nơi nào trong game thật dùng tới, override "về none" trong theme Level Editor vẫn giữ nguyên, không ảnh
hưởng).

**Test:** `tsc --noEmit` sạch. Verify trên preview: hub, Settings, Skin picker, panel Customize — mọi
badge/panel/toast đều phẳng, không còn viền/đổ bóng ở đâu ngoài aim reticle lúc bắn.

---

## 141. Thay 3 nút Cancel/X bằng `CancelIcon.png`; Settings đóng được khi tap ra ngoài panel (03/09)

**`SandGame.tsx`:**
- `CloseIcon()` (svg X vẽ tay) đổi tên/nội dung thành `CancelIcon()`, render `<img src="/icons/
  CancelIcon.png">` — dùng ở cả 3 chỗ: nút X của Settings, nút X của thẻ WIN, nút X của Daily Login.
- `.settings-screen` (backdrop Settings) thêm `onClick` kiểu "tap ra ngoài đóng lại" y hệt pattern đã có sẵn
  ở Daily Login (`event.target === event.currentTarget` mới đóng, tap vào card bên trong không bị ăn theo).

**`globals.css`:** `.settings-close`/`.result-card .result-close-btn` bỏ `background`/hover-highlight — ảnh
`CancelIcon` đã tự mang theo hình tròn đỏ-hồng riêng nên nút chỉ còn là vùng chạm trong suốt (cùng pattern
với Home/Restart ở mục 138); `.close-icon` (rule size dùng chung) đổi từ style svg stroke sang
`object-fit: contain` cho `<img>`, cỡ 26px.

**Test:** `tsc --noEmit` sạch. Verify trên preview: mở Settings mid-play → tap CancelIcon đóng được, tap ra
vùng tối ngoài card cũng đóng được; thẻ WIN/Daily Login vẫn dùng đúng icon mới.

---

## 142. Làm lại Hub currency HUD: coin đè lên pill, thêm nút "+" dẫn tới mua Coin bằng tiền thật (03/09)

Theo layout tham khảo người dùng gửi: đồng xu to đè lên pill số dư thay vì icon nhỏ nằm trong, cộng thêm nút
"+" ở cuối pill. Qua nhiều vòng chỉnh theo phản hồi, chốt lại các thông số cuối cùng dưới đây.

**`SandGame.tsx`:**
- `.hub-gold-wrap` đổi từ `<div>` định vị thuần sang `<button>` thật (`onClick={openCoinPacks}`), bọc
  `<CoinIcon />` (không còn nằm trong `.hub-gold-badge`) và `.hub-gold-badge` (số dư + `.hub-gold-plus`).
- `openCoinPacks`: `setTab("shop")` + `setShopTab("gems")` + cờ `scrollToCoinPacks`; một `useEffect` sau đó
  cuộn mượt (`scrollIntoView`) tới đúng section "Coins" (gói mua bằng tiền thật, `coinPackSectionRef`) —
  không chỉ mở tab Gems mà còn cuộn thẳng tới chỗ mua, vì section đó nằm dưới Special Offers/Bundles.
- `goldHudRef` đổi type từ `HTMLDivElement` sang `HTMLSpanElement` (đích bay của coin daily-login) do
  `.hub-gold-badge` đổi từ `div` sang `span`.
- `PlusIcon()`: ban đầu là svg `+` vẽ tay trên nền tròn xanh lá tự vẽ, sau đổi hẳn sang ảnh thật
  `/icons/PlusIcon.png` (đã có sẵn hình tròn xanh riêng) theo yêu cầu dùng icon có sẵn trong thư mục.

**`globals.css`:**
- `.hub-gold-wrap`: height cố định 44px = đúng chiều cao `.icon-button` (nút Settings), cùng `top` inset —
  để hai HUD hai góc luôn ngang hàng, cùng cỡ (verify bằng `getBoundingClientRect()`: `top`/`height` khớp
  tuyệt đối 14/44).
- `.hub-gold-wrap .coin-icon`: 44px (khớp chiều cao hàng, không tràn trên/dưới nữa), `margin-right: -42px` —
  đè sâu vào pill tới mức che kín hoàn toàn phần bo tròn đầu pill (không còn hở viền vàng cong ra ngoài, đã
  verify bằng cách phóng to 6x phần tử để soi).
- `.hub-gold-badge`: nền đổi từ `var(--panel)` (kem) sang vàng nhạt `#fde59c`; `border-radius` từ
  `var(--r-chrome)` (8px) sang `var(--r-pill)` (bo tròn hoàn toàn, khớp dáng tròn của đồng xu); `padding-left`
  tăng dần qua các lượt chỉnh (26px → 48px) để số dư không bị đồng xu che và có khoảng cách rõ với icon.
  `padding-right` 6px.
- `.hub-gold-plus`: từ hình tròn nền xanh lá tự vẽ (30px, `background: var(--accent)`) rút gọn thành khung
  bare 22px chỉ để định vị `<img>` `PlusIcon.png` (đã tự mang nền tròn riêng).

**Test:** `tsc --noEmit` sạch. Verify trên preview: HUD tiền tệ ngang hàng và cao bằng nút Settings; nền pill
vàng nhạt, bo tròn hết cỡ; đồng xu đè kín phần bo góc bên trái pill (soi ở zoom 6x không còn hở viền); bấm
vào HUD mở đúng Shop → tab Gems → cuộn tới section "Coins" (mua bằng tiền thật); số dư "160" có khoảng cách
rõ với đồng xu.

---

## 143. Booster: đạn Radius Overcharge phồng cố định 350%, vệt Prism Shot dài hơn (03/09)

Bản đầu cho quả bóng Radius Overcharge phồng to bằng đúng bán kính hiệu lực của phát bắn
(`effectiveSortRadius`) — theo phản hồi, cách này quá lố mỗi khi bán kính level lớn ("1 ý tồi"). Đổi sang
một hệ số phồng cố định, dễ đọc và không phụ thuộc dữ liệu level.

**`SandCannonEngine.ts`:**
- `BOOSTER_PROJECTILE_SCALE`: 1.6 → **3.5** (đạn phồng thêm 350% kích thước gốc lúc bay tới khung);
  `radiusBoosterMaxProjectileScale()` bỏ hẳn phần tính theo `effectiveSortRadius`/`this.cell`, trả thẳng
  hằng số.
- Prism Shot: `PRISM_TRAIL_INTERVAL` 0.025 → 0.016 (rơi mảnh vệt dày hơn); `spawnPrismTrail` — `life` 0.32 →
  0.6, `speed` 0.3 → 0.16, `rise` 0.05 → 0.02, `gravity` −0.7 → −0.35, `spread` 0.4 → 0.28 (vệt dài, bám sát
  đường bay thay vì toả rộng thành đám mây); `SPARKLE_POOL_SIZE` 40 → 100 để pool đủ chỗ cho vệt dày + sống
  lâu hơn (dùng chung pool với hiệu ứng costume magic).

**Test:** `tsc --noEmit` sạch. Verify trên preview: bắn Radius Overcharge — đạn phồng đúng 3.5x, không còn ăn
theo bán kính level; bắn Prism Shot — vệt cầu vồng dài, liền mạch hơn hẳn bản cũ.

---

## 144. Radius bắn: cát trong tầm bắn trồi lên (lift) — làm lại 2 lần theo phản hồi (03/09)

Thêm hiệu ứng: trong lúc ngắm, những ô cát vừa nằm trong bán kính phát bắn hiện tại, vừa thực sự sẽ bị quét
(đúng màu đạn đang cầm — hoặc mọi màu nếu đang armed Prism Shot — và không bị khoá) được làm nổi bật, dùng
đúng công thức bán kính/màu/khoá mà `resolveShot` sẽ dùng khi bắn thật.

Bản đầu tiên mô phỏng thuần bằng thủ thuật 2D ngay trên texture cát: brighten màu về trắng + dịch pixel lên
theo trục Y (`LIFT_DRAW_OFFSET_PX`), y hệt cách `shake` vốn có. Bị phản hồi lại đúng 3 điểm, sửa toàn bộ:

1. **Không làm nhạt màu** — bỏ hẳn phần brighten (rồi phản hồi tiếp: phải **đậm hơn** màu gốc, không phải
   giữ nguyên).
2. **Trồi theo trục Z thật** (chiều sâu, hướng ra camera), không phải dịch trục Y trên một mặt phẳng phẳng.
3. **Có shadow mỏng ở rìa** phần cát được nhấc.

**`SandCannonEngine.ts`:**
- `PixelCell.lift: number` (0→1) — mục tiêu (`liftTarget`: tâm/bán kính/màu) tính lại mỗi lần
  `updateAimPreview` chạy; `step()` ease `lift` của từng cell tới mục tiêu đó (`LIFT_RISE_SECONDS` 0.12 lúc
  lên / `LIFT_FALL_SECONDS` 0.22 lúc xuống).
- Render: bỏ hẳn phần brighten+dịch-Y trong `redrawSand` (texture vẽ cát y hệt bình thường, không còn biết
  gì về `lift`). Thay bằng hai `THREE.InstancedMesh` mới (`liftFaceMesh`/`liftShadowMesh`, dựng 1 lần trong
  `buildLiftBlocks()`, cập nhật mỗi frame trong `updateLiftBlocks()`): mỗi ô đang lift vẽ bằng 1 quad nhỏ
  đúng màu gốc (`cell.rgb`, tối thêm `LIFT_FACE_DARKEN` 18% theo phản hồi "phải đậm hơn"), trồi ra phía
  trước theo local Z (`LIFT_Z_DEPTH` 0.16, cùng trục +Z đạn bay lùi về khi rời nòng) — cộng 1 quad shadow to
  hơn (`LIFT_SHADOW_SCALE` 1.4x, tối `LIFT_SHADOW_DARKEN` 55%) nằm sát mặt cát (`LIFT_SHADOW_Z_EPSILON`),
  rìa nhô ra ngoài quad chính tạo viền bóng mỏng.
- 2 bug phát sinh lúc build InstancedMesh, đã sửa: (a) bật nhầm `material.vertexColors: true` trong khi
  geometry dùng chung không có vertex-color attribute → WebGL đọc attribute rỗng về 0, toàn bộ ô lift ra
  màu ĐEN; bỏ cờ đó, per-instance color vẫn chạy đúng qua `setColorAt` (tự dùng path riêng
  `USE_INSTANCING_COLOR`, không cần `vertexColors`). (b) `THREE.Color.setRGB()` mặc định hiểu 3 số đầu vào
  là **linear color space**, trong khi `cell.rgb` là byte sRGB thô (giống hệt mọi giá trị ghi vào texture
  cát, vốn khai báo rõ `colorSpace = SRGBColorSpace`) → màu bị đẩy sáng lên, ra NHẠT thay vì đúng tông —
  đây chính là bug người dùng chỉ ra qua ảnh chụp màn hình; sửa bằng cách truyền rõ `THREE.SRGBColorSpace`
  làm tham số thứ 4 của `setRGB`.

**Test:** `tsc --noEmit` sạch mỗi lượt. Verify trên preview: giữ chuột ngắm — cát đúng màu đạn trong bán
kính trồi rõ theo chiều sâu, đậm hơn hẳn cát xung quanh (không nhạt), có viền bóng mỏng quanh rìa; cát khác
màu hoặc đang khoá không đổi gì.

---

## 145. Skin hub: đổi bảng màu + đổi hẳn pattern nền loop sang MocIcon (03/09)

**Bảng màu (`globals.css`), qua nhiều vòng chỉnh theo phản hồi — giá trị chốt cuối cùng in đậm:**
- `.skin-card` (nền thumbnail): `var(--locked)` → `#ffe7e3`.
- `.skin-card.is-previewing` (viền thumbnail đang xem): `var(--accent-line)` → `#ce4f3d` → **`#3e7871`**.
- `.skin-card-tick` (dấu tick): nền `var(--accent)`/chữ `var(--accent-ink)` → nền `#ffffff`/chữ `#ce4f3d` →
  chữ **`#3e7871`** (đồng bộ với viền thumbnail).
- `.skin-equip` (nút Select/Selected) — "Select" (chưa chọn): nền `var(--accent)`/chữ `var(--accent-ink)` →
  nền `#ce4f3d` → nền **`#bf7178`**, chữ trắng giữ nguyên xuyên suốt. "Selected" (đã chọn, đảo ngược): ban
  đầu nền `var(--panel)`/chữ `var(--muted)` → nền trắng/chữ+viền `#ce4f3d` → chữ **`#bf7178`**, **bỏ hẳn
  viền** (`border-color: transparent`).
- Thêm anim `.is-just-selected`: mảng trắng quét trái→phải phủ kín nút đúng lúc bấm Select chuyển thành
  Selected — chỉ chạy 1 chiều (không có chiều ngược, vì không có thao tác "bỏ chọn" tại chỗ — chọn skin
  khác chỉ chuyển ô nào đang disabled), tự gỡ class qua `onAnimationEnd` nên không tự chạy lại khi mở lại
  màn hình với skin đã sẵn có. Thời lượng 0.45s → **0.3s** theo yêu cầu.
- `.hub-nav` (nền wash skin `.is-skin-classic`/`.is-skin-magic`): áp `#f8c9c2` cho cả 2 skin (trước đó mỗi
  skin một tông riêng), sau đổi tiếp sang `#fff5fb` cùng lúc đổi hẳn pattern nền (mục dưới). `.skin-tray`
  (khay thumbnail) đổi theo 2 lần đó (`#f8c9c2` rồi `#fff5fb`) nhưng bị phản hồi lại: khay **không được** tự
  ý đổi theo nền — trả về cố định **`#f8c9c2`**, tách hẳn khỏi màu nền wash phía trên (2 màu khác nhau có
  chủ đích, không đồng bộ).

**`SandGame.tsx`:** bọc chữ nút trong `<span className="skin-equip-label">` (để pseudo-element sweep vẽ ở
dưới, chữ luôn nổi lên trên); state `justEquippedPulse` bật khi bấm `selectCostume`, tắt qua
`onAnimationEnd`.

**Pattern nền loop → MocIcon (thay hẳn sọc chéo cũ):**
- Nền `#fff5fb`; pattern lặp: icon móc áo `MocIcon.png` (`public/icons`) thay cho sọc chéo.
- `MocIcon.png` gần như không có viền trong suốt quanh hình nên lặp thẳng bằng `background-repeat` sẽ dính
  sát nhau; `background-repeat: space` (tự chia khoảng cách đều) lại bỏ qua `background-position` hoàn toàn
  theo spec nên không animate được nữa. Giải quyết bằng cách dựng riêng 1 tile SVG
  (`public/icons/MocIconTile.svg`) chứa icon + khoảng đệm trong suốt quanh nó, rồi lặp chính tile đó bằng
  `repeat` bình thường — vừa có khoảng cách, vừa animate `background-position` được như cũ.
- SVG dùng làm `background-image` của CSS bị trình duyệt chặn không cho tải thêm ảnh ngoài (một SVG ở
  "image context" không được phép tự fetch resource khác) — icon PNG bên trong không hiện ra ở lần dựng
  đầu; sửa bằng cách nhúng thẳng PNG dưới dạng base64 vào trong SVG, không còn phụ thuộc request mạng nào.
- Theo yêu cầu "xếp xéo nhau": dựng lại tile thành khối 2 hàng (170×358 thay vì 170×179) — icon hàng dưới
  lệch nửa chiều rộng tile so với hàng trên (tách đôi ở rìa trái/phải, ghép lại thành 1 icon liền khi tile
  lặp lại theo chiều ngang) → các hàng tự nhiên so le kiểu gạch/xéo thay vì thẳng lưới.
- `overflow: hidden` thêm vào `.skin-tray`: `.skin-grid` chỉ tự clip theo khung hình chữ nhật của chính nó,
  không theo góc bo tròn của tray bao ngoài — khi hover khiến thumbnail nhích lên (`.skin-card:hover`'s
  `translateY(-2px)`) một phần góc có thể lộ ra ngoài mép bo tròn của tray; thêm overflow ở tray đảm bảo mọi
  thứ (kể cả lúc hover) luôn bị cắt đúng theo hình dạng bo góc thật của tray.

**Test:** `tsc --noEmit` sạch mỗi lượt. Verify trên preview qua từng vòng chỉnh: cả 2 skin cùng bảng
màu/pattern; bấm Select → Selected chạy đúng sweep 0.3s rồi hết viền, chữ đổi màu đúng lúc; hover thumbnail
không còn lộ ra ngoài mép tray.

---

## 146. Home hub: đổi bảng màu theo ảnh mock người dùng gửi (03/09)

**`globals.css`:**
- `--hub-navy` (nền chung mọi màn hub, dùng cả ở Home lẫn Gallery): `#fff7e7` → `#e5ebd1`.
- `.hub-nav button[data-tab="home"].is-active .hub-nav-bubble`: tách khỏi `--accent` dùng chung (biến này
  còn dùng ở nhiều nút/toggle khác), đặt riêng `#8ac688`.
- `.hub-nav` (nền thanh tác vụ dưới cùng): `#fde59c` → `#fbf7de`.
- `.hub-play-btn` (nút "Level X"): nền `#ffcad3` → `#5c9f5c`, chữ `#725653` → `#fcf9e8`.
- `.hub-modes-btn` (nút "Modes"): nền `#e07988` → `#4d3c35`, chữ `#725653` → `#e6b638`.

**Test:** `tsc --noEmit` sạch. Verify trên preview: khớp đúng ảnh mock — nền xanh be, nút Home active xanh
lá, thanh tác vụ kem, nút Level xanh lá chữ kem, nút Modes nâu chữ vàng.

---

## 147. Gallery hub: đổi bảng màu theo ảnh mock người dùng gửi (03/09)

**`globals.css`:**
- `.hub-nav button[data-tab="gallery"].is-active .hub-nav-bubble`: tách khỏi `var(--sky)` dùng chung, đặt
  riêng `#8a9bf3`.
- `.gallery-screen` (nền màn Gallery): tách khỏi `var(--hub-navy)` dùng chung, đặt riêng `#c2cff2`.
- `.hub-gallery button` (thumbnail level chưa chọn): nền `var(--locked)`/chữ `var(--ink)` → nền
  `#d7ddf3`/chữ `#ffffff` (đồng bộ luôn state `:disabled:hover`, vốn cũng trỏ `var(--locked)`).
- `.hub-gallery button.is-active` (thumbnail đang chọn): nền `var(--accent)` → `#597cd4`; chữ (`b`)
  `var(--accent-ink)` → `#c2cff2`.
- `.gallery-heading h2` (chữ "Gallery"): `var(--ink)` → `#597cd4`.

**Test:** `tsc --noEmit` sạch. Verify trên preview: khớp đúng ảnh mock.

---

## 148. Shop buy-confirm dialog: phóng to + làm rõ chữ, dot nền nhạt hẳn (03/09)

**`globals.css`, `.confirm-card` (dialog "Buy ... ?"):**
- Kích thước: `max-width` (thừa hưởng từ `.result-card`) 304px → riêng 340px; `padding` 28px/24px →
  32px/26px.
- Chữ to hơn: tiêu đề 20px → 26px; 3 dòng info (Currently own/Buying/Total cost) 13px → 16px, giá trị
  (`strong`) 18px; icon coin 14px → 17px; số lượng stepper rộng hơn (22px→28px) ở 18px, mũi tên 10px→12px,
  nút mũi tên 28px→32px; nút Yes/No riêng cho card này 15px→17px (scope theo `.confirm-card button`, không
  ảnh hưởng các dialog result khác).
- Hoạ tiết dot nền: `#ffc933` đặc → cùng tông màu nhưng chỉ còn opacity 22% (`rgba(255, 201, 51, .22)`) —
  theo phản hồi "dot đang quá đậm".

**Test:** `tsc --noEmit` sạch. Verify trên preview: dialog to rõ hơn hẳn, chữ dễ đọc; hoạ tiết dot mờ hẳn,
không còn nổi bật như trước.

---

## 149. Tăng tốc nhịp chơi: đạn bay nhanh hơn, cát rơi/settle nhanh hơn hẳn (03/09)

Theo yêu cầu tăng tốc process in-game.

**`SandCannonEngine.ts`:**
- `FIXED_LAUNCH_SPEED` (tốc độ đạn rời nòng): 13.2 → **19** — hằng số này thuộc block "kế thừa từ cannon
  tiền-pivot, không được tự bịa số" (§20), nhưng đây là ngoại lệ chủ đích duy nhất theo yêu cầu người dùng;
  ghi chú lại trong comment. Bộ giải đường bay (`solveAimAtScreenPoint`) tính lại góc bắn cho từng phát dựa
  theo tốc độ hiện tại nên đổi tốc độ không làm lệch điểm rơi, chỉ rút ngắn thời gian bay.
- `SETTLE_TOTAL_MS` (tổng thời gian toàn bộ chuỗi cát rơi/sập được co giãn vừa khít vào, bất kể cascade lớn
  hay nhỏ): 800 → **350** — đây là nút chỉnh tốc độ rơi thực sự của hệ mô phỏng cát dạng lưới (grid-based),
  không phải physics gia tốc liên tục nên "tăng gravity" ở đây tương đương giảm cửa sổ thời gian này.
- `SAND_SPRAY_GRAVITY_SCALE` (lực kéo mảnh cát văng ra lúc trúng đạn, vốn đã mạnh hơn gravity đường đạn):
  3.2 → **5** — mảnh vỡ rơi xuống nhanh/mạnh hơn nữa, đúng nghĩa đen "tăng mạnh gravity" người dùng yêu cầu.

**Test:** `tsc --noEmit` sạch. Verify trên preview: bắn thử — đạn tới đích nhanh hơn hẳn, chuỗi cát
rơi/settle sau khi trúng đạn rút ngắn rõ rệt, không lỗi console phát sinh từ thay đổi.

---

## 150. Dời "3 chấm" báo cát đang settling lên cao hơn, ra ngoài khung tranh (03/09)

`.settle-badge` (3 thẻ `<i />` báo "đang khoá bắn" khi đạn bay/cát rơi) trước đó nằm ở `top: 118px` — sát mép
trên khung tranh, đọc như đang nằm *trên* bức tranh chứ không phải *phía trên* nó. Cần hỏi lại người dùng
một lượt để xác định đúng cụm "3 chấm" nào (repo có nhiều loại chấm khác nhau — `shots-upcoming-dot` của HUD
đạn, và đang có phiên làm việc khác chạy song song thêm hẳn UI rương/gem riêng) trước khi sửa.

**`globals.css`:** `.settle-badge`: `top` 118px → **70px** — kéo hẳn lên vùng trời trống phía trên khung,
gần hơn với `.sand-toast` (46px) nhưng vẫn chừa khoảng cách để hai badge không đụng nhau nếu cùng hiện một
lúc.

**Test:** `tsc --noEmit` sạch. Xác nhận qua computed stylesheet + `getBoundingClientRect()` lúc bắn thử: rule
`top: 70px` áp dụng đúng, badge hiện cao hơn hẳn vị trí cũ.

---

## 151. Blue Emerald: currency thứ ba, chỉ mua skin, chỉ đến từ Reward Track (04/09)

Ví trước đó có `gold` (kiếm bằng chơi level, tiêu ở Shop) và `gems` (hard currency của Shop, chưa nối
payment). Thêm **Blue Emerald** làm currency thứ ba, tách hẳn khỏi cả hai: nguồn duy nhất là rương thưởng ở
Home (§152), và thứ duy nhất nó mua được là skin bị khoá (§153). Không bán bằng tiền thật, không đổi qua
gold — nên món nó gate được đặt sau *việc chơi*, không sau ví.

**`economy.ts`:**
- `Wallet` thêm field `emeralds`; `STARTER_EMERALDS = 0` (khác `STARTER_GOLD`/`STARTER_GEMS` vốn > 0). Cố ý
  bằng 0: cả điểm của reward track là 500 đầu tiên phải đến như một phần thưởng người chơi tự thấy mình lấp
  đầy, nên máy mới cài không được sẵn có đủ để bỏ qua nó.
- `getEmeralds` / `addEmeralds` / `spendEmeralds` — `spendEmeralds` cùng hợp đồng với `spendGold`: atomic,
  ví thiếu thì trả `false` và không trừ gì.
- `readWallet` sanitise `emeralds` như mọi field khác nên ví đã lưu từ trước (chưa có field này) đọc lên
  thành 0 chứ không `NaN`.

**Test:** `sand-economy.test.ts` thêm case ví mới không có emerald + không mua nổi skin, và case spend
atomic. `tsc --noEmit` sạch, 131/131 test pass.

---

## 152. Reward Track: thay nút "Modes" chết bằng thanh tiến độ + rương thưởng (04/09)

Nút "Modes" cạnh nút Play là một `<div>` không làm gì từ đầu. Thay bằng reward track: mỗi level **thắng**
lấp 1 mốc, đủ 5 mốc (= 5 level) thì mở được rương lấy Blue Emerald.

Bản đầu làm theo chu kỳ 25 level (5 mốc × 5 level/mốc) rồi rút lại còn **chu kỳ 5** theo yêu cầu, nên
`LEVELS_PER_NODE = 1`, `NODES_PER_CHEST = 5`. Cũng vì thế thưởng thuộc về **chu kỳ**, không thuộc từng mốc:
mốc chỉ là một bước, rương mới là payout.

**`economy.ts`, block reward track:**
- Record lưu ở `sand-cannon:v1:reward-track` = `{ levelsPlayed, claimedCycles }`.
- `CYCLE_EMERALDS = [500, 600, 750, 900, 1250]` cho 5 chu kỳ đầu; từ chu kỳ 6 `cycleReward` tự nhân
  `CYCLE_GROWTH = 1.25` rồi làm tròn 50. **Không có vòng lặp về đầu** — chu kỳ 6 luôn hơn chu kỳ 5. Chu kỳ
  đầu = 500 đúng bằng giá Rune Cannon (§153), nên "5 level = 1 skin" đọc ra được mà không cần tính toán.
- `computeRewardTrackState` là hàm thuần (test drive được không cần `window`), kẹp `filled` ở
  `NODES_PER_CHEST`: rương đầy đứng chờ claim, level thắng trong lúc chờ **không mất** (vẫn nằm trong
  `levelsPlayed`) mà dồn sang chu kỳ sau khi mở rương.
- `recordLevelPlayed` gọi từ đúng transition WIN mà `markLevelCleared` đang dùng, nhưng **đếm cả replay** —
  khác gold (chỉ trả lần clear đầu). Lý do: yêu cầu là "cứ hoàn thành 1 level là 1 mốc", và một thanh dừng
  hẳn khi người chơi hết level mới thì không còn là thanh tiến độ. An toàn vì emerald chỉ mua skin, không
  vòng lại thành gold/booster hay bất cứ thứ ảnh hưởng gameplay.
- Track có store riêng (`subscribeRewardTrack` + version counter) chứ không ké `subscribeWallet`:
  `recordLevelPlayed` làm thanh chạy mà không chạm đồng nào. `getRewardTrackSnapshot` cache object để dùng
  làm snapshot của `useSyncExternalStore` — `getRewardTrackState()` tạo object mới mỗi lần gọi nên React đọc
  thành "đổi liên tục". Cặp với `SERVER_REWARD_TRACK` để render hydrate khớp server (đọc localStorage thẳng
  trong render là **hydration mismatch**, đã gặp thật khi làm).
- **Bug đã sửa:** `writeRewardTrack` ban đầu notify listener **trước** khi ghi localStorage. Snapshot dựng
  lại bằng cách đọc lại storage, nên listener bị gọi trước sẽ đọc record cũ và cache lại thanh cũ — claim
  rương xong các mốc vẫn sáng tới lần reload sau. Giờ ghi trước, invalidate + notify sau.

**`SandGame.tsx`:**
- `.hub-track-btn` thay chỗ `.hub-modes-btn`: icon `ChestIcon.png` + một **thanh dài liền** lấp 1/5 mỗi
  level. (Bản đầu là 5 chấm tròn, đổi theo yêu cầu — một chiều dài lấp đầy đọc được "tới đâu rồi" trong một
  cái nhìn, còn 5 chấm rời thì bắt đếm.) Chỉ là `<button>` thật khi thanh đầy; thanh chưa đầy là readout nên
  `disabled` — nói đúng điều đó với screen reader thay vì một cú tap im lặng không làm gì.
- `.hub-actions` quay lại hàng ngang, hai nút chia đều một hàng cao 72px (`flex: 1 1 0` + `height` chung) nên
  reward track bằng đúng size nút Play và nằm cạnh nó.
- HUD emerald: cùng silhouette với coin (viên đá tròn đè lên pill), nền `#cfe8ff`, **không có nút cộng** và
  không phải `<button>` — emerald chỉ có một nguồn và không mua được nên không có chỗ nào cho một cú tap.
  Gold + emerald nằm chung `.hub-currency-row` (flex row thật, không phải hai inset tuyệt đối): pill vàng nở
  theo số chữ số nên chỉ có row mới giữ hai chip sát nhau.
- GameDevOption thêm **Full reward track** (`fillRewardTrack`, làm tròn `levelsPlayed` *lên* hết chu kỳ hiện
  tại + `Math.max` nên không nuốt level đã bank cho chu kỳ sau), **Reset reward track**, **Relock skins**.

**`public/design/economy.csv`:** thêm `rewardTrackCycle1..5` và `costumePrice_rune-cannon` — tune được như
mọi số khác, không cần build lại.

**Test:** 8 case mới trong `sand-economy.test.ts` (thanh rỗng, 1 level = 1 mốc, rương chỉ mở ở level thứ 5,
level thắng lúc chờ không mất, chu kỳ sau luôn hơn chu kỳ trước qua 12 chu kỳ, sheet override). `tsc` sạch,
131/131 pass. Verify trên preview: chơi hết luồng 5 level → mở rương → 500 emerald, thanh reset về 0%.

---

## 153. Rune Cannon: khoá lại, thành mục mua 500 Blue Emerald (04/09)

**`costumes.ts`:**
- `CostumeDef` thêm `price`; Field Cannon 0, Rune Cannon 500. Giá đặt ở đây chứ không ở `economy.ts` vì nó
  thuộc về skin y như tên và tagline — và `economy.ts` import lại file này để lấy giá thì thành vòng.
  `costumePrice(id)` đọc override từ `economy.csv` trước (đúng shape `boosterPrice` của Shop đang dùng).
- Danh sách đã mua ở `cannon-sort:v1:owned-costumes`. `isCostumeOwned` trả `true` ngay cho skin giá 0, nên
  `OWNED_KEY` chỉ chứa các lần mua thật: skin nào sau này hạ giá về 0 thì free luôn cho người chơi cũ chứ
  không bị khoá sau một danh sách họ không có tên.
- `unlockCostume` **không** chạm ví: caller trừ emerald trước, chỉ unlock khi spend thật đi qua — nên file
  này không cần biết skin trả bằng gì.
- `getSelectedCostume` không bao giờ trả skin chưa mua (dev reset có thể xoá danh sách dưới chân một skin
  đang mặc).

**`SandGame.tsx`:** nút chính ở màn Skin có 3 việc theo đúng thứ tự người chơi gặp: **Buy** (khoá) → Select
(có nhưng chưa mặc) → Selected (đang mặc). Buy màu xanh emerald, khác nút Select hồng, và có confirm dialog
như Shop — tiêu currency không bao giờ là một cú tap không xác nhận, mà emerald khan hơn gold. Mua xong equip
luôn nên không phải tap tiếp một nút Select nữa. Card trong tray vẫn preview được (mờ + pill giá), chỉ nút
chính đổi. Ví thiếu vẫn được nút sống — "không đủ" nói trong dialog, không phải một control chết không giải
thích gì.

Bản đầu có thêm pill giá dưới dòng tagline, đã bỏ theo yêu cầu; giá giờ chỉ ở nút Buy và card trong tray.

**Test:** `tsc` sạch. Verify trên preview: 500 emerald → Buy → confirm → ví về 0, owned ghi đúng, skin tự
equip, nút thành Selected.

---

## 154. Màn mở rương: sân khấu 3D dựng theo blueprint (04/09)

Màn reward là DOM trong suốt, còn rương/ánh sáng/emerald là rig 3D do **engine sẵn có** vẽ
(`setChestShowcase` → `ChestStage`) — không mở WebGL context thứ hai, đúng lý do `getCostumeThumbnails` đã
ghi: page giữ đúng một context, cái thứ hai rồi sẽ lấy mất canvas của game. Nền tối đặt trên
`.game-frame.is-chest` *dưới* canvas, cùng thủ thuật `.game-frame.is-skin-*` của skin showroom.

Toàn bộ *hành vi* nằm trong `ChestStage` (file mới `app/game/chest-model.ts`); engine chỉ quyết định chỗ
đứng (`CHEST_POSITION`), khung hình (`CHEST_FOV = 43`) và cấp tick. `root` cắm **trên mặt sàn**: y=0 là mặt
đá rơi xuống, còn rương là con của nó — nên rương có nhún cũng không kéo sàn ra khỏi chân viên đá đang nằm.

**Rương** — dựng theo `ChestIcon.png` + bản blueprint 3 hình chiếu, số đo lấy từ pixel thật (front 587×495,
khe ở y=520/295..790; right view scale 0.6 → depth 410 front-px) → `2.10 × 1.47 × 0.97`, nắp cao `0.80`,
band vàng `0.16`.

Điểm quyết định: **Right view có vòm cung, không phải hình chữ nhật** — nên nắp không thể là nửa hình trụ
(nhìn ngang nửa trụ ra hình chữ nhật). Nó là rounded box: mặt cắt superellipse (`LID_SQUARE = 0.55` cho vai
bè + đỉnh phẳng như front view) trượt full-size qua giữa rồi **inset theo pháp tuyến** ở `LID_EDGE = 0.34`
cuối mỗi nửa độ sâu. `domeGeometry` tham số hoá theo "vị trí trên cung" nên đai vàng và đường ván cắt ra từ
chính mặt đó, ôm theo cong thay vì nổi lên trên.

3 lỗi hình học đã sửa trong lúc dựng:
1. Ban đầu **scale** mặt cắt về gốc thay vì inset → nắp thành hình lều, và mọi dải vẽ trên nó tụ thành ngôi
   sao ở giữa.
2. Mặt trượt là vỏ hở hai đầu → nhìn chính diện thấy xuyên qua vòm ra nền tối. Thêm `domeCapGeometry` bịt
   hai đầu, và `buildLidCapDetail` kẻ lại đai/đường ván trên mặt bịt đó (mặt bịt phẳng, `domeGeometry` không
   với tới).
3. Vị trí 2 đai trong: `u` **không** linear theo x (superellipse dồn range vào vai), nên phải giải ngược từ
   vị trí blueprint (±0.41 nửa chiều rộng = spacing 30%/70% mà cả front và top view đều cho thấy) chứ không
   đoán trên tham số.

Vàng đặt đúng nơi 3 view đồng thuận: 2 đai biên + 2 đai trong trên nắp, band dày ở khe nắp/thân, band đáy,
cột 4 góc dọc kèm đinh cầu, khiên khoá xanh (`ExtrudeGeometry` từ outline hình khiên — không tổ hợp box nào
ra đúng) + lỗ khoá, chỉ ở mặt trước. Thêm mặt dưới nắp: vừa là thứ camera nhìn vào khi nắp mở, vừa che
không cho hiệu ứng sáng lọt qua kẽ giữa vành và nắp.

**Emerald** — dựng theo blueprint riêng của viên đá. 3 view của nó mô tả khối **không phải** gem-cut hình
nón: front là bát giác có bát giác table bên trong, side và top đều là phiến dẹt hai đầu vát. Khối duy nhất
thoả cả ba: girdle bát giác ở chỗ rộng nhất + hai mặt bát giác nhỏ hơn lùi vào + vành facet vát nối chúng
→ `0.30 × 0.36 × 0.15`, cắt góc `0.063`, lùi mặt `0.046`.

Dựng bằng một BufferGeometry non-indexed với **vertex colors**, không dùng `ExtrudeGeometry`: extrude+bevel
chỉ cho 2 material group nên mọi facet vát cùng một màu, mất hẳn cái faceted. Thay vào đó mỗi tam giác shade
bằng pháp tuyến của chính nó dot với một hướng sáng bake sẵn (trên–trái–trước, đúng chỗ icon đặt highlight),
ramp **hai chặng** qua màu mid — ramp một chặng làm facet sáng bạc ra trắng và dìm hết phần còn lại thành một
khối navy phẳng. Thêm viền `Line` xanh đậm quanh girdle: cho cạnh gọn như icon, và ở kích thước này nó giữ
hai viên nằm chồng nhau không dính thành một khối xanh.

**Vật lý & pose** — `GEM_COUNT = 8`, bắn ra từ miệng rương theo quạt **chỉ nửa trước** (heading `sin > 0`,
viên nào bắn ra sau thì thân rương che mất), `GRAVITY = -9.4`, nảy `GEM_BOUNCE = 0.36`, settle khi tốc độ
tụt dưới ngưỡng. Lộn nhào bằng quaternion (`premultiply` delta quanh trục vận tốc góc) chứ không cộng dồn 3
góc Euler riêng lẻ — cách cũ gimbal-lock thành lắc lư thay vì lộn.

Đá **nằm lênh láng** khi đáp: pose lúc nghỉ (`restPose`, quaternion) bốc sẵn lúc phóng — úp một trong hai
mặt xuống sàn (random), yaw tự do cả `2π`, nghiêng thêm 1–2° quanh một trục ngang bất kỳ (cái nghiêng đó là
thứ giữ 8 viên không trông như decal dán đều xuống đất). Phải là quaternion vì "úp mặt xuống **và** quay
trong mặt phẳng sàn" là hai phép quay quanh hai trục khác nhau, Euler chỉ ghép đúng theo một thứ tự cụ thể
mà vòng lộn nhào chạy trước cũng phải đồng thuận thứ tự ấy. Hai độ cao khác nhau: `GEM_LAND_Y = 0.38·W` để
nảy (giữa lúc lộn nhào viên đá chống trên một góc), `GEM_REST_Y = D/2 + 0.012` để nằm (nửa **độ dày**, phần
lẻ hấp thụ độ nghiêng cho góc đá không lún dưới sàn). Lúc settle thì slerp về `restPose` + ease `y` xuống →
đọc ra "đáp xuống rồi đổ phẳng ra".

**Test:** `tsc` sạch, lint 0 trên cả 2 file 3D. Verify trên preview qua nhiều vòng chỉnh khung hình/màu: đá
nằm rải phẳng quanh rương, đủ 8 viên, không viên nào nằm sau thân rương.

---

## 155. Hiệu ứng sáng của rương: chốt thành hình nón tĩnh, trước nắp nhưng sau vách trước (04/09)

Hiệu ứng đi qua 3 vòng theo phản hồi, và mỗi vòng vướng đúng một chuyện đáng ghi lại.

**Vòng 1 — sunburst.** Fan 22 tia xen kẽ sáng/mờ, gradient kem → hổ phách → tắt, blend additive (đen =
trong suốt nên vành ngoài chính là fade-out). Vấn đề: đặt fan **trước** nắp thì mặt phẳng additive cộng
thẳng lên gỗ và biến nắp thành kính mờ — depth test không cứu được, mặt phẳng thật sự gần camera hơn. Nên
lúc đó phải tách: tia ra **sau** rương, quầng core nhỏ ra **trước** miệng.

**Vòng 2 — kéo ra trước.** Yêu cầu là ánh sáng phải ở trước nắp (đặt sau thì nắp cắt mất nửa trên của fan).
Kéo ra trước được, nhưng phải tune 3 thứ cùng lúc thay vì chỉ đổi vị trí: opacity `0.55 → 0.25`, stop hổ
phách tối hẳn, vành trong siết `0.2 → 0.13` — một điểm nóng nhỏ ở miệng rồi tắt nhanh mới đọc ra "ánh sáng
đi ngang trước một vật thể đặc", còn vành sáng rộng thì thành filter kẻ sọc phủ lên rương.

**Vòng 3 — chốt: hình nón tĩnh.** Bỏ hẳn fan, thay bằng `buildLightCone`.
- **Phẳng, không phải khối nón 3D.** Khối nón rộng cỡ này trải hơn 1 đơn vị theo Z nên nửa gần của nó chọc
  ra trước vách trước của rương — mà chính cái vách đó là thứ phải cắt đáy nón. Billboard phẳng ở một Z cố
  định đặt được chính xác giữa nắp và vách; một khối thì không.
- `CONE_Z = 0.42`: trước nắp (nắp ngả về Z âm) nên nón vắt qua nắp; sau vách trước ở `BODY_D/2 = 0.735` nên
  vách cắt đáy nón. Đỉnh nón đặt **dưới** đường miệng để chính cái đỉnh cũng bị vách che — ánh sáng có điểm
  khởi đầu nhìn thấy thì đọc ra thành decal.
- Gradient dồn về đầu (`0 / 0.22 / 0.55 / 1`, kem → hổ phách → tắt): ramp chia đều để lại một nêm nâu rộng
  treo trên đầu khung, đọc ra thành hình vẽ chứ không phải ánh sáng tắt dần. Ngang thân nón chỉ giảm xuống
  `CONE_EDGE = 0.5`, **không về 0** — nón mà mờ hết hai bên thì mất silhouette, mà silhouette chính là cái
  shape được yêu cầu.
- **Tĩnh:** bỏ `rotation.z +=` và cả hai hàm `Math.sin` breathing. Anim duy nhất còn lại là fade + scale lên
  theo nắp rồi clamp ở 1; sau đó không gì di chuyển. Cũng bỏ nhịp nhún của rương sau khi mở (`chest.position.y`
  giờ chỉ được set 0 trong `setPhase`) và cái oval nền — oval đọc ra thành bệ kê chứ không phải mặt đất, sàn
  giờ chỉ hàm ý qua bóng đổ và qua chỗ mọi thứ nằm xuống.

**Bug đã sửa (1) — nêm đen phủ nền.** `THREE.AdditiveBlending` cộng cả **alpha**, mà canvas trong suốt ở chỗ
không vẽ gì: đầu nón đã fade về đen nên không góp màu nào nhưng vẫn góp trọn `opacity` vào alpha, biến canvas
thành **đen đặc** ở đó — đúng cái việc additive lẽ ra không thể làm được. Sửa bằng `CustomBlending`:
`blendSrc: SrcAlpha / blendDst: One` cho màu, `blendSrcAlpha: Zero / blendDstAlpha: One` để giữ nguyên
`dstAlpha`. Canvas premultiplied khi đó composite thành `màu cộng thêm + nền`, tức additive như ý định.

**Bug đã sửa (2) — anim lặp.** `setPhase` reset `this.time = 0` ở **mọi** lần đổi phase, còn
`updateLid`/`updateBurst` lấy góc nắp và ramp sáng từ `time`. `opening` và `revealed` là hai nhãn của **cùng
một beat**, nên khi React chuyển sang `revealed` (620ms sau) đồng hồ về 0 → nắp sập lại rồi mở lần hai, ánh
sáng tối đi rồi sáng lại. Giờ chỉ reset khi vào một beat *thực sự mới* (từ off-screen hoặc từ pha xoay);
`opening → revealed` return sớm, giữ nguyên đồng hồ. Trường hợp vào thẳng `revealed` (re-render sau khi anim
đã chạy xong) thì set đồng hồ **vượt** `LID_SECONDS` để rương chỉ đơn giản là đang mở, không mở lại cho
không ai xem.

**Anim rương chốt lại:** xoay `SPIN_TURNS = 3` vòng ease-out `1.5s` (dừng đúng số vòng nguyên nên chính diện
camera, không cần snap) → nắp bật quanh bản lề `LID_OPEN = -1.02` rad trong `0.55s`. Góc mở dừng ở khoảng
2/3 vuông góc: quá vuông góc thì cả mặt `2.1 × 1.47` của nắp quay về camera và đọc ra thành một tấm panel
sau rương thay vì một cái nắp mở.

**Test:** `tsc --noEmit` sạch, 131/131 test pass, lint 0 trên `chest-model.ts`. Verify trên tab sạch: console
không lỗi trước **và** sau cả luồng (xoay → mở → nhận 500 → Collect → về hub), nón đứng yên, đáy nón bị vách
rương cắt, không còn nêm đen trên nền.

## 156. Nút Play: nền chấm bi loop; Daily Login: bỏ 2 chốt đen, HUD lắc khi claim; Skin tray: dải giá emerald che hết đáy thumbnail (05/09)

**Nút Play (Home hub).** Nền `.hub-play-btn` giờ có pattern chấm bi lặp (`radial-gradient` + `background-size`
+ `animation` dịch chuyển chéo liên tục), không phải màu phẳng nữa. Bi dùng xanh lá nhạt hơn nền nút để nổi
lên nhưng không chói mắt. Vòng đầu chọn màu quá nhạt (`#a7e0a4`) theo phản hồi ban đầu; chỉnh lại còn `#6eb16e`
— chỉ khác nền gốc `#5c9f5c` một chút, đủ đọc ra pattern mà không phân tán khỏi chữ "Level N". Pattern vẽ bằng
pseudo-element `::before` đặt `z-index: -1` cộng `isolation: isolate` trên nút — thiếu `isolation` thì pattern
bị vẽ lấn lên trên chữ (âm z-index không neo vào đúng stacking context của nút mà trôi lên context cha), nên
`isolation: isolate` bắt buộc phải có để chữ luôn nổi trên pattern.

**Daily Login card.** Bỏ hẳn 2 "chốt đen" hình oval (`.daily-login-tab`, decor thuần tuý) từng ghim ở đầu card
— đọc ra thành 2 thanh đen chắn ngang chữ hơn là chốt trang trí, nên xoá cả JSX (2 `<span>` trong
`SandGame.tsx`) lẫn CSS liên quan. Khi bấm Claim: HUD tiền (`.hub-gold-wrap`) giờ lắc nhẹ (`hub-gold-wrap-shake`
— translateX + rotate xen kẽ 5 bước) đúng lúc dòng coin bay tới, thay vì chỉ số nhảy lặng lẽ. Cách trigger:
gắn `key={goldBump}` lên chính `<button className="hub-gold-wrap">` (goldBump vốn chỉ remount `<strong>` con để
bump số) để cả nút remount và animation replay từ đầu mỗi lần có tiền bay vào — không riêng daily-login, bất
kỳ lần `tweenGoldTo` nào (kể cả thưởng thắng màn) cũng lắc theo, nhất quán hơn là chỉ xử lý một nguồn. Đồng
thời phóng to đồng xu bay (`.coin-fly` 18px → 24px) và thêm `drop-shadow` vàng ấm cho rõ đường bay hơn.

**Skin tray — dải giá Blue Emerald.** `.skin-card-price` (dải hiện giá + icon emerald trên thumbnail khoá)
từng là pill nổi có margin quanh, giờ kéo full-width/full-bottom (`left/right/bottom: 0`, bỏ `border-radius`,
để `.skin-card` tự cắt theo góc bo của nó qua `overflow: hidden`) — che nguyên phần đáy thumbnail như yêu cầu,
icon + số giá vẫn giữ nguyên vị trí giữa dải. Qua 2 vòng chỉnh theo phản hồi tiếp theo:
- Nền dải đổi từ `#cfe8ff` đặc sang `rgba(207, 232, 255, .6)` — để hình nền (đống cát) mờ xuyên qua được,
  trong khi icon/số giá không đụng tới opacity nên vẫn 100% rõ.
- Thêm `border-top: 1.5px solid #8fb8e6` — border luôn vẽ đè lên trên nền của chính box nó thuộc về, nên
  đường viền này đọc rõ ngay cả khi nền dưới là màu trong suốt.
- Dải trở lại nền đặc 100% (`background-color: #cfe8ff`) khi thumbnail đó **đang được chọn** (`.is-previewing`)
  — thử `:active` (nhấn giữ) trước nhưng phản hồi chỉnh lại: phải là trạng thái chọn/preview, không phải chỉ
  lúc ngón tay còn đè xuống, nên đổi selector từ `.skin-card:active` sang `.skin-card.is-previewing`.

**Gallery hub — số thứ tự màn khoá.** `.hub-gallery-lock` (số lớn phủ lên thumbnail màn chưa mở khoá) từng
màu kem (`var(--panel)`) kèm `text-shadow` để đọc được trên ảnh nền bất kỳ; đổi sang `color: var(--muted)` —
đúng màu nâu `.hub-gallery button.is-locked b` (chữ "Locked") đang dùng — và bỏ hẳn `text-shadow`, theo đúng
yêu cầu "không shadow hay stroke".

**Test:** `tsc --noEmit` sạch (2 lỗi còn lại trong `db/index.ts`/`worker/index.ts` là thiếu type Cloudflare
Workers, có từ trước, không liên quan tới đợt sửa này), 131/131 test pass. Verify trực tiếp trên browser
preview: chấm bi Play hiện đúng màu, 2 chốt đen daily-login đã biến mất, claim daily-login lên tiền + HUD lắc
đúng lúc, dải giá emerald full-width/translucent/border/opaque-khi-chọn đều đúng thứ tự các vòng chỉnh, số
khoá Gallery đổi màu nâu không còn shadow.

---

## 157. Ammo wheel: màu hiếm trên tranh không còn ra liên tiếp — giãn cách tối thiểu 3 viên (09/09)

**Vấn đề.** `drawAmmo` (sand-rules.ts) rút ngẫu nhiên đều 100% trong số màu còn bắn được, không quan tâm màu
đó còn bao nhiêu ô cát trên bàn. Một màu chỉ còn một mảng nhỏ (ví dụ mảng trắng bé xíu trên tranh) vẫn có
cùng xác suất ra liên tiếp 2 viên như một màu chiếm nửa bức tranh — theo phản hồi, việc này đọc ra thành lãng
phí/khó chịu: 2 viên liền của một màu gần như không còn gì để bắn.

**Sửa.** Thêm khái niệm "màu hiếm" (`scarce`): một màu được coi là hiếm khi tổng số ô của nó hiện có trên bàn
(gồm cả ô đang khoá/đóng băng — vẫn là một phần "lượng màu đó trên tranh" dù chưa bắn được) thấp hơn
`SCARCE_COLOR_SHARE = 0.5` lần trung bình cộng của mọi màu còn bắn được. Ngưỡng tính theo *tỉ lệ*, không phải
số ô tuyệt đối, nên tự thích ứng theo từng bàn cờ — và tính lại mỗi lần `fillQueue` chạy, nên một màu ban đầu
nhiều nhưng bị bắn gần cạn giữa ván sẽ dần được xếp vào diện hiếm, đúng lúc nó thực sự ít.

`drawAmmo` giờ lọc bỏ màu hiếm khỏi lượt rút cho tới khi nó đã "ngồi ngoài" đủ `SCARCE_COLOR_MIN_GAP = 2` lượt
— tái dùng thẳng `pity` sẵn có (vốn đã đếm chính xác "đã bao nhiêu lượt rút liên tiếp không rơi vào màu này"),
không cần thêm state mới. 2 lượt chờ nghĩa là 2 viên khác chen giữa, tức khoảng cách tối thiểu 3 vị trí (ra —
bỏ qua — bỏ qua — được ra lại) thay vì liền kề. Nếu lọc xong không còn màu nào để chọn (mọi màu còn lại đều
đang hiếm và chưa đủ giờ chờ — ví dụ bàn chỉ còn đúng 1 màu), rơi về lại toàn bộ danh sách `shootable` để không
bao giờ rút vào chỗ trống. Cơ chế insurance/pity cũ (`drainOverdue`, ép một màu ra sau khi bị bỏ qua 3 lượt)
giữ nguyên và chạy song song không xung đột — ngưỡng ép ra (pity ≥ 3) luôn muộn hơn ngưỡng "được phép rút lại"
của màu hiếm (pity ≥ 2).

**Test:** `tsc --noEmit` sạch, 150/150 test pass (bao gồm test cũ "a colour can repeat back-to-back" — bàn Sand
Bloom có 4 màu lệch nhau nhưng không màu nào lọt ngưỡng hiếm, nên hành vi lặp liên tiếp của màu thường vẫn y
nguyên như trước, đúng ý test đó). Verify thêm bằng 2 script tạm (không commit): (1) mô phỏng thuần logic
`drawAmmo` qua 200 lượt rút với 1 màu hiếm trong 4 màu — khoảng cách nhỏ nhất giữa 2 lần ra màu hiếm luôn đúng
3, còn các màu thường vẫn ra liên tiếp bình thường (39/200 lượt liền kề); (2) chạy thật qua
`createSandGameState`/`resolveShot` của chính game (không phải bản mô phỏng lại) trên một level tự tạo — nền đỏ
lớn, mảng vàng chỉ 5 ô — bắn 64 phát chỉ nhắm vào đỏ: vàng ra đúng 5 lần, khoảng cách nhỏ nhất giữa các lần đó
là 3, khớp chính xác yêu cầu.

---

## 158. Thêm Freeze Map: cơ chế đóng băng cát, level 31-40, HUD cooldown, tuyết nền, khung tranh đổi màu (10/09)

Cơ chế mới cho phép một level khoá đứng một phần bàn cát ("đóng băng") cho tới khi người chơi bắn trúng
ô kích hoạt, theo đúng bản đặc tả `freeze-map-mechanic.md`. Đây là tính năng gameplay mới, không phải sửa lỗi
— triển khai xuyên suốt engine, level data, và toàn bộ phần hiển thị (HUD + hiệu ứng nền + khung tranh 3D),
qua nhiều vòng chỉnh theo phản hồi trực tiếp trên bản build.

**Lõi cơ chế (`sand-rules.ts`, `sand-types.ts`, `SandCannonEngine.ts`):**
- Ký tự `@` (`FREEZE_LETTER`) trong bảng level đánh dấu ô là **trigger đóng băng**; nhiều ô liền kề gộp thành
  một `SandFreezeTrigger { id, cells }`, dò bằng `triggerInRadius` — cùng phép dò "không phân biệt màu" súng
  vẫn dùng để tính khối trong tầm bắn.
- Đếm theo **lượt bắn**, không theo thời gian thực: bắn trúng trigger → bàn đóng băng đúng
  `level.freezeDuration ?? DEFAULT_FREEZE_DURATION` (mặc định 5) lượt kế tiếp, giảm dần 1 mỗi lượt bắn bất kể
  bắn trúng gì, cát chỉ rơi lại (settle) khi đếm về 0. State thêm `freezeShotsRemaining` (đếm còn lại) và
  `freezeTriggers` (trigger nào đã bị phá thì biến mất khỏi board, không kích hoạt lại được).
  Bản đầu từng làm theo thời gian thực (`performance.now()`, đóng băng bao nhiêu lượt bắn cũng được trong một
  khung giờ) theo yêu cầu ban đầu, sau đó **quay lại hẳn kiểu đếm lượt** theo phản hồi tiếp theo — bỏ toàn bộ
  đồng hồ riêng khỏi engine, đúng nguyên tắc `sand-rules.ts` không giữ clock của chính nó.
  Đã gỡ luôn override `freezeDuration` (4/5/6) ở từng level 31-39 (`design/levels/sand-levels.ts`) vì gây hiện
  tượng HUD lúc hiện 4 phần lúc 5 phần — mọi level giờ dùng thẳng mặc định 5.
- Level editor (`LevelEditor.tsx`, `level-drafts.ts`, `scripts/level-writer.mjs`) nhận diện và ghi được ký tự
  `@`/field `freezeDuration` giống mọi ký tự bảng khác.

**Level 31-40:** tác giả 10 level mới bám theo beat chart của bản đặc tả (level thường xen level có freeze
trigger, độ khó tăng dần); level 40 thuần trang trí không tính là level chơi được.
`tests/level-editor.test.ts` cập nhật kỳ vọng `BUILT_IN_LEVELS.length === 40`, id 1-40.

**HUD cooldown (`SandGame.tsx`, `globals.css`, `i18n.ts`):** qua nhiều vòng chỉnh theo yêu cầu, chốt lại ở:
- Một pill duy nhất `.freeze-cooldown-bar`, cùng hàng với HUD số đạn, **cùng shape và cùng chiều cao 44px**
  với cả HUD đạn (`.shots-badge`) lẫn nút Settings (`.icon-button`) — bỏ hẳn phương án khung ảnh
  `FreezeBar.png` lồng 2 lớp từng làm trước đó (đã xoá file, không còn dùng ở đâu).
- 5 ô `.freeze-cooldown-segment` — ô còn "sống" (`freezeShotsRemaining` chưa dùng tới) sáng sọc chéo
  trắng/xanh trời loop liên tục (kỹ thuật tile vuông của Bootstrap `.progress-bar-striped`: gập một đường
  chéo 45° vào đúng 1 ô vuông `background-size`, dịch `background-position` đúng 1 ô mỗi vòng lặp — cách duy
  nhất loop liền mạch mà không phải tính lượng giác).
- Nền tray đổi từ trắng sang xanh nhạt (`#cdeefb`); chữ "FREEZE" (`s.freezeLabel`, string mới trong `i18n.ts`)
  phủ giữa lên trên các ô bằng `.freeze-cooldown-label` (position absolute, pointer-events none, text-shadow
  để đọc được trên cả nền sáng lẫn ô đang sọc).

**Tuyết rơi nền (`.freeze-snowfall`):** khi `freezeShotsRemaining > 0`, phủ một lớp tuyết rơi lên toàn bộ
`.scene-wrap` (không chỉ HUD một góc) — mỗi bông là một `<span>` với vị trí/kích thước/thời gian tính sẵn
bằng công thức tại module scope (`FREEZE_SNOWFLAKES`, dùng góc vàng 137.5° để rải đều, không dùng
`Math.random()` lúc render để tránh lệch hydration), 2 animation độc lập: `top` (0 → 100%, theo đúng chiều
cao khung hiện tại) lo phần rơi, `transform: translateX` lo phần đung đưa qua lại. `pointer-events: none`
xuyên suốt nên không chặn thao tác kéo ngắm bắn bên dưới.

**Khung tranh 3D đổi màu khi đóng băng (`SandCannonEngine.ts`):** rail/cột khung và lớp lót/gờ trong đổi từ
nâu gỗ + kem sang xanh đậm + xanh dương pha nhiều trắng — **chỉ trong lúc đóng băng**, không phải vĩnh viễn.
Vòng đầu đổi màu cố định ngay lúc dựng khung (`buildFrame`) theo đúng nghĩa đen yêu cầu ban đầu; sau phản hồi
"chỉ khi đang freeze", chuyển 3 vật liệu (`frameRailMaterial`, `frameBackingMaterial`, `frameInnerMaterial`)
thành field của engine và thêm `syncFrameFreezeColor()` — đọc thẳng `this.state.freezeShotsRemaining`, gọi
lại mỗi khi state đổi sau một lượt bắn (cùng chỗ gọi `syncFreezeTriggers()`) để tô lại đúng màu theo trạng
thái hiện tại thay vì chỉ tô một lần lúc khởi tạo.

**Test:** `tsc --noEmit` sạch (2 lỗi còn lại ở `db/index.ts`/`worker/index.ts` có từ trước, không liên quan),
150/150 test pass. Verify hành vi lõi bằng script `.mjs` tạm import thẳng `sand-rules.ts` (đếm ngược
5→4→3→2→1→0 đúng số ô sáng mỗi bước), xoá sau khi xác nhận. Verify hiển thị bằng screenshot trực tiếp trên
browser preview: khung hub (không đóng băng) giữ đúng màu nâu/kem gốc; tiêm DOM tạm để dựng lại đúng cấu trúc
HUD/tuyết ngoài luồng chơi thật (do thao tác kéo-bắn qua automation không ổn định) xác nhận tray xanh nhạt +
chữ FREEZE + sọc loop + tuyết rơi có di chuyển qua nhiều khung hình.

---

## 159. FTUE dạy Freeze Orb (level 31): tutorial từng bước, ép thứ tự đạn mở màn, khay booster + súng bố trí lại (10/09)

Yêu cầu ban đầu: riêng level 31 (giữ nguyên bức tranh) cần một FTUE "chơi thử" cho người chơi thấy công năng
Freeze Orb — kéo ngắm tự động vào orb, bắn, đóng băng, rồi tự bắn dọn sạch màu đóng băng để hết hiệu ứng, sau
đó trả quyền điều khiển. Qua nhiều vòng phản hồi, bản FTUE đổi từ auto-play liên tục sang **từng bước có
callout + chờ tap** ("giống tutorial của game khác"), và bước cuối đổi từ "tiếp tục board đang bắn dở" sang
"reset lại màn từ đầu" (đúng nghĩa đen "chơi lại màn" trong yêu cầu gốc). Tính năng mới, xuyên suốt engine,
level data, level-writer, và UI — không phải sửa lỗi.

**`forcedOpeningQueue` — ép màu đạn N phát mở màn (`sand-types.ts`, `sand-rules.ts`):** field mới trên
`SandLevelConfig`, độc lập với FTUE (dùng được cho bất kỳ level nào cần ép thứ tự đạn mở màn). `fillQueue` nhận
thêm tham số `shotsUsedAfter` (absolute shot index, không phải index trong queue) để `applyForcedOpeningQueue`
override đúng màu bất kể mảng ép dài hơn độ sâu lookahead mặc định hay forced range đã hết hạn. Level 31 dùng
field này để ghim chính xác `["mint", "mint", "mint", "grass"]` — 3 viên mint đầu cho FTUE, và **luôn áp dụng
lại trên mọi lượt chơi/chơi lại**, không chỉ lần đầu.

**Bắn demo thật, không phải hiệu ứng giả (`SandCannonEngine.ts`):** `runScriptedShot`/`runScriptedShotSequence`
— tự tính điểm ngắm từ toạ độ lưới (`worldPointForGrid` + `solveAimAtWorldTarget`, tách ra từ
`solveAimAtScreenPoint` để dùng chung), animate góc xoay súng + vị trí crosshair/joystick mượt trong ~650ms rồi
gọi thẳng `fire()` — đi qua đúng pipeline `resolveShot` như một phát bắn tay thật, không phải
`launchShowcaseShot` (vốn chỉ trang trí, không đổi state). `scriptedShotActive` chặn `onAimPointerDown` trong
suốt lúc demo chạy để một chạm thật ngoài ý muốn không cướp mất gesture đang mô phỏng.

**Tutorial từng bước (`SandGame.tsx`, `globals.css`, `i18n.ts`):** state machine
`intro → demo-freeze → explain-thaw → demo-clear → outro`. Hai bước `intro`/`explain-thaw` là spotlight
(`.ftue-freeze-spotlight` — vòng tròn sáng giữa nền tối, kỹ thuật "oversized box-shadow" một element duy nhất,
không cần mask/SVG) + caption card (`.ftue-freeze-caption`) chờ tap; hai bước `demo-*` không hiện gì, chạy
`runScriptedShotSequence` rồi tự chuyển bước khi bắn xong. Bước `outro`, theo phản hồi, gọi thẳng `restart()`
thay vì chỉ đóng overlay — màn 31 reset lại board gốc (30 viên đạn, orb + mint nguyên vẹn), 3 phát demo không
tính vào lượt chơi thật. Đánh dấu "đã xem" qua `localStorage` (`sand-cannon:v1:freeze-ftue-seen`) ngay lúc bắt
đầu, giống `tutorial` — không phát lại trên cùng trình duyệt dù demo có bị bỏ dở.

**Lỗi phát sinh trong quá trình làm, đã sửa:**
- **Lật trục Y giữa toạ độ tác giả và toạ độ engine.** `parseSandLevel` đổi `row index` (thứ tự dòng viết trong
  `rows`, trên cùng = 0) thành `y` nội bộ qua công thức `y = height - 1 - index` — toạ độ bắn ép trong
  `ftueFreezeTargets` ban đầu tính nhầm bằng row index thẳng, khiến demo bắn trúng chỗ không phải orb. Phải
  tính lại đúng theo công thức lật trục, verify trực tiếp bằng cách đọc `state.freezeTriggers` sau khi bắn.
- **Spotlight lệch vị trí.** `.ftue-freeze-overlay` (chứa spotlight + caption) ban đầu render làm sibling của
  `.result-screen`, ngoài `.scene-wrap` — trong khi `engine.screenPointForGrid` trả toạ độ trong không gian của
  `.scene-host`/`.aim-crosshair` (nằm trong `.scene-wrap`, vốn inset thấp hơn `.game-frame` đúng bằng chiều cao
  thanh HUD). Cùng một cặp `left`/`top` px nên rơi sai vị trí (cao hơn thực tế đúng bằng khoảng inset đó). Sửa
  bằng cách chuyển hẳn overlay vào bên trong `.scene-wrap`.
- **Animation keyframe ghi đè transform canh giữa.** `.ftue-freeze-caption` dùng chung `@keyframes
  cannon-unlock-in` (vốn cho `.cannon-unlock-banner`) — keyframe này có `transform: scale(...)`, với
  `animation-fill-mode: both` nên giữ nguyên vĩnh viễn sau khi chạy xong, đè mất `transform: translateX(-50%)`
  đang dùng để canh giữa ngang, khiến caption card tràn hẳn ra ngoài màn hình. Tách riêng keyframe
  `ftue-freeze-caption-in`, giữ `translateX(-50%)` xuyên suốt mọi state của animation.
- **`readBoot()` cache theo query param chỉ tính một lần cho cả tab session.** Nút "Test in game" của Level
  Editor điều hướng bằng client-side `<Link href="/?level=...">`, không reload trang — `cachedBoot` (module
  singleton) vẫn giữ `initialIndex` tính từ lần load đầu tiên của tab, nên "Test in game" cho level 31 vẫn cứ
  mở lại level đang xem trước đó. Sửa: thêm `cachedBootSearch`, so sánh `window.location.search` mỗi lần đọc,
  chỉ tính lại `initialIndex` khi query đổi thật (giữ `playables` — phần tốn công đọc `localStorage` — không
  tính lại).
- **Level Editor ghi đè mất field FTUE nhiều lần.** `forcedOpeningQueue`/`ftueFreezeDemo`/`ftueFreezeTargets`
  không có control riêng trên UI editor — draft nào import trước khi 3 field này tồn tại (hoặc chỉnh tay từ
  trước) thì không mang theo, và "Update built-in level"/"Ship" ghi cả field đó thành rỗng, xảy ra thật ít nhất
  2 lần trong lúc làm (người dùng vẫn đang song song chỉnh level 31 qua editor). Sửa tận gốc trong
  `scripts/level-writer.mjs`: `preserveUneditableFtueFields` đọc 3 field này từ đúng block đang tồn tại trên đĩa
  trước khi ghi đè, chỉ điền vào chỗ draft không mang theo — draft vẫn thắng nếu nó có ý kiến riêng, chỉ không
  còn bị "im lặng" xoá mất field "im lặng" (không ai chỉnh) nữa. Áp dụng ở cả hai chỗ ghi (`updateLevel` và
  `shipLevels`'s upsert), phải restart lại tiến trình `npm run level-writer` (không tự nhận code mới) để có
  hiệu lực.

**Khay booster dời xuống đáy, súng nâng lên + thu nhỏ (`globals.css`, `SandCannonEngine.ts`):** theo yêu cầu bố
cục lại — từ dưới lên: khay booster, súng, tranh, HUD trên cùng. `.booster-hud` đổi từ pill nhỏ nổi giữa tranh
và súng (`top: 65%` ước lượng) sang khay full-width sát đáy khung, bo góc trên (cùng công thức
`.hub-nav`: `left/right/bottom: 0`, `border-radius: var(--r-lg) var(--r-lg) 0 0`). Khay to hơn che luôn cả
thân súng (chỉ còn thấy nòng), nên súng phải nâng lên và thu nhỏ theo — qua nhiều vòng chỉnh theo ảnh chụp thực
tế người dùng gửi (`CANNON_ROOT_POSITION` từ y=-1.78, `CANNON_MODEL_SCALE` từ 0.8 xuống 0.58) để cả thân súng
(bệ, đầu tròn, nòng) hiện đủ phía trên khay với khoảng hở rõ ràng, không chỉ nâng suông (sẽ đẩy nòng súng chạm
vào đáy tranh).

Sau vòng chỉnh đầu (dừng ở y=0.05), người dùng báo lại vẫn thấy súng bị che y hệt — verify trên nhiều tỉ lệ
khung hình khác nhau (mobile 375×812, 375×650, 340×880) trong dev server đều không tái hiện được lỗi. Truy ra
nguyên nhân thật: người dùng test "mobile mode" bằng file build độc lập offline `outputs/3d-cannon-sort.html`
(`work/build-standalone.mjs`, tách hẳn khỏi dev server, phải build tay) — file này đã cũ từ 04/09, tức là
**toàn bộ đợt việc hôm nay (FTUE, khay booster, súng) đều chưa hề có trong file họ đang xem**, không phải do vị
trí súng còn sai. Đã build lại (`node work/build-standalone.mjs`, không commit — `/outputs/` nằm trong
`.gitignore`, sinh ra theo yêu cầu, không phải asset trong repo), verify bằng cách serve file mới qua static
server cục bộ: tutorial + khay booster + súng đều đúng ở đúng y=0.05.

Nhân dịp đó lại nâng thêm `CANNON_ROOT_POSITION.y` lên 0.45 cho "dư khoảng hở an toàn" — nhưng đây là phỏng đoán
sai: 0.05 vốn đã đúng ý muốn (súng nằm sát ngay trên khay), không phải súng thật sự bị che. Kết quả 0.45 đẩy
súng lên cao hẳn, gần sát bức tranh, đúng thứ ngược lại với điều được yêu cầu — bị phản hồi ngay ("sao đặt gần
bức tranh chi"). Trả `CANNON_ROOT_POSITION.y` về lại đúng 0.05, khớp với ảnh tham chiếu người dùng gửi (chính là
kết quả của vòng chỉnh trước lúc nghi ngờ nhầm nguyên nhân). Bài học: đừng "phòng xa" một giá trị đã được xác
nhận đúng bằng ảnh chụp thực tế, kể cả khi nguyên nhân báo lỗi trước đó hoá ra là thứ khác (bản build cũ).

Theo yêu cầu tiếp theo ("kéo xuống thêm nữa"), hạ thêm `CANNON_ROOT_POSITION.y` xuống -0.2, rồi hạ tiếp lần nữa
xuống -0.45 — súng giờ lún khá sâu vào khay thay vì chỉ nằm sát ngay phía trên nó. Sau đó, theo yêu cầu "nhích
lên 1 tí, phóng to canon ra chút": nhích `y` lên lại -0.3 và tăng `CANNON_MODEL_SCALE` từ 0.58 lên 0.68. Build
lại `outputs/3d-cannon-sort.html` sau mỗi lần chỉnh. Đã qua nhiều vòng chỉnh liên tiếp bằng mắt theo phản hồi
trực tiếp — hai hằng số này giờ nên coi là "chỉnh bằng mắt so với khay/tranh thật", không phải suy luận hình
học; xem lịch sử đủ các giá trị đã thử ở các mục ngay phía trên nếu cần đối chiếu.

**Test:** `tsc --noEmit` sạch (2 lỗi `db/index.ts`/`worker/index.ts` có từ trước, không liên quan), 150/150
test pass. Verify trực tiếp trên browser preview qua nhiều vòng: toàn bộ 5 bước tutorial (spotlight đúng vị trí
orb, cả 3 caption đọc đủ chữ, 2 bước demo bắn trúng/dọn sạch mint đúng lúc hết freeze, tap cuối reset đúng board
gốc), `forcedOpeningQueue` áp dụng lại đúng trên lượt chơi thật lẫn lượt chơi lại, "Test in game" từ Level
Editor mở đúng level qua client-side nav, khay booster + súng hiển thị đúng bố cục mới ở nhiều tỉ lệ khung hình.

## 160. FTUE dạy Radius Overcharge + Prism Shot (level 3): cùng flow như Freeze Orb, ép sẵn 3/2 lượt booster không đụng ví thật (10/09)

Yêu cầu: áp cùng flow FTUE từng bước của level 31 (Freeze Orb) cho level 3, nhưng dạy hai booster Radius
Overcharge và Prism Shot thay vì Freeze Orb — trình bày xong cho chơi lại từ đầu giống level 31, và màn 3 phải
mặc định cấp sẵn 3 lượt Radius + 2 lượt Prism cho người chơi, độc lập với ví thật của họ.

**`forcedBoosterCharges` — ép số lượt booster theo màn, không đụng ví thật (`sand-types.ts`, `sand-rules.ts`,
`SandCannonEngine.ts`):** cùng triết lý với `forcedOpeningQueue` (level-scoped, không phải kinh tế toàn cục).
Field mới trên `SandLevelConfig`; `createSandGameState` seed thành `SandGameState.boosterChargesOverride` (bản
sao riêng mỗi lượt chơi, kể cả restart). Engine thêm `effectiveBoosterCharges(type)` — đọc override nếu màn có
khai báo, không thì đọc ví thật (`getBoosterCharges`) như cũ; `armBooster` đổi sang gọi hàm này thay vì đọc thẳng
ví. `fire()` khi bắn có booster: nếu override tồn tại cho đúng loại đó thì trừ trên bản sao trong state (không
gọi `spendBoosterCharge`), không thì trừ ví thật như trước — một màn không khai báo field này thì hành xử y hệt
hiện tại, không đổi gì.

**`runScriptedBoosterShot` (`SandCannonEngine.ts`):** phát demo thật cho booster — arm booster đó qua đúng
`armBooster` (đi qua đúng đường kiểm tra lượt còn lại ở trên), rồi tái dùng `runScriptedShot` có sẵn để bắn một
phát ngắm-động-thật vào toạ độ chỉ định. Không phải hiệu ứng giả — đi qua đúng pipeline `fire()`/`resolveShot()`.

**Tutorial từng bước (`SandGame.tsx`, `i18n.ts`):** state machine
`intro-radius → demo-radius → intro-prism → demo-prism → outro`, song song với state machine freeze của level
31 (không gộp chung — hai luồng độc lập, cùng chạy được nếu sau này có màn cần cả hai). Hai bước `intro-*` là
spotlight + caption chờ tap; khác biệt so với freeze: spotlight ở đây khoanh tròn một **nút UI** (`.booster-btn
.is-radius`/`.is-prism`) chứ không phải một ô lưới 3D, nên tính toạ độ bằng
`getBoundingClientRect()` của nút trừ đi `getBoundingClientRect()` của `.scene-wrap`, thay vì
`engine.screenPointForGrid`. Tái dùng nguyên xi các class CSS `.ftue-freeze-overlay`/`-spotlight`/`-caption` có
sẵn (bản chất là "làm tối nền trừ một vòng tròn + caption card", không có gì đặc thù riêng cho freeze) thay vì
tạo bản sao đổi tên — giữ diff nhỏ. Bước `outro` tap để `restart()`, y hệt level 31 — reset lại board gốc (26
viên đạn, tranh nguyên vẹn, badge booster về lại 3/2). Đánh dấu "đã xem" qua `localStorage`
(`sand-cannon:v1:booster-ftue-seen`), độc lập với key của freeze.

**Cấu hình level 3 (`design/levels/sand-levels.ts`):** `forcedBoosterCharges: { radiusOvercharge: 3, prismShot:
2 }`, `ftueBoosterDemo: true`, `ftueBoosterTargets: [{x:7,y:4}, {x:2,y:8}]` (toạ độ hệ blueprint, đã lật trục Y
đúng công thức `y = height - 1 - rowIndex` như level 31, `expandLevelForPixelBoard` tự nhân `pixelScale` khi vào
engine) — phát đầu nhắm giữa thân màu vàng (demo Radius), phát hai nhắm ranh giới cam/xanh dương (demo Prism, cố
tình chọn chỗ có 2 màu để thấy rõ Prism dọn nhiều màu cùng lúc mà Radius không làm được).

**Lỗi phát sinh, đã sửa: Radius Overcharge không tắt yêu cầu trùng màu đạn.** `cellsInRadius` có
`matchColor: booster !== "prismShot"` — tức Radius Overcharge chỉ phóng to bán kính quét, **không** cho phép bắn
xuyên màu như Prism. Ban đầu level 3 không ép `forcedOpeningQueue`, nên phát demo Radius nạp đúng màu đầu tiên
theo bánh xe đạn bình thường (cam, không phải vàng) — verify bằng debug hook tạm (`window.__debugEngine`, đọc
`state.bodies` đếm theo màu) cho thấy sau demo, cam giảm 900→776 nhưng vàng (mục tiêu thật) không đổi, dù toạ độ
mục tiêu đã tính đúng nằm trên ô vàng. Sửa bằng thêm `forcedOpeningQueue: ["yellow"]` cho level 3 — ép đúng phát
mở màn là đạn vàng để bán kính phóng to thật sự "ăn" được vùng vàng dự định; verify lại: vàng 1800→122 (dọn 93%)
sau demo Radius. Phát demo Prism (đạn xanh dương theo bánh xe) không cần ép gì — Prism vốn không quan tâm màu
đạn, dọn được cả cam lẫn xanh dương cùng lúc đúng như minh hoạ.

**`level-writer.mjs`:** `preserveUneditableFtueFields` mở rộng thêm 3 field mới (`forcedBoosterCharges`/
`ftueBoosterDemo`/`ftueBoosterTargets`), cùng lý do và cơ chế với 3 field freeze đã có — draft cũ (import trước
khi field tồn tại) không còn xoá mất chúng khi ghi lại. `draftToTypeScript` serialize thêm 3 field này ra
TypeScript literal.

**Test:** `tsc --noEmit` sạch (2 lỗi cũ không liên quan), 150/150 test pass. Verify trực tiếp trên browser
preview: vào level 3 qua Settings → GameDevOption jump-and-Go (ví thật đang 0/0 hai loại booster — chứng minh
override thật sự độc lập với ví), spotlight đúng nút Radius rồi đúng nút Prism, demo Radius dọn ~93% vùng vàng,
demo Prism dọn nhiều màu cùng lúc, outro hiện đúng caption + badge 3/2, tap outro reset đúng board gốc (26 viên
đạn, tranh nguyên vẹn). Xoá debug hook `window.__debugEngine` và script toạ độ tạm sau khi verify xong.

## 161. Chấm đỏ trên Shop sau FTUE booster, tap là vào thẳng tab mua booster (10/09)

Yêu cầu tiếp theo: sau khi FTUE booster (level 3, mục 160) trình bày xong, lúc thoát ra home hub phải thấy chấm
đỏ trên biểu tượng Shop, nhấn vào là tự nhảy thẳng sang phần mua booster — không bắt người chơi tự mò qua đúng
tab.

**`BOOSTER_SHOP_HINT_KEY` (`SandGame.tsx`):** một cờ bật/tắt đơn giản trong `localStorage`
(`sand-cannon:v1:booster-shop-hint`), khác với các key "đã xem FTUE theo id" đã có — cờ này nghĩa là "đang có một
gợi ý chưa được xử lý", không phải "màn N đã xem". Bật ngay lúc `boosterFtueStep` chạm tới `"outro"` (demo vừa
xong), tắt ngay lúc người chơi thật sự nhấn vào Shop từ gợi ý đó. Giữ thêm một bản sao trong React state
(`boosterShopHint`) để re-render phản ứng đúng lúc, không đọc thẳng storage mỗi lần render như
`unseenAffordableSkins` (skin có ví/level để tính lại mỗi lần, còn cờ này chỉ đổi ở đúng hai thời điểm rời rạc
kể trên nên không cần).

**Tái dùng `.hub-nav-dot` có sẵn:** đúng chấm đỏ đang dùng cho tab Skin (`unseenAffordableSkins`), không tạo
class mới — cùng một ý nghĩa hình ảnh ("có việc đang chờ ở tab này"), chỉ khác điều kiện bật. Nút tab Shop trong
`hub-nav` khi bấm, nếu đang có `boosterShopHint`, tự set `shopTab` sang `"coins"` (tab bán booster, vốn cũng là
mặc định) và tắt cờ luôn trong cùng một lần bấm — không cần màn hình trung gian hỏi "có muốn xem không". Không
cần sửa gì thêm cho việc "chỉ hiện khi ở home": `.hub-nav` vốn đã ẩn hẳn lúc đang chơi (`is-leaving`), nên set cờ
ngay trong lúc demo vẫn đang chạy (trước khi người chơi kịp thoát ra) không lộ chấm đỏ sớm.

**`i18n.ts`:** thêm `shopTabHasBoosterHintSuffix` — hậu tố cho `aria-label` của tab Shop khi đang có gợi ý,
cùng kiểu với `skinTabHasOfferSuffix` đã có cho tab Skin.

**`resetEntireGame`:** xoá thêm `BOOSTER_SHOP_HINT_KEY` cùng lúc với 3 key FTUE khác, để "Reset toàn bộ" trong
GameDevOption không để sót cờ này lại.

**Test:** `tsc --noEmit` sạch, 150/150 test pass. Verify trực tiếp trên browser: chạy hết FTUE booster ở level 3
(xoá `booster-ftue-seen`/`booster-shop-hint` trước để ép chạy lại), xác nhận `localStorage` ghi `"1"` ngay khi
outro xuất hiện; tap outro reset board, thoát Home qua Settings → Home — chấm đỏ hiện đúng trên icon giỏ hàng
(Shop) ở thanh điều hướng dưới cùng; tap vào icon đó vào thẳng màn Shop, đúng tab Coins (Radius Overcharge +
Prism Shot hiện sẵn để mua), không phải tab Gems; `localStorage` xác nhận cờ đã bị xoá ngay sau tap đó.

## 162. Giá Radius Overcharge trong Shop: 60 → 100 vàng, bằng giá Prism Shot (10/09)

Yêu cầu: chỉnh giá Radius Overcharge trong Shop thành 100 vàng.

**`public/design/economy.csv`:** đây mới là giá thật server dùng (đọc runtime, override hằng số mặc định) —
sửa `boosterPriceRadiusOvercharge` từ 60 thành 100. `BOOSTER_PRICE.radiusOvercharge` (`app/game/economy.ts`,
hằng số fallback dùng khi không có CSV — ví dụ bản build standalone offline) cũng đổi theo cho khớp, để hai nơi
không lệch nhau.

**Hệ quả kéo theo, đã rà soát:** test `sand-economy.test.ts` có một case khẳng định "Prism Shot luôn đắt hơn
Radius Overcharge vì là buff mạnh hơn hẳn" (`BOOSTER_PRICE.prismShot > BOOSTER_PRICE.radiusOvercharge`) — giờ
hai giá bằng nhau nên đổi lại thành `>=` (không còn strict hơn nữa, nhưng vẫn giữ ý "Prism không bao giờ rẻ hơn
Radius"). `docs/features/economy-and-wallet.md`: cập nhật bảng giá trị mặc định và bỏ đoạn giải thích "Prism Shot
giá cao hơn" (không còn đúng nữa).

**Test:** `tsc --noEmit` sạch (2 lỗi cũ không liên quan), 150/150 test pass. Verify trực tiếp trên browser
preview: mở Shop → tab Coins, cả Radius Overcharge lẫn Prism Shot đều hiện đúng **100**.

## 163. Thêm 10 level mới (41-50): arc 5 "tổng hợp mọi cơ chế", dựa theo sheet beatchart-50 (10/09)

Yêu cầu: dựa trên `sand-cannon-sort-beatchart-50.csv` (bản mở rộng beatchart từ 40 lên 50 màn), tạo tiếp level 41
tới 50. Theo đúng tinh thần sheet: arc 5 **không dạy cơ chế mới nào** — chỉ tái tổ hợp 3 cơ chế đã có (Wall
Obstacle, Lock & Key, Freeze Map) ở cường độ cao hơn arc 4, xen kẽ 2 cặp "khó dần rồi thở" (41-45) và một cặp khó
kép (46-47) trước khi hạ xuống breather (48), lên đỉnh thật (49 — SPIKE khó nhất toàn bộ 50 màn), rồi capstone
trình diễn (50).

**Không có solver dựng sẵn để tự động kiểm — nên tự dựng một cái tạm.** `app/game/level-analysis.ts` đã có sẵn
đúng công cụ cần (`playStrong`/`analyseLevel`, dùng để đo `shotLimit` cho toàn bộ 40 level trước đó — xem
comment "Measured with analyseLevel" ở level 39/40), nhưng chưa từng dùng để *thiết kế* level từ đầu, chỉ để đo
lại level đã vẽ tay xong. Dựng một script Node tạm (`scratch-gen-levels.mjs`, đã xoá sau khi dùng xong) sinh
`rows` bằng hàm dựng dải màu ngang + hình thoi cho key/freeze + hình chữ nhật cho wall/lock, thay vì gõ tay từng
ký tự — rồi chạy thẳng `parseSandLevel`/`playStrong` thật (không phải bản sao chép) lên từng bản nháp để xác
nhận **giải được** trước khi chép vào `sand-levels.ts`, thay vì đoán suông theo cảm tính như một bản nháp thô sẽ
phải làm.

**Lỗi phát sinh trong lúc dựng, đã sửa cả hai:**
- **Hai mảng khoá cùng màu làm rối "AI chơi mạnh".** `playStrong`'s `bestShot` (level-analysis.ts) tính "shot
  lấy được bao nhiêu ô" mà **không loại trừ ô đang bị khoá** (`cellsInRadius` gọi thiếu tham số `frozen`) — nếu
  2 mảng khoá độc lập cùng màu tồn tại cùng lúc (1 đã mở, 1 chưa), thuật toán cứ nhắm vào mảng CHƯA mở (vì đếm
  nhầm ô khoá là "lấy được") thay vì mảng đã mở thật sự lấy được, bắn hoài không tiến — kẹt vĩnh viễn. Phát hiện
  bằng cách debug trực tiếp `resolveShot` (`outcome: "NO_MATCH"` dù `bestShot` báo `take: 40`). Sửa bằng cách cho
  mỗi mảng khoá độc lập một màu khoá RIÊNG (violet, navy... thay vì dùng chung 1 màu khoá cho 2-4 mảng như ý
  tưởng ban đầu) — không sửa `bestShot` dùng chung (ngoài phạm vi yêu cầu, và các level cũ 1-40 có thể đang dựa
  vào hành vi hiện tại của nó).
- **Chìa trôi ngang qua mảng khoá thay vì rơi trúng.** Ban đầu vẽ mảng khoá là một hình chữ nhật hẹp (không phải
  full-width) — không có `keyFriction`, chìa có thể "trôi" sang ngang theo độ dốc cát lúc dọn không đều, tuột ra
  khỏi cột toạ độ của mảng khoá và rơi thẳng xuống đáy mà không bao giờ chạm khoá. Sửa bằng cách đổi toàn bộ
  mảng khoá sang **dải full-width** (giống hệt cách 10 level Freeze Map trước đó — 31-40 — đã làm), để bất kỳ vị
  trí ngang nào của chìa khi rơi tới đúng độ cao cũng chắc chắn chạm khoá.

**Đơn giản hoá có chủ đích so với sheet gốc:** sheet mô tả nhiều ổ khoá "chuỗi"/"chuỗi lồng" (khoá B chỉ mở được
sau khi khoá A mở) — thử dựng đúng cơ chế ép thứ tự vật lý (khoá B ban đầu tựa ngay trên khoá A, chỉ rơi tiếp
được khi A tan) nhưng rủi ro cao (chạm nhau từ đầu ván là tự mở luôn, không cần người chơi làm gì) nên chọn
phương án an toàn hơn: **N ổ khoá độc lập** mỗi ổ tự có khoá + đường rơi riêng, không ép thứ tự cứng — người chơi
vẫn phải tự tìm và dọn đường tới từng cái, chỉ là không có ràng buộc "phải mở A trước B". Việc này khiến vài màu
khoá vượt số lượng CSV liệt kê (VD level 47/49 dùng thêm navy/violet ngoài "+P bị khoá" gốc) — đổi lại đảm bảo
giải được, đã verify bằng `playStrong` thật cho cả 10 màn.

**Wall/Freeze bố trí tách vùng, không chồng lấn ổ khoá:** mỗi cụm tường và mỗi ổ khoá được đặt ở dải hàng
(row-range) riêng, không giao nhau — tránh tình huống tường "cắt" một phần dải khoá full-width thành từng khúc
rời rạc rồi phải xử lý thêm logic không cần thiết. Cách này khớp đúng khuôn của level 39/40 cũ (tường tạm dừng ở
đúng hàng có khoá).

**`shotLimit` đo bằng `analyseLevel`, không copy số ước lượng thô trong CSV.** CSV tự ước `min_shots`/`shotLimit`
chỉ là phỏng đoán narrative, không tính tới việc tường chia đôi một dải màu thành 2 thân riêng (mỗi thân cần bắn
riêng, tốn thêm lượt) — đúng như level 39/40 cũ đã lệch xa số CSV gốc (comment "Measured with analyseLevel" của
chúng). 10 màn mới cũng vậy: đo `strongShots` thật rồi cộng slack theo độ khó (breather 44/45/48/50: slack
14-15, để "too-easy" đúng nghĩa màn thở; Vary/Combine 41-43/46-47: slack 3-8, verdict "good"; SPIKE 49: slack 3,
khớp đúng slack của SPIKE cũ nhất — level 39 — cũng chỉ 3).

**Cấu hình 10 level (`design/levels/sand-levels.ts`, tên export `fortyFirstLevel`..`fiftiethLevel`):**
- **41 Hang động bí ẩn** (Vary 6) — Wall × Lock&Key, 2 ổ khoá độc lập (green), 1 tường chia đôi khung.
  `shotLimit: 56`.
- **42 Cầu treo lắc lư** (Vary 7) — Freeze × Lock&Key, 2 ổ khoá độc lập (red), không tường. `shotLimit: 59`,
  `freezeDuration: 6`.
- **43 Cầu treo gãy nhịp** (Vary 7) — cùng bậc với 42, đổi tổ hợp: thêm 1 tường nhỏ trang trí không chặn đường
  chính. 2 ổ khoá độc lập (pink, violet). `shotLimit: 64`, `freezeDuration: 5`.
- **44 Vườn hoa yên tĩnh** (Breather 4) — chỉ còn 1 tường nhỏ trang trí. `shotLimit: 46`.
- **45 Vườn hoa sương sớm** (Breather 5) — tường nhỏ + 1 ổ khoá đơn giản (khoá một phần màu brown đã có sẵn
  trong bánh xe, không phải màu khoá riêng). `shotLimit: 53`.
- **46 Thành trì băng giá** (Combine 8) — mở cặp khó nhất: mọi cơ chế cùng lúc, 3 ổ khoá độc lập (purple, navy,
  violet), 2 cụm tường, 1 Freeze. `shotLimit: 71`, `freezeDuration: 5`.
- **47 Thành trì sụp đổ** (Combine 9) — đóng cặp khó nhất, nặng hơn 46 rõ rệt: 3 ổ khoá độc lập, 2 cụm tường
  lớn, Freeze dài hơn. `shotLimit: 71`, `freezeDuration: 6`.
- **48 Bến cảng lặng gió** (Breather 4) — chỉ 1 ổ khoá nhỏ (brown, rơi thẳng, không friction), nghỉ trước spike
  cuối. `shotLimit: 51`.
- **49 Ngọn hải đăng cuối cùng** (SPIKE 10) — màn khó nhất 50 màn: 4 ổ khoá độc lập (purple, navy, green,
  violet), 3 cụm tường, 1 Freeze, canvas 68×78 (5.304px — trong ngưỡng "comfort budget" ×1.6 của
  `PIXEL_BUDGET`, xem `level-drafts.ts`, nên không cần giảm kích thước như CSV cảnh báo). `shotLimit: 80`,
  `freezeDuration: 6`.
- **50 Bình minh trên đỉnh núi** (Breather 5, capstone) — mọi cơ chế có mặt nhưng mức trang trí, mở gần như
  ngay lập tức. `shotLimit: 68`.

**`tests/level-editor.test.ts`:** cập nhật assertion cứng "đúng 40 level, id 1..40" thành "đúng 50 level, id
1..50", import thêm 10 tên level mới.

**Test:** `tsc --noEmit` sạch (2 lỗi cũ không liên quan, `db/index.ts`/`worker/index.ts`), 150/150 test pass
(sau khi sửa assertion 40→50). Cả 10 level verify bằng `playStrong` thật: `won: true`, `remaining: 0`, không
lỗi `parseSandLevel` nào. Verify trực tiếp trên browser: "Level (1-50)" hiện đúng ở GameDevOption (xác nhận
`BUILT_IN_LEVELS` đã có 50 phần tử), nhảy tới level 41 — tường/khoá/màu hiện đúng bố cục, bắn thử một phát hiển
thị đúng "Missed the frame" khi hụt và bắn trúng khi ngắm lại; nhảy tới level 49 (nặng nhất) — cả 4 khoá, 3 cụm
tường, 1 nút Freeze đều hiện đúng, không lỗi console mới (chỉ còn 1 warning React có từ trước, tái hiện y hệt ở
level 1, không liên quan). Rebuild `outputs/3d-cannon-sort.html`.

## 164. Thêm skin súng mới "Frost Cannon" — theme băng tuyết, VFX bắn ra riêng, thưởng progression cho level 40 (10/09)

Yêu cầu: một ụ súng mới theme băng tuyết, có VFX riêng lúc bắn, đặt làm phần thưởng progression cho level 40
(giống cách Hero Cannon đã làm cho level 20).

**Khảo sát trước khi code:** hệ thống costume/VFX đã có sẵn đúng hạ tầng cần dùng, không cần xây gì mới —
`unlockLevel` trên `CostumeDef` (`costumes.ts`) là cơ chế "thắng level N lần đầu thì được free" đã chạy thật
(Hero Cannon dùng ở level 20), và `sparkleBlingColors()` (`SandCannonEngine.ts`) là đúng một điểm hook quyết
định costume nào có VFX bắn riêng và bảng màu gì — cả hai chỉ cần thêm entry mới, không phải sửa logic.

**`app/game/costumes.ts`:**
- `CostumeId` thêm `"frost-cannon"`; `CostumeFlavor` thêm `"frost"` (cạnh `"classic"`/`"magic"`) — chỉ dùng để
  chọn màu quả đạn ở màn trình diễn Skin (`showcaseMaterials`) và class CSS nền `.is-skin-frost`, không rẽ nhánh
  gì khác trong engine.
- `buildFrostCannon(groups)`: cùng 3 khối (pedestal/turret/barrel) với 3 costume có sẵn, phủ vật liệu toon
  xanh băng nhạt (`0xd8eefc`)/xanh sương (`0x7fb8d8`) + vật liệu phát sáng không đổ bóng (`MeshBasicMaterial`,
  xanh cyan băng `0xbdf3ff` và trắng pha lê) cho phần "lạnh tự phát sáng". Điểm nhận diện riêng: một vòng
  **măng đá (icicle)** rủ quanh mép bệ pháo — hình khối duy nhất chưa costume nào dùng — cộng 2 dải "băng đóng"
  phát sáng quanh nòng và một cụm pha lê nhỏ thay cho vòng miệng nòng trơn của súng cổ điển.
- `COSTUMES["frost-cannon"]`: `flavor: "frost"`, `price: 0`, `unlockLevel: 40` — copy đúng khuôn Hero Cannon
  (`unlockLevel: 20`), không có plumbing mới nào phải nối thêm ở `SandGame.tsx` (handler thắng level đã tổng
  quát hoá sẵn, đọc `costumeUnlockedByLevel` chứ không hardcode theo id).
- `COSTUME_ORDER` thêm `"frost-cannon"` vào cuối.

**`app/game/SandCannonEngine.ts` — VFX bắn riêng:** thêm hằng `FROST_SPARKLE_COLORS` (trắng/xanh cyan/xanh
sương băng) và một dòng trong `sparkleBlingColors()`: `if (this.costume.id === "frost-cannon") return
FROST_SPARKLE_COLORS;` — tái dùng nguyên hệ thống "sparkle shard" đã có (pool mảnh vỡ bát diện dùng chung cho
Rune Cannon/Hero Cannon lẫn Prism Shot), chỉ đổi bảng màu, không cần dựng pool VFX riêng. Mảnh vỡ trắng/xanh
băng bay ra ở đúng 3 nhịp có sẵn (lúc bắn, dọc đường bay, lúc chạm đích) đọc đúng thành "đá/tuyết vỡ văng ra" mà
không cần code mới cho từng nhịp. `showcaseMaterials` (màu quả đạn demo ở màn Skin) thêm `frost: 0xbdf3ff`.

**`app/SandGame.tsx`:** `CostumeIcon` (icon fallback trước khi thumbnail 3D render xong) thêm nhánh `isFrost`
vẽ 2 măng đá nhỏ dưới nòng; class `skin-card-icon` thêm `is-frost` cùng cách `is-hero` đã làm cho Hero Cannon.

**`app/i18n.ts`:** thêm "Frost Cannon" / "Chill. Aim. Shatter." (EN) và "Pháo Băng Giá" / "Đóng băng. Ngắm. Vỡ
tan." (VI) vào `costumeName`/`costumeTagline`.

**`app/globals.css`:** `.skin-card-icon.is-frost` (xanh băng `#4fa8d8`) cạnh `.is-magic`/`.is-hero`; thêm
`.game-frame.is-skin-frost` vào selector nền màn Skin đã dùng chung cho `classic`/`magic` (hoạ tiết mắc áo trôi
— comment sẵn trong file ghi rõ "cùng một nền cho mọi flavour", không phải nền riêng theo màu).

**Test:** `tsc --noEmit` sạch (2 lỗi cũ không liên quan), 150/150 test pass — không có exhaustive switch nào vỡ
vì thêm `CostumeId`/`CostumeFlavor` mới (đã rà `grep` toàn bộ 5 file có nhắc `CostumeId`/`CostumeFlavor`/
`"rune-cannon"`/`"hero-cannon"`). Verify trực tiếp trên browser: tab Skin hiện đúng thẻ "Frost Cannon" thứ 4,
khoá với badge "Progression", thumbnail 3D render đúng (bệ băng + măng đá + nòng phủ sương); set tạm
`localStorage` để giả lập đã sở hữu (thay vì chơi thật hết 40 màn) — thẻ chuyển "Selected", trang bị rồi vào màn
1 chơi thật: mô hình súng hiện đúng trong gameplay, bắn một phát ra đúng mảnh vỡ trắng/xanh băng ở đầu nòng,
không lỗi console mới. Xoá `localStorage` giả lập sau khi verify xong. Rebuild `outputs/3d-cannon-sort.html`.

## 165. Freeze Map: chìa khoá không còn bị đóng băng theo cát — vẫn rơi/lăn/mở khoá bình thường (11/09)

Yêu cầu: trong lúc Freeze Map đang chạy, vật lý của chìa khoá vẫn phải hoạt động — chìa không bị đóng băng theo
cát.

**Trước đây (từ lúc Freeze Map ra mắt, mục 158):** `runGrainSettle` (`sand-rules.ts`) coi "đóng băng" là dừng
TOÀN BỘ chuyển động khi đang frozen — không `GRAIN_PASS` (cát rơi), không `KEY_MOVE` (chìa rơi/lăn), không
`UNLOCK` (mở khoá) — comment cũ ghi rõ "a key already falling or sliding stops dead". Đây là chủ đích ban đầu
(dùng làm cơ chế "mua thời gian" cho các màn Freeze+Lock&Key như level 36), nhưng giờ đổi ý: chỉ CÁT mới đóng
băng, chìa khoá vẫn phải hoạt động bình thường trong lúc đó.

**`app/game/sand-rules.ts`:** thêm `settleWorldKeysOnly(world, frame, steps)` — giống hệt `settleWorld` (vòng
lặp chạy tới khi ổn định) nhưng bỏ hẳn `sandPass`, chỉ còn `keyPass`/`unlockPass`. `runGrainSettle`: khi
`frozen` và có chìa trên bàn (`fixtures.keys?.length`), gọi hàm mới này thay vì bỏ qua hoàn toàn như trước; khi
`frozen` và không có chìa, vẫn không làm gì (như cũ, không tốn công cho trường hợp không liên quan). Cát mà một
lượt mở khoá vừa giải phóng vẫn là cát như mọi cát khác lúc đang đóng băng — nó nằm nguyên đúng chỗ ổ khoá vừa
mở ra, không tự rơi tiếp, vì chỉ `sandPass` mới bị Freeze giữ lại, không phải toàn bộ lưới.

**Test mới — `tests/sand-freeze-key.test.ts`** (chưa hề có test nào cho cơ chế Freeze hay Lock&Key riêng trước
đây, dù cả hai đã có từ lâu): dùng lại fixture `lockAndKey` có sẵn (`tests/level-fixtures.ts`), bỏ mảng vàng
chìa đang tựa lên (mô phỏng một phát bắn dọn nó), rồi chạy `runGrainSettle(..., frozen: true)` trực tiếp — xác
nhận chìa rơi trúng phiến khoá và tự tiêu hao để mở nó (`keys.length` 1→0, `locked.length` >0→0) ngay trong một
lượt settle ĐANG đóng băng; đối chứng: cát tím vừa được giải phóng nằm y nguyên vị trí cũ (không rơi) trong lượt
frozen đó, nhưng CÙNG bức tranh chạy lại không đóng băng thì cát tím rơi xuống thật. Thêm file này vào
`package.json`'s `test` script.

**Test:** `tsc --noEmit` sạch (2 lỗi cũ không liên quan), 151/151 test pass (150 cũ + 1 test mới). Verify trực
tiếp trên browser: vào level 36 (Freeze × Lock&Key), bắn vài phát gần nút Freeze/dải cát quanh 2 ổ khoá — không
crash, không lỗi console, chìa (2 viên) và dải khoá vẫn hiển thị đúng. Không sửa nội dung/mô tả level nào (design
level 36 vẫn giữ nguyên vị trí wall/lock/freeze, không cần đổi vì thay đổi này chỉ ảnh hưởng đến hành vi vật lý
lúc chạy, không ảnh hưởng bố cục màn). Rebuild `outputs/3d-cannon-sort.html`.

## 166. Cơ chế mới: chìa khoá giấu dưới cát, nhú dần theo từng ô được dọn (`hiddenKeyRows`) (11/09)

Yêu cầu ban đầu ("chìa khoá hide behind the sand luôn nhú cái đầu ra mỗi khi có grain pixel được quét chứ không
phải tất cả grain pixel được quét thì nó mới nhú ra") tưởng là sửa lỗi, hoá ra là **cơ chế hoàn toàn chưa tồn
tại** — game mới chỉ có "Freeze trigger giấu dưới cát" (`hiddenFreezeRows`, tất-cả-hoặc-không-gì, chỉ lộ khi dọn
sạch 100%), chưa hề có bản tương đương cho chìa khoá. Hỏi lại để chốt phạm vi: xây cơ chế mới, với yêu cầu riêng
là **lộ dần từng ô** thay vì tất-cả-hoặc-không-gì như Freeze.

**`SandLevelConfig.hiddenKeyRows`** (`sand-types.ts`) — một lưới thứ hai, cùng kích thước `rows`, chỉ `K`
(`KEY_LETTER`) có ý nghĩa, giống hệt khuôn `hiddenFreezeRows`. Chìa giấu ở đây nằm bên dưới bất kỳ cát `rows`
vẽ ở đúng ô đó, không có mặt gì cho tới khi được đào ra.

**Gameplay: vẫn tất-cả-hoặc-không-gì, y hệt Freeze trigger** (`sand-rules.ts`): `parseSandLevel` đọc
`hiddenKeyRows` y hệt `hiddenFreezeRows` (chỉ khác ký tự `K`), gom thành `hiddenKeys: SandKey[]`.
`revealHiddenKeys` (mirror `revealHiddenFreezeTriggers`) kiểm tra sau mỗi settle: chìa chỉ thật sự trở thành vật
thể có vật lý (rơi/lăn/mở khoá) khi **toàn bộ** ô của nó trống cát — dọn nửa chừng không đủ. `resolveShot` gọi
hàm này ở cả 2 nhánh (NO_MATCH và SORTED), thêm chìa vừa lộ vào `state.keys`.

**Rendering: nhú dần theo TỪNG Ô, đây là điểm khác Freeze** (`SandCannonEngine.ts`): thêm một lượt vẽ mới ngay
trước lượt vẽ chìa thật — với MỖI ô của một chìa còn giấu, nếu `this.cells` (bản đồ pixel cát hiện tại) không
còn giữ ô đó nữa (tức cát che đã dọn xong, kể cả hiệu ứng clear-flash), vẽ luôn màu vàng embossed của chìa
(`keyBevelRgb`, y hệt công thức chìa thật dùng) tại đúng ô đó — không chờ đủ 100%. Không glint, không xoay (chìa
giấu chưa di chuyển, không cần tính lại mỗi khi không có gì đổi).

**`level-drafts.ts`/`LevelEditor.tsx`/`level-writer.mjs`:** thêm `hiddenKeyRows` vào `LevelDraft` (round-trip đầy
đủ qua `draftToLevel`/`levelToDraft`/`expandDraftToPixels`/resize) và vào `draftToTypeScript` — để một level lỡ
có field này (gõ tay) không bị "Ship"/"Update built-in level" từ Level Editor âm thầm xoá mất, đúng bài học đã
rút ra từ vụ 3 field FTUE trước đây (mục 159). Chưa có tool vẽ riêng trong Editor UI cho chế độ "giấu chìa" (khác
với Freeze đã có nút "Hidden" riêng) — nằm ngoài phạm vi yêu cầu lần này, chỉ thêm dòng ghi chú trong panel Ammo
wheel báo có bao nhiêu ô chìa giấu nếu field được gõ tay.

**Test mới:**
- `tests/sand-hidden-key.test.ts`: dựng level tối giản — 2 ô cát nâu che đúng 2 ô chìa giấu, dưới đó là dải khoá
  tím full-width. Dọn 1 trong 2 ô che → vẫn ẩn (`hiddenKeys.length === 1`, `keys.length === 0`); dọn nốt ô còn
  lại → lộ hẳn (`hiddenKeys.length === 0`, `keys.length === 1`); bắn thêm 1 phát bất kỳ để settle chạy tiếp →
  chìa (giờ là vật thể thật) chạm khoá và mở luôn, y hệt một chìa được vẽ hiện ngay từ đầu.
- Thêm cả 2 file test freeze/key (mục 165) và hidden-key (mục này) vào `package.json`'s `test` script.

**Test:** `tsc --noEmit` sạch (2 lỗi cũ không liên quan), 152/152 test pass (150 cũ + 2 test mới). Verify trực
tiếp trên browser bằng debug hook tạm (`window.__debugEngine`, xoá ngay sau khi xong): tiêm `state.hiddenKeys`
giả vào engine đang chạy thật ở level 1, gọi thẳng `redrawSand()`, đọc pixel thật từ canvas — ô đã dọn sạch hiện
đúng màu vàng embossed của chìa (khớp `keyBevelRgb`), ô còn cát che vẫn hiện đúng màu cát bình thường, không lộ
sớm. Chụp màn hình xác nhận thấy rõ hình chìa nhú ra ở góc khung tranh. Rebuild `outputs/3d-cannon-sort.html`.

## 167. Thêm booster mới "Chain Sort" — dọn toàn bộ mảng liền kề cùng màu, kể cả nằm xéo, dùng tạm icon Prism (11/09)

Yêu cầu: một booster mới — bắn để sort thì dọn sạch TOÀN BỘ mảng cát cùng màu liền kề nhau (không giới hạn bán
kính như 2 booster cũ), kể cả những ô chỉ chạm nhau ở góc (xéo) chứ không chỉ 4 hướng thẳng. Dùng tạm icon
Prism Shot cho tới khi có art riêng.

**Khảo sát trước khi code:** dùng 1 agent map lại toàn bộ chỗ 2 booster cũ (`radiusOvercharge`/`prismShot`) chạm
vào trong code — economy (giá, số viên khởi đầu, CSV key), gameplay (`cellsInRadius`/`effectiveSortRadius` trong
`resolveShot`), rendering (ring overlay, aim preview, lift preview, projectile VFX), UI (HUD tray, Shop grid,
icon component), và test coverage — để thêm booster thứ 3 không sót chỗ nào kiểu exhaustive Record vỡ ngầm.

**`app/game/sand-types.ts`:** `BoosterType` thêm `"chainSort"`, `BOOSTER_TYPES` thêm theo.

**`app/game/sand-rules.ts` — cơ chế cốt lõi:**
- `cellsByFloodFill(bodies, center, color, frozen)`: BFS từ đúng ô va chạm, lan theo 8 hướng (`ORTHOGONAL_4` +
  `DIAGONAL_4`, hằng số mới) qua mọi ô cùng màu — khác hẳn `ORTHOGONAL_4`-only mà MỌI luật khác trong file này
  dùng (tách body, settle, mở khoá). Không giới hạn số ô lấy được. `frozen` bị loại khỏi flood giống hệt cách
  `cellsInRadius` loại cát bị khoá khỏi đĩa — cát khoá vô hình với luồng lan, không phải vật cản chặn nó lại.
  Trả rỗng nếu ô va chạm không phải đúng màu đang cầm (không có bán kính để "vói" ra ngoài như đĩa).
- `resolveShot`: thêm nhánh `booster === "chainSort"` gọi `cellsByFloodFill` thay vì `cellsInRadius` — mọi thứ
  phía sau (mở Freeze trigger, `spend`, refill bánh xe đạn...) vẫn dùng chung logic, không cần đổi gì.

**`app/game/economy.ts`/`public/design/economy.csv`/`docs/features/economy-and-wallet.md`:** thêm
`STARTER_BOOSTER_CHARGES.chainSort` (1, như 2 loại kia) và `BOOSTER_PRICE.chainSort` (150 — đắt hơn cả hai, vì
không có trần: một phát trúng mảng khổng lồ dọn được nhiều hơn hẳn bất kỳ đĩa bán kính nào). `CONFIG_KEY.starterBooster`/`.boosterPrice`
đổi từ ternary 2 nhánh sang 3 nhánh. `defaultWallet()`/`readWallet()`'s object literal thêm field
`chainSort` (TypeScript tự bắt buộc vì `Record<BoosterType, number>` giờ có 3 key).

**`app/game/SandCannonEngine.ts` — rendering:**
- `syncBoosterOverlay`/idle-pulse trong `updateAmmoModel`: gộp `chainSort` vào đúng nhánh `isPrism` — dùng
  chung ring cầu vồng quay của Prism Shot làm placeholder, đúng yêu cầu "dùng tạm hình Prism".
- Aim ring (`updateAimPreview`) ẩn hẳn khi armed Chain Sort — không có bán kính để vẽ vòng tròn cho đúng nghĩa,
  vẽ ở scale cũ (1x) sẽ là một vòng tròn SAI, gây hiểu nhầm.
- Preview "nhấc" cát trước khi bắn (`liftTarget`) không áp dụng được kiểu bán kính cố định cho Chain Sort — thêm
  field song song `liftCells: Set<string>`, tính bằng đúng `cellsByFloodFill` (oracle thật, không phải bán kính
  giả lập), để preview hiện chính xác từng ô sẽ bị dọn, không chỉ ước lượng.
- Ring flash lúc chạm đích (`spawnSortRing`) bỏ qua cho Chain Sort — không có bán kính để vẽ, hiệu ứng
  clear-flash trên từng hạt đã dọn là đủ làm "tell" riêng của nó.

**`app/SandGame.tsx`:** `BoosterIcon` dùng chung nhánh "không phải Radius Overcharge thì dùng art Prism"
(`/icons/PrismChargeIcon.png`) — Chain Sort tự động rơi vào đó, không cần thêm asset. HUD tray và Shop grid mở
rộng tuple `["radiusOvercharge", "prismShot"]` thành 3 phần tử để nút/thẻ mới thật sự hiện ra.

**`app/i18n.ts`:** `boosterName`/`boosterDesc` đổi từ binary ternary sang 3 nhánh — "Chain Sort" / "Clears the
whole connected mass of that colour, corners included — no radius limit." (EN), "Dọn Liên Hoàn" / "Dọn sạch cả
mảng cát cùng màu liền kề, kể cả nằm xéo — không giới hạn bán kính." (VI). Chữ ký hàm đổi từ literal union hẹp
sang `BoosterType` chung (vốn đã là bug tiềm ẩn — sẽ vỡ ngay khi thêm booster thứ 3 nếu không sửa).

**`scripts/level-writer.mjs`:** regex round-trip `forcedBoosterCharges` thêm `chainSort` vào alternation, để một
level lỡ ép sẵn charge Chain Sort không bị "Ship" từ Level Editor âm thầm xoá mất.

**`docs/features/booster-radius-prism-spec.md`:** đổi tên file mô tả thành 3 booster, thêm mục `§2.1 Chain Sort`
mô tả đầy đủ cơ chế, giá, và quyết định dùng art Prism tạm thời.

**Test mới (`tests/sand-boosters.test.ts`, `tests/sand-economy.test.ts`):**
- Chain Sort lấy đúng y hệt oracle `cellsByFloodFill` tính riêng.
- Chain Sort lan qua được 2 "body" chỉ chạm nhau ở góc (fixture 2×2 dựng tay, xác nhận trước đó đúng là 2 body
  riêng theo `ORTHOGONAL_4`, sau đó Chain Sort gộp thành 1 lượt dọn 2 ô) — đúng trọng tâm yêu cầu "nằm xéo cũng
  sort được".
- Chain Sort vẫn bỏ qua cát bị khoá (vô hình với flood, không phải vật cản).
- Chain Sort nhắm trúng màu khác/không có gì → NO_MATCH, không có bán kính để "vói" ra ngoài.
- Số viên khởi đầu và giá Chain Sort đúng theo cấu hình mới, giá cao hơn cả hai loại kia.
- Bắt được 1 bug thật lúc viết test: `cellsByFloodFill` trả về ô bắt đầu là chính tham chiếu `center` truyền
  vào thay vì bản sao `{x,y}` sạch — nếu caller đưa vào một object có field thừa (test ban đầu lỡ tái dùng
  object `target` có thêm field `take`), field đó rò rỉ ra kết quả trả về. Sửa để luôn trả object `{x,y}` mới,
  giống đúng quy ước `cellsInRadius` đã có.

**Test:** `tsc --noEmit` sạch (2 lỗi cũ không liên quan), 157/157 test pass (152 cũ + 5 mới). Verify trực tiếp
trên browser: Shop hiện đúng 3 thẻ booster (Chain Sort giá 150, icon/tint giống Prism, badge "1" viên khởi đầu);
HUD tray hiện đúng 3 nút; arm Chain Sort hiện toast + ring cầu vồng trên súng, không hiện aim-ring (đúng ý, vì
không có bán kính); bắn trúng lớp mây (nền trắng liền kề, có cả đoạn chạm chéo) — dọn sạch một mảng lớn hơn hẳn
một phát thường trong đúng 1 lượt, viên Chain Sort bị trừ về 0, không lỗi console. Rebuild
`outputs/3d-cannon-sort.html`.

## 168. Vật lý chìa khoá: tự trượt xuống hết một slope rộng (staircase nhiều ô/bậc), không chỉ dừng giữa chừng (11/09)

Yêu cầu, kèm ảnh chụp: một chìa khoá đang nằm yên giữa chừng trên một mặt dốc (Wall Obstacle vẽ hình bậc
thang) — bạn muốn nó phải tiếp tục trượt xuống do trọng lực/độ dốc, giống vật lý thật hơn.

**Root cause:** `keyPass` (`sand-rules.ts`) trước giờ chỉ thử đúng 3 hướng mỗi lượt: thẳng xuống, hoặc CHÉO
xuống-trái/xuống-phải MỘT Ô duy nhất. Ở độ phân giải pixel thật, một "mặt dốc" vẽ bằng Wall Obstacle thường là
bậc thang NHIỀU Ô rộng mỗi bậc (không phải đường chéo 1-ô-mỗi-hàng hoàn hảo) — chìa nằm giữa một bậc rộng thì ô
chéo NGAY BÊN CẠNH vẫn cùng độ cao (bậc thang chưa hết), nên thuật toán cũ đọc đó là "đã nằm yên vĩnh viễn",
dừng lại giữa chừng dù bậc thang vẫn còn tiếp tục đi xuống xa hơn. Cát thường cũng có giới hạn tương tự, nhưng
đó là hành vi ĐÚNG cho cát (không thể tự "biết" có dốc xa hơn); chìa khoá thì được xem là một vật rắn đang lăn,
nên cần "thông minh" hơn một hạt cát.

**`app/game/sand-rules.ts` — `findSlopeDrop` (hàm mới):** khi cả thẳng xuống lẫn cả 2 hướng chéo đều bị chặn,
quét dọc theo HÀNG NGANG hiện tại của chìa ra xa dần về mỗi phía (không giới hạn, nhưng dừng ngay khi hàng đó bị
chặn — không "nhảy cóc" qua vật cản), tìm điểm gần nhất mà trượt tới đó rồi có thể rơi tiếp. `keyPass` dùng kết
quả này để trượt NGANG (một ô mỗi lượt, vẫn theo đúng nhịp friction như trượt chéo) hướng về phía đó, cho tới
khi chạm mép bậc thang thì cơ chế trượt chéo cũ tiếp quản bình thường.

**Không phá luật "cân bằng trên trụ hẹp thì đứng yên" đã có sẵn (test cũ):** một test cũ
(`tests/sand-mechanics.test.ts`) khẳng định chìa cân bằng chính giữa một trụ hẹp hơn hẳn bề ngang của nó (2 bên
đều hở, đối xứng) phải NẰM YÊN, không tự trượt khỏi trụ — đây là quyết định thiết kế có chủ đích, để người làm
level có thể đặt chìa "chờ" trên một điểm tựa hẹp mà không lo nó tự rơi. Bản đầu tiên của `findSlopeDrop` (chỉ
cần MỘT hướng có lối thoát) làm hỏng test này — sửa bằng cách yêu cầu: chỉ coi là "trên dốc" (và trượt) khi
ĐÚNG MỘT hướng có lối thoát; nếu CẢ HAI hướng đều có lối thoát (đối xứng, không hướng nào rõ ràng là "xuống dốc"
hơn hướng kia), coi như cân bằng ổn định, không trượt — khớp đúng test cũ, không cần đổi kỳ vọng của nó.

**Đã rà soát không phá vỡ level nào:** chạy `playStrong` (uncapped shotLimit) trên toàn bộ 50 level trước và sau
thay đổi — không có level nào chuyển từ "giải được" sang "không giải được" vì thay đổi này (một vài level
21-29 vốn đã sát/vượt ngân sách từ trước, không liên quan tới thay đổi hôm nay — nghi ngờ liên quan tới việc
`design/levels/sand-levels.ts` đang được chỉnh sửa song song ở nơi khác, đã báo cho người dùng, không đụng vào).

**Test mới (`tests/sand-mechanics.test.ts`):**
- Chìa trên bậc thang RỘNG (mỗi bậc rộng hơn cả bề ngang chìa) phải trượt hết xuống sàn, dùng cả bước trượt
  ngang lẫn bước trượt chéo xen kẽ — không chỉ dừng ở bậc đầu tiên.
- Test cũ "cân bằng trên trụ hẹp" giữ nguyên hành vi (đổi tên nhấn mạnh lý do: đối xứng hai bên không phải là
  dốc).

**Test:** `tsc --noEmit` sạch (2 lỗi cũ không liên quan), 159/159 test pass (157 cũ + 2 test mới). Verify trực
tiếp trên browser: level 21 (Lock & Key) tải đúng, bắn dọn cát quanh chìa không crash, không lỗi console. Rebuild
`outputs/3d-cannon-sort.html`.

## 169. Cân bằng lại economy: thưởng level theo "5 trận/1 booster", bonus mốc hàng chục, Daily Login gắn lịch thật (11/09)

**Yêu cầu:** (1) mỗi level nên trả đủ vàng sao cho chơi khoảng 5 trận (lần đầu thắng) là mua được 1 booster;
(2) các mốc hàng chục (10/20/30/40/50) nên có bonus tăng dần, rơi vào khoảng 2/3–3/4 giá 1 booster; (3) Daily
Login nên gắn liền với lịch thật ngoài đời (hôm nay thứ mấy thì ô "hôm nay" đúng thứ đó), 3 ngày đầu tuần vừa
phải + có ưu đãi thêm, 2 ngày cuối tuần trả nhiều hơn, và layout nên là lưới của cả tháng thay vì dải 7 ô lặp.

**1) `levelGoldReward` (`app/game/economy.ts`):** đổi `REWARD_BASE`/`REWARD_PER_POINT` từ `20`/`1` (khoảng
20–120 vàng) xuống `5`/`0.3` (khoảng 5–35 vàng) — một level độ khó trung bình (score 50) giờ trả đúng **20
vàng = `BOOSTER_PRICE.radiusOvercharge` (100) ÷ 5**. `public/design/level-rewards.csv`'s override cho Level 1
đổi từ 20 xuống 10 cho khớp scale mới.

**2) Bonus mốc hàng chục — tính năng mới:** `levelMilestoneBonus(levelId)` (economy.ts), cộng THÊM vào thưởng
thường của level đó (công thức hoặc CSV override), chỉ ở lần thắng đầu tiên, tại `LEVEL_MILESTONE_LEVELS =
[10, 20, 30, 40, 50]` với `LEVEL_MILESTONE_BONUS = [65, 75, 90, 100, 115]` — tăng dần, mỗi mốc rơi vào khoảng
2/3–3/4 giá một booster. Override từng mốc qua `economy.csv` (`levelMilestoneBonus10`..`levelMilestoneBonus50`
— key mới, `CONFIG_KEY.levelMilestoneBonus`). Gọi ở `SandGame.tsx`'s WIN handler (cộng vào `granted` trước khi
`addGold`) và ở pill thưởng mốc trong Gallery (cùng công thức, hiển thị trước cả khi level unlock).

**3) Daily Login — viết lại gắn lịch thật (thay đổi lớn nhất):** trước đây là một chu kỳ 7 ngày tự lặp
(`lastDay` streak position, quấn vòng `% 7`) hoàn toàn không liên quan gì tới ngày thật — "ngày 1" của streak
có thể rơi vào bất kỳ thứ nào tuỳ lúc người chơi bắt đầu. Giờ:

- `dailyLoginReward(weekday)` nhận **thứ thật trong tuần** (0 = Thứ Hai .. 6 = Chủ Nhật, `weekdayIndex(date)`
  tính từ `Date` thật của máy) thay vì vị trí streak — bảng mới `DAILY_LOGIN_REWARDS = [10, 12, 15, 18, 20, 30,
  40]` (T2→CN). T2–T4 còn nhận thêm 1 lượt booster miễn phí luân phiên (`DAILY_LOGIN_BOOSTER_PERK`: T2→Radius
  Overcharge, T3→Prism Shot, T4→Chain Sort) — phần "ưu đãi" ngoài vàng đúng như yêu cầu.
- `DailyLoginRecord` đổi shape: từ `{ lastDay, lastClaimedOn }` sang `{ claimedDates: string[], lastClaimedOn,
  streak }` — `claimedDates` lưu TỪNG ngày thật đã claim (cắt còn 60 ngày gần nhất qua `pruneClaimedDates`),
  để lưới lịch tô đúng dấu ✓ trên ngày thật đã claim thay vì suy luận "trước hôm nay = đã claim". Đây là thay
  đổi shape lưu trữ không tương thích ngược — một record cũ (`lastDay` number) không parse được nữa
  (`readDailyRecord` coi là chưa từng claim), tức người chơi cũ sẽ mất streak hiện tại một lần duy nhất sau bản
  cập nhật này — chấp nhận được vì server/account không tồn tại, hoàn toàn client-only.
- `computeDailyLoginState` viết lại: `weekday`/`reward`/`boosterPerk` tính thẳng từ ngày thật, KHÔNG phụ thuộc
  record nữa; `streak` giữ nguyên khi gap ≤ 1 ngày, reset 0 khi bỏ lỡ ≥ 2 ngày, chỉ thực sự +1 trong
  `claimDailyLogin` lúc claim thành công.
- `getDailyLoginCalendar(now)` — hàm mới, dựng lưới ô phẳng của CẢ THÁNG hiện tại (Thứ Hai đầu mỗi hàng, luôn
  bội số của 7, đệm ngày tháng lân cận ở đầu/cuối với `isCurrentMonth: false`), mỗi ô mang `date`, `weekday`,
  `reward`, `boosterPerk`, `isToday`/`isPast`/`isFuture`/`isClaimed`.
- `app/SandGame.tsx`'s daily-login modal viết lại hoàn toàn: từ dải 6 chip + 1 "hero card" (day 7) sang lưới
  CSS Grid 7 cột (`getDailyLoginCalendar`), header thứ Thứ Hai→Chủ Nhật, tag "Hời" cho T2-T4, tag "Cuối tuần"
  cho T7/CN, dòng streak khi ≥ 2 ngày liên tiếp. CSS mới trong `globals.css` (`.daily-login-calendar`,
  `.daily-login-cell*`, `.daily-login-weekday-*`, `.daily-login-streak`) thay thế toàn bộ
  `.daily-login-strip`/`.daily-login-day`/`.daily-login-hero*` cũ.
- i18n (`app/i18n.ts`): thêm `weekdayShort`, `weekendBonus`, `dailyLoginPerkTag`, `dailyLoginStreak`,
  `monthTitle`; bỏ `bestReward` (không còn "ngày 7 hero card" riêng).

**Test:** `tests/sand-economy.test.ts` viết lại toàn bộ khối `levelGoldReward`/daily-login cho công thức và
record shape mới, thêm test cho `levelMilestoneBonus` và `getDailyLoginCalendar` (32/32 pass). Toàn bộ suite
`npm test`: 162/162 pass. `tsc --noEmit`: sạch, cùng 3 lỗi cloudflare-workers-types cũ không liên quan (đã xác
nhận có sẵn trên `main`, không phải do thay đổi này). Verify trực tiếp trên dev server: lưới Daily Login hiển
thị đúng "Tháng 9, 2026", ô ngày 11 (Thứ Sáu thật) được khoanh "hôm nay" đúng cột FRI, claim +20 vàng đúng số,
chuyển thành ✓; Gallery hiển thị pill milestone level 10 = "+80" (15 công thức + 65 bonus), level 20 = "+95"
(20 công thức + 75 bonus).

**Docs cập nhật:** `docs/features/economy-and-wallet.md`, `docs/features/level-rewards.md`, `GDD.md` (§10.3,
§10.3b mới, §10.6) — số liệu và mô tả khớp đúng code.

## 170. Daily Login: lưới đen ô vuông tự cuộn được, sửa hydration mismatch mới phát hiện (11/09)

**Feedback:** lưới lịch #169 mới làm bị "dồn hết vô 1 HUD trông rất xấu" — 5-6 tuần bị ép co vừa đúng
một card không cuộn được, và cần đổi sang "grid đen, ô vuông".

**1) Redesign lưới (`app/globals.css`, `app/SandGame.tsx`):** bọc `.daily-login-weekday-row` +
`.daily-login-calendar` trong `.daily-login-calendar-scroll` — nền tối riêng (`#100c08`), `max-height:
254px` + `overflow-y: auto`, nên tháng cần 6 tuần (tháng bắt đầu Chủ Nhật và có 31 ngày — vd 11/2026)
tự cuộn thay vì bị nén. Header thứ `position: sticky; top` bên trong khối cuộn đó nên dính lại khi
cuộn qua các tuần. Mỗi ô đổi từ pill bo tròn cao thấp không đều (do tag "Hời"/"Cuối tuần" absolute đè
lên ô hàng trên) sang **hình vuông thật** (`aspect-ratio: 1`), nền tối riêng từng ô; `gap` 3px giữa
các ô trên nền tối của khối cuộn chính là đường kẻ lưới đen, không cần border riêng. Tag "Hời"/"Cuối
tuần" và tag booster-perk chuyển từ pill nổi đè lên ô khác sang góc/mép bên trong chính ô của nó — hết
tình trạng đè chữ lên hàng bên cạnh khi ô co nhỏ lại.

**2) Bug hydration mismatch phát hiện khi test lại (không liên quan trực tiếp tới yêu cầu redesign,
nhưng phải sửa cùng lúc vì chặn hẳn trang không load được):** `getDailyLoginCalendar(devNow())` bị gọi
thẳng trong JSX lúc render ở bản #169 — hàm này đọc `localStorage` thật ngay khi có `window`. Lúc SSR
(`window` không tồn tại) luôn thấy `claimedDates` rỗng; lúc client hydrate (có `window` thật) đọc được
dữ liệu claim thật → hai lần render (server vs client) ra nội dung khác nhau → React báo "Hydration
failed because the server rendered text didn't match the client". Tái hiện được bằng cách reload trang
sau khi đã claim ít nhất 1 ngày trong phiên trước.

Sửa theo đúng pattern `initialDailyLogin`/`SERVER_DAILY_LOGIN` module đã dùng cho chính state hôm nay:
- `SERVER_DAILY_CALENDAR` (mảng rỗng cố định, đứng vai server snapshot) + `cachedInitialDailyCalendar`/
  `readInitialDailyCalendar` (cache một lần lúc mount, đứng vai client snapshot) — cả hai đi qua
  `useSyncExternalStore` giống hệt cách `initialDailyLogin` đã làm.
- State React mới `dailyCalendarOverride`, set trong `claimDailyLoginWithFlight` ngay sau khi claim
  thành công, để ô "hôm nay" đổi thành ✓ mà không cần đọc lại storage giữa render.
- Tiêu đề tháng (`s.monthTitle`) đổi từ gọi `devNow()` thẳng trong JSX sang suy ra từ ô đầu tiên có
  `isCurrentMonth: true` trong `dailyCalendar` đã hydration-safe — `devNow()` phụ thuộc dev date-offset
  tool trong `localStorage`, chỉ tồn tại phía client, nên gọi trực tiếp cũng lệch SSR/client y hệt vấn
  đề trên (phát hiện bằng cách bật thử dev-date-offset rồi reload, lỗi tái hiện ngay).

Đánh đổi chấp nhận được: cache theo trang (giống `initialDailyLogin` vốn đã vậy) nghĩa là một sửa
`economy.csv` cho `dailyLoginDay*` cần F5 lại mới thấy trên lưới, không còn tự live-update qua poll 4s
như bản #169 (bản đó live-update được NHỜ chính cái bug đọc thẳng storage mỗi render).

**Test:** verify trực tiếp trên dev server — reload sau khi đã claim: không còn lỗi hydration, ô ngày
đã claim đúng ✓. Set `dev-date-offset-days` sang tháng 11/2026 (6 tuần) qua `localStorage`, reload: lưới
hiện đúng "NOVEMBER 2026", 6 hàng, cuộn được, header thứ dính lại đúng khi cuộn, nút Claim hiện đúng số
(Chủ Nhật 15/11 → 40 vàng). `npm test`: 162/162 pass (không đổi test nào, đây là thay đổi UI + hạ tầng
render thuần). `tsc --noEmit`: sạch, cùng 3 lỗi cloudflare cũ không liên quan.

**Docs cập nhật:** `docs/features/economy-and-wallet.md` — thêm mục "Giao diện: lưới đen, ô vuông, tự
cuộn" giải thích cả style lẫn cái bẫy hydration để ai sửa lại phần này sau không dẫm lại.

## 171. Daily Login: bỏ ưu đãi booster luân phiên 3 ngày đầu tuần, dồn về chỉ 2 ngày cuối tuần tặng Prism Shot (11/09)

**Feedback:** "bỏ việc 3 ngày đầu hàng tuần tặng prism [...] 5 ngày đầu tuần sẽ bình thường, chỉ có 2
ngày cuối tuần là tặng prism".

**`app/game/economy.ts`:** `DAILY_LOGIN_BOOSTER_PERK` đổi từ `{0: radiusOvercharge, 1: prismShot, 2:
chainSort}` (T2/T3/T4, luân phiên 3 loại booster) sang `{5: prismShot, 6: prismShot}` (T7/Chủ Nhật,
cùng một loại — Prism Shot). Số vàng T2-CN giữ nguyên như bản #169 (10/12/15/18/20/30/40) — chỉ bỏ
phần "ưu đãi" ở 3 ngày đầu tuần, không đổi số vàng nào.

**`app/SandGame.tsx` + `app/globals.css`:** bỏ hẳn tier "great value" (Thứ Hai-Thứ Tư) — không còn tag
"Hời", không còn lớp `.is-value` riêng. Giờ chỉ còn MỘT tier đặc biệt: cuối tuần (`.is-weekend`, vẫn
tag "WEEKEND" + tag "+1 Prism Shot"). T2-T6 render như ô thường, không tag, không styling khác biệt.
Tiện thể sửa luôn thứ tự cascade CSS: `.is-weekend` giờ khai báo TRƯỚC `.is-today` (trước đây ngược
lại — một ô vừa là cuối tuần vừa là "hôm nay" sẽ bị nền vàng cuối tuần đè mất màu nhấn "hôm nay", do
`.is-weekend` khai báo sau thắng cascade; đổi thứ tự để `.is-today` luôn thắng, đúng ý đồ thiết kế gốc
dù bug này không phải do yêu cầu lần này gây ra).

**`app/i18n.ts`:** bỏ key `greatValue` (không còn dùng ở đâu).

**Test (`tests/sand-economy.test.ts`):** cập nhật kỳ vọng `DAILY_LOGIN_BOOSTER_PERK` còn đúng 2 khoá
(5, 6), cùng giá trị `"prismShot"`; viết lại test boosterPerk để phủ đủ Thứ Hai/Thứ Sáu (null) và Thứ
Bảy/Chủ Nhật (`"prismShot"`) thay vì chỉ Thứ Hai/Thứ Bảy như trước. 162/162 pass. `tsc --noEmit` sạch
(3 lỗi cloudflare cũ, không liên quan).

**Docs cập nhật:** `docs/features/economy-and-wallet.md`, `GDD.md` §10.6, comment trong
`public/design/economy.csv`.

## 172. Daily Login: lưới 5 ô/hàng, bỏ header thứ, ô to hơn, chỉ đánh số ngày (11/09)

**Feedback:** "Mỗi hàng sẽ có 5 ô. Không đánh mon -> sun, chỉ đánh dấu ngày. Phóng to ô ra, người chơi
có thể swipe xuống để xem phần thưởng những ngày".

**`app/game/economy.ts` — `buildMonthCells`/`getDailyLoginCalendar`:** trước đây pad thêm ngày đầu/cuối
của tháng lân cận để lưới luôn là bội số của 7 (thẳng hàng Thứ Hai→Chủ Nhật theo cột). Giờ layout
không còn 7 cột nữa nên không cần thẳng hàng thứ — bỏ hẳn phần đệm, hàm chỉ còn lặp `day = 1..
daysInMonth` của đúng tháng đang xem, trả về ĐÚNG số ô = số ngày trong tháng, ngày 1 luôn ở ô đầu
tiên. Bỏ luôn field `isCurrentMonth` khỏi `DailyLoginCalendarCell` — không còn ô đệm nên field này
luôn `true`, hết ý nghĩa. `weekday` vẫn giữ (chỉ để tra `reward`/`boosterPerk`, không render ra UI).

**`app/SandGame.tsx` + `app/globals.css`:** bỏ hẳn `.daily-login-weekday-row` (header Thứ Hai→Chủ
Nhật) — không còn render dòng thứ nào nữa, mỗi ô chỉ còn số ngày trong tháng (`dayOfMonth`) ở góc.
`.daily-login-calendar`: `grid-template-columns` đổi từ `repeat(7, 1fr)` sang `repeat(5, 1fr)` — cùng
bề ngang card, 5 cột thay vì 7 khiến mỗi ô to hơn hẳn ("phóng to ô"), kéo theo tăng font/icon bên
trong (ngày 8→10px, số vàng 10→13px, icon xu 12→16px, tag 5→6.5px, dấu ✓ 15→19px) cho cân đối với ô
lớn hơn. `.daily-login-calendar-scroll`: `max-height` chỉnh 254px→190px, vừa đủ hé lộ một phần hàng
kế tiếp bị cắt — gợi ý rõ ràng còn nội dung bên dưới, mời người chơi **kéo xuống (swipe)** thay vì
tưởng lưới đã hết. Tiêu đề tháng giờ suy ra từ `date` của ô đầu tiên (luôn là ngày 1, do không còn ô
đệm) thay vì tìm ô `isCurrentMonth` (field đã bỏ).

**`app/i18n.ts`:** bỏ key `weekdayShort` (không còn dùng ở đâu, cùng loại dọn dẹp như `greatValue` ở
bản #171).

**Test (`tests/sand-economy.test.ts`):** viết lại test `getDailyLoginCalendar` — kỳ vọng đúng
`daysInMonth` ô (31 cho tháng 8/2026), không còn kỳ vọng bội số 7 hay "hàng đầu bắt đầu Thứ Hai".
162/162 pass. `tsc --noEmit` sạch (3 lỗi cloudflare cũ, không liên quan).

**Verify trực tiếp trên dev server:** lưới hiện đúng 5 cột, chỉ số ngày (1, 2, 3...), không có header
thứ; cuộn xuống thấy hết 30 ngày tháng 9, các ngày cuối tuần (19, 20, 26, 27 — Thứ Bảy/Chủ Nhật) vẫn
đúng tag WEEKEND + "+1 Prism S...".

**Docs cập nhật:** `docs/features/economy-and-wallet.md` (mục "Giao diện" viết lại toàn bộ cho khớp
layout 5 cột + không header thứ).

## 173. Daily Login: nền ô đổi sang màu kem thay vì nâu tối (11/09)

**Feedback:** "Tôi muốn nền các ô có màu nền kem".

**`app/globals.css`:** `.daily-login-cell` background đổi từ nâu tối `#2b2418` sang `var(--locked)`
(kem — cùng tông với card/UI còn lại của game). Đi kèm đổi màu chữ cho tương phản: số ngày
(`.daily-login-cell-day`) từ `#a99a86` sang `var(--muted)`, số vàng (`.daily-login-cell strong`) từ
`#f5ead9` sang `var(--ink)`. Ô cuối tuần (`.is-weekend`) đổi nền từ nâu tối `#5c3c12` sang
`var(--gold)`, chữ số vàng đổi sang `var(--gold-ink)` cho tương phản. Tag góc ô (`.daily-login-cell-tag`,
dùng cho tag "WEEKEND") đổi từ chữ màu trần sang một pill nền `var(--danger)`/chữ `var(--danger-ink)`
— chữ màu trần từng đủ tương phản trên nền tối, nhưng trên nền kem/gold sáng thì không, nên cần nền
riêng cho tag mới đọc được. Panel bọc ngoài (`.daily-login-calendar-scroll`, khoảng cách `gap` giữa
ô) vẫn giữ nền tối `#100c08` như bản #170/#172 — đây là phần tạo ra đường kẻ lưới đen giữa các ô kem,
kết hợp đúng cả hai yêu cầu "grid đen" (bản #170) và "ô kem" (bản này) cùng lúc.

**Test:** không đổi logic, chỉ CSS — 162/162 pass, `tsc --noEmit` sạch. Verify trực tiếp trên dev
server: ô thường nền kem chữ nâu đậm dễ đọc, ô cuối tuần nền vàng gold với tag "WEEKEND" hồng pill rõ
ràng, ô "hôm nay" vẫn nền xanh accent nổi bật giữa các ô kem xung quanh.

**Docs:** không cần sửa `docs/features/economy-and-wallet.md` thêm — mục "Giao diện" ở đó đã mô tả ở
mức khái quát (không liệt kê mã màu cụ thể), vẫn đúng sau thay đổi này.

## 174. Daily Login: bỏ nhãn chữ "WEEKEND", đổi ưu đãi booster từ text sang icon (11/09)

**Feedback:** "không nên để quá nhiều text, nên để biểu tượng với icon booster. Không cần để weekend
luôn".

**`app/SandGame.tsx`:**
- Bỏ hẳn tag chữ "WEEKEND"/"Cuối tuần" khỏi mỗi ô cuối tuần — nền vàng gold (`is-weekend`) đã đủ để
  phân biệt tier, không cần nhãn chữ lặp lại ý đó nữa.
- Đổi phần ưu đãi booster từ text ("+1 Prism Shot") sang **icon booster thật** — dùng lại đúng
  component `BoosterIcon` (component đã có sẵn, cùng icon Shop/HUD dùng cho từng loại booster) thay vì
  chữ, đặt trong một badge tròn nhỏ ở góc dưới-phải ô. Giữ `aria-label`/`title` (nội dung y hệt text cũ
  "+1 <tên booster>") để không mất thông tin cho screen reader/hover, chỉ bớt chữ hiển thị mặc định.

**`app/globals.css`:** thay `.daily-login-cell-tag` (pill chữ) và `.daily-login-perk-tag` (text) bằng
một class duy nhất `.daily-login-perk-icon` — badge tròn 15px, nền trắng mờ `rgba(255,255,255,.65)`
làm nền cho icon 10px nổi rõ trên nền vàng/kem của ô. Đặt ở góc dưới-phải (không phải giữa) để không
đè lên số vàng — bản đầu tiên đặt giữa-dưới ô đã bị đè lên số, phải sửa lại sau khi xem trên browser.

**`app/i18n.ts`:** bỏ key `weekendBonus` (không còn dùng ở đâu — nhãn "WEEKEND"/"Cuối tuần" đã bỏ).
`dailyLoginPerkTag` vẫn giữ, giờ chỉ dùng cho `aria-label`/`title`, không còn hiển thị trực tiếp.

**Test:** không đổi logic (`DailyLoginCalendarCell`/`DAILY_LOGIN_BOOSTER_PERK` không đổi), chỉ UI —
162/162 pass, `tsc --noEmit` sạch. Verify trực tiếp trên dev server: ô cuối tuần chỉ còn nền vàng +
icon booster nhỏ góc dưới-phải, không còn text nào ngoài số ngày và số vàng.

## 175. Zen Mode: tab Modes có nội dung thật — level không giới hạn đạn/booster, có editor riêng (11/09)

**Yêu cầu:** "Ở phần mode, tạo 2 nút zen mode và theme mode" — sau khi hỏi rõ phạm vi: Zen Mode là các
màn đặc biệt không giới hạn lượt bắn/booster, có công cụ editor riêng để tạo; Theme Mode (chọn chủ đề
như Nhật Bản/Việt Nam để sort) để placeholder lần này vì cần nội dung thật, không phải việc đổi code.

**Bối cảnh:** tab "Modes" (bottom nav, trước đây tên "Customize") đã tồn tại sẵn từ lâu nhưng luôn
hiện "Not built yet." — không phải HUD mới, chỉ là điền nội dung vào chỗ trống có sẵn.

### 1) Data model — `LevelDraft.mode` (`app/game/level-drafts.ts`)

Thêm field mới `mode?: "zen"` (absent = draft thường, không đổi hành vi cũ). `draftToLevel(draft, id)`
— khi `draft.mode === "zen"` — ép `shotLimit: Infinity` và `forcedBoosterCharges` thành `Infinity` cho
cả 3 booster, BỎ QUA hoàn toàn số `shotLimit`/`forcedBoosterCharges` mà draft tự mang theo. Đây không
phải cơ chế "không giới hạn" mới: `Infinity` cho `shotLimit` và `forcedBoosterCharges` đã là hai giá
trị được engine hỗ trợ sẵn từ trước (`sand-rules.ts`'s `withResult`/`ammoRemaining`,
`SandCannonEngine`'s booster override) — Zen Mode chỉ luôn dùng lại đúng hai giá trị đó, không thêm gì
vào engine.

### 2) Nội dung khởi điểm — `design/levels/zen-levels.ts` (file mới)

`BUILT_IN_ZEN_LEVELS`: 3 tranh mượn lại từ danh sách chính (level 3/10/21 gốc), qua `toZenLevel()` —
đổi id sang khoảng `ZEN_ID_BASE = 100_000` (không bao giờ trùng id danh sách chính), ép không giới
hạn, đổi tên thêm hậu tố `" (Zen)"`, và **tước sạch mọi field FTUE/tutorial** (`tutorial`,
`ftueGesture`, 3 cặp `ftue*Demo`/`*Targets`, `forcedOpeningQueue`, `hideBoosterHud`,
`requiresBooster`) — nếu không tước, một tranh mượn từ level từng có FTUE (vd level 3 dạy booster) sẽ
vô tình bật lại overlay hướng dẫn ngay giữa Zen Mode.

### 3) HUD — `app/SandGame.tsx`, `app/globals.css`

- `collectZenPlayables()` (mới, cạnh `collectPlayables()` hiện có): gom `BUILT_IN_ZEN_LEVELS` + draft
  `mode: "zen"` hợp lệ. `collectPlayables()` (danh sách chính) được thêm bộ lọc loại trừ
  `draft.mode === "zen"` — trước bản này, một draft Zen sẽ vô tình lẫn vào cả hai danh sách.
- `zenPlayables` đọc qua `useSyncExternalStore` với `SERVER_ZEN_PLAYABLES` làm snapshot server — cùng
  pattern hydration-safe `boot`/`playables` chính đã dùng, tránh lặp lại đúng bug hydration mismatch
  đã gặp và sửa ở Daily Login (#170).
- Tab Modes: 2 thẻ **Zen Mode** (bấm mở danh sách level Zen, layout như Gallery, luôn mở khoá — Zen
  không có progression) và **Theme Mode** (khoá, `disabled`, vẫn dòng "Not built yet." cũ).
- State mới: `playingZen` (đang ở ngữ cảnh Zen — quyết định `raw`/`level` đọc từ `zenPlayables` hay
  `playables`), `zenLevelIndex`, `zenPickerOpen` (tab Modes đang hiện 2 thẻ hay danh sách level).
  `openZenLevel(index)` — chọn 1 level Zen là CHƠI LUÔN (không qua bước preview trên Home như Gallery
  danh sách chính).
- **Bug tự phát hiện khi test:** `.modes-screen` (như Gallery/Shop/Skin) trước giờ chỉ gate theo `tab`,
  dựa trên bất biến ngầm "Play chỉ bấm được từ tab Home nên `playing` và `tab !== "home"` không bao
  giờ cùng true" — `openZenLevel` phá bất biến đó (bắt đầu chơi ngay từ tab "modes"). Thêm `!playing`
  vào điều kiện render `.modes-screen` để sửa (không màn nào khác bị ảnh hưởng, vì bất biến cũ vẫn
  đúng với mọi luồng khác).
- WIN handler: toàn bộ nhánh kinh tế (`recordLevelPlayed`, `markLevelCleared`, `addGold`, mở khoá
  skin) bọc trong `if (!playingZen)` — Zen Mode không trả vàng, không cộng Reward Track, không tính
  first-clear. Card WIN vẫn hiện nhưng dòng vàng đổi thành câu ngắn (`s.zenCleared`) thay vì
  `goldEarned(0)` (tránh đọc như bị thiếu hụt). `hasNextLevel` ép `false` khi `playingZen` — Zen không
  có "Continue sang level kế", chỉ có nút đóng quay lại danh sách. `goHome` khi `playingZen` trả về
  tab "modes" (danh sách Zen) thay vì Home thường. Bấm bất kỳ tab nào khác ngoài "modes" reset cả
  `playingZen`/`zenPickerOpen` (chỗ `onClick` chung của `hub-nav`) — chặn trường hợp state Zen còn sót
  lại làm lệch level đang chơi khi quay về danh sách chính.

### 4) Level editor — `app/LevelEditor.tsx`

Checkbox mới **"🧘 Zen Mode level"** ngay dưới ô Name. Bật lên: ô `Shots` bị `disabled` + đổi nhãn
"(ignored — Zen is unlimited)"; danh sách level bên trái hiện "unlimited shots" thay vì số; nút "Test
in game" (chỉ hoạt động với danh sách chính qua `?level=` — xem mục docs bên dưới) đổi thành dòng chữ
hướng dẫn "Saved automatically. Play it in-game: Modes → Zen Mode." thay vì một link sẽ dẫn sai chỗ.
"Duplicate" giữ nguyên cờ `mode` của bản gốc.

**Test:** thêm 3 test trong `tests/level-editor.test.ts` (`draftToLevel` ép đúng `Infinity` cho draft
Zen, giữ nguyên số cho draft thường, draft mới mặc định không có `mode`). 165/165 pass (162 cũ + 3
mới). `tsc --noEmit` sạch (3 lỗi cloudflare cũ, không liên quan).

**Verify trực tiếp trên dev server:** Modes → Zen Mode → chọn "Level 3 (Zen)" → HUD hiện đúng ∞ cho cả
3 booster + đạn; bấm Home (trong Settings) quay đúng về danh sách Zen chứ không phải Home thường; bấm
tab Home ở bottom-nav quay về Home thường đúng "Level 1", Play vẫn chạy bình thường (không regression).
Editor: tick checkbox → ô Shots disable đúng, sidebar list đổi "unlimited shots" đúng.

**Docs:** [docs/features/zen-mode.md](docs/features/zen-mode.md) (mới, mô tả đầy đủ cơ chế + state),
[docs/features/level-editor.md](docs/features/level-editor.md) (thêm dòng checkbox), `GDD.md` §16.5
(mới, Zen Mode đã ship / Theme Mode còn placeholder), `docs/README.md` (thêm vào bảng chỉ mục).

## 176. Zen level editor: import ảnh chính xác màu tối đa, cọ vẽ đổi sang color picker tự do (11/09)

**Yêu cầu:** "Khi import image của zen level editor, tool sẽ ráng lấy màu chính xác nhất từ ảnh. Bây
giờ không còn bảng màu nữa mà color picker rồi tô ở zen mode level editor thôi." Đã hỏi lại phạm vi
trước khi làm: người dùng muốn RGB tự do hoàn toàn cho import ảnh, nhưng cọ vẽ tay vẫn snap về 1
trong 24 màu `SandColor` có sẵn. Sau khi cân nhắc, đã giải thích và chọn phương án khả thi: **vẫn 24
màu `SandColor`** (RGB tự do sẽ phá vỡ luật ghép "body cùng màu"/bánh xe đạn hữu hạn — một ảnh thật
có hàng nghìn sắc độ gần giống nhau, mỗi pixel giữ đúng màu gốc sẽ biến gần như mọi pixel thành 1 body
riêng lẻ, không bắn dọn được nữa), nhưng bỏ hẳn bước RÚT GỌN thêm màu (khớp mỗi pixel với màu
`SandColor` gần nhất trong TOÀN BỘ 24 màu, không gộp xuống ít màu hơn nữa) — đây là độ chính xác cao
nhất hệ thống hiện tại cho phép mà không phá luật chơi.

**`app/LevelEditor.tsx` — chỉ áp dụng khi `draft.mode === "zen"`:**

- **Import ảnh:** `importImageFile` giờ luôn truyền `maxColors = SAND_COLORS.length` (bỏ qua state
  `importMaxColors`) cho draft Zen — trước đây field "Max colours" (mặc định = tổng số màu, nhưng
  người dùng có thể chỉnh xuống thấp hơn) luôn có khả năng gộp bớt màu; giờ với Zen thì không bao giờ
  gộp nữa. UI: field "Max colours" (input số + nhãn) đổi thành dòng chữ tĩnh "🧘 Full colour accuracy"
  cho draft Zen, tránh một control không còn tác dụng gì.
- **Cọ vẽ tay:** bảng 24 swatch màu (`.editor-swatches` cũ) đổi thành 1 `<input type="color">` (color
  picker tự do của trình duyệt) + 1 ô xem trước cạnh bên — chọn màu bất kỳ trên picker, `onChange`
  parse RGB rồi gọi `nearestSandColor(r,g,b)` (hàm khớp màu gần nhất, y hệt hàm import ảnh đã dùng)
  để ra màu `SandColor` thật sự sẽ vẽ, cập nhật `color` state. Ô xem trước luôn hiện ĐÚNG màu đã snap
  (không phải màu vừa chọn trên picker) để tác giả biết chính xác cái sắp được vẽ. Editor thường
  (không phải Zen) giữ nguyên bảng 24 swatch cũ, không đổi gì.

**CSS mới (`app/globals.css`):** `.editor-zen-picker`, `.editor-zen-color-input` (style lại
`<input type="color">` cho khớp kích thước `.editor-swatch` cũ), `.editor-zen-picker-preview`.

**Test:** không đổi logic thuần (`nearestSandColor`/`imageToRows` không đổi chữ ký hay hành vi cho
editor thường) — chỉ thêm nhánh UI/tham số cho riêng Zen. 165/165 test cũ vẫn pass, `tsc --noEmit`
sạch (3 lỗi cloudflare cũ, không liên quan). Verify trực tiếp trên dev server: bật checkbox Zen Mode
→ bảng swatch biến mất, hiện color picker; đổi màu picker sang `#ff0055` (hồng đỏ) → cả input lẫn ô
xem trước đổi đúng sang màu `SandColor` gần nhất (`#e8433f`, đỏ).

**Docs cập nhật:** `docs/features/zen-mode.md` (mục mới "Import ảnh + tô tay trong editor", giải
thích rõ lý do kỹ thuật không dùng RGB tự do), `docs/features/level-editor.md` (thêm 1 câu vào dòng
Zen Mode).

## 177. Nút Back cho Zen/Theme Mode, thêm currency Hearts (lượt chơi có giới hạn, mở khoá level 10) (11/09)

**Yêu cầu:** "Đã thêm nút backicon, bây giờ sẽ có thể quay lại từ zen/theme mode" + "Thêm currency
heart, heart bây giờ tính là 1 lượt chơi của người chơi. Heart sẽ mở khóa khi người chơi hoàn thành
level 10. Tổng cộng max 5 heart (...). Thời gian hồi 1 heart là 30 phút (...) heart curency UI sẽ đặt
ngang với coin, blue emerald". Hai asset mới (`public/icons/backIcon.png`, `public/icons/HeartIcon.png`)
đã có sẵn trong repo trước khi bắt đầu — dùng thẳng, không tự vẽ icon mới.

### 1) Nút Back cho màn Modes

Trước đây màn Modes (2 thẻ Zen/Theme, và danh sách level Zen bên trong) không có nút back riêng —
chỉ rời được bằng cách bấm tab khác ở `.hub-nav`, giống Gallery/Shop/Skin. Giờ thêm MỘT nút Back cố
định ở góc trên-trái màn Modes (dùng `BackIcon`, component mới trong `SandGame.tsx`, artwork
`backIcon.png`), lùi đúng một cấp mỗi lần bấm: danh sách Zen → 2 thẻ chọn chế độ → Home. `.modes-back-btn`
CSS viết lại hoàn toàn (trước dùng tạm `CancelIcon`/dấu X mượn style `.result-close-btn`).

**Bug tự phát hiện khi verify trên browser:** `.modes-heading` là flex-child co theo nội dung (không
có `width`/`align-self` rõ ràng) — nút Back `position:absolute;left:0` bên trong nó vì vậy bám sát
mép chữ "Modes" thay vì mép trái thật của màn hình, đè lên chữ "Mo" (chỉ còn thấy "des"). Sửa bằng
`align-self: stretch` trên `.modes-heading` để nó thật sự chiếm hết bề ngang màn hình.

### 2) Currency Hearts — lượt chơi có giới hạn

**`app/game/economy.ts` — section mới "hearts (lives)":**
- `HEARTS_UNLOCK_LEVEL_ID = 10`, `MAX_HEARTS = 5`, `HEART_REGEN_MINUTES = 30`.
- `isHeartsUnlocked()` = `hasClearedLevel(10)` — trước khi qua level 10, hearts coi như không tồn
  tại: không hiện HUD, Play không tốn gì cả (giống cách booster có 1 viên miễn phí trước khi thành
  currency thật — hearts thì ngược lại, "chưa mở khoá là chưa có luật này").
- `computeHeartsState(record, now)` — hàm thuần (cùng kiểu `computeDailyLoginState`): lưu
  `{ hearts, regenStartedAt }`, mỗi `HEART_REGEN_MS` trôi qua kể từ `regenStartedAt` là +1 tim (tối
  đa `MAX_HEARTS`), phần dư là mili-giây còn lại tới tim kế tiếp. `spendHeart(now)` chốt record về
  đúng trạng thái hiện tại (gọi `computeHeartsState` trước) rồi mới trừ, nên trừ đúng lúc tim vừa hồi
  xong vẫn ra kết quả đúng — không cần một job nền chạy định kỳ để "hồi" tim, mọi thứ tính lại từ
  timestamp mỗi lần đọc.
- "Tốn 1 tim = 1 lượt chơi": chỉ tại 3 nơi — nút Play (Home), "Play again" (card FAIL), Restart
  (Settings lúc đang chơi) — mỗi nơi gọi `tryStartAttempt()` (hàm mới trong `SandGame.tsx`) trước khi
  thực sự `startPlaying()`/`restart()`, chặn (toast đếm ngược) nếu hết tim. KHÔNG tốn tim ở: Continue
  sang level kế sau khi thắng (đang chơi liên tục, không phải lượt mới), 3 chỗ `restart()` do FTUE tự
  gọi (demo hướng dẫn tự động, không phải người chơi chủ động), và toàn bộ Zen Mode (thiết kế vốn
  không giới hạn — `tryStartAttempt` no-op khi `playingZen`).
- Unlock giữa phiên: thắng level 10 lần đầu set `heartsUnlockedOverride` (state React) ngay lập tức,
  HUD hiện chip tim NGAY trong phiên đó — không cần reload trang.

**HUD (`app/SandGame.tsx`, `app/globals.css`):** chip tim thêm vào `.hub-currency-row`, cùng hàng
coin/Blue Emerald đúng như yêu cầu. Số tim hiện tại là badge nhỏ đè lên icon (`.hub-heart-count`),
KHÔNG phải số trong pill như coin/emerald — pill riêng (`.hub-heart-badge`, chỉ render khi thiếu tim)
hiện đếm ngược `m:ss` (`formatHeartCountdown`, hàm mới) tới tim kế tiếp, tự cập nhật mỗi giây qua
`setInterval` trong `useEffect`.

**Bẫy hydration đã tránh (bài học lặp lại từ Daily Login #170):** `isHeartsUnlocked()`/
`getHeartsState()` đều đọc `localStorage` — nếu gọi thẳng trong JSX/`useMemo` lúc render sẽ lệch giữa
SSR (luôn thấy "chưa unlock", "tank đầy") và lần render đầu phía client (đọc được storage thật ngay
lập tức). Sửa bằng đúng 2 pattern đã áp dụng: `heartsUnlocked` đi qua `useSyncExternalStore` với
snapshot server cố định `false`; giá trị tim/đếm ngược khởi tạo bằng `SERVER_HEARTS` (tank đầy) và
CHỈ được tính lại bên trong một `useEffect` (không bao giờ chạy lúc SSR/hydrate), không phải một
`useMemo` đọc storage trực tiếp mỗi render.

**Test:** thêm 8 test thuần cho `computeHeartsState` trong `tests/sand-economy.test.ts` (tank đầy bỏ
qua `regenStartedAt` cũ, không trôi thời gian, đúng 1 khoảng hồi, giữa khoảng, hồi bù rất lâu vẫn
cap ở `MAX_HEARTS`, 0 tim vẫn đếm ngược đúng). 172/172 pass (165 cũ + 3 test Zen editor trước đó của
phiên này + đợt này). `tsc --noEmit` sạch (3 lỗi cloudflare cũ).

**Verify trực tiếp trên dev server:** unlock qua nút dev "Unlock all maps", chip tim hiện đúng 5/5;
bấm Play trừ đúng còn 4, hiện "+1 in 29:43" đếm ngược thật (kiểm tra lại sau vài giây thấy giảm);
dùng nút dev "-1 heart" dồn về 0, bấm Play bị chặn đúng, toast "Out of hearts — next one in 25:48"
hiện rõ, không vào được màn chơi; nút Back ở Modes lùi đúng cấp cả hai chiều (danh sách Zen ↔ 2 thẻ
↔ Home).

**Docs cập nhật:** `docs/features/economy-and-wallet.md` (mục mới "Hearts (lượt chơi)"), `GDD.md`
§16.5 (thêm đoạn nút Back) và §16.6 mới (Hearts, tóm tắt + link).

## 178. Heart HUD: icon đè lên tray đồng nhất coin/emerald; thu nhỏ icon trong GameDevOption (11/09)

**Feedback:** "tôi muốn UI heart phải đồng nhất với 2 UI kia, phải là cái Icon đè lên cái tray. Ngoài
ra trong game dev option, thu nhỏ lại icon" — kèm ảnh chụp cho thấy heart cũ tách rời (icon + badge số
+ 1 pill đếm ngược nổi riêng), không cùng silhouette với coin/emerald (icon đè lên đúng 1 tray/pill).

**`app/SandGame.tsx`:** viết lại JSX chip hearts — bỏ `.hub-heart-icon-wrap` (icon đứng riêng + badge
số đè góc) và pill đếm ngược tách rời, thay bằng đúng cấu trúc `.hub-gold-wrap`/`.hub-emerald-wrap` đã
có: `<HeartIcon />` đè lên MỘT pill duy nhất (`.hub-heart-badge`), số tim là `<strong>` bên trong pill
(giống coin/emerald), đếm ngược là `<small>` ngay cạnh trong CÙNG pill đó (chỉ hiện khi chưa đầy tim).

**`app/globals.css`:**
- `.hub-heart-wrap`/`.hub-heart-badge` viết lại theo đúng pattern `.hub-emerald-wrap`/`.hub-emerald-badge`
  — icon 44px đè lên pill bằng `margin-right: -36px` (y hệt kỹ thuật overlap coin/emerald dùng), pill
  nền hồng nhạt `#ffd7de`.
- Thêm rule cơ sở `.heart-icon { width:20px; height:20px; ... }` (giống `.coin-icon`/`.emerald-icon`
  đã có size mặc định nhỏ từ trước) — trước đây `HeartIcon` dùng "trần" (không wrap trong
  `.hub-heart-icon-wrap`) ở 2 nút dev "-1 heart"/"Refill hearts" thì không có rule nào ràng kích
  thước, ảnh PNG gốc hiện ra to bất thường so với icon dev khác. Rule cụ thể hơn trong `.hub-heart-wrap
  .heart-icon` (44px) vẫn thắng ở HUD nhờ specificity cao hơn — không cần đổi gì ở đó.

**Test:** không đổi logic (`computeHeartsState`/`spendHeart` không đổi) — chỉ CSS/markup. 172/172
pass, `tsc --noEmit` sạch. Verify trực tiếp trên dev server: chip hearts giờ đúng 1 khối liền — icon
đè lên pill hồng chứa cả số tim lẫn đếm ngược "+1 in 26:33", cùng silhouette hàng coin/emerald; icon
tim trong GameDevOption ("-1 heart"/"Refill hearts") đã nhỏ lại bằng cỡ icon dev khác.

## 179. Heart HUD: số lượng quay lại nằm trên icon, tray chỉ còn giữ đếm ngược (11/09)

**Feedback:** "tôi muốn số luọng icon sẽ nằm trên icon HeartIcon luôn" — sau bản #178 (đưa số lượng
vào trong tray như coin/emerald để "đồng nhất"), người dùng muốn số lượng quay lại nằm TRÊN icon
(badge), nhưng vẫn giữ nguyên hiệu ứng icon đè lên tray đã thống nhất ở #178 — hai yêu cầu kết hợp
lại: icon vẫn đè lên tray (đồng nhất silhouette coin/emerald), nhưng số lượng là badge trên icon,
tray giờ chỉ còn giữ đếm ngược.

**`app/SandGame.tsx`:** JSX chip hearts đổi lại cấu trúc 2 phần — `.hub-heart-icon-wrap` (icon +
`.hub-heart-count` badge số đè góc, y hệt bản gốc trước #178) làm phần tử đầu, `.hub-heart-badge`
(tray hồng, giờ CHỈ chứa `<small>` đếm ngược, bỏ hẳn `<strong>{count}</strong>` bên trong) làm phần
tử sau — nhưng vẫn dùng đúng kỹ thuật overlap `margin-right: -36px` trên `.hub-heart-icon-wrap` để
icon đè lên mép tray, không quay lại kiểu 2 khối tách rời không chạm nhau như bản gốc trước #178. Tray
giờ chỉ render khi CHƯA đầy tim (`hearts.msUntilNext !== null`) — đầy tim thì chỉ còn icon+badge số,
không có tray trống nào cả.

**`app/globals.css`:** khôi phục lại `.hub-heart-icon-wrap`/`.hub-heart-count` (badge tròn đè góc
dưới-phải icon, nền `var(--ink)`, viền trắng `box-shadow`) từ bản gốc, đồng thời giữ nguyên
`.hub-heart-badge` overlap-pill approach của #178 (padding-left 42px chừa chỗ icon đè lên, chỉ còn 1
dòng `<small>` đếm ngược thay vì `<strong>+<small>`).

**Test:** không đổi logic — 172/172 pass, `tsc --noEmit` sạch. Verify trực tiếp trên dev server: tank
đầy (5/5) chỉ hiện icon+badge "5", không tray; sau khi tốn 1 tim hiện đúng icon+badge "4" đè lên tray
hồng "+1 in 29:46".

## 180. Heart HUD: bỏ chữ "in"/"sau" khỏi tray đếm ngược, chỉ còn m:ss (11/09)

**Feedback:** "bỏ chữ in đi, countdown thôi".

**`app/SandGame.tsx`:** tray hearts đổi từ `s.heartRegenLabel(formatHeartCountdown(...))` (ra "+1 in
29:46"/"+1 sau 29:46") sang gọi thẳng `formatHeartCountdown(...)` — chỉ còn "29:46".

**`app/i18n.ts`:** xoá hẳn key `heartRegenLabel` (không còn nơi nào dùng) khỏi `Strings`, `EN`, `VI`.

**Test:** không đổi logic — 172/172 pass, `tsc --noEmit` sạch. Verify trực tiếp trên dev server: tray
hearts giờ chỉ hiện "24:42", không còn chữ thừa.

## 181. Shop: bỏ hẳn Gems, gộp 2 tab thành 1 màn, Bundles đổi sang Coins+Hearts+Emerald, thêm mục mua Hearts riêng, Boosters chuyển xuống cuối (11/09)

**Yêu cầu:** "cập nhật lại mục Gems trong shop. Bỏ gems luôn. Bỏ coins luôn [tab]. Không chia ra 2 tab
mà để vô thành 1 UI hết. Nhưng có điều để những thứ mua ở coins ở cuối cùng." + "Bỏ gems, thay bằng
heart, tự bạn đánh giá định lượng coins và heart ở trong bundle" + "Bundles giờ sẽ là Coins + heart +
1 ít blue emerald" + "Ngoài coins ra giờ sẽ có mục mua riêng [Hearts]".

### 1) Xoá Gems khỏi toàn bộ game, không chỉ Shop

`app/game/economy.ts`: `Wallet.gems`, `STARTER_GEMS`, `getGems()` xoá hẳn — Gems trước đó "hiển thị
số, chưa nối kiếm/tiêu/thanh toán thật" (đúng như GDD.md từng ghi), nên xoá không mất logic thật nào.
`readWallet()` vẫn đọc được ví cũ còn field `gems` dư trong `localStorage` mà không crash (JSON thêm 1
property vô hại, tự biến mất ở lần ghi tiếp theo). `app/SandGame.tsx`: xoá component `GemIcon`
(không còn nơi nào dùng). `app/globals.css`: đổi tên biến `--gem`/`--gem-deep`/`--gem-ink` thành
`--iap-accent`/`--iap-accent-deep`/`--iap-accent-ink` (vẫn giữ đúng 3 mã màu teal cũ — chỉ đổi tên
cho khỏi gây hiểu lầm là "màu của Gems" khi Gems đã không còn tồn tại), xoá `.shop-gem-badge` và mọi
selector `.gem-icon`.

### 2) Gộp 2 tab (Gems/Coins) thành 1 màn duy nhất

`shopTab` state (`"gems" | "coins"`) xoá hẳn, cùng `.shop-tabs`/`.shop-tab-btn` (segmented switch) và
`.shop-gem-badge` (số dư Gems ở góc heading). Shop giờ là MỘT `<div className="shop-panel">` cuộn dọc
duy nhất chứa tất cả section theo thứ tự cố định — không còn khái niệm "tab đang mở".

**Thứ tự section (đúng yêu cầu "để những thứ mua ở coins ở cuối cùng"):** Special Offers → Bundles →
Coins (mua trực tiếp) → Hearts (mua trực tiếp, MỚI) → **Boosters** (trước là tab "Coins" riêng, giờ
xuống cuối cùng).

### 3) Bundles/Special Offers đổi thành phần: Coins + Hearts + Blue Emerald

`SPECIAL_OFFERS`/`BUNDLES` (kiểu dữ liệu trong `SandGame.tsx`) đổi field `gems` → `hearts` +
`emeralds` (giữ nguyên `coins`). Định lượng tự quyết theo yêu cầu ("tự bạn đánh giá"):

- **Bundles** (5 mốc $0.99→$49.99): Coins giữ NGUYÊN số cũ (400 → 35.000). Hearts tăng dần 1 → 2 → 3
  → `MAX_HEARTS` → `MAX_HEARTS` (không mốc nào bán quá 5, vì bể tim không giữ được nhiều hơn). Blue
  Emerald 50 → 800 (mốc rẻ không đủ mua 1 skin — Rune Cannon 500 Emerald — mốc đắt thì đủ và dư).
- **Special Offers** (2 ưu đãi): "Islander's Starter Pack" ($4.99) — 1.200 coins + 3 hearts + 150
  emerald. "Weekend Heart Rush" ($9.99, đổi tên từ "Weekend Gem Rush") — không có coins (giữ đúng bất
  đối xứng bản gốc: ưu đãi cuối tuần không bán coins), 5 hearts (full refill) + 300 emerald + bonus
  "+35% extra".

Bundle-icon đổi từ `GemIcon` sang `CoinIcon` (coins giờ là số liệu chính/đứng đầu mỗi dòng bundle, y
hệt logic cũ nhưng đổi currency dẫn đầu). `bundle-sub` hiện cả hearts lẫn emerald cách nhau dấu `·`.

### 4) Mục mua Hearts riêng — tính năng mới

`HEART_PACKS` (kiểu dữ liệu mới, 3 mốc: 1 tim $0.99, 3 tim $1.99, 5 tim "Full refill" $2.99) + section
Shop mới "Hearts" (`s.heartsTitle`/`s.buyHeartsDirectly`), dùng lại đúng layout `.pack-grid`/`.pack-card`
Coins đã có — chỉ đổi icon (`HeartIcon` thay `CoinIcon`, thêm size override 32px cho context này).
Trần ở `MAX_HEARTS` vì mua thêm quá số đó không có chỗ chứa.

### 5) Cập nhật các shortcut phụ thuộc tab cũ

- `openCoinPacks` (nút vàng ở HUD) — bỏ `setShopTab("gems")`, giờ chỉ `setTab("shop")` +
  `scrollIntoView` tới `coinPackSectionRef` (đơn giản hơn hẳn vì không còn phải đợi tab mount).
- Hint-dot của `hub-nav` (gợi ý "quay lại mua booster") — trước đổi sang tab "Coins", giờ
  `scrollIntoView` tới `boostersSectionRef` (ref mới, gắn vào section Boosters ở cuối màn).

**Test:** không có test nào phụ thuộc `shopTab`/Gems (khu vực Shop chưa từng có test tự động — toàn
bộ là UI mock). 172/172 test hiện có vẫn pass (đảm bảo phần economy/gameplay không bị ảnh hưởng dây
chuyền). `tsc --noEmit` sạch (3 lỗi cloudflare cũ, không liên quan) — xác nhận không còn tham chiếu
nào tới `gems`/`shopTab`/`GemIcon`/`STARTER_GEMS` sót lại ở bất kỳ đâu trong `app/`.

**Verify trực tiếp trên dev server:** Shop mở ra đúng 1 màn không tab; Special Offers hiện đúng
coins+hearts+emerald (hoặc chỉ hearts+emerald cho ưu đãi cuối tuần); Bundles hiện coins làm số chính,
hearts+emerald ở dòng phụ; cuộn xuống thấy đúng thứ tự Coins → Hearts → Boosters (Boosters đúng ở
cuối); nút vàng HUD cuộn thẳng tới đúng section Coins.

**Docs cập nhật:** `docs/features/economy-and-wallet.md` (mục mới "Shop — 1 màn thống nhất, Gems đã
bỏ hẳn"), `GDD.md` §10 (bảng 3 currency, bỏ dòng Gems), §10.7 mới (toàn bộ redesign Shop), §13.1 (sơ
đồ Mermaid), §16.2/§16.4 (bỏ nhắc Gems khỏi roadmap "đã cài nhưng chưa ship").

## 182. Modes: 2 thẻ nhỏ đổi thành nút bấm hình chữ nhật bo góc, Zen Mode dùng thumbnail thật (11/09)

**Feedback:** "Dùng thumbnail zen mode có trong mục icon. Tôi muốn nó là 1 nút bấm hình chữ nhật bo
góc như này" — kèm ảnh chụp: 1 nút lớn full-width, bo góc, viền cam/vàng, phủ kín bằng ảnh
`ZenModeThumbnail.png` (tranh pixel art rừng tre thiền định, đã có sẵn trong `public/icons/`).

**`app/SandGame.tsx`:** 2 thẻ nhỏ nằm cạnh nhau (`.modes-grid`, icon emoji + tên + mô tả) đổi thành 2
nút ảnh lớn xếp chồng dọc (`.modes-stack`) — mỗi nút chiếm trọn bề ngang màn hình:
- **Zen Mode**: `<img src="/icons/ZenModeThumbnail.png">` phủ kín toàn bộ nút, tên "Zen Mode" hiện
  dạng pill mờ tối ở góc dưới-trái (đè lên ảnh, không phải text nằm dưới ảnh).
- **Theme Mode**: chưa có artwork riêng nên giữ ĐÚNG hình dạng/kích thước/viền như nút Zen Mode (để
  hai nút vẫn đọc như một cặp đồng bộ), chỉ đổi nền phẳng màu khoá + icon 🗺️ căn giữa thay vì ảnh, tên
  đổi icon 🔒 báo hiệu chưa mở khoá.

**`app/globals.css`:** `.modes-grid`/`.modes-card*` (cũ) xoá hẳn, thay bằng `.modes-stack` (flex cột,
gap 16px) + `.modes-image-btn` (nút hình chữ nhật `aspect-ratio: 4/3`, bo góc `var(--r-lg)`, viền 5px
`var(--gold-line)` — đúng viền cam/vàng trong ảnh mẫu) + `.modes-image-btn-art` (ảnh phủ kín,
`object-fit: cover`) + `.modes-image-btn-label` (pill tên đè lên ảnh) + `.modes-image-btn.is-locked`
(viền xám, mờ, cho Theme Mode).

**Test:** không đổi logic (`zenPickerOpen`/`setZenPickerOpen` giữ nguyên) — chỉ đổi JSX/CSS. 172/172
pass, `tsc --noEmit` sạch. Verify trực tiếp trên dev server: nút Zen Mode hiện đúng ảnh thumbnail bo
góc viền cam, bấm vào vẫn mở đúng danh sách level Zen như trước; nút Theme Mode hiện cùng khung hình
dạng, khoá đúng.

## 183. Sửa bug import ảnh ra màu hoàn toàn sai — đẩy bão hoà trước khi so màu (11/09)

**Bug report:** "khi tôi import hình ảnh thì nó hiện 1 màu hoàn toàn khác" — kèm 2 ảnh: import
`ZenModeThumbnail.png` (cảnh rừng tre tông xanh lá nhạt) vào Zen editor ra kết quả toàn tím/nâu/xám,
gần như không còn nét xanh nào so với ảnh gốc.

**Điều tra:** không phải bug thuật toán — viết script Node so `nearestColorAmong` bằng khoảng cách RGB
thuần VS khoảng cách CIE Lab (chính xác hơn về mặt cảm nhận màu sắc) cho vài mẫu màu lấy từ ảnh gốc
(bầu trời/núi xanh lá nhạt) — CẢ HAI công thức đều cho cùng kết quả sai (`brown`/`white`/`blue`).
Nguyên nhân thật sự: cả 24 màu `SandColor` đều là màu candy BÃO HOÀ CAO (xem `SAND_COLOR_HEX`'s
comment — "fully-saturated candy colour" theo đúng nghĩa đen), không có màu xanh lá NHẠT/xỉn nào
trong bảng — nên bất kỳ công thức đo khoảng cách nào cũng sẽ thấy 1 pixel xanh lá nhạt (bão hoà thấp)
gần với `brown`/`white`/`blue` (những màu xỉn hiếm hoi có sẵn) hơn là `grass`/`green` (bão hoà cao,
"xa" về mặt số học dù đúng tông màu).

**Cách sửa:** thêm bước ĐẨY ĐỘ BÃO HOÀ (`boostSaturation`, `app/LevelEditor.tsx`) cho pixel TRƯỚC khi
so khớp trong `nearestSandColor` — đổi RGB→HSL, nhân `S` (saturation) lên `SATURATION_BOOST = 3` lần
(giới hạn tối đa 1), đổi ngược lại RGB rồi mới so khoảng cách với 24 màu palette. Verify bằng script
Node: mẫu màu núi/lá từ ảnh gốc đổi từ `brown`/`blue` (sai) sang `grass`/`green` (đúng tông) sau khi
đẩy bão hoà factor 3-4. Chỉ áp dụng ở bước so khớp ẢNH THẬT → palette (`nearestSandColor`), KHÔNG đụng
bước gộp bớt màu khi vượt `Max colours` (`nearestColorAmong` gọi trực tiếp, so giữa các màu palette
với nhau — không liên quan tới bug vì cả hai đầu vào đã bão hoà cao sẵn).

Áp dụng cho MỌI import ảnh trong editor (không riêng Zen) — đây là bản sửa đúng hành vi chung, người
dùng bảng màu 24 màu ở bất kỳ level nào (Zen hay danh sách chính) đều được lợi.

**Test:** không có test tự động cho `nearestSandColor`/`imageToRows` (hàm nội bộ, không export khỏi
`LevelEditor.tsx`) — verify bằng script Node độc lập (so RGB/Lab distance) + verify trực tiếp trên dev
server (import lại đúng `ZenModeThumbnail.png` vào draft Zen, kết quả đổi hẳn từ tím/xám/nâu sang
xanh lá đúng tông). 172/172 test hiện có không bị ảnh hưởng, `tsc --noEmit` sạch.

**Docs cập nhật:** `docs/features/zen-mode.md` (mục mới "Bug đã sửa: import ảnh ra màu hoàn toàn
sai", giải thích rõ đây là giới hạn bảng màu chứ không phải lỗi công thức, và cách đẩy bão hoà giải
quyết).

## 184. Zen Mode: mỗi ảnh import có bảng màu HEX riêng — "100% chính xác" trong giới hạn 24 ô màu (12/09)

**Yêu cầu:** "tôi muốn màu import từ ảnh trong zen mode phải 100% chính xác" — sau khi đã sửa bug
saturation ở #183, người dùng vẫn thấy chưa đủ đúng: mọi pixel dù nhạt hay đậm cùng hướng màu vẫn bị
ép về một trong 24 hex candy CỐ ĐỊNH DÙNG CHUNG cho mọi level (`SAND_COLOR_HEX`), không phải màu thật
của chính bức ảnh đó.

**Vẫn không thể là RGB tự do tuyệt đối cho từng pixel** (đã giải thích và được người dùng đồng ý ở
lần hỏi trước khi làm editor ảnh) — luật "bắn cùng màu để dọn" và bánh xe đạn cần một số hữu hạn "ô
màu" để còn ghép body/nạp đạn được, hàng nghìn sắc độ riêng biệt sẽ biến mỗi pixel thành 1 body không
ai bắn trúng nổi. Nhưng có khoảng trống thật: 24 Ô MÀU (`SandColor` — dùng cho matching) là hữu hạn và
dùng chung, nhưng HEX MÀ MỖI Ô ĐÓ VẼ RA không bắt buộc phải giống nhau giữa các level.

**Cách làm — bảng màu (`customPalette`) riêng theo từng level:**
- `SandLevelConfig` (`app/game/sand-types.ts`) có thêm field mới, optional:
  `customPalette?: Partial<Record<SandColor, number>>` — hex ghi đè riêng cho level này, chỉ ảnh hưởng
  RENDER, không đụng gì tới matching/ammo wheel (vẫn nguyên 24 `SandColor`, `rows` vẫn nguyên chữ cái).
- `imageToRows` (`app/LevelEditor.tsx`) giờ trả về thêm `palette`: với mỗi ô `SandColor` có ít nhất 1
  pixel rơi vào, tính màu TRUNG BÌNH THẬT của đúng những pixel ảnh gốc đã rơi vào ô đó (không phải màu
  candy chia sẻ nữa).
- Import ảnh cho draft Zen lưu bảng này vào `draft.customPalette` (`LevelDraft`, `level-drafts.ts`) →
  `draftToLevel` chuyển thẳng sang `SandLevelConfig.customPalette`.
- `SandCannonEngine.ts` có hàm mới `sandColorHex(level, color)` = `level.customPalette?.[color] ??
  SAND_COLOR_HEX[color]`, thay thế toàn bộ 4 chỗ từng đọc thẳng `SAND_COLOR_HEX[...]` (tô sand khi
  build board, tint radius ring, màu crosshair, màu viên đạn bay).
- `app/SandGame.tsx`: HUD đạn đang nạp/dải đạn sắp tới/tint bầu trời (`hex`/`ammoSky`) và `PixelThumb`
  (thumbnail trong Modes) nhận thêm tham số palette, đọc `raw?.customPalette`/`level.customPalette`.
- `app/LevelEditor.tsx`'s canvas preview của chính editor cũng đọc `draft.customPalette` — tác giả
  thấy đúng màu sẽ lên game ngay lúc đang chỉnh, không cần chờ vào game mới biết.
- Chỉ set `customPalette` khi `draft.mode === "zen"` — danh sách 50 level chính không đổi gì, vẫn luôn
  vẽ bằng `SAND_COLOR_HEX` chung để giữ phong cách hình ảnh nhất quán across levels như trước giờ.

**Kết quả:** mỗi bức ảnh Zen có 24 hex RIÊNG, tinh chỉnh đúng theo màu thật của chính nó, thay vì dùng
chung 24 màu candy với mọi level khác. Mất mát duy nhất còn lại so với ảnh gốc là những pixel có màu
thật khác nhau nhưng cùng rơi vào một ô `SandColor` (bắt buộc — mechanic cần số ô hữu hạn để còn bắn
được) — không còn kiểu mất mát "đổi hẳn sang một họ màu candy khác hẳn" như trước #183, hay "cùng một
màu candy dùng chung cho mọi sắc độ" như ngay sau #183.

**Test:** thêm 2 test cho `draftToLevel` (`tests/level-editor.test.ts`) — `customPalette` của draft đi
thẳng sang level không đổi, và vẫn `undefined` khi draft chưa từng set. 174/174 test hiện có pass,
`tsc --noEmit` sạch (chỉ còn 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn từ trước).

**Verify trên dev server:** tạo draft Zen mới, import lại đúng `ZenModeThumbnail.png` — preview trong
editor, thumbnail ở Modes → Zen Mode, và màn chơi 3D thật (bao gồm cả màu viên đạn đang nạp) đều ra
đúng tông màu thật của ảnh gốc (trời xanh nhạt, núi sage, tre xanh đậm khác hẳn nhau), không còn đồng
loạt một màu `grass` candy như trước.

**Docs cập nhật:** `docs/features/zen-mode.md` (mục mới "100% chính xác: palette riêng cho từng level
Zen").

## 185. Modes: thêm icon "?" giải thích các chế độ, bỏ nút back ở màn chọn 2 thẻ (12/09)

**Yêu cầu:** "Đặt 1 icon '?' ở góc trên cùng bên phải để giải thích sơ về các mode" + "Ở sảnh chính chọn
modes, không cần để icon back".

- **Nút back:** trước đây `.modes-back-btn` luôn hiện ở cả hai trạng thái của tab Modes (màn 2 thẻ
  Zen/Theme, và danh sách level Zen). Giờ chỉ còn hiện khi đang xem danh sách level Zen (bấm về lại
  màn 2 thẻ) — màn 2 thẻ (trạng thái đầu tiên khi mở tab Modes) bỏ hẳn nút back, vì `.hub-nav`'s các
  tab khác (Home, Gallery, ...) đã là cách rời tab Modes rồi, có thêm 1 nút back làm y hệt việc đó là
  thừa. Danh sách level Zen thì vẫn cần nút riêng vì nó là 1 màn *bên trong* Modes mà không tab nào
  khác biết cách lùi ra.
- **Icon "?":** nút tròn viền, chữ "?" đặt ở góc phải `.modes-heading` (đối xứng vị trí nút back cũ,
  luôn hiện ở CẢ HAI trạng thái) — bấm vào mở 1 card overlay nhỏ (`.modes-help-screen`/
  `.modes-help-card`, cùng họ với `.settings-screen`: nền mờ + card nổi lên giữa màn hình) liệt kê
  ngắn gọn từng mode: "🧘 Zen Mode — Unlimited shots, unlimited boosters — just for the picture." và
  "🔒 Theme Mode — Not built yet." (tái dùng thẳng `s.zenModeBlurb`/`s.notBuiltYet` đã có sẵn, không
  tạo thêm câu mới trùng nghĩa). Đóng bằng nút X (`CancelIcon`, giống mọi card khác) hoặc bấm ra ngoài
  vùng card.

**Test:** không cần test tự động mới (thuần UI/JSX, không có logic tính toán) — verify trực tiếp trên
dev server: màn 2 thẻ không còn nút back, danh sách Zen vẫn có, nút "?" mở đúng nội dung ở cả hai màn
và đóng lại đúng cách. 174/174 test hiện có không bị ảnh hưởng, `tsc --noEmit` sạch.

**Lưu ý ngoài phạm vi:** test "the built-in level list is what the game and editor both start from"
(`tests/level-editor.test.ts`) đang fail — `design/levels/sand-levels.ts` đã có thêm 1 level thứ 51
("Meditation", ship từ editor) từ trước khi phiên làm việc này bắt đầu, không liên quan gì tới thay
đổi ở entry này. Chưa đụng tới vì không rõ đây có phải nội dung cố ý hay chưa.

## 186. Mở game lần đầu vào thẳng Level 1, khoá nút (X) đến hết level 3, radius Level 1 to hơn, Shop ẩn mục Heart khi chưa mở khoá (12/09)

**Yêu cầu:** "Khi người mở game ra lần đầu tiên, lập tức chơi level 1 luôn, hướng dẫn đến level 3 rồi
mới hiện nút (X) ở frame cleared" + "Cho radius level 1 to hơn nữa" + "Chỉnh sửa hành vi của shop, nếu
chưa có heart currency thì không hiện những bundle, hay shop heart trong shop".

- **Mở game lần đầu → chơi Level 1 ngay:** key mới `sand-cannon:v1:first-open-seen`
  (`hasOpenedBefore`/`markOpened`, `app/SandGame.tsx`) — `useLayoutEffect` chạy đúng 1 lần lúc mount,
  nếu key chưa từng set thì gọi thẳng `startPlaying()` (y hệt hành động tap nút Play ở Home cho Level
  1) TRƯỚC KHI trình duyệt kịp vẽ khung hình đầu tiên, nên người chơi không hề thấy màn Home lướt qua —
  vào thẳng gameplay, kèm luôn overlay hướng dẫn gesture của Level 1 (đã tồn tại sẵn, không phải logic
  mới). Mọi lần mở lại sau đó (kể cả reload) hành xử y như trước — Home + nút Play. `resetEntireGame`
  (GameDevOption) giờ xoá luôn key này để tester lặp lại được trải nghiệm "mở lần đầu".
- **Nút (X) ở card "Frame Cleared" khoá đến hết level 3:** hằng số `WIN_CLOSE_BUTTON_FROM_LEVEL_ID = 4`
  — nút ✕ (quay về Home) trên card thắng chỉ hiện khi `raw.id >= 4` (hoặc đang chơi Zen, không áp dụng
  onboarding này). Level 1-3 luôn có nút Continue để đi tiếp nên không bao giờ bị kẹt màn hình, chỉ là
  không còn đường tắt thoát ra Home giữa chừng onboarding.
- **Radius Level 1 to hơn:** `sortRadius` của `defaultLevel` (`design/levels/sand-levels.ts`) tăng từ
  `2` lên `4` — cả bức tranh chỉ 1 màu nên phát súng đầu tiên ăn một miếng lớn, rõ ràng "quyền lực"
  hơn hẳn so với trước.
- **Shop ẩn mục liên quan Heart khi chưa mở khoá:** biến `visibleOffers` lọc bỏ khỏi `SPECIAL_OFFERS`
  bất kỳ offer nào có bán hearts trong khi `!heartsUnlocked`; mục "Bundles" (mọi bundle đều bán hearts)
  và mục "Hearts — top up trực tiếp" (`HEART_PACKS`) bị ẩn hoàn toàn cho tới khi `heartsUnlocked` (clear
  xong level 10). Trước khi mở khoá, Shop chỉ còn Coins rồi tới Boosters — không còn dòng nào nhắc tới
  1 currency người chơi còn chưa từng thấy trên HUD.

**Test:** không cần test tự động mới cho 3 thay đổi này (thuần hành vi mount-effect/hằng số cấu hình/
điều kiện hiển thị JSX, không có logic tính toán mới) — verify trực tiếp trên dev server: xoá sạch
localStorage rồi tải lại → vào thẳng gameplay Level 1 kèm overlay gesture, một phát súng ăn 1 vùng lớn
đúng như radius mới; Shop lúc hearts chưa mở khoá chỉ còn Coins + Boosters, giả lập clear xong level 10
(set `cleared-levels` + `hearts` trong localStorage) thì Special Offers/Bundles/Hearts hiện lại đầy đủ.
174 test hiện có không đổi kết quả (173 pass, 1 fail — vẫn là lỗi "51 levels" đã ghi chú ở #185, không
liên quan gì tới đợt sửa này).

## 187. Tăng radius Level 2, vẫn thấp hơn Level 1 (12/09)

**Yêu cầu:** "tăng radius level 2 lên nhưng không bằng với level 1".

`sortRadius` của `secondConsequence` (Level 2, `design/levels/sand-levels.ts`) tăng từ `3` lên `3.5` —
vẫn thấp hơn Level 1's `4` (vừa tăng ở #186): Level 2 đã có 3 màu (yellow/blue/green) thay vì 1 màu
duy nhất như Level 1 nên hợp lý giữ độ khoan dung của radius thấp hơn một chút.

## 188. Shop: ẩn Chain Sort cho tới khi mở khoá level 3 (12/09)

**Yêu cầu:** "phải kèm theo tutorial sử dụng booster luôn chứ?" + "Và ko hiển thị booster chain cho
tới level 3".

- **Tutorial dùng booster:** đã có sẵn — `SandLevelConfig.ftueBoosterDemo` trên Level 3 (dạy Radius
  Overcharge + Prism Shot bằng scripted intro/demo/outro) chạy đúng bên trong khoảng onboarding vừa
  khoá nút ✕ ở #186 (level 1-3), nên tới khi nút ✕ mở lại ở level 4, người chơi chắc chắn đã được dạy
  cách bấm 1 trong 2 booster này rồi — không cần thêm gì.
- **Ẩn Chain Sort tới level 3:** mục Boosters trong Shop trước đây liệt kê cả 3 booster (Radius
  Overcharge, Prism Shot, Chain Sort) ngay từ đầu game — kể cả khi người chơi còn chưa biết hệ thống
  booster tồn tại. Giờ Chain Sort bị lọc khỏi lưới cho tới khi `hasClearedLevel(2)` (đã dọn xong level
  2, tức level 3 đã mở khoá) — Radius Overcharge/Prism Shot vẫn hiện từ đầu như cũ (tutorial của chính
  chúng LÀ level 3, Shop vốn đã bán trước đó, không đổi phần này). Booster tray trong lúc chơi
  (`.booster-hud`) không đổi gì — nó vốn đã ẩn hết tới level 3 rồi hiện đủ cả 3 cùng lúc.

**Test:** không cần test tự động mới (điều kiện lọc JSX thuần, tái dùng `hasClearedLevel` đã có sẵn) —
verify trên dev server: ví vàng 10,000 + chưa clear level nào → Shop chỉ còn Radius Overcharge/Prism
Shot; giả lập clear xong level 1-2 (`cleared-levels`) → Chain Sort hiện lại đầy đủ. `tsc --noEmit` sạch,
174 test hiện có không đổi (173 pass, 1 fail — vẫn là lỗi "51 levels" không liên quan, đã ghi ở #185).

## 189. Sửa bug: tutorial booster level 3 không hiện khi vào bằng nút Continue (12/09)

**Báo lỗi:** "khi tới level 3, tôi ko thấy hướng dẫn sử dụng booster?"

**Nguyên nhân:** `SandLevelConfig.ftueBoosterDemo` của Level 3 vẫn còn nguyên — nhưng toàn bộ logic
kiểm tra "level này có FTUE chưa xem cần bật lên không" (tutorial, ftueGesture, ftueFreezeDemo,
ftueBoosterDemo, ftueChainSortDemo) chỉ từng nằm trong `startPlaying()`, hàm gắn RIÊNG với nút Play ở
Home. Nút **Continue** trên card "Frame Cleared" (đường đi thật sự của hầu hết người chơi giữa các
level) lại gọi thẳng `openLevel(levelIndex + 1)` — chỉ đổi bảng cát đang chơi, chưa bao giờ chạy qua
bất kỳ kiểm tra FTUE nào. Kết quả: tutorial booster (và freeze/chain sort FTUE của các level khác) chỉ
từng hiện nếu người chơi thoát ra Home rồi bấm Play lại đúng level đó — không hiện khi đi tiếp bằng
Continue, tức gần như không bao giờ hiện trong lối chơi bình thường.

**Cách sửa:** tách phần thân của `startPlaying()` (mọi kiểm tra FTUE) ra hàm riêng
`triggerLevelFtue(lvl: SandLevelConfig)`, nhận thẳng level SẮP mở thay vì đọc biến `level` của lần
render hiện tại (biến đó tại thời điểm bấm Continue vẫn là level VỪA thắng, chưa phải level sắp vào).
Gọi hàm này ở 3 chỗ:
- `startPlaying()` — như cũ, cho Home's Play tap.
- Nút Continue's `onClick` — thêm `triggerLevelFtue(expandLevelForPixelBoard(playables[levelIndex + 1].level))` ngay sau `openLevel(levelIndex + 1)`.
- `dismissCannonUnlock` — đường Continue "phụ" khi vừa mở khoá skin mới (giữ Continue lại 1 nhịp cho
  màn ăn mừng cannon), cũng gọi `triggerLevelFtue` cho level `cannonUnlockAdvanceTo` trỏ tới.

`jumpToLevel` (GameDevOption) giữ nguyên logic riêng — nó vốn đã tự chạy đúng các kiểm tra này.

**Test:** `tsc --noEmit` sạch, 174 test hiện có không đổi (173 pass, 1 fail — vẫn là lỗi "51 levels"
không liên quan, đã ghi từ #185). Verify sống trên dev server bị hạn chế bởi việc mô phỏng thao tác
"kéo-thả để bắn" qua trình duyệt tự động không ổn định với bảng Level 2 (bắn trúng bảng Level 1 thì dễ,
Level 2 to hơn thì súng bắn trượt liên tục dù đúng toạ độ) — không dựng được cảnh thắng Level 2 rồi bấm
Continue để tận mắt xem overlay hiện ra. Đã xác nhận đúng bằng cách đọc lại code + `tsc`/test suite:
`triggerLevelFtue` là đúng y nguyên thân hàm cũ của `startPlaying` (đã chạy đúng từ trước qua đường
Play), chỉ đổi biến `level` (đóng theo render cũ) thành tham số `lvl` (level sắp mở) — không có logic
mới nào chưa được kiểm chứng. Nên nhờ người chơi xác nhận lại trực tiếp trong app.

## 190. Ẩn Chain Sort trong lúc tutorial Radius/Prism, ẩn nút Settings suốt level 1-3 (12/09)

**Yêu cầu:** "khi đang trong tut giới thiệu 2 booster radius và prism, thì hãy ẩn booster chain đi" +
"Cùng lúc nút setting cũng ẩn đi sau khi người chơi hoàn thành level 3" (đã hỏi lại: chọn phạm vi "ẩn
suốt cả level 1-3, hiện lại từ level 4").

- **Ẩn Chain Sort trong lúc tutorial:** `.booster-hud` (`app/SandGame.tsx`) lọc bỏ `chainSort` khỏi
  danh sách nút khi `boosterFtueStep !== null` (đang ở bất kỳ bước nào của tutorial — intro-radius,
  demo-radius, intro-prism, demo-prism, outro). Charges kịch bản của tutorial (`forcedBoosterCharges`)
  vốn không có Chain Sort nên nút đó chưa từng làm được gì trong lúc này — ẩn đi tránh 1 nút thừa gây
  phân tâm giữa bài học. Hiện lại ngay khi bước "outro" đóng.
- **Ẩn nút Settings suốt level 1-3:** `.settings-wrap` (nút bánh răng góc trên phải) giờ thêm điều kiện
  `!playing || raw.id > WIN_CLOSE_BUTTON_FROM_LEVEL_ID` (hằng số `= 4` đã có từ #186) — chỉ ẩn khi
  ĐANG CHƠI (`playing`) một trong 3 level onboarding, mọi tab khác (Home, Shop, Gallery, Skin, Modes)
  không đổi gì, luôn thấy nút Settings như trước. Cùng logic khoá với nút ✕ ở card "Frame Cleared" —
  không có gì để thoát ra giữa chừng mà Settings' Home/Restart cung cấp thêm được so với luồng
  Continue/Play-again sẵn có của chính level đó.

**Test:** không cần test tự động mới (điều kiện JSX thuần, tái dùng hằng số/state đã có) — verify trên
dev server bằng GameDevOption's "Jump to level" → Level 3: đang giữa overlay "This is Prism Shot" chỉ
thấy 2 nút booster (Radius Overcharge, Prism Shot) và không có nút Settings; bấm hết tutorial thì cả 3
booster hiện đủ nhưng Settings vẫn ẩn (còn đang ở level 3). `tsc --noEmit` sạch, 174 test hiện có không
đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185).

## 191. Chain Sort ẩn tới level 5, tutorial booster loop lại cho tới khi tap to continue (12/09)

**Yêu cầu:** "Chainsort chưa nên hiện cho tới level 5" + "tutorial diễn ra nhanh quá, nên để người xem
từng bước chứ? Nếu người chơi dừng lại ở bước đó thì loop lại khoảnh khắc dùng booster đó cho tới khi
tap to continue".

- **Chain Sort ẩn tới level 5:** hằng số mới `CHAIN_SORT_UNLOCK_LEVEL_ID = 5` (thay cho mốc level 3 ở
  #190) — áp dụng cho cả `.booster-hud` lúc chơi (`level.id >= 5`, level 5 vẫn hiện vì chính tutorial
  của nó cần nút đó để spotlight) lẫn mục Boosters trong Shop (`hasClearedLevel(4)`).
- **Tutorial booster loop tới khi tap to continue:** trước đây bước "demo-radius"/"demo-prism"
  (`boosterFtueStep`) và "demo" (`chainSortFtueStep`) bắn 1 phát kịch bản rồi TỰ ĐỘNG nhảy sang bước kế
  tiếp ngay khi bắn xong — quá nhanh để nhìn kịp. Giờ các bước "demo-*" này:
  - Vẫn hiện đúng caption của bước "intro" tương ứng (không đổi chữ) + dòng "Tap to continue".
  - Sau khi bắn xong, chờ `BOOSTER_DEMO_LOOP_PAUSE_MS` (1.4s) để người chơi kịp nhìn kết quả, rồi tự
    reset lại bảng và bắn lại y hệt — lặp vô hạn.
  - CHỈ dừng loop và đi tiếp khi người chơi tự bấm "Tap to continue" — `advanceBoosterFtue`/
    `advanceChainSortFtue` giờ xử lý luôn 2 bước "demo-*"/"demo" này (trước đây chỉ xử lý bước
    "intro-*"), và reset bảng về sạch trước khi sang bước kế tiếp.
  - Đổi thứ tự khai báo `advanceBoosterFtue`/`advanceChainSortFtue` xuống sau `state`/`level` (cần
    `setState`/`createSandGameState(level)` để reset bảng) — tránh lỗi tham chiếu biến trước khi khai
    báo (temporal dead zone) mà bản thân đã từng vấp phải ở #189.

**Test:** `tsc --noEmit` sạch, 174 test hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không
liên quan, đã ghi từ #185). Verify sống trên dev server: Jump to Level 3 → tap "Tap to continue" ở
Radius Overcharge → phát kịch bản bắn, caption + "Tap to continue" VẪN còn đó (không tự nhảy) → đợi
~1.4s → bảng tự reset và bắn lại y hệt → bấm "Tap to continue" mới thật sự chuyển sang caption Prism
Shot. Chain Sort không xuất hiện trong tray lẫn Shop cho tới khi giả lập clear xong level 4.

## 192. Sửa bug loop tutorial làm cát vơi đi thật + tắt overlay đen khi xem tác dụng booster (12/09)

**Báo lỗi:** "Tôi muốn loop lại từ chính cái scene đó chứ không phải sort tiếp khiến cát vơi đi trời
ạ" + "Khi giới thiệu booster xong thì tắt opacity đen đi để người xem tác dụng của booster, sau 3 giây
hiện nút tap to continue để giới thiệu booster prism...".

**Nguyên nhân của bug "cát vơi đi":** bản loop dựng ở #191 "reset" bảng bằng
`setState(createSandGameState(level))` — nhưng React `state` chỉ là BẢN SAO được engine tự đẩy ra
ngoài qua callback `onState` (xem constructor `new SandCannonEngine(..., {onState: setState})`) —
KHÔNG PHẢI nguồn sự thật. Board thật (cát, số lượt bắn, số charge booster) sống hẳn bên trong instance
`SandCannonEngine`, hoàn toàn không hề bị đụng tới bởi lệnh `setState` đó. Kết quả: mỗi vòng loop bắn
THẬT vào board đã bị vơi từ vòng trước — vàng React tưởng đã "reset" nhưng thực ra cứ dọn tiếp, dọn
tiếp.

**Cách sửa "reset đúng scene":** đổi sang bump `runId` — đúng cơ chế `restart()`/`openLevel()`/
`goHome()` đã dùng cho MỌI lần "trả lại 1 board sạch" từ trước giờ: nó dỡ bỏ và dựng lại toàn bộ
`SandCannonEngine` (charges, cát, mọi thứ về lại như lúc mới vào level). Hai effect bắn demo
(`boosterFtueStep`/`chainSortFtueStep`) đã có sẵn `engine` trong dependency array, nên khi `runId` đổi
→ `engine` đổi identity → effect TỰ ĐỘNG chạy lại và bắn lại phát demo, không cần tự viết vòng lặp gọi
lại hàm.

**Thêm hành vi tắt overlay đen khi xem tác dụng booster:** state mới `boosterDemoRevealing`/
`chainSortDemoRevealing` — bật lên NGAY khi bước "demo-*" bắt đầu bắn, khiến toàn bộ overlay đen +
caption + spotlight biến mất HOÀN TOÀN (không hiện gì cả) để người chơi thấy rõ tác dụng thật của
booster trên bức tranh. Giữ trạng thái "trần trụi" này `BOOSTER_DEMO_REVEAL_MS` (3 giây, đúng yêu cầu
"sau 3 giây") rồi mới hiện lại caption + "Tap to continue" (`BOOSTER_DEMO_CAPTION_HOLD_MS`, thêm 3
giây nữa) — bấm thì đi tiếp qua booster kế/outro, không bấm thì `runId` bump lại và cả nhịp lặp lại
từ đầu (board sạch, bắn lại, tắt overlay lại...) cho tới khi có tap.

**Test:** `tsc --noEmit` sạch, 174 test hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không
liên quan). Verify sống trên dev server bằng cách click trực tiếp `.ftue-freeze-overlay` qua console
(tránh lệch thời điểm khi overlay đang tắt): tap intro-radius → overlay biến mất ngay (đúng), 3s sau
tự bắn lại từ board y hệt ban đầu nếu không tap (số lượt bắn/charge quay lại đúng số gốc, không tiếp
tục giảm — xác nhận hết bug "cát vơi đi"), tap giữa lúc caption đang hiện thì chuyển đúng sang Prism
Shot, hết cả 2 booster thì vào outro rồi trả lại y hệt 1 board sạch (26 lượt, 3/2 charge) cho người
chơi tự chơi thật.

## 193. Viết lại tutorial 2 booster ở Level 3: người chơi tự bắn thật, không còn demo kịch bản (12/09)

**Yêu cầu:** "Nó nên là hiện giới thiệu highlight booster -> bắt người chơi nhấn vào -> tắt opacity, để
người chơi tự nhắm và bắn -> bắn xong, sau khi cát sand settling được 1 giây thì giới thiệu prism
shot... -> bắt người chơi nhấn vào -> tắt opacity đen đi rồi để người chơi tự bắn. Sau khi bắn xong,
sau cát sand settling được 1 giây thì cho người chơi booster như cũ rồi tiếp tục màn hiện tại."

Thay hoàn toàn cách tiếp cận "bắn hộ bằng script rồi loop cho tới khi tap to continue" (#191, #192) —
CHỈ áp dụng cho level 3's Radius Overcharge/Prism Shot (level 5's Chain Sort giữ nguyên, không được
yêu cầu đổi). `boosterFtueStep` đổi state machine:

- **`intro-radius`/`intro-prism`** — overlay tối + spotlight (hole xuyên thấu) đúng như trước, NHƯNG
  giờ overlay có thêm class `.is-noninteractive` (`pointer-events: none`) — không còn "tap to continue"
  nào cả, mọi cú chạm xuyên thẳng qua overlay tới ĐÚNG NÚT BOOSTER THẬT trong tray bên dưới. Caption đổi
  từ "...Watch!" sang "...Tap it to arm it!" ("Chạm vào để trang bị!") mời người chơi tự bấm.
- **`shoot-radius`/`shoot-prism`** — không hiện gì cả (không overlay, không caption) — người chơi tự
  ngắm và tự bắn y hệt 1 phát bắn bình thường. Chuyển vào state này khi `armedBooster` (đã có sẵn, đồng
  bộ từ engine) khớp đúng loại booster đang giới thiệu.
- Phát hiện "bắn xong + cát đã settle": theo dõi `state.phase` quay lại `"READY"` VÀ `state.shotsUsed`
  vượt qua mốc lúc bắt đầu bước "shoot-*" (không phân biệt trúng/trượt — "bắn xong" tính từ lúc phát
  súng thật sự rời nòng, không cần phải trúng cát) — giữ nguyên `BOOSTER_TRY_SETTLE_HOLD_MS` (1 giây)
  rồi mới chuyển bước kế: `shoot-radius` → `intro-prism`, `shoot-prism` → **thẳng về `null`** (không còn
  outro) — trả lại quyền điều khiển ngay trên board hiện tại (không reset), đúng yêu cầu "cho người
  chơi booster như cũ rồi tiếp tục màn hiện tại". Cùng lúc bật luôn Shop's "go buy more" hint dot
  (trước đây gắn với bước "outro" đã bị xoá).
- Xoá hẳn `advanceBoosterFtue`, `boosterFtueTapReady`, `boosterDemoRevealing`, effect bắn script cho
  cặp booster này, và chuỗi i18n `ftueBoosterOutro` (không còn dùng).

**Test:** `tsc --noEmit` sạch, 174 test hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không
liên quan). Verify sống trên dev server: Jump to Level 3 → thấy spotlight + "Tap it to arm it!" trên
Radius Overcharge, bấm THẲNG vào nút thật trong tray (xuyên qua overlay) → nút bắt sáng, overlay biến
mất hoàn toàn → tự ngắm/bắn 1 phát thật → 1 giây sau khi cát settle thì chuyển đúng sang spotlight Prism
Shot → lặp lại tương tự → bắn xong Prism thì KHÔNG còn overlay/outro nào nữa, board giữ nguyên trạng
thái vừa bắn, `booster-shop-hint` đã bật — người chơi chơi tiếp bình thường ngay lập tức.

## 194. Miss/no-match: đổi từ toast chữ sang vignette đỏ nhẹ; settling: bỏ 3 chấm, khung tranh giảm opacity (12/09)

**Yêu cầu:** "Khi hit miss, không hiện UI pop up thông báo miss lên, mà thay vì đó cho background có 1
lớp đỏ nhẹ và viền tranh cũng có filter đỏ nhẹ" + "Từ giờ khi sandsettling, bỏ 3 dấu chấm đi, thay vì
đó là khung tranh giảm opacity, để người chơi focus vào dòng chảy của cát".

- **Miss/no-match → vignette đỏ, bỏ toast chữ:** sự kiện `NO_MATCH` (bắn trúng cát nhưng sai màu) và
  `MISS` (bắn trượt ra ngoài/trúng khung) trước đây `pushToast` 3 câu chữ khác nhau
  (`toastNoColorInRange`/`toastHitFrame`/`toastMissedFrame`) — giờ cả 3 gộp thành 1 hiệu ứng hình ảnh
  duy nhất: `.miss-flash`, một `radial-gradient` trong suốt ở giữa (đúng chỗ bức tranh, không đổi màu
  cát) và ngả sang đỏ nhạt (`rgba(255,154,139,...)`, từ cùng tông `--danger` app đã dùng) ra tới rìa —
  tức bầu trời/background VÀ đúng chỗ viền khung tranh đều nhuốm đỏ nhẹ, cát ở giữa giữ nguyên. Chớp
  rồi tắt trong 0.5s (`miss-flash-pulse`), bump counter `missFlashBump` để 2 lần miss liên tiếp đều
  replay lại từ đầu. Xoá hẳn 3 chuỗi i18n không còn dùng.
- **Bỏ 3 chấm lúc sand settling, thay bằng khung tranh giảm opacity:** `.settle-badge` (3 chấm nhấp
  nháy) xoá hẳn — thông báo cho screen reader vẫn giữ lại dưới dạng `.sr-only` (ẩn hình, không ẩn khỏi
  cây accessibility). Thay vào đó: `SandCannonEngine.ts` có thêm `setFrameBusyDim(busy)` (gọi từ
  `SandGame.tsx` mỗi khi `busy` — `PROJECTILE_FLYING`/`HIT_RESOLUTION`/`SETTLING`/`MERGING` — đổi) và
  `updateFrameDim` (chạy mỗi frame trong vòng lặp `animate()`, ease tuyến tính `frameDimT` về mục tiêu
  trong `FRAME_BUSY_DIM_TRANSITION_MS` = 220ms) — hạ `opacity` của MỌI vật liệu khung tranh (backing,
  lip, 2 rail, 2 post — tái dùng `MeshBasicMaterial.opacity` gốc, shader ripple đóng băng không đụng
  tới nó) xuống còn `FRAME_BUSY_DIM_OPACITY = 0.4` trong lúc bận, về lại 1.0 khi rảnh. Chỉ khung mờ đi
  — cát, cannon giữ nguyên độ sáng, đúng ý "để người chơi focus vào dòng chảy của cát".

**Test:** `tsc --noEmit` sạch, 174 test hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không
liên quan, đã ghi từ #185). Verify sống trên dev server: bắn trượt ra ngoài khung ở Level 1 →
`.miss-flash` mount đúng lúc rồi tự tắt sau nửa giây (không còn toast chữ nào cho miss/no-match nữa).
`setFrameBusyDim`/`updateFrameDim` được review kỹ theo đúng khuôn mẫu `updateFreezeVisualsAnimation`
đã có sẵn và dùng property `opacity` gốc của `MeshBasicMaterial` (không đụng shader) nên tin cậy được
dù không bắt được đúng khung hình đang mờ qua ảnh chụp màn hình (hiệu ứng chỉ kéo dài ~220ms mỗi lượt).

## 195. Sửa thật sự bug khung tranh không giảm opacity lúc sand settling (#194 chưa work) (12/09)

**Báo lỗi:** "Khung tranh chưa có giảm opacity khi cát settling? HÃY SỬA LẠI" — đúng, bản #194 hoàn
toàn không có tác dụng trên máy thật.

**Nguyên nhân thật sự:** #194 làm mờ khung bằng cách set `material.opacity`/`material.transparent`
trực tiếp trên `MeshBasicMaterial` của khung — nhưng shader của các mảnh khung (backing/lip/rail/post)
đã bị `onBeforeCompile` THAY THẾ HOÀN TOÀN (kỹ thuật ripple đổi màu lúc đóng băng, có từ trước) để tự
vẽ màu theo `uColorFrom`/`uColorTo`/`uProgress`. Dòng thay thế đó VẪN viết `opacity` vào kênh alpha
(`vec4(..., opacity)`), nhưng các mảnh khung này chưa từng được thiết lập để đi qua pass blend
trong suốt (không có `transparent`/`depthWrite` phù hợp cho tổ hợp mesh nhiều lớp của khung) — nên đổi
alpha một mình không có tác dụng NHÌN THẤY ĐƯỢC dù giá trị uniform đổi đúng. Xác nhận bằng cách tự tay
set `material.opacity = 0.05` trực tiếp qua console trên dev server — hình khung không đổi tí nào, kể
cả khi đợi rất lâu; trong khi đổi thẳng `uColorFrom`/`uColorTo` (kỹ thuật ripple đã có sẵn, đã chạy
đúng từ trước) thành màu đỏ thì đổi màu NGAY LẬP TỨC — chứng minh muốn khung đổi gì thấy được thì phải
đi qua đúng con đường shader này, không phải qua `material.opacity`.

**Cách sửa đúng:** thêm hẳn 1 uniform mới `uDim` (0..1) vào shader của khung (cùng chỗ với
`uColorFrom`/`uColorTo`/`uProgress` đã có), NHÂN thẳng vào màu đã tính ra:
`diffuseColor = vec4( freezeColor * (1.0 - uDim), opacity )` — tối màu bằng cách nhân RGB (giả lập
hiệu ứng "giảm opacity" bằng mắt thường) thay vì đụng alpha thật, dùng ĐÚNG con đường render đã được
xác nhận hoạt động (ripple đổi màu). `setFrameBusyDim`/`updateFrameDim` không đổi API/logic bên ngoài
(vẫn ease `frameDimT` theo `FRAME_BUSY_DIM_TRANSITION_MS`/`FRAME_BUSY_DIM_OPACITY` y hệt #194), chỉ đổi
chỗ áp dụng cuối cùng: ghi `entry.uniforms.uDim.value` thay vì `material.opacity`. Xoá hẳn field
`frameOpacityMaterials` không còn cần nữa.

**Test:** `tsc --noEmit` sạch, 174 test hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không
liên quan). Verify sống trên dev server bằng cách gắn tạm `window.__engine = this` (đã xoá trước khi
chốt) để gọi trực tiếp `engine.setFrameBusyDim(true)`/`(false)` qua console, kèm phóng to tạm
`FRAME_BUSY_DIM_TRANSITION_MS`/hạ `FRAME_BUSY_DIM_OPACITY` để mắt thường thấy rõ quá trình chuyển tiếp
— xác nhận khung tối hẳn xuống rồi sáng lại đúng như thiết kế, đã trả `FRAME_BUSY_DIM_OPACITY`/
`FRAME_BUSY_DIM_TRANSITION_MS` về đúng giá trị gốc (0.4 / 220ms) trước khi hoàn tất.

## 196. Chỉnh lại hiệu ứng khung tranh: mix về màu bầu trời (~20% trong suốt) thay vì tối màu (12/09)

**Yêu cầu:** "Ý tôi là khiến nó kiểu 20% transparent á" — làm rõ lại ý của #195: người dùng muốn khung
THẬT SỰ NHÌN NHƯ TRONG SUỐT (nhìn xuyên qua được), không phải chỉ tối màu đi.

**Điều tra thêm real alpha transparency (trước khi kết luận):** đo trực tiếp bằng `gl.readPixels` trên
dev server — set `material.opacity = 0`/`transparent = true` CHỈ trên đúng 6 vật liệu khung (backing,
lip, 2 rail, 2 post), byte đọc lại TUYỆT ĐỐI KHÔNG ĐỔI so với lúc chưa đổi (dù đã thử thêm
`depthWrite = false`/`needsUpdate = true`) — xác nhận lại kết luận #195: material.opacity thật sự
không có tác dụng gì trên các vật liệu này, dù `renderer.properties.get(material).uniforms.opacity`
đọc lại đúng giá trị đã set. Không rõ nguyên nhân sâu xa (đã thử nhiều cách chẩn đoán), nhưng dữ liệu
đo được nhất quán và lặp lại được nhiều lần — con đường alpha thật sự đóng, không phải do code viết sai
ở #195.

**Cách sửa cho đúng Ý ĐỊNH "20% transparent":** thay vì nhân màu về ĐEN (`freezeColor * (1 - uDim)`,
đọc như "tối đi" chứ không phải "trong suốt"), đổi shader trộn (`mix`) màu khung về ĐÚNG MÀU BẦU TRỜI
đằng sau nó (`uSkyColor`, lấy đúng màu fog `0xaedee4` file này đã dùng sẵn) — về mặt thị giác, "phai
dần vào màu nền phía sau" đúng là cảm giác "trong suốt" thật sự mang lại, dù kỹ thuật vẫn là mix màu
chứ không phải blend alpha GPU thật. Đổi tên hằng số `FRAME_BUSY_DIM_OPACITY` (0.4, "giữ lại 40% độ
đục") thành `FRAME_BUSY_DIM_TRANSPARENCY = 0.2` (đúng nghĩa "20% trong suốt" — lúc mờ nhất, khung là
80% màu gốc + 20% màu bầu trời).

**Test:** `tsc --noEmit` sạch, 174 test hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không
liên quan). Verify sống trên dev server bằng `window.__engine` tạm thời (đã xoá): `setFrameBusyDim(true)`
rồi đọc `frameFreezeMaterials[0].uniforms.uDim.value` — đúng bằng `0.2` ở trạng thái mờ nhất, và ảnh
chụp cho thấy viền khung ngả sang tông lạnh của bầu trời thay vì tối sẫm — đúng cảm giác "phai vào nền"
thay vì "tối màu" như bản trước.

## 197. Cập nhật GDD.md cho các thay đổi #184-196 (12/09)

**Yêu cầu:** "Cập nhật vào changelog và GDD."

Changelog (#184-196) đã ghi khi làm; lượt này bổ sung nốt GDD.md — theo đúng quy ước sẵn có của tài
liệu (thêm ghi chú có ngày vào section đang tồn tại, không renumber):

- **3.3 (Miss/no-match):** thêm đoạn mô tả `.miss-flash` — vignette đỏ thay 3 toast chữ cũ.
- **9 (Booster):** thêm đoạn `CHAIN_SORT_UNLOCK_LEVEL_ID = 5`.
- **12.3 (Bảng 24 màu):** thêm đoạn `customPalette` riêng theo level — chỉ Zen Mode, 100% chính xác
  màu ảnh gốc trong giới hạn 24 ô.
- **13.2 (HUD):** thêm dòng bảng "Khung tranh mờ lúc bận" — thay 3 chấm settle-badge cũ.
- **13.4 (FTUE):** đổi tiêu đề "hai cơ chế" → "ba cơ chế", thêm dòng bảng + đoạn mô tả tutorial
  booster: Radius/Prism (level 3) giờ người chơi tự bắn thật, Chain Sort (level 5) vẫn scripted-demo-
  loop như cũ.
- **13.6 (mới):** "Onboarding khoá cứng — level 1-3, mở game lần đầu" — first-open auto-play, khoá nút
  ✕/Settings tới level 4, radius Level 1/2 tăng.
- **16.5 (Modes):** cập nhật đoạn nút Back (chỉ còn ở danh sách Zen, bỏ ở màn hai thẻ) + đoạn icon "?"
  mới.
- **16.6 (Hearts):** thêm đoạn Shop ẩn Bundles/Hearts/offer-có-heart trước khi mở khoá.
- **Phụ lục A:** cập nhật `sortRadius` Level 1 (2→4) và Level 2 (3→3.5).

**Test:** tài liệu thuần, không có code/test nào đổi theo — `git status --short` xác nhận chỉ
`GDD.md`/`CHANGELOG-prototype.md` đổi thêm so với các entry trước đó.

## 198. Khung tranh lúc sand settling: đổi từ mix màu bầu trời sang "kính trắng mờ" kiểu Minecraft glass pane (12/09)

**Yêu cầu:** "Tôi muốn cái khung tranh khi sandsettling sẽ kiểu như white glass panel with low opacity
with white filter on, glass, white glass minecraft texture-like" — làm lại hẳn art direction của hiệu
ứng #196 (mix về màu bầu trời `0xaedee4`), giữ nguyên toàn bộ cơ chế bật/tắt/ease đã có, chỉ đổi MÀU và
THÊM MỘT LỚP HOA VĂN để nó đọc đúng thành một tấm kính trắng mờ phủ lên khung, không phải "phai vào nền".

- **Đổi màu mix từ sky-blue sang trắng:** `FRAME_BUSY_DIM_SKY_COLOR` (`0xaedee4`) đổi tên thành
  `FRAME_BUSY_DIM_GLASS_COLOR` = `0xffffff`; uniform `uSkyColor` đổi tên `uGlassColor` theo. Nâng nhẹ
  `FRAME_BUSY_DIM_TRANSPARENCY` từ `0.2` lên `0.35` — vẫn đúng tinh thần "low opacity" (khung vẫn thấy
  rõ màu gốc xuyên qua), nhưng đủ đậm để lớp kính trắng thật sự đọc được thay vì mờ nhạt.
- **Thêm lưới "mullion" kiểu ô kính Minecraft:** 3 hằng số mới —
  `FRAME_BUSY_DIM_GRID_CELL` (1.0, đơn vị world, ướm theo `FIT_WIDTH`/`FIT_HEIGHT` ~5-6 unit nên luôn
  ra khoảng 5-6 ô trên khung bất kể level to nhỏ), `FRAME_BUSY_DIM_GRID_LINE_WIDTH` (0.035, độ mờ viền
  mỗi ô) và `FRAME_BUSY_DIM_GRID_BOOST` (1.6, độ sáng thêm của vạch lưới). Shader tính
  `mod(vFreezeXY, cellSize)` rồi lấy khoảng cách gần nhất tới biên ô để vẽ vạch sáng — dùng đúng
  `vFreezeXY` (không gian "local theo tranh" đã có sẵn cho hiệu ứng ripple đóng băng, liên tục xuyên
  suốt backing/lip/2 rail/2 post), nên lưới kính nối liền một mạch qua mọi mảnh khung, đọc như MỘT tấm
  kính lớn phủ nguyên khung chứ không phải mỗi mảnh một ô riêng.
- Cả màu mix lẫn độ sáng vạch lưới đều nhân theo `uDim` — lưới kính chỉ hiện dần lên cùng lúc khung mờ
  đi lúc bận, biến mất hoàn toàn lúc rảnh, không phải hoa văn tĩnh vẽ sẵn.
- Cập nhật toàn bộ doc comment liên quan (`FRAME_BUSY_DIM_TRANSPARENCY`, `updateFrameDim`,
  `createFrameFreezeMaterial`, `.sr-only`'s comment trong `globals.css`) theo đúng art direction mới —
  không còn nhắc "phai vào bầu trời" mà là "tấm kính trắng mờ phủ lên khung".

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn), 174
test hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185). Verify
sống trên dev server bằng `window.__engine` tạm thời (đã xoá trước khi chốt, xác nhận bằng
`grep -n "__engine"` rỗng): `setFrameBusyDim(true)` → đợi hết `FRAME_BUSY_DIM_TRANSITION_MS` →
`frameFreezeMaterials[].uniforms.uDim.value` đều đúng `0.35` → ảnh chụp cho thấy khung ngả trắng rõ kèm
lưới vạch trắng sáng kiểu ô kính, liên tục xuyên suốt cả 4 cạnh khung; `setFrameBusyDim(false)` → khung
trả lại đúng màu gỗ/cream ban đầu, không còn dấu vết lưới.

## 199. Bỏ lưới kính, chỉ để rìa khung tranh (rail/post) trắng ra lúc sand settling (12/09)

**Yêu cầu:** "bỏ grid trắng ra đi, mà thay vì đó cho rìa khung tranh nó trắng" — đơn giản hoá lại hẳn
#198: bỏ lưới mullion, và thu hẹp vùng đổi màu lại đúng phần "rìa khung tranh" — phần viền rail/post
người chơi thật sự đọc là "cái khung", không phải backing/lip phía trong (phần lớn bị cát che, chỉ lộ
ra ở những khoảng trống trong tranh).

- **Bỏ hẳn lưới:** xoá toàn bộ code `paneUv`/`paneEdgeDist`/`paneLine` cùng 3 hằng số
  `FRAME_BUSY_DIM_GRID_CELL`/`FRAME_BUSY_DIM_GRID_LINE_WIDTH`/`FRAME_BUSY_DIM_GRID_BOOST` — shader trở
  lại đúng một dòng `mix( freezeColor, uGlassColor, uDim )` như bản #196, chỉ khác màu đích (trắng thay
  vì sky-blue).
- **Chỉ rail/post trắng ra, backing/lip đứng yên:** `updateFrameDim` giờ chỉ ghi `uDim` khác 0 cho
  entry có `isRail === true` — `entry.uniforms.uDim.value = entry.isRail ? dim : 0`. Backing/lip (2
  entry còn lại trong `frameFreezeMaterials`) luôn nhận `uDim = 0`, tức shader của chúng không đổi gì
  so với lúc rảnh dù `frameDimTarget` đang bật.
- **Nâng độ trắng:** vì hiệu ứng giờ thu hẹp vào đúng dải viền mỏng (không còn phủ cả mảng backing lớn
  + lưới để "đọc" rõ), tăng `FRAME_BUSY_DIM_TRANSPARENCY` từ `0.35` lên `0.8` để rìa thật sự đọc thành
  "trắng ra" rõ ràng thay vì một sắc thái nhạt khó nhận ra trên dải viền hẹp.

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn), 174
test hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185). Verify
sống trên dev server bằng `window.__engine` tạm thời (đã xoá trước khi chốt, `grep -n "__engine"`
rỗng): `setFrameBusyDim(true)` → đợi hết transition →
`frameFreezeMaterials.map(e => ({isRail: e.isRail, uDim: e.uniforms.uDim.value}))` xác nhận đúng 4 rail/
post ở `0.8`, 2 backing/lip ở `0`; ảnh chụp cho thấy đúng viền ngoài (rail/post) trắng rõ, phần
backing/lip lộ ra trong khoảng trống của tranh vẫn giữ nguyên màu cream gốc, không có lưới nào cả.
`setFrameBusyDim(false)` → viền trả lại đúng màu gỗ nâu ban đầu.

## 200. Nghĩ lại: cả khung tranh (không riêng rìa) fill trắng ở opacity thấp ~20% (12/09)

**Yêu cầu:** "Nghĩ lại rồi. Bây giờ khi trong trạng thái sandsettling, khung tranh sẽ được fill màu
trắng với lớp material giảm opacity xuống cỡ 20%" — quay lại phạm vi rộng như bản đầu (#194/#196):
TOÀN BỘ khung, không chỉ riêng rìa như #199, và đúng nghĩa "lớp material trắng, opacity thấp" chứ
không phải mix sang màu bầu trời như #196.

- **Bỏ hẳn phân biệt `isRail`:** `updateFrameDim` quay lại ghi `uDim` giống nhau cho cả 6 mảnh khung
  (backing, lip, 2 rail, 2 post) — không còn `entry.isRail ? dim : 0` như #199, chỉ còn
  `entry.uniforms.uDim.value = dim` áp dụng đều.
- **Hạ `FRAME_BUSY_DIM_TRANSPARENCY` từ `0.8` (bản #199, chỉ áp cho rìa hẹp) xuống lại `0.2`** — đúng
  số "20%" người dùng nêu, và hợp lý hơn khi hiệu ứng giờ phủ lên cả mảng lớn (backing) thay vì chỉ
  dải viền mỏng: cần opacity thấp để không lấn át toàn bộ picture frame.
- Giữ nguyên `uGlassColor = 0xffffff` (trắng, không đổi từ #198/#199) và toàn bộ cơ chế mix-qua-uniform
  đã có (`mix(freezeColor, uGlassColor, uDim)`, không có lưới/pane nào — #199 đã bỏ lưới, giữ nguyên).

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn), 174
test hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185). Verify
sống trên dev server bằng `window.__engine` tạm thời (đã xoá trước khi chốt, `grep -n "__engine"`
rỗng): `setFrameBusyDim(true)` → đợi hết transition →
`frameFreezeMaterials.map(e => ({isRail: e.isRail, uDim: e.uniforms.uDim.value}))` xác nhận cả 6 mảnh
(kể cả 2 backing/lip trước đây bị loại ở #199) đều lên đúng `0.2`; ảnh chụp cho thấy cả khung (viền
lẫn phần tranh lộ ra trong khoảng trống) ngả trắng nhẹ đều nhau, đúng cảm giác "một lớp material trắng
mỏng phủ lên trên" chứ không phải khung tự đổi hẳn màu. `setFrameBusyDim(false)` → khung trả lại đúng
màu gốc, không còn dấu vết trắng.

## 201. Bỏ hẳn hiệu ứng khung tranh, trả lại 3 chấm settling (vị trí mới) + khay booster trống ở level 1-2 (12/09)

**Yêu cầu:** "Chỉnh sửa lại rồi. Giờ khung tranh khi sand settling sẽ giữ màu nguyên bản. Không còn màu
trắng hay opacity giảm gì nữa" + "Khi sandsettling, sẽ xuất hiện dấu 3 chấm và anim của nó. Vị trí xuất
hiện sẽ luôn ở dưới khung tranh, trên ụ súng. Giữa ụ súng và khung tranh" + "Ở level 1, và level 2. Vẫn
sẽ xuất hiện HUD booster tray nhưng nó sẽ trống trơn". Ba yêu cầu độc lập, gộp vào một entry vì cùng một
lượt sửa.

- **Bỏ hẳn hiệu ứng frame-dim (toàn bộ chuỗi #194→#200):** xoá sạch khỏi `SandCannonEngine.ts` —
  `FRAME_BUSY_DIM_TRANSPARENCY`/`FRAME_BUSY_DIM_GLASS_COLOR`/`FRAME_BUSY_DIM_TRANSITION_MS`, field
  `frameDimTarget`/`frameDimT`, uniform `uDim`/`uGlassColor` khỏi `frameFreezeMaterials` và shader của
  `createFrameFreezeMaterial` (trả `diffuseColor` về đúng 1 dòng gốc
  `vec4( freezeColor, opacity )`, không mix gì thêm), method `setFrameBusyDim`/`updateFrameDim`, và lệnh
  gọi `updateFrameDim(delta)` trong `animate()`. `SandGame.tsx` bỏ hẳn effect gọi
  `engine?.setFrameBusyDim(busy)`. Khung tranh giờ luôn giữ đúng màu tác giả đặt
  (`FRAME_RAIL_COLOR`/`FRAME_INNER_COLOR`, hoặc bản `_FROZEN` khi Freeze Map active) trong MỌI trạng
  thái, không còn đường nào đổi màu/opacity nó theo `busy` nữa.
- **Trả lại `.settle-badge` (3 chấm), vị trí mới:** JSX + markup y hệt bản gốc trước #194 (`<div
  className="settle-badge" role="status" aria-label={...}><i /><i /><i /></div>`, gate
  `busy && !winReveal`) — nhưng CSS đổi hẳn vị trí: từ `top: 70px` (pixel tuyệt đối, phía TRÊN khung,
  giữa trời) sang `position: absolute; left: 50%; top: 56%; transform: translate(-50%, -50%)` — đúng
  toạ độ `.ftue-gesture` (glyph "Drag to aim" của level 1) đã dùng cho dải trời trống GIỮA khung và ụ
  súng (comment sẵn có trên `.scene-wrap` gọi đúng dải này là "a band of clear sky between the frame's
  bottom edge and the cannon below"). Dùng lại luôn `top: 56%` có sẵn thay vì tự đo một trị số mới, vì
  đây chính xác là dải yêu cầu. Keyframes `settle-dot-grow` (đã xoá ở #194) thêm lại y nguyên.
- **Level 1/2: khay booster hiện nhưng trống, không ẩn cả khay:** JSX của `.booster-hud` đổi điều kiện
  bao ngoài từ `playing && !level.ftueGesture && !level.hideBoosterHud && !winReveal` thành chỉ
  `playing && !winReveal` — khay LUÔN mount khi đang chơi. Bên trong, một IIFE tính
  `showBoosterButtons = !level.ftueGesture && !level.hideBoosterHud`; `false` thì trả `null` (khay rỗng,
  0 con), `true` thì chạy đúng `.filter().map()` cũ y nguyên logic/thứ tự booster. Xác nhận qua
  `document.querySelector('.booster-hud').children.length === 0` trên level 1.

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn), 174 test
hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185). Verify sống
trên dev server bằng `window.__engine` tạm thời (đã xoá trước khi chốt, `grep -n "__engine"` rỗng): bắn
`runScriptedShot` trên level 1, poll `state.phase` mỗi 50ms trong 1.5s — bắt đúng
`PROJECTILE_FLYING`/`SETTLING`, `document.querySelectorAll('.settle-badge').length > 0` đúng lúc đó;
ảnh chụp giữa lúc settling cho thấy 3 chấm nằm đúng dải trời giữa khung và ụ súng, khung tranh giữ
nguyên màu gỗ/cream không đổi tí nào. `document.querySelector('.booster-hud')` tồn tại với
`children.length === 0` trên level 1 (chưa bắn xong sạch tranh nên vẫn đang ở level 1).

## 202. Sửa size/vị trí tray booster trống ở level 1-2 cho khớp mọi level khác (12/09)

**Báo lỗi:** "Size và vị trí của tray booster không đồng nhất. Traybooster ở level 1 và 2 nên có kích
thước, hình dạng và vị trí giống như tất cả level còn lại" — đúng, bản #201 mount `.booster-hud` trên
mọi level nhưng chỉ nhồi nội dung bên trong nếu có, không nhồi kích thước.

**Nguyên nhân:** `.booster-hud` không có `height`/`min-height` riêng — chiều cao của nó hoàn toàn do
nội dung bên trong quyết định (padding 16px trên + 16px dưới bao quanh 1 hàng `.booster-btn` cao 38px
= 70px). Level 3+ có 2-3 nút nên tray cao đúng 70px; level 1/2 sau #201 mount tray với 0 nút bên trong
→ box co lại chỉ còn đúng phần padding (2×16=32px, không tính safe-area) — thấp hơn hẳn, đọc như "một
thanh mỏng" khác hẳn hình dạng/kích thước tray thật.

**Cách sửa:** thêm `min-height: 70px` (đúng bằng 38px của `.booster-btn` cộng 16px×2 padding trên/dưới)
vào `.booster-hud` — giờ dù có 0, 2 hay 3 nút bên trong, khung ngoài luôn cao tối thiểu 70px, đúng y hệt
size/vị trí/hình dạng ở mọi level.

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn), 174 test
hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185). Verify sống
trên dev server: `.booster-hud`'s `getBoundingClientRect()` ở Level 1 (0 nút, sau khi mở game lần đầu)
ra đúng `{top: 742, bottom: 812, height: 70}`; nhảy tới Level 4 (`GameDevOption` → "Level (1-51)" → Go, 2
nút) qua đúng cùng phép đo ra `{top: 742, bottom: 812, height: 70}` — khớp tuyệt đối, kể cả `left`/
`right`.

## 203. Sửa bug off-by-one: nút Settings mid-play còn ẩn cả ở level 4 (12/09)

**Báo lỗi:** "chỉ có level 1 tới 3 không hiện nút setting thôi chứ những level sau vẫn hiện" — đúng,
điều kiện ẩn nút Settings lúc đang chơi (`app/SandGame.tsx`) đọc
`!playing || raw.id > WIN_CLOSE_BUTTON_FROM_LEVEL_ID` với `WIN_CLOSE_BUTTON_FROM_LEVEL_ID = 4` — `4 > 4`
là `false` nên level 4 vẫn bị ẩn, chỉ level 5 trở đi mới thật sự hiện lại. Bản thân comment ngay phía
trên dòng đó đã ghi đúng ý định "it is back the instant level 4 starts" — code lệch 1 so với comment
của chính nó.

**Đối chiếu:** nút ✕ ở card "Frame Cleared" (chỗ khác cũng dùng `WIN_CLOSE_BUTTON_FROM_LEVEL_ID`, dòng
`(playingZen || raw.id >= WIN_CLOSE_BUTTON_FROM_LEVEL_ID)`) đã dùng đúng `>=` từ đầu — chỉ riêng điều
kiện của nút Settings bị gõ nhầm `>` thay vì `>=`.

**Cách sửa:** đổi `raw.id > WIN_CLOSE_BUTTON_FROM_LEVEL_ID` thành `raw.id >= WIN_CLOSE_BUTTON_FROM_LEVEL_ID`
— khớp đúng với nút ✕ và với comment của chính khối code này.

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn), 174 test
hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185). Verify sống
trên dev server qua `GameDevOption` → "Level (1-51)": Level 3 — không có nút Settings; Level 4 — nút
Settings hiện lại, bấm vào mở đúng card Home/Restart như mọi level bình thường khác.

## 204. Onboarding lock (Settings/nút ✕/khay booster) chỉ áp dụng lượt chơi đầu, không khoá lại khi chơi lại (12/09)

**Yêu cầu:** "Nút setting không xuất hiện ở level 1, 2, 3 khi người chơi vào game lần đầu, nếu người
chơi chơi lại, kích hoạt level từ gallery HUB thì nó vẫn hiện. Booster cũng vậy" — đúng, bản #203 (và
#186/#190 trước đó) chỉ xét `raw.id >= WIN_CLOSE_BUTTON_FROM_LEVEL_ID` (level hiện tại có phải >= 4 hay
không), không phân biệt "đang ở trong chuỗi onboarding lần đầu" với "chơi lại level 1-3 sau khi đã qua
onboarding từ lâu" — chơi lại level 1/2/3 từ Gallery vẫn bị khoá y hệt lần đầu, dù người chơi đã dọn
xong cả 3 level đó từ trước.

**Cách sửa:** thêm biến dẫn xuất mới `onboardingLockLifted` (`app/SandGame.tsx`, ngay sau `level`) =
`raw.id >= WIN_CLOSE_BUTTON_FROM_LEVEL_ID || hasClearedLevel(WIN_CLOSE_BUTTON_FROM_LEVEL_ID - 1)` — tái
dùng đúng `hasClearedLevel` (`economy.ts`) mà lưới Gallery/Chain Sort đã tin cậy cho "đã dọn xong level
này ít nhất một lần chưa". Một khi level 3 đã dọn xong dù chỉ một lần, biến này đúng VĨNH VIỄN từ đó —
cùng dạng "mở khoá một lần rồi thôi" với mọi cơ chế unlock khác trong file. Thay thế 3 chỗ từng đọc
thẳng `raw.id >= WIN_CLOSE_BUTTON_FROM_LEVEL_ID`:
- Nút ✕ card "Frame Cleared": `(playingZen || raw.id >= WIN_CLOSE_BUTTON_FROM_LEVEL_ID)` →
  `(playingZen || onboardingLockLifted)`.
- Nút Settings mid-play: `(!playing || raw.id >= WIN_CLOSE_BUTTON_FROM_LEVEL_ID)` →
  `(!playing || onboardingLockLifted)`.
- Danh sách nút trong khay booster: `showBoosterButtons = !level.ftueGesture && !level.hideBoosterHud` →
  thêm `|| onboardingLockLifted` — level 1/2 chơi lại sau khi đã qua onboarding thấy đủ nút thật ngay,
  không còn khay trống nữa.

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn), 174 test
hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185). Verify sống
trên dev server: set tạm `localStorage['sand-cannon:v1:cleared-levels'] = "[1,2,3]"` rồi reload → vào
Gallery → bấm Level 1 → Settings hiện lại VÀ khay booster có đủ 2 nút thật (Radius Overcharge charge 1,
Prism Shot charge 2) ngay từ đầu, không còn trống — xác nhận qua
`document.querySelector('.booster-hud').children.length === 2` và
`!!document.querySelector('.settings-wrap') === true`. Trả `cleared-levels` về đúng giá trị gốc
(`"[1]"`) sau khi verify xong, không để lại state giả trên máy người dùng.

## 205. Daily Login buộc tắt khi chuyển hub bằng thanh tác vụ, kèm chấm đỏ nhắc nếu chưa nhận (12/09)

**Yêu cầu:** "Khi daily login hiện lên, nếu người nhấn phần thanh tác vụ ở dưới và chuyển sang hub
khác, thì daily login đó buộc phải tắt đi. NẾU lúc bị buộc tắt nhưng người chơi vẫn chưa nhận phần
thưởng, thì sẽ hiện chấm đỏ góc phải trên cùng để thông báo, và cũng chấm đỏ trên home hub luôn."

**Trước đây:** modal Daily Login (`{!playing && !chest && dailyLogin && (...)}`) không hề gate theo
`tab` — bấm `hub-nav` để chuyển Shop/Skin/Gallery/Modes trong lúc modal đang mở (nav có z-index 31, cao
hơn overlay modal z-index 30, nên vẫn bấm được xuyên qua) không đóng modal, để nó cứ đứng yên đè lên
trên màn vừa chuyển sang.

- **Buộc đóng khi chuyển tab:** `hub-nav`'s `onClick` (`app/SandGame.tsx`) giờ kiểm tra
  `dailyLogin && entry !== tab` trước khi `setTab(entry)` — có thì gọi `setDailyLoginOverride(null)`
  đóng modal ngay. Chỉ áp dụng khi THẬT SỰ đổi tab (`entry !== tab`) — bấm lại đúng tab đang mở không
  tính là "rời đi".
- **Chấm đỏ nhắc nếu chưa nhận:** state mới `dailyLoginMissedClaim` (mặc định `false`) — bật lên đúng
  lúc buộc đóng modal NẾU `!dailyLogin.claimedToday` (đóng thường qua nút ✕/bấm ra ngoài không bật cờ
  này, chỉ trường hợp bị kéo đi giữa chừng). Hiện dưới dạng 2 chấm đỏ dùng lại đúng class
  `.hub-nav-dot` đã có sẵn (cùng họ với chấm đỏ Skin/Shop):
  - Trên tab Home của `hub-nav`.
  - Trên chính nút quà tặng góc phải trên cùng (`.gift-button`, nút mở lại modal) — class mới
    `.gift-button-dot`, cùng công thức nhưng viền `--panel` thay vì `--hub-navy` để hợp với nền mint
    của nút thay vì nền tối của `.hub-nav`.
  - Cả hai đọc `aria-label` phụ mới `homeTabHasDailyLoginHintSuffix` (song ngữ, `i18n.ts`) khi bật, cùng
    kiểu với `skinTabHasOfferSuffix`/`shopTabHasBoosterHintSuffix` đã có.
- **Tắt khi nào:** `setDailyLoginMissedClaim(false)` ngay trong `claimDailyLoginWithFlight` sau khi
  claim thành công — chỉ NHẬN THƯỞNG thật sự mới tắt, mở lại modal xem qua (không claim) thì cờ vẫn giữ
  nguyên. Không persist qua `localStorage` — nếu người chơi tắt app/reload trước khi nhận, modal tự mở
  lại (`initialDailyLogin` sẵn có) đã đủ nhắc, không cần cờ này sống sót qua reload nữa.

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn), 174 test
hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185). Verify sống
trên dev server: modal Daily Login tự mở (chưa claim hôm đó) → bấm tab Shop → modal đóng ngay, chấm đỏ
hiện trên cả tab Home lẫn nút quà tặng (xác nhận qua `homeBtn.querySelector('.hub-nav-dot')` +
`document.querySelector('.gift-button-dot')`) → bấm lại nút quà tặng mở lại modal, chấm đỏ vẫn còn →
bấm "Claim 30 coins" → cả hai chấm đỏ biến mất ngay. Kiểm tra thêm: mở lại modal (đã claim hôm đó) rồi
chuyển tab Shop — modal đóng nhưng KHÔNG bật chấm đỏ nào (đã nhận thưởng từ trước).

## 206. Frost Cannon: đổi hẳn hình khối thay vì chỉ đổi màu (12/09)

**Yêu cầu:** "chỉnh sửa model frost canon lại, thêm yếu tố để khiến nó khác hơn chứ không phải thay
màu" — đúng, bản trước (`buildFrostCannon`, `costumes.ts`) dùng lại NGUYÊN VẸN 3 khối hình học của
classic cannon (pedestal `CylinderGeometry` 40 cạnh, housing `SphereGeometry`, barrel
`CylinderGeometry` cùng kích thước) chỉ đổi vật liệu sang xanh băng + rắc thêm vài icicle nhỏ quanh
viền — về bản chất vẫn là "cannon cũ sơn lại", đúng điều người dùng phàn nàn.

- **Pedestal:** `CylinderGeometry(1.08, 1.3, 0.48, 40)` → `... , 8)` — cùng kích thước/footprint hệt 3
  skin kia, chỉ đổi số cạnh tròn thành 8 mặt phẳng. Cách rẻ nhất để đọc ngay thành "khối băng được chặt
  ra" thay vì "đĩa tiện tròn", trước khi thêm bất kỳ phụ kiện nào.
- **Mũi băng lớn (phụ kiện chữ ký riêng của skin này):** một `ConeGeometry` lớn (0.22×1.05) nhô lệch
  hẳn ra khỏi một cạnh bệ, cố ý KHÔNG đối xứng (băng thật không mọc đối xứng quanh tâm) — cùng vai trò
  "phụ kiện riêng" mà dải hạt phát sáng nổi của Rune Cannon hay túi da của Hero Cannon đang giữ cho
  skin của chúng. Kèm một mảnh nhỏ tựa vào gốc mũi lớn — một cụm băng thật không bao giờ chỉ có một
  mũi đơn lẻ.
- **Housing:** `SphereGeometry(0.62, 28, 18)` → `IcosahedronGeometry(0.66, 0)` (bán kính nhích lên
  0.62→0.66 để mặt phẳng của khối đa diện vẫn che kín rìa sau nòng súng — radiusBottom 0.38 — suốt hành
  trình giật lùi, vì mặt của icosahedron nằm gần tâm hơn đỉnh của nó so với một mặt cầu cùng bán kính) —
  đọc như một mắt băng bị đẽo mặt, không phải quả cầu đổi màu.
- **Nòng súng:** bỏ hẳn 2 vòng nhẫn phát sáng đối xứng cũ, thay bằng 7 gai băng lệch cỡ
  (`ConeGeometry`, bán kính 0.045-0.075, dài 0.22-0.46) mọc dọc một dải góc hẹp (~3.6-4.15 rad, tức mặt
  dưới nòng) từ gần housing tới gần đầu nòng — mỗi gai tự tính bán kính nòng đúng tại toạ độ z của nó
  (nòng vốn thon dần 0.38→0.24) để gốc luôn áp sát bề mặt, và tự xoay theo đúng hướng xuyên tâm
  (`rotation.z = angle - 90°`) để trông như mọc THẲNG RA khỏi nòng chứ không phải dán lên. Đọc như một
  dải băng tích tụ lệch một bên thật sự, không phải vòng trim đối xứng gắn thêm.
- Icicle quanh viền bệ và cụm pha lê đầu nòng của bản trước giữ nguyên — cả hai vẫn là hình khối riêng
  không skin nào khác có, chỉ 3 khối "lõi" (pedestal/housing/barrel) là được làm lại lần này.

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn), 174
test hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185; không
test nào exercise hình học rig, đúng như kỳ vọng). Verify sống trên dev server: `GameDevOption` →
"Acquire all skins" → Skin tab → chọn Frost Cannon — màn showroom lẫn cannon thật trong gameplay đều
hiện đúng pedestal 8 mặt, khối housing đa diện, mũi băng lớn nhô lệch, và các icicle/pha lê cũ vẫn còn;
không lỗi console nào liên quan tới `costumes`/rig geometry (console có vài warning React/network khác,
xác nhận không liên quan tới thay đổi lần này bằng cách lọc theo từ khoá "costume" — rỗng).

## 207. Miss-flash giờ phủ trọn rìa màn hình, kể cả đè lên số đạn và nút Settings (12/09)

**Báo lỗi:** "Tôi muốn hiệu ứng đỏ khi miss sẽ tràn toàn rìa màn hình luôn chứ không phải dừng lại
trước UI số đạn hay setting" — đúng, `.miss-flash` (`app/SandGame.tsx`) trước đây render bên TRONG
`.scene-wrap`, mà `.scene-wrap` tự nó đã `inset` xuống dưới thanh HUD trên cùng
(`calc(max(var(--hud-inset), env(safe-area-inset-top)) + var(--hud-height) + 10px) 0 0`) và có
`overflow: hidden` — nên dù `.miss-flash` tự đặt `inset: 0`, nó chỉ phủ được đúng phần dưới thanh HUD,
không bao giờ chạm tới góc chứa `.hud-top-left` (số đạn) hay `.settings-wrap` (nút Settings) dù z-index
có cao cỡ nào, vì bị `.scene-wrap` cắt cứng trước khi tới lượt z-index tính tới.

**Cách sửa:** dời hẳn node `.miss-flash` ra khỏi `.scene-wrap`, đặt làm con trực tiếp của `.game-frame`
(ngang hàng `.hud-top-left`/`.settings-wrap`/`.scene-wrap`, ngay đầu danh sách con của `.game-frame`) —
`.game-frame` mới là khung ngoài cùng bao trọn cả HUD lẫn scene, nên `inset: 0` ở cấp này phủ đúng toàn
bộ màn chơi thật sự. Nâng `z-index` từ `6` lên `33` — cao hơn cả `.hud-top-left` (31) lẫn `.settings-wrap`
(32), hai thứ trước đây `.miss-flash` không bao giờ với tới được. Logic bật/tắt (`missFlashBump`,
`key={missFlashBump}` để 2 lần miss liên tiếp đều replay) giữ nguyên y hệt, chỉ đổi vị trí DOM.

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn), 174 test
hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185). Verify sống
trên dev server bằng `window.__engine` tạm thời (đã xoá trước khi chốt, `grep -n "__engine"` rỗng):
bắn `runScriptedShot` ra hẳn ngoài khung tranh (toạ độ pixel-grid vượt hẳn `level.frame` 50×50 của
level 1 nhưng vẫn trong tầm đạn) → xác nhận đúng sự kiện `MISS` qua `state.phase` đi qua
`PROJECTILE_FLYING → READY` (không có `SETTLING`, tức không trúng cát) → đo trực tiếp
`getComputedStyle('.miss-flash').opacity` đạt đỉnh `0.98` đúng lúc, và `getBoundingClientRect()` của nó
ra `{top: 0, bottom: 812}` — phủ đúng từ đỉnh màn hình (qua cả dải HUD) xuống tới đáy, thay vì bắt đầu
từ dưới thanh HUD như trước.

## 208. Áp dụng y hệt fix #207 cho lớp opacity đen của cả 3 tutorial overlay (12/09)

**Yêu cầu:** "Làm vậy với lớp opacity đen khi tutorial luôn" — đúng lỗi y hệt #207 nhưng ở
`.ftue-freeze-overlay`/`.ftue-freeze-spotlight` (dùng chung bởi cả 3 tutorial: freeze-orb level 31,
cặp booster level 3, Chain Sort level 5) — cả ba đều render bên trong `.scene-wrap`, bị chính
`overflow: hidden` và inset-dưới-HUD của nó cắt đứt lớp tối trước khi kịp chạm tới góc số đạn/Settings,
dù `.ftue-freeze-spotlight`'s box-shadow spread lớn cỡ nào.

**Khác với #207 ở chỗ:** miss-flash không có toạ độ nào phụ thuộc `.scene-wrap` (chỉ là 1 radial-gradient
phủ đều `inset:0`), dời ra là xong. Ba overlay tutorial này có SPOTLIGHT RING định vị bằng toạ độ pixel
thật (`engine.screenPointForGrid` cho freeze-orb; `getBoundingClientRect()` trừ container cho 2 cái
kia) — toạ độ đó vốn được tính TƯƠNG ĐỐI SO VỚI `.scene-wrap`, nên chỉ dời DOM node ra ngoài thôi sẽ
làm ring lệch đúng bằng chiều cao HUD.

- **Booster (level 3) + Chain Sort (level 5):** cả hai vốn đã tự đo `getBoundingClientRect()` của nút
  thật rồi trừ đi container — đổi thẳng `container = document.querySelector(".scene-wrap")` thành
  `document.querySelector(".game-frame")`. Không cần cộng offset gì thêm vì phép trừ container đã tự
  cho ra đúng toạ độ tương đối với `.game-frame` ngay từ đầu.
- **Freeze-orb (level 31):** `engine.screenPointForGrid` luôn trả về toạ độ tương đối `.scene-host`
  (= `.scene-wrap`), không đổi được hàm engine — giữ nguyên `spot` gốc, cộng thêm `hudOffsetY` đo trực
  tiếp lúc render: `sceneWrapEl.getBoundingClientRect().top - gameFrameEl.getBoundingClientRect().top`
  (khoảng cách thật giữa 2 phần tử, không suy từ công thức CSS `calc()` để khỏi lệch nếu công thức đó
  đổi sau này) — cộng vào `spot.y` trước khi gán `top`.
- Cả 3 block JSX dời hẳn ra khỏi `.scene-wrap`, thành con trực tiếp của `.game-frame` (ngay sau
  `.scene-wrap` đóng), y hệt cách `.miss-flash` đã dời ở #207. `.ftue-freeze-overlay`'s `z-index`: 30 →
  33 (trên cả `.hud-top-left` 31 lẫn `.settings-wrap` 32, cùng tier `.miss-flash`).
- Trục x không cần bù gì — `.scene-wrap`'s left/right vốn đã trùng khít `.game-frame` (`inset: ... 0
  0`), chỉ có top lệch đúng bằng chiều cao HUD.

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn), 174 test
hiện có không đổi (173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185). Verify sống
trên dev server: xoá `sand-cannon:v1:booster-ftue-seen` rồi `GameDevOption` → Level 3 → overlay
"Radius Overcharge" hiện đúng, lớp tối phủ tới tận số vàng/nút Settings ở góc trên (trước đây sáng
nguyên), vòng spotlight vẫn khoanh đúng tâm nút Radius Overcharge thật (không lệch) — bấm xuyên overlay
vào đúng nút vẫn arm được booster như cũ (xác nhận qua ảnh chụp: nút bật sáng xanh, overlay biến mất).
Xác nhận thêm ở bước "Prism Shot" (level khác, HUD có thêm thanh Freeze) — lớp tối vẫn phủ đúng toàn bộ
HUD kể cả thanh Freeze mới, không riêng 2 góc cố định.

## 209. Viết lại tutorial Chain Sort (level 5) theo đúng flow của Radius/Prism: người chơi tự bắn thật (12/09)

**Yêu cầu:** "Tôi muốn flow tutorial giới thiệu chainsort cũng sẽ giống như 2 booster trước đó" — level
3's Radius Overcharge/Prism Shot đã được viết lại thành "tự bắn thật" từ #193; Chain Sort (level 5) khi
đó cố tình GIỮ NGUYÊN kiểu cũ (bắn kịch bản, giữ kết quả 3s, hiện lại caption 3s, không tap thì lặp),
với lý do "Chain Sort không có tự bắn thử vô hại — một phát lan hết một màu sẽ đổi cả bức tranh". Yêu
cầu lần này ghi đè quyết định đó: đưa Chain Sort về đúng cùng flow, chấp nhận đánh đổi đó.

- **`chainSortFtueStep`:** `"intro" | "demo" | "outro" | null` → `"intro" | "shoot" | null` — bỏ hẳn 2
  state phụ `chainSortFtueTapReady`/`chainSortDemoRevealing` (không còn tap-to-continue/loop nào cần
  theo dõi).
- **Xoá hẳn effect bắn kịch bản** (`engine.runScriptedBoosterShot("chainSort", ...)`) cùng 2 hằng số
  `BOOSTER_DEMO_REVEAL_MS`/`BOOSTER_DEMO_CAPTION_HOLD_MS` (không còn nơi nào dùng sau khi xoá effect này)
  — và luôn cả `advanceChainSortFtue` (không còn tap nào để advance thủ công nữa).
- **Thêm 2 effect mới**, đặt ngay cạnh cặp effect của `boosterFtueStep` và TÁI DÙNG chung
  `shootStepBaselineShotsRef` (2 tutorial không bao giờ chạy cùng lúc vì khác level, dùng chung ref an
  toàn):
  - Arm-detection: `chainSortFtueStep === "intro" && armedBooster === "chainSort"` → chuyển sang
    `"shoot"`, ghi baseline `state.shotsUsed`.
  - Settle-detection: `chainSortFtueStep === "shoot"` và `state.phase === "READY"` với `shotsUsed` vượt
    baseline → giữ `BOOSTER_TRY_SETTLE_HOLD_MS` (1s) rồi `setChainSortFtueStep(null)` + bật Shop's
    booster hint —in hệt cách `shoot-prism` của cặp Radius/Prism kết thúc.
- **JSX:** gộp lại thành đúng 1 block như booster (`chainSortFtueStep === "intro"` mới render, không
  còn nhánh "outro"/tap-to-continue) — spotlight vẫn đo `getBoundingClientRect()` trực tiếp so với
  `.game-frame` (đã sửa ở #208), không cần đổi gì thêm cho phần toạ độ.
- **`restart()`/`goHome()`:** phát hiện cả hai từ trước tới giờ chưa từng reset `chainSortFtueStep` về
  `null` (chỉ reset `freezeFtueStep`/`boosterFtueStep`) — một lỗ hổng có sẵn từ bản cũ, vô hại vì luồng
  cũ luôn tự kết thúc đúng cách trước khi có thể bị restart giữa chừng. Thêm `setChainSortFtueStep(null)`
  vào cả hai cho nhất quán với 2 tutorial kia, phòng trường hợp restart giữa chừng bước "intro"/"shoot".
- **`SandCannonEngine.runScriptedBoosterShot`:** xoá hẳn — không còn nơi nào gọi sau khi bỏ effect bắn
  kịch bản.
- **i18n:** `ftueChainSortIntro` đổi đuôi câu từ "Watch!"/"Xem nhé!" sang "Tap it to arm it!"/"Chạm vào
  để trang bị!" (khớp đúng giọng văn `ftueBoosterRadiusIntro`/`ftueBoosterPrismIntro`); xoá hẳn
  `ftueChainSortOutro` (không còn bước "outro" nào dùng tới).

**Test:** `tsc --noEmit` sạch (chỉ 2 lỗi cloudflare-workers-types không liên quan, luôn có sẵn — không
phát sinh lỗi "declared but never used" nào sau khi xoá state/hằng số/hàm), 174 test hiện có không đổi
(173 pass, 1 fail — vẫn lỗi "51 levels" không liên quan, đã ghi từ #185). Verify sống trên dev server:
xoá `sand-cannon:v1:booster-ftue-seen` rồi `GameDevOption` → Level 5 → overlay "This is Chain Sort...
Tap it to arm it!" hiện đúng, lớp tối phủ cả HUD; bấm xuyên overlay vào đúng nút Chain Sort thật → armed
(ring cầu vồng quanh nòng, nút tím), overlay biến mất; bắn `runScriptedShot` một phát thật trúng mảng
cát lớn → `state.phase` đi qua `PROJECTILE_FLYING → SETTLING → READY`, mảng cát cả một góc tranh biến
mất hết (đúng "không giới hạn bán kính"), charge Chain Sort về `0`, không còn overlay nào, người chơi
chơi tiếp bình thường ngay trên board vừa bắn — không reset, không "outro".
