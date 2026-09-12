# Zen Mode

Nguồn: `app/game/level-drafts.ts` (`LevelDraft.mode`, `draftToLevel`), `design/levels/zen-levels.ts`
(`BUILT_IN_ZEN_LEVELS`), `app/SandGame.tsx` (Modes tab, `collectZenPlayables`, `playingZen`),
`app/LevelEditor.tsx` (checkbox "🧘 Zen Mode level").

Một danh sách level **riêng biệt** với 50 level chính — không giới hạn số đạn, không giới hạn lượt
booster, không trả thưởng gì. Chơi để nhìn tranh cát rơi, không phải để tiến bộ hay kiếm vàng.

## Vào Zen Mode

Tab "Modes" (bottom nav) → thẻ **Zen Mode** → danh sách level Zen (`zenPlayables`, giống layout
Gallery — mỗi ô luôn mở khoá, Zen không có progression). Bấm một level là chơi luôn, không qua bước
"xem trước trên Home" như Gallery của danh sách chính. Nút ✕ ở góc trên bên trái quay lại danh sách
Zen (không phải Home thường) — xem `goHome`'s own comment cho lý do.

## Không giới hạn — không phải cơ chế mới

`SandLevelConfig.shotLimit: Infinity` và `forcedBoosterCharges` toàn `Infinity` cho cả 3 booster đã là
hai giá trị "không giới hạn" **có sẵn** trong engine từ trước (`sand-rules.ts`'s `withResult`/
`ammoRemaining`, `SandCannonEngine`'s booster-charge override) — Zen Mode không thêm cơ chế mới, chỉ
luôn dùng lại đúng hai giá trị đó cho mọi level của nó:

```ts
// design/levels/zen-levels.ts
const ZEN_UNLIMITED_BOOSTERS = { radiusOvercharge: Infinity, prismShot: Infinity, chainSort: Infinity };
```

## Nội dung Zen — hai nguồn

1. **`BUILT_IN_ZEN_LEVELS`** (`design/levels/zen-levels.ts`) — nội dung khởi điểm: 3 tranh lấy lại từ
   danh sách chính (`BUILT_IN_LEVELS[2]`/`[9]`/`[20]`), đi qua `toZenLevel()`: đổi `id` sang khoảng
   `ZEN_ID_BASE` (100 000+, không bao giờ trùng id danh sách chính), ép `shotLimit`/
   `forcedBoosterCharges` thành không giới hạn, đổi tên thêm hậu tố `" (Zen)"`, và **tước hết mọi
   field FTUE/tutorial** (`tutorial`, `ftueGesture`, `ftueFreezeDemo`/`ftueBoosterDemo`/
   `ftueChainSortDemo` và target của chúng, `forcedOpeningQueue`, `hideBoosterHud`,
   `requiresBooster`) — nếu không, một tranh mượn từ level có FTUE (vd level 3 dạy booster) sẽ vô
   tình bật lại overlay hướng dẫn ngay trong Zen.
2. **Draft từ editor** — `LevelDraft.mode === "zen"`, cùng kho `localStorage` với draft thường
   (`sand-cannon:v1:level-drafts`), chỉ khác cờ `mode`. `draftToLevel(draft, id)` đọc cờ này và tự ép
   `shotLimit`/`forcedBoosterCharges` thành không giới hạn — **tác giả không cần tự gõ số vô hạn vào
   đâu cả**, ô Shots trong editor bị disable + ghi "(ignored — Zen is unlimited)" ngay khi tick
   checkbox.

`SandGame.tsx`'s `collectZenPlayables()` gom cả hai nguồn (built-in + draft `mode: "zen"` hợp lệ,
loại các draft lỗi giống `collectPlayables` vẫn làm cho danh sách chính), đánh số id tiếp theo sau
`ZEN_ID_BASE + BUILT_IN_ZEN_LEVELS.length`. `collectPlayables()` (danh sách chính) đã được thêm bộ lọc
loại trừ `draft.mode === "zen"` — một draft Zen **không bao giờ** lẫn vào danh sách chính, và ngược
lại.

