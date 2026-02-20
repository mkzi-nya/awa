/* sw.js */

let PW = null;

importScripts("https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.34/dist/zip-full.min.js");

function mimeByExt(path) {
  const p = path.toLowerCase();
  if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".woff")) return "font/woff";
  if (p.endsWith(".woff2")) return "font/woff2";
  if (p.endsWith(".ttf")) return "font/ttf";
  if (p.endsWith(".otf")) return "font/otf";
  if (p.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "SET_PASSWORD") {
    PW = d.password || null;
    // ACK：确保页面知道 PW 已经写入 SW
    if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true });
  }
});

async function decryptZipBlobToResponse(pathname, zipBlob) {
  const baseName = pathname.substring(pathname.lastIndexOf("/awa/") + 1);

  const reader = new zip.ZipReader(new zip.BlobReader(zipBlob), { password: PW });
  const entries = await reader.getEntries();

  if (!entries || entries.length === 0) {
    await reader.close();
    throw new Error("empty zip");
  }

  // 优先同名 entry，否则取第一个文件 entry
  let entry = entries.find(e => !e.directory && (e.filename === baseName || e.filename.endsWith("/awa/" + baseName)));
  if (!entry) entry = entries.find(e => !e.directory);
  if (!entry) {
    await reader.close();
    throw new Error("no file entry");
  }

  const mime = mimeByExt(pathname);
  const outBlob = await entry.getData(new zip.BlobWriter(mime));
  await reader.close();

  const headers = new Headers();
  headers.set("Content-Type", mime);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Decrypted", "1");

  return new Response(outBlob, { status: 200, headers });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 只处理同源 /main/**（但放行 main.txt）
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/awa/main/")) return;
  if (url.pathname === "/awa/main/main.txt") return;

  event.respondWith((async () => {
    // 未设置密码：直接放行
    if (!PW) return fetch(req);

    // 先拿原始“伪装文件”（实际 zip）
    const net = await fetch(req);
    if (!net.ok) return net;

    try {
      const zipBlob = await net.blob();
      return await decryptZipBlobToResponse(url.pathname, zipBlob);
    } catch (e) {
      // 解密失败回落原响应（便于你看到真实情况）
      return net;
    }
  })());
});