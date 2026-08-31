# 3D Sand Cannon Sort — playable prototype

Prototype puzzle WebGL 3D theo brief `sand_cannon_concept.md`. Người chơi bắn đạn màu vào một bức
tranh cát 3D nằm trong khung tĩnh; cát bị lấy đi thì phần còn lại rơi xuống.

## Tài liệu theo từng chức năng

File này là tổng quan kiến trúc. Muốn định nghĩa/chỉnh một chức năng cụ thể, chỉ cần đọc đúng một
file trong `docs/features/` — không cần đọc lại toàn bộ README:

| Chức năng | File |
| --- | --- |
| Luật bắn theo bán kính + bánh xe đạn | [docs/features/radius-shot-rule.md](docs/features/radius-shot-rule.md) |
| Settle solver (cát rơi từng hạt) | [docs/features/settle-solver.md](docs/features/settle-solver.md) |
| Cách viết một level | [docs/features/level-format.md](docs/features/level-format.md) |
| Level editor (`/editor`) | [docs/features/level-editor.md](docs/features/level-editor.md) |
| Đo độ khó (Measure difficulty) | [docs/features/difficulty-measurement.md](docs/features/difficulty-measurement.md) |
| Lock & Key | [docs/features/lock-and-key.md](docs/features/lock-and-key.md) |
| Wind | [docs/features/wind.md](docs/features/wind.md) |
| Booster (Radius Overcharge / Prism Shot) | [docs/features/booster-radius-prism-spec.md](docs/features/booster-radius-prism-spec.md) |
| Board pixel 2D trong khung 3D | [docs/features/rendering-pixel-board.md](docs/features/rendering-pixel-board.md) |
| Economy (vàng, Shop, Daily Login) | [docs/features/economy-and-wallet.md](docs/features/economy-and-wallet.md) |
| Thưởng vàng theo từng level | [docs/features/level-rewards.md](docs/features/level-rewards.md) |

Nội dung có thể tự tay chỉnh sửa mà không cần đụng vào engine (level design, số liệu kinh tế) nằm
riêng trong [`design/`](design/) và `public/design/` — xem `design/levels/README.md` và
`design/economy/README.md`.

Bản pivot này thay hoàn toàn core cũ (xoay model, Goal/Batch, Weak Point, Rainbow Target). Những
thứ đó đã bị gỡ khỏi source, không phải chỉ tắt đi.

## Một bộ luật: bắn theo bán kính

Chỉ còn một gameplay: phát bắn lấy mọi hạt cùng màu trong một **đĩa bán kính** quanh điểm chạm
(không phải cả vùng), và đạn quay vòng trong một **bánh xe** cho tới khi màu đó sạch hẳn — ngân
sách duy nhất là số lượt bắn, và đó cũng là nơi độ khó của một màn nằm. Mọi luật của gameplay này
gom vào một object duy nhất, `RADIUS_GAMEPLAY` (`sand-types.ts`), nên đổi một quyết định thiết kế
là đổi một dòng thay vì sửa rải rác. Chi tiết đầy đủ — miss, dead bullet, win/fail, từng trường của
policy — ở [docs/features/radius-shot-rule.md](docs/features/radius-shot-rule.md).

## Level editor

