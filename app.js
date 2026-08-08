// 全局常量(SIDES / TYPES / PIECE_VALUE / POSITION_BONUS / 各类搜索与评估参数等)
// 已抽出到 src/constants.js,由 index.html 在本文件之前加载,
// 由 tests/engine-harness.js 在 vm.runInContext 之前注入。
// 二者共享同一全局词法环境,故本文件可直接引用这些 const 标识符。

const els = {
  board: document.querySelector("#board"),
  gameStatus: document.querySelector("#gameStatus"),
  playerSideText: document.querySelector("#playerSideText"),
  aiSideText: document.querySelector("#aiSideText"),
  turnText: document.querySelector("#turnText"),
  difficultyText: document.querySelector("#difficultyText"),
  message: document.querySelector("#message"),
  moveList: document.querySelector("#moveList"),
  moveCount: document.querySelector("#moveCount"),
  pieceHelp: document.querySelector("#pieceHelp"),
  timer: document.querySelector("#timer"),
  capturedByRed: document.querySelector("#capturedByRed"),
  capturedByBlack: document.querySelector("#capturedByBlack"),
  resultDialog: document.querySelector("#resultDialog"),
  resultTitle: document.querySelector("#resultTitle"),
  resultSummary: document.querySelector("#resultSummary"),
};

const buttons = {
  start: document.querySelector("#startBtn"),
  newGame: document.querySelector("#newGameBtn"),
  hint: document.querySelector("#hintBtn"),
  hintMobile: document.querySelector("#hintBtnMobile"),
  undo: document.querySelector("#undoBtn"),
  undoMobile: document.querySelector("#undoBtnMobile"),
  resign: document.querySelector("#resignBtn"),
  resignMobile: document.querySelector("#resignBtnMobile"),
  export: document.querySelector("#exportBtn"),
  closeResult: document.querySelector("#closeResultBtn"),
  again: document.querySelector("#againBtn"),
  soundToggle: document.querySelector("#soundToggle"),
  themeToggle: document.querySelector("#themeToggle"),
};

let settings = { playerSide: SIDES.RED, difficulty: "normal", sound: true, darkBoard: false };
let state = createGame(settings.playerSide, settings.difficulty);
let selectedId = null;
let legalTargets = [];
let hintMove = null;
let aiTimer = null;
let clockTimer = null;
let dragState = null;

function createGame(playerSide, difficulty) {
  const now = Date.now();
  return {
    id: `game-${now}`,
    status: "preparing",
    currentSide: SIDES.RED,
    playerSide,
    aiDifficulty: difficulty,
    board: initialPieces(),
    moveHistory: [],
    capturedPieces: [],
    result: null,
    snapshots: [],
    createdAt: now,
    updatedAt: now,
    lastMove: null,
    thinking: false,
  };
}

function initialPieces() {
  const pieces = [];
  const add = (side, type, x, y, index = 0) => {
    pieces.push({
      id: `${side}-${type}-${x}-${y}-${index}`,
      side,
      type,
      label: LABELS[side][type],
      x,
      y,
      alive: true,
    });
  };

  [SIDES.BLACK, SIDES.RED].forEach((side) => {
    const y = side === SIDES.BLACK ? 0 : 9;
    const cannonY = side === SIDES.BLACK ? 2 : 7;
    const soldierY = side === SIDES.BLACK ? 3 : 6;
    add(side, TYPES.CHARIOT, 0, y, 1);
    add(side, TYPES.HORSE, 1, y, 1);
    add(side, TYPES.ELEPHANT, 2, y, 1);
    add(side, TYPES.ADVISOR, 3, y, 1);
    add(side, TYPES.GENERAL, 4, y);
    add(side, TYPES.ADVISOR, 5, y, 2);
    add(side, TYPES.ELEPHANT, 6, y, 2);
    add(side, TYPES.HORSE, 7, y, 2);
    add(side, TYPES.CHARIOT, 8, y, 2);
    add(side, TYPES.CANNON, 1, cannonY, 1);
    add(side, TYPES.CANNON, 7, cannonY, 2);
    [0, 2, 4, 6, 8].forEach((x, i) => add(side, TYPES.SOLDIER, x, soldierY, i + 1));
  });

  return pieces;
}

