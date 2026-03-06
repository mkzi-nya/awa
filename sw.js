importScripts("https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.57/dist/zip-full.min.js");

const DB_NAME = "awa-db";
const STORE = "kv";
const KEY_PWD = "pwd_unicode";

let cachedPassword = null;

/* =========================
 * IndexedDB
 * ========================= */
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const st = tx.objectStore(STORE);
    const req = st.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const req = st.put(val, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* =========================
 * 生命周期
 * ========================= */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    cachedPassword = await idbGet(KEY_PWD);
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SET_PASSWORD") {
    const pwd = String(data.password || "");
    cachedPassword = pwd;
    event.waitUntil(idbSet(KEY_PWD, pwd));
  }
});

/* =========================
 * 路径规则
 * ========================= */
function isAllowedOrigin(url) {
  return (
    url.origin === "https://mkzi-nya.github.io" ||
    url.origin === "http://127.0.0.1:8000"
  );
}

function isPlaintextBypass(url) {
  const p = url.pathname;
  return (
    p === "/awa/index.html" ||
    p === "/awa/sw.js" ||
    p === "/awa/main/main.txt"
  );
}

function shouldHandle(url) {
  if (!isAllowedOrigin(url)) return false;
  if (!url.pathname.startsWith("/awa/")) return false;
  if (isPlaintextBypass(url)) return false;
  return true;
}

/* =========================
 * 工具函数
 * ========================= */
function hasExtension(pathname) {
  const last = pathname.split("/").pop() || "";
  return last.includes(".");
}

function isNavigationRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

function guessContentTypeByPath(pathname) {
  const p = pathname.toLowerCase();

  if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".xml")) return "application/xml; charset=utf-8";
  if (p.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".bmp")) return "image/bmp";
  if (p.endsWith(".ico")) return "image/x-icon";
  if (p.endsWith(".mp3")) return "audio/mpeg";
  if (p.endsWith(".wav")) return "audio/wav";
  if (p.endsWith(".ogg")) return "audio/ogg";
  if (p.endsWith(".flac")) return "audio/flac";
  if (p.endsWith(".mp4")) return "video/mp4";
  if (p.endsWith(".webm")) return "video/webm";
  if (p.endsWith(".ttf")) return "font/ttf";
  if (p.endsWith(".otf")) return "font/otf";
  if (p.endsWith(".woff")) return "font/woff";
  if (p.endsWith(".woff2")) return "font/woff2";

  return null;
}

function inferContentType(request, url, data) {
  if (isNavigationRequest(request)) {
    return "text/html; charset=utf-8";
  }

  switch (request.destination) {
    case "style":
      return "text/css; charset=utf-8";
    case "script":
    case "worker":
    case "sharedworker":
      return "text/javascript; charset=utf-8";
    case "manifest":
      return "application/manifest+json; charset=utf-8";
    case "image":
    case "font":
    case "audio":
    case "video": {
      const t = guessContentTypeByPath(url.pathname);
      return t || "application/octet-stream";
    }
  }

  const byPath = guessContentTypeByPath(url.pathname);
  if (byPath) return byPath;

  if (data && data.length > 0) {
    try {
      const head = new TextDecoder("utf-8", { fatal: false })
        .decode(data.slice(0, 512))
        .toLowerCase();

      if (
        head.includes("<!doctype html") ||
        head.includes("<html") ||
        head.includes("<head") ||
        head.includes("<body")
      ) {
        return "text/html; charset=utf-8";
      }

      if (head.trimStart().startsWith("{") || head.trimStart().startsWith("[")) {
        return "application/json; charset=utf-8";
      }
    } catch {}
  }

  return "application/octet-stream";
}

async function tryDecryptAsZip(originalArrayBuffer, password) {
  const blob = new Blob([originalArrayBuffer], { type: "application/octet-stream" });
  const reader = new zip.ZipReader(new zip.BlobReader(blob), { password });

  try {
    const entries = await reader.getEntries();
    if (!entries || entries.length === 0) return null;

    const entry = entries[0];
    const uint8 = await entry.getData(new zip.Uint8ArrayWriter());
    return uint8;
  } finally {
    await reader.close();
  }
}

async function fetchAndMaybeDecrypt(request, targetUrl) {
  const res = await fetch(targetUrl, {
    method: "GET",
    headers: request.headers,
    mode: "same-origin",
    credentials: request.credentials,
    cache: "no-store",
    redirect: "follow"
  });

  if (!res || !res.ok) return res;

  const pwd = cachedPassword;
  if (!pwd) return res;

  let ab;
  try {
    ab = await res.clone().arrayBuffer();
  } catch {
    return res;
  }

  try {
    const decrypted = await tryDecryptAsZip(ab, pwd);
    if (!decrypted) return res;

    const headers = new Headers(res.headers);
    headers.set("Content-Type", inferContentType(request, new URL(targetUrl), decrypted));
    headers.delete("Content-Disposition");
    headers.delete("Content-Encoding");
    headers.delete("Content-Length");
    headers.set("Cache-Control", "no-store");

    return new Response(decrypted, {
      status: 200,
      statusText: "OK",
      headers
    });
  } catch {
    return res;
  }
}

/* =========================
 * Fetch 拦截
 * ========================= */
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (!shouldHandle(url)) return;

  event.respondWith((async () => {
    if (request.method !== "GET") {
      return fetch(request);
    }

    const isNav = isNavigationRequest(request);

    // 关键修复 1：
    // 对没有扩展名且不以 / 结尾的“目录式页面路径”，先重定向到带 / 的规范 URL
    // 例如 /awa/main/nwf/qce -> /awa/main/nwf/qce/
    if (isNav && !url.pathname.endsWith("/") && !hasExtension(url.pathname)) {
      const redirectUrl = new URL(url.href);
      redirectUrl.pathname += "/";
      return Response.redirect(redirectUrl.href, 302);
    }

    // 关键修复 2：
    // 对目录导航 /foo/bar/ ，实际去取 /foo/bar/index.html
    if (isNav && url.pathname.endsWith("/")) {
      const indexUrl = new URL(url.href);
      indexUrl.pathname += "index.html";
      return fetchAndMaybeDecrypt(request, indexUrl.href);
    }

    // 普通请求：直接按原 URL 取并尝试解密
    return fetchAndMaybeDecrypt(request, url.href);
  })());
});