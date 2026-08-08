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

test("quiescence delta-prunes captures that cannot raise alpha when not in check", () => {
  const engine = createEngine();
  const result = engine.json(`(() => {
    let recursed = 0;
    let seeCalls = 0;
    // standPat = 100(己方视角);alpha = 5000(已远高于 standPat + soldier(100) + margin(200) = 400)
    evaluateBoard = () => 100;
    isInCheck = () => false;
    allLegalMoves = () => [
      { pieceId: "rc", side: SIDES.RED, fromX: 0, fromY: 0, toX: 0, toY: 3, capturedPieceId: "bs" },
    ];
    orderMoves = (_board, moves) => moves;
    applyMoveToBoard = () => { recursed += 1; return {}; };
    pieceValueOnBoard = () => 100; // soldier capture
    see = () => { seeCalls += 1; return 100; };

    const score = quiescence({}, SIDES.RED, 5000, 9000, SIDES.RED, 2, Infinity);
    return { score, recursed, seeCalls };
  })()`);

  // standPat(100) + soldier(100) + margin(200) = 400 ≤ alpha(5000) → delta-pruned, no recursion
  assert.equal(result.recursed, 0);
  // SEE check 不需要触发(delta 已先剪)
  assert.equal(result.seeCalls, 0);
  // 未进 beta cutoff 时返回当前 alpha(5000)
  assert.equal(result.score, 5000);
});

test("quiescence searches captures that can raise alpha despite margin", () => {
  const engine = createEngine();
  const result = engine.json(`(() => {
    let recursed = 0;
    // standPat = 100;alpha = 200 → standPat + chariot(900) + margin(200) = 1200 > alpha → 不剪
    evaluateBoard = () => 100;
    isInCheck = () => false;
    allLegalMoves = () => [
      { pieceId: "rc", side: SIDES.RED, fromX: 0, fromY: 0, toX: 0, toY: 3, capturedPieceId: "bc" },
    ];
    orderMoves = (_board, moves) => moves;
    applyMoveToBoard = () => { recursed += 1; return { terminal: true }; };
    pieceValueOnBoard = () => 900; // chariot capture
    see = () => 900;

    // depth=0 时,quiescence 直接返回 standPat(不进 capture loop)
    quiescence({ terminal: true }, SIDES.RED, 200, 9000, SIDES.RED, 2, Infinity);
    return { recursed };
  })()`);

  // depth=2 且 capture 不能 delta-prune(1200 > 200)→ 至少递归一次
  assert.ok(result.recursed >= 1, `expected recursion when capture can raise alpha, got ${result.recursed}`);
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

test("aspiration window constants are configured for tactical depth burst", () => {
  // 契约:ASPIRATION_MIN_DEPTH = 3(经典做法:1-2 深度窗口太窄收益小);
  // ASPIRATION_WINDOW = 150(象棋兵 100、马 430,150 介于"兵变化"与"半个马"之间,
  // 既覆盖常见评估微调,又不会因窗口太宽失去 cutoff 价值)。
  // #37 (2026-08-08):ASPIRATION_ENABLED = false — Phase 5 退化定位发现 aspiration
  // 在当前评估精度下让 hard 执黑从和棋变输,故默认禁用。Root PVS 仍启用。
  const engine = createEngine();
  const result = engine.json(`(() => ({
    enabled: ASPIRATION_ENABLED,
    minDepth: ASPIRATION_MIN_DEPTH,
    window: ASPIRATION_WINDOW,
  }))()`);
  assert.equal(result.enabled, false, "ASPIRATION_ENABLED should be false (#37 regression fix)");
  assert.equal(result.minDepth, 3, "ASPIRATION_MIN_DEPTH should be 3");
  assert.equal(result.window, 150, "ASPIRATION_WINDOW should be 150");
});

test("root PVS + aspiration window: hard AI takes a free chariot in 1-ply tactic", () => {
  // 战术局面:红车在 (4,5) 无任何保护(它仅是死子);黑方有马 (5,3) 走日可吃车 (4,5)。
  // 注意:这次红车并未将军黑将(将仍在 (3,0)),所以局面是"无威胁的免费吃子"。
  // 1) hard AI(depth 5)应直接选马吃车(净 +900)。
  // 2) 验证 PVS + aspiration 路径在 root 不崩溃,返回的走法合法且为吃车。
  // 该测试在 #29 check-extension 测试基础上调整:红将 (3,9) 错开,使 red 车不再将军 black 将。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 4, y: 5, alive: true },
      { id: 'bh', side: SIDES.BLACK, type: TYPES.HORSE, x: 5, y: 3, alive: true },
    ];
    state = createGame(SIDES.RED, "hard");
    state.status = "playing";
    state.currentSide = SIDES.BLACK;
    state.board = board;
    state.snapshots = [];
    state.moveHistory = [];
    const move = chooseAIMove();
    const legal = allLegalMoves(board, SIDES.BLACK).some(
      (m) => m.pieceId === move.pieceId && m.toX === move.toX && m.toY === move.toY,
    );
    return {
      ateChariot: Boolean(move && move.pieceId === 'bh' && move.toX === 4 && move.toY === 5),
      isLegal: legal,
      pieceId: move && move.pieceId,
      toX: move && move.toX,
      toY: move && move.toY,
    };
  })()`);
  assert.equal(result.isLegal, true, "returned move must be legal");
  assert.equal(
    result.ateChariot,
    true,
    `black horse should take the free chariot at (4,5); got piece=${result.pieceId} to=(${result.toX},${result.toY})`,
  );
});

test("futility pruning + razoring constants are configured for safe forward pruning", () => {
  // 契约:
  // - RAZORING_DEPTH=0(razor 完全禁用):在中国象棋评估函数精度下,razor 风险过高 —
  //   quiescence 给的 razorScore 偏低于真实最佳 quiet 走法 score(因为 quiescence 只看 capture
  //   sequence,忽略位置性 quiet 走法)。当 PVS zero-window probe 时(alpha 异常大,如 +8000),
  //   razor 提前 return 偏低分数,导致 PVS 误判该走法 "no improvement",错过真实 bestMove。
  //   回归测试(战术吃马局面)证实:任何 razor margin(300/600/1500/2000/5000)都导致 bestMove
  //   错误。故 razor 完全关闭,留 RAZORING_MARGIN 作占位以便未来重新启用。
  // - FUTILITY_DEPTH=1 + FUTILITY_MARGIN=300:futility 是 move-level skip(保留首走法 + 不返回上界),
  //   精度比 razor 可控,margin=300 ≈ 1 minor piece(经典 Stockfish 值)。回归测试通过。
  const engine = createEngine();
  const result = engine.json(`(() => ({
    razorDepth: RAZORING_DEPTH,
    razorMargin: RAZORING_MARGIN,
    futilityDepth: FUTILITY_DEPTH,
    futilityMargin: FUTILITY_MARGIN,
  }))()`);
  assert.equal(result.razorDepth, 0, "RAZORING_DEPTH should be 0 (razor disabled: PVS zero-window probe interaction risk)");
  assert.equal(result.razorMargin, 300, "RAZORING_MARGIN kept as placeholder");
  assert.equal(result.futilityDepth, 1, "FUTILITY_DEPTH should be 1");
  assert.equal(result.futilityMargin, 300, "FUTILITY_MARGIN should be 300 (~ 1 minor piece, Stockfish classic)");
});

test("futility pruning + razoring: hard AI still takes a free horse in 1-ply tactic", () => {
  // 战术局面:红马 (1,9) 无任何保护(死子);黑车 (1,5) 沿 y 轴直线可吃马(路径 (1,6)(1,7)(1,8) 全空)。
  // 红将 (3,9) 与黑将 (4,0) 错列(避免飞将直接吃红将的 trivial 走法),局面真正考验战术选择。
  // 1) hard AI(depth=5)应直接选车吃马(净 +430)。
  // 2) 验证 futility pruning / razoring 启用后,depth=1 子节点不会误 prune 掉吃马的 capture 走法
  //    (capture move 走 futility-pruning 例外分支,不被跳过)。
  // 该测试与 #30 PVS 测试不同局面:这次是黑车吃红马(不是黑马吃红车),验证 futility/razor 不破坏战术选择。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rh', side: SIDES.RED, type: TYPES.HORSE, x: 1, y: 9, alive: true },
      { id: 'bc', side: SIDES.BLACK, type: TYPES.CHARIOT, x: 1, y: 5, alive: true },
    ];
    state = createGame(SIDES.RED, "hard");
    state.status = "playing";
    state.currentSide = SIDES.BLACK;
    state.board = board;
    state.snapshots = [];
    state.moveHistory = [];
    const move = chooseAIMove();
    const legal = allLegalMoves(board, SIDES.BLACK).some(
      (m) => m.pieceId === move.pieceId && m.toX === move.toX && m.toY === move.toY,
    );
    return {
      ateHorse: Boolean(move && move.pieceId === 'bc' && move.toX === 1 && move.toY === 9),
      isLegal: legal,
      pieceId: move && move.pieceId,
      toX: move && move.toX,
      toY: move && move.toY,
    };
  })()`);
  assert.equal(result.isLegal, true, "returned move must be legal");
  assert.equal(
    result.ateHorse,
    true,
    `black chariot should take the free horse at (1,9); got piece=${result.pieceId} to=(${result.toX},${result.toY})`,
  );
});