// 棋规函数(livePieces / boardIndex / pieceAt / inBoard / opposite / sideName /
// palaceContains / crossedRiver / rawMovesForPiece / makeCandidate / countBetween /
// countLineBetween / generalsFacing / cloneBoard / applyMoveToBoard / isInCheck /
// pieceAttacksSquare / legalMovesForPiece / allLegalMoves)已抽出到 src/rules.js,
// 由 index.html 在本文件之前加载,由 tests/engine-harness.js 在 vm.runInContext
// 之前注入。共享全局词法环境,故本文件可直接引用这些函数。

function isPlayerTurn() {
  return state.status === "playing" && state.currentSide === state.playerSide && !state.thinking;
}

function moveNotation(move, boardBefore, isCheck) {
  const piece = boardBefore.find((p) => p.id === move.pieceId);
  const captured = move.capturedPieceId ? boardBefore.find((p) => p.id === move.capturedPieceId) : null;
  const action = captured ? `吃${captured.label}` : "至";
  const check = isCheck ? " 将军" : "";
  return `${sideName(move.side)} ${piece.label}${coord(move.fromX, move.fromY)} ${action} ${coord(move.toX, move.toY)}${check}`;
}

function coord(x, y) {
  return `${x + 1}路${y + 1}线`;
}

function executeMove(move, byAI = false) {
  if (state.status !== "playing") return false;
  const legal = allLegalMoves(state.board, state.currentSide).find(
    (item) => item.pieceId === move.pieceId && item.toX === move.toX && item.toY === move.toY,
  );
  if (!legal) {
    showMessage("这步不合法，可能会导致被将军或将帅照面。");
    beep("error");
    return false;
  }

  const boardBefore = cloneBoard(state.board);
  const snapshot = {
    board: cloneBoard(state.board),
    capturedPieces: state.capturedPieces.map((p) => ({ ...p })),
    moveHistory: state.moveHistory.map((m) => ({ ...m })),
    currentSide: state.currentSide,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
  };

  const captured = legal.capturedPieceId ? state.board.find((p) => p.id === legal.capturedPieceId) : null;
  state.board = applyMoveToBoard(state.board, legal);
  if (captured) state.capturedPieces.push({ ...captured, capturedBy: legal.side, moveIndex: state.moveHistory.length + 1 });

  const nextSide = opposite(state.currentSide);
  const isCheck = isInCheck(state.board, nextSide);
  const fullMove = {
    ...legal,
    id: `move-${Date.now()}-${state.moveHistory.length}`,
    turnNumber: Math.floor(state.moveHistory.length / 2) + 1,
    isCheck,
    notation: moveNotation(legal, boardBefore, isCheck),
    createdAt: Date.now(),
    byAI,
  };
  state.snapshots.push(snapshot);
  state.moveHistory.push(fullMove);
  state.currentSide = nextSide;
  state.lastMove = fullMove;
  state.updatedAt = Date.now();
  selectedId = null;
  legalTargets = [];
  hintMove = null;

  if (positionRepetitionCount(state.board, state.currentSide) >= 3) {
    finishGame(null, "draw");
    return true;
  }

  const outcome = evaluateGameEnd();
  if (!outcome) showMessage(isCheck ? `${sideName(nextSide)}被将军。` : `${sideName(state.currentSide)}行棋。`);
  beep(captured ? "capture" : isCheck ? "check" : "move");
  saveGame();
  render();

  if (!outcome && state.currentSide !== state.playerSide) scheduleAI();
  return true;
}

function evaluateGameEnd() {
  const moves = allLegalMoves(state.board, state.currentSide);
  if (moves.length > 0) return null;
  const checked = isInCheck(state.board, state.currentSide);
  finishGame(opposite(state.currentSide), checked ? "checkmate" : "stalemate");
  return state.result;
}

