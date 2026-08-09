// v2 self-play benchmark harness (TODO #71).
//
// 目标:支持双引擎(vanilla v1 search / Pikafish)对弈,产出:
//   - 胜/和/负、Elo 差、95% 置信区间
//   - per-game trace(走子数、终局原因、单局耗时)
//   - 引擎可用性 gate(pikafish 不可用时自动降级,记录降级次数)
//
// 使用方式:
//   node bench/v2-benchmark.js                                    # 默认 8 局 vanilla hard vs normal
//   BENCH_GAMES=20 BENCH_RED=pikafish BENCH_BLACK=hard node bench/v2-benchmark.js
//
// 注意:当 BENCH_RED/BENCH_BLACK=pikafish 但 Pikafish WASM 不可 instantiate 时,
// 自动降级为 vanilla "hard",并在报告中明确标注降级路径(避免误报 Elo)。
// Pikafish loader contract 详见 docs/PIKAFISH-LOADER.md。

const fs = require("node:fs");
const path = require("node:path");
const { createEngine } = require("../tests/engine-harness");
const {
  PikafishEngine,
  boardToFen,
  uciToMove,
} = require("../src/pikafish-engine.js");

// === 配置(环境变量) ===
const GAMES = Number(process.env.BENCH_GAMES || 8);
const MAX_PLY = Number(process.env.BENCH_MAX_PLY || 120);
const NO_CAPTURE_DRAW_PLY = Number(process.env.BENCH_DRAW_PLY || 40);
const HARD_DEADLINE_MS = Number(process.env.BENCH_HARD_MS || 300);
const NORMAL_DEADLINE_MS = Number(process.env.BENCH_NORMAL_MS || 200);
const EASY_DEADLINE_MS = Number(process.env.BENCH_EASY_MS || 100);
const PIKAFISH_TIMEOUT_MS = Number(process.env.BENCH_PIKAFISH_MS || 5000);
const PIKAFISH_DEPTH = Number(process.env.BENCH_PIKAFISH_DEPTH || 12);
const RED_ENGINE = process.env.BENCH_RED || "hard";
const BLACK_ENGINE = process.env.BENCH_BLACK || "normal";

// === Elo / 统计 ===
function eloDiffFromScore(wins, draws, losses) {
  const n = wins + draws + losses;
  if (n <= 0) return null;
  const s = (wins + 0.5 * draws) / n;
  if (s <= 0) return -800;
  if (s >= 1) return 800;
  // +0 规范化 -0(S=0.5 时 log10(1)=0 → round(-0) → 期望显示为 0)
  return Math.round(-400 * Math.log10((1 - s) / s)) + 0;
}

