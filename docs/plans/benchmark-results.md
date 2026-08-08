# AI Benchmark Results (Phase 4)

**运行时间**: 2026-08-08T11:38:15.877Z

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
- 总耗时: 191.8s

| 局 | 红方 | 黑方 | 胜方 | 终局原因 | ply | 耗时(s) |
|---|---|---|---|---|---|---|
| 1 | hard | normal | red(hard) | checkmate | 79 | 40.7 |
| 2 | normal | hard | 和 | draw_material | 80 | 55.3 |
| 3 | hard | normal | red(hard) | checkmate | 79 | 40.7 |
| 4 | normal | hard | 和 | draw_material | 80 | 55.1 |

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

## #37 Phase 5 残留退化定位 + 修复(2026-08-08)

### 现象(#36 修复后)

`BENCH_GAMES=4 BENCH_HARD_MS=200 BENCH_NORMAL_MS=150` self-play:hard 执红稳定
checkmate 胜(2/2);hard 执黑不稳定 — 1 局 draw_material + 1 局 material_majority
输 normal。hardWinRate=0.5,但 hard 执黑仍有"输 normal"的退化路径。

### 消融实验(Ablation)

怀疑 #30 Aspiration Window / Root PVS 引入退化。把 ASPIRATION_MIN_DEPTH 临时
调到 99(完全禁用),保留 root PVS,重跑 4 局 benchmark:

| 候选 | 结果 |
|---|---|
| aspiration 启用 + PVS 启用(current) | hard 执黑 1 和 + 1 输(hardWinRate=0.5) |
| **aspiration 禁用 + PVS 启用** | **hard 执黑 2 和(hardWinRate=0.5,但 hard 执黑不再输)** |

**结论**:Aspiration Window 是 hard 执黑输 normal 的元凶之一。Root PVS 单独
保留不引入退化(aspiration 禁用后 hard 执黑全部和棋)。

### 根因推测

aspiration 窗口 ±150 在评分剧烈变化时(开局转中局典型)过窄,fail-high/low
频繁触发 re-search。re-search 在剩余 deadline 不足时返回 lower/upper bound
(不是真实分数),让 `prevBestScore` 累积漂移。中国象棋评估函数精度有限
(无 chess 经典 Stockfish 那种 ultra-fine-tuned eval),窄窗口风险高于收益。

### 修复

```js
// src/constants.js — 加 ENABLED flag,默认 false
const ASPIRATION_ENABLED = false;  // #37 禁用,保留代码便于将来重新启用

// src/search.js — aspiration 触发条件加 ENABLED 守卫
if (ASPIRATION_ENABLED && depth >= ASPIRATION_MIN_DEPTH && prevBestScore !== null) {
  alpha = prevBestScore - ASPIRATION_WINDOW;
  beta = prevBestScore + ASPIRATION_WINDOW;
} else {
  alpha = -Infinity;
  beta = Infinity;
}
```

### 验证

修复后缩减 benchmark(4 局):hard 执红 2/2 胜,hard 执黑 2/2 和棋 — 与 ablation
数据一致(hard 执黑不再输)。33/33 测试通过(契约测试扩展验证 ASPIRATION_ENABLED=false)。

### 残留 + 后续

- hard 执黑仍未能胜 normal 执红(只和棋)— 中国象棋红先优势 + normal 弱,
  hard 执黑至少应能逼和(已实现),但反先胜需要更深搜索 / 更精确评估。
- Future TODO 候选:(1) 在评估函数精度提升后重新启用 aspiration(配合稳定守卫);
  (2) quiescence SEE/Delta pruning 减少明显亏子 capture 的搜索;
  (3) 更多战术题(>= 10)+ longer self-play(>= 20 局)提置信度。
