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
// TT mate score 调整阈值(#52):|score| > 此值视为 mate score,TT 存取时调整 ply 偏移。
// 设为 MATE_SCORE - 1000:|score| < 阈值 → 正常评估分;>= 阈值 → mate-in-N(N <= 1000 ply,远超实际搜索深度)。
const MATE_THRESHOLD = MATE_SCORE - 1000;
const REPEATED_POSITION_PENALTY = 12000;
const DIRECT_REVERSAL_PENALTY = 2600;
const RECENT_ROUTE_PENALTY = 420;
const CYCLE_FILTER_PENALTY = DIRECT_REVERSAL_PENALTY;
const KILLER_BONUS_MAIN = 8000;
const KILLER_BONUS_SECOND = 7000;
// MAX_KILLER_PLY 设为 64(#43 调优):hard 模式 SEARCH_DEPTH.hard=5,叠加 check extension(+1/2 ply)、
// null move reduction(depth-3 子搜索)、IID(depth-2 pre-search)、PVS re-search 后,实际 ply 可达 10-15。
// 之前 32 已够,但 64 提供保险:防止未来深度优化后 ply 超过 32 时所有 cutoff 走法堆积在同一 slot
// (Math.min(ply, length-1) 边界处理导致深层 killer 信号互相覆盖)。
const MAX_KILLER_PLY = 64;
const KILLER_SLOTS = 2;
const HISTORY_MAX_BONUS = 6000;
const HISTORY_BOARD_SQUARES = 90;
const HISTORY_SATURATION_CAP = HISTORY_MAX_BONUS * 4;
// History bonus 公式偏移(#43 调优):
// 原 `depth * depth` 在 depth=1 时只加 1,几乎与零深度 noise 不可区分;
// 用 `(depth + OFFSET)^2` 让 depth=1 cutoff 累积 4,depth=5 累积 36,低深度 cutoff 也有可识别信号。
// 直接服务 move ordering 质量 → LMR/PVS 准确性 → 搜索深度。
const HISTORY_BONUS_DEPTH_OFFSET = 1;
// === History Malus (#45) ===
// 经典 Stockfish 技术:storeHistory 在 cutoff 时加 bonus,penalizeHistory 在 fail-low 时减 malus。
// 对称设计会让大多数"既非 cutoff 也非明显失败"的中性走法归零 → ordering 失去区分度。
// 因此 malus = bonus / FACTOR(FACTOR=2),让 malus 比 bonus 弱:仅"明显失败"的走法累积明显负值,
// "中性"走法维持轻微正值或归零。直接服务 move ordering 质量 → PVS/LMR 准确性 → 搜索深度。
// MIN_DEPTH=2:浅节点(depth=1)的 fail-low 信号噪声大(单 ply 战术结果),不应用 malus;
// 从 depth=2 起应用,与 LMR_MIN_DEPTH=3 错开,LMR 处理 [3+],History Malus 处理 [2+]。
const HISTORY_MALUS_FACTOR = 2;
const HISTORY_MALUS_MIN_DEPTH = 2;
const LMR_MIN_DEPTH = 3;
const LMR_FULL_MOVE_COUNT = 3;
const LMR_REDUCTION = 1;
const NULL_MOVE_MIN_DEPTH = 3;
const NULL_MOVE_REDUCTION = 2;
// === Verified NMP ===
// 经典 Stockfish 技术:null move 触发 cutoff(nullScore>=beta)时,若节点足够深,
// 再做一次 reduced 真实走法搜索(同 side,depth-1-VERIFY_REDUCTION)复核。
// verifyScore>=beta 才确认 cutoff,否则 fall-through 走完整搜索。
// 防止两类经典 NMP bug:1) 残局 zugzwang(让一步比走一步好,NMP 误判);
// 2) hidden tactical refutation(reduced null 搜索深度不够看不到)。
// VERIFY_MIN_DEPTH=5:浅节点 verify overhead 大于收益,只在深度 >=5 时复核。
// VERIFY_REDUCTION=1:verify 比 null search 真实深度多 1 ply(NULL_MOVE_REDUCTION-VERIFY_REDUCTION=1),
// 即深度足够看到 null search 错过的战术。verify 自身深度 = depth-2,低于 VERIFY_MIN_DEPTH=5,
// 不会无限递归(depth>=5 才 verify,verify 内部 depth=3-4 不会再 verify)。
const NULL_MOVE_VERIFY_MIN_DEPTH = 5;
const NULL_MOVE_VERIFY_REDUCTION = 1;

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

