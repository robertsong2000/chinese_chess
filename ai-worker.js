// AI Web Worker(v1 骨架 + v2 #66 Pikafish 集成)。
//
// 双模式:
//   1. v1 自研搜索模式(默认):type="search",无 engine 字段
//      目前 worker 端搜索尚未搬运(子任务 B-full),返回 move=null 触发主线程同步 fallback。
//   2. v2 Pikafish 引擎模式:type="search", engine="pikafish"
//      worker 懒加载 PikafishEngine(浏览器 importScripts / 测试 self.configurePikafish 注入),
//      通过 UCI 协议(position/go depth/bestmove)获得走法,转回 v1 move 对象。
//
// === Worker 输入(主线程 → worker)===
// ping:
//   postMessage({ type: "ping" })
// v1 search:
//   postMessage({
//     type: "search",
//     ctx: { board, currentSide, aiDifficulty, moveHistory, snapshots }
//   })
// v2 pikafish search:
//   postMessage({
//     type: "search",
//     engine: "pikafish",
//     ctx: { board, currentSide, aiDifficulty },
//     depth: 12,          // 可选,覆盖默认按难度映射
//     movetime: 5000,     // 可选,优先于 depth
//   })
// 控制命令:
//   postMessage({ type: "engine-quit" })            // 关闭 Pikafish 引擎释放 wasm 内存
//   postMessage({ type: "engine-status" })          // 查询引擎状态
//
// === Worker 输出(worker → 主线程)===
// 启动:            { type: "ready", tag }
// ping 响应:       { type: "pong", tag }
// v1 占位结果:     { type: "result", move: null, stats: { implemented: false, ... } }
// pikafish 结果:   { type: "result", move: <v1 move>, stats: { engine: "pikafish", durationMs, depth, ... } }
// pikafish 进度:   { type: "engine-info", info: { depth, seldepth, score, pv, ... } }
// pikafish 就绪:   { type: "engine-ready", tag }
// pikafish 状态:   { type: "engine-status", ready, exited, configured }
// 错误:            { type: "error", error, tag }

const WORKER_TAG = "ai-worker";

// Pikafish 引擎单例与配置。
// EngineClass / loaderFactory 缺一时,engine 模式不可用(返回 error)。
// 浏览器:importScripts("./src/pikafish-engine.js") 后 self.PikafishEngine 自动挂载;
//         self.Pikafish 由后续 importScripts("./vendor/pikafish/pikafish.js") 提供(用户运行 download-pikafish.sh 后才有)。
// Node vm 测试:测试通过 self.configurePikafish 注入 mock。
const pikafishConfig_ = {
  EngineClass: null,
  loaderFactory: null,
  // 不同难度的默认 depth(参照目标:hard 5 秒内到达 depth 18)。
  // easy/normal 给较浅 depth,既快又不会吓到新手;hard 直接拉满。
  depthByDifficulty: { easy: 4, normal: 10, hard: 18 },
};

let pikafishEngine_ = null;       // PikafishEngine 单例
let pikafishStartPromise_ = null; // 防并发首次 start

function postSafe(message) {
  if (typeof self !== "undefined" && typeof self.postMessage === "function") {
    self.postMessage(message);
  }
}

function isValidContext(ctx) {
  if (!ctx || typeof ctx !== "object") return false;
  if (!Array.isArray(ctx.board)) return false;
  if (ctx.currentSide !== "red" && ctx.currentSide !== "black") return false;
  if (ctx.aiDifficulty !== "easy" && ctx.aiDifficulty !== "normal" && ctx.aiDifficulty !== "hard") {
    return false;
  }
  return true;
}

// === v1 search(占位)===

function handleSearchV1_(ctx) {
  // 子任务 B-full 待搬运:runAISearch(ctx) → move
  // 当前返回 move=null,主线程会同步 fallback。
  postSafe({
    type: "result",
    move: null,
    stats: { durationMs: 0, maxDepthReached: 0, ttHits: 0, implemented: false },
  });
}

// === Pikafish 引擎模式 ===