function scoreConfidenceInterval(wins, draws, losses) {
  const n = wins + draws + losses;
  if (n <= 0) return { lo: 0, hi: 1 };
  const s = (wins + 0.5 * draws) / n;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = (s + (z * z) / (2 * n)) / denom;
  const half =
    (z * Math.sqrt((s * (1 - s)) / n + (z * z) / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

function eloConfidenceInterval(wins, draws, losses) {
  const { lo, hi } = scoreConfidenceInterval(wins, draws, losses);
  const transform = (p) => {
    if (p <= 0) return -800;
    if (p >= 1) return 800;
    return Math.round(-400 * Math.log10((1 - p) / p));
  };
  return { loElo: transform(lo), hiElo: transform(hi) };
}

// === 引擎选择 ===
function parseEngineSpec(spec) {
  if (spec === "pikafish") {
    return {
      kind: "pikafish",
      depth: PIKAFISH_DEPTH,
      label: `pikafish(d=${PIKAFISH_DEPTH})`,
    };
  }
  if (spec === "hard" || spec === "normal" || spec === "easy") {
    return { kind: "vanilla", difficulty: spec, label: `vanilla-${spec}` };
  }
  throw new Error(`unknown engine spec: ${spec}`);
}

// === Player 抽象 ===
// 每个 player 只负责"返回 v1 move 对象";游戏循环统一 apply。
class VanillaPlayer {
  constructor(spec, engine) {
    this.kind = "vanilla";
    this.difficulty = spec.difficulty;
    this.label = spec.label;
    this.engine = engine;
    this.unavailable = false;
  }

  pickMove() {
    const budget =
      this.difficulty === "hard"
        ? HARD_DEADLINE_MS
        : this.difficulty === "normal"
          ? NORMAL_DEADLINE_MS
          : EASY_DEADLINE_MS;
    const baseBudget =
      this.difficulty === "hard" ? 1100 : this.difficulty === "normal" ? 520 : 250;
    const scale = baseBudget / budget;
    return this.engine.json(`(() => {
      const realNow = performance.now.bind(performance);
      performance.now = function () { return realNow() * ${scale}; };
      try {
        state.aiDifficulty = ${JSON.stringify(this.difficulty)};
        return chooseAIMove();
      } finally {
        performance.now = realNow;
      }
    })()`);
  }
}

class PikafishPlayer {
  constructor(spec) {
    this.kind = "pikafish";
    this.depth = spec.depth;
    this.label = spec.label;
    this.engine = null;
    this.unavailable = false;
    this.unavailableReason = null;
    this._initPromise = null;
  }

  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      const vendorJs = path.join(__dirname, "..", "vendor", "pikafish", "pikafish.js");
      const vendorWasm = path.join(__dirname, "..", "vendor", "pikafish", "pikafish.wasm");
      const vendorWorker = path.join(__dirname, "..", "vendor", "pikafish", "pikafish.worker.js");
      if (!fs.existsSync(vendorJs) || !fs.existsSync(vendorWasm)) {
        this.unavailable = true;
        this.unavailableReason = "vendor/pikafish/* not found";
        return this;
      }

      // Preflight:本 build 是 pthread-enabled,init 时 spawn `pikafish.worker.js`。
      // pikafish-vue 仓库不发布该文件 → spawn 抛 uncaughtException 杀进程。
      // 详见 docs/PIKAFISH-LOADER.md 差距 1。
      // 在 Node bench 路径下,直接 mark unavailable;不进 try/catch(避免 worker_threads
      // 异步 uncaughtException 逃逸)。
      const workerMissing = !fs.existsSync(vendorWorker);
      const sourceIsPthread = (() => {
        try {
          const src = fs.readFileSync(vendorJs, "utf8");
          return /locateFile\(\s*["']pikafish\.worker\.js["']/.test(src);
        } catch (_) {
          return false;
        }
      })();
      if (workerMissing && sourceIsPthread) {
        this.unavailable = true;
        this.unavailableReason =
          "pikafish.worker.js not bundled (pthread bootstrap unavailable)";
        return this;
      }
      let factory;
      try {
        // require 会 cache;clear cache 避免重复 init 时拿到旧 instance
        delete require.cache[require.resolve(vendorJs)];
        factory = require(vendorJs);
      } catch (e) {
        this.unavailable = true;
        this.unavailableReason = `require failed: ${e.message}`;
        return this;
      }
      if (typeof factory !== "function") {
        this.unavailable = true;
        this.unavailableReason = `factory typeof=${typeof factory}`;
        return this;
      }
      // 关键:本 build 是 pthread-enabled,init 时会 `new Worker("pikafish.worker.js")`。
      // 该文件不存在 → worker_threads 抛 MODULE_NOT_FOUND + uncaughtException(逃出 try/catch)。
      // 本 harness 在 Node 里不需要真线程:把 global.Worker stub 掉,让 instantiate 在
      // 主线程同步失败,从而进入 catch 分支(而不是杀死 process)。
      // 浏览器路径不走这里(bench/v2-benchmark.js 仅在 Node 跑)。
      const origWorker = global.Worker;
      global.Worker = class StubWorker {
        constructor(url) {
          throw new Error(
            `pikafish.worker.js not bundled (pthread bootstrap unavailable): ${url}`,
          );
        }
      };
      const loader = () =>
        Promise.resolve(() =>
          factory({
            print: () => {},
            printErr: () => {},
            noInitialRun: true,
            onExit: () => {},
          }).then((mod) => {
            mod.sendCommand = () => {};
            return mod;
          }),
        );
      try {
        const eng = new PikafishEngine(loader, {
          onInfo: () => {},
          onError: () => {},
        });
        await Promise.race([
          eng.start(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("pikafish init timeout")),
              PIKAFISH_TIMEOUT_MS,
            ),
          ),
        ]);
        this.engine = eng;
      } catch (e) {
        this.unavailable = true;
        this.unavailableReason = (e && e.message) || String(e);
      } finally {
        global.Worker = origWorker;
      }
      return this;
    })();
    return this._initPromise;
  }

  // 返回 v1 move 对象(基于 board 反查 pieceId)
  async pickMove(board, sideToMove) {
    if (this.unavailable) return null;
    if (!this.engine) await this.init();
    if (this.unavailable || !this.engine) return null;
    const fen = boardToFen(board, sideToMove);
    this.engine.position(fen);
    const bestUci = await this.engine.goDepth(this.depth);
    if (!bestUci || bestUci === "(none)") return null;
    return uciToMove(bestUci, board);
  }
}

