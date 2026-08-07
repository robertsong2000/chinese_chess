// AI Web Worker(骨架 + 接口契约,2026-08-08)
//
// 目的:把 AI 搜索(negamax / quiescence / 评估 / 走法生成 / 开局库 / TT / killers / history)
// 全部移到 worker 线程,主线程不卡,hard 模式搜索深度可从 4 提到 6-7。
//
// 状态:本次提交仅落骨架 + 接口契约 + 边界检查,搜索核心尚未搬运。
// 后续子任务(见 .dev-state.json TODO #25)需要:
//   1. 把 app.js 中以下函数及其依赖(纯函数 / 已通过参数传入 board / side)抽出到本文件:
//      - runAISearch(s)
//      - negamax / quiescence / orderMoves / evaluateBoard / isInCheck
//      - allLegalMoves / applyMoveToBoard / opposite / livePieces
//      - getOpeningBookMove / OPENING_BOOK
//      - createTranspositionTable / computeZobrist / ttProbe / ttStore
//      - createKillerTable / storeKiller / createHistoryTable / storeHistory
//      - allocateTimeFactor / preferNonRepeatingMoves / rootCyclePenalty
//        (后两者需参数化 state 依赖)
//      - 常量:SIDES / PIECE_VALUE / TIME_BUDGET_MS / SEARCH_DEPTH / LMR_* / NULL_MOVE_* 等
//   2. 在主线程 app.js:
//      - scheduleAI 调用 createAIWorker() 取得实例(浏览器环境)
//      - 浏览器路径:postMessage(ctx) → await message → executeMove
//      - node vm 测试环境无 Worker,继续走同步 chooseAIMove() 路径(保持 8 个测试通过)
//
// === Worker 输入(主线程 → worker)===
// postMessage({
//   type: "search",
//   ctx: {
//     board: [...],            // 深拷贝的 state.board
//     currentSide: "red"|"black",
//     aiDifficulty: "easy"|"normal"|"hard",
//     moveHistory: [...],      // 深拷贝
//     snapshots: [...],        // 深拷贝,用于位置重复检测
//   }
// })
//
// === Worker 输出(worker → 主线程)===
// 启动时:
//   postMessage({ type: "ready" })
// 搜索完成:
//   postMessage({
//     type: "result",
//     move: { pieceId, fromX, fromY, toX, toY, capturedPieceId? } | null,
//     stats: { durationMs, maxDepthReached, ttHits }
//   })
// 错误:
//   postMessage({ type: "error", error: "..." })

const WORKER_TAG = "ai-worker";

function postSafe(message) {
  if (typeof self !== "undefined" && typeof self.postMessage === "function") {
    self.postMessage(message);
  }
}

function isValidContext(ctx) {
  if (!ctx || typeof ctx !== "object") return false;
  if (!Array.isArray(ctx.board)) return false;
  if (ctx.currentSide !== "red" && ctx.currentSide !== "black") return false;
  if (ctx.aiDifficulty !== "easy" && ctx.aiDifficulty !== "normal" && ctx.aiDifficulty !== "hard") {
    return false;
  }
  return true;
}

self.onmessage = (event) => {
  const data = event && event.data;
  if (!data || typeof data !== "object") {
    postSafe({ type: "error", error: "invalid message", tag: WORKER_TAG });
    return;
  }
  const { type, ctx } = data;
  if (type === "ping") {
    postSafe({ type: "pong", tag: WORKER_TAG });
    return;
  }
  if (type !== "search") {
    postSafe({ type: "error", error: `unsupported type: ${type}`, tag: WORKER_TAG });
    return;
  }
  if (!isValidContext(ctx)) {
    postSafe({ type: "error", error: "invalid ctx", tag: WORKER_TAG });
    return;
  }
  // TODO(下次子任务 C):调用搬到 worker 的 runAISearch(ctx) 并返回走法
  postSafe({
    type: "result",
    move: null,
    stats: { durationMs: 0, maxDepthReached: 0, ttHits: 0, implemented: false },
  });
};

// 启动信号:主线程可据此知道 worker 已就绪
postSafe({ type: "ready", tag: WORKER_TAG });
