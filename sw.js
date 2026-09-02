/**
 * 全球资产日报 Service Worker
 * 缓存策略：stale-while-revalidate（HTML）+ cache-first（图片）
 * 版本更新时修改 CACHE_VERSION，旧缓存自动清理
 */

const CACHE_VERSION = 'gad-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// 预缓存资源（安装时缓存）
const PRECACHE_URLS = [
  './',
  './index.html',
  './icon.png',
];

// 安装事件：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      return self.skipWaiting(); // 立即激活，不等待旧SW退出
    })
  );
});

// 激活事件：清理旧版本缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !name.startsWith(CACHE_VERSION))
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim(); // 立即接管所有页面
    })
  );
});

// 判断是否为图片资源
function isImageRequest(url) {
  return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url);
}

// 判断是否为HTML页面
function isHTMLRequest(url) {
  return /\.html$/i.test(url) || url.endsWith('/');
}

// 限制缓存数量（LRU思路：超过上限时删除最旧的）
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    // 删除最旧的（按插入顺序，keys返回的是插入顺序）
    for (let i = 0; i < keys.length - maxItems; i++) {
      await cache.delete(keys[i]);
    }
  }
}

//  fetch事件：拦截请求，按策略返回缓存或网络
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只缓存同源GET请求
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // 图片：cache-first（优先读缓存，缓存没有再走网络）
  if (isImageRequest(url.pathname)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          return cached;
        }
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
          cache.put(request, networkResponse.clone());
          trimCache(RUNTIME_CACHE, 30); // 图片最多缓存30张
        }
        return networkResponse;
      })
    );
    return;
  }

  // HTML页面：stale-while-revalidate（先返回缓存，后台更新）
  if (isHTMLRequest(url.pathname)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
            trimCache(RUNTIME_CACHE, 15); // HTML最多缓存15个页面（约2周）
          }
          return networkResponse;
        }).catch(() => {
          return cached; // 网络失败时返回缓存
        });
        return cached || networkFetch;
      })
    );
    return;
  }

  // 其他资源（CSS/JS等，本项目内联在HTML里，基本没有）：网络优先，失败读缓存
  event.respondWith(
    fetch(request).catch(() => {
      return caches.match(request);
    })
  );
});