function finishGame(winner, reason) {
  state.status = "finished";
  state.thinking = false;
  const reasons = {
    checkmate: "将死",
    stalemate: "困毙",
    resign: "认输",
    draw: "和棋",
  };
  const summary = reason === "draw" ? "双方和棋，原因：重复局面。" : `${sideName(winner)}获胜，原因：${reasons[reason] || reason}。`;
  state.result = {
    winner,
    reason,
    durationSeconds: Math.floor((Date.now() - state.createdAt) / 1000),
    summary,
  };
  showMessage(summary);
  saveGame();
  render();
  openResult(summary);
  beep("finish");
}

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

// 选择 AI 走法:主线程入口。当前同步实现;后续 Web Worker 化时,
// 此函数将转发到 runAISearch(state),worker 路径会通过 postMessage 序列化 state。
function chooseAIMove() {
  return runAISearch(state);
}

// Worker 工厂:在浏览器环境返回 Worker 实例,node/无 Worker 环境返回 null。
// 当前 AI_WORKER_ENABLED = false,scheduleAI 仍走同步 chooseAIMove 路径。
// 子任务 C 会把它打通:浏览器打开此开关 → 异步等待 worker 返回走法 → executeMove。
let AI_WORKER_ENABLED = false;
const AI_WORKER_URL = "ai-worker.js";

function createAIWorker() {
  if (!AI_WORKER_ENABLED) return null;
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(AI_WORKER_URL);
  } catch (err) {
    console.warn("createAIWorker failed, fallback to sync:", err);
    return null;
  }
}

