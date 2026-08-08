const test = require("node:test");
const assert = require("node:assert/strict");
const { createEngine } = require("./engine-harness");

test("the initial position has 44 legal moves for either side", () => {
  const engine = createEngine();
  const counts = engine.json(`(() => {
    const board = initialPieces();
    return {
      red: allLegalMoves(board, SIDES.RED).length,
      black: allLegalMoves(board, SIDES.BLACK).length,
    };
  })()`);

  assert.deepEqual(counts, { red: 44, black: 44 });
});

for (const difficulty of ["easy", "normal", "hard"]) {
  test(`${difficulty} AI returns a legal move`, () => {
    const engine = createEngine();
    const result = engine.json(`(() => {
      state = createGame(SIDES.RED, ${JSON.stringify(difficulty)});
      state.status = "playing";
      state.currentSide = SIDES.BLACK;
      const move = chooseAIMove();
      const legal = allLegalMoves(state.board, state.currentSide);
      return {
        move,
        isLegal: legal.some((candidate) => candidate.pieceId === move.pieceId
          && candidate.toX === move.toX
          && candidate.toY === move.toY),
      };
    })()`);

    assert.ok(result.move);
    assert.equal(result.isLegal, true);
  });
}

test("move ordering prioritizes an available capture", () => {
  const engine = createEngine();
  const firstMove = engine.json(`(() => {
    const board = initialPieces();
    const moves = allLegalMoves(board, SIDES.BLACK);
    return orderMoves(board, moves, SIDES.BLACK, SIDES.BLACK)[0];
  })()`);

  assert.ok(firstMove.capturedPieceId);
});

test("the initial position evaluates equally for both sides", () => {
  const engine = createEngine();
  const scores = engine.json(`(() => {
    const board = initialPieces();
    return {
      red: evaluateBoard(board, SIDES.RED),
      black: evaluateBoard(board, SIDES.BLACK),
    };
  })()`);

  assert.ok(Math.abs(scores.red) < 1e-9);
  assert.ok(Math.abs(scores.black) < 1e-9);
});

test("check detection matches generated attacks across a deterministic game", () => {
  const engine = createEngine();
  const result = engine.json(`(() => {
    let board = initialPieces();
    let side = SIDES.RED;
    for (let ply = 0; ply < 80; ply += 1) {
      for (const checkedSide of [SIDES.RED, SIDES.BLACK]) {
        const general = board.find((piece) => piece.alive
          && piece.side === checkedSide
          && piece.type === TYPES.GENERAL);
        const reference = !general || livePieces(board)
          .filter((piece) => piece.side !== checkedSide)
          .some((piece) => rawMovesForPiece(board, piece, true)
            .some((move) => move.toX === general.x && move.toY === general.y));
        if (isInCheck(board, checkedSide) !== reference) return { matches: false, ply, checkedSide };
      }
      const moves = allLegalMoves(board, side);
      if (!moves.length) break;
      board = applyMoveToBoard(board, moves[(ply * 17) % moves.length]);
      side = opposite(side);
    }
    return { matches: true };
  })()`);

  assert.deepEqual(result, { matches: true });
});

test("quiescence searches legal evasions instead of standing pat while in check", () => {
  const engine = createEngine();
  const result = engine.json(`(() => {
    let generated = 0;
    let applied = 0;
    evaluateBoard = (board) => board.afterEvasion ? -50 : 1000;
    isInCheck = (board) => !board.afterEvasion;
    allLegalMoves = () => {
      generated += 1;
      return [{ pieceId: "escape", side: SIDES.RED, fromX: 4, fromY: 9, toX: 3, toY: 9, capturedPieceId: null }];
    };
    orderMoves = (_board, moves) => moves;
    applyMoveToBoard = () => {
      applied += 1;
      return { afterEvasion: true };
    };

    const score = quiescence({}, SIDES.RED, -100, 100, SIDES.RED, 1, Infinity);
    return { score, generated, applied };
  })()`);

  assert.equal(result.generated, 1);
  assert.equal(result.applied, 1);
  assert.notEqual(result.score, 100);
});

