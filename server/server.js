#!/usr/bin/env node
// Lantern — lightweight roleplay frontend. Zero dependencies: Node.js 18+ only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { ROOT, DATA, ensureDirs, HttpError, readJson } from './lib/store.js';
import * as chars from './lib/characters.js';
import * as chats from './lib/chats.js';
import * as cfg from './lib/settings.js';
import { generate, listModels } from './lib/proxy.js';
import { scanSillyTavern, importSillyTavern } from './lib/importer.js';

const VERSION = '0.1.2';
const WEB = path.join(ROOT, 'web');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const config = { port: 8000, host: '127.0.0.1', password: '', allowPublicIPs: false, ...readJson(CONFIG_FILE, {}) };
for (const a of process.argv.slice(2)) {
  const [k, v] = a.replace(/^--/, '').split('=');
  if (k === 'port') config.port = Number(v);
  if (k === 'host') config.host = v;
  if (k === 'lan') config.host = '0.0.0.0';
}
ensureDirs();

// ---------- helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
};
const gzCache = new Map();

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const gz = body.length > 1024 && /gzip/.test(res.req.headers['accept-encoding'] || '');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(gz ? zlib.gzipSync(body, { level: 4 }) : body);
}

function sniffImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF') return 'image/webp';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  return 'application/octet-stream';
}

/** Static/file response with ETag; `immutable` for versioned URLs; gzip for text. */
function sendFile(req, res, file, { immutable = false, type } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { throw new HttpError(404, 'Not found'); }
  if (!st.isFile()) throw new HttpError(404, 'Not found');
  const etag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
  const headers = {
    ETag: etag,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  const ext = path.extname(file).toLowerCase();
  let ct = type || MIME[ext] || 'application/octet-stream';
  const isText = /^(text\/|application\/(json|manifest)|image\/svg)/.test(ct);
  if (isText && /gzip/.test(req.headers['accept-encoding'] || '')) {
    const key = file + etag;
    let gz = gzCache.get(key);
    if (!gz) { gz = zlib.gzipSync(fs.readFileSync(file), { level: 9 }); gzCache.set(key, gz); }
    res.writeHead(200, { ...headers, 'Content-Type': ct, 'Content-Encoding': 'gzip', 'Content-Length': gz.length, Vary: 'Accept-Encoding' });
    return res.end(gz);
  }
  if (ext === '.webp' && !type) {
    const head = Buffer.alloc(4); const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
    ct = sniffImage(head);
  }
  res.writeHead(200, { ...headers, 'Content-Type': ct, 'Content-Length': st.size });
  fs.createReadStream(file).pipe(res);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Upload too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
async function readJsonBody(req) {
  const b = await readBody(req, 25 * 1024 * 1024);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw new HttpError(400, 'Body is not valid JSON'); }
}

// ---------- access control ----------
function isPrivate(ip) {
  const a = String(ip || '').replace(/^::ffff:/, '');
  return a === '::1' || a.startsWith('127.') || a.startsWith('10.') || a.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(a)
    || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a) || a.startsWith('fe80:') || a.startsWith('fd');
}
function checkAccess(req, res) {
  if (!config.allowPublicIPs && !isPrivate(req.socket.remoteAddress)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Lantern: connections from public addresses are blocked (see config.json).');
    return false;
  }
  const local = /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '');
  if (config.password && !local) {
    const h = req.headers.authorization || '';
    const [, b64] = h.split(' ');
    const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
    if (pass !== config.password) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Lantern"', 'Content-Type': 'text/plain' }); res.end('Password required');
      return false;
    }
  }
  return true;
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/bootstrap', () => ({
  version: VERSION, settings: cfg.getSettings(), providers: cfg.PROVIDERS,
  personas: cfg.listPersonas(), characters: chars.listCharacters(), dataDir: DATA,
}));

