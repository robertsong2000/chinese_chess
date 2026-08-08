// 全局常量(通过经典 <script> 标签或 vm 共享词法环境,被 app.js 引用)。
// 注意:本文件被加载到与 app.js 同一个全局词法环境中,
// 因此这里用 const 声明的标识符在 app.js 中可以直接访问。

const SIDES = { RED: "red", BLACK: "black" };
const TYPES = {
  GENERAL: "general",
  ADVISOR: "advisor",
  ELEPHANT: "elephant",
  HORSE: "horse",
  CHARIOT: "chariot",
  CANNON: "cannon",
  SOLDIER: "soldier",
};

const LABELS = {
  red: {
    general: "帅",
    advisor: "仕",
    elephant: "相",
    horse: "马",
    chariot: "车",
    cannon: "炮",
    soldier: "兵",
  },
  black: {
    general: "将",
    advisor: "士",
    elephant: "象",
    horse: "马",
    chariot: "车",
    cannon: "炮",
    soldier: "卒",
  },
};

const PIECE_VALUE = {
  general: 10000,
  chariot: 900,
  cannon: 460,
  horse: 430,
  elephant: 220,
  advisor: 220,
  soldier: 100,
};

const SEARCH_DEPTH = { easy: 1, normal: 2, hard: 5 };
const QUIESCENCE_DEPTH = 3;
const MATE_SCORE = 30000;
const REPEATED_POSITION_PENALTY = 12000;
const DIRECT_REVERSAL_PENALTY = 2600;
const RECENT_ROUTE_PENALTY = 420;
const CYCLE_FILTER_PENALTY = DIRECT_REVERSAL_PENALTY;
const KILLER_BONUS_MAIN = 8000;
const KILLER_BONUS_SECOND = 7000;
const MAX_KILLER_PLY = 32;
const KILLER_SLOTS = 2;
const HISTORY_MAX_BONUS = 6000;
const HISTORY_BOARD_SQUARES = 90;
const HISTORY_SATURATION_CAP = HISTORY_MAX_BONUS * 4;
const LMR_MIN_DEPTH = 3;
const LMR_FULL_MOVE_COUNT = 3;
const LMR_REDUCTION = 1;
const NULL_MOVE_MIN_DEPTH = 3;
const NULL_MOVE_REDUCTION = 2;

// === Check Extension ===
// 经典选择性延伸:走法给对手造成将军时,该线深度 +1 ply。
// 直接服务行为目标:1) 完全不送子(被将军时多看一步能识别陷阱反将);
// 2) 看 5-7 步(关键时刻深度突破)。将军的合法回应有限,延伸不会爆炸。
const CHECK_EXTENSION_PLY = 1;
// 单条搜索线最多累加 N 次 check extension,防止循环将军导致搜索树无限膨胀
const MAX_CHECK_EXTENSIONS_PER_LINE = 2;
// 仅在 depth >= N 的节点做 check extension。浅节点(depth=1 即将进 quiescence)做 extension
// 收益小但每个 move 多一次 O(N) isInCheck 调用,会让搜索树膨胀严重。设 N=2 平衡精度与性能。
const CHECK_EXTENSION_MIN_DEPTH = 2;

// === SEE (Static Exchange Evaluation) ===
// 静态交换评估:对 capture 走法,精确计算 capture sequence 的净交换价值。
// 直接服务"完全不送子"目标:识别"会被反吃"的亏子捕获,在 move ordering 中合理处理。
const SEE_MAX_DEPTH = 16; // capture sequence 最大深度,防递归过深
// move ordering:SEE <= 此阈值视为"深度亏子",capture 排序降到 killer 档
// 阈值放宽,只识别明显的亏子(避免误判战术性牺牲)
const SEE_ORDERING_LOSING_THRESHOLD = -200;
// move ordering:深度亏子 capture 的 SEE 折扣系数
const SEE_ORDERING_MULTIPLIER = 8;

