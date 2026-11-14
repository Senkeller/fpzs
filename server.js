'use strict';
/*
 * 开发 / 局域网静态服务器。安全路径解析与 portable-server.js 共用 safe-path.js。
 *
 *   node server.js                      # 默认只监听 127.0.0.1:8000
 *   HOST=0.0.0.0 node server.js        # 需要局域网访问时显式开放（先确认防火墙）
 *   PORT=3000 node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { MIME, FALLBACK_PAGE, legacyRedirect, toAsset, resolveSafe } = require('./safe-path.js');

const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;

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

function readFileSafe(rel) {
  const full = resolveSafe(ROOT, rel);
  if (!full) return null;
  try {
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return fs.readFileSync(full);
  } catch (e) {
    return null;
  }
}

function serve404(res) {
  const body = readFileSafe('404.html') || Buffer.from('<h1>404 Not Found</h1>', 'utf8');
  send(res, 404, 'text/html; charset=utf-8', body);
}

const server = http.createServer((req, res) => {
  try {
    const url = req.url || '/';

    // 落地页已移除：旧书签 /index.html、/index.txt 统一回功能页
    const legacy = legacyRedirect(url);
    if (legacy) return redirect(res, 301, legacy);

    const rel = toAsset(url);
    if (!rel) return send(res, 400, 'text/plain; charset=utf-8', Buffer.from('Bad Request', 'utf8'));

    let file = rel;
    let body = readFileSafe(file);

    // 目录 → 该目录下的 main.html
    if (!body && !path.posix.extname(rel)) {
      const dirIndex = path.posix.join(rel, FALLBACK_PAGE);
      const candidate = readFileSafe(dirIndex);
      if (candidate) { file = dirIndex; body = candidate; }
    }

    // Next.js RSC 的 *.txt 载荷 → 同名 .html；无同名页面时回功能页
    if (!body && path.posix.extname(rel).toLowerCase() === '.txt') {
      const htmlRel = rel.replace(/\.txt$/i, '.html');
      const target = readFileSafe(htmlRel) ? '/' + htmlRel : '/' + FALLBACK_PAGE;
      return redirect(res, 302, target);
    }

    if (!body) return serve404(res);

    // 注意用 file（而非 rel）取扩展名：回退到 main.html 时 MIME 必须同步
    const ext = path.posix.extname(file).toLowerCase();
    return send(res, 200, MIME[ext] || 'application/octet-stream', body);
  } catch (e) {
    // 单个请求的异常不能拖垮整个进程
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

server.listen(PORT, HOST, () => {
  console.log('Server running:');
  console.log('  app:  http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + '/');
  console.log('  main: http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + '/main.html');
  console.log('  bind: ' + HOST + ' (set HOST=0.0.0.0 for LAN access)');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' already in use');
    process.exit(1);
  } else {
    console.error('Server error:', err);
  }
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
