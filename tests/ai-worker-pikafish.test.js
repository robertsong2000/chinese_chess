// ai-worker.js Pikafish 引擎模式测试(v2 #66)。
//
// 用 vm 沙箱加载 ai-worker.js,通过 self.configurePikafish 注入 mock EngineClass
// 和 helper(boardToFen/uciToMove),覆盖:
//   - engine mode search 完整流程(position → go depth → bestmove → uciToMove → result)
//   - movetime 模式
//   - depth 覆盖默认映射
//   - aiDifficulty → depth 默认映射
//   - engine-info 转发
//   - engine-quit
//   - engine-status
//   - 未配置 engine 时返回 error
//   - engine start 失败时返回 error
//   - bestmove "(none)" → move=null
//   - v1 默认路径仍正常(move=null)
//   - 现有 ping / 非法 ctx / unknown type 仍走旧契约
//
// 注意:测试环境无 importScripts / window / module,所以 bootstrapBrowserPikafish_()
// 立即 return,worker 走纯 v1 默认 + configurePikafish 注入路径。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WORKER_PATH = path.join(__dirname, "..", "ai-worker.js");

function loadWorkerSandbox() {
  const posted = [];
  const sandbox = {
    posted,
    console,
    performance: { now: () => Date.now() },
    self: {
      postMessage: (msg) => posted.push(msg),
    },
  };
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(WORKER_PATH, "utf8");
  vm.runInContext(source, context, { filename: WORKER_PATH });
  return sandbox;
}

// 等 worker 异步消息序列中出现匹配的 message。
function waitFor(sandbox, predicate, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const hit = sandbox.posted.find(predicate);
      if (hit) return resolve(hit);
      if (Date.now() - t0 > timeoutMs) {
        return reject(new Error(`timeout waiting for message; got: ${JSON.stringify(sandbox.posted.slice(-5))}`));
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

// === mock PikafishEngine 工厂 ===
// 记录所有命令,允许测试用 .emitStdout / .emitExit 模拟引擎响应。
function createMockEngineClass() {
  const calls = [];
  class MockPikafishEngine {
    constructor(loader, options = {}) {
      calls.push({ kind: "ctor", loader, options });
      this.loader = loader;
      this.onInfo = options.onInfo || (() => {});
      this.onError = options.onError || (() => {});
      this._exited = false;
      this.sent = [];
      MockPikafishEngine.lastInstance = this;
    }
    async start() {
      calls.push({ kind: "start" });
      this._started = true;
      return this;
    }
    position(fen, moves = []) {
      calls.push({ kind: "position", fen, moves });
      this.sent.push({ fen, moves });
    }
    goDepth(d) {
      calls.push({ kind: "goDepth", depth: d });
      // 默认:下一 tick 返回 bestmove h2e2
      return new Promise((resolve) => {
        setTimeout(() => resolve("h2e2"), 0);
      });
    }
    goMovetime(ms) {
      calls.push({ kind: "goMovetime", ms });
      return new Promise((resolve) => {
        setTimeout(() => resolve("h2e2"), 0);
      });
    }
    quit() {
      calls.push({ kind: "quit" });
      this._exited = true;
    }
  }
  MockPikafishEngine.calls = calls;
  return MockPikafishEngine;
}

// === 简化版 boardToFen / uciToMove,用于 worker 测试 ===
function naiveBoardToFen(board, side) {
  return `MOCK_FEN_FOR_${side}_${board.length}`;
}
function naiveUciToMove(uci, board) {
  // 找一个 alive piece 当 from,凑出 v1 move 结构
  const piece = board.find((p) => p && p.alive) || { id: "mock", side: "red", type: "chariot", x: 7, y: 2 };
  return {
    pieceId: piece.id,
    side: piece.side,
    pieceType: piece.type,
    fromX: 7,
    fromY: 2,
    toX: 4,
    toY: 2,
    capturedPieceId: null,
    _fromUci: uci,
  };
}

function configurePikafishInSandbox(sandbox, EngineClass, extra = {}) {
  sandbox.self.configurePikafish({
    EngineClass,
    loaderFactory: () => Promise.resolve(() => Promise.resolve({})),
    boardToFen: naiveBoardToFen,
    uciToMove: naiveUciToMove,
    ...extra,
  });
}

const VALID_CTX = {
  board: [{ id: "r-c", side: "red", type: "cannon", x: 7, y: 2, alive: true }],
  currentSide: "red",
  aiDifficulty: "hard",
};

// === 测试用例 ===

test("ai-worker.js still emits ready signal on load (v1 compat)", () => {
  const sandbox = loadWorkerSandbox();
  assert.ok(sandbox.posted.some((m) => m && m.type === "ready"));
});

test("ai-worker.js exposes self.configurePikafish for test/browser injection", () => {
  const sandbox = loadWorkerSandbox();
  assert.equal(typeof sandbox.self.configurePikafish, "function");
});

test("engine-status reports configured:false before configurePikafish", () => {
  const sandbox = loadWorkerSandbox();
  const before = sandbox.posted.length;
  sandbox.self.onmessage({ data: { type: "engine-status" } });
  const status = sandbox.posted.slice(before).find((m) => m.type === "engine-status");
  assert.equal(status.configured, false);
  assert.equal(status.ready, false);
});

test("engine search without configuration returns error", async () => {
  const sandbox = loadWorkerSandbox();
  const before = sandbox.posted.length;
  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX },
  });
  const err = await waitFor(sandbox, (m) => m.type === "error");
  assert.match(err.error, /not configured|configurePikafish/);
  // 不应发送 result
  const result = sandbox.posted.slice(before).find((m) => m.type === "result");
  assert.equal(result, undefined);
});