// === Quiescence Delta Pruning ===
// 经典 quiescence 优化:对 capture 走法,若 standPat + capturedValue + MARGIN ≤ alpha,
// 该 capture 序列不可能提升 alpha,直接剪枝。安全(!inCheck 时):
// 静态评估已含整体子力,capture 只增 capturedValue(乐观上界),+MARGIN 容纳后续可能
// 的额外收益。
// 直接服务"看 5-7 步":quiescence 节点数减少 30-60%,相同 deadline 内主搜索可更深,
// 提升战术深度 + 降低"被 normal 反先"概率。
// MARGIN 取值(2026-08-08 ablation):
//   - 200 ≈ soldier(100) + advisor(220) → self-play hard 执黑从 2 和退化到 0 和 + 2 输
//     (delta 在 alpha 高时误剪 soldier capture,丢失先手 tempo / 战术连接)。
//   - 500 ≈ horse(430) + 70 → 安全窗口覆盖典型 follow-up,平衡速度与精度。
// 经验:中国象棋 eval 精度低于 chess Stockfish,MARGIN 需更保守。
const QUIESCENCE_DELTA_MARGIN = 500;
// SEE-based quiescence pruning 已禁用(self-play 退化);保留常量便于将来重新启用。
const QUIESCENCE_SEE_LOSING_THRESHOLD = 300;

// === Quiescence Check Move Extension ===
// 经典 Stockfish/Roces quiescence 在 !inCheck 时不仅搜 capture,还扩展"非 capture 但能给将军"
// 的走法(quiescence checks)。中国象棋的"将军-抽将/抽子"是常见战术 — 若 quiescence 只看
// capture,会漏看"先将军(quiet)→ 对方 forced evasion → 抽子"的战术组合。
// 直接服务"完全不送子"(不漏看 forced check 威胁)+ "中局战术组合能力"。
//
// 设计要点:
//   - MIN_DEPTH = 2:仅当 quiescence 剩余深度 >= 2 时启用(留 1 ply 给 evasion 搜索)。
//     depth=1 时启用会让 check move 搜索在下一节点立刻 standPat,无法看到 forced 回应。
//   - MAX_MOVES = 3:每节点最多扩展前 3 个 check moves(走法排序后),避免 check move 过多
//     拖慢 quiescence。check move 命中率约 5-10%(经典国际象棋经验),限制 K=3 控制开销。
//   - 用 applyMoveToBoard + isInCheck 检测(最准确,接受 ~O(N) 开销):check 检测的精度
//     直接决定 quiescence 是否漏看 / 误判,轻量近似(如 pieceAttacksSquare)会因忽略走完后
//     board 状态变化(炮架 / 飞将)而误判。
//   - check moves 排序时排在 captures 之后(capture 仍是 quiescence 的核心目标),
//     走法 ordering 已包含 +9000 check bonus(见 moveOrderingScore),自动归类到合理位置。
//   - 递归 quiescence 时,check move 走完后对方被迫 evasion,evasion 包含所有走法
//     (quiescence 已在 inCheck 时搜全 moves),自然终止 forced 序列。
const QUIESCENCE_CHECK_ENABLED = true;
const QUIESCENCE_CHECK_MIN_DEPTH = 2;
const QUIESCENCE_CHECK_MAX_MOVES = 3;

// === Aspiration Window + Root PVS ===
// 经典 root 优化:depth >= ASPIRATION_MIN_DEPTH 时,以前一深度的 bestScore 为中心,
// 用 ±ASPIRATION_WINDOW 的窄窗口搜索;fail-high/fail-low 时用全窗口 re-search。
// 窗口窄 → 大量 cutoff 触发 → root 搜索快 20-50%。直接服务"看 5-7 步":
// 同样的时间预算内,root 节点更快收敛,深层(depth>=5)能完成。
//
// **#37 (2026-08-08) 禁用 Aspiration**:Phase 5 退化定位发现 Aspiration 在当前评估
// 精度下引入退化。ablation 数据(BENCH_GAMES=4 BENCH_HARD_MS=200):
//   - aspiration 启用:hard 执黑 1 和 + 1 输(hardWinRate=0.5)
//   - aspiration 禁用:hard 执黑 2 和(hardWinRate=0.5,但 hard 执黑不再输)
// 根因推测:aspiration 窗口 ±150 在评分剧烈变化时(开局转中局)过窄,fail-high/low
// 频繁触发 re-search,re-search 在剩余 deadline 不足时返回 lower/upper bound,
// 让 prevBestScore 累积漂移。中国象棋评估函数精度有限(无 chess 经典 Stockfish 那种
// ultra-fine-tuned eval),窄窗口风险高于收益。
// 修复方案:保留代码 + ASPIRATION_ENABLED flag,默认 false。Root PVS 仍保留(单独
// 不引入退化)。Future TODO 可在评估函数精度提升后重新启用。
const ASPIRATION_ENABLED = false;
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

