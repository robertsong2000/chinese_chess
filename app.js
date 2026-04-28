const SIDES = { RED: "red", BLACK: "black" };
const TYPES = {
  GENERAL: "general",
  ADVISOR: "advisor",
  ELEPHANT: "elephant",
  HORSE: "horse",
  CHARIOT: "chariot",
  CANNON: "cannon",
  SOLDIER: "soldier",
};

const LABELS = {
  red: {
    general: "帅",
    advisor: "仕",
    elephant: "相",
    horse: "马",
    chariot: "车",
    cannon: "炮",
    soldier: "兵",
  },
  black: {
    general: "将",
    advisor: "士",
    elephant: "象",
    horse: "马",
    chariot: "车",
    cannon: "炮",
    soldier: "卒",
  },
};

const PIECE_VALUE = {
  general: 10000,
  chariot: 900,
  cannon: 460,
  horse: 430,
  elephant: 220,
  advisor: 220,
  soldier: 100,
};

const SEARCH_DEPTH = { easy: 1, normal: 2, hard: 4 };
const QUIESCENCE_DEPTH = 3;
const MATE_SCORE = 30000;
const REPEATED_POSITION_PENALTY = 12000;
const DIRECT_REVERSAL_PENALTY = 2600;
const RECENT_ROUTE_PENALTY = 420;
const CYCLE_FILTER_PENALTY = DIRECT_REVERSAL_PENALTY;

const MOBILITY_VALUE = {
  general: 0,
  advisor: 1,
  elephant: 1,
  horse: 5,
  chariot: 7,
  cannon: 6,
  soldier: 2,
};

const POSITION_BONUS = {
  general: [
    [0, 0, 0, 8, 12, 8, 0, 0, 0],
    [0, 0, 0, 6, 10, 6, 0, 0, 0],
    [0, 0, 0, 4, 8, 4, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 4, 8, 4, 0, 0, 0],
    [0, 0, 0, 6, 10, 6, 0, 0, 0],
    [0, 0, 0, 8, 12, 8, 0, 0, 0],
  ],
  chariot: [
    [4, 8, 12, 14, 16, 14, 12, 8, 4],
    [6, 10, 14, 18, 20, 18, 14, 10, 6],
    [8, 12, 18, 24, 26, 24, 18, 12, 8],
    [8, 14, 20, 26, 30, 26, 20, 14, 8],
    [8, 14, 20, 28, 32, 28, 20, 14, 8],
    [8, 14, 20, 28, 32, 28, 20, 14, 8],
    [8, 14, 20, 26, 30, 26, 20, 14, 8],
    [8, 12, 18, 24, 26, 24, 18, 12, 8],
    [6, 10, 14, 18, 20, 18, 14, 10, 6],
    [4, 8, 12, 14, 16, 14, 12, 8, 4],
  ],
  horse: [
    [0, 4, 8, 10, 12, 10, 8, 4, 0],
    [4, 8, 14, 18, 20, 18, 14, 8, 4],
    [8, 14, 22, 28, 30, 28, 22, 14, 8],
    [8, 16, 24, 32, 34, 32, 24, 16, 8],
    [6, 14, 22, 30, 32, 30, 22, 14, 6],
    [6, 14, 22, 30, 32, 30, 22, 14, 6],
    [8, 16, 24, 32, 34, 32, 24, 16, 8],
    [8, 14, 22, 28, 30, 28, 22, 14, 8],
    [4, 8, 14, 18, 20, 18, 14, 8, 4],
    [0, 4, 8, 10, 12, 10, 8, 4, 0],
  ],
  cannon: [
    [2, 4, 6, 8, 10, 8, 6, 4, 2],
    [4, 8, 10, 12, 14, 12, 10, 8, 4],
    [6, 10, 16, 20, 22, 20, 16, 10, 6],
    [6, 12, 18, 24, 28, 24, 18, 12, 6],
    [6, 12, 18, 24, 28, 24, 18, 12, 6],
    [6, 12, 18, 24, 28, 24, 18, 12, 6],
    [6, 12, 18, 24, 28, 24, 18, 12, 6],
    [6, 10, 16, 20, 22, 20, 16, 10, 6],
    [4, 8, 10, 12, 14, 12, 10, 8, 4],
    [2, 4, 6, 8, 10, 8, 6, 4, 2],
  ],
  soldier: [
    [78, 84, 90, 96, 100, 96, 90, 84, 78],
    [70, 76, 82, 88, 92, 88, 82, 76, 70],
    [54, 60, 68, 74, 78, 74, 68, 60, 54],
    [38, 44, 52, 58, 62, 58, 52, 44, 38],
    [22, 28, 34, 40, 44, 40, 34, 28, 22],
    [8, 10, 12, 14, 16, 14, 12, 10, 8],
    [4, 6, 8, 10, 12, 10, 8, 6, 4],
    [0, 2, 4, 6, 8, 6, 4, 2, 0],
    [0, 0, 2, 4, 6, 4, 2, 0, 0],
    [0, 0, 0, 2, 4, 2, 0, 0, 0],
  ],
};

