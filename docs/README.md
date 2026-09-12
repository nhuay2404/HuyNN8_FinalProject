# Tài liệu theo từng chức năng

Mỗi file trong `docs/features/` mô tả đầy đủ một chức năng — chỉ cần đọc đúng file đó để định nghĩa
hoặc chỉnh chức năng tương ứng, không cần đọc lại toàn bộ [README.md](../README.md).

| File | Chức năng |
| --- | --- |
| [features/radius-shot-rule.md](features/radius-shot-rule.md) | Luật bắn theo bán kính, bánh xe đạn, win/fail |
| [features/settle-solver.md](features/settle-solver.md) | Cát rơi từng hạt (falling-sand solver) |
| [features/level-format.md](features/level-format.md) | Cách viết một level (rows, palette, ammoQueue, các trường tuỳ chọn) |
| [features/level-editor.md](features/level-editor.md) | Editor ở `/editor`, ship-to-source |
| [features/difficulty-measurement.md](features/difficulty-measurement.md) | Đo độ khó bằng solver thật, và điểm heuristic 0–100 |
| [features/lock-and-key.md](features/lock-and-key.md) | Cát khoá + chìa khoá |
| [features/wind.md](features/wind.md) | Các pha gió theo level |
| [features/booster-radius-prism-spec.md](features/booster-radius-prism-spec.md) | Radius Overcharge, Prism Shot |
| [features/rendering-pixel-board.md](features/rendering-pixel-board.md) | Board pixel 2D trong khung 3D, va chạm, texture |
| [features/economy-and-wallet.md](features/economy-and-wallet.md) | Ví vàng, booster shop, Daily Login |
| [features/level-rewards.md](features/level-rewards.md) | Thưởng vàng theo từng level |
| [features/zen-mode.md](features/zen-mode.md) | Zen Mode — danh sách level riêng, không giới hạn đạn/booster, không thưởng vàng |

Nội dung hand-tunable (không cần đụng code để chỉnh) nằm ở [`design/`](../design/) —
xem [design/levels/README.md](../design/levels/README.md) và
[design/economy/README.md](../design/economy/README.md).