Mở ở `/editor` (hoặc bấm nút ✎ trong game): vẽ tranh pixel, dựng bánh xe đạn, đo độ khó thật bằng
nút **Measure difficulty**, và **Ship to sand-levels.ts** để đưa thẳng level vào
`design/levels/sand-levels.ts` không cần copy-paste. Toàn bộ tính năng, hai lỗi editor bắt buộc phải
chặn (dead bullet cả hai chiều), và workflow ship-to-source ở
[docs/features/level-editor.md](docs/features/level-editor.md).

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
| `app/game/sand-rules.ts` | Toàn bộ luật: connectivity, radius sort, settle solver, win/fail, mở rộng độ phân giải, booster. Không có three.js, không có DOM, không có đồng hồ |
| `app/game/SandCannonEngine.ts` | Khung, cannon, projectile, input 3D — và một canvas pixel 2D **phát lại** kết quả mà solver đã quyết |
| `design/levels/sand-levels.ts` | Level ship kèm build, và mảng `BUILT_IN_LEVELS` — nội dung level design, tách khỏi `app/game` (xem [design/levels/README.md](design/levels/README.md)) |
| `app/game/level-drafts.ts` | Model level của editor: lưu trữ, validate, settle, sinh TypeScript |
| `app/game/level-analysis.ts` | Hai model chơi để đo độ khó. Dùng chung bởi editor và test |
| `app/game/level-difficulty.ts` | Điểm độ khó heuristic (0–100) cho danh sách level trong editor, và cho công thức thưởng vàng |
| `app/game/economy.ts` | Ví người chơi: vàng, booster, daily login. Toàn bộ state client-only (`localStorage`) |
| `app/game/economy-config.ts` | Đọc `public/design/economy.csv` runtime, override số kinh tế chung |
| `app/game/level-rewards.ts` | Đọc `public/design/level-rewards.csv` runtime, override thưởng vàng theo từng level |
| `app/SandGame.tsx` | Chọn level, HUD ammo, badge khoá input, màn thắng/thua, restart, Shop, Daily Login |
| `app/LevelEditor.tsx` | Toàn bộ giao diện editor |

Board render và va chạm được nói kỹ ở
[docs/features/rendering-pixel-board.md](docs/features/rendering-pixel-board.md) (canvas pixel 2D
dán trong khung 3D, va chạm bằng giao cắt mặt phẳng, texture HSV jitter). Settle solver (cát rơi
từng hạt, vì sao bỏ cohesion) ở
[docs/features/settle-solver.md](docs/features/settle-solver.md).

## Quyển sổ màn chơi

Level nào cũng có thể vẽ bằng **editor** ở `/editor` — đó là cách nhanh nhất. Nội dung level (không
phải engine) nằm ở [`design/levels/`](design/levels/), tách khỏi `app/game`. Format đầy đủ để viết
tay một level (bức tranh `rows`, bảng mã 10 màu, `ammoQueue`, `wind`, lock&key, `pixelScale`) ở
[docs/features/level-format.md](docs/features/level-format.md).

Level duy nhất ship sẵn trong `BUILT_IN_LEVELS` hiện là `defaultLevel` ("Level 1") — mọi level khác
sống trong editor (`localStorage`) rồi ship qua khi cần. `sandBloom`, `lockAndKey`, `crosswind`
trong `design/levels/sand-levels.ts` **không** phải level người chơi thấy được — đó là fixture cho
test suite, xem [design/levels/README.md](design/levels/README.md).

## Rule đã chốt

- Adjacency: `ORTHOGONAL_4`. Chạm góc không nối.
- Phát bắn lấy mọi hạt cùng màu trong đĩa bán kính quanh điểm chạm — không phải cả vùng.
- Phát bắn không lấy được gì vẫn tiêu một lượt, board không đổi.
- Một projectile một lượt. Không bắn trong `PROJECTILE_FLYING`, `HIT_RESOLUTION`, `SETTLING`.
- Win kiểm tra trước, fail kiểm tra sau — phát cuối dọn sạch khung là thắng, không phải hoà.

## Map mechanic đang thử

Là **data của level**, không phải nhánh code riêng: level không dùng tới nó đọc và chạy y hệt như trước
khi nó tồn tại.

**Lock & Key** — cát bị khoá lơ lửng không rơi và không bắn được cho tới khi một chìa khoá pixel
cứng rơi tới chạm nó. Chi tiết đầy đủ (silhouette sprite, `keyFriction`, cách vẽ trong editor) ở
[docs/features/lock-and-key.md](docs/features/lock-and-key.md).

