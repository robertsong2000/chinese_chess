// app.js engine-notice 用户级通知测试(v2 #83)。
//
// 通过 engine-harness 加载 app.js(vm 沙箱,共享 constants/rules/search/app 全局词法环境),
// 验证:
//   1. createGame 初始 state.engineNotice === null
//   2. showEngineNotice / clearEngineNotice / renderEngineNotice 状态机
//   3. noticePikafishUnavailable_:pikafish 模式专属,自动切回 vanilla + 同步 UI
//   4. 去重:相同 key 的通知不重复弹
//   5. vanilla 模式下 noticePikafishUnavailable_ 是 no-op
//   6. els 字段映射完整
//
// 注:engine-harness 用 stub document({}),Worker 全局不存在,chooseAIMoveAsync 走 fallback,
// 这里只测纯函数 + 状态可观察部分,不测 worker 创建路径。

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEngine } = require("./engine-harness");

test("createGame returns engineNotice: null", () => {
  const engine = createEngine();
  assert.equal(engine.evaluate("state.engineNotice"), null);
});

test("createGame new instance also has engineNotice null", () => {
  const engine = createEngine();
  const fresh = engine.evaluate("createGame('black', 'hard').engineNotice");
  assert.equal(fresh, null);
});

test("els map includes engineNotice, engineNoticeText, engineNoticeClose", () => {
  const engine = createEngine();
  const has = engine.evaluate(`({
    notice: Object.prototype.hasOwnProperty.call(els, 'engineNotice'),
    text: Object.prototype.hasOwnProperty.call(els, 'engineNoticeText'),
    close: Object.prototype.hasOwnProperty.call(els, 'engineNoticeClose'),
  })`);
  assert.equal(has.notice, true);
  assert.equal(has.text, true);
  assert.equal(has.close, true);
});

test("showEngineNotice sets state.engineNotice with text+key+ts", () => {
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    const r = showEngineNotice("hello world", { key: "k1", reason: "test" });
    return { changed: r, notice: state.engineNotice };
  })()`);
  assert.equal(result.changed, true);
  assert.equal(result.notice.text, "hello world");
  assert.equal(result.notice.key, "k1");
  assert.equal(result.notice.reason, "test");
  assert.equal(typeof result.notice.ts, "number");
});

test("showEngineNotice without opts uses text as key", () => {
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    showEngineNotice("plain");
    return state.engineNotice;
  })()`);
  assert.equal(result.text, "plain");
  assert.equal(result.key, "plain");
  assert.equal(result.reason, null);
});

test("showEngineNotice dedupes: same key returns changed=false and does not overwrite ts", () => {
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    showEngineNotice("first", { key: "dup", reason: "r1" });
    const first = JSON.parse(JSON.stringify(state.engineNotice));
    const r = showEngineNotice("second", { key: "dup", reason: "r2" });
    const second = JSON.parse(JSON.stringify(state.engineNotice));
    return { first, changed: r, second };
  })()`);
  assert.equal(result.changed, false);
  assert.equal(result.first.text, "first");
  // dedup 命中,第二个调用不应覆盖。
  assert.equal(result.second.text, "first");
  assert.equal(result.second.reason, "r1");
});

test("showEngineNotice with different key overwrites", () => {
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    showEngineNotice("a", { key: "ka" });
    showEngineNotice("b", { key: "kb" });
    return state.engineNotice;
  })()`);
  assert.equal(result.text, "b");
  assert.equal(result.key, "kb");
});

test("clearEngineNotice nulls state and returns true when set", () => {
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    showEngineNotice("x");
    const r1 = clearEngineNotice();
    const r2 = clearEngineNotice();
    return { firstCall: r1, secondCall: r2, notice: state.engineNotice };
  })()`);
  assert.equal(result.firstCall, true);
  assert.equal(result.secondCall, false);
  assert.equal(result.notice, null);
});

test("renderEngineNotice hides element + clears text when notice is null", () => {
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    const stub = { hidden: false, textContent: "stale" };
    const stubText = { textContent: "stale" };
    els.engineNotice = stub;
    els.engineNoticeText = stubText;
    state.engineNotice = null;
    renderEngineNotice();
    return { hidden: stub.hidden, text: stubText.textContent };
  })()`);
  assert.equal(result.hidden, true);
  assert.equal(result.text, "");
});

