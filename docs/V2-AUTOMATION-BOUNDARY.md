# v2 自动化阶段边界(2026-08-09)

> 状态:**自动化到边界,cron 自我收敛**。继续 cron 触发不产生新价值。
> 用户决策路径(下方)是恢复 v2 工作的唯一前置条件。

## 已完成(cron 自动化产出)

V2-1 phase(7/7 done)— Pikafish 集成的全部"包装"层:

| TODO | 内容 | 状态 |
|---|---|---|
| #65 | vendor 脚手架 + PikafishEngine wrapper(UCI Promise-based)+ FEN/uci 转换 + 22 测试 | ✅ |
| #66 | ai-worker 双模式(v1 placeholder + v2 pikafish engine mode)+ 17 测试 | ✅ |
| #67 | app.js engine mode 切换 UI + 默认 vanilla fallback + 12 测试 | ✅ |
| #68 | Service Worker 缓存 pikafish.wasm(precache + SWR + versioned)+ 10 测试 | ✅ |
| #69 | real pikafish wasm smoke test(4 档)+ docs/PIKAFISH-LOADER.md gap discovery | ✅ |
| #70 | Pikafish 思考中 UI 进度反馈(depth/score/pv 实时显示)+ 22 测试 | ✅ |
| #71 | bench/v2-benchmark.js self-play harness(dual-engine + auto-degrade + Elo/CI)+ 15 测试 + 2 真实报告 | ✅ |

V2-2 a) #83 — Pikafish 加载失败 → 用户级 notice + 自动切回 vanilla + 18 测试 ✅

**测试基线**:207 总测试,206 pass + 1 skip(Pikafish real UCI handshake,等 wasm 源修复后自动启用)。

**v1 棋力基线**:Elo ~2200(一级棋士),self-play hard vs normal 4/4 胜。
**v2 棋力基线**:不可测(Pikafish 无法 instantiate,见下)。

## 阻塞点

Pikafish 真实运行被两个独立 gap 阻塞,详见 `docs/PIKAFISH-LOADER.md`:

### Gap 1: pthread-only build,缺 `pikafish.worker.js`

`vendor/pikafish/pikafish.{js,wasm}`(来自 `rtrtsdfsdf/pikafish-vue`)是 `-sUSE_PTHREADS=1` build。
Emscripten 主线程 instantiate 时立即调用 `new Worker(locateFile("pikafish.worker.js"))`。
该文件由 Emscripten 编译时生成,但源仓库**不发布** → 任何 instantiate 都失败。

Node 路径(用于 benchmark / 真实棋力测试)无解:Node `worker_threads` 不支持 `importScripts`,
即便我们手写 `pikafish.worker.js`,Node worker 入口也无法 importScripts 主 module。

浏览器路径需要 COOP/COEP headers(启用 SharedArrayBuffer)+ 手写 pthread bootstrap。
PWA / GitHub Pages 场景配置 COEP 麻烦(所有外部资源需 CORP headers),不是简单接入。

### Gap 2: loader-contract mismatch

即便 pthread 问题解决,`PikafishEngine` wrapper(`src/pikafish-engine.js`)与 raw Emscripten
module 之间协议不一致:

| | wrapper 期望 | 真实 Emscripten module |
|---|---|---|
| stdout 回调 | `factory({ onReceiveStdout(line) })` | `factory({ print(txt) })` |
| 命令输入 | `engine.sendCommand("uci")` 方法 | (无 — UCI 引擎通过 stdin 读取) |

Emscripten 浏览器/Node 都没有真正的 stdin。需要内建 stdin bridge(command buffer + 重写
`Module.stdin` 钩子),约 80 行工程量。

## 用户决策路径(三选一)

按代价从低到高,**任一**路径都能解锁 v2 真实棋力目标(Elo 2600+):

### 路径 B:切换 single-threaded build(推荐)

- **代价**:中(需调研可用源 + 重跑 `download-pikafish.sh`)
- **来源**:从 `Official-Pikafish/Pikafish` 主分支用 `-sUSE_PTHREADS=0 -sALLOW_MEMORY_GROWTH=1`
  重新编译;或寻找社区已发布的 single-threaded build。
- **优点**:无 COEP/SharedArrayBuffer 依赖,PWA 场景最干净;Node benchmark 也能跑。
- **缺点**:需要 emsdk 工具链(若自编译);或需调研可用社区 build。

### 路径 C:自编译 pthread build + 自带 `pikafish.worker.js`

- **代价**:高(emsdk + cmake + 服务器 COEP 配置)
- **来源**:`Official-Pikafish/Pikafish` 主分支。
- **优点**:pthread 利用多核,搜索深度更高(可达 depth 25+)。
- **缺点**:部署需 COOP/COEP headers;Node benchmark 仍不可用(worker_threads 无 importScripts)。

### 路径 A+D:用现有 wasm + 自写 bootstrap + stdin bridge

- **代价**:中高(写 pthread bootstrap + stdin bridge,验证 Emscripten stdin hook)
- **风险**:Node 路径无解(已确认),仅浏览器路径可行,且仍需 COEP。
- **不推荐**:工程量等同 B 但保留了 pthread 风险。

## 恢复 cron 的条件

用户完成路径 B 或 C 后:

1. 把新 wasm 放到 `vendor/pikafish/pikafish.{js,wasm}`(single-threaded build 则不需要 worker)
2. 跑 `node --test tests/pikafish-real-engine-smoke.test.js` 验证 Test C/D 不再 skip
3. 编辑 `.dev-state.json`:
   - `converged: false`
   - `converged_at: null`
   - `converged_reason: null`
   - 在 `phases` 数组追加新 phase `V2-1.5`(loader bridge 适配)
4. 重启 cron(或手工触发)

cron 会自动:
- 跑 #71 benchmark framework 出 Elo 实测
- 根据 Elo 决定继续 V2-3(opening book / 多线程优化)还是收敛

## 评估数据(V2-1 phase 评估,记录到 .dev-state.json)

- **tests_pass**: 206/207(+1 intentional skip)
- **depth_reachable**: N/A(pikafish unavailable,无法测)
- **est_elo**: N/A
- **delta_vs_previous**: N/A(首次 v2 评估)
- **判定**:不触发收敛(目标未达成),但所有后续 TODOs 依赖用户决策 → 触发"自动化能力边界收敛"

## 当前可工作但不推进棋力的 TODOs(故意不生成)

- V2-2 b) Service Worker 版本升级策略 — 工程外围,0 Elo delta
- V2-2 c) 移动端 worker 性能监控 — 工程外围,0 Elo delta
- V2-2 d) Error reporting/Sentry 接入预备 — 工程外围,0 Elo delta
- V2-3 opening book framework — 让 vanilla 受益(小幅),但 pikafish 路径阻塞未解
- V2-3 多线程优化 — 依赖 pikafish 真实运行(路径 C 用户决策)
- V2-4 README/PRD/CHANGELOG 更新 — 等 v2 真实棋力数据后才有意义

继续 cron 自动化的边际价值 = 0 Elo,纯 polish。符合收敛配置
`convergence_min_delta_percent = 10%` 的收敛判定。
