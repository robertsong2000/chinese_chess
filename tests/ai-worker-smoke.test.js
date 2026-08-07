const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WORKER_PATH = path.join(__dirname, "..", "ai-worker.js");

// 加载 ai-worker.js 到沙箱,stub self.postMessage 让 worker 可向外发消息。
// 返回 { sandbox, posted } — posted 是 worker 已发出的所有消息数组。
function loadWorkerSandbox() {
  const posted = [];
  const sandbox = {
    posted,
    self: {
      postMessage: (msg) => posted.push(msg),
    },
  };
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(WORKER_PATH, "utf8");
  vm.runInContext(source, context, { filename: WORKER_PATH });
  return { sandbox, posted };
}

test("ai-worker.js loads without throwing and emits a ready signal", () => {
  const { posted } = loadWorkerSandbox();
  assert.ok(Array.isArray(posted));
  assert.ok(posted.some((msg) => msg && msg.type === "ready"));
});

test("ai-worker.js rejects malformed messages", () => {
  const { sandbox, posted } = loadWorkerSandbox();
  const before = posted.length;
  // 直接调用 onmessage,模拟 worker 收到非法消息
  sandbox.self.onmessage({ data: null });
  sandbox.self.onmessage({ data: "not-an-object" });
  sandbox.self.onmessage({ data: { type: "unknown" } });
  const errors = posted.slice(before).filter((m) => m.type === "error");
  assert.ok(errors.length >= 2, `expected at least 2 errors, got ${errors.length}`);
});

test("ai-worker.js answers ping with pong", () => {
  const { sandbox, posted } = loadWorkerSandbox();
  const before = posted.length;
  sandbox.self.onmessage({ data: { type: "ping" } });
  const recent = posted.slice(before);
  assert.ok(recent.some((m) => m.type === "pong"));
});

test("ai-worker.js validates search context and returns structured placeholder", () => {
  const { sandbox, posted } = loadWorkerSandbox();
  const before = posted.length;
  // 非法 ctx:currentSide 不是 red/black
  sandbox.self.onmessage({
    data: {
      type: "search",
      ctx: { board: [], currentSide: "blue", aiDifficulty: "hard" },
    },
  });
  const err = posted.slice(before).find((m) => m.type === "error");
  assert.ok(err, "expected error for invalid ctx");

  // 合法 ctx 但搜索尚未实现:返回 result 占位
  const before2 = posted.length;
  sandbox.self.onmessage({
    data: {
      type: "search",
      ctx: {
        board: [{ id: 1 }],
        currentSide: "red",
        aiDifficulty: "hard",
      },
    },
  });
  const result = posted.slice(before2).find((m) => m.type === "result");
  assert.ok(result, "expected placeholder result");
  assert.equal(result.move, null);
  assert.equal(result.stats.implemented, false);
});

// 加载 app.js(同 engine-harness 思路,但只验证 createAIWorker 工厂存在)
test("app.js exposes createAIWorker factory returning null when Worker is unavailable", () => {
  const APP_PATH = path.join(__dirname, "..", "app.js");
  const INITIALIZATION = /\nbindEvents\(\);\nloadGame\(\);\nsyncSettingsUI\(\);\nrender\(\);\s*$/;
  const source = fs.readFileSync(APP_PATH, "utf8").replace(INITIALIZATION, "");
  const context = vm.createContext({
    console,
    performance: { now: () => Date.now() },
    setTimeout,
    clearTimeout,
    document: {
      querySelector: () => ({}),
      querySelectorAll: () => [],
    },
  });
  vm.runInContext(source, context, { filename: APP_PATH });

  // Node 环境 typeof Worker === "undefined" → createAIWorker 应返回 null
  const result = vm.runInContext("createAIWorker()", context);
  assert.equal(result, null);

  // 即使强制打开开关,无 Worker 全局时也应安全返回 null(不抛错)
  const safeCall = vm.runInContext(
    "(function(){ AI_WORKER_ENABLED = true; try { return createAIWorker(); } catch(e){ return 'threw:'+e.message; } })()",
    context,
  );
  assert.equal(safeCall, null);
});