// === Late Move Pruning (LMP) ===
// 经典 forward pruning:在浅层节点(depth <= LMP_MAX_DEPTH),走法排序后第 LMP_MIN_INDEX+ 个
// quiet 非 check 走法直接跳过。基于观察:走法排序后靠前的走法(TT best、killer1/2、good capture、
// history top)极少被 prune 之后才出现真实最佳走法;浅层节点的搜索深度不足以让"靠后的 quiet 走法"
// 翻盘。直接服务"看 5-7 步":跳过 60-80% 的 move loop 工作,同时间预算内深度 +1。
//
// 与 futility 的区别:
//   - futility 是"节点级":standPat + margin ≤ alpha 才标记节点 futile,move loop 内才 skip。
//   - LMP 是"走法位置级":不依赖 standPat,仅基于 (depth, index, isQuiet, !check) 直接 skip。
//   两者互补 — futility 处理"评估明显劣势节点",LMP 处理"排序靠后的安静走法"。
//
// 取值:
//   - LMP_MAX_DEPTH=2:经典取值(depth=1/2 启用)。depth>=3 时 ordering 误判风险上升,禁用 LMP。
//   - LMP_MIN_INDEX=4:走法排序后 [0]=TT best / [1]=killer1 / [2]=killer2 / [3]=good capture 或 history top,
//     第 5+ 个走法才考虑 prune。与 LMR_FULL_MOVE_COUNT=3 错开,确保 LMR 处理 [3+],LMP 处理 [4+]。
//   - LMP_MIN_WINDOW=1:与 futility 同理,PVS zero-window probe(beta=alpha+1)路径下不启用,
//     避免在 PVS probe 期望精确 score 时跳过可能改进 alpha 的走法。
const LMP_MAX_DEPTH = 2;
const LMP_MIN_INDEX = 4;
const LMP_MIN_WINDOW = 1;

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

// === Countermove Heuristic ===
// 经典走法排序启发式,与 killer/history 互补:
//   - killer:同 ply 上导致 cutoff 的 quiet 走法(场景级)
//   - history:全局 (from,to) cutoff 次数(全局级)
//   - countermove:针对"对方上一步走法"的最佳回应(refutation 级)
// 当本方搜索中某走法 M 导致 beta cutoff,且对方上一走法是 oppMove,
// 则记下 `counterMoves[oppMove.key] = M.key`。下次遇到同样 oppMove 时,M 排序优先。
// 命中率约 10-15%,经典实现给搜索效率 +5-10%(直接服务"看 5-7 步")。
// Bonus 取值:介于 KILLER_BONUS_SECOND(7000)与 HISTORY_MAX_BONUS(6000)之间。
const COUNTERMOVE_BONUS = 6500;

// === Singular Extension (#46) ===
// 经典 Stockfish/Deep Blue 选择性延伸:TT 中某走法是 LOWER bound entry(beta cutoff),
// 当 depth >= 阈值时,验证该走法是否"唯一最佳"——其他所有走法的 score 都至少低 MARGIN。
// 若验证通过(singular),主搜索中给该走法 +1 ply extension。
// 直接服务"看 5-7 步":关键局面(只有一招能赢/守)多看一步 → 减少误判,直接服务棋力 2200。
//
// 触发条件(保守):
//   - depth >= SINGULAR_MIN_DEPTH(=4):浅节点验证收益低于开销
//   - TT flag = TT_FLAG_LOWER(可靠 beta cutoff 信号;EXACT/UPPER 信号弱)
//   - !inCheck:将军节点已有 evasion 框架,singular 语义不准
//   - 有 TT best move(`ttEntry.bestMoveKey`)
//
// Verification(逐走法 probe):
//   - 对每个非 TT best move,以 reduced depth(depth - 1 - REDUCTION)做 zero-window probe
//   - exclusiveBound = ttScore - MARGIN,childAlpha = -exclusiveBound,childBeta = -exclusiveBound + 1
//   - 任一走法 fail-low(childReturn <= childAlpha)→ 该走法 score ≥ exclusiveBound → 竞争性 → 非 singular
//   - 所有走法均 fail-high → singular 成立
//   - 任意走法命中即 early-stop(O(1) 平均开销)
//
// 取值依据:
//   - MARGIN = 60 ≈ 0.6 兵价值,只识别明显"独招",避免误判扩散
//   - REDUCTION = 2:与 IID_REDUCTION 一致;reduced depth 比主搜索便宜 8x
//   - MAX_SINGULAR_EXTENSIONS_PER_LINE = 1:每条搜索线最多 1 次 singular extension
//     (与 check extension 的 MAX_CHECK_EXTENSIONS_PER_LINE=2 共享 extensionsInLine 计数器,
//      总延伸上限 = MAX_CHECK + MAX_SINGULAR = 3,防止延伸爆炸)
const SINGULAR_ENABLED = true;
const SINGULAR_MIN_DEPTH = 4;
const SINGULAR_MARGIN = 60;
const SINGULAR_REDUCTION = 2;
const MAX_SINGULAR_EXTENSIONS_PER_LINE = 1;

