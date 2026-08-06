const { createEngine } = require("./engine-harness");

for (const difficulty of ["normal", "hard"]) {
  const engine = createEngine();
  const result = engine.json(`(() => {
    state = createGame(SIDES.RED, ${JSON.stringify(difficulty)});
    state.status = "playing";
    state.currentSide = SIDES.BLACK;

    const originalNegamax = negamax;
    let nesting = 0;
    const rootCalls = {};
    negamax = function instrumentedNegamax(...args) {
      if (nesting === 0) rootCalls[args[2]] = (rootCalls[args[2]] || 0) + 1;
      nesting += 1;
      try {
        return originalNegamax(...args);
      } finally {
        nesting -= 1;
      }
    };

    const rootMoveCount = allLegalMoves(state.board, state.currentSide).length;
    const startedAt = performance.now();
    const move = chooseAIMove();
    return {
      difficulty: ${JSON.stringify(difficulty)},
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
      rootMoveCount,
      rootCalls,
      move: { pieceId: move.pieceId, toX: move.toX, toY: move.toY },
    };
  })()`);

  console.log(JSON.stringify(result));
}