<<<<<<< HEAD
**Chìa khoá là một silhouette lởm chởm vẽ tay (`KEY_SPRITE`, `sand-sprites.ts`), không phải hình tròn —
nó trượt trên cát, không lăn.** Vật lý của chìa khoá là vật lý của cát, áp cho cả khối: rơi thẳng khi
dưới trống, trượt chéo khi không. Khác biệt duy nhất là tính cứng — một nước đi chỉ
xảy ra khi *mọi* ô đích đều hợp lệ cùng lúc, nên một chìa khoá có ô nằm ngoài khung thì không nhúc nhích
được (editor chặn không cho đặt như vậy). Engine vẽ nó thẳng lên canvas cát — phẳng màu vàng cộng một
bóng đổ 1px — y hệt cách một hạt cát hay icon ổ khoá được vẽ, không phải một đối tượng 3D riêng.

Vì là một sprite vẽ tay cố định chứ không phải công thức hình học, cỡ chỉnh theo **bội số nguyên** của
chính sprite đó (`spriteCells(KEY_SPRITE, scale)`, giống hệt cách `PADLOCK_SPRITE` đã làm) — không có
khái niệm "to thêm một pixel" cho một hình lởm chởm, vì phóng to 1 pixel không giữ được silhouette; mỗi
pixel của sprite trở thành một khối `scale×scale`.

**Friction** (`keyFriction`, 0–1, mục "Key friction" trong editor) quyết định độ trơn trượt — 0 là trơn
tối đa (trượt ngay khi có đường đi), 1 là ì (chờ vài pass mới trượt). Chỉ cản **chuyển động ngang** — rơi
thẳng đứng không bao giờ bị chậm lại, đúng như ma sát thật chỉ tác động dọc theo bề mặt tiếp xúc, không
bao giờ chống lại trọng lực. Cơ chế: mỗi lần chìa khoá có cơ hội trượt ngang mà chưa đi, nó "chờ"
thêm một pass; đủ `round(friction × 4)` pass thì mới thực sự di chuyển. Level `Lock & Key` không khai
`keyFriction`, mặc định 0 — trơn trượt cao nhất.

Hai hình vẽ nằm chung ở `sand-sprites.ts` vì cả hai đều được vẽ hai lần — engine vẽ lên board pixel
thật, editor vẽ lên canvas preview. `KEY_SPRITE` là một notch + một thanh ngang bắc cầu + hai "chân" thõng
xuống (mọi ô liền nhau 4-hướng, nếu không `parseSandLevel` sẽ tách nó thành nhiều chìa khoá). `PADLOCK_SPRITE`
không bao giờ được author và không nằm trong lưới — nó là **nhãn** renderer dán lên mỗi vùng khoá.

Cát khoá vẽ **tối đi** chứ không nhuộm màu: màu bên dưới vẫn phải đọc được, vì đó chính là viên đạn bánh
xe sẽ phát khi khoá mở. Ổ khoá được scale vừa vùng và **bỏ hẳn** khi vùng quá nhỏ — một ổ khoá tràn ra
ngoài chỗ nó đang chú thích thì đọc thành rác.

Một màu bị khoá **toàn bộ** sẽ không được bánh xe phát ra (`shootableColors`) — phát viên đạn đó ra thì
đúng là dead bullet mà `deadBulletPolicy` sinh ra để cấm — và nó quay lại bánh xe ngay khi khoá mở.

Một lưu ý khi tự vẽ level có khoá: cát chỉ đứng yên khi mỗi cột mép cao hơn cột bên cạnh **tối đa 1 ô**,
nên một khối vuông đặt trên một slab hẹp sẽ lăn khỏi sườn của chính nó ở frame đầu. Nút chặn của
`Lock & Key` thụt vào một ô mỗi tầng vì lý do đó, không phải để cho đẹp.

### Editor vẽ ở đúng độ phân giải board

Trước đây editor vẽ một **blueprint** nhỏ (12×14) rồi game phóng lên bằng `pixelScale` lúc load. Đó là
một lời nói dối tác giả phải tự giữ trong đầu: họ đặt một bức tranh 12 ô còn game chạy một bức 60 pixel,
nên không thứ gì họ vẽ ra đúng là thứ sẽ được chơi. Giờ **lưới trong editor chính là board pixel thật**
(mặc định 60×70, đúng cỡ level đang ship), `pixelScale` luôn là `1` và ô chọn scale đã bị bỏ.

