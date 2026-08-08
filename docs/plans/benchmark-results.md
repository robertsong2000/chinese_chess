# AI Benchmark Results (Phase 5 #36 退化定位 + 修复)

**运行时间**: 2026-08-08T10:53:16.771Z

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

## 自对弈(Self-play, hard vs normal)— #36 修复后

- 局数: 4
- hard 胜: 2
- normal 胜: 2
- 和棋: 0
- hard 胜率: 50.0%(从 #35 的 0% 回升)
- 平均 ply: 80
- 总耗时: 186.5s

| 局 | 红方 | 黑方 | 胜方 | 终局原因 | ply | 耗时(s) |
|---|---|---|---|---|---|---|
| 1 | hard | normal | red(hard) | checkmate | 79 | 40.9 |
| 2 | normal | hard | red(normal) | material_majority | 80 | 52.4 |
| 3 | hard | normal | red(hard) | checkmate | 79 | 40.8 |
| 4 | normal | hard | red(normal) | material_majority | 80 | 52.5 |

## #36 退化定位与修复(Phase 5)

### 现象(Phase 4 完成时 #35)

`BENCH_GAMES=8` 自对弈 hard 0/4 normal 4/4 4 和,hardWinRate=0%。退化模式高度
deterministic:4 局 hard 执红全 75 ply stalemate,4 局 hard 执黑全 80 ply 输 normal
(material_majority)。

### 消融实验(Ablation)

逐一把 Phase 4 引入的评估常量置 0,跑 `BENCH_GAMES=4 BENCH_HARD_MS=150 BENCH_NORMAL_MS=100`
缩减 benchmark,定位元凶:

| 候选 | TODO | 假设 | 结果 |
|---|---|---|---|
| ENDGAME_PATTERN_BONUS=0 | #34 | 残局加分扭曲评估 | **hardWinRate 0% → 50% ✓ 元凶** |
| TACTIC_BONUS=0 | #33 | (未测,因 #34 已定位) | — |

### 根因

`ENDGAME_PATTERN_BONUS`(原值 500/500/500/300/200)有两个问题:

1. **幅度过大**:500 ≈ 半个马的价值,在评估函数中过度放大"必胜结构"的吸引力,
   让 hard 在战术上失先手过度追求某种结构。
2. **缺少阶段守卫**:中局阶段(双方非将子力 > ENDGAME_THRESHOLD)也可能触发 —
   如某方早早丢马炮剩单车,endgamePatternBonus 仍会加 +500,严重扭曲评估。

### 修复

```js
// src/constants.js — 幅度降到原值 ~40%
const ENDGAME_PATTERN_BONUS = {
  chariotCannonVsChariot: 200,     // 原 500
  chariotHorseVsChariot: 200,      // 原 500
  horseSoldierVsAdvisor: 200,      // 原 500
  chariotVsGuardsOnly: 120,        // 原 300
  advancedSoldierVsLoneKing: 80,   // 原 200
};

// src/search.js — isEndgame 守卫
function endgamePatternBonus(board, side) {
  if (!ENDGAME_PATTERN_BONUS) return 0;
  if (!isEndgame(board)) return 0;   // 中局不触发
  // ...
}
```

### 验证

修复后缩减 benchmark:hardWinRate 0% → 50%(2 checkmate 胜 + 2 material_majority 输)。
关键改善:hard 执红从"必 stalemate"变成"必 checkmate 胜"(2 局均 79 ply checkmate)。

33/33 测试通过(原 32 + 新增 1 个中局守卫回归测试)。

### 残留问题

hard 执黑仍然输 normal 执红(material_majority 80 ply)— 这是 #30 Aspiration Window
引入的 baseline 退化,#36 未能修复。建议 Phase 5 后续 TODO 单独处理(候选:root PVS
在执黑先手劣势下评估偏移,或开局库执黑分支偏弱)。

## 配置

```
{
  "GAMES": 4,
  "MAX_PLY": 80,
  "NO_CAPTURE_DRAW_PLY": 30,
  "HARD_DEADLINE_MS": 150,
  "NORMAL_DEADLINE_MS": 100,
  "TACTIC_DEADLINE_MS": 300,
  "TACTIC_PASS_THRESHOLD": 0.6
}
```
