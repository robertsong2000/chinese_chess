# Changelog

本项目所有重要变更都记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

进行中:Phase 2 / Phase 3 工程化收尾。下一个 TODO 见 `.dev-state.json`。

---

## [0.4.0] - 2026-08-08

### Added
- **README.md**:项目简介、特性(玩法 / AI 引擎 / 工程化)、Docker 快速启动、项目结构、开发指南、技术栈、AI 棋力路线图(`18e6e72`,TODO #11)。
- **LICENSE**:MIT 协议,版权署 song.luo(`db56908`,TODO #12)。
- **.gitignore**:标准 Node + macOS + Linux + IDE 模板(`node_modules/`、`*.log`、`.env`、`.DS_Store`、`.vscode/`、`.idea/`、`dist/`、`coverage/` 等,`c9f54dc`,TODO #13)。
- **GitHub Actions CI**(`.github/workflows/test.yml`):每次 push / PR 在 Node 20 / 22 矩阵运行 `npm test`,benchmark 作为 smoke 步骤以 `continue-on-error` 跑(`78deaaf`,TODO #14)。

### Changed
- `package.json` 加 `license: MIT` 字段。
- Phase 2 工程化门槛全部满足,公开仓库条件具备。

---

## [0.3.0] - 2026-08-08

**Phase 1.5 完成:二级棋士 → 一级棋士冲刺。** 在 Phase 1 基础上,通过搜索算法升级与开局库扩展,把目标棋力推到 Elo 1800-2200 区间。

### Added
- **Hash table / 置换表**(`72e629c`,TODO #23):Zobrist hashing(splitmix32 固定种子,90 个位置 × 14 种子方组合 + 走子方 key)、`createTranspositionTable / ttProbe / ttStore`(EXACT / LOWER / UPPER flag,容量 200k 满则清空)、negamax 集成 probe + store,替换原字符串 cache,`orderMoves` 给 TT best move `+9000` bonus。
- **Principal Variation Search(PVS)**(`73eb5b3`,TODO #24):negamax 首走法用 full window,其余走法用 zero-window 试探,与 LMR 集成(LMR 走法先用 reduced depth + zero-window,改进 alpha 则 full depth + zero-window,仍改进则 full depth + full window)。
- **时间管理**(`153ee94`,TODO #26):`allocateTimeFactor` 按走法数动态分配(≤8 走法 → 1.6x、9-15 → 1.3x、16-25 → 1.0x、>25 → 0.85x,残局 *1.2)。hard 模式启用稳定性早停(连续 2 深度差 < 30 + depth >= 4 提前停)+ 关键局面深度延伸(最后深度改进 > 50 + 时间够则 +1 ply,最多 +2)。
- **开局库扩展 5 → 22 变着**(`f45fd70`,TODO #27):覆盖中炮(顺炮 / 列炮 / 反宫马 / 屏风马)、仙人指路(对卒底炮 / 起马 / 中炮)、飞相局、起马局、过宫炮、仕角炮、五六炮、五七炮等主流布局。每个变着 8 步(4 回合)深度,新增验证脚本确保 176 / 176 步全合法。`OPENING_BOOK_MAX_PLIES` 10 → 12。
- **Web Worker 异步路径**(`80a653c / b0d8718 / 652c029 / 67474a0`,TODO #25):
  - 子任务 A:抽出 `runAISearch(s)` 纯函数,为 worker 化做准备,新建 `ai-worker.js` 骨架。
  - 子任务 B-mini:`createAIWorker()` 工厂(`AI_WORKER_ENABLED` 默认 false)+ ready / ping / pong + ctx 校验 + 5 个 smoke 测试。
  - 子任务 C-min:`chooseAIMoveAsync + scheduleAI` 异步路径,worker 失败 / 超时 fallback 同步,新增 node 环境回归测试。
  - 子任务 B1:`capturedValue / positionRepetitionCount / rootCyclePenalty / preferNonRepeatingMoves` 全部接受可选参数,默认指向 `state` 保持向后兼容,`runAISearch` 内部显式传 `rootCycleOpts`。新增 1 个回归测试。
  - 延后项:子任务 B2(纯函数完整搬运到 worker 端)与 C-full(浏览器实战验证)。Worker 默认禁用,与棋力目标不直接相关。

### Changed
- 测试从 8 个扩展到 15 个(新增 Worker smoke + 参数化回归)。
- AI 棋力 benchmark(hard 4:0 normal,#10)作为 Phase 1.5 验证基线。

---

## [0.2.0] - 2026-08-07

**Phase 1 完成:基础棋力搭建(三级棋士基线)。** 在原有 alpha-beta + quiescence 之上,补齐走法排序、剪枝、评估细化、残局切换等核心组件。

### Added
- **开局库 5 变着**(`00ffdce`,TODO #1):`OPENING_BOOK_LINES`(中炮-屏风马 / 中炮-还中炮 / 仙人指路 / 起马 / 飞相)+ `getOpeningBookMove()` 前缀匹配 + `chooseAIMove` 集成。开局前 5 步不再随机。
- **Killer heuristic**(`bb78125`,TODO #2):`createKillerTable / storeKiller / killerKey`,negamax 接收 `ply + killers`,cutoff 时记录 quiet 走法,`orderMoves` 同层给 `+8000 / +7000` bonus。
- **History heuristic**(`1459d32`,TODO #3):`history[from*90+to] += depth^2`(仅 quiet 走法的 beta cutoff),`orderMoves` 加 bonus(cap 6000),与 killer 互补。
- **Late Move Reduction(LMR)**(`8d9232b`,TODO #4):`LMR_MIN_DEPTH=3 / FULL_MOVE_COUNT=3 / REDUCTION=1`,negamax 中第 4+ 个非吃子走法 depth-1 ply 探查,`alpha < score < beta` 时全深度 re-search。`SEARCH_DEPTH.hard` 4 → 5,hard 在 1.1s 内完成。
- **Null move pruning**(`ff78310`,TODO #5):`NULL_MOVE_MIN_DEPTH=3 / REDUCTION=2`,negamax 在 depth>=3 + 非将军 + beta 有限时先做 null move 试探(零窗口 `[-beta, -beta+1]` 子搜索 `depth-3`),>= beta 直接返回 beta。`allowNull` 参数防止连续 null(zugzwang 防护)。
- **评估:兵过河 +30**(`461ecf0`,TODO #6):`positionalBonus` 重构,先算 table / center 再加 bonus,过河兵额外 +30。
- **评估:车马炮协同**(`a46c18b`,TODO #7):`ATTACK_ZONE_BONUS`(过河车 +30 / 马 +25 / 炮 +20)+ `PAIR_BONUS`(双车 +30 / 双马 +18 / 双炮 +15,按方统计)。
- **评估:王的安全**(`e92dea7`,TODO #8):`KING_SAFETY` 表(full advisor / elephant pair + completeWall,出宫 -30,过河 -20,敌方车同行 / 列距离 <=3 -18,敌方炮同线 2-4 距离 -12),`evaluateBoard` 末尾 `kingSafetyScore(self) - kingSafetyScore(opp)`。这是新手最常失误的飞行将军防守。
- **残局阶段切换评估**(`b80a319`,TODO #9):`isEndgame`(双方非将子力 <=1800)判断,过河兵推进加分、攻击区车马炮 zone 1.5x、士象 -30、将军 +80。
- **AI 棋力 benchmark**(`5693e69`,TODO #10):重写 `tests/ai-benchmark.js` 做 hard vs normal 4 局对弈(交替先后手),通过 `performance.now` 包装缩短 deadline,80 ply 上限 + 40 ply 无吃子和棋 + 子力差判胜。Phase 1 验证结果 hard 4:0 全胜(2 局 checkmate + 2 局 material_majority)。

### Changed
- `SEARCH_DEPTH.hard` 从 4 提升到 5(配合 LMR),hard 模式单步思考时间仍稳定在 ~1.1s 内。
- `chooseAIMove` 改用 TT best move 作为首选,替换原 `(side, depth, canonicalBoardKey)` 字符串 cache。

---

## [0.1.0] - 2026-08-06

### Changed
- 让搜索预算产生更深的有效棋力(`62b98cf`):在原有 alpha-beta 基础上调整搜索深度与时间预算,为后续 LMR / Null move / PVS 等 PR 奠定基础。

---

## [0.0.1] - 2026-04-29

### Added
- **初始发布**:
  - 完整规则覆盖:32 枚棋子、标准开局、将帅照面、蹩马腿、塞象眼、炮架、将军、将死、困毙。
  - 三档难度 AI(easy / normal / hard)。
  - 走法提示、合法落点高亮、悔棋、棋谱记录、对局存档。
  - 时钟计时、胜负判定(将死 / 困毙 / 认输 / 超时)。
  - 走子 / 吃子 / 将军 / 胜负音效。
  - Docker Compose 部署配置(nginx 静态服务,`ced3271`)。

---

[Unreleased]: https://github.com/robertsong2000/chinese_chess/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/robertsong2000/chinese_chess/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/robertsong2000/chinese_chess/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/robertsong2000/chinese_chess/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/robertsong2000/chinese_chess/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/robertsong2000/chinese_chess/releases/tag/v0.0.1
