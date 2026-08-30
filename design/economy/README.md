# Economy design

Thư mục này gom nơi **tự tay chỉnh** số liệu kinh tế của game. Bản thân dữ liệu (file CSV) phải nằm
trong `public/design/` để trình duyệt fetch được lúc runtime (`fetch("/design/...")`) — thư mục này
chỉ là nơi ghi lại nó nằm ở đâu và mỗi cột nghĩa là gì.

## `public/design/economy.csv`

Số kinh tế **chung** của game — không phải theo từng level. Cột `key,value`; sửa số ở cột `value`
rồi lưu, không cần build lại (poll mỗi ~4 giây, hoặc F5). Danh sách key đầy đủ và ý nghĩa từng cái ở
[docs/features/economy-and-wallet.md](../../docs/features/economy-and-wallet.md#số-mặc-định--và-cách-hand-tune-chúng).

Lưu ý: hai dòng `starter...` chỉ ảnh hưởng lúc ví được tạo **mới** (người chơi chưa từng mở game
trên trình duyệt này) — không bao giờ ghi đè lên một ví đã có hoạt động thật (đã kiếm/mua gì đó).

## `public/design/level-rewards.csv`

Vàng thưởng khi thắng, **theo từng level**, ghi đè công thức mặc định
(`levelGoldReward` dựa trên độ khó — xem
[docs/features/level-rewards.md](../../docs/features/level-rewards.md)). Cột `id,name,reward`; chỉ
cần thêm dòng cho level nào muốn chỉnh tay, không bắt buộc điền hết.

## Xem thêm

- [docs/features/economy-and-wallet.md](../../docs/features/economy-and-wallet.md) — ví, booster
  shop, Daily Login.
- [docs/features/level-rewards.md](../../docs/features/level-rewards.md) — công thức thưởng mặc
  định.
- [docs/features/booster-radius-prism-spec.md](../../docs/features/booster-radius-prism-spec.md) —
  cơ chế hai loại booster mà `boosterPrice*`/`starterBooster*` trong `economy.csv` định giá.