test("renderEngineNotice shows element + sets text when notice is set", () => {
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    const stub = { hidden: true, textContent: "" };
    const stubText = { textContent: "" };
    els.engineNotice = stub;
    els.engineNoticeText = stubText;
    showEngineNotice("Pikafish 不可用", { key: "k" });
    return { hidden: stub.hidden, text: stubText.textContent };
  })()`);
  assert.equal(result.hidden, false);
  assert.equal(result.text, "Pikafish 不可用");
});

test("renderEngineNotice no-ops when els.engineNotice missing", () => {
  const engine = createEngine();
  // 不报错即可(早期 return)。
  const result = engine.evaluate(`(function(){
    els.engineNotice = null;
    state.engineNotice = { text: "x", key: "x", ts: 1 };
    let threw = false;
    try { renderEngineNotice(); } catch (e) { threw = true; }
    return threw;
  })()`);
  assert.equal(result, false);
});

test("noticePikafishUnavailable_: no-op when engineMode is vanilla", () => {
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    settings.engineMode = "vanilla";
    const r = noticePikafishUnavailable_("test reason");
    return { changed: r, mode: settings.engineMode, notice: state.engineNotice };
  })()`);
  assert.equal(result.changed, false);
  assert.equal(result.mode, "vanilla");
  assert.equal(result.notice, null);
});

test("noticePikafishUnavailable_: in pikafish mode, sets notice and switches back to vanilla", () => {
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    settings.engineMode = "pikafish";
    const r = noticePikafishUnavailable_("worker timeout");
    return {
      changed: r,
      mode: settings.engineMode,
      notice: state.engineNotice ? JSON.parse(JSON.stringify(state.engineNotice)) : null,
    };
  })()`);
  assert.equal(result.changed, true);
  assert.equal(result.mode, "vanilla");
  assert.equal(result.notice.text, "Pikafish 引擎不可用（尚未下载或加载失败），已切换到自研 AI。");
  assert.equal(result.notice.key, "pikafish-unavailable");
  assert.equal(result.notice.reason, "worker timeout");
});

test("noticePikafishUnavailable_: dedupes when called twice, but always switches mode", () => {
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    settings.engineMode = "pikafish";
    const r1 = noticePikafishUnavailable_("reason A");
    // 用户切回 pikafish 又失败
    settings.engineMode = "pikafish";
    const r2 = noticePikafishUnavailable_("reason B");
    return {
      r1, r2,
      modeAfterSecond: settings.engineMode,
      noticeReason: state.engineNotice ? state.engineNotice.reason : null,
    };
  })()`);
  // 同 key,第二次不覆盖 notice(去重命中,reason 仍是 A)。
  assert.equal(result.r1, true);
  assert.equal(result.r2, false);
  // 但模式仍要切回 vanilla(避免下次走子还失败)。
  assert.equal(result.modeAfterSecond, "vanilla");
  assert.equal(result.noticeReason, "reason A");
});

test("noticePikafishUnavailable_ does not affect engineInfo state", () => {
  const engine = createEngine();
  const json = engine.json(`(function(){
    settings.engineMode = "pikafish";
    state.engineInfo = { depth: 12 };
    noticePikafishUnavailable_("test");
    return state.engineInfo;
  })()`);
  // engineInfo 与 engineNotice 独立;清掉是 renderEngineInfo/scheduleAI 的职责。
  assert.deepEqual(json, { depth: 12 });
});

test("PIKAFISH_NOTICE_KEY and PIKAFISH_NOTICE_TEXT constants are defined", () => {
  const engine = createEngine();
  const key = engine.evaluate("PIKAFISH_NOTICE_KEY");
  const text = engine.evaluate("PIKAFISH_NOTICE_TEXT");
  assert.equal(key, "pikafish-unavailable");
  assert.ok(typeof text === "string" && text.length > 0);
});

test("data-engine handler integration: switching to vanilla clears notice (simulated)", () => {
  // engine-harness 没有真实 DOM event,我们直接调 clearEngineNotice 模拟点击 handler 内的清理路径。
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    settings.engineMode = "pikafish";
    noticePikafishUnavailable_("init");
    // 用户主动切回 pikafish(已清掉的 notice 应保持清掉,但此时 notice 还在)
    // 模拟用户主动点 vanilla 按钮:handler 先 clearEngineNotice
    clearEngineNotice();
    return state.engineNotice;
  })()`);
  assert.equal(result, null);
});

test("renderEngineNotice handles missing engineNoticeText gracefully (only main element set)", () => {
  const engine = createEngine();
  const result = engine.evaluate(`(function(){
    const stub = { hidden: true, textContent: "" };
    els.engineNotice = stub;
    els.engineNoticeText = null;
    showEngineNotice("x");
    return { hidden: stub.hidden };
  })()`);
  // 主元素显示,text 元素缺失被 typeof 守卫跳过,不报错。
  assert.equal(result.hidden, false);
});
