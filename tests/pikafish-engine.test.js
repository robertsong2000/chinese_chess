// PikafishEngine wrapper 单元测试(v2 #65/#66)。
// 用 mock loader 模拟 wasm 模块,验证 UCI 协议 + FEN 转换 + move 转换。

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PikafishEngine,
  boardToFen,
  moveToUci,
  uciToMove,
  parseUciInfo,
  PIECE_TYPE_TO_FEN,
  FEN_TO_PIECE_TYPE,
} = require("../src/pikafish-engine.js");

// === mock wasm 模块工厂 ===
// 创建一个假的 Emscripten module factory,记录所有 sendCommand 调用,
// 并允许测试代码模拟引擎 stdout(uciok/readyok/bestmove/info ...)。
function createMockLoader(opts = {}) {
  const commands = [];
  const state = {
    commands,
    stdout: null,
    exited: false,
  };
  // 模拟引擎实例:sendCommand 只是记下命令(测试通过 emitStdout 模拟引擎响应)
  const fakeEngine = {
    sendCommand(cmd) {
      commands.push(cmd);
      if (typeof state.stdout === "function") {
        // 测试可同步响应
        state.stdout(cmd);
      }
    },
  };
  const factory = (optsArg) => {
    state.opts = optsArg;
    return Promise.resolve(fakeEngine);
  };
  state.factory = factory;
  state.engine = fakeEngine;
  state.emit = (line) => state.opts.onReceiveStdout(line);
  state.emitExit = (code) => state.opts.onExit(code);
  return () => Promise.resolve(factory);
}

// === FEN 转换测试 ===

test("PIECE_TYPE_TO_FEN covers all 7 types for both sides", () => {
  const types = ["general", "advisor", "elephant", "horse", "chariot", "cannon", "soldier"];
  for (const t of types) {
    assert.equal(typeof PIECE_TYPE_TO_FEN.red[t], "string");
    assert.equal(typeof PIECE_TYPE_TO_FEN.black[t], "string");
    // 红方大写,黑方小写
    assert.equal(PIECE_TYPE_TO_FEN.red[t], PIECE_TYPE_TO_FEN.red[t].toUpperCase());
    assert.equal(PIECE_TYPE_TO_FEN.black[t], PIECE_TYPE_TO_FEN.black[t].toLowerCase());
  }
  // 红黑字符成对(除大小写)
  for (const t of types) {
    assert.equal(PIECE_TYPE_TO_FEN.red[t].toLowerCase(), PIECE_TYPE_TO_FEN.black[t]);
  }
});

test("FEN_TO_PIECE_TYPE reverse mapping has 14 entries", () => {
  assert.equal(Object.keys(FEN_TO_PIECE_TYPE).length, 14);
  assert.deepEqual(FEN_TO_PIECE_TYPE.K, { side: "red", type: "general" });
  assert.deepEqual(FEN_TO_PIECE_TYPE.k, { side: "black", type: "general" });
  assert.deepEqual(FEN_TO_PIECE_TYPE.P, { side: "red", type: "soldier" });
  assert.deepEqual(FEN_TO_PIECE_TYPE.p, { side: "black", type: "soldier" });
});