// 子任务 B1:state 依赖参数化(为 Web Worker 抽取做前置)
// 验证 capturedValue / positionRepetitionCount / rootCyclePenalty / preferNonRepeatingMoves
// 在显式传入与默认 state 等价的参数时,行为完全一致。
test("state-derived helpers behave identically with explicit params vs default state", () => {
  const engine = createEngine();
  const result = engine.json(`(() => {
    // 构造一个带 history 与 snapshots 的中盘状态
    state = createGame(SIDES.RED, "hard");
    state.status = "playing";
    state.currentSide = SIDES.BLACK;
    // 模拟两步 AI 走过的历史(便于 rootCyclePenalty 的 recent-route 分支)
    state.moveHistory.push(
      { pieceId: 1, fromX: 0, fromY: 0, toX: 1, toY: 0, byAI: true, capturedPieceId: null },
      { pieceId: 2, fromX: 8, fromY: 0, toX: 7, toY: 0, byAI: false, capturedPieceId: null },
    );
    state.snapshots.push({
      board: state.board.map((row) => row),
      currentSide: SIDES.RED,
    });

    const moves = allLegalMoves(state.board, state.currentSide);
    if (!moves.length) return { ok: false, reason: "no-moves" };
    const sample = moves[0];

    // capturedValue:默认 state.board vs 显式传 state.board
    const cvDefault = capturedValue(sample);
    const cvExplicit = capturedValue(sample, state.board);

    // positionRepetitionCount:默认 vs 显式 (state, state.snapshots)
    const prcDefault = positionRepetitionCount(state.board, state.currentSide);
    const prcExplicit = positionRepetitionCount(
      state.board, state.currentSide, state, state.snapshots,
    );

    // rootCyclePenalty:默认 vs 显式 opts
    const rcpDefault = rootCyclePenalty(state.board, sample, state.currentSide);
    const rcpExplicit = rootCyclePenalty(state.board, sample, state.currentSide, {
      currentState: state,
      snapshots: state.snapshots,
      moveHistory: state.moveHistory,
    });

    // preferNonRepeatingMoves:默认 vs 显式 opts
    const pnmDefault = preferNonRepeatingMoves(state.board, moves, state.currentSide);
    const pnmExplicit = preferNonRepeatingMoves(state.board, moves, state.currentSide, {
      currentState: state,
      snapshots: state.snapshots,
      moveHistory: state.moveHistory,
    });

    return {
      cvMatch: cvDefault === cvExplicit,
      prcMatch: prcDefault === prcExplicit,
      rcpMatch: rcpDefault === rcpExplicit,
      pnmMatch: pnmDefault.length === pnmExplicit.length,
      movesCount: moves.length,
    };
  })()`);

  assert.equal(result.cvMatch, true, "capturedValue should match");
  assert.equal(result.prcMatch, true, "positionRepetitionCount should match");
  assert.equal(result.rcpMatch, true, "rootCyclePenalty should match");
  assert.equal(result.pnmMatch, true, "preferNonRepeatingMoves length should match");
  assert.ok(result.movesCount > 0);
});

test("SEE returns 0 for non-capture moves", () => {
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = initialPieces();
    const moves = allLegalMoves(board, SIDES.RED).filter((m) => !m.capturedPieceId);
    return moves.length > 0 ? see(board, moves[0]) : -1;
  })()`);
  assert.equal(result, 0);
});

test("SEE returns positive value for an undefended capture", () => {
  // 红兵 (4,5) → (4,4) 吃无保护的黑兵(净赢 100)。
  // 棋盘:双方各一将 + 一红兵 + 一黑兵(无黑方反吃 attacker)
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rs', side: SIDES.RED, type: TYPES.SOLDIER, x: 4, y: 5, alive: true },
      { id: 'bs', side: SIDES.BLACK, type: TYPES.SOLDIER, x: 4, y: 4, alive: true },
    ];
    const move = { pieceId: 'rs', capturedPieceId: 'bs', fromX: 4, fromY: 5, toX: 4, toY: 4 };
    return see(board, move);
  })()`);
  // 黑方无 attacker of (4,4):黑将在 (4,0),palace 限制无法到 (4,4)。净 = 100。
  assert.equal(result, 100);
});