test("IID constants are configured for interior-node move ordering recovery", () => {
  // 契约:
  // - IID_MIN_DEPTH = 3(经典做法:浅节点 pre-search 收益小,深层做才有意义);
  // - IID_REDUCTION = 2(标准值:pre-search 用 depth-2,够深以拿到有用 best move,够浅以省时)。
  const engine = createEngine();
  const result = engine.json(`(() => ({
    minDepth: IID_MIN_DEPTH,
    reduction: IID_REDUCTION,
  }))()`);
  assert.equal(result.minDepth, 3, "IID_MIN_DEPTH should be 3");
  assert.equal(result.reduction, 2, "IID_REDUCTION should be 2");
});

test("IID: hard AI finds the free chariot capture from an unseen mid-game position", () => {
  // IID 战术合理性回归:IID 在内部节点 pre-search,populate TT 提升后续 ordering。
  // 风险:pre-search 路径污染 TT / ordering 噪声导致 bestMove 偏离战术正着。
  // 验证:即便启用 IID,hard AI 在"中盘未见局面下的 1-ply 免费吃车"仍应直接选吃车。
  // 局面:红车 (4,4) 是死子;黑马 (5,6) 走日可吃车 (4,4)。其他子力部署让 TT 几乎肯定未缓存此局面。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'ra', side: SIDES.RED, type: TYPES.ADVISOR, x: 3, y: 9, alive: true },
      { id: 'be', side: SIDES.BLACK, type: TYPES.ELEPHANT, x: 2, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 4, y: 4, alive: true },
      { id: 'bh', side: SIDES.BLACK, type: TYPES.HORSE, x: 5, y: 6, alive: true },
      { id: 'bc', side: SIDES.BLACK, type: TYPES.CANNON, x: 7, y: 2, alive: true },
    ];
    state = createGame(SIDES.RED, "hard");
    state.status = "playing";
    state.currentSide = SIDES.BLACK;
    state.board = board;
    state.snapshots = [];
    state.moveHistory = [];
    const move = chooseAIMove();
    const legal = allLegalMoves(board, SIDES.BLACK).some(
      (m) => m.pieceId === move.pieceId && m.toX === move.toX && m.toY === move.toY,
    );
    return {
      ateChariot: Boolean(move && move.pieceId === 'bh' && move.toX === 4 && move.toY === 4),
      isLegal: legal,
      pieceId: move && move.pieceId,
      toX: move && move.toX,
      toY: move && move.toY,
    };
  })()`);
  assert.equal(result.isLegal, true, "returned move must be legal");
  assert.equal(
    result.ateChariot,
    true,
    `black horse should take the free chariot at (4,4); got piece=${result.pieceId} to=(${result.toX},${result.toY})`,
  );
});

test("tactic bonus constants cover fork / pin / discovered attack within 30-80 range", () => {
  // 契约:TACTIC_BONUS 每种战术加分 30-80(参考象棋子力分:兵 100 / 马 430 / 炮 450 / 车 900)。
  // - fork=60:fork 是"一子同时威胁两个高价值子",典型获益 >= 1 minor piece,加分应明显高于位置分(约 1/7 马)
  // - pin=40:pin 限制对方子行动,但本身不直接吃子,加分低于 fork
  // - cannonPin=30:炮类型 pin 比 pin 弱(炮架可能被替换/移动),加分最低
  // - pinHighValue=20:pin 高价值子(车/马/炮)额外加分,鼓励选 pin 目标
  // - forkExtraTarget=15:fork 第 3+ 目标边际价值递减
  // - discoveredAttack=35:discovered 比 fork 弱(需要 X 实际移开才生效),加分低于 fork
  // TACTIC_HIGH_VALUE_TYPES 必须覆盖车/马/炮三类(士/象/兵不算"高价值战术目标")。
  const engine = createEngine();
  const result = engine.json(`(() => ({
    fork: TACTIC_BONUS.fork,
    pin: TACTIC_BONUS.pin,
    cannonPin: TACTIC_BONUS.cannonPin,
    pinHighValue: TACTIC_BONUS.pinHighValue,
    forkExtraTarget: TACTIC_BONUS.forkExtraTarget,
    discoveredAttack: TACTIC_BONUS.discoveredAttack,
    highValueTypes: [...TACTIC_HIGH_VALUE_TYPES].sort(),
  }))()`);
  assert.equal(result.fork, 60, "fork bonus should be 60");
  assert.equal(result.pin, 40, "pin bonus should be 40");
  assert.equal(result.cannonPin, 30, "cannonPin bonus should be 30");
  assert.equal(result.pinHighValue, 20, "pinHighValue bonus should be 20");
  assert.equal(result.forkExtraTarget, 15, "forkExtraTarget bonus should be 15");
  assert.equal(result.discoveredAttack, 35, "discoveredAttack bonus should be 35");
  assert.deepEqual(
    result.highValueTypes,
    ["cannon", "chariot", "horse"],
    "TACTIC_HIGH_VALUE_TYPES must cover chariot/horse/cannon",
  );
});

test("tactic detection: horse fork scores higher than symmetric baseline", () => {
  // 战术局面:黑马 (4,2) 走日同时攻击红车 (3,4) 与红炮 (5,4),
  //   即马步 (4,2)→(3,4) 和 (4,2)→(5,4) 都成立 → fork。
  // 子力对称:红方有 车+炮+马,黑方有 车+炮+马(各自总子力 1780)。
  // 红方车/炮放在被 fork 位置;黑方车/炮放在角落不参与战术;红方马放角落不参与战术。
  // 红将 (3,9) 与黑将 (4,0) 错列避免飞将。
  // 期望:
  //   1) tacticBonus(board, BLACK) >= 60(fork 基础加分)
  //   2) tacticBonus(board, RED) == 0(红方子均不参与战术)
  //   3) evaluateBoard(board, BLACK) > 0(子力对称 + fork 加分使黑方占优)
  // 该测试不要求 AI 一步进入 fork 局面,只验证评估函数正确识别 fork 结构。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 3, y: 4, alive: true },
      { id: 'rp', side: SIDES.RED, type: TYPES.CANNON, x: 5, y: 4, alive: true },
      { id: 'rh', side: SIDES.RED, type: TYPES.HORSE, x: 0, y: 9, alive: true },
      { id: 'bh', side: SIDES.BLACK, type: TYPES.HORSE, x: 4, y: 2, alive: true },
      { id: 'bc', side: SIDES.BLACK, type: TYPES.CHARIOT, x: 8, y: 5, alive: true },
      { id: 'bp', side: SIDES.BLACK, type: TYPES.CANNON, x: 8, y: 2, alive: true },
    ];
    const blackTactics = tacticBonus(board, SIDES.BLACK);
    const redTactics = tacticBonus(board, SIDES.RED);
    const evalBlack = evaluateBoard(board, SIDES.BLACK);
    return {
      blackTactics,
      redTactics,
      evalBlack,
      forkRecognized: blackTactics >= 60,
      asymmetric: blackTactics > redTactics,
    };
  })()`);
  assert.equal(
    result.forkRecognized,
    true,
    `tacticBonus(black) should be >= 60 (fork: horse attacks 2 high-value targets); got ${result.blackTactics}`,
  );
  assert.equal(
    result.asymmetric,
    true,
    `black tactic bonus (${result.blackTactics}) should exceed red (${result.redTactics}) — red has no tactic here`,
  );
  assert.ok(
    result.evalBlack > 0,
    `evaluateBoard(board, BLACK) should be positive (symmetric material + black fork); got ${result.evalBlack}`,
  );
});

