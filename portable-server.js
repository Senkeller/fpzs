'use strict';
/*
 * 发票打印助手 · 便携服务入口
 *
 * 两种运行形态共用这一份代码：
 *   1) 普通 Node：node portable-server.js   → 从磁盘读文件
 *   2) Node SEA 单文件 exe：静态资源嵌在 exe 内 → 用 node:sea getAsset 读
 *
 * 只监听 127.0.0.1，端口被占用时自动顺延；启动后自动打开默认浏览器。
 * 无任何第三方依赖，无需 npm install。
 * 路径解析与 server.js 共用 safe-path.js，避免安全边界分叉。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { MIME, FALLBACK_PAGE, legacyRedirect, toAsset, resolveSafe } = require('./safe-path.js');

let sea = null;
try { sea = require('node:sea'); } catch (e) { /* 老版本 Node 无 node:sea */ }
const IS_SEA = !!(sea && sea.isSea());
const ROOT = __dirname;

// 单实例自检用的健康端点（不参与资源服务，不会被真实文件覆盖）
const HEALTH_PATH = '/__healthz';
const HEALTH_BODY = 'invoice-print-helper-ok';

function readAsset(rel) {
  if (IS_SEA) {
    // SEA assets 的 key 统一用正斜杠相对路径
    const buf = sea.getAsset(rel);
    return Buffer.from(buf);
  }
  const full = resolveSafe(ROOT, rel);
  if (!full) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return fs.readFileSync(full);
}

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? 'cmd /c start "" "' + url + '"'
    : (process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"');
  // SEA 环境下 child_process 若受限也不能让服务崩掉，仅提示手动打开
  try { exec(cmd, () => {}); }
  catch (e) { console.log('  Cannot open browser automatically. Open ' + url + ' manually.'); }
}

function noStore() {
  return { 'Cache-Control': 'no-cache, no-store, must-revalidate' };
}

function send(res, code, contentType, body) {
  const headers = Object.assign({ 'Content-Type': contentType }, noStore());
  if (Buffer.isBuffer(body)) headers['Content-Length'] = body.length;
  res.writeHead(code, headers);
  res.end(body);
}

function redirect(res, code, location) {
  res.writeHead(code, Object.assign({ 'Location': location }, noStore()));
  res.end();
}

const server = http.createServer((req, res) => {
  try {
    const url = req.url || '/';
    const legacy = legacyRedirect(url);
    if (legacy) return redirect(res, 301, legacy);

    // 单实例自检端点：仅本程序会返回固定串，用于探测端口是否已被本程序占用
    if (url === HEALTH_PATH) {
      return send(res, 200, 'text/plain; charset=utf-8', Buffer.from(HEALTH_BODY, 'utf8'));
    }

    const rel = toAsset(url);
    if (!rel) return send(res, 400, 'text/plain; charset=utf-8', Buffer.from('Bad Request', 'utf8'));

    let file = rel;
    let body = null;
    try { body = readAsset(file); } catch (e) { body = null; }

    // 目录 → 目录下 main.html（回退成功必须同步 file，否则 MIME 会按目录算）
    if (!body && !path.posix.extname(rel)) {
      const dirIndex = path.posix.join(rel, FALLBACK_PAGE);
      try {
        const candidate = readAsset(dirIndex);
        if (candidate) { body = candidate; file = dirIndex; }
      } catch (e) { /* ignore */ }
    }

    // Next.js RSC 的 *.txt 载荷 → 同名 .html；无同名页面时回功能页
    if (!body && path.posix.extname(rel).toLowerCase() === '.txt') {
      const htmlRel = rel.replace(/\.txt$/i, '.html');
      let hasHtml = false;
      try { hasHtml = !!readAsset(htmlRel); } catch (e) { /* ignore */ }
      return redirect(res, 302, hasHtml ? '/' + htmlRel : '/' + FALLBACK_PAGE);
    }

    if (!body) {
      let notFound = null;
      try { notFound = readAsset('404.html'); } catch (e) { /* ignore */ }
      return send(res, 404, 'text/html; charset=utf-8',
        notFound || Buffer.from('<h1>404 Not Found</h1>', 'utf8'));
    }

    // 用 file 而非 rel 取扩展名：目录 / .txt 回退后 MIME 才正确
    return send(res, 200, MIME[path.posix.extname(file).toLowerCase()] || 'application/octet-stream', body);
  } catch (e) {
    console.error('Request error:', e && e.message);
    try {
      if (res.headersSent) res.end();
      else send(res, 500, 'text/plain; charset=utf-8', Buffer.from('Internal Server Error', 'utf8'));
    } catch (_) { /* ignore */ }
  }
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

const BASE_PORT = Number(process.env.PORT) || 8000;
const MAX_TRY = 20;
let attempt = 0;

// 默认单实例：重复启动不新开服务/窗口，而是复用已在 8000 运行的实例并打开浏览器。
// 设 MULTI_INSTANCE=1 可恢复「端口被占就顺延」的旧多开行为。
const SINGLE_INSTANCE = !process.env.MULTI_INSTANCE;

function startServer(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_TRY) {
      attempt += 1;
      console.log('Port ' + port + ' is in use, trying ' + (port + 1) + ' ...');
      startServer(port + 1);
    } else {
      console.error('Cannot start server: ' + err.message);
      process.exitCode = 1;
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + port + '/';
    console.log('');
    console.log('  Invoice Print Helper  ' + (IS_SEA ? '[standalone exe]' : '[node]'));
    console.log('  ------------------------------------------');
    console.log('  Open in browser : ' + url);
    console.log('  Serving files   : ' + (IS_SEA ? 'embedded in exe' : ROOT));
    console.log('  Press Ctrl+C or close this window to stop.');
    console.log('');
    if (!process.env.NO_BROWSER) openBrowser(url);
  });
}

// 探测 BASE_PORT 是否已被「本程序」占用（靠健康端点的固定返回串识别，
// 避免误判别的程序恰好占了 8000）。命中则视为已有实例在跑。
function probeExistingInstance(port, cb) {
  const req = http.get({ host: '127.0.0.1', port: port, path: HEALTH_PATH, timeout: 800 }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => cb(data.trim() === HEALTH_BODY));
  });
  req.on('error', () => cb(false));
  req.on('timeout', () => { req.destroy(); cb(false); });
}

if (SINGLE_INSTANCE) {
  probeExistingInstance(BASE_PORT, (isOurs) => {
    if (isOurs) {
      const url = 'http://127.0.0.1:' + BASE_PORT + '/';
      console.log('Invoice Print Helper 已在运行（端口 ' + BASE_PORT + '）。已为你打开浏览器窗口，无需再开新实例。');
      if (!process.env.NO_BROWSER) openBrowser(url);
      process.exit(0);
    }
    startServer(BASE_PORT);
  });
} else {
  startServer(BASE_PORT);
}