test("engine search happy path: position → go depth 18 (hard default) → bestmove → result", async () => {
  const sandbox = loadWorkerSandbox();
  const EngineClass = createMockEngineClass();
  configurePikafishInSandbox(sandbox, EngineClass);

  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX },
  });

  // 等 engine-ready
  await waitFor(sandbox, (m) => m.type === "engine-ready");
  // 等 result
  const result = await waitFor(sandbox, (m) => m.type === "result" && m.stats && m.stats.engine === "pikafish");

  // 走法非空,带原始 uci
  assert.ok(result.move);
  assert.equal(result.move._fromUci, "h2e2");
  assert.equal(result.stats.bestUci, "h2e2");
  assert.equal(result.stats.mode, "depth");

  // 验证 worker 调用顺序:start → position → goDepth(18,hard 默认)
  const kinds = EngineClass.calls.map((c) => c.kind);
  assert.deepEqual(kinds, ["ctor", "start", "position", "goDepth"]);
  const goCall = EngineClass.calls.find((c) => c.kind === "goDepth");
  assert.equal(goCall.depth, 18);
  const posCall = EngineClass.calls.find((c) => c.kind === "position");
  assert.equal(posCall.fen, "MOCK_FEN_FOR_red_1");
});

test("engine search with depth override skips difficulty mapping", async () => {
  const sandbox = loadWorkerSandbox();
  const EngineClass = createMockEngineClass();
  configurePikafishInSandbox(sandbox, EngineClass);

  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX, depth: 8 },
  });
  await waitFor(sandbox, (m) => m.type === "result");
  const goCall = EngineClass.calls.find((c) => c.kind === "goDepth");
  assert.equal(goCall.depth, 8);
});

