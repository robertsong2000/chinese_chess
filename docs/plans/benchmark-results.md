# AI Benchmark Results (Phase 4)

**运行时间**: 2026-08-08T17:48:36.267Z

## 战术题集(Tactics)

- 题目数: 10
- 通过数: 10 / 10
- 通过率: 100.0%
- 通过阈值: 60% — ✓ MET

| 题 | 名称 | 通过 | 走法 |
|---|---|---|---|
| T1 | 免费吃车(1-ply capture) | ✓ | 6,3→5,5 |
| T2 | 马走日形成 fork(1-ply tactic) | ✓ | 4,2→3,4 |
| T3 | 防守吃将军子(1-ply defensive) | ✓ | 4,9→4,0 |
| T4 | 优势兑换:兵换马(1-ply trade-up) | ✓ | 4,6→4,5 |
| T5 | 残局车将军(车 vs 孤将杀型) | ✓ | 4,9→4,0 |
| T6 | 炮通过架子吃无保护马(cannon capture via screen) | ✓ | 3,9→3,5 |
| T7 | 过河兵吃高价值子(soldier trade-up) | ✓ | 4,5→4,4 |
| T8 | 防守反吃将军子(defensive counter-capture) | ✓ | 4,8→4,5 |
| T9 | 红马 fork 黑车 + 黑炮(horse fork - RED side) | ✓ | 4,6→3,4 |
| T10 | 双炮重叠:后炮通过前炮吃车(nested cannon capture) | ✓ | 4,9→4,5 |

## 自对弈(Self-play, hard vs normal)

- 局数: 4
- hard 胜: 2
- normal 胜: 1
- 和棋: 1
- hard 胜率: 50.0%
- 平均 ply: 80
- 总耗时: 189.5s

| 局 | 红方 | 黑方 | 胜方 | 终局原因 | ply | 耗时(s) |
|---|---|---|---|---|---|---|
| 1 | hard | normal | red(hard) | material_majority | 80 | 44.1 |
| 2 | normal | hard | 和 | draw_material | 80 | 50.8 |
| 3 | hard | normal | red(hard) | material_majority | 80 | 44.3 |
| 4 | normal | hard | red(normal) | material_majority | 80 | 50.3 |

## 配置

```
{
  "GAMES": 4,
  "MAX_PLY": 80,
  "NO_CAPTURE_DRAW_PLY": 30,
  "HARD_DEADLINE_MS": 200,
  "NORMAL_DEADLINE_MS": 200,
  "TACTIC_DEADLINE_MS": 300,
  "TACTIC_PASS_THRESHOLD": 0.6
}
```