test("boardToFen produces standard xiangqi startpos FEN", () => {
  // 标准 xiangqi startpos:
  //   r n b a k a b n r / . . . . . . . . . / . c . . . . . c . / p . p . p . p . p / . . . . . . . . . /
  //   . . . . . . . . . / P . P . P . P . P / . C . . . . . C . / . . . . . . . . . / R N B A K A B N R
  // 黑方在 y=0(顶部),先手为红(w)。
  const initialBoard = (() => {
    const pieces = [];
    const add = (side, type, x, y) => pieces.push({
      id: `${side}-${type}-${x}-${y}`, side, type, x, y, alive: true,
    });
    for (const side of ["black", "red"]) {
      const y = side === "black" ? 0 : 9;
      const cannonY = side === "black" ? 2 : 7;
      const soldierY = side === "black" ? 3 : 6;
      add(side, "chariot", 0, y);
      add(side, "horse", 1, y);
      add(side, "elephant", 2, y);
      add(side, "advisor", 3, y);
      add(side, "general", 4, y);
      add(side, "advisor", 5, y);
      add(side, "elephant", 6, y);
      add(side, "horse", 7, y);
      add(side, "chariot", 8, y);
      add(side, "cannon", 1, cannonY);
      add(side, "cannon", 7, cannonY);
      for (const x of [0, 2, 4, 6, 8]) add(side, "soldier", x, soldierY);
    }
    return pieces;
  })();

  const fen = boardToFen(initialBoard, "red");
  const parts = fen.split(" ");
  assert.equal(parts[1], "w"); // 红方先走
  assert.equal(parts[5], "1"); // fullMoveNumber
  assert.equal(parts[3], "-"); // no en-passant in xiangqi
  assert.equal(parts[2], "-"); // no castling in xiangqi
  // 第一行(y=0)= 黑方车马象士将士象马车
  assert.equal(parts[0].split("/")[0], "rnbakabnr");
  // 最后一行(y=9)= 红方 RNBAKABNR
  assert.equal(parts[0].split("/")[9], "RNBAKABNR");
  // 红方炮在 y=7 行:x=1 和 x=7
  //   1 空 + C + 5 空 + C + 1 空 = "1C5C1"
  assert.equal(parts[0].split("/")[7], "1C5C1");
  // 黑方炮在 y=2 行:同样结构(小写)
  assert.equal(parts[0].split("/")[2], "1c5c1");
  // 兵卒行(y=6 / y=3):每行 5 个兵卒,在 x=0/2/4/6/8
  //   P . P . P . P . P → "P1P1P1P1P"
  assert.equal(parts[0].split("/")[6], "P1P1P1P1P");
  assert.equal(parts[0].split("/")[3], "p1p1p1p1p");
});

test("boardToFen handles empty squares with run-length", () => {
  // 只有红将 + 黑将,在 (4,9) 和 (4,0)
  const minimal = [
    { id: "b-g", side: "black", type: "general", x: 4, y: 0, alive: true },
    { id: "r-g", side: "red", type: "general", x: 4, y: 9, alive: true },
  ];
  const fen = boardToFen(minimal, "red");
  const rows = fen.split(" ")[0].split("/");
  assert.equal(rows[0], "4k4"); // y=0: 4 空 + k + 4 空
  assert.equal(rows[9], "4K4"); // y=9: 4 空 + K + 4 空
});

test("boardToFen ignores dead pieces", () => {
  const board = [
    { id: "b-g", side: "black", type: "general", x: 4, y: 0, alive: false }, // dead!
    { id: "r-g", side: "red", type: "general", x: 4, y: 9, alive: true },
  ];
  const fen = boardToFen(board, "red");
  const rows = fen.split(" ")[0].split("/");
  assert.equal(rows[0], "9"); // y=0 全空
  assert.equal(rows[9], "4K4");
});

test("boardToFen supports both side-to-move codes", () => {
  const board = [{ id: "r-g", side: "red", type: "general", x: 4, y: 9, alive: true }];
  assert.equal(boardToFen(board, "red").split(" ")[1], "w");
  assert.equal(boardToFen(board, "black").split(" ")[1], "b");
});

// === moveToUci / uciToMove 测试 ===

test("moveToUci converts coordinates to a-i/0-9 notation", () => {
  assert.equal(moveToUci({ fromX: 7, fromY: 2, toX: 4, toY: 2 }), "h2e2");
  assert.equal(moveToUci({ fromX: 0, fromY: 0, toX: 1, toY: 2 }), "a0b2");
  assert.equal(moveToUci({ fromX: 8, fromY: 9, toX: 7, toY: 7 }), "i9h7");
});

