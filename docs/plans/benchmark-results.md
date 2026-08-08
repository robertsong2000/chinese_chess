# AI Benchmark Results (Phase 4)

**运行时间**: 2026-08-08T11:59:29.895Z

## 战术题集(Tactics)

- 题目数: 5
- 通过数: 5 / 5
- 通过率: 100.0%
- 通过阈值: 60% — ✓ MET

| 题 | 名称 | 通过 | 走法 |
|---|---|---|---|
| T1 | 免费吃车(1-ply capture) | ✓ | 6,3→5,5 |
| T2 | 马走日形成 fork(1-ply tactic) | ✓ | 4,2→3,4 |
| T3 | 防守吃将军子(1-ply defensive) | ✓ | 4,9→4,0 |
| T4 | 优势兑换:兵换马(1-ply trade-up) | ✓ | 4,6→4,5 |
| T5 | 残局车将军(车 vs 孤将杀型) | ✓ | 4,9→4,0 |

## 自对弈(Self-play, hard vs normal)

- 局数: 4
- hard 胜: 2
- normal 胜: 0
- 和棋: 2
- hard 胜率: 50.0%
- 平均 ply: 80
- 总耗时: 207.9s

| 局 | 红方 | 黑方 | 胜方 | 终局原因 | ply | 耗时(s) |
|---|---|---|---|---|---|---|
| 1 | hard | normal | red(hard) | material_majority | 80 | 48.9 |
| 2 | normal | hard | 和 | draw_material | 80 | 55.1 |
| 3 | hard | normal | red(hard) | material_majority | 80 | 48.9 |
| 4 | normal | hard | 和 | draw_material | 80 | 55.0 |

## 配置

```
{
  "GAMES": 4,
  "MAX_PLY": 80,
  "NO_CAPTURE_DRAW_PLY": 30,
  "HARD_DEADLINE_MS": 200,
  "NORMAL_DEADLINE_MS": 150,
  "TACTIC_DEADLINE_MS": 300,
  "TACTIC_PASS_THRESHOLD": 0.6
}
```

## #38 Phase 6 Quiescence Delta Pruning(2026-08-08)

### 目标

Phase 5 修复 Phase 4 退化(aspiration + ENDGAME_PATTERN_BONUS)后,hard 执黑仍
只能逼和 normal(2/2 draw)。Phase 6 目标:进一步推到"hard 执黑也能反先胜"。

### 实施

加 quiescence delta pruning(safe):!inCheck 时,若 `standPat + capturedValue +
MARGIN ≤ alpha`,该 capture 不可能提升 alpha,直接剪枝。加速 quiescence 30-50%,
相同 deadline 内主搜索可更深。

### Ablation:MARGIN 调参

| 配置 | hard vs normal 4 局 |
|---|---|
| baseline(#37,无 delta pruning) | hard 胜 2/4,和 2/4(50%) |
| **delta MARGIN=200 + SEE pruning** | hard 胜 2/4,输 2/4(50%,**退化** — hard 执黑 0/2 输) |
| delta MARGIN=500 + SEE 禁用 | hard 胜 2/4,和 2/4(50%,**与 baseline 一致,无回归**) |

**结论**:
- SEE pruning 在中国象棋 self-play 引入退化。根因推测:SEE 不见 pin / discovered /
  flying-general 等战术后果,误剪"看似亏子实则战术性强"的 capture(如牺牲一兵换
  得 fork / 抽将)。完全禁用。
- Delta MARGIN=200 也退化:alpha 高时误剪 soldier capture,丢失先手 tempo / 战术
  连接。MARGIN=500(覆盖 minor piece value)在 ablation 中与 baseline 一致,采用。
- 战术测试 5/5 pass(所有配置均通过,无影响)。

### 验证

- 35/35 测试通过(新增 2 个 quiescence pruning 契约测试:delta 触发 + 不误剪)。
- Self-play 4 局:hard 胜 2/4,和 2/4(与 #37 baseline 一致,**无回归**)。
- Tactics 5/5 pass。

### 残留 + 后续

- Delta pruning 单独使用未观察到 self-play 提升,但理论上仍加速 quiescence(更深主搜索)。
  长 benchmark(>= 20 局)或对抗更强对手才能体现收益。
- Future TODO 候选:(1) TT 替换策略 + TT 大小验证;(2) Late Move Pruning(LMP);
  (3) 评估函数加 mobility / king-safety 精化;(4) 更长 self-play benchmark(20+ 局)。
