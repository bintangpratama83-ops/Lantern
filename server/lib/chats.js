// Chats in SillyTavern's JSONL format: line 1 = header, then one message per line.
// Performance: the browser asks for a page of messages (newest first); the server
// keeps recently used chats as split lines in memory and only JSON-parses the page.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, HttpError, safeName, writeFileAtomic, moveToTrash, fileStamp, humanDate, uniqueFile } from './store.js';
import { touchChats } from './characters.js';

const cache = new Map(); // path -> { m, lines }
const CACHE_MAX = 6;

function chatDir(charFile) {
  safeName(charFile);
  return path.join(DIRS.chats, charFile.replace(/\.png$/i, ''));
}
function chatPath(charFile, chatFile) {
  safeName(chatFile);
  if (!chatFile.endsWith('.jsonl')) throw new HttpError(400, 'Chat file must be .jsonl');
  return path.join(chatDir(charFile), chatFile);
}

function loadLines(p) {
  let st;
  try { st = fs.statSync(p); } catch { throw new HttpError(404, 'Chat not found'); }
  const hit = cache.get(p);
  if (hit && hit.m === st.mtimeMs) { cache.delete(p); cache.set(p, hit); return hit.lines; }
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
  remember(p, st.mtimeMs, lines);
  return lines;
}
function remember(p, m, lines) {
  cache.delete(p);
  cache.set(p, { m, lines });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}
function persist(p, lines) {
  writeFileAtomic(p, lines.join('\n') + '\n');
  remember(p, fs.statSync(p).mtimeMs, lines);
}

/** Read the last ~2 KB of a file to show a preview without loading the chat. */
function tailPreview(p) {
  let fd;
  try {
    fd = fs.openSync(p, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 4096);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try { const m = JSON.parse(lines[i]); if (typeof m.mes === 'string') return m.mes.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/[*_~`#>]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 160); } catch { /* partial line */ }
    }
  } catch { /* ignore */ } finally { if (fd !== undefined) fs.closeSync(fd); }
  return '';
}

export function listChats(charFile) {
  const dir = chatDir(charFile);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    return { file: f, size: st.size, mtime: st.mtimeMs, preview: tailPreview(p) };
  }).sort((a, b) => b.mtime - a.mtime);
}

/** Page of messages. `end` = exclusive message index (default: all), `limit` messages before it. */
export function readChat(charFile, chatFile, { end, limit = 50 } = {}) {
  const lines = loadLines(chatPath(charFile, chatFile));
  let header = {};
  try { header = JSON.parse(lines[0]); } catch { /* broken header */ }
  const total = Math.max(0, lines.length - 1);
  const e = Math.min(total, end == null || Number.isNaN(end) ? total : end);
  const s = Math.max(0, e - Math.min(500, Math.max(1, limit)));
  const messages = [];
  for (let i = s; i < e; i++) {
    try { messages.push(JSON.parse(lines[i + 1])); } catch { messages.push({ name: 'System', is_system: true, mes: '[unreadable line]' }); }
  }
  return { header, total, start: s, messages };
}

/**
 * Apply edits in order. Message indices are 0-based (header excluded).
 * ops: {op:'append', msg} | {op:'set', i, msg} | {op:'delete', i} | {op:'truncate', len} | {op:'header', header}
 */
export function applyOps(charFile, chatFile, ops) {
  const p = chatPath(charFile, chatFile);
  const lines = [...loadLines(p)];
  for (const o of ops || []) {
    const idx = (i) => {
      if (!Number.isInteger(i) || i < 0 || i >= lines.length - 1) throw new HttpError(409, `Message ${i} does not exist (chat changed elsewhere?)`);
      return i + 1;
    };
    if (o.op === 'append') lines.push(JSON.stringify(o.msg));
    else if (o.op === 'set') lines[idx(o.i)] = JSON.stringify(o.msg);
    else if (o.op === 'delete') lines.splice(idx(o.i), 1);
    else if (o.op === 'truncate') lines.length = Math.max(1, Math.min(lines.length, o.len + 1));
    else if (o.op === 'header') lines[0] = JSON.stringify(o.header);
    else throw new HttpError(400, `Unknown op ${o.op}`);
  }
  persist(p, lines);
  touchChats(charFile.replace(/\.png$/i, ''));
  return { total: lines.length - 1 };
}

export function createChat(charFile, { header, messages = [], name } = {}) {
  const dir = chatDir(charFile);
  fs.mkdirSync(dir, { recursive: true });
  const charName = header?.character_name || charFile.replace(/\.png$/i, '');
  const base = name ? String(name).replace(/[\\/:*?"<>|\0]/g, '').trim() : `${charName} - ${fileStamp()}`;
  const file = uniqueFile(dir, base || fileStamp(), '.jsonl');
  const h = { user_name: 'User', character_name: charName, create_date: humanDate(), chat_metadata: {}, ...header };
  persist(path.join(dir, file), [JSON.stringify(h), ...messages.map((m) => JSON.stringify(m))]);
  touchChats(charFile.replace(/\.png$/i, ''), { added: 1 });
  return { file };
}

/** New chat file holding messages [0, upTo] of an existing chat. */
export function branchChat(charFile, chatFile, upTo) {
  const lines = loadLines(chatPath(charFile, chatFile));
  const keep = lines.slice(0, Math.max(1, Math.min(lines.length, upTo + 2)));
  const dir = chatDir(charFile);
  const file = uniqueFile(dir, `Branch #${upTo + 1} - ${chatFile.replace(/\.jsonl$/, '')}`.slice(0, 120), '.jsonl');
  let header = {};
  try { header = JSON.parse(keep[0]); } catch { /* ignore */ }
  header.chat_metadata = { ...(header.chat_metadata || {}), main_chat: chatFile.replace(/\.jsonl$/, '') };
  keep[0] = JSON.stringify(header);
  persist(path.join(dir, file), keep);
  touchChats(charFile.replace(/\.png$/i, ''), { added: 1 });
  return { file };
}

export function renameChat(charFile, chatFile, newName) {
  const from = chatPath(charFile, chatFile);
  const clean = String(newName || '').replace(/[\\/:*?"<>|\0]/g, '').trim();
  if (!clean) throw new HttpError(400, 'Name is required');
  const file = uniqueFile(chatDir(charFile), clean, '.jsonl');
  fs.renameSync(from, path.join(chatDir(charFile), file));
  cache.delete(from);
  return { file };
}

export function deleteChat(charFile, chatFile) {
  const p = chatPath(charFile, chatFile);
  moveToTrash(p);
  cache.delete(p);
  touchChats(charFile.replace(/\.png$/i, ''), { added: -1 });
}

export function rawChatPath(charFile, chatFile) {
  const p = chatPath(charFile, chatFile);
  if (!fs.existsSync(p)) throw new HttpError(404, 'Chat not found');
  return p;
}

export function importChat(charFile, fileName, text) {
  const lines = String(text).split('\n').filter((l) => l.trim());
  try { JSON.parse(lines[0]); } catch { throw new HttpError(415, 'Not a SillyTavern .jsonl chat'); }
  const dir = chatDir(charFile);
  fs.mkdirSync(dir, { recursive: true });
  const file = uniqueFile(dir, String(fileName || 'Imported').replace(/\.jsonl$/i, '').replace(/[\\/:*?"<>|\0]/g, ''), '.jsonl');
  persist(path.join(dir, file), lines);
  touchChats(charFile.replace(/\.png$/i, ''), { added: 1 });
  return { file };
}
