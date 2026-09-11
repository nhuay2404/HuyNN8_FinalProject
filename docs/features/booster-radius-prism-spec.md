# Booster: Radius Overcharge, Prism Shot & Chain Sort

Nguồn: `app/game/sand-types.ts` (`BoosterType`), `app/game/sand-rules.ts` (`effectiveSortRadius`,
`getBoosterCharges`, `spendBoosterCharge`, `cellsInRadius`, `cellsByFloodFill`),
`app/game/SandCannonEngine.ts` (`armBooster`, overlay ring), `app/game/economy.ts` (giá và số viên
khởi đầu), `app/SandGame.tsx` (HUD, Shop).

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

## §2.1. Chain Sort

Bỏ hẳn đĩa bán kính: không dùng `cellsInRadius`, mà `cellsByFloodFill` — lan từ đúng ô va chạm ra
mọi ô CÙNG MÀU liền kề, kể cả chỉ chạm nhau ở góc (8 hướng, không phải `ORTHOGONAL_4` như luật ghép
"body" thường dùng ở mọi chỗ khác trong file). Không giới hạn số ô lấy được — một mảng liền kề dù to
cỡ nào cũng bị dọn sạch trong một phát, miễn đúng màu (có `matchColor`, không xuyên màu như Prism
Shot). Không có bán kính để hiển thị — vòng ring aim ẩn hẳn khi armed loại này (khác Radius
Overcharge/Prism Shot, cả hai đều có ring riêng), và preview "lift" trước khi bắn cũng không áp dụng
được kiểu bán kính cố định.

Giá cao hơn hai loại kia (`BOOSTER_PRICE.chainSort`, xem [economy-and-wallet.md](economy-and-wallet.md))
đúng vì không có trần: một cú Chain Sort trúng một mảng khổng lồ có thể dọn nhiều hơn hẳn bất kỳ đĩa
bán kính nào, dù đã Overcharge.

Icon/art dùng tạm icon Prism Shot (`/icons/PrismChargeIcon.png`) cho tới khi có art riêng — `BoosterIcon`
(`SandGame.tsx`) coi mọi loại không phải Radius Overcharge là "dùng art Prism", nên Chain Sort tự
động rơi vào nhánh đó mà không cần thêm asset mới.

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

Ring overlay quay/nhấp nháy liên tục khi một booster đang armed, để trạng thái armed không bao giờ
trông đứng yên/dễ bị bỏ quên.

### Trong lúc bay

Đạn Radius Overcharge rời nòng ở kích thước bình thường rồi phình to dần trong lúc bay, đúng lúc
chạm khung thì đạt kích thước lớn nhất — bằng đúng bán kính hiệu lực của phát bắn đó (mép ngoài của
`sortRing`, xem `radiusBoosterMaxProjectileScale` trong `SandCannonEngine.ts`), không phải một hằng
số cố định như `BOOSTER_PROJECTILE_SCALE` (vẫn giữ lại làm fallback cho level không có `sortRadius`).
Tiến độ phồng to tính theo trục z từ nòng súng tới mặt phẳng khung tranh.

Đạn Prism Shot đổi màu theo vòng quang phổ suốt đường bay (`PRISM_PROJECTILE_HUE_HZ`) và để lại một
vệt cầu vồng — các mảnh nhỏ cùng màu với đạn tại thời điểm đó, rơi rớt lại phía sau
(`spawnPrismTrail`, dùng chung pool shard với hiệu ứng costume ma thuật).
