# Pikafish WASM Loader:契约差距与路径选择(v2 #69)

> 状态:**discovery(2026-08-09)**。当前 `vendor/pikafish/pikafish.{js,wasm}`
> 来自 `rtrtsdfsdf/pikafish-vue` 仓库,**无法直接驱动**。本文记录差距与可选路径。

## 现状(2026-08-09)

`vendor/pikafish/download-pikafish.sh` 默认从 `pikafish-vue` 拉取两个文件:

- `pikafish.js`(37 KB)— Emscripten module factory(CommonJS export)
- `pikafish.wasm`(701 KB)— wasm 二进制

拉取后,**任何尝试 `require()` 它并在 Node 里 instantiate 的代码,都会在
`PThread.allocateUnusedWorker()` 阶段抛**:

```
Error: Cannot find module '/.../vendor/pikafish/pikafish.worker.js'
```

## 差距 1:缺 `pikafish.worker.js`(pthread bootstrap)

Emscripten 的 `-sUSE_PTHREADS=1` build 在主线程 instantiate 时,**立即**调用:

```js
allocateUnusedWorker() {
  var pthreadMainJs = locateFile("pikafish.worker.js");
  worker = new Worker(pthreadMainJs);          // ← Node:worker_threads,需 .js 文件存在
  PThread.unusedWorkers.push(worker);
}
```

`pikafish.worker.js` 由 Emscripten 编译时生成(pthread bootstrap,通常 ~1 KB),
内容大致是 `importScripts('./pikafish.js'); Pikafish({ ENVIRONMENT_IS_PTHREAD: true });`。
`pikafish-vue` 仓库**只发布 `pikafish.js` + `pikafish.wasm`**,不发布该 bootstrap
文件 → 该 wasm 在 Node 和浏览器里**都无法 instantiate**。

排查过 `pikafish-vue` 的实际代码(`src/utils/engine.ts`):他们走的是 Capacitor
原生插件(`@capacitor-community/pikafish-engine` 类似的 native bridge),`public/engine/`
里的 wasm 文件并未在他们的 web 路径里实际使用 —— 只是历史遗留。

### 解决路径(差距 1)

按代价从低到高:

| 方案 | 代价 | 备注 |
|------|------|------|
| **A. 自己写 `pikafish.worker.js`** | 低(5-10 行) | 标准 Emscripten pthread bootstrap;但浏览器仍需 COOP/COEP headers(`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`)才能用 `SharedArrayBuffer` |
| **B. 找 single-threaded build** | 中(需调研) | 用 `-sUSE_PTHREADS=0 -sALLOW_MEMORY_GROWTH=1` 重新编译;无 SAB/COEP 要求;**推荐用于本项目**(PWA 场景 COEP 配置麻烦) |
| **C. 自己从源码编译** | 高(Emscripten toolchain) | `Official-Pikafish/Pikafish` 主分支支持 em build,需 `emsdk + cmake`;产出可控 |

## 差距 2:loader-contract mismatch

即便 pthread 问题解决(wrapper 的 `loaderFactory` 拿到能 instantiate 的 factory),
`PikafishEngine` wrapper(`src/pikafish-engine.js`)仍无法驱动引擎,因为契约不一致:

| | wrapper 期望 | 真实 Emscripten module |
|---|---|---|
| stdout 回调 | `factory({ onReceiveStdout(line), onExit(code) })` | `factory({ print(txt), printErr(txt), noInitialRun })` |
| 命令输入 | `engine.sendCommand("uci")` 方法 | (无 —— UCI 引擎通过 stdin 读取) |
| 退出信号 | `onExit(code)` | `onExit(code)` ✓ |

差距根源:UCI 引擎被设计为 stdin/stdout 进程,而 Emscripten 在浏览器/Node 里
没有真正的 stdin。需要一层 **stdin bridge**:维护命令队列,当引擎调用
`Module.stdin()`(或等价的 `getchar` 钩子)时从队列取字节。

### 解决路径(差距 2)

| 方案 | 代价 | 备注 |
|------|------|------|
| **D. wrapper 内建 stdin bridge** | 中(~80 行) | `loaderFactory` 适配器把 raw module 包成 `{ sendCommand }`,内部维护 `commandBuffer` + `print`→`onReceiveStdout`。需要 Emscripten build 暴露 `Module.stdin`(标准行为) |
| **E. 找带 `sendMessage` API 的 build** | 中(需调研) | 部分社区 build(如 lila-chess 的 stockfish.js)内建了 sendCommand;但 xiangqi 社区暂时没有等价物 |

## 推荐路径

**短期(本 cron 内可做)**:方案 **A + D**

1. 写 `vendor/pikafish/pikafish.worker.js`(标准 bootstrap,~10 行)。注意:这只解
   决 Node `worker_threads` 路径;浏览器路径还需 COOP/COEP。
2. 在 `PikafishEngine.start()` 的 loader 包装层加 stdin bridge:`commandBuffer`
   + 重写 `Module.stdin` + 把 `Module.print` 路由到 `onReceiveStdout`。
3. 在 ai-worker.js `bootstrapBrowserPikafish_` 里加 graceful fallback:`importScripts`
   成功但 instantiate 失败时,记日志并把 engine mode 自动降级到 v1。

**中期(用户决策)**:方案 **B** —— 切换到 single-threaded build,避免 PWA 场景
的 COOP/COEP 配置负担。需要从 `Official-Pikafish/Pikafish` 源码重新编译。

## 测试验证

`tests/pikafish-real-engine-smoke.test.js`(本次 #69 引入)分四档:

- **A**:vendor 文件存在检查
- **B**:`require()` CommonJS export 类型检查
- **C**:**failure-mode fingerprint** —— 当前必须 fail 并匹配已知错误;若 wasm 源
  被换,fingerprint 测试会触发,提示更新本文档
- **D**:UCI 握手(只在 instantiate 成功且 module 暴露 `sendCommand` 时跑;否则 skip)

当 A→D 全部 pass(且无 skip),代表 v2 #69 验收完成,可推进 #71(self-play
benchmark)。