// === Aspiration Window + Root PVS ===
// 经典 root 优化:depth >= ASPIRATION_MIN_DEPTH 时,以前一深度的 bestScore 为中心,
// 用 ±ASPIRATION_WINDOW 的窄窗口搜索;fail-high/fail-low 时用全窗口 re-search。
// 窗口窄 → 大量 cutoff 触发 → root 搜索快 20-50%。直接服务"看 5-7 步":
// 同样的时间预算内,root 节点更快收敛,深层(depth>=5)能完成。
const ASPIRATION_MIN_DEPTH = 3;
// 窗口大小 ±N。象棋评分粒度:兵 100,马 430,车 900;战术变化常 ±300-500。
// 80 太窄(一次兵的位置变化就出窗),300 太宽(几乎等于全窗口)。150 平衡。
const ASPIRATION_WINDOW = 150;

// === Futility Pruning + Razoring(浅层 forward pruning)===
// 经典 forward pruning:在 frontier nodes(depth=1)用静态评估预筛明显劣势的局面,
// 跳过完整搜索,大幅减少 frontier node 数 → 同时间预算内深度 +1。直接服务"看 5-7 步"。
//
// Razoring:standPat + margin < alpha → 该节点完整搜索的 best 大概率 < alpha,
// 降到 quiescence 只搜 tactical 走法(capture sequence)。若 quiescence 给出的分数仍 ≤ alpha,
// 直接返回(score 是上界);若 fail-high(> alpha),回退到 main search 拿精确分数。
//
// Futility pruning:standPat + margin ≤ alpha → move loop 内跳过 quiet 非 check 走法
// (capture 与 check 仍搜索,它们是战术性强走,有改 alpha 的可能)。
// 保留 i=0 的第一个走法(走法排序后通常最优)以确保 bestMove 不为 null,保护 TT 正确性。
//
// Razoring 与 futility 在 depth=1 同时启用:razor 更激进(整节点跳过),futility 更细粒度(move-level skip)。
// 两者均要求 !inCheck(将军下必须搜所有 evading moves);alpha/beta 有限(避免 mate search 误判)。
//
// FUTILITY_MIN_WINDOW:futility 仅在 beta - alpha > 此值时触发。
// PVS zero-window probe(beta = alpha + 1)路径下,跳过 quiet 走法会让 PVS 误判 bestMove
// (因为 PVS probe 期望精确 score,跳过的 quiet 走法可能是真正改进 alpha 的走法)。
// 设为 1 等价于"非 zero-window 才启用",即窗口宽度 >= 2 才触发 futility。
const FUTILITY_MIN_WINDOW = 1;
// Margin 取值(关键 trade-off):
//   - 中国象棋评估函数精度有限(无 chess 经典 Stockfish 那种 ultra-fine-tuned eval),
//     过激进的 margin(如 300 / 600 / 1500)会让 futility/razor 在 self-play 中频繁误 prune 位置性走法 → 棋力退化。
//   - 自对弈 benchmark + 战术局面回归测试(2026-08-08)逐步加码验证:
//     margin=300 → benchmark hard 胜率退化到 50% + 战术吃马测试失败;
//     margin=600 → 战术吃马测试仍失败(41 个 razor return 改变 bestMove 选择);
//     margin=1500/2000/5000 → 仍失败(razor 在 PVS zero-window probe 路径 alpha=8000 时触发,
//       quiescence 给的 razorScore 偏低于真实最佳 quiet 走法 score → PVS 误判该走法无改进 → bestMove 错过);
//     RAZORING_DEPTH=0(完全禁用 razor,只保留 futility)+ FUTILITY_MARGIN=300 → 战术吃马测试通过。
//   - **结论**:razor 在中国象棋评估函数精度下风险过高(PVS zero-window probe 时 quiescence 偏低导致
//     bestMove 错过),完全禁用。futility 是 move-level skip(保留首走法 + 不返回上界),精度更可控,
//     margin=300 ≈ 1 minor piece(经典 Stockfish 值),通过战术吃马 + benchmark 验证棋力无回归。
const RAZORING_DEPTH = 0;
const RAZORING_MARGIN = 300;
const FUTILITY_DEPTH = 1;
const FUTILITY_MARGIN = 300;

