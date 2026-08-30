# Đo độ khó, không đoán

Nguồn: `app/game/level-analysis.ts`, `app/game/level-difficulty.ts`.

Có **hai** hệ thống đo độ khó khác nhau, dễ nhầm vì tên na ná nhau — dùng đúng cái cho đúng việc.

## 1. `analyseLevel` (`level-analysis.ts`) — nút "Measure difficulty"

Ngân sách lượt (`shotLimit`) **chính là** độ khó của một level radius, nên chọn nó bằng cảm tính là
chọn độ khó bằng cảm tính. `analyseLevel` chạy hai model chơi trên **đúng solver của game**
(`resolveShot`, xem [radius-shot-rule.md](radius-shot-rule.md)):

| Model | Hàm | Câu hỏi nó trả lời |
| --- | --- | --- |
| Chơi giỏi | `playStrong` — luôn chọn đĩa lấy được nhiều hạt nhất | Sàn tối thiểu: bao nhiêu lượt là đủ nếu đọc board tốt |
| Chơi ẩu | `playCareless` — bắn đại vào một ô đúng màu, seed cố định | Ngân sách có thật sự phạt được sự cẩu thả không |

Cả hai chạy nhiều lần (`CARELESS_RUNS = 8` cho model ẩu) và trả về `LevelAnalysis`:

```ts
type LevelAnalysis = {
  strongShots: number | null;   // null nếu không thể clear
  carelessWins: number;
  carelessRuns: number;         // = 8
  slack: number | null;         // shotLimit - strongShots
  suggestedShotLimit: number | null; // strongShots + 6 (RECOMMENDED_SLACK)
  verdict: "unclearable" | "too-easy" | "too-tight" | "good";
};
```

Verdict được suy ra thế nào:

- `strongShots === null` → **unclearable** (kể cả chơi giỏi cũng không xong).
- `slack < 0` → **unclearable** (ngân sách không đủ cho cả chơi giỏi).
- `slack < 3` → **too-tight**.
- `carelessWins === carelessRuns` (chơi ẩu thắng cả 8/8 lần) → **too-easy**.
- Còn lại → **good**.

Editor gợi ý `suggestedShotLimit = strongShots + 6` — đủ dư để người chơi giỏi có thể đọc sai một
hai hỗ trợ mà vẫn qua màn.

### Vì sao chạy ở độ phân giải blueprint

Hai model chạy ở **độ phân giải blueprint**, không phải pixel đã mở rộng. Điều này đúng chứ không
phải đi tắt: `expandLevelForPixelBoard` phóng cả tranh lẫn bán kính theo cùng một hệ số nguyên, nên
đĩa phủ đúng cùng một tỉ lệ của cùng một bức tranh — puzzle giống hệt nhau về hình học. Chạy trên
vài trăm ô thay vì vài nghìn là thứ khiến nút này bấm xong có kết quả ngay.

## 2. `computeLevelDifficulty` (`level-difficulty.ts`) — điểm 0–100 cho danh sách editor

**Không** chạy solver — đây là một heuristic rẻ, để xếp hạng **cả danh sách level cùng lúc** mà
không tốn kém như chạy `analyseLevel` từng level một. Năm tiêu chí, trọng số bằng nhau, mỗi cái quy
về 0–1 rồi lấy trung bình:

| Tiêu chí | Ý nghĩa |
| --- | --- |
| `size` | Board càng lớn càng khó |
| `colors` | Càng nhiều màu trong tranh càng khó |
| `interleaving` | Màu càng bị chia nhỏ thành nhiều vùng (thay vì một khối liền) càng khó |
| `ammo` | `shotLimit` càng chặt so với số vùng càng khó |
| `radius` | Bán kính càng nhỏ so với board càng khó |

`difficultyLabel(score)`: `< 25` → easy, `< 50` → medium, `< 75` → hard, còn lại → very-hard.

**Đây cũng là input của công thức thưởng vàng** — xem
[level-rewards.md](level-rewards.md#công-thức-mặc-định) và
[economy-and-wallet.md](economy-and-wallet.md): `economy.ts`'s `levelGoldReward(score)` nhận đúng
điểm số này, nên một level không cần thưởng gán tay — nó đáng giá hơn chính vì nó được đo là khó
hơn.

`computeDifficulty(draft)` là bản wrapper cho một `LevelDraft` (nối `RADIUS_GAMEPLAY` trước qua
`draftToLevel`), dùng trong danh sách level của editor.
