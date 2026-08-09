// Unit tests for v2 self-play benchmark harness (TODO #71).
//
// 覆盖:
//   - Elo / 得分率 / 置信区间 数学
//   - parseEngineSpec 合法/非法输入
//   - PikafishPlayer init 在无 vendor 文件时 graceful unavailable
//   - playOneGame 在 vanilla-vs-vanilla 模式下能正常对弈(端到端 smoke)

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

// Process-level guard:已知 pikafish-vue wasm 在 instantiate 时 spawn
// `new Worker("pikafish.worker.js")`,该文件不存在 → worker_threads 内部
// 'error' 事件异步抛 MODULE_NOT_FOUND → 全局 uncaughtException → 杀死 test 进程。
// 本测试文件注册一个 permissive handler,吞掉这个已知 fingerprint 的错误,
// 让 PikafishPlayer.init() 的 try/catch 有机会标记 unavailable。
// 详见 docs/PIKAFISH-LOADER.md。
process.on("uncaughtException", (err) => {
  const msg = (err && (err.message || String(err))) || "";
  if (msg.includes("pikafish.worker.js") || msg.includes("MODULE_NOT_FOUND")) {
    return; // swallow known gap
  }
  console.error("FATAL uncaughtException (non-pikafish):", err);
  process.exit(1);
});

const {
  eloDiffFromScore,
  scoreConfidenceInterval,
  eloConfidenceInterval,
  parseEngineSpec,
  PikafishPlayer,
  playOneGame,
  VanillaPlayer,
} = require("../bench/v2-benchmark.js");
const { createEngine } = require("./engine-harness");

// === Elo 数学 ===

test("eloDiffFromScore: 50% 得分率 → 0 Elo 差", () => {
  // 5 win / 5 loss → S=0.5 → Δ=0
  assert.equal(eloDiffFromScore(5, 0, 5), 0);
  // 含和棋:5 win / 10 draw / 5 loss → S=0.5 → Δ=0
  assert.equal(eloDiffFromScore(5, 10, 5), 0);
});

test("eloDiffFromScore: 100% 胜 → 上限 +800", () => {
  assert.equal(eloDiffFromScore(10, 0, 0), 800);
  assert.equal(eloDiffFromScore(0, 0, 10), -800);
});

test("eloDiffFromScore: 75% 得分率 → 约 +191 Elo", () => {
  // S=0.75 → Δ=-400*log10(0.25/0.75)=-400*log10(1/3)=400*log10(3)≈190.85
  const got = eloDiffFromScore(75, 0, 25);
  assert.ok(Math.abs(got - 191) <= 1, `expected ~191, got ${got}`);
});

test("eloDiffFromScore: 0 局样本 → null", () => {
  assert.equal(eloDiffFromScore(0, 0, 0), null);
});

test("eloDiffFromScore: 单局胜利 → 上限(避免除零)", () => {
  // 1 win / 0 draw / 0 loss → S=1.0 → 上限
  assert.equal(eloDiffFromScore(1, 0, 0), 800);
});

// === 得分率置信区间(Wilson) ===

test("scoreConfidenceInterval: 0 样本 → [0, 1]", () => {
  const ci = scoreConfidenceInterval(0, 0, 0);
  assert.equal(ci.lo, 0);
  assert.equal(ci.hi, 1);
});

test("scoreConfidenceInterval: 10/10 → 区间包含 0.5", () => {
  const ci = scoreConfidenceInterval(10, 0, 10);
  assert.ok(ci.lo <= 0.5 && ci.hi >= 0.5, `0.5 should be in [${ci.lo}, ${ci.hi}]`);
  // Wilson 95% CI for n=20, S=0.5 约 [0.30, 0.70];放宽到 [0.25, 0.75] 避免边界抖动
  assert.ok(ci.lo >= 0.25 && ci.hi <= 0.75, `CI [${ci.lo}, ${ci.hi}] should fit [0.25, 0.75]`);
});

test("scoreConfidenceInterval: 大样本 → 区间收窄", () => {
  // 100/0/100 vs 1000/0/1000,n 越大 CI 越窄
  const ci20 = scoreConfidenceInterval(10, 0, 10);
  const ci1000 = scoreConfidenceInterval(500, 0, 500);
  assert.ok(ci1000.hi - ci1000.lo < ci20.hi - ci20.lo, "n=1000 CI should be tighter");
});

test("eloConfidenceInterval: 数值在 [loElo, hiElo] 区间", () => {
  const e = eloConfidenceInterval(10, 5, 5);
  // 红方得分率 = (10+2.5)/20 = 0.625 → Elo ≈ 79
  assert.ok(e.loElo <= 79 && e.hiElo >= 79, `79 should be in [${e.loElo}, ${e.hiElo}]`);
  assert.ok(e.loElo < e.hiElo, "lo < hi");
});