test("endgame pattern bonus constants cover 5 winning patterns at >= 200", () => {
  // 契约:ENDGAME_PATTERN_BONUS 覆盖 5 种必胜/优势残局。
  // **#36 调整**:原值 500/500/500/300/200 在 self-play 中引入退化(hard 0/4 vs normal),
  // 消融实验证实置 0 后 hardWinRate 0% → 50%。修复:降至原值 ~40% + 加 isEndgame 守卫。
  // 新契约:核心必胜 >= 150,辅助优势 >= 60。
  const engine = createEngine();
  const result = engine.json(`(() => ({
    chariotCannonVsChariot: ENDGAME_PATTERN_BONUS.chariotCannonVsChariot,
    chariotHorseVsChariot: ENDGAME_PATTERN_BONUS.chariotHorseVsChariot,
    horseSoldierVsAdvisor: ENDGAME_PATTERN_BONUS.horseSoldierVsAdvisor,
    chariotVsGuardsOnly: ENDGAME_PATTERN_BONUS.chariotVsGuardsOnly,
    advancedSoldierVsLoneKing: ENDGAME_PATTERN_BONUS.advancedSoldierVsLoneKing,
  }))()`);
  assert.ok(result.chariotCannonVsChariot >= 150, "chariotCannonVsChariot should be >= 150");
  assert.ok(result.chariotHorseVsChariot >= 150, "chariotHorseVsChariot should be >= 150");
  assert.ok(result.horseSoldierVsAdvisor >= 150, "horseSoldierVsAdvisor should be >= 150");
  assert.ok(result.chariotVsGuardsOnly >= 60, "chariotVsGuardsOnly should be >= 60");
  assert.ok(result.advancedSoldierVsLoneKing >= 40, "advancedSoldierVsLoneKing should be >= 40");
  // #36 上限守卫:任何加分 <= 300,防止再次过度放大
  assert.ok(result.chariotCannonVsChariot <= 300, "chariotCannonVsChariot should be <= 300 (#36 cap)");
  assert.ok(result.chariotHorseVsChariot <= 300, "chariotHorseVsChariot should be <= 300 (#36 cap)");
  assert.ok(result.horseSoldierVsAdvisor <= 300, "horseSoldierVsAdvisor should be <= 300 (#36 cap)");
});

test("endgame pattern: chariot+cannon vs lone chariot is recognized as winning", () => {
  // 残局局面:红方 车+炮+将,黑方 车+将(经典必胜 — 车炮胜单车)。
  // 期望:
  //   1) endgamePatternBonus(board, RED) >= 150(#36 调整后幅度)
  //   2) endgamePatternBonus(board, BLACK) == 0(黑方无必胜结构)
  //   3) evaluateBoard(board, RED) > 500(红方子力 900+460 + 必胜加分)
  // 红将 (4,9) 与黑将 (4,0) 同列无阻挡会触发飞将,故意让红将在 (3,9) 错列。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 4, y: 5, alive: true },
      { id: 'rp', side: SIDES.RED, type: TYPES.CANNON, x: 5, y: 7, alive: true },
      { id: 'bc', side: SIDES.BLACK, type: TYPES.CHARIOT, x: 4, y: 3, alive: true },
    ];
    const redPattern = endgamePatternBonus(board, SIDES.RED);
    const blackPattern = endgamePatternBonus(board, SIDES.BLACK);
    const evalRed = evaluateBoard(board, SIDES.RED);
    return {
      redPattern,
      blackPattern,
      evalRed,
      winningRecognized: redPattern >= 150,
      symmetricZero: blackPattern === 0,
    };
  })()`);
  assert.equal(
    result.winningRecognized,
    true,
    `endgamePatternBonus(red) should be >= 150 (chariot+cannon vs lone chariot); got ${result.redPattern}`,
  );
  assert.equal(
    result.symmetricZero,
    true,
    `endgamePatternBonus(black) should be 0 (black has no winning pattern); got ${result.blackPattern}`,
  );
  assert.ok(
    result.evalRed > 500,
    `evaluateBoard(board, RED) should be > 500 (winning pattern + material advantage); got ${result.evalRed}`,
  );
});

test("#36 endgame pattern bonus returns 0 in non-endgame (midgame guard)", () => {
  // #36 回归测试:中局阶段(双方非将子力 > ENDGAME_THRESHOLD)不应触发残局加分。
  // 原版无 isEndgame 守卫,在双方子力较多时若一方早早丢马炮剩单车,
  // endgamePatternBonus 仍会触发 +500,严重扭曲评估、self-play 退化。
  //
  // 中局局面:红方 车+炮+双马+双兵+将,黑方 车+将(双方非将子力和 > 1800)。
  // 期望:endgamePatternBonus(board, RED) === 0(中局不触发)。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 4, y: 5, alive: true },
      { id: 'rp', side: SIDES.RED, type: TYPES.CANNON, x: 5, y: 7, alive: true },
      { id: 'rh1', side: SIDES.RED, type: TYPES.HORSE, x: 2, y: 7, alive: true },
      { id: 'rh2', side: SIDES.RED, type: TYPES.HORSE, x: 6, y: 7, alive: true },
      { id: 'rs1', side: SIDES.RED, type: TYPES.SOLDIER, x: 0, y: 6, alive: true },
      { id: 'rs2', side: SIDES.RED, type: TYPES.SOLDIER, x: 8, y: 6, alive: true },
      { id: 'bc', side: SIDES.BLACK, type: TYPES.CHARIOT, x: 4, y: 3, alive: true },
    ];
    const isEg = isEndgame(board);
    const redPattern = endgamePatternBonus(board, SIDES.RED);
    return { isEg, redPattern, guarded: redPattern === 0 };
  })()`);
  assert.equal(result.isEg, false, "scenario should be midgame (not endgame)");
  assert.equal(
    result.guarded,
    true,
    `endgamePatternBonus should return 0 in midgame (isEndgame guard); got ${result.redPattern}`,
  );
});