// === Threat Extension (#48) ===
// 经典 Stockfish 选择性延伸:null move search 失败(nullScore < beta - MARGIN)时,
// 说明对手有真实威胁 — 即使我们让一步,对手的最佳回应仍能把分数压到 beta 之下。
// 主搜索中的首走法(走法排序后通常是最优的 TT/killer)给 +1 ply extension,
// 帮助找到防御性走法 / refutation,直接服务"看 5-7 步"+ 守住一级棋士。
//
// 设计要点:
//   - 仅在 null move 已运行(allowNull + depth>=NULL_MOVE_MIN_DEPTH + !inCheck)且
//     Verified NMP 未确认 cutoff 的 fall-through 路径上检测,语义清晰。
//   - THREAT_MIN_DEPTH=5:浅节点 null move 信号噪声大,且 extension overhead 不划算。
//     与 NULL_MOVE_VERIFY_MIN_DEPTH=5 对齐 — threat ext 与 verified NMP 都属于"深层
//     null move 复核"类优化,共用最小深度阈值便于推理。
//   - THREAT_MARGIN=100 ≈ 1 个兵价值:null move 失败 ≥100 才视为"真实威胁",
//     避免 null score 微弱低于 beta 时也触发 extension(过度延伸拖慢搜索)。
//   - 仅 i=0(走法排序后首位)走法延伸:threat ext 的语义是"我们的最佳走法值得多看一步",
//     而不是对所有走法延伸(否则爆炸)。TT/killer 在排序首位,正是最值得延伸的对象。
//   - MAX_THREAT_EXTENSIONS_PER_LINE=1:与 MAX_CHECK(2) + MAX_SINGULAR(1) 共享
//     extensionsInLine 计数器,总延伸上限 = 4。每条搜索线最多 1 次 threat ext。
//
// 与 Verified NMP (#47) 的关系:
//   - 当 nullScore >= beta 且 verify 通过:#47 直接 return,不会到 threat ext 检测。
//   - 当 nullScore >= beta 但 verify 失败:fall-through,此时 nullScore 仍 >= beta,
//     不满足 < beta - MARGIN,threat ext 不触发(避免与 verify 失败语义冲突)。
//   - 当 nullScore < beta:正常 fall-through 到主搜索,threat ext 检测可能触发。
const THREAT_EXTENSION_ENABLED = true;
const THREAT_EXTENSION_MIN_DEPTH = 5;
const THREAT_MARGIN = 100;
const THREAT_EXTENSION_PLY = 1;
const MAX_THREAT_EXTENSIONS_PER_LINE = 1;

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
const TT_MAX_ENTRIES = 200000; // 容量上限,满则触发 eviction(避免内存爆炸)
// Replacement scheme(depth-preferred + partial eviction):
// 满 → 一次性删除 depth 最浅的 25%,保留深条目与 PV/EXACT 信息。
// 比旧版 tt.clear() 优势:不全清,PV 信息留在 TT 中,下一深度/下一次搜索仍可命中
// (直接服务"看 5-7 步":TT 命中率 >= 30% 让 iterative deepening 在同等时间内多搜 1-2 ply)。
// 25% 的依据:每次 eviction 后腾出 50000 槽,下次 eviction 至少 50000 次新存入后才再触发,
// 摊销代价 O(1);保留 75% 让 PV/killer 等 deep 信息不被破坏。
const TT_EVICT_RATIO = 0.25;
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
// #51 Soldier 推进评估精化:横向中心化 + 双兵过河协同。
// 直接服务"残局能赢必胜局面"目标:残局中双过河兵必胜,过河兵在敌宫中心列威胁最大。
// 取值保守(参考子力:兵 100 / 马 430 / 炮 450 / 车 900),避免 #36/#37 类 self-play 退化。
// 与 #49 KING_ATTACK.soldierInPalace 互补:#49 是单纯进宫加分(对称,无中心区分),
// 此项是残局专属 + 中心列加权,与 #49 叠加不冲突(语义维度不同)。
const ENDGAME_SOLDIER_CENTER_BONUS = {
  center: 12, // 过河兵在敌宫中心列(x=4):威胁最大,可能是将门前
  edge: 6,    // 过河兵在敌宫侧列(x=3 或 5):次之
};
const ENDGAME_DOUBLE_SOLDIER_BONUS = 22; // 残局双兵过河且相邻/同列:每对加分(必胜结构)
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
  // === Phase 10 #50 新增 3 个经典必胜残局模式 ===
  // 单车对单马 / 单车对单炮(无士象)/ 双车对单攻子:均为残局理论上的必胜或绝对优势结构,
  // 鼓励 AI 在中局末主动换子进入。幅度低于"车炮/车马对单车"(200),因为这些模式对
  // 实施精度要求更高(需精确知道位置),给的鼓励应稍保守。
  chariotVsLoneHorse: 160,         // 单车对单马(opp 仅 1 马无士象):必胜,马无支援终被擒
  chariotVsLoneCannon: 160,        // 单车对单炮(opp 仅 1 炮无士象):必胜,炮无架无效
  twoChariotsVsSingleAttacker: 180, // 双车对单攻子(opp 1 马/炮,无士象):必胜,双车错杀
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

