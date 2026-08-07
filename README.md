# 中国象棋 · Web Chinese Chess

一款纯前端(Vanilla JS)的中国象棋人机对弈 Web 应用,浏览器即开即玩,无需注册或下载。规则完整覆盖(将帅照面、蹩马腿、塞象眼、炮架、将军、将死、困毙),内置三档难度的 AI 引擎,目标棋力达二级-一级棋士水平(Elo 1800-2200)。

---

## 特性

### 玩法
- **人机对弈**:执红或执黑,选择简单 / 普通 / 困难三档 AI
- **完整规则**:32 枚棋子、标准开局、全部特殊走法判定
- **辅助功能**:走法提示、合法落点高亮、悔棋、棋谱记录、对局存档
- **胜负判定**:将死、困毙、认输、超时(时钟计时)
- **音效反馈**:走子、吃子、将军、胜负音效

### AI 引擎
- **搜索**:Alpha-Beta + Principal Variation Search(PVS)
- **优化**:Killer heuristic、History heuristic、Late Move Reduction(LMR)、Null Move Pruning、Transposition Table(Zobrist Hash)
- **评估**:子力 + 位置加成 + 兵过河 + 协同(双车 / 双炮 / 车马)+ 王的安全(飞行将军防守)+ 残局切换
- **开局库**:22 条主变(中炮、屏风马、反宫马、顺炮、列炮、仙人指路、飞相局、起马局、过宫炮、仕角炮、五六炮、五七炮等),每个变着 8 步深度
- **时间管理**:hard 模式动态分配思考时间,稳定局面早停、关键局面延伸
- **避免循环**:位置重复检测、直接回退惩罚、根节点循环惩罚
- **难度梯度**:
  - 简单(easy):depth 1,有随机性,适合新手
  - 普通(normal):depth 2 + 开局库,日常练习
  - 困难(hard):depth 5 + quiescence + 全部优化,目标二级-一级棋士

### 工程化
- 单文件 `app.js`(易于部署),可选 Web Worker(`ai-worker.js`)异步搜索
- 浏览器原生 API,无任何运行时依赖
- 15 个 Node.js 单元测试(规则 + AI 搜索 + Worker smoke)
- AI 棋力 benchmark 脚本

---

## 快速启动

### 方式一:Docker Compose(推荐)

```bash
docker-compose up
```

打开浏览器访问 [http://localhost:8080](http://localhost:8080)。

### 方式二:本地静态服务器

任意静态文件服务器均可,例如:

```bash
# Python
python3 -m http.server 8080

# Node(http-server)
npx http-server -p 8080

# 或直接在浏览器中打开 index.html(部分浏览器功能可能受限)
```

---

## 项目结构

```
.
├── index.html               # 入口页面(单页)
├── app.js                   # 主应用(规则 + AI + UI)
├── ai-worker.js             # AI 搜索 Web Worker(可选,默认禁用)
├── styles.css               # 样式
├── ai-worker.js             # Worker 端 AI 搜索(可选)
├── docker-compose.yml       # nginx 静态部署
├── package.json             # 测试脚本
├── tests/
│   ├── engine-harness.js    # 测试工具:在 Node 中加载 app.js
│   ├── ai-search.test.js    # AI 搜索单元测试
│   ├── ai-worker-smoke.test.js  # Worker 工厂 smoke 测试
│   └── ai-benchmark.js      # AI 棋力 benchmark
├── docs/
│   └── plans/               # 历史规划文档
└── 中国象棋游戏PRD.md        # 产品需求文档
```

---

## 开发指南

### 环境要求
- Node.js ≥ 18(用于跑测试,运行时不依赖 Node)
- 现代浏览器(支持 ES2020、Pointer Events、Web Audio API)

### 跑测试

```bash
npm test
```

测试覆盖:
- 棋子走法生成(车 / 马 / 炮 / 相 / 士 / 将 / 兵)
- 特殊规则(蹩马腿、塞象眼、炮架、将帅照面)
- AI 搜索(深度、quiescence、不送子)
- Worker 工厂与边界检查

### 跑 AI Benchmark

```bash
npm run benchmark:ai
```

### 开启 AI Web Worker(实验性)

默认 AI 在主线程同步搜索(`AI_WORKER_ENABLED = false`)。如需启用 Worker 异步搜索以避免 hard 模式阻塞 UI:

```js
// 在浏览器 Console 中,或修改 app.js 顶部
state.aiWorkerEnabled = true; // 或 AI_WORKER_ENABLED = true
```

> 注意:Worker 端搜索目前为骨架实现,完整搬运仍在进行中(见 [TODO #25](docs/plans/))。启用后若 Worker 不可用,会自动 fallback 到主线程同步路径。

---

## 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| UI | Vanilla JS + DOM | 无框架,单文件部署 |
| 样式 | 原生 CSS | 响应式,支持桌面和移动端 |
| AI 引擎 | Alpha-Beta + PVS | 自研,含全部主流剪枝优化 |
| 持久化 | localStorage | 对局恢复与设置 |
| 部署 | nginx + Docker | 静态文件,零后端 |

---

## AI 棋力路线图

目标:达到二级-一级棋士水平(Elo 1800-2200)。

| 阶段 | 目标 | 状态 |
|------|------|------|
| Phase 1 | 三级棋士基础(开局库、剪枝、评估、王安全、残局) | ✅ 完成 |
| Phase 1.5 | 二级-一级冲刺(置换表、PVS、时间管理、扩展开局库、Worker 化) | ✅ 完成 |
| Phase 2 | 工程外围 P0(README、LICENSE、CI) | 🚧 进行中 |
| Phase 3 | 工程外围 P1(ESLint、模块化拆分、Issue 模板) | ⏳ 待启动 |

---

## 协议

MIT(见 [LICENSE](LICENSE))。

## 致谢

- 规则参考:中国象棋协会标准规则
- AI 算法参考:Chess Programming Wiki
- 开局库整理自常见对局开局分支
