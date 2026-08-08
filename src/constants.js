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