// characters
route('GET', '/api/characters', () => chars.listCharacters());
route('POST', '/api/characters', async ({ req }) => chars.createCharacter((await readJsonBody(req)).card || {}));
route('POST', '/api/characters/import', async ({ req, q }) => chars.importCharacter(q.get('name'), await readBody(req, 40 * 1024 * 1024)));
route('GET', '/api/characters/:file', ({ p }) => chars.getCharacter(p.file));
route('PUT', '/api/characters/:file', async ({ req, p }) => chars.saveCharacter(p.file, (await readJsonBody(req)).card));
route('PUT', '/api/characters/:file/image', async ({ req, p }) => chars.setImage(p.file, await readBody(req, 40 * 1024 * 1024)));
route('POST', '/api/characters/:file/fav', async ({ req, p }) => chars.setFavorite(p.file, (await readJsonBody(req)).fav));
route('POST', '/api/characters/:file/duplicate', ({ p }) => chars.duplicateCharacter(p.file));
route('DELETE', '/api/characters/:file', ({ p, q }) => { chars.deleteCharacter(p.file, { withChats: q.get('chats') === '1' }); return { ok: true }; });
route('GET', '/api/characters/:file/export.json', ({ req, res, p }) => {
  const body = JSON.stringify(chars.exportCharacterJson(p.file), null, 2);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(p.file.replace(/\.png$/i, '.json'))}` });
  res.end(body);
});
route('GET', '/img/char/:file', ({ req, res, p, q }) => sendFile(req, res, chars.imagePath(p.file), { immutable: q.has('v') }));
route('GET', '/img/thumb/:kind/:file', ({ req, res, p, q }) => sendFile(req, res, chars.thumbPath(p.kind, p.file, q.get('v')), { immutable: true }));
route('PUT', '/img/thumb/:kind/:file', async ({ req, p, q }) => { chars.saveThumb(p.kind, p.file, q.get('v'), await readBody(req, 700 * 1024)); return { ok: true }; });
route('GET', '/img/persona/:avatar', ({ req, res, p, q }) => sendFile(req, res, cfg.personaImagePath(p.avatar), { immutable: q.has('v') }));

// chats
route('GET', '/api/chats/:char', ({ p }) => chats.listChats(p.char));
route('POST', '/api/chats/:char', async ({ req, p }) => chats.createChat(p.char, await readJsonBody(req)));
route('POST', '/api/chats/:char/import', async ({ req, p, q }) => chats.importChat(p.char, q.get('name'), (await readBody(req, 100 * 1024 * 1024)).toString('utf8')));
route('GET', '/api/chats/:char/:chat', ({ p, q }) => chats.readChat(p.char, p.chat, { end: q.has('end') ? Number(q.get('end')) : undefined, limit: Number(q.get('limit') || 50) }));
route('POST', '/api/chats/:char/:chat/ops', async ({ req, p }) => chats.applyOps(p.char, p.chat, (await readJsonBody(req)).ops));
route('POST', '/api/chats/:char/:chat/branch', async ({ req, p }) => chats.branchChat(p.char, p.chat, (await readJsonBody(req)).upTo));
route('POST', '/api/chats/:char/:chat/rename', async ({ req, p }) => chats.renameChat(p.char, p.chat, (await readJsonBody(req)).name));
route('DELETE', '/api/chats/:char/:chat', ({ p }) => { chats.deleteChat(p.char, p.chat); return { ok: true }; });
route('GET', '/api/chats/:char/:chat/download', ({ req, res, p }) => {
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(p.chat)}`);
  sendFile(req, res, chats.rawChatPath(p.char, p.chat), { type: 'application/jsonl' });
});

// settings, connections, generation
route('GET', '/api/settings', () => cfg.getSettings());
route('PUT', '/api/settings', async ({ req }) => cfg.saveSettings(await readJsonBody(req)));
route('POST', '/api/profiles', async ({ req }) => cfg.saveProfile(await readJsonBody(req)));
route('DELETE', '/api/profiles/:id', ({ p }) => cfg.deleteProfile(p.id));
route('GET', '/api/models', ({ q }) => listModels(q.get('profile')));
route('POST', '/api/generate', async ({ req, res }) => { await generate(req, res, await readJsonBody(req)); });

// personas
route('GET', '/api/personas', () => cfg.listPersonas());
route('POST', '/api/personas', async ({ req }) => cfg.savePersona(await readJsonBody(req)));
route('PUT', '/api/personas/:avatar/image', async ({ req, p }) => { cfg.setPersonaImage(p.avatar, await readBody(req, 30 * 1024 * 1024)); return { ok: true }; });
route('DELETE', '/api/personas/:avatar', ({ p }) => { cfg.deletePersona(p.avatar); return { ok: true }; });

// SillyTavern import
route('POST', '/api/import/st/scan', async ({ req }) => scanSillyTavern((await readJsonBody(req)).path));
route('POST', '/api/import/st', async ({ req }) => { const b = await readJsonBody(req); return importSillyTavern(b.path, b.parts); });

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  if (!checkAccess(req, res)) return;
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/img/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const p = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const out = await r.handler({ req, res, p, q: url.searchParams });
        if (!res.headersSent && out !== undefined) sendJson(res, 200, out);
        return;
      }
      throw new HttpError(404, `No route for ${req.method} ${url.pathname}`);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.join(WEB, path.normalize(rel).replace(/^([\\/]*\.\.)+/, ''));
    if (!file.startsWith(WEB)) throw new HttpError(403, 'Forbidden');
    sendFile(req, res, file);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(`[${req.method} ${url.pathname}]`, e);
    if (!res.headersSent) sendJson(res, status, { error: e.message || 'Server error' });
    else res.end();
  }
});

server.listen(config.port, config.host, () => {
  const lan = config.host === '0.0.0.0' || config.host === '::';
  console.log(`\n  Lantern ${VERSION}\n  Open:  http://localhost:${config.port}`);
  if (lan) {
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  LAN:   http://${a.address}:${config.port}`);
    if (!config.password) console.log('  Note:  set "password" in config.json before using Lantern over Wi-Fi.');
  }
  console.log(`  Data:  ${DATA}\n`);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${config.port} is in use. Start with --port=8001 or change config.json.`);
  else console.error(e);
  process.exit(1);
});