// === 单局对弈 ===
//   每方 player 返回 v1 move 对象;游戏循环统一 apply 到 VM state。
//   pikafish 不可用时,该方降级为 vanilla hard(并记 degradation)。
async function playOneGame({
  gameId,
  redSpec,
  blackSpec,
  redPlayer,
  blackPlayer,
  vmEngine,
  maxPly = MAX_PLY,
  drawPly = NO_CAPTURE_DRAW_PLY,
}) {
  vmEngine.evaluate(`
    state = createGame(SIDES.RED, "hard");
    state.status = "playing";
    state.moveHistory = [];
    state.snapshots = [];
    state.capturedPieces = [];
  `);

  let noCapturePly = 0;
  let winner = null;
  let reason = null;
  let plies = 0;
  const degradations = [];

  for (let ply = 0; ply < maxPly; ply += 1) {
    plies += 1;
    const side = vmEngine.evaluate("state.currentSide");
    const isRed = side === "red" || side === 1;
    const spec = isRed ? redSpec : blackSpec;
    let player = isRed ? redPlayer : blackPlayer;
    let degradedThis = false;

    if (player.unavailable) {
      // 降级到 vanilla hard
      player = new VanillaPlayer(
        { kind: "vanilla", difficulty: "hard", label: "vanilla-hard(degraded)" },
        vmEngine,
      );
      degradedThis = true;
      degradations.push({
        ply,
        spec: spec.label,
        reason: "pikafish unavailable",
      });
    }

    let move = null;
    if (player.kind === "pikafish") {
      const board = vmEngine.json("state.board");
      const sideStr = isRed ? "red" : "black";
      try {
        move = await player.pickMove(board, sideStr);
      } catch (e) {
        // 异常:降级
        player = new VanillaPlayer(
          { kind: "vanilla", difficulty: "hard", label: "vanilla-hard(degraded)" },
          vmEngine,
        );
        degradations.push({ ply, spec: spec.label, reason: `pikafish error: ${e.message}` });
        degradedThis = true;
        move = player.pickMove();
      }
    } else {
      move = player.pickMove();
    }

    if (!move) {
      const checked = vmEngine.evaluate("isInCheck(state.board, state.currentSide)");
      winner = checked ? (isRed ? "black" : "red") : null;
      reason = checked ? "checkmate" : "stalemate";
      break;
    }

    // 把 move 推入 VM 并 apply(不用 const __m,避免 ply 间重复声明)
    const moveJson = JSON.stringify(move);
    vmEngine.evaluate(`
      state.board = applyMoveToBoard(state.board, ${moveJson});
      state.snapshots.push({ board: cloneBoard(state.board), currentSide: opposite(state.currentSide) });
      state.lastMove = ${moveJson};
      state.moveHistory.push(${moveJson});
      state.currentSide = opposite(state.currentSide);
    `);

    const capturedId = move.capturedPieceId;
    if (capturedId) noCapturePly = 0;
    else noCapturePly += 1;

    const nextLegal = vmEngine.evaluate(
      "allLegalMoves(state.board, state.currentSide).length",
    );
    if (!nextLegal) {
      const checked = vmEngine.evaluate(
        "isInCheck(state.board, state.currentSide)",
      );
      winner = checked
        ? vmEngine.evaluate("state.currentSide") === "red"
          ? "black"
          : "red"
        : null;
      reason = checked ? "checkmate" : "stalemate";
      break;
    }
    if (noCapturePly >= drawPly) {
      winner = null;
      reason = "draw_no_capture";
      break;
    }
  }

  if (!reason) {
    const score = vmEngine.evaluate("evaluateBoard(state.board, SIDES.RED)");
    const margin = 200;
    if (score > margin) {
      winner = "red";
      reason = "material_majority";
    } else if (score < -margin) {
      winner = "black";
      reason = "material_majority";
    } else {
      winner = null;
      reason = "draw_material";
    }
  }

  return {
    gameId,
    red: redSpec.label,
    black: blackSpec.label,
    winner,
    reason,
    plies,
    degradations,
  };
}

