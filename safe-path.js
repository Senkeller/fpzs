'use strict';
/*
 * 静态服务器共用的 URL → 资源路径解析（零依赖）。
 *
 * server.js 与 portable-server.js（含 SEA 单文件 exe）都通过本模块解析路径，
 * 避免两套实现的安全边界不一致。历史上 server.js 直接用 '.' + req.url 拼路径，
 * 导致 /../ 可读项目外文件、/% 畸形 URL 可打崩进程。
 */

const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const FALLBACK_PAGE = 'main.html';

/** 旧落地页书签 → 功能页；返回重定向目标或 null */
function legacyRedirect(url) {
  const raw = String(url || '').split('?')[0].split('#')[0];
  return /^\/index\.(html?|txt)$/i.test(raw) ? '/main.html' : null;
}

/**
 * 把 URL 路径安全地转成相对资源路径。
 * 返回 null 表示畸形 URL 或越界（调用方应回 400/403）。
 */
function toAsset(url) {
  let p;
  try {
    p = decodeURIComponent(String(url || '/').split('?')[0].split('#')[0]);
  } catch (e) {
    return null; // 例如 /% —— 未捕获的 URIError 曾直接打崩进程
  }
  if (p.length > 2048 || p.indexOf('\0') !== -1) return null;
  p = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || p === '/') return FALLBACK_PAGE;
  if (/^index\.(html?|txt)$/i.test(p)) return FALLBACK_PAGE;
  const norm = path.posix.normalize(p);
  if (
    norm === '..' ||
    norm.startsWith('../') ||
    norm.startsWith('/') ||
    /^[A-Za-z]:/.test(norm) ||      // Windows 盘符 / 备用数据流
    norm.indexOf('\0') !== -1
  ) return null;
  return norm;
}

/** 把相对路径解析到 root 内；越界返回 null（含符号链接无法覆盖的边界检查） */
function resolveSafe(root, rel) {
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

module.exports = { MIME, FALLBACK_PAGE, legacyRedirect, toAsset, resolveSafe };