test("SEE returns negative value when capture gets recaptured", () => {
  // 红马 (4,6) → (5,4) 吃黑兵;黑车 (5,0) 能反吃红马。
  // 净 = 100 (兵) - 430 (马) = -330。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rh', side: SIDES.RED, type: TYPES.HORSE, x: 4, y: 6, alive: true },
      { id: 'bs', side: SIDES.BLACK, type: TYPES.SOLDIER, x: 5, y: 4, alive: true },
      { id: 'bc', side: SIDES.BLACK, type: TYPES.CHARIOT, x: 5, y: 0, alive: true },
    ];
    const move = { pieceId: 'rh', capturedPieceId: 'bs', fromX: 4, fromY: 6, toX: 5, toY: 4 };
    return see(board, move);
  })()`);
  assert.equal(result, -330);
});

test("SEE handles chained captures correctly", () => {
  // 双方各 2 兵,红兵吃黑兵被反吃又被反吃:SEE 应为 0(对称交换)。
  // 红兵 A (4,5) 吃黑兵 X (4,4),黑兵 Y (5,4) 反吃 A,红兵 B (5,3) 反吃 Y。
  // 序列:+100(吃 X) -100(失 A) +100(吃 Y) = +100 from RED 视角
  // 但实际上 defender(黑方)在第二步可"停止"(损失 = A - X = 430-100... 这里 A = 100 = 兵)
  // 兵换兵,完全对称,SEE = 0
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'ra', side: SIDES.RED, type: TYPES.SOLDIER, x: 4, y: 5, alive: true },
      { id: 'rb', side: SIDES.RED, type: TYPES.SOLDIER, x: 5, y: 3, alive: true },
      { id: 'bx', side: SIDES.BLACK, type: TYPES.SOLDIER, x: 4, y: 4, alive: true },
      { id: 'by', side: SIDES.BLACK, type: TYPES.SOLDIER, x: 5, y: 4, alive: true },
    ];
    const move = { pieceId: 'ra', capturedPieceId: 'bx', fromX: 4, fromY: 5, toX: 4, toY: 4 };
    return see(board, move);
  })()`);
  // 序列:ra 吃 bx (+100),by 反吃 ra (+100 black),rb 反吃 by (+100 red),无后续。
  // RED 视角:+100 - 100 + 100 = +100
  // 但 black 在第二步可选 stop (gain black view = +100-100=0 vs continue black view = +100-100+100-100=0)
  // 实际上 兵 换 兵 完全对称,最终 SEE = 0(双方最优:不停 capture)
  // 注:negamax 形式下,defender 选 max(0, continue_value)。这里 continue = +100 - seeRec(red, 100)。
  //   seeRec(red, 100): red cheapest = rb,吃 by,= 100 - seeRec(black, 100)。
  //     seeRec(black, 100): black 无更多 attacker → 0。
  //   = 100 - 0 = 100, max(0, 100) = 100。
  // continue_value = 100 - 100 = 0。max(0, 0) = 0(black 选 stop 或 continue,均 0)。
  // 最终 SEE = 100 - 0 = 100。
  // 实际行为:Red 兵 A 吃 Black 兵 X,Black 选 stop(因 continue 后 Red 反吃均势,Black 无收益)。Red 净 +100。
  assert.equal(result, 100);
});

test("check extension constants are configured for tactical depth burst", () => {
  // 契约:CHECK_EXTENSION_PLY = 1(单次延伸 1 ply,平衡精度与爆炸风险),
  // MAX_CHECK_EXTENSIONS_PER_LINE = 2(限制单条搜索线最多累加 2 次延伸,防循环将军导致搜索树膨胀),
  // CHECK_EXTENSION_MIN_DEPTH = 2(浅节点不做,避免 isInCheck 在大搜索树中放大成性能瓶颈)。
  const engine = createEngine();
  const result = engine.json(`(() => ({
    ply: CHECK_EXTENSION_PLY,
    max: MAX_CHECK_EXTENSIONS_PER_LINE,
    minDepth: CHECK_EXTENSION_MIN_DEPTH,
  }))()`);
  assert.equal(result.ply, 1, "CHECK_EXTENSION_PLY should be 1");
  assert.equal(result.max, 2, "MAX_CHECK_EXTENSIONS_PER_LINE should be 2");
  assert.equal(result.minDepth, 2, "CHECK_EXTENSION_MIN_DEPTH should be 2");
});

test("check extension: AI prioritizes capturing the checker when in check", () => {
  // 战术局面:黑将被红车直线将军(black 将 (4,1) 与 red 车 (4,5) 同列直线)。
  // black 有两种化解:1) 马 (5,3)→(4,5) 吃车(马走日,马腿 (5,4) 空);
  //                  2) 将 (4,1)→(3,1) 或 (5,1) 逃。
  // 关键:将逃走法后,red 车跟到 (3,5)/(5,5) 将军,black 因 flying general 与 9 宫边界无解 → 2 步 mate。
  // normal 模式 base depth=2 看不到 3-ply mate;check extension 让 black 子搜索 +1 ply,
  // 正好看穿将逃陷阱,从而选吃车(净赢 +430 + 不再被将军)。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 1, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 4, y: 5, alive: true },
      { id: 'bh', side: SIDES.BLACK, type: TYPES.HORSE, x: 5, y: 3, alive: true },
    ];
    state = createGame(SIDES.RED, "normal");
    state.status = "playing";
    state.currentSide = SIDES.BLACK;
    state.board = board;
    state.snapshots = [];
    state.moveHistory = [];
    const move = chooseAIMove();
    return {
      ateChariot: Boolean(move && move.pieceId === 'bh' && move.toX === 4 && move.toY === 5),
      pieceId: move && move.pieceId,
      toX: move && move.toX,
      toY: move && move.toY,
    };
  })()`);
  assert.equal(
    result.ateChariot,
    true,
    `black horse should capture the checking chariot at (4,5); got piece=${result.pieceId} to=(${result.toX},${result.toY})`,
  );
});
