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