const HELP = {
  general: "帅/将在九宫内横竖走一格，且不能与对方将帅照面。",
  advisor: "仕/士只能在己方九宫内沿斜线走一格。",
  elephant: "相/象走田字，不能过河，象眼被堵时不能走。",
  horse: "马走日字，马腿位置有棋子时，对应方向不能走。",
  chariot: "车横竖直线行走，路径中不能有棋子。",
  cannon: "炮移动同车；吃子时中间必须刚好隔一个棋子。",
  soldier: "兵/卒过河前只能向前一格，过河后可向前或左右一格，不能后退。",
};

const STORAGE_KEY = "cn_chess_session_v1";

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

function livePieces(board = state.board) {
  return board.filter((piece) => piece.alive);
}

function pieceAt(board, x, y) {
  return board.find((piece) => piece.alive && piece.x === x && piece.y === y) || null;
}

function inBoard(x, y) {
  return x >= 0 && x <= 8 && y >= 0 && y <= 9;
}

function opposite(side) {
  return side === SIDES.RED ? SIDES.BLACK : SIDES.RED;
}

function sideName(side) {
  return side === SIDES.RED ? "红方" : "黑方";
}

function isPlayerTurn() {
  return state.status === "playing" && state.currentSide === state.playerSide && !state.thinking;
}

function palaceContains(side, x, y) {
  if (x < 3 || x > 5) return false;
  return side === SIDES.RED ? y >= 7 && y <= 9 : y >= 0 && y <= 2;
}

function crossedRiver(side, y) {
  return side === SIDES.RED ? y <= 4 : y >= 5;
}

