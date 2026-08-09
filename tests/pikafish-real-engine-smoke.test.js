// Real Pikafish WASM smoke test (v2 #69).
//
// 与 pikafish-engine.test.js(全 mock loader)的区别:本文件尝试加载真实 wasm,
// 验证从 wrapper(PikafishEngine)到 Emscripten module 的整条调用链。
//
// 当前 pikafish-vue wasm 的已知限制(2026-08-09):
//   1. pthread-enabled build:Emscripten PThread.allocateUnusedWorker() 调
//      `new Worker("pikafish.worker.js")`,但 pikafish-vue 仓库只发布
//      `pikafish.js` + `pikafish.wasm`,未发布 `pikafish.worker.js`,
//      所以 instantiate 阶段就抛 `Cannot find module .../pikafish.worker.js`。
//   2. loader-contract mismatch:即便 worker 文件齐全,Emscripten module
//      使用 `print(txt)` 输出 stdout,且不暴露 `.sendCommand()`(UCI 引擎
//      通过 stdin 读命令),与 PikafishEngine wrapper 期望的契约
//      (`onReceiveStdout` + `.sendCommand`)不一致。
//
// 因此本测试当前只在「能成功 instantiate」时跑 UCI 握手;否则 skip 并
// 报告具体的失败模式(failure-mode fingerprint)。当用户切换到带 worker.js
// 的 wasm 源,或换一个 single-threaded build,test D 会自动开始运行。
//
// 详见 docs/PIKAFISH-LOADER.md。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const VENDOR_DIR = path.join(__dirname, "..", "vendor", "pikafish");
const JS_PATH = path.join(VENDOR_DIR, "pikafish.js");
const WASM_PATH = path.join(VENDOR_DIR, "pikafish.wasm");

function filesPresent() {
  return fs.existsSync(JS_PATH) && fs.existsSync(WASM_PATH);
}

// 加载 Emscripten module factory(CommonJS export)。
// 失败时返回 { error } 而非 throw —— 让测试能针对失败模式做断言。
function loadFactory() {
  try {
    const factory = require(JS_PATH);
    if (typeof factory !== "function") {
      return { error: new Error(`pikafish.js exports typeof=${typeof factory}, expected function`) };
    }
    return { factory };
  } catch (e) {
    return { error: e };
  }
}