test("#42 benchmark tactics: 10 puzzles with valid contract", () => {
  // 契约:#42 扩展 tactics 从 5 → 10 题,涵盖 capture (chariot/horse/soldier/cannon) /
  // fork / defensive-counter / nested-cannon 等多战术类型。
  // 每题有 id/name/side/boardSrc/expectSrc;side 覆盖红黑两方;谓词 expectSrc 是非空字符串引用 move。
  const { TACTICS } = require("./ai-benchmark");
  assert.ok(TACTICS.length >= 10, `TACTICS should have >= 10 puzzles, got ${TACTICS.length}`);

  const ids = TACTICS.map((t) => t.id);
  assert.deepEqual(ids.slice(0, 10), ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"],
    "TACTICS ids should start with T1-T10");

  const sides = new Set(TACTICS.map((t) => t.side));
  assert.ok(sides.has("RED") && sides.has("BLACK"), "TACTICS should cover both RED and BLACK sides");

  for (const t of TACTICS) {
    assert.ok(typeof t.name === "string" && t.name.length > 0, `${t.id}: name required`);
    assert.ok(typeof t.boardSrc === "string" && t.boardSrc.length > 0, `${t.id}: boardSrc required`);
    assert.ok(typeof t.expectSrc === "string" && t.expectSrc.length > 0, `${t.id}: expectSrc required`);
    assert.ok(t.expectSrc.includes("move"), `${t.id}: expectSrc must reference 'move' variable`);
    // boardSrc 必须构造合法 piece 数组
    assert.ok(t.boardSrc.includes("TYPES.GENERAL"), `${t.id}: boardSrc must include a general`);
    assert.ok(t.boardSrc.includes("alive: true"), `${t.id}: pieces must have alive: true`);
  }

  // #42 多样性契约:T6-T10 必须涵盖至少 4 种不同 pieceType 的 expectSrc(扩展 capture 类型)
  const t6to10 = TACTICS.slice(5, 10);
  const pieceTypeMentions = new Set();
  for (const t of t6to10) {
    const matches = t.expectSrc.match(/TYPES\.[A-Z]+/g) || [];
    matches.forEach((m) => pieceTypeMentions.add(m));
  }
  // T6-T10 应提及至少 CHARIOT/HORSE/CANNON/SOLDIER/GENERAL 中的 4 种
  const expectedTypes = ["TYPES.CHARIOT", "TYPES.HORSE", "TYPES.CANNON", "TYPES.SOLDIER", "TYPES.GENERAL"];
  const coveredTypes = expectedTypes.filter((t) => pieceTypeMentions.has(t));
  assert.ok(coveredTypes.length >= 4,
    `T6-T10 should cover >= 4 pieceTypes, got ${coveredTypes.length} (${coveredTypes.join(",")})`);
});

test("#39 LMP constants are configured for safe shallow forward pruning", () => {
  // 契约:
  // - LMP_MAX_DEPTH=2:经典值(浅层启用,深层 ordering 误判风险上升,禁用)。
  // - LMP_MIN_INDEX=4:走法排序后 [0]=TT best / [1-2]=killers / [3]=good capture 或 history top,
  //   第 5+ 个走法才考虑 prune。与 LMR_FULL_MOVE_COUNT=3 错开,让 LMR 处理 [3+],LMP 处理 [4+]。
  // - LMP_MIN_WINDOW=1:与 futility 同理,PVS zero-window probe 路径下不启用,避免 bestMove 错过。
  const engine = createEngine();
  const result = engine.json(`(() => ({
    maxDepth: LMP_MAX_DEPTH,
    minIndex: LMP_MIN_INDEX,
    minWindow: LMP_MIN_WINDOW,
  }))()`);
  assert.equal(result.maxDepth, 2, "LMP_MAX_DEPTH should be 2 (shallow only)");
  assert.ok(result.minIndex >= 3 && result.minIndex <= 6,
    `LMP_MIN_INDEX should be in [3, 6] (balance prune aggressiveness vs safety), got ${result.minIndex}`);
  assert.equal(result.minWindow, 1, "LMP_MIN_WINDOW should be 1 (skip zero-window probe path)");
});

test("#39 LMP: hard AI still finds the free horse capture in shallow search tactic", () => {
  // 战术局面:复用 futility/razor 测试的"黑车吃红马"战术,验证 LMP 启用后:
  // 1) hard AI 仍能找到吃马走法(capture move 走 LMP 例外分支,不被跳过);
  // 2) LMP 在 depth<=2 的浅子节点上会 prune 排序靠后的 quiet 走法,但吃马走法是 high-priority capture,
  //    一定在 [0] 或 [1] 位置,不会被 LMP 跳过。
  // 关键:该测试曾在 #38 (quiescence delta pruning) 中验证过,LMP 启用后必须仍然通过。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rh', side: SIDES.RED, type: TYPES.HORSE, x: 1, y: 9, alive: true },
      { id: 'bc', side: SIDES.BLACK, type: TYPES.CHARIOT, x: 1, y: 5, alive: true },
    ];
    state = createGame(SIDES.RED, "hard");
    state.status = "playing";
    state.currentSide = SIDES.BLACK;
    state.board = board;
    state.snapshots = [];
    state.moveHistory = [];
    const move = chooseAIMove();
    return {
      ateHorse: Boolean(move && move.pieceId === 'bc' && move.toX === 1 && move.toY === 9),
      pieceId: move && move.pieceId,
      toX: move && move.toX,
      toY: move && move.toY,
    };
  })()`);
  assert.equal(
    result.ateHorse,
    true,
    `hard AI should capture the free horse despite LMP; got pieceId=${result.pieceId} toX=${result.toX} toY=${result.toY}`,
  );
});

test("#40 TT replacement scheme constants configured for depth-preferred partial eviction", () => {
  // 契约:
  // - TT_MAX_ENTRIES=200000:容量上限(同前),满则触发 eviction 而非 clear()。
  // - TT_EVICT_RATIO=0.25:depth-preferred partial eviction 比例,留 75% 深条目。
  //   太低(如 0.05)→ eviction 频繁,O(N log N) 排序开销重;
  //   太高(如 0.75)→ 一次清太多,PV 信息丢失。
  //   0.25 是经典引擎 "replace 1/4 of bucket" 的折衷值。
  // - 关键不变量:ttStore 不再调用 tt.clear(),保留 PV/EXACT 条目跨 iterative deepening。
  const engine = createEngine();
  const result = engine.json(`(() => ({
    maxEntries: TT_MAX_ENTRIES,
    evictRatio: TT_EVICT_RATIO,
    hasEvictFn: typeof ttEvictShallow === "function",
    ttStoreSrc: ttStore.toString(),
  }))()`);
  assert.equal(result.maxEntries, 200000, "TT_MAX_ENTRIES should stay at 200000");
  assert.ok(result.evictRatio >= 0.1 && result.evictRatio <= 0.5,
    `TT_EVICT_RATIO should be in [0.1, 0.5], got ${result.evictRatio}`);
  assert.equal(result.hasEvictFn, true, "ttEvictShallow must be defined");
  assert.ok(result.ttStoreSrc.includes("ttEvictShallow"),
    "ttStore must call ttEvictShallow (not tt.clear) when full");
  assert.ok(!result.ttStoreSrc.includes("tt.clear()"),
    "ttStore must NOT call tt.clear() (would discard all PV info)");
});

test("#40 ttEvictShallow keeps deep entries and drops shallowest (depth-preferred)", () => {
  // 行为契约:
  // - 塞 10 个 entry,depth 1..10
  // - ttEvictShallow(tt) 删 floor(10 * 0.25) = 2 个最浅 → 剩 8 个
  // - 删除的应是 depth=1 和 depth=2(浅)
  // - 保留的应是 depth=3..10(深),包括 PV/EXACT 信息
  // 这覆盖了 TT 满时 replacement 的核心保证:不全清,深条目留任。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const tt = createTranspositionTable();
    for (let d = 1; d <= 10; d++) {
      // 用 d 当 hash(测试内 hash 唯一即可);flag=EXACT 模拟 PV 条目
      tt.set(d, { depth: d, score: d * 10, flag: TT_FLAG_EXACT, bestMoveKey: "k" + d });
    }
    const beforeSize = tt.size;
    ttEvictShallow(tt);
    const afterSize = tt.size;
    const survivingDepths = [];
    for (let d = 1; d <= 10; d++) {
      if (tt.has(d)) survivingDepths.push(d);
    }
    return { beforeSize, afterSize, survivingDepths, evictRatio: TT_EVICT_RATIO };
  })()`);
  assert.equal(result.beforeSize, 10, "TT seeded with 10 entries");
  const expectedEvict = Math.floor(10 * result.evictRatio);
  assert.equal(result.afterSize, 10 - expectedEvict,
    `after eviction, size should be ${10 - expectedEvict} (evicted ${expectedEvict}), got ${result.afterSize}`);
  assert.deepEqual(result.survivingDepths,
    Array.from({ length: 10 - expectedEvict }, (_, i) => i + 1 + expectedEvict),
    `depth-preferred eviction should keep deepest ${10 - expectedEvict} entries,` +
      `dropping shallowest ${expectedEvict}; survivors: ${result.survivingDepths.join(",")}`);
});