test("uciToMove locates the piece on the board and captures target", () => {
  const board = [
    { id: "b-c", side: "black", type: "cannon", x: 7, y: 2, alive: true },
    { id: "r-s", side: "red", type: "soldier", x: 4, y: 2, alive: true },
  ];
  const move = uciToMove("h2e2", board);
  assert.equal(move.pieceId, "b-c");
  assert.equal(move.fromX, 7);
  assert.equal(move.fromY, 2);
  assert.equal(move.toX, 4);
  assert.equal(move.toY, 2);
  assert.equal(move.capturedPieceId, "r-s"); // 红方兵被吃
});

test("uciToMove returns null on malformed input", () => {
  assert.equal(uciToMove(null, []), null);
  assert.equal(uciToMove("xyz", []), null);
  assert.equal(uciToMove("z9z9", []), null); // 越界列
});

test("moveToUci and uciToMove round-trip", () => {
  const board = [
    { id: "r-r", side: "red", type: "chariot", x: 0, y: 9, alive: true },
  ];
  const uci = "a9a5";
  const move = uciToMove(uci, board);
  assert.equal(moveToUci(move), uci);
});

// === parseUciInfo 测试 ===

test("parseUciInfo extracts depth / seldepth / score / pv", () => {
  const info = parseUciInfo("info depth 12 seldepth 15 score cp 234 nodes 12345 nps 1000000 pv h2e2 h9g7 i9h9");
  assert.equal(info.depth, 12);
  assert.equal(info.seldepth, 15);
  assert.deepEqual(info.score, { unit: "cp", value: 234 });
  assert.equal(info.nodes, 12345);
  assert.equal(info.nps, 1000000);
  assert.deepEqual(info.pv, ["h2e2", "h9g7", "i9h9"]);
});

test("parseUciInfo handles mate scores", () => {
  const info = parseUciInfo("info depth 10 score mate 5 pv a0a1");
  assert.deepEqual(info.score, { unit: "mate", value: 5 });
  assert.deepEqual(info.pv, ["a0a1"]);
});

test("parseUciInfo returns raw line for debugging", () => {
  const line = "info string this is a custom message";
  const info = parseUciInfo(line);
  assert.equal(info.raw, line);
  // depth 未出现 → undefined
  assert.equal(info.depth, undefined);
});

// === PikafishEngine 单元测试(mock loader)===

test("PikafishEngine constructor rejects non-function loader", () => {
  assert.throws(() => new PikafishEngine(null), /loader must be a function/);
});

test("PikafishEngine.start loads wasm and completes uci/isready handshake", async () => {
  const loader = createMockLoader();
  const engine = new PikafishEngine(loader);

  // 模拟 wasm 异步发回 uciok + readyok
  // 但 loader 内部 fakeEngine.sendCommand 是同步的,我们要让 start 发出 'uci' 后,
  // 在下一个 tick 模拟 wasm 发回 'uciok'。
  // 用 loader 的 emit 函数:但 loader 已被封装,无法直接 emit。改成异步:用 setTimeout。
  // 简化:让 mock loader 在 sendCommand 时同步触发响应。
  // 重新设计:loader 改为支持 stdout 同步响应

  // 简化测试方案:直接 mock loader 让 sendCommand 同步 emit
  const commands = [];
  const fakeEngine = {
    sendCommand(cmd) {
      commands.push(cmd);
      // 立即同步 emit 响应
      if (cmd === "uci") engine._handleStdout("uciok");
      else if (cmd === "isready") engine._handleStdout("readyok");
    },
  };
  engine.loader = () => Promise.resolve(() => Promise.resolve(fakeEngine));

  await engine.start();
  assert.ok(commands.includes("uci"));
  assert.ok(commands.includes("isready"));
});

