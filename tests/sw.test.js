// Service Worker 单元测试(V2 #68)。
//
// Node 没有 ServiceWorker 全局,无法真正执行 sw.js。采取静态源码解析断言:
//   1. sw.js 可被 vm 解析(语法正确,跑在沙箱 stub 中)
//   2. PRECACHE_URLS 含核心 app shell + pikafish 二进制
//   3. CACHE_NAME 形态正确(版本化命名空间)
//   4. 三大事件监听(install / activate / fetch)存在
//   5. pikafish.* 在 OPTIONAL_PRECACHE_PREFIXES(缺失不阻断)
//   6. app.js 含 register("sw.js") 入口 + file:// 守卫

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SW_PATH = path.join(__dirname, "..", "sw.js");
const APP_PATH = path.join(__dirname, "..", "app.js");

function swSource() {
  return fs.readFileSync(SW_PATH, "utf8");
}

function appSource() {
  return fs.readFileSync(APP_PATH, "utf8");
}

function runSwInSandbox() {
  // 用 stub globals 让 sw.js 完整执行(install/activate 事件已绑定,
  // 这里只验证语法,不实际触发事件)。
  const swSelf = {
    location: { origin: "http://localhost", pathname: "/sw.js" },
    addEventListener: () => {},
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const context = vm.createContext({
    console,
    self: swSelf,
    location: swSelf.location,
    caches: {
      open: () => Promise.resolve({ add: () => Promise.resolve() }),
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
      match: () => Promise.resolve(undefined),
      put: () => Promise.resolve(),
    },
    fetch: () => Promise.resolve(new Response("ok", { status: 200 })),
    Response,
  });
  vm.runInContext(fs.readFileSync(SW_PATH, "utf8"), context, {
    filename: SW_PATH,
  });
}

test("sw.js parses without syntax error", () => {
  assert.doesNotThrow(runSwInSandbox);
});

test("PRECACHE_URLS contains app shell + pikafish binaries", () => {
  const src = swSource();
  for (const required of [
    "./index.html",
    "./styles.css",
    "./app.js",
    "./ai-worker.js",
    "./src/constants.js",
    "./src/rules.js",
    "./src/search.js",
    "./src/pikafish-engine.js",
    "./vendor/pikafish/pikafish.js",
    "./vendor/pikafish/pikafish.wasm",
  ]) {
    assert.ok(
      src.includes(`"${required}"`) || src.includes(`'${required}'`),
      `PRECACHE_URLS missing ${required}`
    );
  }
});

test("CACHE_NAME is namespaced + versioned", () => {
  const src = swSource();
  // 命名空间 + 版本后缀(模板字符串或字符串字面量均接受)。
  assert.match(src, /CACHE_NAME\s*=\s*[`"']chinese-chess-/);
  assert.match(src, /CACHE_VERSION\s*=\s*[`"']/);
});

test("OPTIONAL_PRECACHE_PREFIXES covers pikafish binaries", () => {
  const src = swSource();
  assert.match(src, /OPTIONAL_PRECACHE_PREFIXES\s*=/);
  assert.match(src, /OPTIONAL_PRECACHE_PREFIXES.*pikafish\./s);
});

test("sw.js registers all three lifecycle hooks", () => {
  const src = swSource();
  assert.match(src, /addEventListener\(\s*["']install["']/);
  assert.match(src, /addEventListener\(\s*["']activate["']/);
  assert.match(src, /addEventListener\(\s*["']fetch["']/);
});

test("sw.js install uses skipWaiting + activate uses clients.claim", () => {
  const src = swSource();
  assert.match(src, /skipWaiting/);
  assert.match(src, /clients\.claim/);
});

test("sw.js caches old-cache cleanup on activate", () => {
  const src = swSource();
  assert.match(src, /caches\.keys\(\)/);
  assert.match(src, /caches\.delete/);
});

test("sw.js network-first strategy for navigations", () => {
  const src = swSource();
  assert.match(src, /navigate/);
});

test("app.js registers sw.js (with file:// + window guards)", () => {
  const src = appSource();
  assert.match(
    src,
    /navigator\.serviceWorker\s*\.\s*register\(\s*["']sw\.js["']/
  );
  assert.match(src, /file:/);
  assert.match(src, /typeof window\s*===\s*["']undefined["']/);
});

test("engine-harness init regex still matches new app.js tail", () => {
  // engine-harness 用 INITIALIZATION 正则剥离 app.js 末尾 4 行 init。
  // #68 在 init 之前插入 SW 注册块,正则必须仍能匹配。
  const harness = require("./engine-harness");
  assert.doesNotThrow(
    () => harness.createEngine(),
    "engine-harness must load app.js cleanly"
  );
});
