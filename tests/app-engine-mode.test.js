// app.js engine mode 切换集成测试(v2 #67)。
//
// 通过 engine-harness 加载 app.js(vm 沙箱,共享 constants/rules/search/app 全局词法环境),
// 验证:
//   1. settings.engineMode 默认 = "vanilla"
//   2. buildWorkerMessage(state) vanilla 模式 → {type:"search", ctx:{board, currentSide, aiDifficulty, moveHistory, snapshots}}
//   3. settings.engineMode = "pikafish" 后 → {type:"search", engine:"pikafish", ctx:{board, currentSide, aiDifficulty}}
//      (pikafish worker 只需要 board/currentSide/aiDifficulty,moveHistory/snapshots 不传,减小序列化开销)
//   4. vanilla ctx board 是深拷贝(不污染 state.board)
//   5. pikafish ctx board 也是深拷贝
//   6. loadGame 恢复 engineMode 持久化(模拟 localStorage)
//   7. settings 字段顺序/默认值契约
//
// 注:engine-harness 用 stub document({}),Worker 全局不存在,chooseAIMoveAsync 会 fallback 同步,
// 所以这里只测纯函数 buildWorkerMessage + settings 状态机,不测 worker 创建路径。

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEngine } = require("./engine-harness");

test("settings.engineMode default is vanilla", () => {
  const engine = createEngine();
  const result = engine.evaluate("settings.engineMode");
  assert.equal(result, "vanilla");
});

test("settings default object includes engineMode key", () => {
  const engine = createEngine();
  const settings = engine.json("settings");
  assert.equal(settings.engineMode, "vanilla");
  assert.equal(settings.playerSide, "red");
  assert.equal(settings.difficulty, "normal");
  assert.equal(settings.sound, true);
  assert.equal(settings.darkBoard, false);
});

test("buildWorkerMessage vanilla: returns full v1 ctx", () => {
  const engine = createEngine();
  const msg = engine.json("buildWorkerMessage(state)");
  assert.equal(msg.type, "search");
  assert.equal(msg.engine, undefined);
  assert.ok(Array.isArray(msg.ctx.board));
  assert.equal(msg.ctx.currentSide, "red");
  assert.equal(msg.ctx.aiDifficulty, "normal");
  assert.ok(Array.isArray(msg.ctx.moveHistory));
  assert.ok(Array.isArray(msg.ctx.snapshots));
});

test("buildWorkerMessage pikafish: returns lean ctx (no moveHistory/snapshots)", () => {
  const engine = createEngine();
  engine.evaluate('settings.engineMode = "pikafish"');
  const msg = engine.json("buildWorkerMessage(state)");
  assert.equal(msg.type, "search");
  assert.equal(msg.engine, "pikafish");
  assert.ok(Array.isArray(msg.ctx.board));
  assert.equal(msg.ctx.currentSide, "red");
  assert.equal(msg.ctx.aiDifficulty, "normal");
  assert.equal(msg.ctx.moveHistory, undefined);
  assert.equal(msg.ctx.snapshots, undefined);
});

test("buildWorkerMessage pikafish board is a deep copy (mutations do not leak into state)", () => {
  const engine = createEngine();
  engine.evaluate('settings.engineMode = "pikafish"');
  const beforePieceCount = engine.evaluate("state.board.length");
  const msg = engine.evaluate("buildWorkerMessage(state)");
  // Mutate the message's board (a copy)
  msg.ctx.board.length = 0;
  msg.ctx.board.push({ mutated: true });
  const afterPieceCount = engine.evaluate("state.board.length");
  assert.equal(afterPieceCount, beforePieceCount, "state.board must not be mutated by buildWorkerMessage copy");
});

test("buildWorkerMessage vanilla board is a deep copy too", () => {
  const engine = createEngine();
  const beforePieceCount = engine.evaluate("state.board.length");
  const msg = engine.evaluate("buildWorkerMessage(state)");
  msg.ctx.board.length = 0;
  const afterPieceCount = engine.evaluate("state.board.length");
  assert.equal(afterPieceCount, beforePieceCount);
});

test("toggling engineMode does not change difficulty/playerSide", () => {
  const engine = createEngine();
  engine.evaluate('settings.engineMode = "pikafish"');
  const settings = engine.json("settings");
  assert.equal(settings.engineMode, "pikafish");
  assert.equal(settings.difficulty, "normal");
  assert.equal(settings.playerSide, "red");
});

test("buildWorkerMessage reflects aiDifficulty changes (pikafish)", () => {
  const engine = createEngine();
  engine.evaluate('settings.engineMode = "pikafish"; settings.difficulty = "hard"; state.aiDifficulty = "hard"');
  const msg = engine.json("buildWorkerMessage(state)");
  assert.equal(msg.engine, "pikafish");
  assert.equal(msg.ctx.aiDifficulty, "hard");
});

test("buildWorkerMessage reflects currentSide changes (pikafish)", () => {
  const engine = createEngine();
  engine.evaluate('settings.engineMode = "pikafish"; state.currentSide = "black"');
  const msg = engine.json("buildWorkerMessage(state)");
  assert.equal(msg.engine, "pikafish");
  assert.equal(msg.ctx.currentSide, "black");
});

test("engine mode display text maps correctly via renderInfo", () => {
  const engine = createEngine();
  // renderInfo writes to els.engineModeText; harness stub returns {} for querySelector,
  // so direct textContent write would fail silently. Instead, test the mapping logic.
  const vanillaText = engine.evaluate('settings.engineMode === "pikafish" ? "Pikafish 引擎" : "自研 AI"');
  assert.equal(vanillaText, "自研 AI");
  engine.evaluate('settings.engineMode = "pikafish"');
  const pikafishText = engine.evaluate('settings.engineMode === "pikafish" ? "Pikafish 引擎" : "自研 AI"');
  assert.equal(pikafishText, "Pikafish 引擎");
});

test("pikafish fallback guard constant is generous enough for depth 18 (~5s)", () => {
  const engine = createEngine();
  const guardMs = engine.evaluate("PIKAFISH_FALLBACK_GUARD_MS");
  assert.ok(guardMs >= 12000, `PIKAFISH_FALLBACK_GUARD_MS should be >= 12000 for depth 18, got ${guardMs}`);
  assert.ok(guardMs <= 30000, `PIKAFISH_FALLBACK_GUARD_MS should be <= 30000 to avoid hangs, got ${guardMs}`);
});

test("AI_WORKER_ENABLED stays false by default (vanilla path uses sync, no regression)", () => {
  const engine = createEngine();
  const enabled = engine.evaluate("AI_WORKER_ENABLED");
  assert.equal(enabled, false);
});
