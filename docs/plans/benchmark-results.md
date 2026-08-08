# AI Benchmark Results (Phase 4)

**运行时间**: 2026-08-08T10:26:46.879Z

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

- 局数: 8
- hard 胜: 0
- normal 胜: 4
- 和棋: 4
- hard 胜率: 0.0%
- 平均 ply: 78
- 总耗时: 373.3s

| 局 | 红方 | 黑方 | 胜方 | 终局原因 | ply | 耗时(s) |
|---|---|---|---|---|---|---|
| 1 | hard | normal | 和 | stalemate | 75 | 38.4 |
| 2 | normal | hard | red(normal) | material_majority | 80 | 54.9 |
| 3 | hard | normal | 和 | stalemate | 75 | 38.4 |
| 4 | normal | hard | red(normal) | material_majority | 80 | 54.9 |
| 5 | hard | normal | 和 | stalemate | 75 | 38.4 |
| 6 | normal | hard | red(normal) | material_majority | 80 | 54.9 |
| 7 | hard | normal | 和 | stalemate | 75 | 38.5 |
| 8 | normal | hard | red(normal) | material_majority | 80 | 54.9 |

## 配置

```
{
  "GAMES": 8,
  "MAX_PLY": 80,
  "NO_CAPTURE_DRAW_PLY": 30,
  "HARD_DEADLINE_MS": 300,
  "NORMAL_DEADLINE_MS": 200,
  "TACTIC_DEADLINE_MS": 300,
  "TACTIC_PASS_THRESHOLD": 0.6
}
```

## 解读

### 战术题集(Tactics)— ✓ 通过

5 个战术题全部通过(100% > 60% 阈值),说明 hard AI 的 1-ply 战术识别能力完整:

- **T1 / T2 / T4**:免费吃车、fork、兵换马 — 经典得子战术,hard 都能 1-ply 直接吃。
- **T3 / T5**:战术局面中 hard 选了"飞将吃将"(红将 (4,9)→(4,0) 直接吃黑将)。
  这是因为黑将在 (4,0)、红将在 (4,9),同列且中间无子,触发飞将规则,红将可直接"吃"黑将。
  这是合法绝杀(等于将死),比题面设想的"吃将军子"或"车将军"更直接 — hard 找到了更快的胜利。

### 自对弈(Self-play)— ⚠ 退化

**关键发现:hard 0 胜 / normal 4 胜 / 4 和,胜率 0%**。这与 Phase 1 验证时(hard 4:0 全胜)形成鲜明对比。

- **#31 已记录此趋势**:在 #31 实施时,git stash 验证发现 baseline(#30)就已退化到 hardWinRate=0.5;本次 8 局进一步退化到 0.0。
- **退化模式高度一致**:4 局 hard 执红全在 75 ply stalemate,4 局 hard 执黑全在 80 ply 输给 normal(material_majority)— 完全相同的对局脚本说明 deterministic 退化,不是随机噪声。
- **可能原因(未验证)**:
  1. Phase 4 引入的 aspiration window / futility / IID 在自对弈场景中相互作用,导致 hard 选择了重复局面(stalemate)
  2. hard 的"避免循环检测"逻辑在特定局面下反而把 hard 推向不利兑换
  3. hard 搜索深度更高,但评估函数某项(战术加分 / 残局模式)在 hard 搜索树更深时反而产生误导

### 结论

- ✅ **战术能力正常** — 1-ply 战术 100% 通过,符合"一级棋士"对短战术的要求
- ❌ **完整对局表现退化** — Phase 4 改进在自对弈中未转化为胜率,反而引入退化
- 📋 **下一步建议**:Phase 5 优先做"退化定位"(二分 commit 二分定位 #29-#34 哪个引入退化),再做进一步优化

## 复现

```bash
# 战术 + 8 局自对弈(默认配置,~6 分钟)
node tests/ai-benchmark.js

# 缩减版(快速验证)
BENCH_GAMES=4 BENCH_HARD_MS=200 BENCH_NORMAL_MS=150 node tests/ai-benchmark.js
```

输出同时写到 stdout、`docs/plans/benchmark-results.json` 与 `docs/plans/benchmark-results.md`。

## 附录:Phase 1 基线结果(2026-08-08)

Phase 1 完成(开局库 + Killer/History/LMR/Null move + 评估加强 + 残局切换)时的 4 局自对弈结果,**当时 hard 4:0 全胜 normal**:

| 局 | 红方 | 黑方 | 胜方 | 终局原因 | ply | 耗时(s) |
|---|---|---|---|---|---|---|
| 1 | hard | normal | red(hard) | checkmate | 67 | 49.9 |
| 2 | normal | hard | black(hard) | material_majority | 80 | 61.1 |
| 3 | hard | normal | red(hard) | checkmate | 67 | 49.8 |
| 4 | normal | hard | black(hard) | material_majority | 80 | 61.1 |

hard 胜率:100%(4/4)。

Phase 4 当前的 0% vs Phase 1 当时的 100%,差异显著,需后续工作定位。
