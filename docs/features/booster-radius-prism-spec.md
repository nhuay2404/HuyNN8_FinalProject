# Booster: Radius Overcharge & Prism Shot

Nguồn: `app/game/sand-types.ts` (`BoosterType`), `app/game/sand-rules.ts` (`effectiveSortRadius`,
`getBoosterCharges`, `spendBoosterCharge`, `cellsInRadius`), `app/game/SandCannonEngine.ts`
(`armBooster`, overlay ring), `app/game/economy.ts` (giá và số viên khởi đầu), `app/SandGame.tsx`
(HUD, Shop).

Nhiều chỗ trong code trỏ tới file này bằng đúng tên (`booster-radius-prism-spec.md §N`) — số mục
dưới đây khớp với những chỗ trỏ đó.

## §1. Radius Overcharge

Nhân đôi `sortRadius` cho một phát bắn (`effectiveSortRadius` trong `sand-rules.ts`), nhưng chặn ở
đường chéo của khung (spec §7.3, xem bên dưới). Không đổi gì khác của phát bắn — vẫn phải đúng màu
đang cầm, vẫn tính là một lượt như bình thường.

## §2. Prism Shot

Bỏ điều kiện đúng màu: `cellsInRadius(..., { matchColor: false })`. Một phát Prism Shot lấy **mọi**
màu trong đĩa, không chỉ màu đang cầm — có thể xoá nhiều body khác màu cùng lúc nếu chúng nằm trong
tầm.

## §3. Mutually exclusive — không đổi, huỷ được bằng cách bấm lại

Một session chỉ có tối đa **một** booster armed tại một thời điểm. `armBooster(type)` là no-op nếu
đã có booster *khác* đang armed (`SandCannonEngine.ts`) — không đổi giữa chừng. Nhưng gọi lại
`armBooster(type)` với đúng loại đang armed sẽ **huỷ** nó (toggle), không tốn viên nào — huỷ chỉ đặt
lại trạng thái, viên chỉ thực sự trừ lúc bắn (`spendBoosterCharge`). Ngoài bắn đi, bấm lại nút đang
armed cũng thoát được trạng thái armed.

## §4. Số viên — ví người chơi

Số viên còn lại của mỗi loại nằm trong ví (`economy.ts`'s `Wallet.boosters`), không phải một hằng số
cố định. `getBoosterCharges(type)` (`sand-rules.ts`) đọc qua `getBoosterCount` (`economy.ts`). Nạp
thêm bằng Shop (`buyBoosterCharge`) — xem [economy-and-wallet.md](economy-and-wallet.md).

Số viên khởi đầu và giá mỗi viên hand-tune được qua `public/design/economy.csv` — xem
[design/economy/README.md](../../design/economy/README.md).

## §5. `requiresBooster` — level bắt buộc dùng booster

`SandLevelConfig.requiresBooster?: BoosterType[]` đánh dấu level cần một shot dùng đúng booster đó
làm nước đi load-bearing, không chỉ để hỗ trợ. **Hiện chưa có gì đọc trường này** — đây là data flag
chờ một solver/validator tương lai (xem [level-format.md](level-format.md)).

## §6. UI: không có chữ trên nút booster

Nút booster trong HUD không có text — chỉ icon riêng cho từng loại (`BoosterIcon` trong
`SandGame.tsx`), tái dùng hệ màu gameplay. Khi armed, engine vẽ một vòng ring layered ngoài buồng
đạn và đầu nòng (`syncBoosterOverlay`), một cặp ring riêng cho mỗi loại booster — cách hai hệ màu
(màu cát và màu booster) không lẫn vào nhau.

## §7. Vòng đời của một shot boosted

### §7.1. Tiêu thụ ngay khi rời nòng

Một charge bị trừ **ngay khi đạn rời nòng** (`SandCannonEngine.fire()`), không phải lúc arm. Nghĩa
là: arm một booster rồi restart level trước khi bắn thì **không** mất charge — engine cũ giữ trạng
thái armed đã bị huỷ cùng lúc với level.

### §7.3. Trần bán kính (Open Question, đã chốt bảo thủ)

Radius Overcharge nhân đôi `sortRadius`, nhưng bị chặn ở đường chéo của khung
(`Math.hypot(frame.width, frame.height)`): quá điểm đó, một con số lớn hơn không mua thêm gì vì
không ô nào trong khung xa hơn khoảng cách đó tính từ bất kỳ tâm nào — nên không có lý do để bán
kính của một level nhỏ phình ra thành một con số chỉ trông sai trong debugger. Cách giải quyết bảo
thủ này dùng chung cho cả `resolveShot` và renderer, nên vòng tròn vẽ trước khi bắn và đĩa mà phát
bắn thực sự resolve theo không bao giờ lệch nhau.

## Hiệu ứng hình ảnh khi armed

Đạn phóng lớn hơn khi Radius Overcharge armed (`BOOSTER_PROJECTILE_SCALE = 1.6` trong
`SandCannonEngine.ts`). Ring overlay quay/nhấp nháy liên tục khi một booster đang armed, để trạng
thái armed không bao giờ trông đứng yên/dễ bị bỏ quên.
