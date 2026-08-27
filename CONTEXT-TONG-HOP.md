# Tổng hợp toàn bộ context dự án 3D Cannon Sort

> Tài liệu này được dựng lại bằng cách đọc toàn bộ 12 phiên làm việc Claude Code đã lưu trong thư mục project (`C:\Users\VNG\.claude\projects\C--Users-VNG-Desktop-3d-cannon-sort-source\`), trải dài từ 19/08/2026 đến 27/08/2026. Nội dung được sắp xếp theo trình tự thời gian, giữ nguyên tên file, tên hàm, số liệu cụ thể để không mất thông tin.
>
> Ghi chú quan trọng: một số phiên có nội dung **trùng lặp hoặc là nhánh song song của cùng một cuộc hội thoại** (ví dụ phiên `90c6c1d6` và `ed5b5ae2` cùng mô tả buổi làm việc ngày 19/08; phiên `9dc5c57e` và `72d29974` cùng mô tả buổi làm việc ngày 24/08, với `72d29974` là phần nối tiếp/tóm tắt của `9dc5c57e` sau khi bị nén context). Các phần trùng lặp được gộp lại, chỉ giữ chi tiết bổ sung.

---

## 1. Giới thiệu dự án

**3D Cannon Sort** là một game puzzle 3D chạy trên nền tảng web, dùng **Three.js** (WebGL) kết hợp **React** để dựng UI, viết bằng TypeScript. Game xuất bản dưới dạng **1 file HTML standalone duy nhất** (nhúng toàn bộ React + Three.js + code game + dữ liệu level), không cần server, mở trực tiếp bằng trình duyệt hoặc double-click trên máy/điện thoại.

Cơ chế cốt lõi ban đầu (theo README lúc dự án mới bắt đầu): người chơi có một khẩu pháo (cannon) bắn đạn vào một cụm khối lập phương màu (cluster) xoay trong không gian 3D; bắn trúng đúng màu sẽ "xếp" (sort) khối đó vào các ô goal tương ứng; có cơ chế batch/reserve (kho chứa tạm), cooldown giữa các phát bắn, giới hạn số phát bắn (shot limit).

Cấu trúc thư mục chính (tại các thời điểm khác nhau trong lịch sử, tên file đã đổi nhiều lần):
- `app/game/CannonSortEngine.ts` → sau đổi tên thành `app/game/SandCannonEngine.ts` (rebrand "Cannon" → "Sand" ở giai đoạn sau, thấy trong git status hiện tại của repo).
- `app/game/types.ts` → `app/game/sand-types.ts`
- `app/game/rules.ts` → `app/game/sand-rules.ts`
- `app/game/level-01.ts`, `levels-sheet.ts` → `app/game/sand-levels.ts`
- `app/GamePrototype.tsx`, `app/LevelEditor.tsx`, `app/globals.css`, `app/loading-screen.ts`
- File mới xuất hiện gần đây (untracked trong git status hiện tại): `app/game/sand-color.ts`, `app/game/sand-sprites.ts`.
- `app/game/renderer-pool.ts` (singleton WebGL renderer)
- `app/game/level-format.ts` (parser CSV/TSV cho level)
- `work/build-standalone.mjs`, `work/standalone-entry.tsx` — script build ra file HTML đơn.
- `work/levels.tsv` / `work/levels.csv` — bảng dữ liệu level dạng beat-chart.
- `outputs/3d-cannon-sort.html` — file game đã đóng gói để chơi/gửi cho user.
- `CHANGELOG-prototype.md` — nhật ký thay đổi (đã lên tới mục 33 vào cuối phiên 22-24/08).
- Bộ test: `tests/*.test.ts` / `tests/*.test.mjs`, dùng chạy bằng `npm test`. Số lượng test tăng dần theo thời gian: 10 → 13 → 21 → 23 → 78 → 122/123/163 → giảm về 123 sau khi cắt bớt cơ chế cũ.

---

## 2. Timeline chi tiết theo phiên làm việc

### 2.1. Phiên 19/08/2026, 12:29 – 15:08 UTC (nhiều bản ghi trùng lặp: `90c6c1d6`, `e3892e56`, `ed5b5ae2`, phần đầu của `b04fc886`)

Đây là buổi làm việc đầu tiên có nội dung thực chất, kéo dài khoảng 2–2,5 giờ. User đổi model 2 lần trong phiên: `/model claude-sonnet-5` (13:01) rồi `/model claude-opus-5` (13:04).

**Yêu cầu của user theo thứ tự:**
1. Dựng lại file HTML standalone (offline, nhúng hết mọi thứ) từ source code hiện có.
2. Sửa lỗi: script build (`work/build-standalone.mjs`) hard-code đường dẫn import esbuild kiểu pnpm, khiến README không chạy được trực tiếp trên máy khác.
3. Chỉnh giao diện:
   - Phần "goals" và "batches" chưa nổi bật, nằm sát rìa màn hình khiến người chơi không để ý.
   - Xóa nền đen hình tròn (circle floor) dưới model.
   - Tăng độ tươi (saturation) cho color palette của các khối.
4. Hỏi tư vấn kỹ thuật: nếu tương lai scale game lên **50 levels** nhúng hết trong 1 file HTML, nên tối ưu theo hướng nào (không phải yêu cầu code ngay, chỉ hỏi định hướng).
5. Hỏi tiếp, cụ thể hơn: nếu dùng "beat chart" (bảng kiểu Excel) để import 50 level, và cần sửa nhanh 1 level bất kỳ, nên chọn phương án nào.
6. Phàn nàn về cách giải thích: *"Hãy giải thích làm sao cho 1 đứa trẻ hiểu, dùng minh họa dễ hiểu. Tôi đọc qua và quá nhiều từ chuyên ngành, không hiểu mẹ gì hết."* — yêu cầu giải thích lại bằng ngôn ngữ đơn giản, có minh họa trực quan.
7. Chốt hướng đi: **"Làm tắt cái máy vẽ cũ trước đã"** — tức ưu tiên làm Phase 1 (sửa vòng đời renderer WebGL) trước khi làm beat-chart Excel.
8. Báo bug nghiêm trọng: **crosshair nhắm vào khối vàng nhưng lại bắn trúng khối tím** — yêu cầu sửa ngay, dùng những từ mạnh như "lừa dối người chơi", "tính minh bạch của system" để nhấn mạnh mức độ quan trọng.
9. Cuối phiên (một trong các bản ghi): user nói *"Tôi sẽ add tính năng này sau nhưng không phải lúc này"* rồi ngắt phiên (bị interrupt, không rõ tính năng nào cụ thể vì bị cắt ngang).

**Phân tích & đo đạc kỹ thuật (trước khi đề xuất kiến trúc):**
- Bundle offline: Three.js chiếm 69% (529.299 byte), React + react-dom chiếm 25% (192.568 byte), code game (engine + rules + UI + level-01) chỉ chiếm 6% (43.498 byte raw minified). Data của 1 level chỉ ~1.226 byte.
- Kết luận: **50 levels không phải là vấn đề dung lượng file** — 50 level DSL nén chỉ tốn thêm khoảng 1,85 KB.
- Thử nghiệm `import * as THREE` (namespace import) so với named imports: **không có khác biệt** (529.299 B vs 529.309 B) vì `WebGLRenderer` đã kéo theo gần hết thư viện — không cần tree-shaking.
- Vấn đề thật cần giải quyết được xác định là 2 việc, không liên quan dung lượng:
  - (a) Vòng đời WebGL renderer: mỗi lần chơi lại tạo `new THREE.WebGLRenderer()` mới mà không giải phóng context cũ → Chrome giới hạn ~16 context sống cùng lúc → sau nhiều lần restart màn hình đen.
  - (b) Cách author level hiện tại (mỗi level 1 file `.ts` với ~15 field viết tay, `id` string thủ công) không scale tốt cho 50 file.

**Quyết định kiến trúc cho level authoring (đề xuất, thực hiện dần ở các phiên sau):**
- Dùng **beat chart TSV/CSV** (dán/export từ Google Sheets/Excel) làm nguồn dữ liệu chính (source of truth), chia 3 lớp workflow:
  - **Lớp 1 (dùng 90% thời gian, tune nhanh):** kéo-thả file TSV/CSV trực tiếp vào game đang mở, không cần build lại, có dev overlay "jump to level N".
  - **Lớp 2 (chốt release):** dữ liệu level đặt trong `<script id="levels" type="application/json">` tách khỏi bundle engine, không bị minify; script `work/build-levels.mjs`/`sync-levels.mjs` chỉ splice lại đúng khối này (đo được ~3,3ms so với full rebuild 255–570ms).
  - **Lớp 3 (hotfix trực tiếp trên HTML đã ship):** sửa tay JSON không-minify trong file HTML đã đóng gói, kèm script `work/extract-levels.mjs` để hút ngược dữ liệu về lại TSV, tránh bị lệch (drift) giữa 2 nguồn.
- Các phương án bị loại bỏ có lý do: 50 file `level-XX.ts` riêng (dễ sai, khó review diff), sửa tay trực tiếp trong HTML đã build (mất đồng bộ với beat chart), viết editor kéo-thả 3D đầy đủ trong game (tốn 1–2 ngày công, không cần thiết vì beat chart đã đóng vai trò editor).
- DSL đề xuất cho mỗi level: 1 dòng string dạng `"4x3x2|RRRO/BBBB/GGGG|PPPO/YYYY/RRRO"` — `dims` + palette 1 ký tự màu/khối theo layer z, hàng y, `/` ngăn hàng, `|` ngăn lớp.
- **Goals tự sinh từ inventory** (đếm số khối theo màu trong `layers`) thay vì ghi tay — đảm bảo bất biến "tổng khối màu == tổng goal cùng màu" không thể sai; `goal_order`/`goal_split` chỉ quyết định thứ tự và cách chẻ goal.
- Literal type cứng trong `types.ts` (`activeGoalSlots: 2`, `batchCapacity: 2`, `missCountsAsShot: true`...) được ghi nhận cần nới thành `number`/`boolean` để hỗ trợ difficulty curve linh hoạt theo nhiều level (chưa làm ngay trong phiên này).
- Lộ trình 4 phase được thống nhất: Phase 1 (chống rò WebGL context, ước ~nửa ngày), Phase 2 (DSL + validate, 1-2 ngày), Phase 3 (progression/save, 1 ngày), Phase 4 (QA/solver/size).
- Phương án giảm size file (nếu cần trong tương lai, không làm ngay): gzip self-extract (đo được giảm 64%, còn ~278KB, DecompressionStream), bỏ React viết HUD thuần vanilla DOM (giảm thêm ~193KB, còn ~574KB), tự viết micro-renderer WebGL thay Three.js (còn ~90KB nhưng tốn 2-4 ngày công, rủi ro cao).

**Tính năng đã implement / lỗi đã fix (kèm file):**
- `work/build-standalone.mjs:3` — sửa `import esbuild from "esbuild"` thay vì hard-code path pnpm; thêm `"esbuild": "0.28.2"` vào `devDependencies` trong `package.json:35`.
- Build ra `outputs/3d-cannon-sort.html` (~787.835–787.868 byte), verify qua browser: React mount đúng, canvas WebGL, goal/batch card render đúng, console sạch, `npm test` 10/10 pass.
- **Chỉnh UI (theo yêu cầu #3):**
  - `app/game/CannonSortEngine.ts`: đổi bảng `COLOR_HEX` sang tông tươi hơn (ví dụ red 0xff5f69 → 0xff4d6a → 0xff3d4d, green 0x45dc9a → 0x2fe58f → 0x24e07f, tương tự cho yellow/blue/purple/orange, chỉnh qua 2 lần lặp); xóa mặt đất tròn đen `CircleGeometry` màu `0x151928`; đổi `FogExp2` từ tím-đen (`0x101321`/0.035) sang tông xanh dương/teal tươi hơn (`#142457` + gradient); tăng cường độ `HemisphereLight` và `DirectionalLight`.
  - `app/GamePrototype.tsx`: cập nhật `COLOR_META` (hex) đồng bộ engine; restructure JSX phần `goal-section`/goal-grid; bọc HUD trong `.hud-top` với viền neon 2px, icon cube nổi khối, số đếm animation "pop", progress bar goal, hiệu ứng `goal-full-glow` khi đầy, card hoàn thành đổi khung viền đứt xanh lá + chữ "XONG"; batch section thêm caption "DỰ TRỮ 0/2", slot to hơn (32px), nhấp nháy cam khi gần đầy.
  - `app/globals.css`: chỉnh biến `--ink`, `--muted`, `--panel`, `--line`; đổi màu nền body/game-frame (loại bỏ radial-gradient tối); biến responsive `--hud-inset`, `--hud-height` (mốc mobile ≤520px, max-height 730px); keyframes `goal-in`, `batch-in`, `batch-warning`.
  - Verify qua browser desktop và mobile viewport (`resize_window`), đọc pixel WebGL thực (`gl.readPixels`) để xác nhận màu nền đúng.

**Phase 1 — Renderer lifecycle fix (đã hoàn thành và verify):**
- File mới `app/game/renderer-pool.ts`: chỉ dùng **1 WebGLRenderer duy nhất** cho toàn trang qua `acquireRenderer()`/`releaseRenderer()`; hàm dọn hẳn gọi `dispose()` rồi `forceContextLoss()` (code cũ thiếu bước này, đây là nguyên nhân leak context).
- `app/game/CannonSortEngine.ts:181` — bỏ tự tạo renderer trong constructor, mượn từ pool; `dispose()` giờ trả lại renderer cho pool thay vì hủy hẳn; chống trường hợp engine cũ trả muộn giành canvas của engine mới.
- **Projectile pool**: tái sử dụng tối đa **8 viên đạn** (geometry/material dùng chung) thay vì `new SphereGeometry`/`MeshBasicMaterial` mới mỗi phát bắn (`CannonSortEngine.ts:49`).
- Test mới `tests/renderer-lifecycle.test.mjs` (3 test) khóa invariant "chỉ 1 renderer được tạo dù restart bao nhiêu lần".
- `work/standalone-entry.tsx`: thêm hook debug `window.cannonSortRendererStats()` để QA kiểm tra số renderer tạo ra; sửa 1 lỗi lint (unused import React).
- Verify: chơi lại 3+ lần liên tiếp qua browser automation, renderer count luôn = 1 (code cũ ra 4); `npm test` 13/13 pass; `npx tsc` sạch; `npm run lint` sạch.
- **Cố ý KHÔNG làm** ở Phase 1: không gộp material theo màu (vì hiệu ứng "bật sáng riêng từng khối khi trúng đạn" ở `CannonSortEngine.ts:976` sẽ hỏng nếu share material); chưa gộp việc đổi màn vào 1 hàm `loadLevel()` để tránh rebuild toàn bộ engine (để dành khi có 50 level thật, chưa cần lúc này).

**Bug fix crosshair (raycast) — mục quan trọng nhất về game logic trong phiên này:**
- **Nguyên nhân**: aim solver cũ tính điểm ngắm 3D theo "mặt phẳng tưởng tượng cố định" ở độ sâu tâm cụm khối, không raycast thật — khi cụm khối xoay, các khối lệch độ sâu khác nhau khiến mặt phẳng lệch khỏi khối hiển thị, dẫn tới bắn trúng khối khác với khối mắt thấy.
- **Fix** trong `app/game/CannonSortEngine.ts`: thêm ray/AABB helper ngay sau `sweptSphereAabbEntry`; tách `targetPlanePoint` ra `cameraRay`; thêm hàm `raycastBlockSurfacePoint`; cắm vào `solveAimAtScreenPoint` — giờ bắn tia thật từ camera qua tâm ngắm, dò khối chạm đầu tiên (trong không gian đã xoay), chỉ fallback về mặt phẳng cũ khi tâm ngắm không rơi lên khối nào.
- **Verify 3 tầng độc lập**: (1) so sánh với `THREE.Raycaster` gốc của Three.js; (2) đo cách cũ chỉ đúng 31% số lần khi cụm xoay, cách mới đúng 100%; (3) bắn thật qua đúng pipeline game (`solveAimAtScreenPoint → fire → updateProjectile`), đọc kết quả DOM (burst-label) — bắn trúng đúng 3 khối đỏ, thẻ mục tiêu tăng 3/6.
- Thêm 2 test hồi quy khóa fix này; `npm test` 23/23 pass; gỡ sạch mọi hook debug tạm trước khi chốt bản; build lại HTML cuối, gửi qua `SendUserFile`.

**Feedback quan trọng của user trong phiên này:**
- Phàn nàn về ngôn ngữ chuyên ngành → Claude dùng `mcp__visualize` vẽ minh họa (balo, tivi, quyển sổ Excel) để giải thích lại — user chấp nhận.
- Nhấn mạnh tính minh bạch/công bằng gameplay khi báo bug crosshair — coi đây là vấn đề nghiêm trọng ảnh hưởng lòng tin người chơi.
- Thích cách tiếp cận đo đạc số liệu thật (byte, ms, tỷ lệ % chính xác) trước khi ra quyết định kiến trúc, thay vì lý thuyết suông.
- Thích chọn từng bước nhỏ tuần tự ("Bắt đầu cái nào trước?" → chốt "Làm tắt máy vẽ cũ trước") thay vì làm hết một lần.
- Muốn tự làm beat chart Excel/TSV theo cách riêng rồi gửi lại sau, thay vì để Claude định hình toàn bộ workflow authoring — cho thấy muốn giữ quyền kiểm soát nội dung level.

---

### 2.2. Phiên 19/08 (tiếp) → 20/08/2026, đến 10:53 UTC (`b04fc886`)

Phiên này tiếp nối trực tiếp phiên 2.1 (cùng ngày bắt đầu), có gián đoạn do chạm giới hạn session (hit usage limit) khoảng 20/08 04:32, resume lại lúc 07:11.

**Các yêu cầu tiếp theo (sau khi Phase 1 renderer hoàn thành):**
1. Xin lại **template TSV** cho level authoring.
2. Yêu cầu hỗ trợ **CSV** thay vì TSV (vì Excel không mở TSV thuận tiện).
3. Sửa UI: ẩn goal card khi đã hoàn thành (bỏ chữ "XONG"); sửa animation khối bay vào goal bị tràn ra ngoài màn hình khi mục tiêu ở gần mép.
4. Yêu cầu **multi-touch**: 2 ngón tay đồng thời — 1 tay xoay model, 1 tay ngắm bắn — đồng thời thêm **haptics** (rung phản hồi), Claude đề xuất các mức độ rung để user chọn.
5. Yêu cầu implement 2 cơ chế mới từ file draft `6.barrel-link-block-draft_claude.md`: **Barrel** (khối bọc vỏ nhiều lớp) và **Link** (móc nối giữa 2 cụm khối), cập nhật TSV để test ở level 4 và 5.
6. Loạt feedback chi tiết để chốt thiết kế Barrel/Link (màu sắc từng lớp vỏ, số lớp, hành vi khi Link bị khóa bởi Barrel, animation mảnh vỡ khi phá).
7. Yêu cầu xuất bàn giao: 1 file `.md` changelog + zip source code + file CSV levels.
8. Yêu cầu thêm **Menu HUB screen** (màn hình chính khi mở game) theo bản vẽ mẫu, chuyển các control (chọn level, import CSV) từ trong game ra Menu HUB.
9. Yêu cầu: bỏ viền trắng mờ quanh model; thêm **intro zoom animation** (~1 giây) khi chuyển từ Menu HUB sang màn chơi; HUD (goal/batch/cannon) phải "trồi lên" thay vì bay vào/xuất hiện đột ngột.
10. Yêu cầu: bỏ crosshair hiện nhầm ở Menu HUB (bug); thêm animation trồi lên cho nút setting/replay.
11. Yêu cầu đổi vị trí nút (Next level bên phải, Replay bên trái; No bên trái/Yes bên phải); dịch toàn bộ ngôn ngữ game sang **tiếng Anh**; đồng nhất shape/kích thước nút settings giữa Menu HUB và trong game.
12. Báo bug: **flash/lóe hình** khi chuyển từ Menu HUB sang màn chơi, phát hiện trên **điện thoại thật**.
13. Yêu cầu thêm animation batch → goal (dưới 1 giây, không được bỏ qua animation khiến người chơi không hiểu chuyện gì đã xảy ra).

**Quyết định thiết kế/kiến trúc:**
- **Level authoring qua CSV/TSV** (mở rộng từ phiên trước): cột `dims`, `layers` (ký tự màu R/G/Y/B/P/O, `/` ngăn hàng, `|` ngăn lớp), `goal_order`, `goal_split`, `goal_slots`, `batch_slots`, `shot_limit`. File format: `app/game/level-format.ts`, **tự nhận diện delimiter** (tab/phẩy/chấm phẩy) để linh hoạt khi user copy từ Excel/Sheets khác nhau.
- **Batch auto-fill animation**: tách `resolveCluster` thành `nextBatchAutoFill` (mô tả bước kế tiếp, hàm thuần/pure) và `applyBatchAutoFill` (áp dụng 1 bước) — giữ nguyên hành vi luật cũ, chỉ thêm animation phát trước khi apply state thật. Thời lượng scale theo số khối: 480ms (1 khối) đến 820ms tối đa (12+ khối), luôn dưới 1 giây.
- **Barrel mechanic**: vỏ đục màu xám-đen theo số lớp (1-3 lớp: đen `#1c1d22` = 3 lớp, xám `#74777f` = 2 lớp, xám trắng `#d8dae0` = 1 lớp), mỗi phát bắn chỉ bong đúng 1 lớp, texture kim loại vẽ bằng canvas runtime.
- **Link mechanic**: nối 2 cụm khối qua cột `links` (ví dụ `0.0.0>0.0.1`), **chỉ hỗ trợ cặp đôi** (không hỗ trợ chuỗi 3+ cụm — parser báo lỗi nếu phát hiện chuỗi). Nếu A link B mà B còn Barrel bọc, bắn A sẽ không phá được gì cả (khóa cả cặp cho tới khi Barrel được gỡ); 1 phát bắn thắng cả 2 cụm cùng lúc sẽ tạo 2 batch giao dịch riêng.
- **Menu HUB**: engine có "idle mode" (model tự xoay khi ở Menu), bấm "Tap to play" thì model snap về orientation cố định + zoom từ 62% lên 100% trong ~1 giây (ease-out, slerp rotation), HUD trồi lên tại chỗ thay vì bay vào từ đâu đó. Người chơi chỉ được bắn sau khi intro kết thúc để tránh sai số raycast khi model đang di chuyển.
- **Haptics**: dùng `navigator.vibrate()` (chỉ hoạt động trên Android Chrome, **không hỗ trợ iOS Safari**); mức **"Vừa" (mức B)** được chọn: đạn trúng 25ms, khối rơi giảm dần 18ms→10ms (cap tối đa 6 khối), goal hoàn thành/batch/thắng-thua có pattern rung riêng; ưu tiên theo mức quan trọng khi nhiều sự kiện trùng lúc (vì `vibrate()` ghi đè lẫn nhau, không cộng dồn).

**Tính năng đã implement / lỗi đã fix (kèm file):**
- `app/game/CannonSortEngine.ts`: raycast aim fix (kế thừa từ phiên trước), projectile pool, dispose/forceContextLoss, multi-touch (bỏ 2 điều kiện chặn chéo `canStartAim`/`canRotateModel` để cho phép đồng thời), logic barrel/link trong `handleHit`, idle mode, intro zoom, các lệnh gọi haptic.
- `app/game/level-format.ts`: mở rộng parser CSV/TSV tự nhận delimiter, thêm cột `links`, `barrel_layers`.
- `app/game/sort-flight.ts` (file mới): module thuần tính quỹ đạo bay của khối khi vào goal, kẹp trong khung với lề 14px (sửa lỗi tràn màn hình khi mục tiêu sát mép trên).
- `app/GamePrototype.tsx`: ẩn goal card khi hoàn thành, render Menu HUB, animation HUD trồi lên, animation batch→goal, đổi vị trí nút.
- `app/globals.css`: xóa CSS chết (chữ "XONG"), style Menu HUB, keyframes `hub-rise`, `hub-exit-down`.
- `tests/renderer-lifecycle.test.mjs`, `tests/aim-source-regression.test.mjs`, và nhiều test khác — số lượng tăng dần từ 10/10 lên **78/78 pass** vào cuối phiên này.
- Bug fix: thêm `-webkit-tap-highlight-color: transparent` trên `body` để sửa flash trên mobile khi chuyển Menu→in-game; tách animation nhấp nháy "TAP TO PLAY" ra span con riêng; tắt viền focus toàn màn hình.
- Bug fix: `showIdleCrosshair()` bị `ResizeObserver` gọi lại bật crosshair sai lúc đang ở Menu — sửa bằng cách toggle theo trạng thái thay vì luôn add class.
- **Dịch toàn bộ game sang tiếng Anh** (HUD, modal, aria-label, error message, tên level trong CSV), có thêm test chặn hồi quy ký tự tiếng Việt còn sót.
- Đóng gói bàn giao: `CHANGELOG-prototype.md`, `outputs/3d-cannon-sort-source.zip` (161KB, 50 file, verify build lại byte-identical bằng SHA256), `work/levels.csv`.
- Tạo Pull Request tự động (repo `nhuay2404/3d-cannon-sort-source`, branch `main`) lúc 10:40.

**Vấn đề tồn đọng khi kết thúc phiên này:**
- Haptics cho trường hợp bắn trượt / bấm nút / bắt đầu ngắm — user chưa quyết định có cần hay không.
- **Link chuỗi (§2.4.3)** — hiện chỉ hỗ trợ cặp đôi, chưa hỗ trợ chuỗi A→B→C; user chưa trả lời rõ ràng khi được hỏi ("Nói gì z"), cần làm rõ thêm ở phiên sau.
- Level 4 trong CSV có 15 khối thay vì 16 dự kiến (cụm xanh lá chỉ 1 khối do lỗi gõ `...Y` thay vì `G..Y`) — đã báo cho user nhưng chưa sửa vì ngoài phạm vi yêu cầu lúc đó.
- Hàng "DỰ TRỮ 0/2" (batch) vẫn hiện dù goal đã ẩn hết ở màn auto-clear — user chưa yêu cầu ẩn nốt.
- Repo lúc đó **chưa có git** — từng bị mất file `work/levels.tsv` khỏi đĩa giữa chừng, phải khôi phục từ bản đã đóng gói trong code; Claude đề xuất user init git để có "mạng lưới an toàn" (git init sau đó đã được thực hiện, vì trạng thái hiện tại repo đã có git).
- Phase 2-4 của lộ trình 50 levels (DSL nén, progression/save, InstancedMesh optimization, gzip self-extract) được đề xuất nhưng **chưa triển khai** trong phiên này.

---

### 2.3. Phiên 20/08/2026, 15:03 UTC (`3a16a34a`) — phiên ngắn, bị ngắt sớm

Phiên này rất ngắn (chưa đầy 30 giây), user đưa ra yêu cầu rồi ngắt ngay khi Claude vừa đọc xong CHANGELOG (chưa kịp thực hiện gì). **Ba yêu cầu treo** (chưa rõ được thực hiện ở phiên nào, cần đối chiếu code hiện tại để xác nhận):
1. Khi 1 cụm khối bị phá vỡ, tạo hiệu ứng đẩy ngược dạng **"sóng" lan ra** từ khu vực vừa bị phá (giống làn sóng xung kích, không phải đẩy đơn thuần).
2. Thêm hiệu ứng **khói trắng solid** tỏa ra tại điểm tiếp đất khi đạn từ cannon chạm đất — dạng "khói vuông" (square smoke).
3. Sau khi hoàn thành 1 màn và bấm sang màn kế tiếp: **bỏ việc quay về Menu Hub**, hiển thị luôn puzzle màn kế tiếp — chuyển cảnh bằng cách model zoom out, xoay ~180° trong 0.7 giây, rồi về vị trí mặc định.

*(Các yêu cầu này khớp với các mục đầu tiên trong phiên 2.4 bên dưới — có vẻ là cùng một yêu cầu được gửi lại ở phiên kế tiếp cùng ngày.)*

Lúc đọc CHANGELOG, Claude ghi nhận các TODO đang tồn đọng từ trước: chuỗi link 3 cụm (đỏ→tím→cam) đang bị chặn cần chốt có cho phép hay không; cách hiểu "cả cặp bị khóa" khi bắn A không phá được gì cần xác nhận; barrel lồng nhau hiện là 3 lớp của cùng 1 vỏ (đổi màu) chứ không phải 3 vỏ lồng riêng biệt; hàng "DỰ TRỮ 0/2" vẫn hiện dù rỗng.

---

### 2.4. Phiên 20/08/2026, 15:04 UTC → 21/08/2026, 11:44 UTC (`d5f1f5cb`) — phiên dài nhất về số lượng tính năng UI/VFX

Phiên kéo dài ~20,5 giờ (có ngắt quãng), có một lần `/compact` (nén context) lúc 10:59:29 ngày 21/08 do hết context.

**25 yêu cầu chính theo trình tự thời gian (trích nguyên văn ý chính):**
1. **15:04** — 3 yêu cầu polish lớn (giống phiên 2.3): (a) hiệu ứng đẩy ngược dạng sóng khi cụm khối bị phá; (b) khói trắng solid khi đạn tiếp đất; (c) khi qua màn kế tiếp không quay về Menu Hub, model zoom out + xoay 180°/0.7s rồi về vị trí mặc định.
2. **15:24** — Xóa UI hit-feedback kiểu `[Green +2]`; đổi khói từ hình vuông thành hình tròn.
3. **15:31** — Fix lỗi cannon bị giật khi chuyển màn, yêu cầu mượt hơn.
4. **15:43** — Model "link" (mốc nối) phải là **1 mốc nối giữa 2 block**, không phải mỗi block một mốc riêng.
5. **16:04** — Nẹp (strap) phải xuất hiện ở **tất cả** giao điểm giữa 2 block trong cùng cụm 2 màu.
6. **16:11** — Phản hồi lỗi: *"Vẫn thiếu 2 cặp block này là sao, phải full hết chứ?"* — strap phải phủ đầy đủ 100%.
7. **16:19** — Đạn bắn ngoài tầm, không trúng block: khi rơi phải nhỏ dần + có particle rơi.
8. **16:25** — *"tôi thấy vệt bị dày"* — yêu cầu làm mỏng vệt (trail) đạn.
9. **02:19 (ngày 21/08)** — Yêu cầu lớn: xây **hệ thống cosmetic**: nút Skin mở UI chọn skin theo ảnh mẫu, có preview animation cannon bắn ở trên, danh sách chọn cosmetic (cannon + magic wand) ở dưới.
10. **"BIG UPDATE"** — thêm cosmetic **bàn tay cầm đũa phép**: bắn ra có tia phép thuật, đáp đất có hiệu ứng lấp lánh (bling), nếu rơi ngoài tầm thì nổ như pháo hoa nhỏ.
11. **03:08** — Chỉnh star wand: đầu đũa/phần bắn ra phải giống gậy phép Harry Potter; xóa currency tím, nút Skin, nút Shop, và UI số level hiển thị trong Skin Hub.
12. **03:19** — Đũa hiện tại quá mảnh — muốn quay lại độ dày cũ, nhưng bỏ các tấm plane màu solid ở đầu ụ súng, làm model mượt (smooth) hơn.
13. **03:25** — Loại bỏ phần nhô lên ở khối trắng (bàn tay); đổi crosshair thành vòng tròn pháp trận (magic circle) cho Star Wand.
14. **03:38** — Phóng to bàn tay lên cỡ ngang model cannon, hiển thị đúng là 1 bàn tay thật; kéo dài tay áo.
15. **04:50** — **Đảo ngược quyết định**: *"Model bàn tay quá xấu. Tôi không muốn nữa"* — bỏ hẳn model bàn tay, quay về dạng ụ súng phép thuật, kích cỡ gần bằng Field Cannon.
16. **04:57** — Fix lỗi sprite ở đuôi **cả hai** cannon bị trồi ra/vào kỳ cục trong animation bắn.
17. **05:52** — Hỏi: build này có cần màn hình tải (loading screen) không?
18. **06:01** — Yêu cầu implement UI loading dùng ảnh mẫu, có text loading + progress bar.
19. **06:15** — Fix bug: particle effect trong Skin Hub vẫn tiếp tục chạy sau khi đã đóng Skin Hub về Menu Hub.
20. **06:19, 06:41, 06:55, 07:11** — "Try again" / "Continue from where you left off" (resume các lượt bị gián đoạn, không phải yêu cầu mới).
21. **07:48** — Build lại file HTML để chơi trên máy thật; dọn dẹp file trùng lặp phát hiện được.
22. **10:16** — Yêu cầu Skin Button có icon, gợi ý hình ụ súng.
23. **10:40** — Lệnh tạo Pull Request (tự động).
24. *(Sau /compact)* **11:00** — Sửa UI kết thúc màn chơi: hiện tại chỉ là lớp phủ mờ trông "out of nowhere"; muốn cô đọng thành 1 box popup có khung/viền, có VFX pháo hoa, animation popup kiểu trồi ra theo chiều sâu (cone).
25. **11:12** — Layout finish UI bị chừa khoảng trống ở trên (dải sáng không bị che) — yêu cầu sửa.
26. **11:40** — Nút select/selected trong Skin Hub quá to, cần scale nhỏ lại; phần đáy model súng bị tối quá, cần chỉnh sáng.

**Quyết định thiết kế/kiến trúc quan trọng:**
- Dùng **BFS ring** cho hiệu ứng sóng phá vỡ cluster (`sendBreakWave`), delay/amplitude giảm dần theo từng ring.
- Khói: `SphereGeometry` màu trắng solid, biến mất bằng cách **co nhỏ dần** (không dùng alpha fade).
- Link/strap: chuyển từ "mỗi block một mốc nối" sang **connector chung giữa 2 block** dạng nẹp ngoài (outside strap), phủ **tất cả các mặt tiếp xúc mở** giữa 2 cụm màu, chọn theo khoảng cách → face rank → id.
- Chuyển màn: model zoom out, xoay 180° trong 0.7 giây rồi trả về vị trí mặc định (không quay Menu Hub).
- Hệ cosmetic: tách riêng file `app/game/cosmetics.ts` làm registry (id, rig builder, thumbnail capture qua render-target 192², flip hàng, toDataURL).
- Sau nhiều vòng lặp qua lại (đũa phép → bàn tay → bỏ bàn tay), quyết định **cuối cùng** chốt: cosmetic thứ 2 là "**Rune Cannon**" — 1 ụ súng phép thuật kích cỡ gần bằng Field Cannon, **không phải** model bàn tay.
- Loading screen: markup tĩnh + SVG inline, các mốc tiến trình `boot(0.34) → mount(0.58) → engine(0.86) → ready(1)`, inject qua `layout.tsx` và `build-standalone.mjs`.
- UI kết thúc màn: đổi từ overlay phủ toàn màn sang **result-card** có khung/viền vàng (đỏ khi thua), pop-up 3D theo trục z (`perspective: 720px`, translateZ từ -300px → 34px → 0), kèm 18 tia pháo hoa DOM chỉ hiện khi thắng.
- Cách xác minh xuyên suốt: đo bằng số liệu (screen-space projection, alpha bounding-box, rasterize ASCII, quét regex/geometry) thay vì quan sát trực quan — vì **browser pane trong môi trường này không composite được, requestAnimationFrame không chạy**, nên animation/first-paint không thể xem trực tiếp; điều này được nhắc lại nhiều lần với user như một giới hạn môi trường.

**Tính năng đã implement / lỗi đã fix (kèm file):**
- `app/game/SandCannonEngine.ts` (đổi tên từ `CannonSortEngine.ts` — mốc đổi tên này nằm đâu đó trong phiên) — break wave, smoke, projectile fall/fade/trail, handoff intro (chuyển màn), link bridges/straps, cosmetic rig, sparkles/fireworks, showcase preview, sửa lỗi particle còn sót sau khi đóng Skin Hub (`setShowcase`/`clearParticles`), sửa sprite đuôi cannon bị trồi.
- `app/game/cosmetics.ts` (file mới) — registry cosmetic, `buildClassicCannon`, `buildMagicWand` (Rune Cannon), housing scale, thumbnail capture.
- `app/loading-screen.ts` (file mới) — markup + SVG loading screen, `advanceLoading`, `finishLoading`.
- `app/GamePrototype.tsx` — cosmetic picker UI, xóa burst-label UI, thêm `CannonMountIcon()` SVG cho nút Skin, sửa layout result-overlay (đưa ra khỏi `.scene-wrap` để không bị inset HUD che khuất/cắt pháo hoa), giảm kích cỡ nút select/selected (min-width 168→124px, padding 13px 30px→9px 22px, font-size 16→13px).
- `app/globals.css` — CSS cho crosshair magic-circle, cosmetic UI, loading UI, result-card/keyframes/pháo hoa, hub-side-icon, giảm scrim tối ở `.cosmetic-screen` (alpha tại mốc 55% chiều cao giảm từ 0.34 xuống 0.07, tổng giảm 64% dọc dải rig 26–55%).
- `app/layout.tsx`, `work/build-standalone.mjs`, `work/standalone-entry.tsx` — nhúng loading screen vào build.
- `app/game/sand-types.ts`, `app/game/sand-rules.ts` — bỏ `linkFittings`, bỏ `colorLabel()`.
- Nhiều file test mới/sửa (level-editor, sand-mechanics, impact-feel, level-handoff, link-bridge, cosmetics, loading-screen, result-screen...) — tổng đạt **122/122 test pass** ở cuối phiên.
- Build lại HTML nhiều lần, kích thước cuối ghi nhận **847 KB**.
- Dọn dẹp file trùng lặp bằng SHA1 hashing (phát hiện cây nested copy 0 file unique) — giải thích luôn vì sao `tsc` từng chạy 300s+ (do tsconfig quét luôn cây trùng lặp) — sau khi dọn, `tsc` còn 8.7s.

**Vấn đề tồn đọng cuối phiên này:**
- File build mới nhất **chưa được gửi cho user** một lần vì tool `SendUserFile` bị disable trong session — phải nói đường dẫn `outputs/3d-cannon-sort.html` cho user tự lấy.
- Chưa xác nhận trực quan (do môi trường không composite được) nhiều hạng mục: icon nút Skin ở kích thước thật, art/timing loading screen trên máy thật, rig Rune Cannon, crosshair rune circle, cảm giác sóng/khói/sparkle, việc particle không còn kéo dài sau khi đóng Skin Hub, độ pop-up và mật độ pháo hoa của result-card, cỡ nút select mới và độ sáng đáy model súng.
- Đề xuất chưa thực hiện: zip lại source hiện tại và xóa file zip cũ `outputs/3d-cannon-sort-source.zip`; cho nút Shop icon tương xứng; làm icon Skin phản ánh đúng skin đang trang bị.

**Feedback nổi bật của user:**
- Nhiều lần đổi ý giữa chừng, phản hồi trực tiếp bằng hình ảnh/screenshot để chỉ lỗi cụ thể.
- Phản hồi mạnh nhất phiên: **"Model bàn tay quá xấu. Tôi không muốn nữa"** — đảo ngược hoàn toàn hướng cosmetic thứ 2.
- Chủ động kiểm tra file, phát hiện file trùng lặp, yêu cầu dọn dẹp — quan tâm giữ codebase/build sạch.

---

### 2.5. Phiên 21/08/2026, 13:27 UTC (`795d95b4`) — phiên trống

Toàn bộ phiên chỉ gồm user gõ đúng 1 tin nhắn `"claude rc"`, sau đó request đầu tiên bị chặn ngay bởi rate limit (429 — hết hạn mức session, reset lúc 14:10 giờ Bangkok). Không có tool call, không sửa file nào. Không liên quan tới nội dung dự án.

---

### 2.6. Phiên 22/08 – 24/08/2026 (`1424d5d3`) — redesign hàng loạt cơ chế gameplay

Phiên trải dài từ 22/08 09:16 đến 24/08 02:17, có ít nhất 2 lần gián đoạn (máy sleep/mất kết nối API) và 1 lần bị nén context (compaction).

**15 yêu cầu chính theo trình tự:**
1. **Redesign UI Batch**: thay pill nhàm chán bằng "vật chứa các block". Sau khi Claude đề xuất nhiều mẫu, **user chọn "Tray"**, không hiện số (chỉ dùng chính các block làm chỉ báo), giữ chiều cao 32px. Yêu cầu cập nhật changelog + rebuild HTML.
2. Fix dev server không khởi động được (`vinext dev` báo đã có instance chạy, PID 9392).
3. **Đổi logic Batch System**: từ 2 slot cố định sang giới hạn tối đa X block. User hỏi ngược lại Claude cách thiết kế hợp lý, rồi quyết định: dùng **một khay chung**, chỉ chặn bắn khi khay tràn, **bỏ hẳn mechanic Link và Barrel** (ghi vào changelog), **xóa level 4 và 5**, fix crash ở level 3.
4. **Fail condition mới**: "Khi batch full mà phát tiếp theo bắn không giải quyết được queue thì fail" (đảo ngược quyết định "chặn bắn" ở bước trước).
5. Sửa UI khu vực reserved: bỏ icon "0/8", thay bằng 8 slot block dàn ra.
6. **Redesign Weakpoint**: weakpoint xuất hiện cả ở mặt trong (không chỉ mặt ngoài); khi bắn trúng weakpoint bóng phải **nảy ra** (không bị tiêu hủy như cũ); điều kiện trúng là bắn trúng **một mặt cụ thể của block** (không phải theo bán kính bullseye — bullseye chỉ là minh họa hình ảnh); khi bắn trúng vùng không phải weakpoint thì hiện hiệu ứng khiên xanh dương bao bọc.
7. **Redesign hoàn toàn Rainbow Climax**: bỏ toàn bộ khái niệm cũ. Spec mới: 2-3 mục tiêu rainbow bay tự do (phi tuyến tính) trong 4.5 giây rồi biến mất; model là tấm bia tròn 7 màu cầu vồng; bắn trúng → phát kế tiếp bỏ qua weakpoint; hiệu ứng: pháo hoa rơi, HUD wave cầu vồng, lớp filter cầu vồng quanh ụ súng, chữ thông báo, weakpoint ẩn cho đến phát tiếp theo; loại bỏ hẳn thanh timer/precision/label weakpoint cũ. Quyết định chi tiết: bỏ timer hẳn, spawn ngẫu nhiên có seed rải trong round, buff không cộng dồn (giữ tới phát sau), chỉ phát bắn trúng khối mới tiêu buff.
8. **Sửa lại Tutorial toàn diện**: (a) flow dạy sai luật (2 lesson đầu không có bullseye nhưng vẫn bắn được, lesson 3 mới hiện bullseye); (b) tutorial hub/overlay che mất vùng chơi — đề xuất dùng màn đen mờ (scrim) + khoanh tròn vùng hướng dẫn kèm text + mũi tên; (c) dùng pictogram thay vì tường chữ.
9. **Làm lại 5 level đầu tiên** theo kiểu game puzzle chuẩn (đường cong độ khó dễ → khó dần).
10. **Rainbow Climax xuất hiện quá dày**: yêu cầu thiết lập rule để nó **hiếm** (ví dụ level 1,2 không có, level 3 có 1...), đặt rule ngay trong `levels.csv`/`levels.tsv`. Đồng thời: khi goal chỉ còn 1 và nằm bên phải, cho animation lướt sang trái kiểu cartoon.
11. **Đổi model block**: bo tròn góc, sáng hơn.
12. Chỉnh nhỏ: **"Hạ xuống 0.16"** (giảm bán kính bo góc từ thử nghiệm 0.2 xuống 0.16 sau khi xem trong game).
13. Chỉnh tiếp Tutorial: (a) tắt scrim ngay khi vừa chạm súng ở bước "drag to aim"; (b) đổi flow "Match the goal" thành chuỗi thẻ tuần tự: match goal → no match waits → reserve auto sort → tap lần nữa mới tắt scrim; (c) rainbow hitbox xuất hiện ngay sau khi phá cụm đỏ, tắt scrim ngay khi trúng rainbow.
14. Tính năng mới: **giữ (hold) trên puzzle sẽ khiến nó quay về vị trí ban đầu**; hướng dẫn tính năng này luôn trong tutorial.
15. Thêm **Level 9**: rất khó, buộc người chơi phải nhắm trúng rainbow target hoặc dùng full batch mới qua được — đây là yêu cầu cuối cùng trong phiên, đã hoàn thành.

**Quyết định thiết kế/kiến trúc quan trọng:**
- Batch: chuyển sang mô hình **1 khay chung giới hạn X block**, xác định X bằng brute-force dữ liệu trên mọi thứ tự cluster (peak slot vs peak block lệch 4×; X=8 là superset nhỏ nhất chặt).
- Loại bỏ hẳn mechanic Link và Barrel (từng được làm ở phiên 2.2).
- Rainbow Climax viết lại thuần túy (pure function, không React/Three.js) trong `app/game/rainbow-hook.ts`: đường bay dùng seeded sine (3 harmonics), dải v (tầm với crosshair) được đo thực tế trong game và hiệu chỉnh 2 lần (0.26–0.72 → 0.16–0.42/entry-exit, clamp 0.12–0.48).
- Weakpoint: điều kiện trúng chuyển từ bán kính bullseye sang **đúng một mặt block** (`authoredFaceHit`).
- Rule "hiếm hóa" Rainbow viết thẳng vào comment header của `work/levels.tsv`: tối đa 1 target/màn, phần lớn màn = 0, `rainbow_spawn_gap` đóng vai trò "sớm nhất khi nào xuất hiện".
- Block geometry: `BoxGeometry` → `RoundedBoxGeometry` (addon Three.js, extends BoxGeometry nên **không phải sửa code va chạm**), bán kính bo góc cuối cùng chốt ở **0.16**; vật lý/collision **vẫn giữ hình hộp** có chủ ý (để điều kiện weakpoint "một mặt" vẫn rõ ràng).
- Độ sáng block: dùng `emissive` = chính màu block, cường độ 0.2 (không tăng đèn scene, không đổi `COLOR_HEX` để giữ đồng bộ màu HUD).
- Tutorial: thay overlay che màn bằng **scrim + spotlight dùng chung 1 element** (box-shadow spread 2000px tạo lỗ thật); cue là pill mũi tên tự đặt đối diện vòng khoanh; pictogram SVG 24×24 + text ngắn (text đầy đủ giữ trong `aria-label` cho accessibility).
- Thêm `modelScreenBounds()` vào engine để chiếu 8 góc Box3 qua camera → vòng khoanh tutorial theo đúng cụm model ở mọi kích thước màn hình, kể cả khi xoay.
- "Hold to reset": `MODEL_HOLD_MS = 460`, `MODEL_HOLD_SLOP = 12px` để phân biệt giữ với kéo; đếm bằng frame clock (không dùng `setTimeout`).
- Event mới `AIM_TOUCHED` phát ngay khi chạm (trước `setPointerCapture` để tránh throw làm mất phần còn lại của handler).

**Bug đáng chú ý đã tìm và sửa:**
- Crash thật ở level 3: 48/720 thứ tự hợp lệ throw lỗi "active goals must use different colors" do `checkGoalWindows` chỉ kiểm cửa sổ liên tiếp; fix bằng cách defer goal trùng màu (`fillWaitingSlots`).
- Lỗi giả lập của chính Claude: dùng `shotIndex: 1` cho mọi claim khiến batch id trùng nhau → 10.776 kết quả "unwinnable" giả.
- CSV bị hỏng do quote cả dòng comment `#`.
- Marks ở mặt hông (`PX`) không bắn được ngay vì đạn luôn bay từ phía camera → phải đổi thiết kế mark một số level.
- Slab cao 1 ô không đọc được hình (camera nhìn gần như từ trên) → đổi kích thước khối.
- `rainbow_target_count` dùng `parsePositiveInteger` không nhận giá trị 0 → phải nới để author level không-bonus.
- Ba chỗ trong "break-wave" đặt `emissiveIntensity = 0` khi trả block về nghỉ, quên cập nhật lại thành 0.2 sau khi thêm glow → gây block "tối vĩnh viễn" sau khi bị sóng phá chạm qua.
- Bug tự tạo trong tutorial: bỏ khóa màu bằng cách trả `null` nhưng predicate vẫn so `null === color` → không gì claim được (bàn trông chơi được mà không chơi được).
- React `removeChild` console error do chính probe của Claude ghi `innerHTML` vào DOM React quản lý.
- `document.hidden` đóng băng `requestAnimationFrame`, khiến driver test-trong-game tưởng game bị treo.

**File chính bị sửa/đổi:** `CannonSortEngine.ts`, `rainbow-hook.ts`, `types.ts`, `level-format.ts`, `tutorial.ts`, `tutorial-levels.ts`, `level-01.ts`, `GamePrototype.tsx`, `globals.css`, `work/levels.tsv`/`levels.csv`, `work/sync-levels.mjs`, nhiều file test (`rainbow-hook.test.mjs`, `weakpoint-rainbow-integration.test.mjs`, `level-sheet.test.mjs`, `tutorial.test.mjs`, `result-screen.test.mjs`, `game-rules.test.ts`), và `CHANGELOG-prototype.md` (lên tới mục 32).

**Kết quả cuối phiên:** **163/163 test pass**, lint sạch, `tsc` chỉ còn 3 lỗi tồn tại từ trước ở `db/`/`worker/` (không liên quan game). Không có TODO tồn đọng rõ ràng — mỗi yêu cầu đều được đóng vòng: sửa code → chạy full test suite → rebuild HTML → kiểm chứng trực tiếp trong game → cập nhật changelog.

**Feedback/thói quen làm việc của user:**
- Dùng "Try again"/"Sửa" ngắn gọn để tiếp tục sau khi bị gián đoạn, không cần lặp lại toàn bộ yêu cầu.
- Ra quyết định thiết kế qua các câu hỏi trắc nghiệm mà Claude chủ động đặt ra — user hài lòng với cách này, được lặp lại nhiều lần.
- Đưa phản hồi cụ thể, chi tiết về UX/feel (animation "lướt kiểu cartoon", core learning flow tutorial) — quan tâm sâu trải nghiệm người chơi hơn chỉ chức năng.
- Claude tự báo cáo minh bạch lỗi do chính mình gây ra khi phát hiện (ví dụ tự sửa lại changelog khi phát hiện ghi sai quyết định bo góc 0.2 thay vì 0.16 đã chốt).

---

### 2.7. Phiên 24/08/2026, 02:49 – 11:45 UTC (`9dc5c57e`, tiếp nối bởi `72d29974` 09:15–11:46) — GDD, tap-to-fire, sự cố mất dữ liệu OneDrive

Đây là phiên dài và **quan trọng nhất về sự cố kỹ thuật** trong toàn bộ lịch sử dự án. `72d29974` là phần tiếp nối của `9dc5c57e` sau khi bị nén context — cùng một mạch công việc, không phải 2 yêu cầu độc lập.

**Yêu cầu của user theo trình tự:**
1. **02:49** — Yêu cầu tạo **GDD (Game Design Document)** dạng file `.pptx`, tông màu trắng-cam-đỏ, có screenshot chụp trong game, trình bày theo thứ tự: Tên game → Summary (thể loại, inspired by) → Control → Gameplay (core loop, các phase) → Win/Lose condition → flowchart game flow → UI từng màn → animation (từ ụ súng tới block) → Level structure (độ khó) → Haptics. (Dùng skill `pptx`.)
2. **05:42** — Đổi cơ chế điều khiển ụ súng: bỏ **drag**, chuyển sang **tap vào khu vực cần bắn** (giữ nguyên vận tốc/quán tính đạn); bỏ độ nhạy xoay joystick trong Settings; đổi nút "back to home" thành icon hình ngôi nhà, thống nhất giao diện với các nút khác.
3. **06:28** — *"Session ki xong rồi, làm nốt đi"* — ý user: một tiến trình song song (progression bar — sẽ nói ở dưới) đã xong, yêu cầu Claude hoàn tất phần việc còn lại (tutorial, nút back-to-home).
4. **06:51** — Chỉnh bố cục nút bấm hub theo hình tham khảo: thêm nút **"Cấp độ X"** (X = level hiện tại) thay cho nút "tap to play"; nút khu vực 1 đổi thành **nút phần thưởng** (progress theo số level đã chơi, phần thưởng define sau). Hàng nút dưới cùng (trái→phải): **Shop** (IAP, placeholder) → **Leaderboard** → **Trang chủ** → **Skin** → **Mua booster**.
5. **08:02 — "Big update về mechanic"** (5 yêu cầu lớn):
   - (a) Bỏ hẳn drag/joystick, chuyển hẳn sang tap-to-fire, giữ nguyên vận tốc/quán tính đạn, **loại bỏ crosshair**.
   - (b) Bỏ **Weak Point**, model 3D **tự xoay liên tục** (khóa xoay tay — người chơi không xoay được nữa).
   - (c) Goal HUD: đổi số đếm "0/X" thành **SVG ô trống dạng pip** giống Reserve tray, kèm gợi ý màu tiếp theo.
   - (d) Bỏ cooldown từng phát bắn, thay bằng UI **giới hạn số phát bắn ở góc trên-trái**.
   - (e) **Xóa toàn bộ level hiện có**, chỉ giữ 1 level duy nhất để test cơ chế mới.
6. **11:29** — Yêu cầu **Weak Point trở lại nhưng dynamic hơn**: hiện lên rồi tắt đi theo chu kỳ, buộc người chơi canh đúng thời điểm và vị trí. *(Đây chính là điểm khởi đầu của "weakpoint blink" được thực hiện ở phiên 2.8 sau này.)*
7. **11:46 (bị interrupt ngay sau đó)** — *"Eeeee bỏ cái vụ model tự quay rồi bắn là tap đi, tôi muốn quay lại như còn lại"* — user muốn **bỏ cơ chế model tự xoay + tap bắn**, quay lại cách điều khiển cũ (drag). Yêu cầu này **bị chính user interrupt giữa chừng**, chưa có phản hồi/implementation nào — đây là điểm dừng của toàn phiên.

**Sự cố song song đáng chú ý:**
- **06:09** — Claude tự phát hiện **một tiến trình khác đang ghi song song vào cùng repo** trong lúc đang refactor engine: một hệ thống progression/chapter/star mới đang được thêm (`progression.ts`, `progression.test.ts`, ảnh chapter...), đồng thời tiến trình đó cũng đang áp đúng phần UI tap-to-fire mà Claude vừa viết. Claude dừng ghi file để tránh xung đột, báo cáo minh bạch trạng thái cho user trước khi tiếp tục. User sau đó xác nhận đây là công việc hợp lệ (khớp với các commit git thực tế `b6dfd55 Add progression bar`, `34adf42 Sửa radiusSort, model`).

**Sự cố nghiêm trọng — MẤT DỮ LIỆU do OneDrive:**
- **~10:05–10:08** — Sau khi hoàn tất "Big update", dev server không start được (port 3000 bị chiếm). Trong lúc xử lý, phát hiện **toàn bộ code chưa commit của cả session đã biến mất** — working tree tự động khớp lại đúng commit cũ `97d5ddd`, dù `git stash`/reflog đều trống — không phải do lệnh git nào gây ra.
- **Nguyên nhân xác định (11:39)**: **OneDrive Sync Service** (tiến trình `OneDrive.Sync.Service`, PID 22492) đang giám sát và tự động ghi đè thư mục Desktop về bản cũ — hành vi giống cơ chế "ransomware-protection rollback" của OneDrive. Claude đã **tắt hẳn (kill) tiến trình OneDrive Sync Service** để chặn ghi đè tiếp diễn.
- Khôi phục toàn bộ công việc bằng cách trích xuất chính xác mọi payload `Write`/`Edit` từ chính transcript của session (có kèm old/new string), replay lại tuần tự, xử lý khác biệt CRLF/LF. Sau khi khôi phục, **commit theo 4 checkpoint liên tiếp** trên branch `restore/tap-fire-mechanic` để tránh mất việc lần nữa.
- **Đây là lần mất dữ liệu thứ hai** trong session dài hơn (lần đầu liên quan tới phần hub/menu, dấu vết còn ở `reward-track.ts`, `hub-nav.test.mjs`) — và **lặp lại lần nữa chỉ vài phút sau khi vừa khôi phục xong**, buộc Claude phải điều tra kỹ và xác định đúng thủ phạm là OneDrive.

**Quyết định thiết kế/kiến trúc quan trọng:**
- Tái sử dụng `solveAimAtScreenPoint()` (raycast + giải đạn đạo có sẵn) để implement tap-to-fire — gần như không cần code vật lý mới, chỉ thêm pointer-event handling (`onScenePointerDown/Up/Cancel`).
- **Fairness rule cho auto-spin**: model chỉ tự xoay khi `this.projectiles.length === 0` (dừng xoay khi có đạn đang bay), vì `sweepBlocks` kiểm tra hướng xoay hiện tại tại mỗi physics step — xoay giữa chừng sẽ làm sai kết quả va chạm. Hằng số `GAMEPLAY_SPIN_SPEED = 0.6` (rad/s).
- Constructor engine đổi chữ ký: từ `(host, modelZone, aimZone, crosshair, level, callbacks, options)` → `(host, sceneZone, level, callbacks)` — 1 vùng input duy nhất, bỏ hẳn options (tutorial/weak-point/rainbow flags).
- Phân biệt **Ricochet** (giữ lại — hiệu ứng nảy đạn chung cho mọi cú bắn) với **Shield** (xóa — chỉ dành riêng cho Weak Point cũ).
- Kỹ thuật refactor file lớn an toàn: dùng script Node tùy biến (`.cjs` trong scratchpad) để splice theo line-range với `expect(lineNumber, substring)` pre-flight assertion, thay vì Edit nhỏ lẻ (dễ match sai chuỗi trùng lặp) hay rewrite toàn bộ (dễ mất code tinh chỉnh không liên quan). File CRLF được xử lý bằng cách split trên `\n` để giữ `\r` dính vào cuối dòng.
- Sau 2 sự cố mất dữ liệu: chuyển sang **commit theo checkpoint nhỏ, liên tục** để tránh mất việc lần nữa.

**Tính năng đã implement / lỗi đã fix (kèm file):**
- `app/game/CannonSortEngine.ts` (~3480 → ~2127 dòng): xóa toàn bộ Weak Point (`buildWeakPoints`, `weakPointFaceNormal`, `impactedFace`, `projectileHitWeakPoint`...), Rainbow (import `rainbow-hook.ts`...), joystick/crosshair (`JOYSTICK_*`, `updateAimGesture`, `showAimCrosshairAt`...), model-rotate/hold-to-recenter thủ công (`onModelPointerDown/Move/End`, `recentreModel`...), hook/interaction plumbing (`HookSnapshot`, `CannonSortEngineOptions`...), cooldown (`SHOT_COOLDOWN_MS`, `nextShotAt`). Thêm tap-gesture (`onScenePointerDown/Up`), auto-spin liên tục có gate dừng khi có đạn bay, `handleHit()` đơn giản hóa (hit bất kỳ mặt nào cũng claim cụm). `stopHookForResult()` đổi tên thành `stopForResult()`.
- `app/game/types.ts`: bỏ `WeakPointFace`, `WeakPointSpec`, `RainbowConfig`; `GamePhase` bỏ `"AIMING"`.
- `app/game/level-format.ts`: bỏ cột `weak_points`/`rainbow_*`, xóa toàn bộ khối audit Weak Point (`auditWeakPointRoutes`, `checkWeakPointPacing`, `parseWeakPoints`), xóa 2 helper không dùng (`parseNonNegativeInteger`, `parsePositiveNumber`), bỏ tham số `warn` không dùng trong `buildLevel()`.
- `app/game/level-01.ts` viết lại thành level fallback duy nhất "First spin" (3x2x2, 4 màu × 3 khối, `shotLimit: 6`, `reserveBlocks: 8`).
- `work/levels.tsv`: viết lại chỉ còn 1 dòng level, schema đơn giản hóa.
- `app/GamePrototype.tsx` (~1830 dòng, viết lại toàn bộ): xóa hệ Tutorial, ClimaxFireworks/bypass banner, joystick/crosshair DOM; thêm `.scene-tap-zone` (1 vùng tap duy nhất), Goal HUD dạng pip (`goal-pip-tray` + `goal-queue-hint` hiển thị 3 màu kế tiếp), `shot-limit-badge` góc trên-trái; Settings gộp 2 slider thành 1 slider "Spin speed" (sửa luôn lỗi phát hiện: slider này ban đầu **không thực sự nhân vào tốc độ xoay gameplay thực tế** — đã fix để nhân với `modelRotateSensitivity`, range 0.5×–2×, tại `CannonSortEngine.ts:2000`).
- `app/globals.css`: xóa toàn bộ CSS chết (tutorial, `.aim-crosshair*`, `.aim-zone*`/`.aim-joystick*`, `.model-input-zone*`, `.bypass-banner*`, `.climax-fireworks*`, `.hub-side-buttons*`); thêm `.scene-tap-zone`, `.goal-pip*`, `.goal-queue-hint*`, `.shot-limit-badge*`.
- `app/layout.tsx`, `app/page.tsx`: sửa tiêu đề/mô tả trang còn nhắc "Weak Point & Rainbow Climax" cũ.
- Xóa hẳn qua `git rm`: `app/game/rainbow-hook.ts`, `app/game/tutorial.ts`, `app/game/tutorial-levels.ts`, và 7 file test liên quan (`rainbow-hook.test.mjs`, `weakpoint-rainbow-integration.test.mjs`, `tutorial.test.mjs`, `aim-source-regression.test.mjs`, `aim-target-regression.test.mjs`, `multi-touch-regression.test.mjs`...).
- Một subagent nền được giao sửa lại các test còn stale (`level-sheet.test.mjs`, `menu-hub.test.mjs`, `cosmetics.test.mjs`, `level-handoff.test.mjs`, `result-screen.test.mjs`) và tạo mới `tests/tap-fire.test.mjs`.
- Kết quả cuối: **123/123 test pass**, `tsc` sạch (chỉ còn lỗi cũ ở `db/`/`worker/` không liên quan game), lint sạch, verify trực tiếp trên browser (dev server preview): tap bắn đúng, spin dừng khi có đạn bay, HUD pip/goal-queue-hint/shot-limit-badge hiển thị đúng.

**Vấn đề tồn đọng khi kết thúc phiên:**
- Yêu cầu "Weak Point dynamic" (mục 6 ở trên) **chưa được implement** trong phiên này — bị gián đoạn bởi việc phải khôi phục dữ liệu bị mất trước.
- Yêu cầu cuối "muốn quay lại như còn lại" (mục 7) — **bị chính user interrupt giữa chừng**, chưa có phản hồi nào. Cần làm rõ ở phiên sau: "quay lại như còn lại" nghĩa là quay lại cơ chế nào cụ thể (trước Big update hoàn toàn, hay chỉ bỏ auto-spin và giữ tap-to-fire?).
- Phần thưởng (reward) cho nút "khu vực 1" ở hub — user nói sẽ define sau, chưa có nội dung cụ thể.
- Nút Shop/IAP — chỉ là placeholder UI, chưa có chức năng thật.
- **3 quyết định phạm vi Claude tự đưa ra** trong "Big update" nhưng **chưa được user xác nhận rõ ràng**: (1) xóa hẳn Rainbow Climax bonus (tự suy luận vì nó chỉ tồn tại để "bypass" Weak Point, nay Weak Point đã mất); (2) xóa toàn bộ hệ Tutorial (tự suy luận vì tutorial dựa hoàn toàn vào drag/weak-point/rainbow); (3) quy tắc "auto-spin dừng khi có đạn bay" là cách diễn giải cụ thể của "lock rotation" do Claude tự chọn.

**Feedback của user:**
- Không có phản hồi tiêu cực trực tiếp về cách Claude xử lý sự cố OneDrive — user gần như im lặng để Claude tự xử lý.
- User **2 lần chủ động interrupt** phiên (06:38 và 11:45/11:46) — lần cuối interrupt ngay khi vừa gửi yêu cầu đảo ngược lớn (hủy auto-spin/tap-fire), cho thấy đây có thể là quyết định thử nghiệm (A/B test) chưa chốt hẳn, không phải lỗi kỹ thuật của Claude.

---

### 2.8. Phiên 24/08 – 25/08/2026, 11:48 – 02:25 UTC (`3b87966a`) — Weakpoint blink, Excel editor, level Dome demo

Đây là phiên trực tiếp **giải quyết yêu cầu "Weak Point dynamic"** đã treo lại từ phiên 2.7 (mục 6). Kéo dài ~14,5 giờ (có gián đoạn), kết thúc bị interrupt giữa chừng.

**3 yêu cầu chính theo trình tự:**
1. Làm weakpoint "dynamic" hơn — **nhấp nháy ẩn/hiện** để buộc người chơi phải ngắm và canh đúng thời điểm bắn.
2. Tạo **file Excel** cho phép chỉnh tay vị trí weakpoint, có ghi chú logic vào file.
3. Level hiện tại thiếu "hook" hình ảnh — muốn scale model to/chi tiết hơn (dẫn chứng ảnh mẫu "umbrella"), có thể thêm UI goal/tiến độ lấp đầy.
4. Cuối phiên: user hỏi *"đã xuất html và cập nhật changelog chưa?"* — bị interrupt trước khi có câu trả lời.

**Quyết định thiết kế:**
- Cơ chế blink: mỗi weakpoint có `blinkPhase` lệch pha (seeded qua hàm `seededUnit`) để nhiều điểm trên 1 level không nhấp nháy đồng bộ. Chu kỳ: **hiện 1.1 giây / ẩn 0.9 giây** (`WEAK_POINT_BLINK_VISIBLE_SECONDS`, `WEAK_POINT_BLINK_HIDDEN_SECONDS`), cộng dồn qua biến `weakPointCycleElapsed` (tăng theo `FIXED_STEP` mỗi fixed-step). Bắn trúng mặt đúng nhưng lúc điểm đang tắt = tính là trượt (giống bắn sai mặt). Cơ chế Rainbow bypass (ẩn toàn bộ decal) không bị ảnh hưởng bởi blink.
- Trước khi implement phần "scale hình ảnh", Claude hỏi lại user qua `AskUserQuestion` 2 câu: (a) scale model to/chi tiết hơn **vs** thêm UI % lấp đầy màu **vs** cả hai; (b) áp dụng cho 1 level demo trước / toàn bộ 8 level hiện có / chỉ level mới. **User chọn: "Model to & chi tiết hơn" + "1 level demo trước"** — làm 1 level mẫu lớn để duyệt hướng đi trước khi động vào 8 level chính thức.

**Tính năng đã implement (file `app/game/CannonSortEngine.ts` trong session này, sau đổi tên thành `SandCannonEngine.ts`):**
- Thêm field `blinkPhase` vào type `WeakPointVisual`.
- `buildWeakPoints`: tính `blinkPhase` bằng seeded hash.
- Thêm field `weakPointCycleElapsed`, reset khi level restart.
- Hàm `updateWeakPointBlink` hook vào `updateTimedGameplayStep`, điều khiển `visible` on/off.
- Hit-test: gate theo decal có đang hiển thị lúc va chạm hay không.
- Chạy `npx tsc --noEmit`, `npm test` — không có lỗi mới do thay đổi (3 lỗi pre-existing không liên quan). Kiểm tra trực tiếp trong browser (dev server): load level, bắn nhiều phát, không có console error.

**File Excel weakpoint editor:** `work/weakpoint-editor.xlsx` (dùng thư viện `exceljs`, viết script tại scratchpad `build_weakpoint_workbook.mjs`; trước đó thử bằng Python `build_weakpoint_workbook.py` nhưng máy không có LibreOffice/Python3 để recalc nên chuyển sang Node/exceljs). Gồm 3 tab:
- **README**: giải thích hệ trục x.y.z suy từ `dims`/`layers`, mã mặt PX/NX/PY/NY/PZ/NZ, luật bắt buộc mỗi cluster cùng màu có 1–3 weakpoint (theo validator game), 2 cảnh báo mềm (điểm bị che khuất, goal mở đầu không bắn được điểm nào), note cơ chế blink 1.1s/0.9s.
- **Levels**: liệt kê 8 level hiện có, cột `weak_points` dựng lại bằng formula (MATCH/INDEX/COUNTIF/TEXTJOIN) từ tab WeakPoints.
- **WeakPoints**: bảng chỉnh tay (ô vàng = editable) x/y/z/face (face có dropdown), tự cập nhật ngược lại tab Levels.
- Claude đã tự verify công thức khớp 100% với 8 level hiện tại bằng script mô phỏng logic (vì không recalc được qua LibreOffice), set `fullCalcOnLoad` để Excel tự tính khi mở. Đã gửi file cho user qua `SendUserFile`.

**Level demo "Dome":** File `work/level-demo-dome.tsv` (script tạo: scratchpad `build_dome_level.mjs`) — mô hình vòm 3D lớn **~132 khối**, kích thước **9x8x9**, 6 màu chia theo múi góc + 1 cây cột trung tâm giữ tay cầm. Giữ nguyên cơ chế cannon-sort + weakpoint (mỗi cụm màu = 1 weakpoint ở mặt lộ ra ngoài). Đã validate qua `app/game/level-format.ts` — 0 lỗi/0 cảnh báo — và load thử trong dev server bằng browser automation (giả lập drag-drop file qua JS injection trigger drop event trên element `aria-label="Prototype game 3D Cannon Sort"`), xác nhận game load level 9 "Dome", HUD hiện đúng goal (ví dụ `orange 0/34`, `yellow 0/20`), bắn thử nhiều phát không lỗi console. Chưa đụng tới 8 level chính thức trong `work/levels.tsv`. Đã gửi file cho user với hướng dẫn: chạy `npm run dev`, kéo-thả file vào màn hình chọn level.

**Vấn đề tồn đọng cuối phiên:**
- Hình dáng/màu level Dome chọn ngẫu nhiên theo góc, **"chưa tối ưu thẩm mỹ"** — cần tinh chỉnh thêm nếu duyệt hướng đi.
- Chưa quyết định: áp dụng hướng "model to hơn" cho toàn bộ level hay chỉ xen kẽ thêm level lớn.
- UI % lấp đầy theo màu — **chưa làm**, vì user chỉ chọn "model to & chi tiết hơn", không chọn thêm UI tiến trình.
- Cuối phiên: đang restore `app/game/levels-sheet.ts` về đúng bản committed (`git checkout --`) sau khi phát hiện lệch dòng (line-ending/autocrlf) do quá trình test-drive level Dome ghi đè `work/levels.tsv`; sau đó re-run test suite, typecheck (đều sạch), rồi bắt đầu build file HTML standalone (`node work/build-standalone.mjs 3d-cannon-sort.html`) để đóng gói bản có weakpoint blink.
- Trong lúc build standalone, phát hiện **thiếu asset**: tìm kiếm tham chiếu `"chapter-medieval-siege"` (grep trong .ts/.tsx/.mjs và tìm file bất kỳ tên "medieval-siege") — **không tìm thấy file trong repo**, có vẻ là asset nền/chapter bị thiếu — **chưa được giải quyết**, phiên bị interrupt ngay tại bước này.
- Câu hỏi cuối *"đã xuất html và cập nhật changelog chưa?"* — chưa được trả lời/hoàn tất; `CHANGELOG-prototype.md` có vẻ **chưa được cập nhật** trong phiên này (không có Edit/Write nào nhắm vào file changelog, chỉ có đọc đuôi file để xem nội dung cũ).

**Feedback của user:** Không có phản hồi tiêu cực rõ ràng ghi nhận được (session bị cắt ở phần cuối). User trả lời câu hỏi làm rõ scope rõ ràng, chọn hướng thận trọng ("làm demo 1 level trước" thay vì áp dụng toàn bộ ngay) — cho thấy thích cách tiếp cận thăm dò/duyệt trước khi commit vào thay đổi lớn về thiết kế.

---

### 2.9. Phiên 27/08/2026, 02:20 UTC (`4433c2e9`) — phiên hiện tại

Phiên này chính là phiên đang diễn ra, bắt đầu bằng yêu cầu của user: *"Cho tôi 1 file .md tổng hợp toàn bộ context từ toàn bộ đoạn chat có chung 1 file 3D-cannon-sort. Không viết tắt, nói thừa hay thiếu, đầy đủ thông tin."* Tài liệu này chính là kết quả của yêu cầu đó, được dựng bằng cách đọc lại toàn bộ 12 phiên nêu trên qua các agent nền chạy song song.

---

## 3. Tổng hợp trạng thái gameplay hiện tại (theo diễn biến các quyết định thiết kế cuối cùng)

Vì nhiều cơ chế đã được thêm rồi xóa/đảo ngược qua các phiên, dưới đây là **trạng thái thiết kế mới nhất** theo trình tự thời gian các quyết định (từ cũ đến mới):

1. **Điều khiển ụ súng**: ban đầu là kéo (drag) để ngắm + bắn → đổi sang **tap-to-fire** (bỏ crosshair, bỏ drag) ở phiên 24/08 → cuối phiên 24/08 user yêu cầu **quay lại như cũ** (drag) nhưng yêu cầu này bị interrupt, **chưa rõ đã được xử lý hay chưa** — cần xác nhận ở phiên tiếp theo.
2. **Xoay model**: ban đầu xoay tay (kéo) → đổi sang **auto-spin liên tục, khóa xoay tay** (dừng xoay khi có đạn bay, `GAMEPLAY_SPIN_SPEED = 0.6 rad/s`) ở "Big update" 24/08 → cũng nằm trong yêu cầu "quay lại như cũ" bị interrupt ở trên.
3. **Weak Point**: có ở thiết kế ban đầu → redesign (trúng đúng 1 mặt block, nảy bóng thay vì tiêu hủy, hiệu ứng khiên khi trượt) ở phiên 22-24/08 → **bị xóa hoàn toàn** trong "Big update" 24/08 → **được yêu cầu quay lại dưới dạng "dynamic/blink"** (nhấp nháy ẩn/hiện, chu kỳ hiện 1.1s/ẩn 0.9s, lệch pha theo seed) và **đã được implement** ở phiên 24-25/08 (`3b87966a`).
4. **Rainbow Climax**: có ở thiết kế ban đầu → redesign toàn diện (2-3 target bay tự do 4.5s, model tấm bia 7 màu, buff bỏ qua weakpoint phát kế tiếp) ở phiên 22-24/08, có rule hiếm hóa qua `rainbow_spawn_gap` → **bị xóa** trong "Big update" 24/08 (Claude tự suy luận xóa vì nó tồn tại để bypass Weak Point, nay Weak Point đã mất — **chưa được user xác nhận rõ ràng**) → hiện trạng cuối cùng chưa rõ vì Weak Point đã quay lại dạng blink nhưng chưa có thông tin Rainbow có được khôi phục theo hay không.
5. **Barrel & Link mechanic**: được thêm ở phiên 19-20/08 (vỏ nhiều lớp, móc nối 2 cụm) → **bị xóa hoàn toàn** ở phiên 22-24/08 khi redesign Batch System.
6. **Batch System**: 2 slot cố định ban đầu → đổi sang **1 khay chung giới hạn 8 block** (X=8, xác định bằng brute-force dữ liệu) ở phiên 22-24/08, hiển thị dạng "Tray" (không hiện số, dùng chính block làm chỉ báo, cao 32px). Fail condition: khi khay đầy mà phát bắn tiếp theo không giải quyết được hàng chờ thì fail.
7. **Tutorial**: được sửa toàn diện (scrim+spotlight, pictogram, flow tuần tự đúng luật) ở phiên 22-24/08 → **bị xóa hoàn toàn** trong "Big update" 24/08 (Claude tự suy luận xóa vì dựa hoàn toàn vào drag/weak-point/rainbow — **chưa được user xác nhận**).
8. **Block geometry**: hình hộp vuông ban đầu → bo tròn góc (`RoundedBoxGeometry`, bán kính chốt **0.16**), sáng hơn (`emissive` cường độ 0.2) ở phiên 22-24/08. Vật lý va chạm vẫn giữ hình hộp có chủ ý.
9. **Goal HUD**: số đếm "0/X" ban đầu → đổi sang **dạng pip SVG** giống Reserve tray, kèm gợi ý 3 màu tiếp theo (`GOAL_QUEUE_HINT_LENGTH = 3`) trong "Big update" 24/08.
10. **Cooldown bắn**: có cooldown giữa các phát ban đầu → **bỏ cooldown**, thay bằng UI giới hạn số phát bắn ở góc trên-trái, trong "Big update" 24/08.
11. **Level count**: từng có tối thiểu 8-9 level chính thức (kể cả Level 9 "khó, buộc dùng rainbow/full batch") → **bị xóa hết, chỉ còn 1 level duy nhất** ("First spin", 3x2x2, 4 màu × 3 khối) trong "Big update" 24/08 để test cơ chế mới.
12. **Renderer & performance**: singleton renderer pool + projectile pool (8 viên tái sử dụng) — quyết định này **giữ nguyên xuyên suốt**, không bị đảo ngược ở bất kỳ phiên nào sau đó.
13. **Cosmetic system**: cannon cổ điển + "Rune Cannon" (ụ súng phép thuật, không phải bàn tay) — quyết định cuối cùng của phiên 20-21/08, không thấy đề cập lại ở các phiên sau (24/08 trở đi tập trung vào core mechanic, có thể cosmetic vẫn còn nguyên hoặc đã bị ảnh hưởng bởi việc viết lại `GamePrototype.tsx` — **cần kiểm tra lại code hiện tại để xác nhận**).
14. **Menu HUB**: có màn hình chính riêng (idle mode, nút chọn level, skin, shop placeholder, leaderboard, trang chủ, mua booster) — thêm ở phiên 19-20/08, mở rộng bố cục nút ở phiên 24/08 (nút "Cấp độ X", nút phần thưởng theo progress).
15. **Ngôn ngữ**: đã dịch toàn bộ sang tiếng Anh ở phiên 19-20/08 (`b04fc886`).
16. **Progression system**: một hệ thống progression bar/chapter/star được thêm bởi "một tiến trình khác" chạy song song trong lúc phiên 24/08 (`9dc5c57e`) đang diễn ra — khớp với các commit git `b6dfd55 Add progression bar` và `34adf42 Sửa radiusSort, model` — **không phải do agent trong các phiên đã đọc thực hiện trực tiếp**, cần xem lại các commit này hoặc phiên khác (nếu có) để biết chi tiết đầy đủ.

**Lưu ý quan trọng**: Vì các phiên `1424d5d3`, `9dc5c57e`/`72d29974`, `3b87966a` diễn ra gần nhau (22-25/08) và có nhiều đảo ngược quyết định lớn (đặc biệt là việc xóa rồi khôi phục Weak Point, thử rồi rút lại tap-to-fire/auto-spin), **trạng thái code THỰC TẾ hiện tại cần được xác minh trực tiếp bằng cách đọc source code** (`app/game/SandCannonEngine.ts`, `app/game/sand-rules.ts`, `app/game/sand-types.ts`, `app/GamePrototype.tsx`, `app/LevelEditor.tsx`) và `CHANGELOG-prototype.md`, thay vì chỉ dựa vào tóm tắt hội thoại — vì ít nhất 2 yêu cầu lớn (quay lại drag/xoay tay; xác nhận Rainbow/Tutorial có bị xóa hẳn không) đã bị ngắt giữa chừng, chưa rõ có được xử lý ở phiên nào khác ngoài phạm vi 12 file transcript đã đọc.

---

## 4. Vấn đề tồn đọng tổng hợp (TODO xuyên suốt các phiên, tính đến 25/08/2026)

- **Chưa xác nhận**: có quay lại điều khiển drag + xoay tay như trước "Big update" hay không (yêu cầu bị user tự interrupt ở phiên 24/08, `9dc5c57e`).
- **Chưa xác nhận với user**: quyết định xóa hẳn Rainbow Climax và Tutorial trong "Big update" — đây là 2 quyết định phạm vi Claude tự đưa ra, chưa có xác nhận rõ ràng.
- **Asset bị thiếu**: tham chiếu `"chapter-medieval-siege"` không tìm thấy file tương ứng trong repo khi build standalone ở phiên 24-25/08 (`3b87966a`) — chưa được giải quyết.
- **Level "Dome" demo**: hình dáng/màu chọn ngẫu nhiên theo góc, chưa tối ưu thẩm mỹ; chưa quyết định có mở rộng ra toàn bộ level hay không.
- **CHANGELOG-prototype.md**: có khả năng chưa được cập nhật đầy đủ cho các thay đổi ở phiên 24-25/08 (weakpoint blink, Excel editor, level Dome) — cần kiểm tra lại.
- **File HTML standalone mới nhất**: chưa rõ đã build/export xong hay chưa tính đến cuối phiên `3b87966a` — câu hỏi cuối của user về việc này chưa được trả lời.
- **Link chuỗi (3+ cụm nối tiếp)**: từng được hỏi nhưng chưa chốt có hỗ trợ hay không — tuy nhiên bản thân mechanic Link đã bị xóa hoàn toàn sau đó nên có thể không còn liên quan.
- **UI phần trăm lấp đầy theo màu** (đề xuất cùng lúc với "model to hơn"): chưa làm, user chỉ chọn nhánh "model to & chi tiết hơn".
- **Haptics cho các sự kiện khác** (bắn trượt, bấm nút, bắt đầu ngắm): chưa quyết định có cần hay không.
- **Reward cho nút "khu vực 1"** ở Menu HUB: chưa định nghĩa nội dung phần thưởng cụ thể.
- **Nút Shop/IAP**: hiện chỉ là placeholder UI, chưa có chức năng mua bán thật.
- Đề xuất tối ưu dung lượng file HTML (gzip self-extract ~278KB, bỏ React ~574KB, hoặc micro-renderer thay Three.js ~90KB) — vẫn còn là đề xuất, chưa triển khai bất kỳ phương án nào.
- Progression/save qua localStorage — được nhắc tới như Phase 3 trong lộ trình 50 levels ban đầu, chưa rõ mức độ hoàn thành (có tiến trình song song đã thêm "progression bar" nhưng không nằm trong phạm vi các phiên đã đọc).

---

## 5. Ghi chú về cách làm việc & sở thích của user (tổng hợp xuyên suốt các phiên)

- **Không thích thuật ngữ kỹ thuật**: nhiều lần yêu cầu giải thích lại bằng ngôn ngữ đơn giản, có minh họa trực quan (dùng ẩn dụ đời thường như "balo", "quyển sổ Excel", "tivi") khi Claude đưa ra phân tích kiến trúc nhiều thuật ngữ.
- **Rất coi trọng tính minh bạch/công bằng gameplay**: phản ứng mạnh khi phát hiện bug crosshair bắn sai màu, dùng từ như "lừa dối người chơi".
- **Thích quyết định qua câu hỏi trắc nghiệm**: khi Claude chủ động đặt câu hỏi lựa chọn (AskUserQuestion) trước khi triển khai thay đổi lớn, user phản hồi rõ ràng và có xu hướng chọn phương án thận trọng, thăm dò trước (ví dụ "làm 1 level demo trước" thay vì áp dụng toàn bộ ngay).
- **Thích làm từng bước nhỏ, tuần tự** thay vì làm hết nhiều việc cùng lúc.
- **Muốn giữ quyền kiểm soát nội dung level**: tự làm beat chart Excel/TSV theo cách riêng rồi gửi lại, thay vì để Claude định hình toàn bộ workflow authoring.
- **Đưa phản hồi UI/UX rất cụ thể, chi tiết** (tọa độ, timing, hành vi từng animation) và kỳ vọng Claude tự đo/verify thật trong game (không chỉ đọc code).
- **Đổi ý khá thường xuyên và dứt khoát** ở các quyết định thiết kế lớn (model bàn tay → xóa; tap-to-fire/auto-spin → yêu cầu quay lại drag), cho thấy nhiều phần thiết kế vẫn đang ở giai đoạn thử nghiệm/lặp (iterate) chứ chưa chốt cứng.
- **Quen với việc phiên bị ngắt** (do máy sleep, mất kết nối, giới hạn session) và chỉ cần gõ "Try again"/"Sửa" ngắn gọn để tiếp tục, không cần nhắc lại toàn bộ yêu cầu.
- **Chủ động test trên thiết bị thật** (đặc biệt mobile, vì môi trường làm việc của Claude không composite được để xem trực tiếp animation/WebGL) và báo lại bug cụ thể (flash khi chuyển màn, haptics...).
- **Đổi model giữa `claude-sonnet-5` và `claude-opus-5` nhiều lần trong các phiên**, có xu hướng chuyển sang model mạnh hơn trước các câu hỏi thiết kế phức tạp.