// === 主入口 ===
async function runBenchmark(opts = {}) {
  const games = opts.games || GAMES;
  const redSpec = parseEngineSpec(opts.redEngine || RED_ENGINE);
  const blackSpec = parseEngineSpec(opts.blackEngine || BLACK_ENGINE);

  const vmEngine = createEngine();
  const redPlayer =
    redSpec.kind === "pikafish"
      ? new PikafishPlayer(redSpec)
      : new VanillaPlayer(redSpec, vmEngine);
  const blackPlayer =
    blackSpec.kind === "pikafish"
      ? new PikafishPlayer(blackSpec)
      : new VanillaPlayer(blackSpec, vmEngine);

  if (redSpec.kind === "pikafish") await redPlayer.init();
  if (blackSpec.kind === "pikafish") await blackPlayer.init();

  const pikafishWasRequested =
    redSpec.kind === "pikafish" || blackSpec.kind === "pikafish";
  const pikafishAvailable =
    (redSpec.kind !== "pikafish" || !redPlayer.unavailable) &&
    (blackSpec.kind !== "pikafish" || !blackPlayer.unavailable);

  const results = [];
  for (let i = 0; i < games; i += 1) {
    process.stdout.write(
      `[${i + 1}/${games}] red=${redSpec.label} black=${blackSpec.label} ... `,
    );
    const t0 = Date.now();
    const result = await playOneGame({
      gameId: i + 1,
      redSpec,
      blackSpec,
      redPlayer,
      blackPlayer,
      vmEngine,
    });
    result.elapsedMs = Date.now() - t0;
    process.stdout.write(
      JSON.stringify({
        winner: result.winner,
        reason: result.reason,
        plies: result.plies,
        ms: result.elapsedMs,
        degraded: result.degradations.length,
      }) + "\n",
    );
    results.push(result);
  }

  const redWins = results.filter((r) => r.winner === "red").length;
  const blackWins = results.filter((r) => r.winner === "black").length;
  const draws = results.filter((r) => r.winner === null).length;
  const eloRedVsBlack = eloDiffFromScore(redWins, draws, blackWins);
  const eloCI = eloConfidenceInterval(redWins, draws, blackWins);
  const totalDegradations = results.reduce((s, r) => s + r.degradations.length, 0);

  return {
    ranAt: new Date().toISOString(),
    pikafishWasRequested,
    pikafishAvailable,
    pikafishStatus: {
      red:
        redSpec.kind === "pikafish"
          ? redPlayer.unavailable
            ? `unavailable: ${redPlayer.unavailableReason}`
            : "ready"
          : "n/a",
      black:
        blackSpec.kind === "pikafish"
          ? blackPlayer.unavailable
            ? `unavailable: ${blackPlayer.unavailableReason}`
            : "ready"
          : "n/a",
    },
    config: {
      games,
      redEngine: redSpec.label,
      blackEngine: blackSpec.label,
      maxPly: MAX_PLY,
      drawPly: NO_CAPTURE_DRAW_PLY,
      pikafishDepth: PIKAFISH_DEPTH,
    },
    summary: {
      redWins,
      blackWins,
      draws,
      redScore: games ? (redWins + 0.5 * draws) / games : 0,
      eloRedVsBlack,
      eloCILo: eloCI.loElo,
      eloCIHi: eloCI.hiElo,
      totalDegradations,
      avgPly: games
        ? Math.round(results.reduce((s, r) => s + r.plies, 0) / games)
        : 0,
      totalMs: results.reduce((s, r) => s + r.elapsedMs, 0),
    },
    perGame: results.map((r) => ({
      id: r.gameId,
      red: r.red,
      black: r.black,
      winner: r.winner,
      reason: r.reason,
      plies: r.plies,
      elapsedMs: r.elapsedMs,
      degradations: r.degradations.length,
    })),
  };
}

