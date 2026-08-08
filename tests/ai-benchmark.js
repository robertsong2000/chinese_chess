const fs = require("node:fs");
const path = require("node:path");
const { createEngine } = require("./engine-harness");

// #35 默认自对弈 8 局(可被 BENCH_GAMES 覆盖),并新增 5 个战术题(tactics)。
// #42 长模式:BENCH_LONG=1 时默认 20 局(可被 BENCH_GAMES 进一步覆盖)。
const GAMES = Number(process.env.BENCH_GAMES || (process.env.BENCH_LONG === "1" ? 20 : 8));
const MAX_PLY = Number(process.env.BENCH_MAX_PLY || 80);
const NO_CAPTURE_DRAW_PLY = Number(process.env.BENCH_DRAW_PLY || 30);
const HARD_DEADLINE_MS = Number(process.env.BENCH_HARD_MS || 300);
const NORMAL_DEADLINE_MS = Number(process.env.BENCH_NORMAL_MS || 200);
const TACTIC_DEADLINE_MS = Number(process.env.BENCH_TACTIC_MS || 300);
const TACTIC_PASS_THRESHOLD = Number(process.env.BENCH_TACTIC_PASS_RATIO || 0.6);

function playOneGame(engine, gameId, redDifficulty, blackDifficulty) {
  return engine.json(`(() => {
    const hardDeadline = ${HARD_DEADLINE_MS};
    const normalDeadline = ${NORMAL_DEADLINE_MS};
    const maxPly = ${MAX_PLY};
    const drawPly = ${NO_CAPTURE_DRAW_PLY};

    // 临时缩短 chooseAIMove 内部 hard/normal 的思考时间上限。
    // chooseAIMove 用 performance.now() 算 elapsed,我们包装它让 elapsed 放大,从而提前 break。
    const realNow = performance.now.bind(performance);
    let timeScale = 1;
    performance.now = function scaledNow() {
      return realNow() * timeScale;
    };

    state = createGame(SIDES.RED, "hard");
    state.status = "playing";
    state.moveHistory = [];
    state.snapshots = [];
    state.capturedPieces = [];

    let noCapturePly = 0;
    let winner = null;
    let reason = null;
    let plies = 0;
    let hardTicks = 0;
    let normalTicks = 0;

    for (let ply = 0; ply < maxPly; ply += 1) {
      plies += 1;
      const side = state.currentSide;
      const diff = side === SIDES.RED ? ${JSON.stringify(redDifficulty)} : ${JSON.stringify(blackDifficulty)};
      state.aiDifficulty = diff;

      // 时间盒:用 timeScale 放大 elapsed,让 chooseAIMove 内的 deadline 提前触发
      const budget = diff === "hard" ? hardDeadline : normalDeadline;
      const baseBudget = diff === "hard" ? 1100 : 520;
      timeScale = baseBudget / budget;

      const t0 = realNow();
      const move = chooseAIMove();
      const elapsed = realNow() - t0;
      if (diff === "hard") hardTicks += elapsed; else normalTicks += elapsed;
      if (!move) {
        const checked = isInCheck(state.board, state.currentSide);
        winner = checked ? opposite(state.currentSide) : null;
        reason = checked ? "checkmate" : "stalemate";
        break;
      }

      const capturedId = move.capturedPieceId;
      if (capturedId) noCapturePly = 0; else noCapturePly += 1;

      state.board = applyMoveToBoard(state.board, move);
      state.snapshots.push({
        board: cloneBoard(state.board),
        currentSide: opposite(state.currentSide),
      });
      state.lastMove = { ...move };
      state.moveHistory.push({ ...move });
      state.currentSide = opposite(state.currentSide);

      const nextMoves = allLegalMoves(state.board, state.currentSide);
      if (!nextMoves.length) {
        const checked = isInCheck(state.board, state.currentSide);
        winner = checked ? opposite(state.currentSide) : null;
        reason = checked ? "checkmate" : "stalemate";
        break;
      }
      if (noCapturePly >= drawPly) {
        winner = null;
        reason = "draw_no_capture";
        break;
      }
    }

    performance.now = realNow;

    if (!reason) {
      // 步数耗尽未结束:用 evaluateBoard 在 RED 视角判定
      const redScore = evaluateBoard(state.board, SIDES.RED);
      const margin = 200;
      if (redScore > margin) { winner = SIDES.RED; reason = "material_majority"; }
      else if (redScore < -margin) { winner = SIDES.BLACK; reason = "material_majority"; }
      else { winner = null; reason = "draw_material"; }
    }

    return {
      gameId: ${gameId},
      red: ${JSON.stringify(redDifficulty)},
      black: ${JSON.stringify(blackDifficulty)},
      winner,
      reason,
      plies,
      hardMs: Math.round(hardTicks),
      normalMs: Math.round(normalTicks),
    };
  })()`);
}

