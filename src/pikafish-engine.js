// Pikafish WASM 引擎 wrapper(UCI 客户端,v2 #65/#66)。
//
// 本文件提供:
//   - PikafishEngine 类:基于 Promise 的 UCI 客户端,与具体 wasm loader 解耦
//   - parseUciInfo(line):解析 'info depth N ... pv ...' 行
//   - boardToFen(board, side):v1 board 状态 → xiangqi-WA FEN
//   - moveToUci(move):v1 move → 'h2e2' 字符串
//   - uciToMove(uci, board):'h2e2' → v1 move 对象
//
// 设计要点:
//   1. loader 解耦:wasm 加载函数由调用方注入(浏览器 importScripts / Node require),
//      本模块只负责 UCI 协议。这样单元测试可以传 mock loader,无需真实 wasm。
//   2. 命令-响应配对:每条 UCI 命令按其预期响应(uciok/readyok/bestmove)等待。
//      position/setoption 等无响应命令 fire-and-forget。
//   3. 错误传播:wasm 加载失败 / quit 时未决请求,通过 reject 通知调用方。
//
// FEN 字符表(标准 xiangqi-WA / Pikafish):
//   红:K(帅) A(仕) B(相) N(马) R(车) C(炮) P(兵)
//   黑:k(将) a(士) b(象) n(马) r(车) c(炮) p(卒)
//
// 移动格式(UCI):<from-col a-i><from-row 0-9><to-col><to-row>,
//   列字母 a-i 对应 x=0..8,行数字 0-9 对应 y=0..9。无红黑视角区分。

const PIECE_TYPE_TO_FEN = {
  red: {
    general: "K",
    advisor: "A",
    elephant: "B",
    horse: "N",
    chariot: "R",
    cannon: "C",
    soldier: "P",
  },
  black: {
    general: "k",
    advisor: "a",
    elephant: "b",
    horse: "n",
    chariot: "r",
    cannon: "c",
    soldier: "p",
  },
};

const FEN_TO_PIECE_TYPE = (() => {
  const m = {};
  for (const side of ["red", "black"]) {
    for (const [type, ch] of Object.entries(PIECE_TYPE_TO_FEN[side])) {
      m[ch] = { side, type };
    }
  }
  return m;
})();

// v1 黑方在 y=0(顶部),红方在 y=9(底部),与 xiangqi-WA FEN 行序一致
// (FEN 从 y=0 开始逐行写到 y=9,行内 x=0..8)。
function boardToFen(board, sideToMove, halfMoveClock = 0, fullMoveNumber = 1) {
  const grid = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const piece of board) {
    if (piece.alive) grid[piece.y][piece.x] = piece;
  }
  const rows = [];
  for (let y = 0; y < 10; y++) {
    let row = "";
    let empty = 0;
    for (let x = 0; x < 9; x++) {
      const p = grid[y][x];
      if (!p) {
        empty++;
      } else {
        if (empty > 0) {
          row += String(empty);
          empty = 0;
        }
        row += PIECE_TYPE_TO_FEN[p.side][p.type];
      }
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  const placement = rows.join("/");
  // sideToMove: 'w' = 红方先走(取棋盘约定), 'b' = 黑方先走。
  // xiangqi-WA 沿用 chess 习惯用 w/b 而非 r/b(避免与红方/黑方混淆)。
  const stm = sideToMove === "red" ? "w" : "b";
  return `${placement} ${stm} - - ${halfMoveClock} ${fullMoveNumber}`;
}

// v1 move -> 'h2e2'
function moveToUci(move) {
  const col = (x) => String.fromCharCode(97 + x); // a-i
  return `${col(move.fromX)}${move.fromY}${col(move.toX)}${move.toY}`;
}

// 'h2e2' -> v1 move(给定 board 用于定位 pieceId)
function uciToMove(uci, board) {
  if (!uci || typeof uci !== "string" || uci.length < 4) return null;
  const fromX = uci.charCodeAt(0) - 97;
  const fromY = parseInt(uci[1], 10);
  const toX = uci.charCodeAt(2) - 97;
  const toY = parseInt(uci[3], 10);
  if (fromX < 0 || fromX > 8 || toX < 0 || toX > 8) return null;
  if (isNaN(fromY) || fromY < 0 || fromY > 9) return null;
  if (isNaN(toY) || toY < 0 || toY > 9) return null;
  const piece = board.find((p) => p.alive && p.x === fromX && p.y === fromY);
  if (!piece) return null;
  const target = board.find((p) => p.alive && p.x === toX && p.y === toY);
  return {
    pieceId: piece.id,
    side: piece.side,
    pieceType: piece.type,
    fromX,
    fromY,
    toX,
    toY,
    capturedPieceId: target ? target.id : null,
  };
}

// 解析 'info depth 12 seldepth 15 score cp 234 pv h2e2 h9g7 ...'
function parseUciInfo(line) {
  const tokens = String(line).split(/\s+/);
  const info = { raw: line };
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "depth") info.depth = +tokens[++i];
    else if (t === "seldepth") info.seldepth = +tokens[++i];
    else if (t === "time") info.timeMs = +tokens[++i];
    else if (t === "nodes") info.nodes = +tokens[++i];
    else if (t === "nps") info.nps = +tokens[++i];
    else if (t === "score") {
      const unit = tokens[++i];
      const value = +tokens[++i];
      info.score = { unit, value };
    } else if (t === "pv") {
      info.pv = tokens.slice(i + 1);
      break;
    } else if (t === "currmove") {
      info.currmove = tokens[++i];
    }
  }
  return info;
}

