// AI 搜索模块(开局库 + 评估 + 搜索 + 时间管理 + 走法排序 + Worker 端纯函数)。
// 与 src/constants.js / src/rules.js 相同,通过 <script> 标签或 vm 共享全局词法环境。
// 加载顺序:constants.js → rules.js → search.js → app.js。
//
// 说明:本文件中带默认参数的函数(board = state.board、currentState = state 等),
// 默认值在调用时求值,因此即便 search.js 加载时 state(在 app.js 顶层初始化)尚未
// 定义也不出错。runAISearch(s) 显式接收 state 引用,为 Web Worker 化铺路。

const OPENING_BOOK_MAX_PLIES = 12;

// 22 个主流开局变着,每个 8 步(4 回合)。覆盖中炮、屏风马、反宫马、
// 仙人指路、飞相局、起马局、过宫炮、仕角炮、列炮等主流布局类型。
const OPENING_BOOK_LINES = [
  // 1. 中炮七路马对屏风马(红横车)
  [
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
    { fromX: 0, fromY: 9, toX: 0, toY: 8 },
    { fromX: 8, fromY: 0, toX: 7, toY: 0 },
  ],
  // 2. 中炮直车对屏风马(过河车)
  [
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 8, fromY: 9, toX: 7, toY: 9 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
    { fromX: 7, fromY: 9, toX: 7, toY: 3 },
    { fromX: 2, fromY: 3, toX: 2, toY: 4 },
  ],
  // 3. 中炮横车对屏风马(车九进一)
  [
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 0, fromY: 9, toX: 0, toY: 8 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
    { fromX: 0, fromY: 8, toX: 4, toY: 8 },
    { fromX: 8, fromY: 0, toX: 7, toY: 0 },
  ],
  // 4. 中炮对反宫马(黑左炮平 6)
  [
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 1, fromY: 2, toX: 3, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 8, fromY: 9, toX: 7, toY: 9 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
  ],
  // 5. 中炮对顺炮(双方同型,黑方左炮打中)
  [
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 1, fromY: 2, toX: 4, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 8, fromY: 9, toX: 7, toY: 9 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
    { fromX: 7, fromY: 9, toX: 7, toY: 5 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
  ],
  // 6. 中炮对顺炮直车(黑方右炮打中)
  [
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 7, fromY: 2, toX: 4, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 8, fromY: 9, toX: 7, toY: 9 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
  ],
  // 7. 中炮对列炮(黑右炮反方向打中)
  [
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 7, fromY: 2, toX: 4, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 8, fromY: 9, toX: 7, toY: 9 },
    { fromX: 8, fromY: 0, toX: 7, toY: 0 },
    { fromX: 7, fromY: 9, toX: 7, toY: 3 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
  ],
  // 8. 五七炮对屏风马(红方右炮平 5,左炮平 9)
  [
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
    { fromX: 1, fromY: 7, toX: 0, toY: 7 },
    { fromX: 8, fromY: 0, toX: 7, toY: 0 },
  ],
  // 9. 五六炮对屏风马(红右炮平六)
  [
    { fromX: 7, fromY: 7, toX: 3, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
    { fromX: 0, fromY: 9, toX: 0, toY: 8 },
    { fromX: 8, fromY: 0, toX: 7, toY: 0 },
  ],
  // 10. 仙人指路对卒底炮(红进三兵,黑平卒底炮)
  [
    { fromX: 6, fromY: 6, toX: 6, toY: 5 },
    { fromX: 7, fromY: 2, toX: 4, toY: 2 },
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 8, fromY: 9, toX: 7, toY: 9 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
  ],
  // 11. 仙人指路对起马
  [
    { fromX: 6, fromY: 6, toX: 6, toY: 5 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 8, fromY: 0, toX: 7, toY: 0 },
  ],
  // 12. 仙人指路对中炮(黑方起手炮二平五)
  [
    { fromX: 6, fromY: 6, toX: 6, toY: 5 },
    { fromX: 7, fromY: 2, toX: 4, toY: 2 },
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
  ],
  // 13. 仙人指路转右中炮
  [
    { fromX: 2, fromY: 6, toX: 2, toY: 5 },
    { fromX: 6, fromY: 3, toX: 6, toY: 4 },
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
  ],
  // 14. 飞相局对左中炮(相三进五)
  [
    { fromX: 6, fromY: 9, toX: 4, toY: 7 },
    { fromX: 1, fromY: 2, toX: 4, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 8, fromY: 9, toX: 7, toY: 9 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
  ],
  // 15. 飞相局对进卒(相三进五)
  [
    { fromX: 6, fromY: 9, toX: 4, toY: 7 },
    { fromX: 6, fromY: 3, toX: 6, toY: 4 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 8, fromY: 9, toX: 7, toY: 9 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
  ],
  // 16. 飞相局对起马(相七进五)
  [
    { fromX: 2, fromY: 9, toX: 4, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
    { fromX: 8, fromY: 9, toX: 7, toY: 9 },
    { fromX: 8, fromY: 0, toX: 7, toY: 0 },
  ],
  // 17. 起马局对挺卒
  [
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 6, fromY: 3, toX: 6, toY: 4 },
    { fromX: 1, fromY: 7, toX: 4, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 0, fromY: 9, toX: 1, toY: 9 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
  ],
  // 18. 起马局对进炮
  [
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 2, toX: 5, toY: 2 },
    { fromX: 1, fromY: 7, toX: 4, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 0, fromY: 9, toX: 1, toY: 9 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
  ],
  // 19. 过宫炮对起马(炮二平六)
  [
    { fromX: 7, fromY: 7, toX: 3, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
    { fromX: 8, fromY: 9, toX: 7, toY: 9 },
    { fromX: 8, fromY: 0, toX: 7, toY: 0 },
  ],
  // 20. 过宫炮对进卒
  [
    { fromX: 7, fromY: 7, toX: 3, toY: 7 },
    { fromX: 6, fromY: 3, toX: 6, toY: 4 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 8, fromY: 9, toX: 7, toY: 9 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
  ],
  // 21. 仕角炮对起马(炮二平四)
  [
    { fromX: 7, fromY: 7, toX: 5, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 0, fromY: 0, toX: 1, toY: 0 },
    { fromX: 0, fromY: 9, toX: 0, toY: 8 },
    { fromX: 8, fromY: 0, toX: 7, toY: 0 },
  ],
  // 22. 中炮七路马横车对屏风马进 7 卒
  [
    { fromX: 7, fromY: 7, toX: 4, toY: 7 },
    { fromX: 6, fromY: 3, toX: 6, toY: 4 },
    { fromX: 7, fromY: 9, toX: 6, toY: 7 },
    { fromX: 1, fromY: 0, toX: 2, toY: 2 },
    { fromX: 1, fromY: 9, toX: 2, toY: 7 },
    { fromX: 7, fromY: 0, toX: 6, toY: 2 },
    { fromX: 8, fromY: 9, toX: 8, toY: 8 },
    { fromX: 0, fromY: 0, toX: 0, toY: 1 },
  ],
];

function getOpeningBookMove(legalMoves, moveHistory) {
  if (!moveHistory || moveHistory.length >= OPENING_BOOK_MAX_PLIES) return null;

  for (const line of OPENING_BOOK_LINES) {
    if (line.length <= moveHistory.length) continue;

    let prefixMatches = true;
    for (let i = 0; i < moveHistory.length; i += 1) {
      const played = moveHistory[i];
      const expected = line[i];
      if (
        played.fromX !== expected.fromX
        || played.fromY !== expected.fromY
        || played.toX !== expected.toX
        || played.toY !== expected.toY
      ) {
        prefixMatches = false;
        break;
      }
    }

    if (!prefixMatches) continue;

    const next = line[moveHistory.length];
    const match = legalMoves.find(
      (m) => m.fromX === next.fromX
        && m.fromY === next.fromY
        && m.toX === next.toX
        && m.toY === next.toY,
    );
    if (match) return match;
  }

  return null;
}

function allocateTimeFactor(board, side, moveCount) {
  // 走法数少 = 残局/受困,精确求解更有价值;走法数多 = 开局/复杂,TT 命中率高、深度本就上不去。
  let factor;
  if (moveCount <= 8) factor = 1.6;
  else if (moveCount <= 15) factor = 1.3;
  else if (moveCount <= 25) factor = 1.0;
  else factor = 0.85;
  const material = livePieces(board)
    .filter((piece) => piece.side === side)
    .reduce((sum, piece) => sum + PIECE_VALUE[piece.type], 0);
  if (material > 0 && material < TIME_ENDGAME_MATERIAL) factor *= 1.2;
  return factor;
}

// 纯函数版 AI 搜索:接受 state 引用,返回选定的走法。
// 抽出的目的:为 Web Worker 化做准备(worker 无法访问全局 state,需显式传入)。
// 注意:内部辅助函数(capturedValue/positionRepetitionCount/rootCyclePenalty)目前
// 仍依赖全局 state,后续子任务会进一步参数化以完成 worker 解耦。
function runAISearch(s) {
  const moves = allLegalMoves(s.board, s.currentSide);
  if (!moves.length) return null;
  if (s.aiDifficulty !== "easy") {
    const bookMove = getOpeningBookMove(moves, s.moveHistory);
    if (bookMove) return bookMove;
  }
  if (s.aiDifficulty === "easy") return pickEasyMove(moves, s.board, s.currentSide);
  const rootCycleOpts = { currentState: s, snapshots: s.snapshots, moveHistory: s.moveHistory };
  const rootMoves = preferNonRepeatingMoves(s.board, moves, s.currentSide, rootCycleOpts);
  const startTime = performance.now();
  const baseBudget = TIME_BUDGET_MS[s.aiDifficulty] || TIME_BUDGET_MS.normal;
  const factor = s.aiDifficulty === "hard"
    ? allocateTimeFactor(s.board, s.currentSide, rootMoves.length)
    : 1;
  let deadline = startTime + Math.min(baseBudget * factor, TIME_HARD_CAP_MS);
  let maxDepth = SEARCH_DEPTH[s.aiDifficulty] || SEARCH_DEPTH.normal;
  const tt = createTranspositionTable();
  const killers = createKillerTable();
  const history = createHistoryTable();
  let best = orderMoves(s.board, rootMoves, s.currentSide, s.currentSide)[0];

  const scoreHistory = [];
  let stableRun = 0;
  let extended = 0;
  let prevBestScore = null;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    // Aspiration window:depth >= MIN 时,以前一深度 bestScore 为中心窄窗口搜索;
    // fail-high/fail-low 时用全窗口 re-search。窗口窄 → cutoff 触发率更高 → root 更快收敛。
    let alpha;
    let beta;
    if (depth >= ASPIRATION_MIN_DEPTH && prevBestScore !== null) {
      alpha = prevBestScore - ASPIRATION_WINDOW;
      beta = prevBestScore + ASPIRATION_WINDOW;
    } else {
      alpha = -Infinity;
      beta = Infinity;
    }

    let result = searchRootAtDepth(
      s, rootMoves, depth, best, alpha, beta,
      deadline, tt, killers, history, rootCycleOpts,
    );

    // Fail-high/fail-low:aspiration 落窗 → 用全窗口 re-search 拿到真实分数与最佳走法。
    // 超时时不 re-search(避免二次超时);只要 result 不超时且落窗,就重做一次。
    if (
      !result.timedOut
      && (result.bestScore <= alpha || result.bestScore >= beta)
    ) {
      const reSearch = searchRootAtDepth(
        s, rootMoves, depth, result.bestMove, -Infinity, Infinity,
        deadline, tt, killers, history, rootCycleOpts,
      );
      if (!reSearch.timedOut) result = reSearch;
    }

    if (performance.now() > deadline) break;
    if (result.timedOut && depth > 1) break; // 超时且 depth>1 → 沿用上一深度的 best
    if (!result.bestMove) break;

    best = result.bestMove;
    prevBestScore = result.bestScore;

    // === 时间管理:仅 hard 启用 ===
    if (s.aiDifficulty === "hard") {
      const prevScore = scoreHistory.length ? scoreHistory[scoreHistory.length - 1] : undefined;
      scoreHistory.push(result.bestScore);
      if (prevScore !== undefined) {
        if (Math.abs(prevScore - result.bestScore) < TIME_STABLE_WINDOW) {
          stableRun += 1;
          // 连续 N 个深度评分稳定 + 已达合理深度 → 提前停(节省时间给后续回合)
          if (stableRun >= TIME_STABLE_RUN
            && depth >= TIME_STABLE_MIN_DEPTH
            && depth >= maxDepth - 1) {
            break;
          }
        } else {
          stableRun = 0;
          // 关键局面:最后深度评分剧烈改进 + 时间还够 → 延伸 1 ply
          if (depth === maxDepth
            && Math.abs(prevScore - result.bestScore) > TIME_EXTEND_IMPROVEMENT
            && extended < TIME_MAX_EXTRA_DEPTH
            && performance.now() - startTime < baseBudget * 0.6) {
            maxDepth += 1;
            extended += 1;
            deadline = Math.min(deadline + baseBudget * 0.5, startTime + TIME_HARD_CAP_MS);
          }
        }
      }
    }
  }
  return best || moves[0];
}

// Root PVS + Aspiration:在指定窗口内搜索 root 的最佳走法。
// 首走法(走法排序后,通常是上一深度的 best)用 full window,其余走法用 zero-window
// (-alpha-1, -alpha) 试探;zero-window 落在 (alpha, beta) 之间则用 full window re-search。
// 返回 {bestMove, bestScore, timedOut}。superRootAspiration 由调用方处理 fail-high/low。
function searchRootAtDepth(s, rootMoves, depth, prevBest, alpha, beta,
  deadline, tt, killers, history, rootCycleOpts) {
  const ordered = orderMoves(s.board, rootMoves, s.currentSide, s.currentSide, prevBest);
  if (!ordered.length) return { bestMove: null, bestScore: -Infinity, timedOut: true };

  let bestMove = ordered[0];
  let bestScore = -Infinity;
  let alphaLocal = alpha;
  let timedOut = false;

  for (let i = 0; i < ordered.length; i += 1) {
    const move = ordered[i];
    if (performance.now() > deadline) {
      timedOut = true;
      break;
    }
    const childBoard = applyMoveToBoard(s.board, move);
    const penalty = rootCyclePenalty(s.board, move, s.currentSide, rootCycleOpts);
    let score;
    if (i === 0) {
      // 首走法:full window
      score = -negamax(
        childBoard, opposite(s.currentSide), depth - 1, -beta, -alphaLocal,
        s.currentSide, tt, deadline, 1, killers, history,
      ) - penalty;
    } else {
      // 其余走法:zero-window probe
      score = -negamax(
        childBoard, opposite(s.currentSide), depth - 1, -alphaLocal - 1, -alphaLocal,
        s.currentSide, tt, deadline, 1, killers, history,
      ) - penalty;
      // zero-window 失败 → 落在 (alpha, beta) 之间 → full window re-search
      if (score > alphaLocal && score < beta) {
        score = -negamax(
          childBoard, opposite(s.currentSide), depth - 1, -beta, -alphaLocal,
          s.currentSide, tt, deadline, 1, killers, history,
        ) - penalty;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    alphaLocal = Math.max(alphaLocal, score);
    // Root beta cutoff:对手(模拟 side)宁愿走其他线 → 该走法不必继续展开
    if (alphaLocal >= beta) break;
  }

  return { bestMove, bestScore, timedOut };
}

function pickEasyMove(moves, board = state.board, side = state.currentSide) {
  const candidates = preferNonRepeatingMoves(board, moves, side);
  const captures = candidates.filter((move) => move.capturedPieceId);
  if (captures.length && Math.random() > 0.35) {
    captures.sort((a, b) => capturedValue(b) - capturedValue(a));
    return captures[0];
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// board 默认 state.board,保持向后兼容;worker 端可显式传 ctx.board 解耦
function capturedValue(move, board = state.board) {
  const piece = board.find((p) => p.id === move.capturedPieceId);
  return piece ? PIECE_VALUE[piece.type] : 0;
}

function pieceValueOnBoard(board, pieceId) {
  const piece = board.find((item) => item.id === pieceId);
  return piece ? PIECE_VALUE[piece.type] : 0;
}

function canonicalBoardKey(board) {
  return livePieces(board)
    .map((piece) => `${piece.id}:${piece.x},${piece.y}`)
    .sort()
    .join("|");
}

function positionKey(board, side) {
  return `${side}:${canonicalBoardKey(board)}`;
}

// currentState/snapshots 默认指向 state,保持向后兼容;
// worker 端可显式传 ctx 当前局面与历史快照,与全局 state 解耦
function positionRepetitionCount(board, side, currentState = state, snapshots = currentState.snapshots) {
  const key = positionKey(board, side);
  let count = positionKey(currentState.board, currentState.currentSide) === key ? 1 : 0;
  for (const snapshot of snapshots) {
    if (positionKey(snapshot.board, snapshot.currentSide) === key) count += 1;
  }
  return count;
}

function isDirectReversal(move, previousMove) {
  return Boolean(
    previousMove
      && previousMove.pieceId === move.pieceId
      && previousMove.fromX === move.toX
      && previousMove.fromY === move.toY
      && previousMove.toX === move.fromX
      && previousMove.toY === move.fromY,
  );
}

// opts.currentState / opts.snapshots / opts.moveHistory 默认指向 state,保持向后兼容;
// worker 端可显式传 ctx 完整解耦。
function rootCyclePenalty(board, move, side, opts = {}) {
  const currentState = opts.currentState || state;
  const snapshots = opts.snapshots || currentState.snapshots;
  const moveHistory = opts.moveHistory || currentState.moveHistory;
  const nextBoard = applyMoveToBoard(board, move);
  const repetitions = positionRepetitionCount(nextBoard, opposite(side), currentState, snapshots);
  let penalty = repetitions * REPEATED_POSITION_PENALTY;
  const recentAIMoves = moveHistory.filter((item) => item.byAI).slice(-4);
  if (isDirectReversal(move, recentAIMoves.at(-1))) penalty += DIRECT_REVERSAL_PENALTY;
  for (const recent of recentAIMoves) {
    if (recent.pieceId !== move.pieceId) continue;
    const sameRoute = recent.fromX === move.fromX && recent.fromY === move.fromY && recent.toX === move.toX && recent.toY === move.toY;
    const reverseRoute = isDirectReversal(move, recent);
    if (sameRoute || reverseRoute) penalty += RECENT_ROUTE_PENALTY;
  }
  return penalty;
}

function preferNonRepeatingMoves(board, moves, side, opts = {}) {
  if (moves.length <= 1) return moves;
  const nonRepeating = moves.filter((move) => rootCyclePenalty(board, move, side, opts) < CYCLE_FILTER_PENALTY);
  return nonRepeating.length ? nonRepeating : moves;
}

function moveOrderingScore(board, move, side, aiSide, preferredMove = null, killersAtPly = null, history = null, ttBestMoveKey = null) {
  let score = 0;
  if (preferredMove && move.pieceId === preferredMove.pieceId && move.toX === preferredMove.toX && move.toY === preferredMove.toY) score += 100000;
  if (ttBestMoveKey && killerKey(move) === ttBestMoveKey) score += TT_BONUS;
  if (move.capturedPieceId) {
    const captured = pieceValueOnBoard(board, move.capturedPieceId);
    const attacker = pieceValueOnBoard(board, move.pieceId);
    const base = 50000 + captured * 12 - attacker;
    // 保守集成 SEE:仅对深度亏子(SEE <= -200)的 capture 显著降分到 killer 档,
    // 其他 capture 保留原 MVV-LVA 排序。这样既识别明显送子,又不破坏大多数走法排序。
    const seeValue = see(board, move);
    if (seeValue <= SEE_ORDERING_LOSING_THRESHOLD) {
      score += KILLER_BONUS_SECOND + seeValue * SEE_ORDERING_MULTIPLIER;
    } else {
      score += base;
    }
  } else {
    let matchedKiller = false;
    if (killersAtPly) {
      const key = killerKey(move);
      if (killersAtPly[0] === key) {
        score += KILLER_BONUS_MAIN;
        matchedKiller = true;
      } else if (killersAtPly[1] === key) {
        score += KILLER_BONUS_SECOND;
        matchedKiller = true;
      }
    }
    if (!matchedKiller && history) score += historyOrderingBonus(history, move);
  }
  const next = applyMoveToBoard(board, move);
  if (isInCheck(next, opposite(side))) score += 9000;
  score += Math.max(0, 4 - Math.abs(move.toX - 4)) * 10;
  score += positionalBonus(board.find((piece) => piece.id === move.pieceId), move.toX, move.toY) - positionalBonus(board.find((piece) => piece.id === move.pieceId));
  return score;
}

function orderMoves(board, moves, side, aiSide, preferredMove = null, killersAtPly = null, history = null, ttBestMoveKey = null) {
  return moves
    .map((move) => ({ move, score: moveOrderingScore(board, move, side, aiSide, preferredMove, killersAtPly, history, ttBestMoveKey) }))
    .sort((a, b) => b.score - a.score)
    .map(({ move }) => move);
}

function killerKey(move) {
  return `${move.fromX},${move.fromY}->${move.toX},${move.toY}`;
}

function createKillerTable() {
  const table = new Array(MAX_KILLER_PLY);
  for (let i = 0; i < MAX_KILLER_PLY; i += 1) table[i] = new Array(KILLER_SLOTS).fill(null);
  return table;
}

function storeKiller(killers, ply, move) {
  if (move.capturedPieceId) return;
  if (ply >= killers.length) return;
  const key = killerKey(move);
  const slot = killers[ply];
  if (slot[0] === key) return;
  slot[1] = slot[0];
  slot[0] = key;
}

function squareIndex(x, y) {
  return y * 9 + x;
}

function createHistoryTable() {
  return new Array(HISTORY_BOARD_SQUARES * HISTORY_BOARD_SQUARES).fill(0);
}

function historyOrderingBonus(history, move) {
  if (!history) return 0;
  const from = squareIndex(move.fromX, move.fromY);
  const to = squareIndex(move.toX, move.toY);
  const value = history[from * HISTORY_BOARD_SQUARES + to];
  if (value <= 0) return 0;
  return value >= HISTORY_MAX_BONUS ? HISTORY_MAX_BONUS : value;
}

function storeHistory(history, move, depth) {
  if (!history) return;
  const from = squareIndex(move.fromX, move.fromY);
  const to = squareIndex(move.toX, move.toY);
  const bonus = depth > 0 ? depth * depth : 1;
  const idx = from * HISTORY_BOARD_SQUARES + to;
  let next = history[idx] + bonus;
  if (next > HISTORY_SATURATION_CAP) next = HISTORY_SATURATION_CAP;
  history[idx] = next;
}

function boardKey(board, side, depth) {
  return `${side}:${depth}:${canonicalBoardKey(board)}`;
}

// Zobrist hash:90 方格 × 14 (type, side) 组合 + side-to-move XOR
function computeZobrist(board, side) {
  let hash = 0;
  for (const piece of livePieces(board)) {
    hash ^= ZOBRIST_PIECE_KEYS[piece.side][piece.type][piece.y * 9 + piece.x];
  }
  if (side === SIDES.BLACK) hash ^= ZOBRIST_SIDE_KEY;
  return hash >>> 0;
}

function createTranspositionTable() {
  return new Map();
}

// probe:命中且深度足够 → 直接返回 score 字符串;否则返回 entry 本身(供 bestMove 排序用)
// 返回值:数字 score 表示可直接用,null 表示无可用条目,object 表示有条元数据但 score 不可用
function ttProbe(tt, hash, depth, alpha, beta) {
  const entry = tt.get(hash);
  if (!entry) return null;
  if (entry.depth >= depth) {
    if (entry.flag === TT_FLAG_EXACT) return entry.score;
    if (entry.flag === TT_FLAG_LOWER && entry.score >= beta) return entry.score;
    if (entry.flag === TT_FLAG_UPPER && entry.score <= alpha) return entry.score;
  }
  return entry;
}

// store:已有更深条目则保留(避免被浅搜索覆盖),否则替换
function ttStore(tt, hash, depth, score, flag, bestMoveKey) {
  const existing = tt.get(hash);
  if (existing && existing.depth > depth) return;
  if (tt.size >= TT_MAX_ENTRIES) tt.clear();
  tt.set(hash, { depth, score, flag, bestMoveKey });
}

function negamax(board, side, depth, alpha, beta, aiSide, tt = null, deadline = Infinity, ply = 0, killers = null, history = null, allowNull = true, extensionsInLine = 0) {
  if (performance.now() > deadline) return evaluateBoard(board, aiSide) * (side === aiSide ? 1 : -1);
  const inCheck = isInCheck(board, side);
  const hash = tt ? computeZobrist(board, side) : 0;
  const origAlpha = alpha;
  let ttBestMoveKey = null;
  if (tt) {
    const probed = ttProbe(tt, hash, depth, alpha, beta);
    if (typeof probed === "number") return probed;
    if (probed) ttBestMoveKey = probed.bestMoveKey;
  }
  if (depth === 0) {
    const moves = allLegalMoves(board, side);
    if (moves.length === 0) {
      return inCheck ? -MATE_SCORE - depth : -8000;
    }
    return quiescence(board, side, alpha, beta, aiSide, QUIESCENCE_DEPTH, deadline, moves);
  }
  if (allowNull && depth >= NULL_MOVE_MIN_DEPTH && !inCheck && beta < Infinity && beta > -Infinity) {
    const nullScore = -negamax(board, opposite(side), depth - 1 - NULL_MOVE_REDUCTION, -beta, -beta + 1, aiSide, tt, deadline, ply + 1, killers, history, false);
    if (nullScore >= beta) {
      if (tt) ttStore(tt, hash, depth, beta, TT_FLAG_LOWER, null);
      return beta;
    }
  }
  const moves = allLegalMoves(board, side);
  if (moves.length === 0) {
    return inCheck ? -MATE_SCORE - depth : -8000;
  }
  let best = -Infinity;
  let bestMove = null;
  let didCut = false;
  const killersAtPly = killers ? killers[Math.min(ply, killers.length - 1)] : null;
  const orderedMoves = orderMoves(board, moves, side, aiSide, null, killersAtPly, history, ttBestMoveKey);
  const canReduce = depth >= LMR_MIN_DEPTH && orderedMoves.length > LMR_FULL_MOVE_COUNT;
  // Principal Variation Search (PVS):首走法(走法排序后,通常是 TT move/killer)用 full window;
  // 其余走法用 zero-window (-alpha-1, -alpha) 试探,如果落在 (alpha, beta) 之间再 re-search with full window。
  // 与 LMR 结合:可被 reduce 的走法先以 reduced depth + zero-window 搜索,改进 alpha 后再以 full depth + zero-window,
  // 仍改进 alpha 则以 full depth + full window 收尾。
  for (let i = 0; i < orderedMoves.length; i += 1) {
    const move = orderedMoves[i];
    let score;
    const isTactical = Boolean(move.capturedPieceId);
    const childBoard = applyMoveToBoard(board, move);
    // Check extension:走法给对手造成将军时,该线深度 +1 ply(每条搜索线最多累加 MAX 次)。
    // 将军回应有限,延伸不会让搜索树爆炸,但能让 AI 多看一步反将陷阱 → 直接服务"完全不送子"。
    // 仅在 depth >= MIN 时做:浅节点 extension 价值低,但每个 move 多一次 isInCheck 调用,
    // 在 hard 深度搜索中会显著拖慢(走法数^depth 次额外 O(N) 调用)。
    const givesCheck = depth >= CHECK_EXTENSION_MIN_DEPTH
      && extensionsInLine < MAX_CHECK_EXTENSIONS_PER_LINE
      && isInCheck(childBoard, opposite(side));
    const extDepth = givesCheck ? depth - 1 + CHECK_EXTENSION_PLY : depth - 1;
    const childExt = givesCheck ? extensionsInLine + 1 : extensionsInLine;
    if (i === 0) {
      score = -negamax(childBoard, opposite(side), extDepth, -beta, -alpha, aiSide, tt, deadline, ply + 1, killers, history, true, childExt);
    } else {
      // 给将军的走法不 LMR(它是战术性强走,降深度会丢失关键变化)
      const canLMR = canReduce && i >= LMR_FULL_MOVE_COUNT && !isTactical && !givesCheck;
      const probeDepth = canLMR ? depth - 1 - LMR_REDUCTION : extDepth;
      score = -negamax(childBoard, opposite(side), probeDepth, -alpha - 1, -alpha, aiSide, tt, deadline, ply + 1, killers, history, true, childExt);
      if (canLMR && score > alpha) {
        score = -negamax(childBoard, opposite(side), extDepth, -alpha - 1, -alpha, aiSide, tt, deadline, ply + 1, killers, history, true, childExt);
      }
      if (score > alpha && score < beta) {
        score = -negamax(childBoard, opposite(side), extDepth, -beta, -alpha, aiSide, tt, deadline, ply + 1, killers, history, true, childExt);
      }
    }
    if (score > best) {
      best = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) {
      if (killers) storeKiller(killers, ply, move);
      if (history && !move.capturedPieceId) storeHistory(history, move, depth);
      if (tt) ttStore(tt, hash, depth, beta, TT_FLAG_LOWER, killerKey(move));
      didCut = true;
      break;
    }
  }
  if (!didCut && tt) {
    const flag = best <= origAlpha ? TT_FLAG_UPPER : TT_FLAG_EXACT;
    ttStore(tt, hash, depth, best, flag, bestMove ? killerKey(bestMove) : null);
  }
  return best;
}

// SEE (Static Exchange Evaluation):对 capture 走法,精确计算 capture sequence 的净交换价值。
// 返回:从 move 的 attacker side 视角的净交换价值。正 = 净赢子,负 = 净亏子,0 = 平衡/非吃子。
// 算法:negamax 形式,双方轮流用最便宜的 attacker 吃 to 上的棋子,每方可选 stop(0) 或 continue。
// 简化:用 pieceAttacksSquare 基于原 board 判断,忽略 attack line 变化(behind-attacker),
// 精度足够识别大多数 losing capture。
function see(board, move) {
  if (!move.capturedPieceId) return 0;
  const target = board.find((p) => p.alive && p.id === move.capturedPieceId);
  if (!target) return 0;
  const attacker = board.find((p) => p.alive && p.id === move.pieceId);
  if (!attacker) return 0;

  const attackerSide = attacker.side;
  const { toX, toY } = move;
  // attacker 已走 move 到 to,从原位置移除(用 removed 集合标记,避免 pieceAttacksSquare 误判)。
  const removed = new Set([target.id, attacker.id]);

  const findCheapestAttacker = (side) => {
    let cheapest = null;
    for (const piece of livePieces(board)) {
      if (piece.side !== side) continue;
      if (removed.has(piece.id)) continue;
      // GENERAL 不参与 capture sequence(飞将规则只对吃对方将生效,
      // SEE 中忽略以避免 flyingGeneral 误判 + 提升性能)
      if (piece.type === TYPES.GENERAL) continue;
      if (!pieceAttacksSquare(board, piece, toX, toY)) continue;
      if (!cheapest || PIECE_VALUE[piece.type] < PIECE_VALUE[cheapest.type]) {
        cheapest = piece;
      }
    }
    return cheapest;
  };

  // negamax:从 side 视角,side 选 max(0, captured_value - opponent_best)
  // currentOccupierValue:to 上当前占据者的价值(side 决定是否吃它)
  const seeRec = (side, currentOccupierValue, depthLeft) => {
    if (depthLeft <= 0) return 0;
    const cheapest = findCheapestAttacker(side);
    if (!cheapest) return 0;
    removed.add(cheapest.id);
    const next = currentOccupierValue - seeRec(opposite(side), PIECE_VALUE[cheapest.type], depthLeft - 1);
    removed.delete(cheapest.id);
    return Math.max(0, next);
  };

  return PIECE_VALUE[target.type] - seeRec(opposite(attackerSide), PIECE_VALUE[attacker.type], SEE_MAX_DEPTH);
}

function quiescence(board, side, alpha, beta, aiSide, depth, deadline, legalMoves = null) {
  const inCheck = isInCheck(board, side);
  const standPat = evaluateBoard(board, aiSide) * (side === aiSide ? 1 : -1);
  if (depth === 0 || performance.now() > deadline) return standPat;
  if (!inCheck) {
    if (standPat >= beta) return beta;
    alpha = Math.max(alpha, standPat);
  }
  const moves = legalMoves || allLegalMoves(board, side);
  if (!moves.length) return inCheck ? -MATE_SCORE - depth : -8000;
  const tacticalMoves = orderMoves(
    board,
    inCheck
      ? moves
      : moves.filter((move) => move.capturedPieceId),
    side,
    aiSide,
  );
  for (const move of tacticalMoves) {
    const score = -quiescence(applyMoveToBoard(board, move), opposite(side), -beta, -alpha, aiSide, depth - 1, deadline);
    if (score >= beta) return beta;
    alpha = Math.max(alpha, score);
  }
  return alpha;
}

function evaluateBoard(board, aiSide) {
  let score = 0;
  const controlMaps = buildControlMaps(board);
  const endgame = isEndgame(board);
  // 按方统计车马炮存活数,用于成对组合加分
  const attackerCount = {
    [SIDES.RED]: { chariot: 0, cannon: 0, horse: 0 },
    [SIDES.BLACK]: { chariot: 0, cannon: 0, horse: 0 },
  };
  for (const piece of livePieces(board)) {
    if (attackerCount[piece.side] && piece.type in attackerCount[piece.side]) {
      attackerCount[piece.side][piece.type] += 1;
    }
  }
  for (const piece of livePieces(board)) {
    const direction = piece.side === aiSide ? 1 : -1;
    let value = PIECE_VALUE[piece.type];
    value += positionalBonus(piece);
    value += rawMovesForPiece(board, piece).length * (MOBILITY_VALUE[piece.type] || 0);
    const square = piece.y * 9 + piece.x;
    if (controlMaps[opposite(piece.side)].has(square)) value -= Math.min(140, value * 0.12);
    if (controlMaps[piece.side].has(square)) value += Math.min(70, value * 0.05);
    // 攻击区(过河)车马炮加分
    const zoneBonus = ATTACK_ZONE_BONUS[piece.type];
    if (zoneBonus && crossedRiver(piece.side, piece.y)) {
      value += endgame ? zoneBonus * ENDGAME_ATTACKER_ZONE_MULTIPLIER : zoneBonus;
    }
    // 残局:过河兵按推进深度加分(越靠近对方底线越值钱)
    if (endgame && piece.type === TYPES.SOLDIER) {
      value += endgameSoldierBonus(piece);
    }
    // 残局:士象价值缩水
    if (endgame && (piece.type === TYPES.ADVISOR || piece.type === TYPES.ELEPHANT)) {
      value -= ENDGAME_DEFENDER_PENALTY;
    }
    // 成对组合加分:同方同类型存活数达到阈值时,该类棋子每个加 PAIR_BONUS
    const pairBonusTable = PAIR_BONUS[piece.type];
    if (pairBonusTable) {
      const count = attackerCount[piece.side][piece.type];
      // 取该 count 对应的最大档位(>=2)
      const tier = count >= 2 ? 2 : 0;
      if (tier) value += pairBonusTable[tier] || 0;
    }
    score += direction * value;
  }
  if (isInCheck(board, opposite(aiSide))) score += endgame ? 120 + ENDGAME_CHECK_BONUS : 120;
  if (isInCheck(board, aiSide)) score -= endgame ? 160 + ENDGAME_CHECK_BONUS : 160;
  // 王的安全(士象守卫 + 出宫惩罚 + 敌方近距离车炮威胁)
  score += kingSafetyScore(board, aiSide);
  score -= kingSafetyScore(board, opposite(aiSide));
  return score;
}

// 残局阶段判定:每方非将子力 <= ENDGAME_MATERIAL_THRESHOLD 时为残局
function isEndgame(board) {
  let red = 0;
  let black = 0;
  for (const piece of livePieces(board)) {
    if (piece.type === TYPES.GENERAL) continue;
    if (piece.side === SIDES.RED) red += PIECE_VALUE[piece.type];
    else black += PIECE_VALUE[piece.type];
  }
  return red <= ENDGAME_MATERIAL_THRESHOLD && black <= ENDGAME_MATERIAL_THRESHOLD;
}

// 残局兵推进加分:过河兵越靠近对方底线越值钱
// 红方过河 y∈[0,4],推进深度 = 4 - y(0..4);黑方过河 y∈[5,9],推进深度 = y - 5(0..4)
function endgameSoldierBonus(piece) {
  if (!crossedRiver(piece.side, piece.y)) return 0;
  const progress = piece.side === SIDES.RED ? 4 - piece.y : piece.y - 5;
  return progress * ENDGAME_SOLDIER_ADVANCE_BONUS;
}

// 王的安全评估:负数表示该方王处于风险,正数表示防守稳固。
function kingSafetyScore(board, side) {
  const general = board.find((p) => p.alive && p.side === side && p.type === TYPES.GENERAL);
  if (!general) return 0;
  let score = 0;
  // 士象守卫
  const advisors = board.filter((p) => p.alive && p.type === TYPES.ADVISOR && p.side === side).length;
  const elephants = board.filter((p) => p.alive && p.type === TYPES.ELEPHANT && p.side === side).length;
  if (advisors === 2) score += KING_SAFETY.fullAdvisorPair;
  if (elephants === 2) score += KING_SAFETY.fullElephantPair;
  if (advisors === 2 && elephants === 2) score += KING_SAFETY.completeWall;
  // 王出宫 / 过河惩罚
  if (!palaceContains(side, general.x, general.y)) score -= KING_SAFETY.generalOutOfPalace;
  if (crossedRiver(side, general.y)) score -= KING_SAFETY.generalCrossedRiver;
  // 敌方车/炮对王的近距离威胁(同行/列,半威胁:下一手可能形成将军)
  for (const enemy of livePieces(board)) {
    if (enemy.side === side) continue;
    if (enemy.type !== TYPES.CHARIOT && enemy.type !== TYPES.CANNON) continue;
    const dx = Math.abs(enemy.x - general.x);
    const dy = Math.abs(enemy.y - general.y);
    if (dx !== 0 && dy !== 0) continue;
    const dist = dx + dy;
    if (enemy.type === TYPES.CHARIOT) {
      if (dist > 0 && dist <= 3) score -= KING_SAFETY.chariotPressure;
    } else {
      // 炮:距离 2-4(距离 1 是贴身无架、距离 2-4 是常见有架位)
      if (dist >= 2 && dist <= 4) score -= KING_SAFETY.cannonPressure;
    }
  }
  return score;
}

function positionalBonus(piece, x = piece?.x, y = piece?.y) {
  if (!piece) return 0;
  const table = POSITION_BONUS[piece.type];
  let bonus;
  if (table) {
    const row = piece.side === SIDES.RED ? y : 9 - y;
    bonus = table[row]?.[x] || 0;
  } else {
    const center = Math.max(0, 4 - Math.abs(x - 4)) * 4;
    const palace = palaceContains(piece.side, x, y) ? 8 : 0;
    bonus = center + palace;
  }
  // 过河兵额外加分:过河后可左右走 + 向前,威胁大幅增加
  if (piece.type === TYPES.SOLDIER && crossedRiver(piece.side, y)) {
    bonus += 30;
  }
  return bonus;
}

function buildControlMaps(board) {
  const maps = {
    [SIDES.RED]: new Set(),
    [SIDES.BLACK]: new Set(),
  };
  for (const piece of livePieces(board)) {
    for (const move of rawMovesForPiece(board, piece, true, true)) {
      maps[piece.side].add(move.toY * 9 + move.toX);
    }
  }
  return maps;
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}