function rawMovesForPiece(board, piece, attacksOnly = false) {
  if (!piece.alive) return [];
  const moves = [];
  const push = (x, y) => {
    if (!inBoard(x, y)) return;
    const target = pieceAt(board, x, y);
    if (!target || target.side !== piece.side) moves.push(makeCandidate(piece, x, y, target));
  };

  if (piece.type === TYPES.CHARIOT || piece.type === TYPES.CANNON) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let x = piece.x + dx;
      let y = piece.y + dy;
      let screens = 0;
      while (inBoard(x, y)) {
        const target = pieceAt(board, x, y);
        if (piece.type === TYPES.CHARIOT) {
          if (!target) moves.push(makeCandidate(piece, x, y, null));
          else {
            if (target.side !== piece.side) moves.push(makeCandidate(piece, x, y, target));
            break;
          }
        } else if (!target) {
          if (screens === 0 && !attacksOnly) moves.push(makeCandidate(piece, x, y, null));
        } else {
          screens += 1;
          if (screens === 2) {
            if (target.side !== piece.side) moves.push(makeCandidate(piece, x, y, target));
            break;
          }
        }
        x += dx;
        y += dy;
      }
    }
  }

  if (piece.type === TYPES.HORSE) {
    [
      [1, 2, 0, 1],
      [-1, 2, 0, 1],
      [1, -2, 0, -1],
      [-1, -2, 0, -1],
      [2, 1, 1, 0],
      [2, -1, 1, 0],
      [-2, 1, -1, 0],
      [-2, -1, -1, 0],
    ].forEach(([dx, dy, lx, ly]) => {
      if (!pieceAt(board, piece.x + lx, piece.y + ly)) push(piece.x + dx, piece.y + dy);
    });
  }

  if (piece.type === TYPES.ELEPHANT) {
    [[2, 2], [2, -2], [-2, 2], [-2, -2]].forEach(([dx, dy]) => {
      const x = piece.x + dx;
      const y = piece.y + dy;
      const eyeX = piece.x + dx / 2;
      const eyeY = piece.y + dy / 2;
      const ownSide = piece.side === SIDES.RED ? y >= 5 : y <= 4;
      if (ownSide && !pieceAt(board, eyeX, eyeY)) push(x, y);
    });
  }

  if (piece.type === TYPES.ADVISOR) {
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dx, dy]) => {
      const x = piece.x + dx;
      const y = piece.y + dy;
      if (palaceContains(piece.side, x, y)) push(x, y);
    });
  }

  if (piece.type === TYPES.GENERAL) {
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      const x = piece.x + dx;
      const y = piece.y + dy;
      if (palaceContains(piece.side, x, y)) push(x, y);
    });
    const enemyGeneral = board.find((p) => p.alive && p.type === TYPES.GENERAL && p.side !== piece.side);
    if (enemyGeneral && enemyGeneral.x === piece.x && countBetween(board, piece.x, piece.y, enemyGeneral.y) === 0) {
      moves.push(makeCandidate(piece, enemyGeneral.x, enemyGeneral.y, enemyGeneral));
    }
  }

  if (piece.type === TYPES.SOLDIER) {
    const forward = piece.side === SIDES.RED ? -1 : 1;
    push(piece.x, piece.y + forward);
    if (crossedRiver(piece.side, piece.y)) {
      push(piece.x - 1, piece.y);
      push(piece.x + 1, piece.y);
    }
  }

  return moves;
}

function makeCandidate(piece, x, y, captured) {
  return {
    pieceId: piece.id,
    side: piece.side,
    pieceType: piece.type,
    fromX: piece.x,
    fromY: piece.y,
    toX: x,
    toY: y,
    capturedPieceId: captured ? captured.id : null,
  };
}

function countBetween(board, x, y1, y2) {
  const min = Math.min(y1, y2) + 1;
  const max = Math.max(y1, y2);
  let count = 0;
  for (let y = min; y < max; y += 1) {
    if (pieceAt(board, x, y)) count += 1;
  }
  return count;
}

function generalsFacing(board) {
  const red = board.find((p) => p.alive && p.type === TYPES.GENERAL && p.side === SIDES.RED);
  const black = board.find((p) => p.alive && p.type === TYPES.GENERAL && p.side === SIDES.BLACK);
  return red && black && red.x === black.x && countBetween(board, red.x, red.y, black.y) === 0;
}

function cloneBoard(board) {
  return board.map((piece) => ({ ...piece }));
}

function applyMoveToBoard(board, move) {
  const next = cloneBoard(board);
  const moving = next.find((piece) => piece.id === move.pieceId);
  const captured = pieceAt(next, move.toX, move.toY);
  if (captured) captured.alive = false;
  moving.x = move.toX;
  moving.y = move.toY;
  return next;
}

function isInCheck(board, side) {
  const general = board.find((p) => p.alive && p.side === side && p.type === TYPES.GENERAL);
  if (!general) return true;
  return livePieces(board)
    .filter((piece) => piece.side !== side)
    .some((piece) => rawMovesForPiece(board, piece, true).some((move) => move.toX === general.x && move.toY === general.y));
}

function legalMovesForPiece(board, piece) {
  return rawMovesForPiece(board, piece).filter((move) => {
    const next = applyMoveToBoard(board, move);
    return !generalsFacing(next) && !isInCheck(next, piece.side);
  });
}

