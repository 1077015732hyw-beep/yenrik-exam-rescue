/* ==========================================================================
   sw.js — Service Worker：让资料馆能「加到主屏幕」并离线打开
   策略（刻意保守，绝不缓存没打开过的 PDF）：
     · 供应商文件与图标（vendor/、assets/）：cache-first（内容不会变）
     · 页面、样式、脚本、data/files.json：network-first，失败时回退缓存
     · PDF：network-first + 命中后按需缓存，最多保留 12 份，且跳过 Range 请求
   首页本身仍然不会自动加载任何 PDF——只有你在阅读页打开过的才会进缓存。
   ========================================================================== */

const VERSION = 'shijuan-v2';
const SHELL = `${VERSION}-shell`;
const PDFS = `${VERSION}-pdfs`;
const MAX_PDFS = 12;

/* 需要在安装时就准备好的最小外壳（不含 PDF、不含 files.json 之外的数据） */
const PRECACHE = [
  './',
  './index.html',
  './viewer.html',
  './thanks.html',
  './404.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/library.css',
  './css/viewer.css',
  './css/thanks.css',
  './js/util.js',
  './js/catalog.js',
  './js/progress.js',
  './js/hero.js',
  './js/home.js',
  './js/viewer.js',
  './js/pwa.js',
  './assets/icons.svg',
  './assets/favicon.svg',
  './assets/paper-grain.webp',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

const isVendor = (url) => url.pathname.includes('/vendor/');
const isAsset = (url) => url.pathname.includes('/assets/');
const isPdf = (url) => /\.pdf$/i.test(url.pathname);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // 单个文件失败不影响整体安装（例如某张图还没生成）
    await Promise.all(PRECACHE.map((path) => cache.add(new Request(path, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** PDF 缓存按插入顺序淘汰，只留最近 MAX_PDFS 份 */
async function trimPdfCache() {
  const cache = await caches.open(PDFS);
  const keys = await cache.keys();
  if (keys.length <= MAX_PDFS) return;
  await Promise.all(keys.slice(0, keys.length - MAX_PDFS).map((req) => cache.delete(req)));
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    // 离线时页面导航回退到缓存的首页
    if (request.mode === 'navigate') {
      const shell = await caches.open(SHELL);
      const fallback = (await shell.match('./index.html')) || (await shell.match('./'));
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

async function pdfStrategy(request) {
  // 带 Range 的请求（206 部分内容）不能写进 Cache，直接放行
  if (request.headers.has('range')) return fetch(request);
  const cache = await caches.open(PDFS);
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type === 'basic') {
      await cache.put(request, response.clone());
      trimPdfCache();
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;      // 跨域（例如 CDN 兜底）交给浏览器

  if (isPdf(url)) { event.respondWith(pdfStrategy(request)); return; }
  if (isVendor(url) || isAsset(url)) { event.respondWith(cacheFirst(request, SHELL)); return; }
  event.respondWith(networkFirst(request, SHELL));
});

/* 允许页面主动要求「立刻用新版本」 */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