// #35 战术题集(5 题)。每题用 hard AI 在压缩时间盒内寻找正着。
// 谓词 expectSrc 在 vm 内 eval,引用 move 变量;常量 SIDES / TYPES 由 vm 上下文提供。
// 通过阈值:TACTIC_PASS_THRESHOLD(默认 60%,即至少 3/5)。
// 设计:
//   T1 免费吃车 — 1-ply 战术,验证 hard 不漏吃无保护子
//   T2 fork — 1-ply 战术,验证 hard 选 fork 走法(马吃双高价值之一)
//   T3 防守吃将军子 — 1-ply 防守,验证 hard 能吃掉将军子而非被动逃将
//   T4 优势兑换 — 1-ply 战术,验证 hard 用低价值子换高价值子(兵换马)
//   T5 残局车将军 — 1-ply 残局,验证 hard 红方在车 vs 孤将中选车将军(杀型正着)
const TACTICS = [
  {
    id: "T1",
    name: "免费吃车(1-ply capture)",
    description: "黑马走日吃无保护红车,验证 hard 不漏吃",
    boardSrc: `[
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 5, y: 5, alive: true },
      { id: 'bh', side: SIDES.BLACK, type: TYPES.HORSE, x: 6, y: 3, alive: true }
    ]`,
    side: "BLACK",
    expectSrc: `(move && move.pieceType === TYPES.HORSE && move.toX === 5 && move.toY === 5)`,
  },
  {
    id: "T2",
    name: "马走日形成 fork(1-ply tactic)",
    description: "黑马走日同时威胁红车 + 红炮,选吃其一;红将错开列避免飞将干扰",
    boardSrc: `[
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 3, y: 4, alive: true },
      { id: 'ra', side: SIDES.RED, type: TYPES.CANNON, x: 5, y: 4, alive: true },
      { id: 'bh', side: SIDES.BLACK, type: TYPES.HORSE, x: 4, y: 2, alive: true }
    ]`,
    side: "BLACK",
    // 马走日 (4,2)→(3,4) 吃车 或 (4,2)→(5,4) 吃炮,两者都形成 fork
    // 红将在 (3,9) 错开 4 列,马离开 (4,2) 后 4 列仍空但无飞将威胁
    expectSrc: `(move && move.pieceType === TYPES.HORSE && ((move.toX === 3 && move.toY === 4) || (move.toX === 5 && move.toY === 4)))`,
  },
  {
    id: "T3",
    name: "防守吃将军子(1-ply defensive)",
    description: "红方被黑马将军,正解是车吃马(同时解将 + 得子);飞将吃黑将也算通过(直接将死)",
    boardSrc: `[
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'bh', side: SIDES.BLACK, type: TYPES.HORSE, x: 3, y: 7, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 3, y: 3, alive: true }
    ]`,
    side: "RED",
    // 红车 (3,3)→(3,7) 吃掉将军黑马是正解;
    // 红将 (4,9)→(4,0) 直接飞将吃黑将也算通过(4 列中间空,合法绝杀)
    expectSrc: `(move && ((move.pieceType === TYPES.CHARIOT && move.toX === 3 && move.toY === 7) || (move.pieceType === TYPES.GENERAL && move.toX === 4 && move.toY === 0)))`,
  },
  {
    id: "T4",
    name: "优势兑换:兵换马(1-ply trade-up)",
    description: "红兵换黑无保护马(+330 净得),验证 hard 选优势兑换",
    boardSrc: `[
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'bh', side: SIDES.BLACK, type: TYPES.HORSE, x: 4, y: 5, alive: true },
      { id: 'rs', side: SIDES.RED, type: TYPES.SOLDIER, x: 4, y: 6, alive: true }
    ]`,
    side: "RED",
    // 红兵 (4,6) → (4,5) 吃黑马(兵直走 1 步)
    expectSrc: `(move && move.pieceType === TYPES.SOLDIER && move.toX === 4 && move.toY === 5)`,
  },
  {
    id: "T5",
    name: "残局车将军(车 vs 孤将杀型)",
    description: "红车对孤将,正解是把车移到 4 列或 0 行形成将军;飞将吃黑将也算通过(直接绝杀)",
    boardSrc: `[
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 3, y: 5, alive: true }
    ]`,
    side: "RED",
    // 红车 (3,5)→(3,0)(攻击 0 行)或 →(4,5)(攻击 4 列将军)
    // 红将 (4,9)→(4,0) 直接飞将吃黑将也算通过(4 列中间空,合法绝杀)
    expectSrc: `(move && ((move.pieceType === TYPES.CHARIOT && (move.toX === 4 || move.toY === 0)) || (move.pieceType === TYPES.GENERAL && move.toX === 4 && move.toY === 0)))`,
  },
  // #42 扩展 tactics:T6-T10 覆盖更多战术类型(cannon capture / soldier capture / defensive counter / fork / nested cannon)
  {
    id: "T6",
    name: "炮通过架子吃无保护马(cannon capture via screen)",
    description: "红炮 (3,9) 通过红士 (3,7) 作炮架吃无保护黑马 (3,5);验证 hard AI 识别炮的 capture-via-screen 走法",
    boardSrc: `[
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'bh', side: SIDES.BLACK, type: TYPES.HORSE, x: 3, y: 5, alive: true },
      { id: 'ra', side: SIDES.RED, type: TYPES.ADVISOR, x: 3, y: 7, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CANNON, x: 3, y: 9, alive: true },
      { id: 'rs', side: SIDES.RED, type: TYPES.SOLDIER, x: 4, y: 5, alive: true }
    ]`,
    side: "RED",
    // 红炮 (3,9) → (3,5) 吃黑马(中间 1 子 (3,7) 红士作架子)
    // 4 列中间有红兵挡住飞将
    expectSrc: `(move && move.pieceType === TYPES.CANNON && move.toX === 3 && move.toY === 5)`,
  },
  {
    id: "T7",
    name: "过河兵吃高价值子(soldier trade-up)",
    description: "红兵 (4,5) 直走吃黑马 (4,4),+330 净得;验证 hard AI 识别兵的 capture 升变",
    boardSrc: `[
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'bh', side: SIDES.BLACK, type: TYPES.HORSE, x: 4, y: 4, alive: true },
      { id: 'rs', side: SIDES.RED, type: TYPES.SOLDIER, x: 4, y: 5, alive: true }
    ]`,
    side: "RED",
    // 红兵 (4,5) → (4,4) 吃黑马(兵直走 1 步,合法)
    expectSrc: `(move && move.pieceType === TYPES.SOLDIER && move.toX === 4 && move.toY === 4)`,
  },
  {
    id: "T8",
    name: "防守反吃将军子(defensive counter-capture)",
    description: "红车 (4,5) 将军黑将,黑车 (4,8) 反吃红车解将 + 得子;验证 hard AI 选最优防守(吃子 > 跑将)",
    boardSrc: `[
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 4, y: 5, alive: true },
      { id: 'bc', side: SIDES.BLACK, type: TYPES.CHARIOT, x: 4, y: 8, alive: true }
    ]`,
    side: "BLACK",
    // 黑车 (4,8) → (4,5) 吃红车(同列,中间 (4,6)(4,7) 空,合法车吃)
    // 同时解将 + 得车(等价交换 + 解将,优于跑将)
    expectSrc: `(move && move.pieceType === TYPES.CHARIOT && move.toX === 4 && move.toY === 5)`,
  },
  {
    id: "T9",
    name: "红马 fork 黑车 + 黑炮(horse fork - RED side)",
    description: "红马 (4,6) 走日同时威胁黑车 (3,4) + 黑炮 (5,4),选吃其一;T2 反方版本,扩展 fork 战术覆盖",
    boardSrc: `[
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'bc', side: SIDES.BLACK, type: TYPES.CHARIOT, x: 3, y: 4, alive: true },
      { id: 'ba', side: SIDES.BLACK, type: TYPES.CANNON, x: 5, y: 4, alive: true },
      { id: 'rh', side: SIDES.RED, type: TYPES.HORSE, x: 4, y: 6, alive: true }
    ]`,
    side: "RED",
    // 红马 (4,6)→(3,4) 吃车 或 (4,6)→(5,4) 吃炮(都是马走日,马腿 (4,5) 空)
    expectSrc: `(move && move.pieceType === TYPES.HORSE && ((move.toX === 3 && move.toY === 4) || (move.toX === 5 && move.toY === 4)))`,
  },
  {
    id: "T10",
    name: "双炮重叠:后炮通过前炮吃车(nested cannon capture)",
    description: "红后炮 (4,9) 通过红前炮 (4,7) 作炮架吃黑车 (4,5);将错开列避免前炮 (4,7) 通过车作架子直接吃将;验证 hard AI 识别炮的多层 capture-via-screen",
    boardSrc: `[
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 5, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 3, y: 0, alive: true },
      { id: 'bc', side: SIDES.BLACK, type: TYPES.CHARIOT, x: 4, y: 5, alive: true },
      { id: 'rc1', side: SIDES.RED, type: TYPES.CANNON, x: 4, y: 7, alive: true },
      { id: 'rc2', side: SIDES.RED, type: TYPES.CANNON, x: 4, y: 9, alive: true }
    ]`,
    side: "RED",
    // 红后炮 (4,9) → (4,5) 吃黑车(中间 1 子 (4,7) 红前炮作架子)
    // 前炮 (4,7) 不能直接吃车(中间 (4,6) 空无架子);红将在 (5,9) 避免任何飞将
    expectSrc: `(move && move.pieceType === TYPES.CANNON && move.toX === 4 && move.toY === 5)`,
  },
];

