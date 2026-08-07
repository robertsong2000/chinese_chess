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