## Import ảnh + tô tay trong editor (2026-09b)

Riêng khi `draft.mode === "zen"`, `app/LevelEditor.tsx` đổi hai chỗ so với editor thường:

- **Import ảnh luôn ở độ chính xác màu tối đa** — bỏ qua field `Max colours` (vốn gộp bớt số màu
  khác nhau xuống cho gọn, dùng cho danh sách chính vì lý do độ khó/dễ đọc). Mỗi pixel vẫn khớp với
  màu `SandColor` GẦN NHẤT trong 24 màu có sẵn của game (không có cách nào vẽ màu RGB tuỳ ý lên board
  thật — xem lý do kỹ thuật bên dưới), nhưng KHÔNG bị gộp thêm lần nữa xuống ít màu hơn nữa như trước
  — đây là độ chính xác cao nhất engine hiện tại cho phép. UI hiện dòng "🧘 Full colour accuracy" thay
  cho ô nhập số.
- **Cọ vẽ tay đổi từ bảng 24 ô sang 1 color picker tự do** (`<input type="color">`) — chọn màu bất kỳ,
  màu đó lập tức snap về màu `SandColor` gần nhất (cùng thuật toán `nearestSandColor` import ảnh
  dùng) để vẽ. Một ô xem trước bên cạnh picker luôn hiện đúng màu SẼ ĐƯỢC VẼ (màu đã snap), không phải
  màu vừa chọn trên picker, để không bất ngờ.

### Bug đã sửa: import ảnh ra màu hoàn toàn sai (2026-09e)

