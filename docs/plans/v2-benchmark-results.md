# v2 Self-play Benchmark Results

**运行时间**: 2026-08-09T05:41:48.332Z
**Pikafish 可用**: no (已降级到 vanilla hard)

## 配置

```json
{
  "games": 2,
  "redEngine": "pikafish(d=12)",
  "blackEngine": "vanilla-hard",
  "maxPly": 20,
  "drawPly": 15,
  "pikafishDepth": 12
}
```

## Pikafish 状态

- 红方: unavailable: pikafish.worker.js not bundled (pthread bootstrap unavailable)
- 黑方: n/a

## 总计

- 局数: 2
- 红方胜: 2
- 黑方胜: 0
- 和棋: 0
- 红方得分率: 100.0%
- Elo 差(红 vs 黑): 800 (95% CI: -113 ~ 800)
- 降级走子数: 20
- 平均 ply: 20
- 总耗时: 23.0s

## Per-game

| 局 | 红方 | 黑方 | 胜方 | 终局原因 | ply | 耗时(s) | 降级 |
|---|---|---|---|---|---|---|---|
| 1 | pikafish(d=12) | vanilla-hard | red | material_majority | 20 | 11.5 | 10 |
| 2 | pikafish(d=12) | vanilla-hard | red | material_majority | 20 | 11.5 | 10 |

## 解读说明

- 当 `pikafishAvailable=false` 时,Elo 差反映的是 vanilla 配置之间的差距,**不是 Pikafish 真实棋力**。
- 95% CI 宽度 > 200 Elo 时,样本量不足;应增加 `BENCH_GAMES`。
- Pikafish 不可用的根因与路径选择详见 `docs/PIKAFISH-LOADER.md`。