// PikafishEngine: Promise-based UCI 客户端。
//   loader: () => Promise<moduleFactory>  返回 Emscripten module factory
//   options.onInfo: (info) => void  接收每条 'info' 行的解析结果
//   options.onError: (err) => void
class PikafishEngine {
  constructor(loader, options = {}) {
    if (typeof loader !== "function") {
      throw new TypeError("PikafishEngine: loader must be a function");
    }
    this.loader = loader;
    this.onInfo = typeof options.onInfo === "function" ? options.onInfo : () => {};
    this.onError = typeof options.onError === "function" ? options.onError : () => {};
    this._module = null;
    this._engine = null;
    this._resolvers = []; // FIFO 队列,等待 uciok / readyok / bestmove
    this._startPromise = null;
    this._exited = false;
  }

  // 加载 wasm + 发 uci + isready,等待就绪。
  async start() {
    if (this._startPromise) return this._startPromise;
    this._startPromise = (async () => {
      const factory = await this.loader();
      if (typeof factory !== "function") {
        throw new Error("PikafishEngine: loader did not return a module factory");
      }
      this._module = factory;
      this._engine = await factory({
        onReceiveStdout: (line) => this._handleStdout(line),
        onExit: (code) => this._handleExit(code),
      });
      await this.uci();
      await this.isReady();
      return this;
    })();
    return this._startPromise;
  }

  _handleStdout(line) {
    const s = String(line).trim();
    if (!s) return;
    if (s === "uciok" || s === "readyok") {
      const r = this._resolvers.shift();
      if (r) r(s);
      return;
    }
    if (s.startsWith("bestmove")) {
      const m = s.match(/^bestmove\s+(\S+)/);
      const r = this._resolvers.shift();
      if (r) r(m ? m[1] : null);
      return;
    }
    if (s.startsWith("info ")) {
      try {
        this.onInfo(parseUciInfo(s));
      } catch (e) {
        this.onError(e);
      }
      return;
    }
    // 其他输出(id name / id author / option ...)忽略
  }

  _handleExit(code) {
    this._exited = true;
    while (this._resolvers.length) {
      const r = this._resolvers.shift();
      try {
        r(Promise.reject(new Error(`engine exited with code ${code}`)));
      } catch (e) {
        this.onError(e);
      }
    }
  }

  _sendRaw(cmd) {
    if (!this._engine) throw new Error("engine not started");
    if (this._exited) throw new Error("engine already exited");
    this._engine.sendCommand(cmd);
  }

  // 等待响应的命令(uci / isready / go ...)。
  _sendAwaitable(cmd) {
    return new Promise((resolve, reject) => {
      try {
        this._resolvers.push(resolve);
        this._sendRaw(cmd);
      } catch (e) {
        this._resolvers.pop();
        reject(e);
      }
    });
  }

  uci() {
    return this._sendAwaitable("uci");
  }

  isReady() {
    return this._sendAwaitable("isready");
  }

  // position [fen <FEN> | startpos] moves <move-list>(无响应)
  position(fenOrStartpos, moves = []) {
    const pos = fenOrStartpos === "startpos"
      ? "position startpos"
      : `position fen ${fenOrStartpos}`;
    const movesPart = moves.length ? ` moves ${moves.join(" ")}` : "";
    this._sendRaw(pos + movesPart);
  }

  // go depth N -> Promise<bestmove>
  goDepth(depth) {
    return this._sendAwaitable(`go depth ${depth}`);
  }

  // go movetime MS -> Promise<bestmove>
  goMovetime(ms) {
    return this._sendAwaitable(`go movetime ${ms}`);
  }

  // go infinite -> Promise<bestmove>(必须配合 stop() 使用)
  goInfinite() {
    return this._sendAwaitable("go infinite");
  }

  // stop 中断当前 'go infinite' / 'go depth N'(立即触发 bestmove 返回)。
  // 注意:stop 无独立 ack,需要调用方继续 await 原始的 goXxx() Promise。
  stop() {
    this._sendRaw("stop");
  }

  // setoption name <name> value <value>(无响应)
  setOption(name, value) {
    this._sendRaw(`setoption name ${name} value ${value}`);
  }

  // quit(无响应,引擎立即退出)
  quit() {
    if (!this._engine || this._exited) return;
    try {
      this._sendRaw("quit");
    } catch {
      // 已经退出
    }
  }

  // 给 mock 用:暴露当前 pending resolver 数量
  _pendingCount() {
    return this._resolvers.length;
  }
}

// 导出公共 API(浏览器:挂 window;Node:挂 module.exports)。
// 复用 v1 双环境模式,与 src/constants.js / src/rules.js 一致。
if (typeof window !== "undefined") {
  window.PikafishEngine = PikafishEngine;
  window.boardToFen = boardToFen;
  window.moveToUci = moveToUci;
  window.uciToMove = uciToMove;
  window.parseUciInfo = parseUciInfo;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PikafishEngine,
    boardToFen,
    moveToUci,
    uciToMove,
    parseUciInfo,
    PIECE_TYPE_TO_FEN,
    FEN_TO_PIECE_TYPE,
  };
}