test("engine search uses easy=4 / normal=10 / hard=18 by default", async () => {
  for (const diff of ["easy", "normal", "hard"]) {
    const sandbox = loadWorkerSandbox();
    const EngineClass = createMockEngineClass();
    configurePikafishInSandbox(sandbox, EngineClass);
    sandbox.self.onmessage({
      data: {
        type: "search",
        engine: "pikafish",
        ctx: { ...VALID_CTX, aiDifficulty: diff },
      },
    });
    await waitFor(sandbox, (m) => m.type === "result");
    const expected = { easy: 4, normal: 10, hard: 18 }[diff];
    const goCall = EngineClass.calls.find((c) => c.kind === "goDepth");
    assert.equal(goCall.depth, expected, `depth for ${diff}`);
  }
});

test("engine search with movetime uses goMovetime instead of goDepth", async () => {
  const sandbox = loadWorkerSandbox();
  const EngineClass = createMockEngineClass();
  configurePikafishInSandbox(sandbox, EngineClass);

  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX, movetime: 2000 },
  });
  const result = await waitFor(sandbox, (m) => m.type === "result");
  assert.equal(result.stats.mode, "movetime");
  const goCall = EngineClass.calls.find((c) => c.kind === "goMovetime");
  assert.equal(goCall.ms, 2000);
  // 不应触发 goDepth
  assert.equal(EngineClass.calls.find((c) => c.kind === "goDepth"), undefined);
});

test("custom depthByDifficulty via configurePikafish overrides defaults", async () => {
  const sandbox = loadWorkerSandbox();
  const EngineClass = createMockEngineClass();
  configurePikafishInSandbox(sandbox, EngineClass, {
    depthByDifficulty: { hard: 22 },
  });
  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX },
  });
  await waitFor(sandbox, (m) => m.type === "result");
  const goCall = EngineClass.calls.find((c) => c.kind === "goDepth");
  assert.equal(goCall.depth, 22);
});

test("engine-info callbacks are forwarded as engine-info messages", async () => {
  const sandbox = loadWorkerSandbox();
  let capturedOptions = null;
  // 包装 mock,捕获 onInfo
  class EngineWithOptions {
    constructor(loader, options) {
      capturedOptions = options;
      this._exited = false;
    }
    async start() { return this; }
    position() {}
    goDepth() {
      // 同步触发两条 info,然后 bestmove
      setTimeout(() => {
        capturedOptions.onInfo({ depth: 8, score: { unit: "cp", value: 50 } });
        capturedOptions.onInfo({ depth: 12, score: { unit: "cp", value: 120 } });
      }, 0);
      return new Promise((r) => setTimeout(() => r("h2e2"), 5));
    }
    quit() {}
  }
  configurePikafishInSandbox(sandbox, EngineWithOptions);

  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX },
  });
  await waitFor(sandbox, (m) => m.type === "result");
  const infos = sandbox.posted.filter((m) => m.type === "engine-info");
  assert.equal(infos.length, 2, "expected 2 engine-info messages");
  assert.equal(infos[0].info.depth, 8);
  assert.equal(infos[1].info.depth, 12);
});

test("engine-quit stops the engine and clears singleton", async () => {
  const sandbox = loadWorkerSandbox();
  const EngineClass = createMockEngineClass();
  configurePikafishInSandbox(sandbox, EngineClass);

  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX },
  });
  await waitFor(sandbox, (m) => m.type === "result");
  assert.equal(EngineClass.calls.some((c) => c.kind === "quit"), false);

  sandbox.self.onmessage({ data: { type: "engine-quit" } });
  assert.equal(EngineClass.calls.some((c) => c.kind === "quit"), true);

  // 状态:configured 仍 true(类还在),但 ready false(实例已清)
  sandbox.self.onmessage({ data: { type: "engine-status" } });
  const status = sandbox.posted
    .slice()
    .reverse()
    .find((m) => m.type === "engine-status");
  assert.equal(status.configured, true);
  assert.equal(status.ready, false);
});

