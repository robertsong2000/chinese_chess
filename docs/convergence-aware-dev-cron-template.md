# 收敛认知 Dev Cron 模板

> **用途**:让自动开发 cron 任务具备"识别目标达成 + 自我终结"能力,避免无限自我延续。
> 基于 chinese_chess 项目(2026-08-07 ~ 2026-08-09)的设计经验。
> 那个项目的初代 cron 跑了 2 天 13 个 phase 63 个 TODO 后仍未收敛,因为 prompt 里没有终止条件。

## 核心问题:为什么 dev cron 会失控?

没有显式收敛判定的 cron prompt,会发生:

1. **Phase 自我复制**:每完成一个 phase,cron 会自动生成下一个,无穷无尽
2. **目标被遗忘**:cron 只知道"phase done → 生成下一个 phase",忘了检查"目标是否已达成"
3. **边际收益递增变递减**:早期 phase 提升 100+ Elo,后期 phase 提升 5-15 Elo,但 cron 不知道
4. **Token 持续消耗**:每天 40 次 × 几千 tokens = 实质成本

## 解决方案:三层收敛保护

### 第一层:**Phase 收尾的强制评估**

在 cron prompt 里加一段:

```
步骤 5.5 — Phase 完成时强制评估(在生成下一个 phase 之前)

A. 跑评估命令(根据项目类型选择):
   - 棋力类项目:npm run benchmark:ai(自对弈胜率 / 搜索深度)
   - 准确率类项目:跑测试集,记录 precision/recall
   - 性能类项目:跑 benchmark,记录 QPS / latency
   - 通用:npm test 必须全过

B. 把评估结果写入 .dev-state.json 的 "phase_evaluations" 数组:
   {
     "phase": <phase_id>,
     "evaluated_at": <timestamp>,
     "primary_metric": <name>,
     "primary_value": <number>,
     "delta_vs_previous": <number 或 null>,
     "tests_pass": <boolean>
   }

C. 判定收敛(满足任一条件就 stop):
   1. primary_value 已达到目标(goal_definition 里定义的 success_threshold)
   2. 最近 3 个 phase 的 delta_vs_previous 都 < convergence_min_delta(默认 5%)
   3. 最近 2 个 phase 都是 polish/refactor 类(非核心目标推进)
   4. 测试连续 fail 3 次,标 needs_human_intervention
```

### 第二层:**显式终止条件**

```
步骤 7 — 收敛后的自我终结(新增)

如果步骤 5.5 判定 converged,则:

1. 在 .dev-state.json 写入:
   {
     "converged": true,
     "converged_at": <ISO timestamp>,
     "converged_reason": "<具体原因,引用 phase_evaluations 数据>",
     "cron_status": "awaiting user deletion"
   }

2. 通过 cc-connect 发送"收敛报告":
   - 文件:convergence-report.md(包含:目标 vs 实际、关键 phase 数据、剩余改进建议)
   - 消息:"🎯 <项目名> cron 已收敛 — <一句话原因>。Cron 任务等待用户手动删除。"

3. 后续每次 cron 触发时,执行步骤 0 时先检查:
   if (state.converged === true) {
     console.log("已收敛,跳过本次执行");
     exit(0);  // 不消耗 token
   }

4. 在收敛报告中明确告知用户:
   - 删除 cron 的命令:cc-connect cron del <job_id>
   - 是否建议 pivot 到新方案(参考 goal_definition 里写的 pivot_threshold)
```

### 第三层:**预算硬上限**(防止前两层失效)

```
步骤 0 — 预算检查(新增,在读状态之后立即执行)

读 .dev-state.json,如果以下任一条件成立,强制收敛:

- total_phases >= max_phases(默认 15)
- total_commits >= max_commits(默认 100)
- total_runtime_days >= max_runtime_days(默认 14)
- single_phase_attempts >= 5(同 phase 多次失败)

强制收敛时:
1. 写入 converged: true, converged_reason: "hit_budget_limit"
2. 发送 cc-connect 报告
3. exit
```

## 模板:完整的收敛认知 cron prompt

把以下片段加入任何 dev cron 的 prompt 顶部,即可获得收敛能力:

```markdown
══════════════════════════════════════════
【收敛保护 — 必须严格执行】
══════════════════════════════════════════

读 .dev-state.json 后立即检查:
1. 如果 state.converged === true → exit(不消耗 token)
2. 如果 total_phases >= 15 → 写入 converged + 报告 + exit
3. 如果 total_commits >= 100 → 写入 converged + 报告 + exit

每完成一个 phase,在生成下一个之前:
1. 跑评估命令(见下)
2. 写入 phase_evaluations 记录
3. 判定收敛(满足任一条件则 stop,写入 converged + 报告 + 后续触发都 exit):
   - primary_value 达到 success_threshold(Elo / 胜率 / latency 等)
   - 最近 3 个 phase delta < convergence_min_delta(默认 5%)
   - 最近 2 个 phase 都是 refactor/polish 类
   - 测试连续 fail 3 次

如果生成新 phase,必须在新 phase 描述里写明:
- 上一个 phase 的 primary_value
- 本 phase 目标 primary_value
- 预期 delta
如果 delta < min_delta,不要生成,直接收敛。
```

## 在 .dev-state.json 里需要预留的字段

```json
{
  "goal": "...",
  "goal_definition": {
    "success_threshold": {
      "elo": 2200,
      "self_play_win_rate": 0.65,
      "tests_pass_min": 20
    },
    "pivot_threshold": {
      "elo": 2600,
      "note": "超过这个目标需要架构变更,不能靠渐进优化"
    }
  },
  "convergence_config": {
    "max_phases": 15,
    "max_commits": 100,
    "max_runtime_days": 14,
    "convergence_min_delta_percent": 5,
    "recent_polish_phase_limit": 2
  },
  "converged": false,
  "converged_at": null,
  "converged_reason": null,
  "phase_evaluations": [],
  "phases": [...],
  "todos": [...],
  "history": []
}
```

## 用例:chinese_chess 项目回看

如果当时(2026-08-07)用了收敛认知 prompt,行为会是:

| Phase | primary_value (估算 Elo) | delta | 判定 |
|-------|------------------------|-------|------|
| 初始 | 1500 | - | - |
| Phase 1 完成 | 1700 | +200 | 继续 |
| Phase 1.5 完成 | 1900 | +200 | 继续 |
| Phase 2 完成 | 1900 | 0 (polish 类) | 继续但记一个 polish |
| Phase 3 完成 | 1900 | 0 (polish 类) | ⚠️ 触发 "2 个 polish phase" 规则 |
| Phase 4 完成 | 2050 | +150 | 继续 |
| Phase 5 完成 | 2080 | +30 | 接近 min_delta |
| Phase 6 完成 | 2110 | +30 | 接近 min_delta |
| Phase 7 完成 | 2130 | +20 | ⚠️ 触发 "3 个 phase delta < 5%" 规则 |
| **应该在这里收敛** | | | |

**实际**:cron 跑到 Phase 13(6 个 phase 之后),消耗 token 数倍于必要值。

## 给未来自己的提示

1. **设计 dev cron 时,先写 success_threshold** —— 不要让 cron 自己猜"什么是够"
2. **每 phase 必须有可测量指标** —— Elo / 胜率 / latency / precision / 任何数字
3. **预算硬上限是兜底** —— 即使前两层失效,15 phase / 100 commit / 14 天会强制停
4. **pivot_threshold 很重要** —— 如果目标超过当前架构能力,提示用户切换方案而不是死磕

---

*文档版本:1.0 · 创建于 2026-08-09 · 基于 chinese_chess 项目经验*