function runTactics(engine) {
  const results = [];
  for (const t of TACTICS) {
    const result = engine.json(`(() => {
      const board = ${t.boardSrc};
      state = createGame(SIDES.RED, "hard");
      state.status = "playing";
      state.board = board;
      state.currentSide = SIDES.${t.side};
      state.snapshots = [];
      state.moveHistory = [];

      const realNow = performance.now.bind(performance);
      const timeScale = 1100 / ${TACTIC_DEADLINE_MS};
      performance.now = function () { return realNow() * timeScale; };
      let move = null;
      try { move = chooseAIMove(); } finally { performance.now = realNow; }

      const passed = ${t.expectSrc};
      return {
        passed,
        pieceType: move && move.pieceType,
        from: move && [move.fromX, move.fromY],
        to: move && [move.toX, move.toY],
      };
    })()`);
    results.push({
      id: t.id,
      name: t.name,
      category: t.category,
      passed: Boolean(result.passed),
      move: result.to ? { from: result.from, to: result.to, pieceType: result.pieceType } : null,
    });
    process.stdout.write(`  ${t.id} ${t.name}: ${result.passed ? "PASS" : "FAIL"} (move=${result.from || "null"}→${result.to || "null"})\n`);
  }
  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    rate: results.length ? Math.round((passed / results.length) * 1000) / 1000 : 0,
    passThreshold: TACTIC_PASS_THRESHOLD,
    passThresholdMet: results.length ? passed / results.length >= TACTIC_PASS_THRESHOLD : false,
    results,
  };
}

