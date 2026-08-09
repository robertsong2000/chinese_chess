// Service Worker — chinese_chess v2 (#68)
//
// 目标:首次加载后,二次访问零延迟(pikafish.wasm ~700KB 不再走网络)。
//
// 策略:
//   install:   预缓存 app shell(HTML/JS/CSS)+ ai-worker + pikafish.js/wasm。
//              pikafish.* 不存在时跳过(等用户跑 download-pikafish.sh 后下次激活再缓存)。
//   activate:  清理旧 CACHE_NAME,clients.claim() 立即接管。
//   fetch:     导航请求 → network-first(HTML 总是新鲜,避免锁死旧版本);
//              同源静态资源 → stale-while-revalidate(缓存即时返回,后台异步更新);
//              跨域 → 不拦截。
//
// 版本:CACHE_VERSION bump 即触发全量刷新(下次访问 install 新 cache → activate 删旧)。
// 任何 app shell / pikafish 路径调整需同步 PRECACHE_URLS 并 bump CACHE_VERSION。

const CACHE_VERSION = "v1-68-1";
const CACHE_NAME = `chinese-chess-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "./",
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
];

// pikafish 二进制可能尚未下载(用户未运行 download-pikafish.sh),缓存失败不应阻断安装。
const OPTIONAL_PRECACHE_PREFIXES = ["./vendor/pikafish/pikafish."];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 串行而非 Promise.all:任一必选项失败 → 抛出 → install 失败 → 旧 SW 继续服务。
      // 可选项(pikafish.*)失败 → 仅 console.warn,不阻断。
      for (const url of PRECACHE_URLS) {
        const isOptional = OPTIONAL_PRECACHE_PREFIXES.some((p) => url.startsWith(p));
        try {
          // cache.add 内部 fetch + put;非 2xx 会 throw。
          await cache.add(url);
        } catch (err) {
          if (isOptional) {
            console.warn(`[sw.js] optional precache skipped: ${url} (${err.message})`);
          } else {
            throw err;
          }
        }
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => {
            console.info(`[sw.js] deleting old cache: ${k}`);
            return caches.delete(k);
          })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 导航(HTML 文档):网络优先,失败回退缓存,最后回退 index.html。
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (_err) {
          const cached = await caches.match(req);
          if (cached) return cached;
          const fallback = await caches.match("./index.html");
          if (fallback) return fallback;
          return new Response("offline", { status: 503, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // 静态资源:stale-while-revalidate。
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const cache = caches.open(CACHE_NAME);
            cache.then((c) => c.put(req, res.clone()));
          }
          return res;
        })
        .catch(() => null);
      return cached || (await networkPromise) || Response.error();
    })()
  );
});