// 检测 `pikafish.js` 是否依赖 pthread bootstrap 文件。
// Emscripten pthread build 会在源码里调用 `locateFile("pikafish.worker.js")`。
// 该文件由 Emscripten 编译时生成,`pikafish-vue` 仓库不发布。
function detectPthreadDependency(jsSource) {
  if (/locateFile\(\s*["']pikafish\.worker\.js["']/.test(jsSource)) {
    return {
      isPthread: true,
      bootstrapFile: "pikafish.worker.js",
      bootstrapPresent: fs.existsSync(path.join(VENDOR_DIR, "pikafish.worker.js")),
    };
  }
  return { isPthread: false };
}

// 尝试 instantiate module(noInitialRun:true 避免自动进 main 循环)。
// 收集 stdout / stderr 用于断言。
async function tryInstantiate(factory) {
  const stdout = [];
  const stderr = [];
  let exitCode = null;
  let mod = null;
  let instantiateError = null;

  try {
    mod = await factory({
      print: (s) => stdout.push(String(s)),
      printErr: (s) => stderr.push(String(s)),
      noInitialRun: true,
      onExit: (c) => { exitCode = c; },
      ENVIRONMENT_IS_PTHREAD: false,
    });
  } catch (e) {
    instantiateError = e;
  }
  return { mod, stdout, stderr, exitCode, instantiateError };
}

// === Test A: 文件存在 ===

test("real wasm: vendor files present locally", (t) => {
  if (!filesPresent()) {
    t.skip("run ./vendor/pikafish/download-pikafish.sh");
    return;
  }
  assert.ok(filesPresent(), "expected pikafish.js + pikafish.wasm in vendor/pikafish/");
});

// === Test B: factory 加载 ===

test("real wasm: pikafish.js exports a factory function", (t) => {
  if (!filesPresent()) {
    t.skip("wasm files not present");
    return;
  }
  const { factory, error } = loadFactory();
  assert.ok(!error, `require failed: ${error && error.message}`);
  assert.equal(typeof factory, "function");
});

// === Test C: instantiate 失败模式(fingerprint) ===
//
// 当前预期:依赖 `pikafish.worker.js` 但该文件不在 vendor/。
// 当用户换源(如官方 single-threaded build,或自行添加 worker bootstrap)后,
// fingerprint 改变 → 本测试触发,提醒更新 docs/PIKAFISH-LOADER.md 并跑 Test D。

test("real wasm: instantiate failure-mode fingerprint", async (t) => {
  if (!filesPresent()) {
    t.skip("wasm files not present");
    return;
  }
  const jsSource = fs.readFileSync(JS_PATH, "utf8");
  const dep = detectPthreadDependency(jsSource);

  if (!dep.isPthread) {
    // 非 pthread build —— 应该能 instantiate。真正去实例化它。
    const { factory, error } = loadFactory();
    if (error) {
      t.skip(`factory load failed: ${error.message}`);
      return;
    }
    const { mod, instantiateError } = await tryInstantiate(factory);
    assert.ok(mod, `non-pthread build failed to instantiate: ${instantiateError && instantiateError.message}`);
    assert.equal(typeof mod, "object");
    return;
  }

  // pthread build:检查 bootstrap 文件是否存在。
  if (!dep.bootstrapPresent) {
    // **当前预期**:bootstrap 缺失(known failure mode)。
    assert.equal(dep.bootstrapFile, "pikafish.worker.js");
    assert.equal(dep.bootstrapPresent, false);
    return;
  }

  // bootstrap 文件存在:尝试真实 instantiate(可能仍有其他问题,如 SAB 不可用)。
  const { factory, error } = loadFactory();
  if (error) {
    t.skip(`factory load failed: ${error.message}`);
    return;
  }
  const { mod, instantiateError } = await tryInstantiate(factory);
  if (mod) {
    assert.equal(typeof mod, "object", "module should be object after instantiate");
    return;
  }
  const msg = (instantiateError && (instantiateError.message || String(instantiateError))) || "";
  const known = [
    "pikafish.worker.js",
    "Cannot find module",
    "SharedArrayBuffer is not defined",
    "navigator.hardwareConcurrency",
  ];
  const matched = known.find((k) => msg.includes(k));
  assert.ok(
    matched,
    `unknown instantiate failure mode — please update tests/pikafish-real-engine-smoke.test.js + docs/PIKAFISH-LOADER.md. error: ${msg}`,
  );
});

// === Test D: 真实 UCI 握手(仅当 instantiate 成功且 module 暴露 sendCommand 时) ===
//
// 跑通意味着:wasm 可加载 → wrapper loader contract 兼容 → UCI 协议可交互 →
// 能从起始局面得到合法 bestmove。这是 #69 的最终验收条件。
//
// 当前必然 skip,因为:
//   - pthread bootstrap 缺失(见 Test C)
//   - 即便 instantiate 成功,raw Emscripten module 不暴露 `.sendCommand`,
//     需要额外的 stdin bridge(wrapper 内嵌或外部 build 提供)
//
// 当 Test C 开始 pass 时,本测试若仍 skip 在「sendCommand」检查,意味着需要
// 实施 docs/PIKAFISH-LOADER.md 的方案 D(wrapper 内建 stdin bridge)。

test("real wasm: UCI handshake yields a legal bestmove from startpos", async (t) => {
  if (!filesPresent()) {
    t.skip("wasm files not present");
    return;
  }

  const jsSource = fs.readFileSync(JS_PATH, "utf8");
  const dep = detectPthreadDependency(jsSource);
  if (dep.isPthread && !dep.bootstrapPresent) {
    t.skip(`pthread build missing ${dep.bootstrapFile} — see docs/PIKAFISH-LOADER.md`);
    return;
  }

  const { factory, error } = loadFactory();
  if (error) {
    t.skip(`factory load failed: ${error.message}`);
    return;
  }

  const { mod, instantiateError } = await tryInstantiate(factory);
  if (!mod) {
    const msg = (instantiateError && instantiateError.message) || "unknown";
    t.skip(`instantiate failed (${msg})`);
    return;
  }

  // 契约检查:raw Emscripten module 是否暴露 sendCommand?
  if (typeof mod.sendCommand !== "function") {
    t.skip(
      `module.sendCommand not exposed (raw Emscripten build) — wrapper needs stdin bridge; see docs/PIKAFISH-LOADER.md`,
    );
    return;
  }

  // Happy path:跑 UCI 握手。
  const { PikafishEngine } = require("../src/pikafish-engine.js");
  const engine = new PikafishEngine(() => Promise.resolve(() => Promise.resolve(mod)));

  let lastInfo = null;
  engine.onInfo = (i) => { lastInfo = i; };

  await engine.start();
  engine.position("startpos");
  const bestUci = await engine.goDepth(5);
  engine.quit();

  assert.ok(typeof bestUci === "string" && bestUci.length >= 4, `bad bestmove: ${bestUci}`);
  assert.match(bestUci, /^[a-i]\d[a-i]\d/);
  assert.ok(lastInfo && typeof lastInfo.depth === "number" && lastInfo.depth >= 1);
});
