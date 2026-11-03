// Paths, safe file names and atomic JSON/file IO.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = path.resolve(process.env.LANTERN_DATA || path.join(ROOT, 'data'));

// Same folder names as SillyTavern's data/default-user so files stay interchangeable.
export const DIRS = {
  characters: path.join(DATA, 'characters'),
  chats: path.join(DATA, 'chats'),
  groupChats: path.join(DATA, 'group chats'),
  groups: path.join(DATA, 'groups'),
  worlds: path.join(DATA, 'worlds'),
  presets: path.join(DATA, 'OpenAI Settings'),
  userAvatars: path.join(DATA, 'User Avatars'),
  thumbs: path.join(DATA, 'thumbnails'),
  index: path.join(DATA, '_index'),
  trash: path.join(DATA, '_trash'),
};

export function ensureDirs() {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(DIRS.thumbs, 'avatar'), { recursive: true });
  fs.mkdirSync(path.join(DIRS.thumbs, 'persona'), { recursive: true });
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** A single path segment: no separators, no traversal, no control chars. */
export function safeName(name) {
  if (typeof name !== 'string' || !name || name.length > 255) throw new HttpError(400, 'Invalid file name');
  if (/[\\/\0]/.test(name) || name === '.' || name === '..' || name.includes('..')) throw new HttpError(400, 'Invalid file name');
  return name;
}

/** Turn a display name into a file-system friendly base name. */
export function slug(name) {
  const s = String(name || 'Untitled').replace(/[\\/:*?"<>|\0]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || 'Untitled';
}

export function uniqueFile(dir, base, ext) {
  let name = base + ext, n = 1;
  while (fs.existsSync(path.join(dir, name))) name = `${base}${n++}${ext}`;
  return name;
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function writeJson(file, obj) {
  writeFileAtomic(file, JSON.stringify(obj, null, 2));
}

export function moveToTrash(src) {
  if (!fs.existsSync(src)) return;
  const dest = path.join(DIRS.trash, `${Date.now()}-${path.basename(src)}`);
  fs.renameSync(src, dest);
}

/** "November 3, 2026 2:04pm" — the format SillyTavern writes into chats. */
export function humanDate(d = new Date()) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let h = d.getHours();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${String(d.getMinutes()).padStart(2, '0')}${ap}`;
}

/** "2026-11-03@14h04m05s" — SillyTavern's chat file name stamp. */
export function fileStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}@${p(d.getHours())}h${p(d.getMinutes())}m${p(d.getSeconds())}s`;
}