// 异步版 AI 走法选择:浏览器若启用 Worker,走 worker-first-then-sync-fallback 路径;
// node/无 Worker 环境直接同步 callback(chooseAIMove())。
// 子任务 C-min:链路打通 + 安全 fallback。worker 端真正搜索逻辑在子任务 B-full 落地,
// 在那之前 worker 会返回 move=null,触发此处 fallback 到同步搜索,行为完全不变。
function chooseAIMoveAsync(s, callback) {
  const worker = createAIWorker();
  if (!worker) {
    callback(chooseAIMove());
    return;
  }
  const budget = TIME_BUDGET_MS[s.aiDifficulty] || TIME_BUDGET_MS.normal;
  const fallbackGuardMs = budget + 1500;
  let settled = false;
  const finish = (move) => {
    if (settled) return;
    settled = true;
    try { worker.terminate(); } catch (_) { /* ignore */ }
    callback(move);
  };
  const safetyTimer = setTimeout(() => {
    console.warn("AI worker timeout, fallback to sync");
    finish(chooseAIMove());
  }, fallbackGuardMs);
  worker.onmessage = (event) => {
    const data = event && event.data;
    if (!data) return;
    if (data.type === "ready") return;
    if (data.type === "result") {
      clearTimeout(safetyTimer);
      // worker 未实现搜索时 move=null → fallback 同步搜索
      finish(data.move ? data.move : chooseAIMove());
    } else if (data.type === "error") {
      clearTimeout(safetyTimer);
      finish(chooseAIMove());
    }
  };
  worker.onerror = (err) => {
    clearTimeout(safetyTimer);
    console.warn("AI worker error, fallback to sync:", err && err.message);
    finish(chooseAIMove());
  };
  try {
    worker.postMessage({
      type: "search",
      ctx: {
        board: s.board.map((row) => row.slice()),
        currentSide: s.currentSide,
        aiDifficulty: s.aiDifficulty,
        moveHistory: (s.moveHistory || []).map((m) => ({ ...m })),
        snapshots: (s.snapshots || []).map((snap) => snap.board.map((row) => row.slice())),
      },
    });
  } catch (err) {
    clearTimeout(safetyTimer);
    console.warn("AI worker postMessage failed, fallback to sync:", err);
    finish(chooseAIMove());
  }
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

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let bestAtDepth = best;
    let bestScore = -Infinity;
    const ordered = orderMoves(s.board, rootMoves, s.currentSide, s.currentSide, best);
    for (const move of ordered) {
      if (performance.now() > deadline) break;
      const score = -negamax(
        applyMoveToBoard(s.board, move),
        opposite(s.currentSide),
        depth - 1,
        -Infinity,
        Infinity,
        s.currentSide,
        tt,
        deadline,
        1,
        killers,
        history,
      ) - rootCyclePenalty(s.board, move, s.currentSide, rootCycleOpts);
      if (score > bestScore) {
        bestScore = score;
        bestAtDepth = move;
      }
    }
    if (performance.now() > deadline) break;
    best = bestAtDepth;

    // === 时间管理:仅 hard 启用 ===
    if (s.aiDifficulty === "hard") {
      const prevScore = scoreHistory.length ? scoreHistory[scoreHistory.length - 1] : undefined;
      scoreHistory.push(bestScore);
      if (prevScore !== undefined) {
        if (Math.abs(prevScore - bestScore) < TIME_STABLE_WINDOW) {
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
            && Math.abs(prevScore - bestScore) > TIME_EXTEND_IMPROVEMENT
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
    score += 50000 + pieceValueOnBoard(board, move.capturedPieceId) * 12 - pieceValueOnBoard(board, move.pieceId);
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

function negamax(board, side, depth, alpha, beta, aiSide, tt = null, deadline = Infinity, ply = 0, killers = null, history = null, allowNull = true) {
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
    if (i === 0) {
      score = -negamax(childBoard, opposite(side), depth - 1, -beta, -alpha, aiSide, tt, deadline, ply + 1, killers, history, true);
    } else {
      const canLMR = canReduce && i >= LMR_FULL_MOVE_COUNT && !isTactical;
      const probeDepth = canLMR ? depth - 1 - LMR_REDUCTION : depth - 1;
      score = -negamax(childBoard, opposite(side), probeDepth, -alpha - 1, -alpha, aiSide, tt, deadline, ply + 1, killers, history, true);
      if (canLMR && score > alpha) {
        score = -negamax(childBoard, opposite(side), depth - 1, -alpha - 1, -alpha, aiSide, tt, deadline, ply + 1, killers, history, true);
      }
      if (score > alpha && score < beta) {
        score = -negamax(childBoard, opposite(side), depth - 1, -beta, -alpha, aiSide, tt, deadline, ply + 1, killers, history, true);
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

function scheduleAI() {
  clearTimeout(aiTimer);
  state.thinking = true;
  render();
  aiTimer = setTimeout(() => {
    if (state.status !== "playing" || state.currentSide === state.playerSide) return;
    chooseAIMoveAsync(state, (move) => {
      state.thinking = false;
      if (move) executeMove(move, true);
      else evaluateGameEnd();
    });
  }, state.aiDifficulty === "hard" ? 520 : 320);
}

function startGame() {
  clearTimeout(aiTimer);
  state = createGame(settings.playerSide, settings.difficulty);
  state.status = "playing";
  selectedId = null;
  legalTargets = [];
  hintMove = null;
  showMessage(settings.playerSide === SIDES.RED ? "红方先行，请选择棋子。" : "你执黑，AI 红方先行。");
  saveGame();
  render();
  startClock();
  if (state.currentSide !== state.playerSide) scheduleAI();
}

function undoMove() {
  if (state.status !== "playing" || state.thinking) return;
  const steps = state.moveHistory.length && state.moveHistory.at(-1).byAI ? 2 : 1;
  for (let i = 0; i < steps; i += 1) {
    const snapshot = state.snapshots.pop();
    if (!snapshot) break;
    state.board = cloneBoard(snapshot.board);
    state.capturedPieces = snapshot.capturedPieces.map((p) => ({ ...p }));
    state.moveHistory = snapshot.moveHistory.map((m) => ({ ...m }));
    state.currentSide = snapshot.currentSide;
    state.lastMove = snapshot.lastMove;
  }
  selectedId = null;
  legalTargets = [];
  hintMove = null;
  showMessage("已悔棋。");
  saveGame();
  render();
}

function requestHint() {
  if (!isPlayerTurn()) return;
  const moves = allLegalMoves(state.board, state.playerSide);
  if (!moves.length) return;
  const depth = settings.difficulty === "hard" ? 2 : 1;
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = depth > 1
      ? -negamax(applyMoveToBoard(state.board, move), opposite(state.playerSide), depth - 1, -Infinity, Infinity, state.playerSide)
      : evaluateBoard(applyMoveToBoard(state.board, move), state.playerSide);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  hintMove = best;
  selectedId = best.pieceId;
  legalTargets = legalMovesForPiece(state.board, state.board.find((p) => p.id === best.pieceId));
  const piece = state.board.find((p) => p.id === best.pieceId);
  showMessage(`推荐：${piece.label}${coord(best.fromX, best.fromY)} 至 ${coord(best.toX, best.toY)}。`);
  render();
}

function handleBoardClick(x, y) {
  if (!isPlayerTurn()) return;
  const clicked = pieceAt(state.board, x, y);
  if (selectedId) {
    const selected = state.board.find((p) => p.id === selectedId);
    if (clicked && clicked.id === selectedId) {
      selectedId = null;
      legalTargets = [];
      hintMove = null;
      render();
      return;
    }
    const move = legalTargets.find((item) => item.toX === x && item.toY === y);
    if (move) {
      executeMove(move, false);
      return;
    }
    if (clicked && clicked.side === state.playerSide) {
      selectPiece(clicked);
      return;
    }
    selectedId = null;
    legalTargets = [];
    showMessage("该位置不能落子。");
    beep("error");
    render();
    return;
  }
  if (clicked && clicked.side === state.playerSide) {
    selectPiece(clicked);
  } else if (clicked) {
    showMessage("只能选择自己的棋子。");
  }
}

function boardMetrics() {
  const board = els.board;
  const styles = window.getComputedStyle(board);
  const pad = Number.parseFloat(styles.paddingLeft) || 26;
  return {
    rect: board.getBoundingClientRect(),
    pad,
    cell: (board.clientWidth - pad * 2) / 8,
  };
}

function boardPointFromPointer(event) {
  const { rect, pad, cell } = boardMetrics();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const minX = pad - cell * 0.5;
  const maxX = pad + cell * 8.5;
  const minY = pad - cell * 0.5;
  const maxY = pad + cell * 9.5;
  if (localX < minX || localX > maxX || localY < minY || localY > maxY) return null;
  return {
    x: Math.max(0, Math.min(8, Math.round((localX - pad) / cell))),
    y: Math.max(0, Math.min(9, Math.round((localY - pad) / cell))),
  };
}

function movePieceElement(pieceId, event) {
  const el = els.board.querySelector(`[data-piece-id="${CSS.escape(pieceId)}"]`);
  if (!el) return;
  const { rect } = boardMetrics();
  el.classList.add("dragging");
  el.style.left = `${event.clientX - rect.left}px`;
  el.style.top = `${event.clientY - rect.top}px`;
}

function clearDragVisual() {
  els.board.querySelector(".piece.dragging")?.classList.remove("dragging");
}

function handleBoardPointerDown(event) {
  if (!event.isPrimary || (event.button !== undefined && event.button !== 0)) return;
  const point = boardPointFromPointer(event);
  if (!point) return;
  const clicked = pieceAt(state.board, point.x, point.y);
  const draggablePieceId = clicked && clicked.side === state.playerSide ? clicked.id : selectedId;
  dragState = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    pieceId: draggablePieceId,
    moved: false,
  };
  els.board.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function handleBoardPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId || !dragState.pieceId) return;
  const distance = Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY);
  if (distance < 7 && !dragState.moved) return;
  dragState.moved = true;
  if (selectedId !== dragState.pieceId) {
    const piece = state.board.find((item) => item.id === dragState.pieceId);
    if (!piece || piece.side !== state.playerSide) return;
    selectedId = piece.id;
    legalTargets = legalMovesForPiece(state.board, piece);
    hintMove = null;
    els.pieceHelp.textContent = `${piece.label}：${HELP[piece.type]}`;
  }
  movePieceElement(dragState.pieceId, event);
}

function handleBoardPointerUp(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const wasDrag = dragState.moved;
  const point = boardPointFromPointer(event);
  const pieceId = dragState.pieceId;
  dragState = null;
  clearDragVisual();
  els.board.releasePointerCapture?.(event.pointerId);
  if (!point) {
    renderBoard();
    return;
  }
  if (wasDrag && pieceId) {
    const selected = state.board.find((piece) => piece.id === pieceId);
    if (selected && selectedId !== pieceId) {
      selectedId = pieceId;
      legalTargets = legalMovesForPiece(state.board, selected);
    }
    const move = legalTargets.find((item) => item.pieceId === pieceId && item.toX === point.x && item.toY === point.y);
    if (move) {
      executeMove(move, false);
      return;
    }
    showMessage("该位置不能落子。");
    beep("error");
    render();
    return;
  }
  handleBoardClick(point.x, point.y);
}

function selectPiece(piece) {
  selectedId = piece.id;
  legalTargets = legalMovesForPiece(state.board, piece);
  hintMove = null;
  els.pieceHelp.textContent = `${piece.label}：${HELP[piece.type]}`;
  showMessage(legalTargets.length ? `已选择${piece.label}，请选择落点。` : `${piece.label}暂无合法走法。`);
  render();
}

function render() {
  renderBoard();
  renderInfo();
  renderMoves();
  renderCaptured();
  updateButtons();
}

function renderBoard() {
  const board = els.board;
  board.classList.toggle("dark", settings.darkBoard);
  board.innerHTML = "";
  const pad = window.matchMedia("(max-width: 620px)").matches ? 22 : 26;
  const cell = (board.clientWidth - pad * 2) / 8;
  for (let y = 0; y <= 9; y += 1) addLine("h", pad, pad + y * cell);
  for (let x = 0; x <= 8; x += 1) {
    if (x === 0 || x === 8) {
      addLine("v", pad + x * cell, pad);
    } else {
      addLine("v", pad + x * cell, pad, cell * 4);
      addLine("v", pad + x * cell, pad + cell * 5, cell * 4);
    }
  }
  addPalaceLines(pad, cell);
  const river = document.createElement("div");
  river.className = "river";
  river.innerHTML = "<span>楚河</span><span>汉界</span>";
  board.appendChild(river);

  for (let y = 0; y <= 9; y += 1) {
    for (let x = 0; x <= 8; x += 1) {
      const point = document.createElement("button");
      point.type = "button";
      point.className = "point";
      point.style.left = `${pad + x * cell}px`;
      point.style.top = `${pad + y * cell}px`;
      point.setAttribute("aria-label", `坐标 ${coord(x, y)}`);
      const legal = legalTargets.find((move) => move.toX === x && move.toY === y);
      if (legal) point.classList.add(legal.capturedPieceId ? "capture" : "legal");
      if (hintMove && hintMove.toX === x && hintMove.toY === y) point.classList.add("hint");
      if (state.lastMove && ((state.lastMove.fromX === x && state.lastMove.fromY === y) || (state.lastMove.toX === x && state.lastMove.toY === y))) {
        point.classList.add("last");
      }
      board.appendChild(point);
    }
  }

  for (const piece of livePieces(state.board)) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `piece ${piece.side}`;
    el.textContent = piece.label;
    el.style.left = `${pad + piece.x * cell}px`;
    el.style.top = `${pad + piece.y * cell}px`;
    el.dataset.pieceId = piece.id;
    el.setAttribute("aria-label", `${sideName(piece.side)}${piece.label}`);
    if (piece.id === selectedId) el.classList.add("selected");
    if (piece.type === TYPES.GENERAL && isInCheck(state.board, piece.side)) el.classList.add("check");
    board.appendChild(el);
  }

  function addLine(kind, left, top, size) {
    const line = document.createElement("div");
    line.className = `grid-line ${kind}`;
    line.style.left = `${left}px`;
    line.style.top = `${top}px`;
    if (kind === "v" && size) line.style.height = `${size}px`;
    board.appendChild(line);
  }
}

function addPalaceLines(pad, cell) {
  const points = [
    [3, 0, 5, 2],
    [5, 0, 3, 2],
    [3, 7, 5, 9],
    [5, 7, 3, 9],
  ];
  points.forEach(([x1, y1, x2, y2]) => {
    const line = document.createElement("div");
    const left = pad + x1 * cell;
    const top = pad + y1 * cell;
    const dx = (x2 - x1) * cell;
    const dy = (y2 - y1) * cell;
    line.className = "palace-line";
    line.style.left = `${left}px`;
    line.style.top = `${top}px`;
    line.style.width = `${Math.hypot(dx, dy)}px`;
    line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    els.board.appendChild(line);
  });
}

function renderInfo() {
  els.playerSideText.textContent = sideName(state.playerSide);
  els.aiSideText.textContent = sideName(opposite(state.playerSide));
  els.turnText.textContent = sideName(state.currentSide);
  els.difficultyText.textContent = { easy: "简单", normal: "普通", hard: "困难" }[state.aiDifficulty];
  els.gameStatus.textContent = state.thinking ? "AI 思考中" : state.status === "playing" ? `${sideName(state.currentSide)}回合` : state.status === "finished" ? "已结束" : "准备开局";
  if (isInCheck(state.board, state.currentSide) && state.status === "playing") {
    els.gameStatus.textContent = `${sideName(state.currentSide)}被将军`;
  }
}

function renderMoves() {
  els.moveCount.textContent = `${state.moveHistory.length} 手`;
  els.moveList.innerHTML = "";
  state.moveHistory.forEach((move) => {
    const li = document.createElement("li");
    li.innerHTML = `${move.turnNumber}. ${escapeHtml(move.notation)}${move.isCheck ? ' <span class="check-note">!</span>' : ""}`;
    els.moveList.appendChild(li);
  });
  els.moveList.scrollTop = els.moveList.scrollHeight;
}

function renderCaptured() {
  renderCapturedRow(els.capturedByRed, state.capturedPieces.filter((piece) => piece.capturedBy === SIDES.RED), SIDES.RED);
  renderCapturedRow(els.capturedByBlack, state.capturedPieces.filter((piece) => piece.capturedBy === SIDES.BLACK), SIDES.BLACK);
}

function renderCapturedRow(container, pieces, side) {
  container.innerHTML = "";
  pieces.forEach((piece) => {
    const chip = document.createElement("span");
    chip.className = `captured-chip ${side}`;
    chip.textContent = piece.label;
    container.appendChild(chip);
  });
}

function updateButtons() {
  const playing = state.status === "playing";
  [buttons.hint, buttons.hintMobile].forEach((btn) => { btn.disabled = !isPlayerTurn(); });
  [buttons.undo, buttons.undoMobile].forEach((btn) => { btn.disabled = !playing || state.thinking || state.moveHistory.length === 0; });
  [buttons.resign, buttons.resignMobile].forEach((btn) => { btn.disabled = !playing || state.thinking; });
  buttons.export.disabled = state.moveHistory.length === 0;
}

function showMessage(text) {
  els.message.textContent = text;
}

function openResult(summary) {
  els.resultTitle.textContent = state.result.winner === state.playerSide ? "你赢了" : "AI 获胜";
  els.resultSummary.textContent = `${summary} 共 ${state.moveHistory.length} 手，用时 ${formatTime(state.result.durationSeconds)}。`;
  if (!els.resultDialog.open) els.resultDialog.showModal();
}

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function startClock() {
  clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - state.createdAt) / 1000);
    els.timer.textContent = formatTime(seconds);
  }, 1000);
}