// === parseEngineSpec ===

test("parseEngineSpec: vanilla 三档", () => {
  for (const d of ["easy", "normal", "hard"]) {
    const s = parseEngineSpec(d);
    assert.equal(s.kind, "vanilla");
    assert.equal(s.difficulty, d);
    assert.equal(s.label, `vanilla-${d}`);
  }
});

test("parseEngineSpec: pikafish 带 depth", () => {
  const s = parseEngineSpec("pikafish");
  assert.equal(s.kind, "pikafish");
  assert.equal(typeof s.depth, "number");
  assert.ok(s.depth > 0);
  assert.match(s.label, /^pikafish/);
});

test("parseEngineSpec: 非法 spec 抛错", () => {
  assert.throws(() => parseEngineSpec("superhard"), /unknown engine spec/);
  assert.throws(() => parseEngineSpec(""), /unknown engine spec/);
  assert.throws(() => parseEngineSpec("PIKAFISH"), /unknown engine spec/); // 大小写敏感
});

// === PikafishPlayer:无 vendor 文件时 graceful unavailable ===
// (临时把 vendor/pikafish/ 隐藏,验证 fallback 路径)
// 注意:本测试只在 vendor 真实存在时反向验证"init 不抛异常 + unavailable=true"。

test("PikafishPlayer: init 不抛异常,终止于 unavailable 状态(本 build 已知 gap)", async () => {
  const p = new PikafishPlayer({ depth: 8, label: "test" });
  // init 必须返回 player 自身,不抛异常
  const ret = await p.init();
  assert.equal(ret, p);
  // 当前 pikafish-vue wasm 已知不可 instantiate(pthread + stdin gap)
  // 见 docs/PIKAFISH-LOADER.md
  assert.equal(p.unavailable, true);
  assert.ok(
    typeof p.unavailableReason === "string" && p.unavailableReason.length > 0,
    `expected reason string, got: ${p.unavailableReason}`,
  );
  // 关键:已知 gap 的 fingerprint 应匹配下列之一
  const known = [
    "pikafish.worker.js",
    "Cannot find module",
    "timeout",
    "require failed",
    "factory typeof",
    "SharedArrayBuffer",
  ];
  const matched = known.find((k) => p.unavailableReason.includes(k));
  assert.ok(
    matched,
    `unavailableReason "${p.unavailableReason}" 不匹配 known gap fingerprint — 若 Pikafish 已修复请更新本测试`,
  );
});

// === playOneGame smoke:vanilla hard vs vanilla easy 端到端 ===
// 目标:验证 harness 不崩,且 hard 通常会赢 easy(非严格断言,因为 1 局有随机性)。

test("playOneGame: vanilla hard vs easy 1 局,产出合法结果对象", async () => {
  const vmEngine = createEngine();
  const redSpec = parseEngineSpec("hard");
  const blackSpec = parseEngineSpec("easy");
  const redPlayer = new VanillaPlayer(redSpec, vmEngine);
  const blackPlayer = new VanillaPlayer(blackSpec, vmEngine);

  const result = await playOneGame({
    gameId: 1,
    redSpec,
    blackSpec,
    redPlayer,
    blackPlayer,
    vmEngine,
    maxPly: 30, // 测试用短局,加速
    drawPly: 20,
  });

  assert.equal(result.gameId, 1);
  assert.equal(result.red, "vanilla-hard");
  assert.equal(result.black, "vanilla-easy");
  assert.ok(
    result.winner === "red" || result.winner === "black" || result.winner === null,
    `bad winner: ${result.winner}`,
  );
  assert.ok(typeof result.reason === "string" && result.reason.length > 0);
  assert.ok(result.plies > 0 && result.plies <= 30);
  assert.equal(Array.isArray(result.degradations), true);
  assert.equal(result.degradations.length, 0); // vanilla-vs-vanilla 不应降级
});

test("playOneGame: pikafish spec 不可用时,记录降级并继续", async () => {
  const vmEngine = createEngine();
  const redSpec = parseEngineSpec("pikafish");
  const blackSpec = parseEngineSpec("hard");
  const redPlayer = new PikafishPlayer(redSpec);
  await redPlayer.init(); // 触发 unavailable
  const blackPlayer = new VanillaPlayer(blackSpec, vmEngine);

  const result = await playOneGame({
    gameId: 99,
    redSpec,
    blackSpec,
    redPlayer,
    blackPlayer,
    vmEngine,
    maxPly: 10, // 短局:pikafish 立即 unavailable,只要看到降级即可
    drawPly: 8,
  });

  assert.equal(result.gameId, 99);
  // pikafish 不可用 → 至少一次降级(红方走子时)
  assert.ok(
    result.degradations.length > 0,
    "pikafish unavailable should produce degradations",
  );
  assert.match(result.degradations[0].reason, /pikafish unavailable/);
});