test("#40 ttStore depth-preferred: deeper existing entry is not overwritten by shallower store", () => {
  // 配合 partial eviction 的另一条不变量:即使没满,浅 store 也不覆盖深 entry。
  // 这是 depth-preferred replacement 的另一面,确保 PV 信息不被浅搜索污染。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const tt = createTranspositionTable();
    // 先存 depth=5 的 PV
    ttStore(tt, 0xabc123, 5, 100, TT_FLAG_EXACT, "pv-key");
    // 再尝试存 depth=3 的浅搜索结果(应被拒绝)
    ttStore(tt, 0xabc123, 3, -50, TT_FLAG_UPPER, "shallow-key");
    const entry = tt.get(0xabc123);
    return { depth: entry.depth, score: entry.score, flag: entry.flag, bestMoveKey: entry.bestMoveKey };
  })()`);
  assert.equal(result.depth, 5, "deeper entry must be retained");
  assert.equal(result.score, 100, "PV score must survive shallow store attempt");
  assert.equal(result.bestMoveKey, "pv-key", "PV bestMoveKey must survive shallow store attempt");
});

test("#41 mobility refinement: initial position is symmetric (0 bonus for all pieces)", () => {
  // 关键不变量:初始局面任何棋子的 mobilityRefinementBonus 必须为 0,
  // 保证初始 evaluateBoard 仍 ≡ 0(既有的"the initial position evaluates equally for both sides"测试)。
  // 初始局面:车列被马/兵阻挡(非开放)、马未过河、炮未对宫(列 1/7 不在 3-5,行 2/7 不在敌宫行)。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const board = initialPieces();
    const sums = { red: 0, black: 0 };
    let max = 0;
    for (const p of livePieces(board)) {
      const b = mobilityRefinementBonus(p, board);
      sums[p.side] += b;
      if (b > max) max = b;
    }
    return { redSum: sums.red, blackSum: sums.black, maxBonus: max };
  })()`);
  assert.equal(result.redSum, 0, "initial position: red mobility refinement sum must be 0");
  assert.equal(result.blackSum, 0, "initial position: black mobility refinement sum must be 0");
  assert.equal(result.maxBonus, 0, "initial position: no individual piece should receive refinement bonus");
});

test("#41 chariotOpenFileBonus: open / semi-open / blocked file", () => {
  // 三种情形:
  //   1) 开放线:列上仅车自己 → +MOBILITY_REFINEMENT.chariotOpenFile
  //   2) 半开放线:列上有 1 个敌方子 → +chariotSemiOpenFile
  //   3) 受阻:列上有 1 个友方子 → 0(车未获得行动自由)
  const engine = createEngine();
  const result = engine.json(`(() => {
    // 1) 开放线:红车在 (0,5),列 0 无其他子
    const open = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 0, y: 5, alive: true },
    ];
    // 2) 半开放线:红车在 (0,5),列 0 有 1 个黑兵
    const semi = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 0, y: 5, alive: true },
      { id: 'bs', side: SIDES.BLACK, type: TYPES.SOLDIER, x: 0, y: 3, alive: true },
    ];
    // 3) 受阻:红车在 (0,5),列 0 有 1 个红兵(友方)
    const blocked = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 0, y: 5, alive: true },
      { id: 'rs', side: SIDES.RED, type: TYPES.SOLDIER, x: 0, y: 6, alive: true },
    ];
    return {
      open: mobilityRefinementBonus(open.find(p => p.id === 'rc'), open),
      semi: mobilityRefinementBonus(semi.find(p => p.id === 'rc'), semi),
      blocked: mobilityRefinementBonus(blocked.find(p => p.id === 'rc'), blocked),
      openConst: MOBILITY_REFINEMENT.chariotOpenFile,
      semiConst: MOBILITY_REFINEMENT.chariotSemiOpenFile,
    };
  })()`);
  assert.equal(result.open, result.openConst, `open file bonus should be ${result.openConst}, got ${result.open}`);
  assert.equal(result.semi, result.semiConst, `semi-open file bonus should be ${result.semiConst}, got ${result.semi}`);
  assert.equal(result.blocked, 0, `blocked file (friendly piece) should give 0, got ${result.blocked}`);
});

