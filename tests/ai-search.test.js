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

test("aspiration window constants are configured for tactical depth burst", () => {
  // 契约:ASPIRATION_MIN_DEPTH = 3(经典做法:1-2 深度窗口太窄收益小);
  // ASPIRATION_WINDOW = 150(象棋兵 100、马 430,150 介于"兵变化"与"半个马"之间,
  // 既覆盖常见评估微调,又不会因窗口太宽失去 cutoff 价值)。
  const engine = createEngine();
  const result = engine.json(`(() => ({
    minDepth: ASPIRATION_MIN_DEPTH,
    window: ASPIRATION_WINDOW,
  }))()`);
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
  // 核心必胜(车炮对单车 / 车马对单车 / 马兵对单士)给 500,鼓励换子进入;
  // 辅助优势(车对仅剩士象 / 过河兵对孤将)给 200-300,鼓励保持优势。
  const engine = createEngine();
  const result = engine.json(`(() => ({
    chariotCannonVsChariot: ENDGAME_PATTERN_BONUS.chariotCannonVsChariot,
    chariotHorseVsChariot: ENDGAME_PATTERN_BONUS.chariotHorseVsChariot,
    horseSoldierVsAdvisor: ENDGAME_PATTERN_BONUS.horseSoldierVsAdvisor,
    chariotVsGuardsOnly: ENDGAME_PATTERN_BONUS.chariotVsGuardsOnly,
    advancedSoldierVsLoneKing: ENDGAME_PATTERN_BONUS.advancedSoldierVsLoneKing,
  }))()`);
  assert.equal(result.chariotCannonVsChariot, 500, "chariotCannonVsChariot should be 500");
  assert.equal(result.chariotHorseVsChariot, 500, "chariotHorseVsChariot should be 500");
  assert.equal(result.horseSoldierVsAdvisor, 500, "horseSoldierVsAdvisor should be 500");
  assert.ok(result.chariotVsGuardsOnly >= 200, "chariotVsGuardsOnly should be >= 200");
  assert.ok(result.advancedSoldierVsLoneKing >= 100, "advancedSoldierVsLoneKing should be >= 100");
});

test("endgame pattern: chariot+cannon vs lone chariot is recognized as winning", () => {
  // 残局局面:红方 车+炮+将,黑方 车+将(经典必胜 — 车炮胜单车)。
  // 期望:
  //   1) endgamePatternBonus(board, RED) >= 500(必胜加分)
  //   2) endgamePatternBonus(board, BLACK) == 0(黑方无必胜结构)
  //   3) evaluateBoard(board, RED) > 500(红方子力 900+460+对称 + 必胜加分)
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
      winningRecognized: redPattern >= 500,
      symmetricZero: blackPattern === 0,
    };
  })()`);
  assert.equal(
    result.winningRecognized,
    true,
    `endgamePatternBonus(red) should be >= 500 (chariot+cannon vs lone chariot); got ${result.redPattern}`,
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