function allLegalMoves(board, side) {
  return livePieces(board)
    .filter((piece) => piece.side === side)
    .flatMap((piece) => legalMovesForPiece(board, piece));
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

function chooseAIMove() {
  const moves = allLegalMoves(state.board, state.currentSide);
  if (!moves.length) return null;
  if (state.aiDifficulty === "easy") return pickEasyMove(moves, state.board, state.currentSide);
  const maxDepth = SEARCH_DEPTH[state.aiDifficulty] || SEARCH_DEPTH.normal;
  const deadline = performance.now() + (state.aiDifficulty === "hard" ? 1100 : 520);
  const cache = new Map();
  const rootMoves = preferNonRepeatingMoves(state.board, moves, state.currentSide);
  let best = orderMoves(state.board, rootMoves, state.currentSide, state.currentSide)[0];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let bestAtDepth = best;
    let bestScore = -Infinity;
    const ordered = orderMoves(state.board, rootMoves, state.currentSide, state.currentSide, best);
    for (const move of ordered) {
      if (performance.now() > deadline) break;
      const score = -negamax(
        applyMoveToBoard(state.board, move),
        opposite(state.currentSide),
        depth - 1,
        -Infinity,
        Infinity,
        state.currentSide,
        cache,
        deadline,
      ) - rootCyclePenalty(state.board, move, state.currentSide);
      if (score > bestScore) {
        bestScore = score;
        bestAtDepth = move;
      }
    }
    if (performance.now() > deadline) break;
    best = bestAtDepth;
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

function capturedValue(move) {
  const piece = state.board.find((p) => p.id === move.capturedPieceId);
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

function positionRepetitionCount(board, side) {
  const key = positionKey(board, side);
  let count = positionKey(state.board, state.currentSide) === key ? 1 : 0;
  for (const snapshot of state.snapshots) {
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

function rootCyclePenalty(board, move, side) {
  const nextBoard = applyMoveToBoard(board, move);
  const repetitions = positionRepetitionCount(nextBoard, opposite(side));
  let penalty = repetitions * REPEATED_POSITION_PENALTY;
  const recentAIMoves = state.moveHistory.filter((item) => item.byAI).slice(-4);
  if (isDirectReversal(move, recentAIMoves.at(-1))) penalty += DIRECT_REVERSAL_PENALTY;
  for (const recent of recentAIMoves) {
    if (recent.pieceId !== move.pieceId) continue;
    const sameRoute = recent.fromX === move.fromX && recent.fromY === move.fromY && recent.toX === move.toX && recent.toY === move.toY;
    const reverseRoute = isDirectReversal(move, recent);
    if (sameRoute || reverseRoute) penalty += RECENT_ROUTE_PENALTY;
  }
  return penalty;
}

function preferNonRepeatingMoves(board, moves, side) {
  if (moves.length <= 1) return moves;
  const nonRepeating = moves.filter((move) => rootCyclePenalty(board, move, side) < CYCLE_FILTER_PENALTY);
  return nonRepeating.length ? nonRepeating : moves;
}

function moveOrderingScore(board, move, side, aiSide, preferredMove = null) {
  let score = 0;
  if (preferredMove && move.pieceId === preferredMove.pieceId && move.toX === preferredMove.toX && move.toY === preferredMove.toY) score += 100000;
  if (move.capturedPieceId) {
    score += 50000 + pieceValueOnBoard(board, move.capturedPieceId) * 12 - pieceValueOnBoard(board, move.pieceId);
  }
  const next = applyMoveToBoard(board, move);
  if (isInCheck(next, opposite(side))) score += 9000;
  if (isInCheck(next, side)) score -= 9000;
  score += Math.max(0, 4 - Math.abs(move.toX - 4)) * 10;
  score += positionalBonus(board.find((piece) => piece.id === move.pieceId), move.toX, move.toY) - positionalBonus(board.find((piece) => piece.id === move.pieceId));
  return score;
}

function orderMoves(board, moves, side, aiSide, preferredMove = null) {
  return [...moves].sort((a, b) => moveOrderingScore(board, b, side, aiSide, preferredMove) - moveOrderingScore(board, a, side, aiSide, preferredMove));
}

function boardKey(board, side, depth) {
  return `${side}:${depth}:${canonicalBoardKey(board)}`;
}

function negamax(board, side, depth, alpha, beta, aiSide, cache = new Map(), deadline = Infinity) {
  if (performance.now() > deadline) return evaluateBoard(board, aiSide) * (side === aiSide ? 1 : -1);
  const key = boardKey(board, side, depth);
  const cached = cache.get(key);
  if (cached && cached.depth >= depth) return cached.score;
  const moves = allLegalMoves(board, side);
  if (depth === 0 || moves.length === 0) {
    if (moves.length === 0) {
      return isInCheck(board, side) ? -MATE_SCORE - depth : -8000;
    }
    return quiescence(board, side, alpha, beta, aiSide, QUIESCENCE_DEPTH, deadline);
  }
  let best = -Infinity;
  let didCut = false;
  for (const move of orderMoves(board, moves, side, aiSide)) {
    const score = -negamax(applyMoveToBoard(board, move), opposite(side), depth - 1, -beta, -alpha, aiSide, cache, deadline);
    best = Math.max(best, score);
    alpha = Math.max(alpha, score);
    if (alpha >= beta) {
      didCut = true;
      break;
    }
  }
  if (!didCut) cache.set(key, { depth, score: best });
  return best;
}

function quiescence(board, side, alpha, beta, aiSide, depth, deadline) {
  const standPat = evaluateBoard(board, aiSide) * (side === aiSide ? 1 : -1);
  if (depth === 0 || performance.now() > deadline) return standPat;
  if (standPat >= beta) return beta;
  alpha = Math.max(alpha, standPat);
  const captures = orderMoves(
    board,
    allLegalMoves(board, side).filter((move) => move.capturedPieceId || isInCheck(applyMoveToBoard(board, move), opposite(side))),
    side,
    aiSide,
  );
  for (const move of captures) {
    const score = -quiescence(applyMoveToBoard(board, move), opposite(side), -beta, -alpha, aiSide, depth - 1, deadline);
    if (score >= beta) return beta;
    alpha = Math.max(alpha, score);
  }
  return alpha;
}

function evaluateBoard(board, aiSide) {
  let score = 0;
  for (const piece of livePieces(board)) {
    const direction = piece.side === aiSide ? 1 : -1;
    let value = PIECE_VALUE[piece.type];
    value += positionalBonus(piece);
    value += rawMovesForPiece(board, piece).length * (MOBILITY_VALUE[piece.type] || 0);
    if (isPieceAttacked(board, piece)) value -= Math.min(140, value * 0.12);
    if (isPieceDefended(board, piece)) value += Math.min(70, value * 0.05);
    score += direction * value;
  }
  if (isInCheck(board, opposite(aiSide))) score += 120;
  if (isInCheck(board, aiSide)) score -= 160;
  return score;
}

function positionalBonus(piece, x = piece?.x, y = piece?.y) {
  if (!piece) return 0;
  const table = POSITION_BONUS[piece.type];
  if (table) {
    const row = piece.side === SIDES.RED ? y : 9 - y;
    return table[row]?.[x] || 0;
  }
  const center = Math.max(0, 4 - Math.abs(x - 4)) * 4;
  const palace = palaceContains(piece.side, x, y) ? 8 : 0;
  return center + palace;
}

function isPieceAttacked(board, target) {
  return livePieces(board)
    .filter((piece) => piece.side !== target.side)
    .some((piece) => rawMovesForPiece(board, piece, true).some((move) => move.toX === target.x && move.toY === target.y));
}

function isPieceDefended(board, target) {
  const boardWithoutTarget = board.map((piece) => piece.id === target.id ? { ...piece, alive: false } : piece);
  return livePieces(board)
    .filter((piece) => piece.side === target.side && piece.id !== target.id)
    .some((piece) => rawMovesForPiece(boardWithoutTarget, piece, true).some((move) => move.toX === target.x && move.toY === target.y));
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
    const move = chooseAIMove();
    state.thinking = false;
    if (move) executeMove(move, true);
    else evaluateGameEnd();
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