Import ảnh có tông màu NHẠT/xỉn (photo/pixel-art thường, không phải màu candy bão hoà) từng ra kết
quả sai lệch hẳn — vd `ZenModeThumbnail.png` (cảnh rừng tre màu xanh lá nhạt) sau khi import lại hiện
toàn tím/nâu/xám, gần như không còn nét xanh nào. **Nguyên nhân không phải bug thuật toán, mà là giới
hạn bảng màu:** cả 24 màu `SandColor` đều là màu candy bão hoà cao (xem `SAND_COLOR_HEX`'s comment) —
so khoảng cách RGB thuần giữa 1 pixel xanh lá NHẠT và 24 màu đó, màu gần nhất theo toán học lại
thường là `brown`/`white`/`blue` (những màu xỉn hiếm hoi trong bảng) chứ không phải `grass`/`green`
dù mắt người nhìn vẫn rõ ràng thấy "xanh lá". Đã thử cả khoảng cách CIE Lab (chính xác hơn RGB thường)
— vẫn cho kết quả sai tương tự, xác nhận đây thật sự là giới hạn bảng màu chứ không phải công thức đo
khoảng cách.

**Cách sửa:** `nearestSandColor` (`app/LevelEditor.tsx`) giờ ĐẨY ĐỘ BÃO HOÀ của pixel lên trước khi so
khớp (`boostSaturation`: đổi RGB→HSL, nhân độ bão hoà `S` lên `SATURATION_BOOST = 3` lần rồi đổi
ngược lại RGB) — một pixel xanh lá nhạt (bão hoà thấp) được "khuếch đại" về đúng hướng xanh lá của nó
trước khi so, nên rơi đúng vào `grass`/`green`/`mint` thay vì trôi dạt sang `brown`/`white` do bão hoà
gốc thấp. Chỉ áp dụng ở bước so khớp ẢNH THẬT → màu palette (`nearestSandColor`); bước gộp bớt màu khi
vượt `Max colours` (so giữa các màu palette với nhau) giữ nguyên không đổi vì không liên quan tới bug
này. Áp dụng cho MỌI import ảnh (không riêng Zen) — đây là sửa đúng, không phải hành vi riêng của Zen.

Verify bằng cách import lại đúng `ZenModeThumbnail.png`: bầu trời/núi/lá giờ ra đúng tông
xanh lá (`grass`/`green`/`teal`) thay vì tím/xám/nâu như trước.

### "100% chính xác": palette riêng cho từng level Zen (2026-09f)

Sau khi đã sửa bug ở trên, người dùng vẫn thấy chưa đủ: dù đã khớp đúng HƯỚNG màu (xanh lá ra xanh
lá), 24 màu `SandColor` vẫn luôn là 24 màu candy bão hoà CỐ ĐỊNH — một pixel xanh lá nhạt và một pixel
xanh lá đậm trong cùng ảnh gốc vẫn bị ép về chung một màu `grass` bão hoà cao, không phải màu THẬT của
từng pixel. Yêu cầu tiếp theo: "tôi muốn màu import từ ảnh trong zen mode phải 100% chính xác".

RGB tự do hoàn toàn cho từng pixel vẫn là bất khả thi (xem đoạn ngay dưới đây) — luật "bắn cùng màu
để dọn" cần một số hữu hạn màu để còn ghép body/nạp đạn được. Nhưng có một khoảng trống chưa khai thác:
24 "ô màu" (`SandColor`) là hữu hạn và dùng CHUNG cho mọi level, nhưng **hex thật sự mà mỗi ô đó vẽ ra
không nhất thiết phải giống nhau giữa các level** — `SAND_COLOR_HEX` trước giờ là một hằng số toàn cục
vì chưa có level nào cần khác đi.

**Cách làm:** `SandLevelConfig` có thêm field mới `customPalette?: Partial<Record<SandColor, number>>`
— bảng màu HEX ghi đè riêng cho level này, chỉ ảnh hưởng tới việc RENDER (không đụng gì tới matching/
ammo wheel, vẫn nguyên 24 `SandColor` như cũ). `imageToRows` (`app/LevelEditor.tsx`) giờ trả thêm
`palette`: với mỗi ô `SandColor` có ít nhất 1 pixel rơi vào, tính màu trung bình THẬT của đúng những
pixel ảnh gốc đã rơi vào ô đó (không phải màu candy chia sẻ). Khi import ảnh cho một draft Zen, bảng
màu này được lưu vào `draft.customPalette` → `draftToLevel` chuyển thẳng sang
`SandLevelConfig.customPalette` → `SandCannonEngine.ts`'s `sandColorHex(level, color)` (thay mọi chỗ
từng đọc thẳng `SAND_COLOR_HEX[color]`) tra `level.customPalette?.[color] ?? SAND_COLOR_HEX[color]`.
`app/SandGame.tsx`'s HUD (đạn đang nạp, dải đạn sắp tới, tint bầu trời) và `PixelThumb` (thumbnail
trong danh sách Modes) cũng đọc qua `raw?.customPalette`/`level.customPalette` theo đúng cách đó, và
editor's own preview canvas (`app/LevelEditor.tsx`) đọc `draft.customPalette` — mọi nơi từng vẽ sand
bằng `SAND_COLOR_HEX` giờ đều tôn trọng override này.

Kết quả: mỗi bức ảnh Zen có một bộ 24 hex RIÊNG, tinh chỉnh đúng theo màu thật của chính bức ảnh đó,
thay vì dùng chung 24 màu candy với mọi level khác — mất mát duy nhất còn lại so với ảnh gốc là những
pixel có màu thật khác nhau nhưng cùng rơi vào một ô `SandColor` (bắt buộc, vì mechanic cần số ô hữu
hạn), chứ không còn mất mát "đổi hẳn sang một họ màu candy khác" như trước saturation-boost hay sau đó.
Danh sách 50 level chính không đổi gì — không set `customPalette` nên vẫn luôn vẽ bằng `SAND_COLOR_HEX`
chung, giữ đúng phong cách hình ảnh nhất quán across levels như trước giờ.

