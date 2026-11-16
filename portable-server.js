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
const crypto = require('crypto');
const { exec } = require('child_process');
const { MIME, FALLBACK_PAGE, legacyRedirect, toAsset, resolveSafe } = require('./safe-path.js');

let sea = null;
try { sea = require('node:sea'); } catch (e) { /* 老版本 Node 无 node:sea */ }
const IS_SEA = !!(sea && sea.isSea());
const ROOT = __dirname;
process.title = '发票打印助手';

// 单实例自检用的健康端点（不参与资源服务，不会被真实文件覆盖）
const HEALTH_PATH = '/__healthz';
const HEALTH_BODY = 'invoice-print-helper-ok';

// 退出端点必须带一次性 token（随启动横幅打印）。
// 仅绑定 127.0.0.1 并不足以防止本地网页通过 <img>/fetch 偷偷关停服务。
const QUIT_TOKEN = crypto.randomBytes(6).toString('hex');

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

    const pathname = url.split('?')[0].split('#')[0];

    // 单实例自检端点：仅本程序会返回固定串，用于探测端口是否已被本程序占用
    if (pathname === HEALTH_PATH) {
      return send(res, 200, 'text/plain; charset=utf-8', Buffer.from(HEALTH_BODY, 'utf8'));
    }

    // 优雅退出端点：必须带本次启动随机生成的 token，避免任意网页悄悄关停服务
    if (pathname === '/__quit') {
      const params = new URLSearchParams(url.split('?')[1] || '');
      if (params.get('token') !== QUIT_TOKEN) {
        return send(res, 403, 'text/plain; charset=utf-8', Buffer.from('Forbidden: invalid quit token', 'utf8'));
      }
      send(res, 200, 'text/plain; charset=utf-8', Buffer.from('正在退出…', 'utf8'));
      setImmediate(() => process.exit(0));
      return;
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

// 启动横幅：控制台下带 ANSI 配色；管道/重定向时自动退化为纯文本
function printBanner(port) {
  const url = 'http://127.0.0.1:' + port + '/';
  const tty = !!process.stdout.isTTY;
  const a = (n) => (tty ? '\x1b[' + n + 'm' : '');
  const R = a(0), B = a('1;36'), D = a(2), G = a(32), Y = a(33);
  const rule = D + '  ' + '-'.repeat(46) + R;
  console.log('');
  console.log('  ' + B + '发票打印助手' + R + D + '   本地单文件便携版' + R);
  console.log(rule);
  console.log('  ' + G + '打开浏览器 : ' + R + url);
  console.log('  ' + G + '资源来源   : ' + R + (IS_SEA ? '已内嵌于 exe（无需安装、无需联网）' : ROOT));
  console.log('  ' + Y + '退出方式   : ' + R + '关闭本窗口，或访问 ' + url + '__quit?token=' + QUIT_TOKEN);
  console.log(rule);
  console.log('');
  return url;
}

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
    const url = printBanner(port);
    if (!process.env.NO_BROWSER) openBrowser(url);
  });
}

// 探测 BASE_PORT 是否已被「本程序」占用（靠健康端点的固定返回串识别，
// 避免误判别的程序恰好占了 8000）。命中则视为已有实例在跑。
function probeExistingInstance(port, cb) {
  // timeout / error / end 可能并发触发；没有 once 保护时 startServer 会被调用两次，
  // 第二次 listen 会直接抛 ERR_SERVER_ALREADY_LISTEN。
  let done = false;
  const finish = (isOurs) => {
    if (done) return;
    done = true;
    cb(isOurs);
  };
  const req = http.get({ host: '127.0.0.1', port: port, path: HEALTH_PATH, timeout: 800 }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => finish(data.trim() === HEALTH_BODY));
  });
  req.on('error', () => finish(false));
  req.on('timeout', () => { req.destroy(); finish(false); });
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