Cái giá là phải có **cỡ cọ**: `− brush Npx +` cạnh tool Brush/Eraser, nib vuông canh giữa con trỏ. Cái
được là một editor hiển thị đúng level. Lưới mảnh chỉ vẽ khi mỗi ô đủ lớn để nhắm được (≥ 9px màn hình),
còn lưới guide mỗi 10 pixel thì luôn có để đếm.

`expandLevelForPixelBoard` vẫn còn cho level viết tay (`sand-levels.ts` vẫn dùng `pixelScale: 5`) và cho
**migration**: draft cũ trong localStorage được phóng đúng bằng hệ số game vốn sẽ phóng, kèm `sortRadius`,
rồi đặt `pixelScale: 1`.

### Lock & Key vẽ được trong editor

Level thử `Lock & Key` trong `sand-levels.ts`:

- Nút `🔒 Locked` là *modifier của cọ*, không phải tool riêng — khoá là một **trạng thái của một màu**,
  nên phải vẽ bằng một màu.
- Nút `Key` **đóng dấu** cả hình chìa khoá lởm chởm, không phải quét từng ô: chìa khoá là một *shape*,
  và game gom các ô `K` liền nhau thành một vật thể, nên vẽ tay sẽ ra một chìa khoá mà tác giả chưa từng
  chọn silhouette. Cạnh nút là `− key 28×12px · ×4 +`: hiện cả cỡ pixel lẫn tỉ lệ, vì sprite là một hình
  vẽ tay cố định — phóng to đi theo **bội số nguyên** (`×N`), không có khái niệm "to thêm một pixel" cho
  một silhouette lởm chởm. Bấm lại lên một chìa khoá đã có thì **nhấc nó lên**, nên đổi cỡ = nhấc, chỉnh,
  đặt lại. Cỡ tối đa bị chặn theo kích thước khung, vì một chìa khoá bị cắt cụt là một silhouette khác,
  không phải một chìa khoá to.

Preview của editor tính cỡ ổ khoá ở **độ phân giải board thật** rồi thu lại để vẽ, chứ không tính ở cỡ
blueprint: game dán icon lên board đã mở rộng, nên tính ở cỡ blueprint sẽ cho editor và game bất đồng về
chỗ nào đủ to để có ổ khoá.
=======
**Wind** — một vòng lặp các pha gió thổi cát theo `direction`/`durationMs`/`cooldownMs`/`power`/
`zone`. Chi tiết đầy đủ (tương tác với settle solver, đơn vị scale, cách vẽ zone trong editor) ở
[docs/features/wind.md](docs/features/wind.md).
>>>>>>> ef36fad84d1203866dd06a7203f56ade6ba001cd

## Policy tạm — Open Decision chưa chốt

Mọi điểm brief để mở đều nằm trong `RADIUS_GAMEPLAY` (`sand-types.ts`) với hậu tố `_TEMP`, không
hardcode rải rác trong solver — đổi quyết định thiết kế là đổi một dòng. Danh sách đầy đủ từng
trường và Open Decision tương ứng ở
[docs/features/radius-shot-rule.md](docs/features/radius-shot-rule.md#mọi-trường-của-radiusgameplaypolicy).

**Hai chỗ code cố tình đi ngược tài liệu gốc** (`shotRule`, `ammoRule`): brief chốt một phát trúng
màu xoá toàn bộ connected body và cấm rõ việc chỉ xoá một bán kính quanh impact — bản này làm đúng
điều bị cấm đó, một quyết định có chủ ý sau khi so ba gameplay cạnh nhau, không phải sơ suất.

## Chưa có trong bản này

Meta progression (ngoài ví vàng cơ bản), special sand ngoài lock&key, đổi/skip đạn, random queue,
Z-layer gameplay, full granular rigidbody simulation, âm thanh. Đây đúng phạm vi MVP mà brief đặt
ra (§34).

Economy (vàng, Shop, Daily Login) và booster (Radius Overcharge, Prism Shot) đã có — xem
[docs/features/economy-and-wallet.md](docs/features/economy-and-wallet.md) và
[docs/features/booster-radius-prism-spec.md](docs/features/booster-radius-prism-spec.md).
