const fs = require("node:fs");
const path = require("node:path");
const { createEngine } = require("./engine-harness");

const GAMES = Number(process.env.BENCH_GAMES || 4);
const MAX_PLY = Number(process.env.BENCH_MAX_PLY || 80);
const NO_CAPTURE_DRAW_PLY = Number(process.env.BENCH_DRAW_PLY || 30);
const HARD_DEADLINE_MS = Number(process.env.BENCH_HARD_MS || 300);
const NORMAL_DEADLINE_MS = Number(process.env.BENCH_NORMAL_MS || 200);

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

function run() {
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
    },
    summary,
  };
}

if (require.main === module) {
  const report = run();
  console.log(JSON.stringify(report, null, 2));
  const outPath = path.join(__dirname, "..", "docs", "plans", "benchmark-results.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
}

module.exports = { run, playOneGame };