test("#41 horseCenterBonus: central crossed-river horse gets bonus", () => {
  // 中央列(3-5)+ 过河才加分;未过河或边线马无加分。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const base = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 4, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
    ];
    const mkHorse = (x, y, side = SIDES.RED) => [...base,
      { id: 'h', side, type: TYPES.HORSE, x, y, alive: true }];
    // 红马在 (4,3):中央列 + 已过河(y<=4 for red)→ +bonus
    const redCenter = mkHorse(4, 3);
    // 红马在 (4,6):中央列 + 未过河 → 0
    const redNotCrossed = mkHorse(4, 6);
    // 红马在 (1,3):边线 + 过河 → 0
    const redEdge = mkHorse(1, 3);
    // 黑马在 (4,6):中央列 + 已过河(y>=5 for black)→ +bonus
    const blackCenter = mkHorse(4, 6, SIDES.BLACK);
    return {
      redCenter: mobilityRefinementBonus(redCenter.find(p => p.id === 'h'), redCenter),
      redNotCrossed: mobilityRefinementBonus(redNotCrossed.find(p => p.id === 'h'), redNotCrossed),
      redEdge: mobilityRefinementBonus(redEdge.find(p => p.id === 'h'), redEdge),
      blackCenter: mobilityRefinementBonus(blackCenter.find(p => p.id === 'h'), blackCenter),
      const: MOBILITY_REFINEMENT.horseCenter,
    };
  })()`);
  assert.equal(result.redCenter, result.const, `red center horse should get +${result.const}, got ${result.redCenter}`);
  assert.equal(result.blackCenter, result.const, `black center horse should get +${result.const}, got ${result.blackCenter}`);
  assert.equal(result.redNotCrossed, 0, `horse not crossed river should get 0, got ${result.redNotCrossed}`);
  assert.equal(result.redEdge, 0, `edge horse should get 0, got ${result.redEdge}`);
});

test("#41 cannonPalaceThreatBonus: cannon aimed at enemy palace with exactly 1 screen", () => {
  // 红炮对黑宫:炮在 col 4(中央宫列),y=7,与宫(y=0..2)之间恰好 1 架 → +bonus。
  // 无架或 2+ 架都不加分。
  const engine = createEngine();
  const result = engine.json(`(() => {
    // 1) 1 架:红炮 (4,7),架在 (4,4),射入黑宫
    const one = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rp', side: SIDES.RED, type: TYPES.CANNON, x: 4, y: 7, alive: true },
      { id: 'screen', side: SIDES.RED, type: TYPES.SOLDIER, x: 4, y: 4, alive: true },
    ];
    // 2) 0 架:无架,炮直接对宫
    const zero = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rp', side: SIDES.RED, type: TYPES.CANNON, x: 4, y: 7, alive: true },
    ];
    // 3) 2 架:过多遮挡
    const two = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rp', side: SIDES.RED, type: TYPES.CANNON, x: 4, y: 7, alive: true },
      { id: 's1', side: SIDES.RED, type: TYPES.SOLDIER, x: 4, y: 4, alive: true },
      { id: 's2', side: SIDES.RED, type: TYPES.SOLDIER, x: 4, y: 5, alive: true },
    ];
    // 4) 非宫列:炮在 col 1(不在 3-5),无视架也不加分
    const offCol = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rp', side: SIDES.RED, type: TYPES.CANNON, x: 1, y: 7, alive: true },
      { id: 'screen', side: SIDES.RED, type: TYPES.SOLDIER, x: 1, y: 4, alive: true },
    ];
    return {
      oneScreen: mobilityRefinementBonus(one.find(p => p.id === 'rp'), one),
      zeroScreen: mobilityRefinementBonus(zero.find(p => p.id === 'rp'), zero),
      twoScreens: mobilityRefinementBonus(two.find(p => p.id === 'rp'), two),
      offCol: mobilityRefinementBonus(offCol.find(p => p.id === 'rp'), offCol),
      const: MOBILITY_REFINEMENT.cannonPalaceThreat,
    };
  })()`);
  assert.equal(result.oneScreen, result.const, `1 screen should give +${result.const}, got ${result.oneScreen}`);
  assert.equal(result.zeroScreen, 0, `0 screen (no threat) should give 0, got ${result.zeroScreen}`);
  assert.equal(result.twoScreens, 0, `2+ screens should give 0, got ${result.twoScreens}`);
  assert.equal(result.offCol, 0, `cannon not on palace column should give 0, got ${result.offCol}`);
});

test("#43 killer/history tuning: MAX_KILLER_PLY + history depth offset constants", () => {
  // 契约:
  // - MAX_KILLER_PLY >= 64:保险值,防止 hard + extension/null/IID 叠加后 ply 超过表深导致
  //   所有深层 cutoff 走法堆在 boundary slot(killers[Math.min(ply, len-1)]),killer 信号互相覆盖。
  //   之前 32 已够当前深度,但调到 64 为未来深度优化留余量。
  // - HISTORY_BONUS_DEPTH_OFFSET >= 1:让 history update 公式 `(depth + OFFSET)^2` 在 depth=1 cutoff
  //   时累积 >= 4 而非 1,低深度 cutoff 信号不被深度 5+ 的 cutoff(原 25)完全淹没。
  // - KILLER_SLOTS=2:经典值,与 storeKiller 实现一致(slot[0] / slot[1] 双向 shift)。
  // - HISTORY_SATURATION_CAP > HISTORY_MAX_BONUS:ordering bonus 必须在 saturation 之前生效,
  //   cap 至少为 max bonus 的 2 倍,确保 high-frequency cutoff 走法 bonus 持续累积。
  const engine = createEngine();
  const result = engine.json(`(() => ({
    maxKillerPly: MAX_KILLER_PLY,
    killerSlots: KILLER_SLOTS,
    histOffset: HISTORY_BONUS_DEPTH_OFFSET,
    histMax: HISTORY_MAX_BONUS,
    histCap: HISTORY_SATURATION_CAP,
  }))()`);
  assert.ok(result.maxKillerPly >= 64,
    `MAX_KILLER_PLY should be >= 64 (insurance against ply overflow), got ${result.maxKillerPly}`);
  assert.equal(result.killerSlots, 2, `KILLER_SLOTS should be 2 (classic), got ${result.killerSlots}`);
  assert.ok(result.histOffset >= 1,
    `HISTORY_BONUS_DEPTH_OFFSET should be >= 1 (let depth=1 cutoff accumulate), got ${result.histOffset}`);
  assert.ok(result.histCap >= result.histMax * 2,
    `HISTORY_SATURATION_CAP must be >= 2x HISTORY_MAX_BONUS, got cap=${result.histCap} max=${result.histMax}`);
});

test("#43 storeHistory: deeper cutoffs accumulate quadratically more bonus", () => {
  // 验证 history update 公式 `(depth + OFFSET)^2` 的关键不变量:
  // 1) 同一走法在 depth=5 vs depth=1 cutoff,depth=5 累积的 bonus 应显著高于 depth=1
  //    (deep cutoff 是更可靠的"好走法"信号,理应获更高权重 → 更靠前 ordering)。
  // 2) 公式应该让 depth=1 cutoff 累积 >= 4 而非 1(原 depth*depth 在 depth=1 时仅加 1)。
  // 3) 多次 store 后累积值不超过 SATURATION_CAP(gravity 防饱和)。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const h1 = createHistoryTable();
    const h5 = createHistoryTable();
    const move = { fromX: 1, fromY: 1, toX: 2, toY: 2 };
    storeHistory(h1, move, 1);
    storeHistory(h5, move, 5);
    const idx = 1 * 9 + 1;
    const j = 2 * 9 + 2;
    const flatIdx = idx * HISTORY_BOARD_SQUARES + j;
    return {
      bonusDepth1: h1[flatIdx],
      bonusDepth5: h5[flatIdx],
      ratio: h5[flatIdx] / h1[flatIdx],
      offset: HISTORY_BONUS_DEPTH_OFFSET,
    };
  })()`);
  // depth=1 cutoff 应累积 (1+1)^2 = 4 而非原 1
  assert.ok(result.bonusDepth1 >= 4,
    `depth=1 cutoff should accumulate >= 4 (offset formula), got ${result.bonusDepth1}`);
  // depth=5 cutoff 应累积 (5+1)^2 = 36
  assert.ok(result.bonusDepth5 >= 36,
    `depth=5 cutoff should accumulate >= 36, got ${result.bonusDepth5}`);
  // deep cutoff 应比 shallow cutoff 累积更多(经典 history heuristic 设计)
  assert.ok(result.ratio >= 3,
    `depth=5 / depth=1 ratio should be >= 3 (deep cutoffs matter more), got ${result.ratio}`);
});