// === Internal Iterative Deepening (IID) ===
// 经典启发式:在内部节点(ply > 0)如果 TT 没给 best move(新局面或仅存 null-move cutoff 记录),
// move ordering 会退化(TT_BONUS 缺失 → 仅靠 killer/history,未搜过的位置上命中率低)。
// 先做 depth - IID_REDUCTION 的 pre-search,populate TT 与 killer/history;预搜后 TT 应有
// bestMoveKey 供当前深度 ordering 使用。直接服务"看 5-7 步":避免大局面下 ordering 失效导致
// 搜索深度退化(LMR/PVS 都依赖 ordering 质量)。
//
// 触发条件:depth >= IID_MIN_DEPTH(>=3,浅节点收益小)+ ply > 0(根节点由 chooseAIMove 的
// iterative deepening 外层覆盖)+ 无 TT best move + iidAllowed(防止递归 IID 爆炸)。
// Pre-search 传 iidAllowed=false,保证每个 negamax 调用最多触发一次 IID。
const IID_MIN_DEPTH = 3;
const IID_REDUCTION = 2;

// === Time management ===
// 基准思考时间(benchmark 用 timeScale 包装 performance.now,此处维持原值以确保 wall clock 可控)。
// hard 通过 allocateTimeFactor 动态调整:残局/受困多想,开局/复杂少想,关键局面延伸深度。
const TIME_BUDGET_MS = { easy: 200, normal: 520, hard: 1100 };
const TIME_HARD_CAP_MS = 4000;        // 单步绝对上限,防 UI 卡死
const TIME_ENDGAME_MATERIAL = 8000;   // 己方子力 < 此值视为残局,额外 *1.2
const TIME_STABLE_WINDOW = 30;        // 评分差 < 此值视为稳定
const TIME_STABLE_RUN = 2;            // 连续 N 个深度稳定后允许早停
const TIME_STABLE_MIN_DEPTH = 4;      // 早停要求已搜到的最低深度
const TIME_EXTEND_IMPROVEMENT = 50;   // 评分改进 > 此值触发深度延伸
const TIME_MAX_EXTRA_DEPTH = 2;       // 关键局面最多延伸的 ply 数