function saveGame() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, settings }));
  } catch {
    showMessage("本地存档失败，当前浏览器可能限制 localStorage。");
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved.state || !Array.isArray(saved.state.board)) return false;
    state = saved.state;
    settings = { ...settings, ...(saved.settings || {}) };
    state.thinking = false;
    selectedId = null;
    legalTargets = [];
    hintMove = null;
    if (state.status === "playing") {
      showMessage("已恢复上次未完成对局。");
      startClock();
      if (state.currentSide !== state.playerSide) scheduleAI();
    }
    return true;
  } catch {
    return false;
  }
}

function exportNotation() {
  const text = [
    "中国象棋棋谱",
    `玩家：${sideName(state.playerSide)} AI：${sideName(opposite(state.playerSide))}`,
    `难度：${els.difficultyText.textContent}`,
    "",
    ...state.moveHistory.map((move, index) => `${index + 1}. ${move.notation}`),
    state.result ? `\n结果：${state.result.summary}` : "",
  ].join("\n");
  navigator.clipboard?.writeText(text).then(
    () => showMessage("棋谱已复制到剪贴板。"),
    () => {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "中国象棋棋谱.txt";
      a.click();
      URL.revokeObjectURL(url);
    },
  );
}

function beep(type) {
  if (!settings.sound) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const freq = { move: 420, capture: 240, check: 720, finish: 520, error: 120 }[type] || 320;
  osc.frequency.value = freq;
  osc.type = type === "error" ? "sawtooth" : "sine";
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.14);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function bindEvents() {
  document.querySelectorAll("[data-side]").forEach((button) => {
    button.addEventListener("click", () => {
      settings.playerSide = button.dataset.side;
      document.querySelectorAll("[data-side]").forEach((item) => item.classList.toggle("active", item === button));
      state.playerSide = settings.playerSide;
      render();
      saveGame();
    });
  });

  document.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      settings.difficulty = button.dataset.difficulty;
      document.querySelectorAll("[data-difficulty]").forEach((item) => item.classList.toggle("active", item === button));
      state.aiDifficulty = settings.difficulty;
      render();
      saveGame();
    });
  });

  buttons.start.addEventListener("click", startGame);
  buttons.newGame.addEventListener("click", startGame);
  [buttons.hint, buttons.hintMobile].forEach((button) => button.addEventListener("click", requestHint));
  [buttons.undo, buttons.undoMobile].forEach((button) => button.addEventListener("click", undoMove));
  [buttons.resign, buttons.resignMobile].forEach((button) => button.addEventListener("click", () => finishGame(opposite(state.playerSide), "resign")));
  buttons.export.addEventListener("click", exportNotation);
  buttons.closeResult.addEventListener("click", () => els.resultDialog.close());
  buttons.again.addEventListener("click", () => {
    els.resultDialog.close();
    startGame();
  });
  buttons.soundToggle.addEventListener("change", () => {
    settings.sound = buttons.soundToggle.checked;
    saveGame();
  });
  buttons.themeToggle.addEventListener("change", () => {
    settings.darkBoard = buttons.themeToggle.checked;
    render();
    saveGame();
  });
  els.board.addEventListener("pointerdown", handleBoardPointerDown);
  els.board.addEventListener("pointermove", handleBoardPointerMove);
  els.board.addEventListener("pointerup", handleBoardPointerUp);
  els.board.addEventListener("pointercancel", () => {
    dragState = null;
    clearDragVisual();
    renderBoard();
  });
  window.addEventListener("resize", renderBoard);
}

function syncSettingsUI() {
  document.querySelectorAll("[data-side]").forEach((button) => button.classList.toggle("active", button.dataset.side === settings.playerSide));
  document.querySelectorAll("[data-difficulty]").forEach((button) => button.classList.toggle("active", button.dataset.difficulty === settings.difficulty));
  buttons.soundToggle.checked = settings.sound;
  buttons.themeToggle.checked = settings.darkBoard;
}

bindEvents();
loadGame();
syncSettingsUI();
render();