// 浏览器启动时:尝试加载 pikafish-engine.js + pikafish.js。
// pikafish-engine.js 总是可入库,加载成功后 self.PikafishEngine 可用。
// pikafish.js 是 ~700KB wasm,gitignored,加载失败时 engine 模式仅返回错误(不影响 v1)。
function bootstrapBrowserPikafish_() {
  if (typeof importScripts !== "function") return;
  // 1) wrapper(总在)
  try {
    importScripts("./src/pikafish-engine.js");
  } catch (err) {
    console.warn("[ai-worker] importScripts pikafish-engine.js failed:", err && err.message);
    return;
  }
  if (typeof self.PikafishEngine === "function") {
    pikafishConfig_.EngineClass = self.PikafishEngine;
  }
  // 2) wasm(用户运行 download-pikafish.sh 后才在);失败仅 warn,不阻塞 worker
  //    用 try/catch 包住,因为 importScripts 找不到文件会抛 TheadError。
  try {
    importScripts("./vendor/pikafish/pikafish.js");
    if (typeof self.Pikafish === "function" || typeof self.Pikafish === "object") {
      pikafishConfig_.loaderFactory = () => Promise.resolve(self.Pikafish);
    }
  } catch (err) {
    console.warn("[ai-worker] pikafish.js not available yet (run download-pikafish.sh):", err && err.message);
  }
}

bootstrapBrowserPikafish_();

// 测试 / 注入接口:覆盖 EngineClass / loaderFactory / depthByDifficulty / helpers。
// 浏览器正常路径不需要调用,bootstrapBrowserPikafish_ 已自动配置(pikafish-engine.js
// 顶层会挂 self.PikafishEngine / self.boardToFen / self.uciToMove / self.moveToUci / self.parseUciInfo)。
self.configurePikafish = function configurePikafish(cfg = {}) {
  if (cfg.EngineClass) pikafishConfig_.EngineClass = cfg.EngineClass;
  if (typeof cfg.loaderFactory === "function") pikafishConfig_.loaderFactory = cfg.loaderFactory;
  if (cfg.depthByDifficulty) {
    pikafishConfig_.depthByDifficulty = {
      ...pikafishConfig_.depthByDifficulty,
      ...cfg.depthByDifficulty,
    };
  }
  // helpers(浏览器路径靠 importScripts 挂 self;测试靠此参数注入)
  if (typeof cfg.boardToFen === "function") {
    pikafishConfig_.boardToFen = cfg.boardToFen;
    if (typeof self !== "undefined") self.boardToFen = cfg.boardToFen;
  }
  if (typeof cfg.uciToMove === "function") {
    pikafishConfig_.uciToMove = cfg.uciToMove;
    if (typeof self !== "undefined") self.uciToMove = cfg.uciToMove;
  }
};

function pikafishConfigured_() {
  return !!(pikafishConfig_.EngineClass && pikafishConfig_.loaderFactory);
}

async function ensurePikafishEngine_() {
  if (pikafishEngine_) return pikafishEngine_;
  if (!pikafishConfigured_()) {
    throw new Error("pikafish not configured (call configurePikafish or importScripts vendor/pikafish/pikafish.js)");
  }
  if (pikafishStartPromise_) return pikafishStartPromise_;
  const EngineClass = pikafishConfig_.EngineClass;
  const onInfo = (info) => postSafe({ type: "engine-info", info, tag: WORKER_TAG });
  const onError = (err) => postSafe({
    type: "error",
    error: `pikafish onInfo: ${(err && err.message) || String(err)}`,
    tag: WORKER_TAG,
  });
  pikafishStartPromise_ = (async () => {
    const engine = new EngineClass(pikafishConfig_.loaderFactory, { onInfo, onError });
    await engine.start();
    pikafishEngine_ = engine;
    postSafe({ type: "engine-ready", tag: WORKER_TAG });
    return engine;
  })();
  try {
    await pikafishStartPromise_;
  } catch (err) {
    // start 失败:清掉单例,下次 search 会重试
    pikafishEngine_ = null;
    pikafishStartPromise_ = null;
    throw err;
  }
  return pikafishEngine_;
}