function run() {
  // #35 先跑 tactics(快速,~1-2 秒),再跑自对弈(慢,GAMES 局)。
  process.stdout.write(`== Tactics (${TACTICS.length} puzzles) ==\n`);
  const tacticsEngine = createEngine();
  const tactics = runTactics(tacticsEngine);

  process.stdout.write(`\n== Self-play (${GAMES} games, hard vs normal) ==\n`);
  const matchups = [];
  for (let i = 0; i < GAMES; i += 1) {
    if (i % 2 === 0) matchups.push(["hard", "normal"]);
    else matchups.push(["normal", "hard"]);
  }

  const results = [];
  for (let i = 0; i < matchups.length; i += 1) {
    const [red, black] = matchups[i];
    process.stdout.write(`[${i + 1}/${matchups.length}] red=${red} black=${black} ... `);
    const t0 = Date.now();
    const result = playOneGame(createEngine(), i + 1, red, black);
    result.elapsedMs = Date.now() - t0;
    process.stdout.write(JSON.stringify({
      winner: result.winner, reason: result.reason, plies: result.plies, ms: result.elapsedMs,
    }) + "\n");
    results.push(result);
  }

  const RED = "red";
  const BLACK = "black";
  const summary = {
    games: results.length,
    hardWins: results.filter((r) => {
      const hardIsRed = r.red === "hard";
      return (hardIsRed && r.winner === RED) || (!hardIsRed && r.winner === BLACK);
    }).length,
    normalWins: results.filter((r) => {
      const normalIsRed = r.red === "normal";
      return (normalIsRed && r.winner === RED) || (!normalIsRed && r.winner === BLACK);
    }).length,
    draws: results.filter((r) => r.winner === null).length,
    avgPly: Math.round(results.reduce((s, r) => s + r.plies, 0) / results.length),
    totalElapsedMs: results.reduce((s, r) => s + r.elapsedMs, 0),
    perGame: results.map((r) => ({
      id: r.gameId, red: r.red, black: r.black, winner: r.winner, reason: r.reason,
      plies: r.plies, elapsedMs: r.elapsedMs,
    })),
  };
  summary.hardWinRate = summary.games ? Math.round((summary.hardWins / summary.games) * 1000) / 1000 : 0;

  return {
    ranAt: new Date().toISOString(),
    config: {
      GAMES, MAX_PLY, NO_CAPTURE_DRAW_PLY, HARD_DEADLINE_MS, NORMAL_DEADLINE_MS,
      TACTIC_DEADLINE_MS, TACTIC_PASS_THRESHOLD,
    },
    tactics,
    summary,
  };
}

