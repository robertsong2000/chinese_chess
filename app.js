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
  engineModeText: document.querySelector("#engineModeText"),
  engineInfo: document.querySelector("#engineInfo"),
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

let settings = { playerSide: SIDES.RED, difficulty: "normal", engineMode: "vanilla", sound: true, darkBoard: false };
let state = createGame(settings.playerSide, settings.difficulty);
let selectedId = null;
let legalTargets = [];
let hintMove = null;
let aiTimer = null;
let clockTimer = null;
let dragState = null;

function createGame(playerSide, difficulty) {
  const now = Date.now();
  // #54:每开新局清空共享 TT,防止上一局的 Zobrist 命中污染新局搜索结果。
  // typeof 守卫:某些测试场景可能未走完整加载链,仍能安全调用。
  if (typeof resetSharedTT === "function") resetSharedTT();
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
    engineInfo: null,
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

// 开局库 / 时间分配 / 评估 / 搜索 / 走法排序 / TT / killer / history / runAISearch
// 已移到 src/search.js(共享全局词法环境,加载顺序 constants → rules → search → app)。

// 选择 AI 走法:主线程入口。当前同步实现;后续 Web Worker 化时,
// 此函数将转发到 runAISearch(state),worker 路径会通过 postMessage 序列化 state。
function chooseAIMove() {
  return runAISearch(state);
}

// Worker 工厂:在浏览器环境返回 Worker 实例,node/无 Worker 环境返回 null。
// 当前 AI_WORKER_ENABLED = false,vanilla 模式仍走同步 chooseAIMove 路径。
// pikafish 模式必须走 worker(无同步实现),createAIWorker 强制启用。
let AI_WORKER_ENABLED = false;
const AI_WORKER_URL = "ai-worker.js";
// pikafish depth 18 在标准笔记本 ~5s,留充足 guard 避免误 fallback。
const PIKAFISH_FALLBACK_GUARD_MS = 15000;

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

// 构造 worker postMessage 负载的纯函数(便于测试)。
// vanilla 模式:发完整 v1 ctx(board+currentSide+aiDifficulty+moveHistory+snapshots)。
// pikafish 模式:发精简 ctx(board+currentSide+aiDifficulty),worker 用 boardToFen 转 FEN 喂引擎。
// board 是 flat 棋子数组(不是 2D 矩阵),用 cloneBoard 深拷贝;原 .map(row=>row.slice()) 是潜伏 bug,
// 被 AI_WORKER_ENABLED=false 掩盖,#67 首次走 worker 时一并修复。
function buildWorkerMessage(s) {
  const ctx = {
    board: cloneBoard(s.board),
    currentSide: s.currentSide,
    aiDifficulty: s.aiDifficulty,
  };
  if (settings.engineMode === "pikafish") {
    return { type: "search", engine: "pikafish", ctx };
  }
  return {
    type: "search",
    ctx: {
      ...ctx,
      moveHistory: (s.moveHistory || []).map((m) => ({ ...m })),
      snapshots: (s.snapshots || []).map((snap) => ({ ...snap, board: cloneBoard(snap.board) })),
    },
  };
}

// 格式化 Pikafish engine-info 为可读字符串(#70)。
// 输入示例:{ depth:18, seldepth:22, score:{unit:"cp", value:123}, pv:["h2e2","h9g7","c3c4"], nodes:..., nps:... }
// score unit="cp" 时 value 是厘兵(centipawn),换算成"兵"(pawns)并加符号;unit="mate" 显示为"杀 N"。
// pv 用 UCI 表示(棋力强用户已能读),截断到前 4 个 move,后面加 " …"。
// 思考空 / 输入 falsy → 返回 ""(UI 隐藏)。
// 纯函数,便于测试。
function formatEngineInfo(info) {
  if (!info || typeof info !== "object") return "";
  const parts = [];
  if (typeof info.depth === "number") {
    parts.push(`深度 ${info.depth}${typeof info.seldepth === "number" ? `/${info.seldepth}` : ""}`);
  }
  if (info.score && typeof info.score === "object") {
    const { unit, value } = info.score;
    if (unit === "cp" && typeof value === "number" && Number.isFinite(value)) {
      const pawns = value / 100;
      const sign = value > 0 ? "+" : value < 0 ? "" : "±";
      parts.push(`分数 ${sign}${pawns.toFixed(2)}`);
    } else if (unit === "mate" && typeof value === "number") {
      const sign = value > 0 ? "+" : "";
      parts.push(`杀 ${sign}${value}`);
    }
  }
  if (Array.isArray(info.pv) && info.pv.length) {
    const pvShort = info.pv.slice(0, 4).join(" ");
    const more = info.pv.length > 4 ? " …" : "";
    parts.push(`pv: ${pvShort}${more}`);
  }
  if (typeof info.nps === "number" && info.nps > 0) {
    const knps = (info.nps / 1000).toFixed(0);
    parts.push(`${knps}k nps`);
  }
  return parts.join(" · ");
}

// 异步版 AI 走法选择:浏览器若启用 Worker,走 worker-first-then-sync-fallback 路径;
// node/无 Worker 环境直接同步 callback(chooseAIMove())。
// pikafish 模式必须用 worker(worker 端 importScripts vendor/pikafish/pikafish.js)。
// 任何 worker 失败(创建/超时/错误/null move)都 fallback 同步 chooseAIMove(),游戏不阻塞。
function chooseAIMoveAsync(s, callback) {
  const usePikafish = settings.engineMode === "pikafish";
  // pikafish 强制 worker,即便 AI_WORKER_ENABLED=false
  const worker = (usePikafish || AI_WORKER_ENABLED) ? createAIWorker() : null;
  if (!worker) {
    if (usePikafish) console.warn("pikafish mode requires Worker, falling back to sync vanilla AI");
    callback(chooseAIMove());
    return;
  }
  const budget = TIME_BUDGET_MS[s.aiDifficulty] || TIME_BUDGET_MS.normal;
  const fallbackGuardMs = usePikafish
    ? Math.max(budget + 1500, PIKAFISH_FALLBACK_GUARD_MS)
    : budget + 1500;
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
    // pikafish 启动/状态消息(无进度数据),仅 log
    if (data.type === "engine-ready" || data.type === "engine-status") {
      return;
    }
    // pikafish 进度:#70 实时渲染 depth/score/pv 到 UI
    if (data.type === "engine-info") {
      if (state.thinking && data.info) {
        state.engineInfo = data.info;
        renderEngineInfo();
      }
      return;
    }
    if (data.type === "result") {
      clearTimeout(safetyTimer);
      state.engineInfo = null;
      renderEngineInfo();
      // worker 未实现搜索时 move=null → fallback 同步搜索
      finish(data.move ? data.move : chooseAIMove());
    } else if (data.type === "error") {
      clearTimeout(safetyTimer);
      state.engineInfo = null;
      renderEngineInfo();
      console.warn("AI worker error, fallback to sync:", data.error);
      finish(chooseAIMove());
    }
  };
  worker.onerror = (err) => {
    clearTimeout(safetyTimer);
    console.warn("AI worker error, fallback to sync:", err && err.message);
    finish(chooseAIMove());
  };
  try {
    worker.postMessage(buildWorkerMessage(s));
  } catch (err) {
    clearTimeout(safetyTimer);
    console.warn("AI worker postMessage failed, fallback to sync:", err);
    finish(chooseAIMove());
  }
}