function formatMarkdown(report) {
  const L = [];
  L.push("# v2 Self-play Benchmark Results");
  L.push("");
  L.push(`**运行时间**: ${report.ranAt}`);
  L.push(
    `**Pikafish 可用**: ${report.pikafishAvailable ? "yes" : "no (已降级到 vanilla hard)"}`,
  );
  L.push("");
  L.push("## 配置");
  L.push("");
  L.push("```json");
  L.push(JSON.stringify(report.config, null, 2));
  L.push("```");
  L.push("");
  L.push("## Pikafish 状态");
  L.push("");
  L.push(`- 红方: ${report.pikafishStatus.red}`);
  L.push(`- 黑方: ${report.pikafishStatus.black}`);
  L.push("");
  L.push("## 总计");
  L.push("");
  L.push(`- 局数: ${report.config.games}`);
  L.push(`- 红方胜: ${report.summary.redWins}`);
  L.push(`- 黑方胜: ${report.summary.blackWins}`);
  L.push(`- 和棋: ${report.summary.draws}`);
  L.push(
    `- 红方得分率: ${(report.summary.redScore * 100).toFixed(1)}%`,
  );
  L.push(
    `- Elo 差(红 vs 黑): ${report.summary.eloRedVsBlack ?? "n/a"} (95% CI: ${report.summary.eloCILo} ~ ${report.summary.eloCIHi})`,
  );
  L.push(`- 降级走子数: ${report.summary.totalDegradations}`);
  L.push(`- 平均 ply: ${report.summary.avgPly}`);
  L.push(`- 总耗时: ${(report.summary.totalMs / 1000).toFixed(1)}s`);
  L.push("");
  L.push("## Per-game");
  L.push("");
  L.push("| 局 | 红方 | 黑方 | 胜方 | 终局原因 | ply | 耗时(s) | 降级 |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const g of report.perGame) {
    L.push(
      `| ${g.id} | ${g.red} | ${g.black} | ${g.winner || "和"} | ${g.reason} | ${g.plies} | ${(g.elapsedMs / 1000).toFixed(1)} | ${g.degradations} |`,
    );
  }
  L.push("");
  L.push("## 解读说明");
  L.push("");
  L.push(
    "- 当 `pikafishAvailable=false` 时,Elo 差反映的是 vanilla 配置之间的差距,**不是 Pikafish 真实棋力**。",
  );
  L.push(
    "- 95% CI 宽度 > 200 Elo 时,样本量不足;应增加 `BENCH_GAMES`。",
  );
  L.push(
    "- Pikafish 不可用的根因与路径选择详见 `docs/PIKAFISH-LOADER.md`。",
  );
  return L.join("\n") + "\n";
}

if (require.main === module) {
  runBenchmark()
    .then((report) => {
      const outDir = path.join(__dirname, "..", "docs", "plans");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, "v2-benchmark-results.json"),
        JSON.stringify(report, null, 2) + "\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(outDir, "v2-benchmark-results.md"),
        formatMarkdown(report),
        "utf8",
      );
      console.log(JSON.stringify(report.summary, null, 2));
      console.log(`\nReport written to docs/plans/v2-benchmark-results.{md,json}`);
    })
    .catch((e) => {
      console.error("benchmark failed:", e);
      process.exit(1);
    });
}

module.exports = {
  runBenchmark,
  playOneGame,
  eloDiffFromScore,
  scoreConfidenceInterval,
  eloConfidenceInterval,
  parseEngineSpec,
  VanillaPlayer,
  PikafishPlayer,
};