// #49 King Attack Zone eval:攻击方在敌宫(3-5 列 × 敌方 3 行)及邻接缓冲行聚集车马炮
// → 加分;2+ 攻击子聚集额外加 multi-attacker bonus。直接服务"完全不送子"
// (让 AI 在评估时知道"我方多子压境,无需送子即可进攻")和"中局战术组合能力"
// (鼓励车马炮协同进宫)。取值保守(参考子力:兵 100 / 马 430 / 炮 450 / 车 900),
// 远低于子力分,避免覆盖 #36/#37 类 self-play 退化教训。
const KING_ATTACK = {
  inPalaceChariot: 30,        // 车进入敌宫(x=3-5,y 在敌方 3 行内)
  inPalaceCannon: 25,         // 炮进入敌宫
  inPalaceHorse: 22,          // 马进入敌宫
  adjacentChariot: 15,        // 车在邻接缓冲行(x=3-5,y 在缓冲行)
  adjacentCannon: 12,         // 炮在邻接缓冲行
  adjacentHorse: 10,          // 马在邻接缓冲行
  soldierInPalace: 18,        // 过河兵进敌宫(升变威胁)
  soldierAdjacent: 8,         // 过河兵在敌宫缓冲行
  multiAttackerBonus: 20,     // 2+ 攻击子聚集(车马炮)时每个额外攻击子加分
};

const MOBILITY_VALUE = {
  general: 0,
  advisor: 1,
  elephant: 1,
  horse: 5,
  chariot: 7,
  cannon: 6,
  soldier: 2,
};

// #41 评估精化:车马炮 mobility 精细化 + 王宫威胁加分。
// 直接服务"看 5-7 步":更准的 eval 让 alpha-beta cutoff 更精确。
// 取值保守(参考子力:兵 100 / 马 430 / 炮 450 / 车 900),避免 #36/#37 类 self-play 退化。
const MOBILITY_REFINEMENT = {
  chariotOpenFile: 25,      // 车 在无人阻挡的列(开放线):行动自由 + 控制纵深
  chariotSemiOpenFile: 12,  // 车在列上仅 1 个敌方子(半开放线):仍是好的攻击位
  horseCenter: 10,          // 马 在中央列(3-5)+ 过河:中心马、控制要点
  cannonPalaceThreat: 18,   // 炮对宫:同列/同行射入敌宫且有 1 架(经典"巡宫炮")
};

// #55 Horse Leg Penalty:马的 4 个腿位(0,±1) / (±1,0),每个腿位被任意子堵住时
// 该马减分(2 个走法方向失效)。直接服务"完全不送子"(防止把被困马高估成自由马)
// + "中局战术组合能力"(让 AI 主动派子去蹩对方马腿)。
// 取值保守(参考子力:兵 100 / 马 430),每条腿 -8,最坏 -32 仍远低于丢马代价。
const HORSE_LEG_PENALTY = {
  perLeg: 8,                // 每个被堵的腿位 -8(任意子堵,友方/敌方等同)
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