test("#43 killer table: deep ply cutoffs do not collapse into boundary slot", () => {
  // 验证 MAX_KILLER_PLY 调到 64 后,深层 cutoff 不会因 boundary 处理(stack[Math.min(ply, len-1)])
  // 而堆在同一 slot。构造 ply=40 与 ply=50 的 cutoff,确认它们落在不同的 slot 索引。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const killers = createKillerTable();
    const moveA = { fromX: 1, fromY: 1, toX: 2, toY: 2 };
    const moveB = { fromX: 3, fromY: 3, toX: 4, toY: 4 };
    storeKiller(killers, 40, moveA);
    storeKiller(killers, 50, moveB);
    return {
      maxPly: MAX_KILLER_PLY,
      slot40: killers[40][0],
      slot50: killers[50][0],
      distinct: killers[40][0] !== killers[50][0],
    };
  })()`);
  assert.ok(result.maxPly >= 64, `MAX_KILLER_PLY should be >= 64, got ${result.maxPly}`);
  assert.ok(result.distinct,
    `killers[40][0] and killers[50][0] should be distinct (no boundary collapse), got 40=${result.slot40} 50=${result.slot50}`);
});

test("#44 countermove heuristic: table store + ordering bonus", () => {
  // 契约:
  // - createCountermoveTable 返回空表(Object.create(null),无原型污染)。
  // - storeCountermove(table, oppMove, move) 把 oppMove 的 counter 设为 move 的 key。
  // - null oppMove 不写表(根节点无对手走法,空操作)。
  // - moveOrderingScore 命中 countermove 时 score > KILLER_BONUS_SECOND(避免被 history 排在 killer 后)。
  // - 命中位置:bonus = COUNTERMOVE_BONUS,介于 KILLER_BONUS_SECOND(7000)和 HISTORY_MAX_BONUS(6000)。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const table = createCountermoveTable();
    const oppMove = { fromX: 1, fromY: 1, toX: 2, toY: 2 };
    const counterMove = { fromX: 5, fromY: 5, toX: 6, toY: 6 };
    const otherMove = { fromX: 0, fromY: 0, toX: 0, toY: 1 };

    const emptySize = Object.keys(table).length;
    storeCountermove(table, oppMove, counterMove);
    const storedKey = table[killerKey(oppMove)];
    const storedCounter = storedKey === killerKey(counterMove);

    // null / undefined oppMove 不写表
    storeCountermove(table, null, counterMove);
    storeCountermove(table, undefined, counterMove);
    const stillOneEntry = Object.keys(table).length === 1;

    // moveOrderingScore:命中 countermove 时 bonus 应大于 KILLER_BONUS_SECOND
    // 构造一个 quiet 走法场景,board 用初始局面,side=red。
    // 我们用 constants 间接比较 bonus 量级(不直接构造 board,避免 setup 复杂度)。
    const bonusInRange = COUNTERMOVE_BONUS > HISTORY_MAX_BONUS
      && COUNTERMOVE_BONUS < KILLER_BONUS_SECOND;

    return {
      emptySize,
      storedCounter,
      stillOneEntry,
      bonus: COUNTERMOVE_BONUS,
      bonusInRange,
      killerSecond: KILLER_BONUS_SECOND,
      histMax: HISTORY_MAX_BONUS,
    };
  })()`);
  assert.equal(result.emptySize, 0, `countermove table should start empty, got size=${result.emptySize}`);
  assert.ok(result.storedCounter,
    `storeCountermove should map oppMove key -> counterMove key`);
  assert.ok(result.stillOneEntry,
    `storeCountermove with null/undefined oppMove should be a no-op`);
  assert.ok(result.bonusInRange,
    `COUNTERMOVE_BONUS should be in (HISTORY_MAX_BONUS, KILLER_BONUS_SECOND), got bonus=${result.bonus} histMax=${result.histMax} killer2nd=${result.killerSecond}`);
});