test("PikafishEngine.goDepth returns bestmove from engine stdout", async () => {
  const engine = new PikafishEngine(() => Promise.resolve(() => Promise.resolve({
    sendCommand(cmd) {
      if (cmd.startsWith("go depth 5")) {
        // 异步触发 bestmove
        setTimeout(() => engine._handleStdout("bestmove h2e2"), 0);
      }
    },
  })));

  // 跳过 start(直接 mock _engine)
  engine._engine = { sendCommand: (cmd) => {
    if (cmd.startsWith("go depth 5")) {
      setTimeout(() => engine._handleStdout("bestmove h2e2"), 0);
    }
  }};

  const best = await engine.goDepth(5);
  assert.equal(best, "h2e2");
});

test("PikafishEngine.goDepth surfaces info callbacks before bestmove", async () => {
  const infos = [];
  const engine = new PikafishEngine(
    () => Promise.resolve(() => Promise.resolve({})),
    { onInfo: (i) => infos.push(i) },
  );
  engine._engine = {
    sendCommand(cmd) {
      if (cmd.startsWith("go depth 10")) {
        setTimeout(() => {
          engine._handleStdout("info depth 8 score cp 100 pv h2e2");
          engine._handleStdout("info depth 10 score cp 250 pv h2e2 h9g7");
          engine._handleStdout("bestmove h2e2");
        }, 0);
      }
    },
  };

  const best = await engine.goDepth(10);
  assert.equal(best, "h2e2");
  assert.equal(infos.length, 2);
  assert.equal(infos[0].depth, 8);
  assert.equal(infos[1].depth, 10);
  assert.equal(infos[1].score.value, 250);
});

test("PikafishEngine.position builds correct command (fen + moves)", () => {
  const sent = [];
  const engine = new PikafishEngine(() => Promise.resolve(() => Promise.resolve({})));
  engine._engine = { sendCommand: (cmd) => sent.push(cmd) };

  engine.position("startpos");
  engine.position("startpos", ["h2e2", "b9c7"]);
  engine.position("rnbakabnr/9/1c5C1/9/9/9/9/9/9/4K4 w - - 0 1", ["a0a1"]);

  assert.equal(sent[0], "position startpos");
  assert.equal(sent[1], "position startpos moves h2e2 b9c7");
  assert.equal(sent[2], "position fen rnbakabnr/9/1c5C1/9/9/9/9/9/9/4K4 w - - 0 1 moves a0a1");
});

test("PikafishEngine.setOption builds correct command", () => {
  const sent = [];
  const engine = new PikafishEngine(() => Promise.resolve(() => Promise.resolve({})));
  engine._engine = { sendCommand: (cmd) => sent.push(cmd) };

  engine.setOption("Threads", "1");
  engine.setOption("Hash", "128");
  engine.setOption("MultiPV", "1");

  assert.deepEqual(sent, [
    "setoption name Threads value 1",
    "setoption name Hash value 128",
    "setoption name MultiPV value 1",
  ]);
});

test("PikafishEngine._handleExit rejects all pending requests", async () => {
  const engine = new PikafishEngine(() => Promise.resolve(() => Promise.resolve({})));
  engine._engine = { sendCommand: () => { /* go hangs */ } };

  const goPromise = engine.goDepth(20);
  // 模拟 wasm 进程崩溃
  engine._handleExit(1);
  await assert.rejects(goPromise, /engine exited with code 1/);
});

test("PikafishEngine.quit is safe to call before start or after exit", () => {
  const engine = new PikafishEngine(() => Promise.resolve(() => Promise.resolve({})));
  // 未 start → quit 不报错
  engine.quit();
  // 已 exit → quit 不报错
  engine._exited = true;
  engine.quit();
  // ok
});

test("PikafishEngine.sendCommand before start throws", () => {
  const engine = new PikafishEngine(() => Promise.resolve(() => Promise.resolve({})));
  assert.throws(() => engine.position("startpos"), /engine not started/);
});
