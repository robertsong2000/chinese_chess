// AI Web Worker(骨架,2026-08-08)
//
// 目的:把 AI 搜索(negamax / quiescence / 评估 / 走法生成 / 开局库 / TT / killers / history)
// 全部移到 worker 线程,主线程不卡,hard 模式搜索深度可从 4 提到 6-7。
//
// 状态:本次提交仅落骨架 + 接口契约,搜索核心尚未搬运。
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
//      - 检测 `typeof Worker !== "undefined"` (浏览器环境)
//      - 创建 worker: new Worker("ai-worker.js")
//      - scheduleAI 改成异步:postMessage(ctx) → 等待 message → executeMove
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
// postMessage({
//   type: "result",
//   move: { pieceId, fromX, fromY, toX, toY, capturedPieceId? } | null,
//   stats: { durationMs, maxDepthReached, ttHits }
// })

self.onmessage = (event) => {
  const { type, ctx } = event.data || {};
  if (type !== "search" || !ctx) {
    self.postMessage({ type: "error", error: "invalid message" });
    return;
  }
  // TODO(下次子任务):调用搬到 worker 的 runAISearch(ctx) 并返回走法
  self.postMessage({
    type: "result",
    move: null,
    stats: { durationMs: 0, maxDepthReached: 0, ttHits: 0, implemented: false },
  });
};