async function handleSearchPikafish_(ctx, options = {}) {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  let engine;
  try {
    engine = await ensurePikafishEngine_();
  } catch (err) {
    postSafe({
      type: "error",
      error: `pikafish start failed: ${(err && err.message) || String(err)}`,
      tag: WORKER_TAG,
    });
    return;
  }
  // boardToFen / moveToUci / uciToMove 由 pikafish-engine.js 顶层导出挂在 self(浏览器)
  // 或通过 configurePikafish 注入时附带(测试)
  const boardToFen = self.boardToFen || pikafishConfig_.boardToFen;
  const uciToMove = self.uciToMove || pikafishConfig_.uciToMove;
  if (typeof boardToFen !== "function" || typeof uciToMove !== "function") {
    postSafe({
      type: "error",
      error: "boardToFen/uciToMove not available (pikafish-engine.js not loaded)",
      tag: WORKER_TAG,
    });
    return;
  }
  const fen = boardToFen(ctx.board, ctx.currentSide);
  try {
    engine.position(fen);
  } catch (err) {
    postSafe({
      type: "error",
      error: `pikafish position failed: ${(err && err.message) || String(err)}`,
      tag: WORKER_TAG,
    });
    return;
  }
  let bestUci = null;
  let usedMode = "depth";
  try {
    if (options.movetime && options.movetime > 0) {
      bestUci = await engine.goMovetime(options.movetime);
      usedMode = "movetime";
    } else {
      const depth = options.depth && options.depth > 0
        ? options.depth
        : pikafishConfig_.depthByDifficulty[ctx.aiDifficulty] || 10;
      bestUci = await engine.goDepth(depth);
    }
  } catch (err) {
    postSafe({
      type: "error",
      error: `pikafish go failed: ${(err && err.message) || String(err)}`,
      tag: WORKER_TAG,
    });
    return;
  }
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (!bestUci || bestUci === "(none)") {
    postSafe({
      type: "result",
      move: null,
      stats: {
        engine: "pikafish",
        durationMs: Math.round(t1 - t0),
        bestUci: bestUci || null,
        mode: usedMode,
        fen,
      },
    });
    return;
  }
  const move = uciToMove(bestUci, ctx.board);
  postSafe({
    type: "result",
    move,
    stats: {
      engine: "pikafish",
      durationMs: Math.round(t1 - t0),
      bestUci,
      mode: usedMode,
      fen,
    },
  });
}

function handleEngineQuit_() {
  if (pikafishEngine_) {
    try { pikafishEngine_.quit(); } catch (_) { /* ignore */ }
    pikafishEngine_ = null;
    pikafishStartPromise_ = null;
  }
}

function handleEngineStatus_() {
  postSafe({
    type: "engine-status",
    configured: pikafishConfigured_(),
    ready: !!pikafishEngine_,
    exited: !!(pikafishEngine_ && pikafishEngine_._exited),
    tag: WORKER_TAG,
  });
}

// === 主消息分发 ===

self.onmessage = (event) => {
  const data = event && event.data;
  if (!data || typeof data !== "object") {
    postSafe({ type: "error", error: "invalid message", tag: WORKER_TAG });
    return;
  }
  const { type } = data;
  if (type === "ping") {
    postSafe({ type: "pong", tag: WORKER_TAG });
    return;
  }
  if (type === "engine-quit") {
    handleEngineQuit_();
    return;
  }
  if (type === "engine-status") {
    handleEngineStatus_();
    return;
  }
  if (type !== "search") {
    postSafe({ type: "error", error: `unsupported type: ${type}`, tag: WORKER_TAG });
    return;
  }
  const ctx = data.ctx;
  if (!isValidContext(ctx)) {
    postSafe({ type: "error", error: "invalid ctx", tag: WORKER_TAG });
    return;
  }
  if (data.engine === "pikafish") {
    // 异步:engine.start → position → go → result
    handleSearchPikafish_(ctx, { depth: data.depth, movetime: data.movetime });
    return;
  }
  // v1 默认路径(占位)
  handleSearchV1_(ctx);
};

// 启动信号:主线程可据此知道 worker 已就绪
postSafe({ type: "ready", tag: WORKER_TAG });
