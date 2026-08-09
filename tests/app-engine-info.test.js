// app.js engine-info 渲染测试(v2 #70)。
//
// 通过 engine-harness 加载 app.js(vm 沙箱,共享 constants/rules/search/app 全局词法环境),
// 验证:
//   1. formatEngineInfo 各输入场景的格式化契约
//   2. createGame 初始 state.engineInfo === null
//   3. state.engineInfo 在 scheduleAI / result / error 流中的清理契约(间接,通过纯函数 + 状态可观察部分)
//
// 注:engine-harness 用 stub document({}),Worker 全局不存在,chooseAIMoveAsync 走 fallback,
// 所以这里只测纯函数 formatEngineInfo + state 初始字段 + els.engineInfo 已注入。

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEngine } = require("./engine-harness");

test("formatEngineInfo: falsy input returns empty string", () => {
  const engine = createEngine();
  assert.equal(engine.evaluate("formatEngineInfo(null)"), "");
  assert.equal(engine.evaluate("formatEngineInfo(undefined)"), "");
  assert.equal(engine.evaluate("formatEngineInfo({})"), "");
});

test("formatEngineInfo: depth only", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ depth: 12 })");
  assert.equal(out, "深度 12");
});

test("formatEngineInfo: depth + seldepth", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ depth: 12, seldepth: 15 })");
  assert.equal(out, "深度 12/15");
});

test("formatEngineInfo: cp positive score formatted as pawns with sign", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ score: { unit: 'cp', value: 234 } })");
  assert.equal(out, "分数 +2.34");
});

test("formatEngineInfo: cp negative score keeps minus sign", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ score: { unit: 'cp', value: -87 } })");
  assert.equal(out, "分数 -0.87");
});

test("formatEngineInfo: cp zero score uses ± prefix", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ score: { unit: 'cp', value: 0 } })");
  assert.equal(out, "分数 ±0.00");
});

test("formatEngineInfo: mate positive shown as 杀 +N", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ score: { unit: 'mate', value: 5 } })");
  assert.equal(out, "杀 +5");
});

test("formatEngineInfo: mate negative shown as 杀 -N", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ score: { unit: 'mate', value: -3 } })");
  assert.equal(out, "杀 -3");
});

test("formatEngineInfo: pv short (<4) shown in full", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ pv: ['h2e2', 'h9g7'] })");
  assert.equal(out, "pv: h2e2 h9g7");
});

test("formatEngineInfo: pv long (>4) truncated with ellipsis", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ pv: ['h2e2', 'h9g7', 'c3c4', 'b7e7', 'b0c2', 'b9c7'] })");
  assert.equal(out, "pv: h2e2 h9g7 c3c4 b7e7 …");
});

test("formatEngineInfo: nps shown as kNps", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ depth: 12, nps: 1234567 })");
  assert.equal(out, "深度 12 · 1235k nps");
});

test("formatEngineInfo: complete pikafish info string", () => {
  const engine = createEngine();
  const out = engine.evaluate(`formatEngineInfo({
    depth: 18,
    seldepth: 22,
    score: { unit: 'cp', value: 156 },
    pv: ['h2e2', 'h9g7', 'c3c4', 'b9c7', 'b0c2'],
    nps: 2500000,
  })`);
  assert.equal(out, "深度 18/22 · 分数 +1.56 · pv: h2e2 h9g7 c3c4 b9c7 … · 2500k nps");
});

test("formatEngineInfo: ignores unknown fields gracefully", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ depth: 5, weird: 'x', currmove: 'h2e2' })");
  assert.equal(out, "深度 5");
});

test("formatEngineInfo: score with non-cp/non-mate unit ignored", () => {
  const engine = createEngine();
  const out = engine.evaluate("formatEngineInfo({ score: { unit: 'lowerbound', value: 50 } })");
  assert.equal(out, "");
});

test("createGame returns engineInfo: null", () => {
  const engine = createEngine();
  const info = engine.evaluate("state.engineInfo");
  assert.equal(info, null);
});

test("createGame new instance also has engineInfo null", () => {
  const engine = createEngine();
  const fresh = engine.evaluate("createGame('black', 'hard').engineInfo");
  assert.equal(fresh, null);
});

test("els.engineInfo is wired into the els map", () => {
  const engine = createEngine();
  const hasField = engine.evaluate("Object.prototype.hasOwnProperty.call(els, 'engineInfo')");
  assert.equal(hasField, true);
  // engine-harness stub document.querySelector returns {},所以值就是 {}(truthy "wired")
  const value = engine.evaluate("els.engineInfo");
  assert.ok(value !== undefined, "els.engineInfo must be defined");
});

test("renderEngineInfo hides element when engineInfo is null", () => {
  const engine = createEngine();
  const result = engine.evaluate(`
    (function(){
      const stubInfo = { hidden: false, textContent: "stale" };
      els.engineInfo = stubInfo;
      state.engineInfo = null;
      state.thinking = true;
      settings.engineMode = "pikafish";
      renderEngineInfo();
      return { hidden: stubInfo.hidden, textContent: stubInfo.textContent };
    })()
  `);
  assert.equal(result.hidden, true);
  assert.equal(result.textContent, "");
});

test("renderEngineInfo hides when engineMode is vanilla (even if engineInfo set)", () => {
  const engine = createEngine();
  const result = engine.evaluate(`
    (function(){
      const stubInfo = { hidden: false, textContent: "x" };
      els.engineInfo = stubInfo;
      state.engineInfo = { depth: 18 };
      state.thinking = true;
      settings.engineMode = "vanilla";
      renderEngineInfo();
      return { hidden: stubInfo.hidden, textContent: stubInfo.textContent };
    })()
  `);
  assert.equal(result.hidden, true);
  assert.equal(result.textContent, "");
});

test("renderEngineInfo hides when not thinking", () => {
  const engine = createEngine();
  const result = engine.evaluate(`
    (function(){
      const stubInfo = { hidden: false, textContent: "x" };
      els.engineInfo = stubInfo;
      state.engineInfo = { depth: 18 };
      state.thinking = false;
      settings.engineMode = "pikafish";
      renderEngineInfo();
      return { hidden: stubInfo.hidden, textContent: stubInfo.textContent };
    })()
  `);
  assert.equal(result.hidden, true);
});

test("renderEngineInfo shows formatted text when pikafish + thinking + engineInfo", () => {
  const engine = createEngine();
  const result = engine.evaluate(`
    (function(){
      const stubInfo = { hidden: true, textContent: "" };
      els.engineInfo = stubInfo;
      state.engineInfo = { depth: 18, seldepth: 22, score: { unit: 'cp', value: 234 }, pv: ['h2e2', 'h9g7'] };
      state.thinking = true;
      settings.engineMode = "pikafish";
      renderEngineInfo();
      return { hidden: stubInfo.hidden, textContent: stubInfo.textContent };
    })()
  `);
  assert.equal(result.hidden, false);
  assert.equal(result.textContent, "深度 18/22 · 分数 +2.34 · pv: h2e2 h9g7");
});

test("renderEngineInfo hides when engineInfo present but produces empty text", () => {
  const engine = createEngine();
  const result = engine.evaluate(`
    (function(){
      const stubInfo = { hidden: false, textContent: "stale" };
      els.engineInfo = stubInfo;
      state.engineInfo = { weird: "x" };
      state.thinking = true;
      settings.engineMode = "pikafish";
      renderEngineInfo();
      return { hidden: stubInfo.hidden, textContent: stubInfo.textContent };
    })()
  `);
  assert.equal(result.hidden, true);
  assert.equal(result.textContent, "");
});