function formatMarkdown(report) {
  const { ranAt, config, tactics, summary } = report;
  const lines = [];
  lines.push("# AI Benchmark Results (Phase 4)");
  lines.push("");
  lines.push(`**运行时间**: ${ranAt}`);
  lines.push("");
  lines.push("## 战术题集(Tactics)");
  lines.push("");
  lines.push(`- 题目数: ${tactics.total}`);
  lines.push(`- 通过数: ${tactics.passed} / ${tactics.total}`);
  lines.push(`- 通过率: ${(tactics.rate * 100).toFixed(1)}%`);
  lines.push(`- 通过阈值: ${(tactics.passThreshold * 100).toFixed(0)}% — ${tactics.passThresholdMet ? "✓ MET" : "✗ NOT MET"}`);
  lines.push("");
  lines.push("| 题 | 名称 | 通过 | 走法 |");
  lines.push("|---|---|---|---|");
  for (const r of tactics.results) {
    const moveStr = r.move ? `${r.move.from}→${r.move.to}` : "(no move)";
    lines.push(`| ${r.id} | ${r.name} | ${r.passed ? "✓" : "✗"} | ${moveStr} |`);
  }
  lines.push("");
  lines.push("## 自对弈(Self-play, hard vs normal)");
  lines.push("");
  lines.push(`- 局数: ${summary.games}`);
  lines.push(`- hard 胜: ${summary.hardWins}`);
  lines.push(`- normal 胜: ${summary.normalWins}`);
  lines.push(`- 和棋: ${summary.draws}`);
  lines.push(`- hard 胜率: ${(summary.hardWinRate * 100).toFixed(1)}%`);
  lines.push(`- 平均 ply: ${summary.avgPly}`);
  lines.push(`- 总耗时: ${(summary.totalElapsedMs / 1000).toFixed(1)}s`);
  lines.push("");
  lines.push("| 局 | 红方 | 黑方 | 胜方 | 终局原因 | ply | 耗时(s) |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const g of summary.perGame) {
    const winnerStr = g.winner === null ? "和" : `${g.winner}(${g.winner === "red" ? g.red : g.black})`;
    lines.push(`| ${g.id} | ${g.red} | ${g.black} | ${winnerStr} | ${g.reason} | ${g.plies} | ${(g.elapsedMs / 1000).toFixed(1)} |`);
  }
  lines.push("");
  lines.push("## 配置");
  lines.push("");
  lines.push("```");
  lines.push(JSON.stringify(config, null, 2));
  lines.push("```");
  return lines.join("\n") + "\n";
}

if (require.main === module) {
  const report = run();
  console.log(JSON.stringify(report, null, 2));
  const jsonPath = path.join(__dirname, "..", "docs", "plans", "benchmark-results.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  const mdPath = path.join(__dirname, "..", "docs", "plans", "benchmark-results.md");
  fs.writeFileSync(mdPath, formatMarkdown(report), "utf8");
}

module.exports = { run, playOneGame, runTactics, TACTICS };