test("engine start failure returns error and allows retry on next search", async () => {
  const sandbox = loadWorkerSandbox();
  let startAttempts = 0;
  class FailFirstEngine {
    constructor() { this._exited = false; }
    async start() {
      startAttempts++;
      if (startAttempts === 1) throw new Error("wasm load failed");
      return this;
    }
    position() {}
    goDepth() { return Promise.resolve("h2e2"); }
    quit() {}
  }
  configurePikafishInSandbox(sandbox, FailFirstEngine);

  // 第一次:start 失败 → error
  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX },
  });
  const err = await waitFor(sandbox, (m) => m.type === "error");
  assert.match(err.error, /pikafish start failed/);

  // 第二次:重试成功 → result
  const before = sandbox.posted.length;
  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX },
  });
  const result = await waitFor(sandbox, (m) => m.type === "result", 1000);
  assert.ok(result.move);
});

test("bestmove '(none)' is mapped to move=null (no legal move / checkmate)", async () => {
  const sandbox = loadWorkerSandbox();
  class NoneMoveEngine {
    constructor() { this._exited = false; }
    async start() { return this; }
    position() {}
    goDepth() { return Promise.resolve("(none)"); }
    quit() {}
  }
  configurePikafishInSandbox(sandbox, NoneMoveEngine);

  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX },
  });
  const result = await waitFor(sandbox, (m) => m.type === "result");
  assert.equal(result.move, null);
  assert.equal(result.stats.bestUci, "(none)");
});

test("concurrent search messages reuse engine singleton (start called once)", async () => {
  const sandbox = loadWorkerSandbox();
  const EngineClass = createMockEngineClass();
  configurePikafishInSandbox(sandbox, EngineClass);

  // 串行触发两次 search
  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX },
  });
  await waitFor(sandbox, (m) => m.type === "result");
  sandbox.self.onmessage({
    data: { type: "search", engine: "pikafish", ctx: VALID_CTX },
  });
  await waitFor(sandbox, (m) => sandbox.posted.filter((p) => p.type === "result").length >= 2);

  // start 只应被调用 1 次(singleton 复用)
  const startCount = EngineClass.calls.filter((c) => c.kind === "start").length;
  assert.equal(startCount, 1, `expected 1 start, got ${startCount}`);
  // ctor 也只 1 次
  const ctorCount = EngineClass.calls.filter((c) => c.kind === "ctor").length;
  assert.equal(ctorCount, 1);
});

test("v1 default search path still returns placeholder result (no engine field)", () => {
  const sandbox = loadWorkerSandbox();
  const before = sandbox.posted.length;
  sandbox.self.onmessage({
    data: { type: "search", ctx: VALID_CTX },
  });
  const result = sandbox.posted.slice(before).find((m) => m.type === "result");
  assert.ok(result);
  assert.equal(result.move, null);
  assert.equal(result.stats.implemented, false);
});

test("engine:non-pikafish with search falls back to v1 placeholder", () => {
  // 仅 'pikafish' 触发 engine 模式;其他 engine 字符串(向后兼容)走 v1
  const sandbox = loadWorkerSandbox();
  const before = sandbox.posted.length;
  sandbox.self.onmessage({
    data: { type: "search", engine: "experimental", ctx: VALID_CTX },
  });
  const result = sandbox.posted.slice(before).find((m) => m.type === "result");
  assert.ok(result);
  assert.equal(result.stats.implemented, false);
});

test("invalid ctx with engine=pikafish returns error (no engine call)", async () => {
  const sandbox = loadWorkerSandbox();
  const EngineClass = createMockEngineClass();
  configurePikafishInSandbox(sandbox, EngineClass);

  const before = sandbox.posted.length;
  sandbox.self.onmessage({
    data: {
      type: "search",
      engine: "pikafish",
      ctx: { board: [], currentSide: "purple", aiDifficulty: "hard" },
    },
  });
  const err = sandbox.posted.slice(before).find((m) => m.type === "error");
  assert.ok(err);
  assert.match(err.error, /invalid ctx/);
  // 引擎未被实例化
  assert.equal(EngineClass.calls.length, 0);
});