Verify: import lại `ZenModeThumbnail.png` vào 1 draft Zen mới — cả preview trong editor lẫn thumbnail
ở Modes → Zen Mode lẫn màn chơi 3D thật đều ra đúng tông xanh lá THẬT của ảnh gốc (trời xanh nhạt, núi
sage, tre xanh đậm), khác hẳn nhau giữa các vùng sáng/tối thay vì đồng loạt một màu `grass` candy.

**Vì sao không phải RGB tự do thật sự (đã hỏi lại người dùng trước khi làm):** gameplay dựa vào một bộ
màu HỮU HẠN cho mọi thứ — ghép "body" theo đúng cùng một màu, bánh xe đạn chỉ nạp được màu đã có trong
danh sách hữu hạn đó, `SAND_COLOR_HEX` tra cứu màu để vẽ 3D. Một bức ảnh thật có thể chứa hàng nghìn
sắc độ gần giống nhau — nếu mỗi pixel giữ đúng màu gốc, gần như mọi pixel sẽ thành một "body" riêng lẻ
1 ô, phá vỡ hoàn toàn luật "bắn cùng màu để dọn". Giữ 24 màu `SandColor` làm bộ màu chung (nhưng khớp
chính xác nhất có thể, không rút gọn thêm) là cách giữ đúng luật chơi mà vẫn tối đa hoá độ trung thực
với ảnh gốc.

## Không đụng tới economy

WIN handler trong `SandGame.tsx` kiểm tra `playingZen` trước khi gọi bất kỳ hàm kinh tế nào
(`recordLevelPlayed`, `markLevelCleared`, `addGold`, mở khoá skin) — một màn Zen thắng **hoàn toàn
không** đụng tới vàng, Reward Track, hay trạng thái "đã thắng" dùng cho Gallery. Card WIN vẫn hiện,
nhưng dòng "+X vàng" đổi thành một câu ngắn gọn (`s.zenCleared`) thay vì `s.goldEarned(0)` (tránh đọc
như "bị thiếu hụt" thay vì "cố ý không có gì"). Không có nút "Continue sang level tiếp theo" — Zen
không có thứ tự để nối tiếp, chỉ có nút đóng quay lại danh sách.

## State trong `SandGame.tsx`

| State | Ý nghĩa |
| --- | --- |
| `zenPlayables` | Danh sách Zen, đọc một lần/tải trang qua `useSyncExternalStore` (hydration-safe, cùng pattern `boot`/`playables` chính) |
| `playingZen` | Đang ở "ngữ cảnh Zen" — `raw`/`level` (level đang chơi) đọc từ `zenPlayables` thay vì `playables` khi cờ này bật |
| `zenLevelIndex` | Vị trí trong `zenPlayables` đang chơi |
| `zenPickerOpen` | Tab Modes đang hiện danh sách Zen hay hai thẻ chọn chế độ |

`raw` (level đang chơi) branch thẳng trên `playingZen` — `playables`/`zenPlayables` không bao giờ gộp
chung một mảng vì hai không gian id khác nhau hoàn toàn (`ZEN_ID_BASE`). Rời Zen Mode (bấm tab khác
ngoài "Modes") reset cả `playingZen`/`zenPickerOpen` — xem comment tại chỗ `onClick` của `hub-nav`.

## Test-in-game từ editor — giới hạn đã biết

Nút "Test in game" thường điều hướng `/?level=<tên>`, đọc bởi `readBoot` (chỉ tìm trong danh sách
chính). Một draft Zen sẽ **không** dùng được link đó — thay vào đó editor hiện dòng chữ "Saved
automatically. Play it in-game: Modes → Zen Mode." Đánh đổi có chủ đích để tránh làm deep-link URL
phức tạp thêm (nguy cơ hydration mismatch giống bài học ở Daily Login, xem CHANGELOG-prototype.md
#170) — tác giả lưu draft rồi tự vào Modes → Zen Mode tìm level vừa lưu.