function scheduleAI() {
  clearTimeout(aiTimer);
  state.thinking = true;
  state.engineInfo = null;
  render();
  renderEngineInfo();
  aiTimer = setTimeout(() => {
    if (state.status !== "playing" || state.currentSide === state.playerSide) return;
    chooseAIMoveAsync(state, (move) => {
      state.thinking = false;
      state.engineInfo = null;
      renderEngineInfo();
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
  if (els.engineModeText) {
    els.engineModeText.textContent = settings.engineMode === "pikafish" ? "Pikafish 引擎" : "自研 AI";
  }
  els.gameStatus.textContent = state.thinking ? (settings.engineMode === "pikafish" ? "Pikafish 思考中" : "AI 思考中") : state.status === "playing" ? `${sideName(state.currentSide)}回合` : state.status === "finished" ? "已结束" : "准备开局";
  if (isInCheck(state.board, state.currentSide) && state.status === "playing") {
    els.gameStatus.textContent = `${sideName(state.currentSide)}被将军`;
  }
}

// 渲染 Pikafish 思考进度(#70)。
// 仅 pikafish + thinking + engineInfo 三者齐备时显示文本,否则隐藏。
// 与 renderInfo 解耦(engine-info 消息频繁触发,无需全量 render)。
function renderEngineInfo() {
  if (!els.engineInfo) return;
  const visible = settings.engineMode === "pikafish" && state.thinking && state.engineInfo;
  if (!visible) {
    els.engineInfo.hidden = true;
    els.engineInfo.textContent = "";
    return;
  }
  const text = formatEngineInfo(state.engineInfo);
  if (!text) {
    els.engineInfo.hidden = true;
    els.engineInfo.textContent = "";
    return;
  }
  els.engineInfo.hidden = false;
  els.engineInfo.textContent = text;
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

  document.querySelectorAll("[data-engine]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.engine;
      if (next !== "vanilla" && next !== "pikafish") return;
      settings.engineMode = next;
      document.querySelectorAll("[data-engine]").forEach((item) => item.classList.toggle("active", item === button));
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
  document.querySelectorAll("[data-engine]").forEach((button) => button.classList.toggle("active", button.dataset.engine === settings.engineMode));
  buttons.soundToggle.checked = settings.sound;
  buttons.themeToggle.checked = settings.darkBoard;
}

// === Service Worker 注册(V2 #68,缓存 pikafish.wasm,二次访问零延迟)===
// 守卫条件:
//   - 仅在浏览器主线程运行(Node 测试环境 / Worker 子线程跳过)。
//   - 仅在支持 serviceWorker 的浏览器注册。
//   - file:// 协议无 SW 支持(SecurityError),跳过。
//   - 注册失败仅 console.warn,不阻断游戏。
(function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;
  navigator.serviceWorker
    .register("sw.js")
    .then(() => {
      console.info("[sw] registered (pikafish.wasm caching enabled)");
    })
    .catch((err) => {
      console.warn(`[sw] registration failed: ${err && err.message}`);
    });
})();

bindEvents();
loadGame();
syncSettingsUI();
render();