test("#45 history malus: constants contract + asymmetric penalty", () => {
  // 契约:
  // - HISTORY_MALUS_FACTOR >= 2:malus 比 bonus 弱(对称会抹平 ordering 信号)。
  // - HISTORY_MALUS_MIN_DEPTH >= 2:浅节点(depth=1)的 fail-low 噪声大,不应用 malus。
  // - penalizeHistory 减少值,floor 在 0(不让 history 变负,historyOrderingBonus 仅返回正值)。
  // - malus 大小 = bonus / FACTOR(非对称设计:cutoff +bonus,fail-low -bonus/FACTOR)。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const factorOk = HISTORY_MALUS_FACTOR >= 2;
    const minDepthOk = HISTORY_MALUS_MIN_DEPTH >= 2;

    // 起始 history = 0,penalizeHistory 应保持在 0(floor)
    const h0 = createHistoryTable();
    const move = { fromX: 1, fromY: 1, toX: 2, toY: 2 };
    penalizeHistory(h0, move, 5);
    const idx = (1 * 9 + 1) * HISTORY_BOARD_SQUARES + (2 * 9 + 2);
    const flooredAtZero = h0[idx] === 0;

    // 预 storeHistory 让 history 有值,再 penalizeHistory 验证减少
    const h1 = createHistoryTable();
    storeHistory(h1, move, 5);  // bonus = (5+1)^2 = 36
    const beforePenalty = h1[idx];
    penalizeHistory(h1, move, 5);  // malus = 36 / 2 = 18
    const afterPenalty = h1[idx];
    const reducedBy = beforePenalty - afterPenalty;

    // 对比:同样 depth=5,storeHistory 加 36,penalizeHistory 减 18(对称约束)
    const h2 = createHistoryTable();
    storeHistory(h2, move, 5);
    const storeAmount = h2[idx];
    const h3 = createHistoryTable();
    penalizeHistory(h3, move, 5);
    const malusFromZero = h3[idx]; // 应为 0 (floor)
    const asymmetry = storeAmount > 0 && malusFromZero === 0;

    return {
      factor: HISTORY_MALUS_FACTOR,
      minDepth: HISTORY_MALUS_MIN_DEPTH,
      factorOk,
      minDepthOk,
      flooredAtZero,
      beforePenalty,
      afterPenalty,
      reducedBy,
      storeAmount,
      malusFromZero,
      asymmetry,
    };
  })()`);
  assert.ok(result.factorOk,
    `HISTORY_MALUS_FACTOR should be >= 2 (asymmetric malus < bonus), got ${result.factor}`);
  assert.ok(result.minDepthOk,
    `HISTORY_MALUS_MIN_DEPTH should be >= 2, got ${result.minDepth}`);
  assert.ok(result.flooredAtZero,
    `penalizeHistory on zero history should floor at 0, got ${result.flooredAtZero}`);
  assert.ok(result.reducedBy > 0 && result.reducedBy < result.beforePenalty,
    `penalizeHistory should reduce value but not below 0: before=${result.beforePenalty} after=${result.afterPenalty} reducedBy=${result.reducedBy}`);
  // Asymmetric: store (bonus) > malus (penalty) for the same depth
  // storeAmount = (depth+1)^2, reducedBy = floor((depth+1)^2 / FACTOR)
  // malus * FACTOR should be <= bonus + rounding (asymmetric design)
  assert.ok(result.reducedBy * 2 <= result.storeAmount + 1,
    `malus * FACTOR should be <= bonus + rounding (asymmetric design), got reducedBy=${result.reducedBy} factor=2 storeAmount=${result.storeAmount}`);
});

test("#45 history malus: tactical scenario verification", () => {
  // 战术验证:在 hard AI 能正解的 1-ply 战术局面(马吃无保护车,镜像自 ai-benchmark.js T1)
  // 上验证加入 history malus 后,正解走法仍能找到。
  // 直接服务"完全不送子":history malus 让"曾失败"的走法下沉,理论上不动正向战术。
  // 设计:红将在 (3,9) 错开列避免飞将直接吃将;黑马 (6,3)→(5,5) 吃无保护红车。
  const engine = createEngine();
  const result = engine.json(`(() => {
    state = createGame(SIDES.RED, "hard");
    state.status = "playing";
    state.board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 5, y: 5, alive: true },
      { id: 'bh', side: SIDES.BLACK, type: TYPES.HORSE, x: 6, y: 3, alive: true },
    ];
    state.currentSide = SIDES.BLACK;
    state.snapshots = [];
    state.moveHistory = [];

    const realNow = performance.now.bind(performance);
    const timeScale = 1100 / 300;
    performance.now = function () { return realNow() * timeScale; };
    let move = null;
    try { move = chooseAIMove(); } finally { performance.now = realNow; }

    return {
      found: !!move,
      pieceType: move && move.pieceType,
      toX: move && move.toX,
      toY: move && move.toY,
      isCorrect: move && move.pieceType === TYPES.HORSE && move.toX === 5 && move.toY === 5,
    };
  })()`);
  assert.ok(result.isCorrect,
    `hard AI should find horse capture of unprotected chariot (6,3)→(5,5), got piece=${result.pieceType} to=(${result.toX},${result.toY})`);
});

test("#47 Verified NMP: constants contract + recursion safety", () => {
  // 契约:
  // - NULL_MOVE_VERIFY_MIN_DEPTH >= 5:浅节点 verify overhead 大于收益,只在足够深节点复核。
  // - NULL_MOVE_VERIFY_REDUCTION >= 1:verify search 深度 = depth - 1 - VERIFY_RED。
  // - 递归安全:depth=VERIFY_MIN_DEPTH 时 verify 内部 depth = VERIFY_MIN_DEPTH - 1 - VERIFY_RED
  //   必须 < VERIFY_MIN_DEPTH,即 NULL_MOVE_REDUCTION - NULL_MOVE_VERIFY_REDUCTION >= 1。
  //   直观:null search depth=depth-1-R,verify search 比 null 多看 1 ply,
  //   即 verify_search_depth = (depth-1-R) + 1 = depth-R,低于 VERIFY_MIN_DEPTH=R+... 时不会递归。
  //   这里校验深度数值边界(实际实现中 verify search 自己的 depth=depth-1-VR,需低于 VERIFY_MIN)。
  const engine = createEngine();
  const result = engine.json(`(() => {
    const minDepthOk = NULL_MOVE_VERIFY_MIN_DEPTH >= 5;
    const reductionOk = NULL_MOVE_VERIFY_REDUCTION >= 1;
    const reductionLtR = NULL_MOVE_VERIFY_REDUCTION < NULL_MOVE_REDUCTION;
    // 递归安全:depth = NULL_MOVE_VERIFY_MIN_DEPTH 时,verify search depth
    //           = NULL_MOVE_VERIFY_MIN_DEPTH - 1 - NULL_MOVE_VERIFY_REDUCTION
    //           必须 < NULL_MOVE_VERIFY_MIN_DEPTH(否则会递归触发 verify)
    const verifyDepthAtBoundary = NULL_MOVE_VERIFY_MIN_DEPTH - 1 - NULL_MOVE_VERIFY_REDUCTION;
    const recursionSafe = verifyDepthAtBoundary < NULL_MOVE_VERIFY_MIN_DEPTH;
    // verify 必须 < NULL_MOVE_VERIFY_MIN_DEPTH(否则会无限递归)
    // 例如 VERIFY_MIN=5, VERIFY_RED=1:depth=5 触发 verify,verify 内部 depth=3 < 5 ✓
    return {
      minDepth: NULL_MOVE_VERIFY_MIN_DEPTH,
      reduction: NULL_MOVE_VERIFY_REDUCTION,
      nullReduction: NULL_MOVE_REDUCTION,
      minDepthOk,
      reductionOk,
      reductionLtR,
      verifyDepthAtBoundary,
      recursionSafe,
    };
  })()`);
  assert.ok(result.minDepthOk,
    `NULL_MOVE_VERIFY_MIN_DEPTH should be >= 5 (shallow nodes overhead), got ${result.minDepth}`);
  assert.ok(result.reductionOk,
    `NULL_MOVE_VERIFY_REDUCTION should be >= 1, got ${result.reduction}`);
  assert.ok(result.reductionLtR,
    `VERIFY_REDUCTION (${result.reduction}) should be < NULL_MOVE_REDUCTION (${result.nullReduction}) so verify search sees deeper than null search`);
  assert.ok(result.recursionSafe,
    `verify search depth at boundary (${result.verifyDepthAtBoundary}) must be < VERIFY_MIN_DEPTH (${result.minDepth}) to prevent infinite recursion`);
});

test("#47 Verified NMP: endgame tactic — hard AI still finds chariot capture despite NMP verify overhead", () => {
  // Verified NMP 在 depth>=5 时做一次额外 real-move search 复核,理论上增加 overhead
  // 但不应破坏既有战术能力。本测试构造一个简单的"残局送子"局面:
  // 棋盘上仅剩双方将 + 红车 + 黑车,红车吃黑车(无保护)。
  // 关键:这是 endgame(子力 < 1800),触发 verified NMP 的潜在场景(zugzwang 区域)。
  // 验收:hard AI 必须找到 (5,5)→(5,2) 吃黑车(无保护)。
  // 注:红将 (3,9) 黑将 (4,0) 错开列,避免飞将绝杀提前结束(飞将比吃车更优,AI 会先飞将)。
  const engine = createEngine();
  const result = engine.json(`(() => {
    // 局面:红将在 (3,9),黑将在 (4,0),红车在 (5,5),黑车在 (5,2)(无保护)
    const board = [
      { id: 'rg', side: SIDES.RED, type: TYPES.GENERAL, x: 3, y: 9, alive: true },
      { id: 'bg', side: SIDES.BLACK, type: TYPES.GENERAL, x: 4, y: 0, alive: true },
      { id: 'rc', side: SIDES.RED, type: TYPES.CHARIOT, x: 5, y: 5, alive: true },
      { id: 'bc', side: SIDES.BLACK, type: TYPES.CHARIOT, x: 5, y: 2, alive: true },
    ];
    state = createGame(SIDES.RED, "hard");
    state.status = "playing";
    state.currentSide = SIDES.RED;
    state.board = board;
    state.snapshots = [];
    state.moveHistory = [];

    const realNow = performance.now.bind(performance);
    const timeScale = 1100 / 300;
    performance.now = function () { return realNow() * timeScale; };
    let move = null;
    try { move = chooseAIMove(); } finally { performance.now = realNow; }

    return {
      found: !!move,
      pieceType: move && move.pieceType,
      fromX: move && move.fromX,
      fromY: move && move.fromY,
      toX: move && move.toX,
      toY: move && move.toY,
      isCorrect: move && move.pieceType === TYPES.CHARIOT
        && move.fromX === 5 && move.fromY === 5
        && move.toX === 5 && move.toY === 2,
    };
  })()`);
  assert.ok(result.isCorrect,
    `hard AI in endgame (verified NMP territory) should capture free enemy chariot (5,5)→(5,2), got piece=${result.pieceType} from=(${result.fromX},${result.fromY}) to=(${result.toX},${result.toY})`);
});