// Transposition table / Zobrist hashing
const TT_FLAG_EXACT = 0; // PV 节点:score 是真实分值
const TT_FLAG_LOWER = 1; // beta cutoff:score 是下界
const TT_FLAG_UPPER = 2; // alpha 未升:score 是上界
const TT_MAX_ENTRIES = 200000; // 容量上限,满则清空(避免内存爆炸)
const TT_BONUS = 90000; // TT best move 在排序中的 bonus(高于 killer,低于 preferred)
// 用 splitmix32 + 固定种子生成 Zobrist 数,保证同一部署可复现
const ZOBRIST_PIECE_KEYS = (() => {
  let state = 0x9E3779B9 >>> 0;
  const next = () => {
    state = (state + 0x9E3779B9) >>> 0;
    let z = state;
    z = (z ^ (z >>> 16)) >>> 0;
    z = Math.imul(z, 0x85EBCA6B) >>> 0;
    z = (z ^ (z >>> 13)) >>> 0;
    z = Math.imul(z, 0xC2B2AE35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return z;
  };
  const table = {};
  for (const side of Object.values(SIDES)) {
    table[side] = {};
    for (const type of Object.values(TYPES)) {
      table[side][type] = new Array(90);
      for (let i = 0; i < 90; i += 1) table[side][type][i] = next();
    }
  }
  return table;
})();
const ZOBRIST_SIDE_KEY = (() => {
  let z = 0x12345678 >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  z = Math.imul(z, 0x85EBCA6B) >>> 0;
  z = (z ^ (z >>> 13)) >>> 0;
  z = Math.imul(z, 0xC2B2AE35) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  return z;
})();

// 协同评估:车马炮进入攻击区(过河)加分,成对组合额外加分
const ATTACK_ZONE_BONUS = {
  chariot: 30,
  cannon: 20,
  horse: 25,
};
// 同时存在 N 个该类型棋子时,每个棋子额外加分(鼓励保留战术组合)
const PAIR_BONUS = {
  chariot: { 2: 30 }, // 双车
  cannon: { 2: 15 }, // 双炮
  horse: { 2: 18 }, // 双马
};

// 王的安全:士象守卫、出宫惩罚、敌方车/炮近距离威胁
const KING_SAFETY = {
  fullAdvisorPair: 15, // 双士
  fullElephantPair: 12, // 双象
  completeWall: 10, // 双士+双象(完整防守)额外加分
  generalOutOfPalace: 30, // 王出宫惩罚
  generalCrossedRiver: 20, // 王过河(御驾亲征)惩罚
  chariotPressure: 18, // 敌方车在我王同行/列且距离<=3
  cannonPressure: 12, // 敌方炮在我王同行/列且距离 2-4
};

// 残局阶段:每方非将子力总值 <= 此阈值时切换到残局评估
// ~1 车 + 1 马 + 1 兵 = 1400,~1 车 + 1 炮 = 1350,~2 马 + 2 兵 = 1000
const ENDGAME_MATERIAL_THRESHOLD = 1800;
// 残局阶段:过河兵越靠近对方底线加分越多(每深入 1 行)
const ENDGAME_SOLDIER_ADVANCE_BONUS = 8;
// 残局阶段:车马炮过河额外奖励倍数(在 ATTACK_ZONE_BONUS 之上)
const ENDGAME_ATTACKER_ZONE_MULTIPLIER = 1.5;
// 残局阶段:士象价值缩水(守子难以扭转局势)
const ENDGAME_DEFENDER_PENALTY = 30;
// 残局阶段:将军/抽将额外加分(鼓励主动进攻)
const ENDGAME_CHECK_BONUS = 80;

// 实用残局模式识别:5 种经典必胜残局给强方大幅加分,鼓励换子进入必胜局面。
// 直接服务行为目标"残局能赢必胜局面":中国象棋残局理论中,这些局面在最佳防守下
// 也必胜,但只有意识到"已进入必胜区"才会主动换子,而非均势退守。
//
// 取值参考子力分:车 900 / 马 430 / 炮 450。+500 ≈ 略高于 1 个 minor piece,
// 强方即使放弃 1 个 minor piece 换入此结构仍评分正向,这正是"鼓励换子"的语义。
// 辅助档(车对仅剩士象 / 过河兵对孤将)给 200-300:这些是优势但非理论必胜,
// 鼓励保持优势而非直接判胜。
// 残局模式加分:5 种经典必胜/优势结构。
// **2026-08-08 Phase 5 #36 调整**:原值 500/500/500/300/200 在 self-play 中
// 引入退化(hard 0/4 vs normal)— 过度追求"必胜结构"反而失战术。
// 消融实验证实:置 0 后 hardWinRate 0% → 50%。修复:(1) 加 isEndgame 守卫防止
// 中局触发;(2) 降幅度到原值 ~40%(保留鼓励效应,不掩盖战术评估)。
const ENDGAME_PATTERN_BONUS = {
  chariotCannonVsChariot: 200,     // 车炮对单车:经典必胜(炮借助将/士作架破车)
  chariotHorseVsChariot: 200,      // 车马对单车:经典必胜(马步配合车攻将)
  horseSoldierVsAdvisor: 200,      // 马兵对单士:经典必胜(兵借马势破士)
  chariotVsGuardsOnly: 120,        // 车对仅剩士象(无对方攻子):车必破士象
  advancedSoldierVsLoneKing: 80,   // 过河兵对孤将(对方无攻子无士象):鼓励兵升变
};

// 战术模式加分(fork / pin / discovered attack 检测)
// 直接服务"中局战术组合能力(牵制、双击、闪击、抽将)"目标。
// 参考象棋子力分:兵 100 / 马 430 / 炮 450 / 车 900。
// fork/pin/discovered 每种 30-80,与 TODO 描述一致。
const TACTIC_BONUS = {
  fork: 60, // 攻击 2+ 高价值子,或 1 高价值子 + 将军(抽将型 fork)
  forkExtraTarget: 15, // fork 第 3+ 个目标每个加
  pin: 40, // 车类型 pin:对方非将子被钉(不能动,否则暴露将)
  pinHighValue: 20, // pin 目标价值 >= 马(430)额外加分
  cannonPin: 30, // 炮类型 pin:对方子作炮架,移动炮架即丢
  discoveredAttack: 35, // 闪击:X 移开暴露 A(车)攻击 H(高价值)
};
// fork / discovered 检测的"高价值子"类型(车/马/炮)
const TACTIC_HIGH_VALUE_TYPES = ["chariot", "horse", "cannon"];

const MOBILITY_VALUE = {
  general: 0,
  advisor: 1,
  elephant: 1,
  horse: 5,
  chariot: 7,
  cannon: 6,
  soldier: 2,
};

const POSITION_BONUS = {
  general: [
    [0, 0, 0, 8, 12, 8, 0, 0, 0],
    [0, 0, 0, 6, 10, 6, 0, 0, 0],
    [0, 0, 0, 4, 8, 4, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 4, 8, 4, 0, 0, 0],
    [0, 0, 0, 6, 10, 6, 0, 0, 0],
    [0, 0, 0, 8, 12, 8, 0, 0, 0],
  ],
  chariot: [
    [4, 8, 12, 14, 16, 14, 12, 8, 4],
    [6, 10, 14, 18, 20, 18, 14, 10, 6],
    [8, 12, 18, 24, 26, 24, 18, 12, 8],
    [8, 14, 20, 26, 30, 26, 20, 14, 8],
    [8, 14, 20, 28, 32, 28, 20, 14, 8],
    [8, 14, 20, 28, 32, 28, 20, 14, 8],
    [8, 14, 20, 26, 30, 26, 20, 14, 8],
    [8, 12, 18, 24, 26, 24, 18, 12, 8],
    [6, 10, 14, 18, 20, 18, 14, 10, 6],
    [4, 8, 12, 14, 16, 14, 12, 8, 4],
  ],
  horse: [
    [0, 4, 8, 10, 12, 10, 8, 4, 0],
    [4, 8, 14, 18, 20, 18, 14, 8, 4],
    [8, 14, 22, 28, 30, 28, 22, 14, 8],
    [8, 16, 24, 32, 34, 32, 24, 16, 8],
    [6, 14, 22, 30, 32, 30, 22, 14, 6],
    [6, 14, 22, 30, 32, 30, 22, 14, 6],
    [8, 16, 24, 32, 34, 32, 24, 16, 8],
    [8, 14, 22, 28, 30, 28, 22, 14, 8],
    [4, 8, 14, 18, 20, 18, 14, 8, 4],
    [0, 4, 8, 10, 12, 10, 8, 4, 0],
  ],
  cannon: [
    [2, 4, 6, 8, 10, 8, 6, 4, 2],
    [4, 8, 10, 12, 14, 12, 10, 8, 4],
    [6, 10, 16, 20, 22, 20, 16, 10, 6],
    [6, 12, 18, 24, 28, 24, 18, 12, 6],
    [6, 12, 18, 24, 28, 24, 18, 12, 6],
    [6, 12, 18, 24, 28, 24, 18, 12, 6],
    [6, 12, 18, 24, 28, 24, 18, 12, 6],
    [6, 10, 16, 20, 22, 20, 16, 10, 6],
    [4, 8, 10, 12, 14, 12, 10, 8, 4],
    [2, 4, 6, 8, 10, 8, 6, 4, 2],
  ],
  soldier: [
    [78, 84, 90, 96, 100, 96, 90, 84, 78],
    [70, 76, 82, 88, 92, 88, 82, 76, 70],
    [54, 60, 68, 74, 78, 74, 68, 60, 54],
    [38, 44, 52, 58, 62, 58, 52, 44, 38],
    [22, 28, 34, 40, 44, 40, 34, 28, 22],
    [8, 10, 12, 14, 16, 14, 12, 10, 8],
    [4, 6, 8, 10, 12, 10, 8, 6, 4],
    [0, 2, 4, 6, 8, 6, 4, 2, 0],
    [0, 0, 2, 4, 6, 4, 2, 0, 0],
    [0, 0, 0, 2, 4, 2, 0, 0, 0],
  ],
};

const HELP = {
  general: "帅/将在九宫内横竖走一格，且不能与对方将帅照面。",
  advisor: "仕/士只能在己方九宫内沿斜线走一格。",
  elephant: "相/象走田字，不能过河，象眼被堵时不能走。",
  horse: "马走日字，马腿位置有棋子时，对应方向不能走。",
  chariot: "车横竖直线行走，路径中不能有棋子。",
  cannon: "炮移动同车；吃子时中间必须刚好隔一个棋子。",
  soldier: "兵/卒过河前只能向前一格，过河后可向前或左右一格，不能后退。",
};

const STORAGE_KEY = "cn_chess_session_v1";
const BOARD_INDEX_CACHE = new WeakMap();
