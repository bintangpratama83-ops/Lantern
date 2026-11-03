// Character cards: index cache, read/write (V1/V2/V3), import, create, delete.
// Performance: the list endpoint only sends a tiny summary per card, and only
// re-parses PNG files whose size/mtime changed since the last scan.
import fs from 'node:fs';
import path from 'node:path';
import { readChunks, readTextChunks, writeTextChunks, isPng, defaultAvatarPng } from './png.js';
import { DIRS, HttpError, safeName, slug, uniqueFile, readJson, writeJson, writeFileAtomic, moveToTrash } from './store.js';

const INDEX_FILE = () => path.join(DIRS.index, 'characters.json');
let index = null; // { v, files: { [file]: entry } }

function loadIndex() {
  if (!index) {
    index = readJson(INDEX_FILE(), null);
    if (!index || index.v !== 2) index = { v: 2, files: {} };
  }
  return index;
}
let saveTimer = null;
function saveIndexSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJson(INDEX_FILE(), index), 300);
}

const V1_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'];
const V2_DEFAULTS = {
  name: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
  creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [],
  tags: [], creator: '', character_version: '', extensions: {},
};

/** Normalise any card JSON into the V2 `data` object (V3 extras are kept). */
export function normalizeCard(json) {
  if (!json || typeof json !== 'object') throw new HttpError(400, 'Card data is not valid JSON');
  let data;
  if (json.data && typeof json.data === 'object' && /chara_card_v[23]/.test(json.spec || '')) data = { ...json.data };
  else if (json.data && typeof json.data === 'object' && json.data.name) data = { ...json.data };
  else {
    data = {};
    for (const k of V1_FIELDS) data[k] = json[k] ?? json[`char_${k}`] ?? '';
    if (json.char_name) data.name = json.char_name;
    if (json.char_persona) data.description = json.char_persona;
    if (json.world_scenario) data.scenario = json.world_scenario;
    if (json.char_greeting) data.first_mes = json.char_greeting;
    if (json.example_dialogue) data.mes_example = json.example_dialogue;
    data.tags = json.tags || [];
    data.creator_notes = json.creatorcomment || json.creator_notes || '';
  }
  for (const [k, v] of Object.entries(V2_DEFAULTS)) if (data[k] == null) data[k] = structuredClone(v);
  if (!Array.isArray(data.tags)) data.tags = String(data.tags).split(',').map((t) => t.trim()).filter(Boolean);
  if (!Array.isArray(data.alternate_greetings)) data.alternate_greetings = [];
  if (typeof data.extensions !== 'object' || !data.extensions) data.extensions = {};
  // SillyTavern also keeps `fav` / `talkativeness` on the top level of older cards.
  if (json.fav != null && data.extensions.fav == null) data.extensions.fav = !!json.fav;
  return data;
}

function decodeChunk(text) {
  const raw = Buffer.from(text, 'base64').toString('utf8');
  return JSON.parse(raw);
}

export function readCardFromPng(buf) {
  const t = readTextChunks(buf);
  const src = t.ccv3 || t.chara;
  if (!src) throw new HttpError(422, 'This PNG has no character data');
  try { return normalizeCard(decodeChunk(src)); } catch (e) {
    if (t.ccv3 && t.chara) return normalizeCard(decodeChunk(t.chara));
    throw new HttpError(422, `Character data could not be read: ${e.message}`);
  }
}

/** Build the chunk payloads SillyTavern writes: `chara` (V2) and `ccv3` (V3). */
function encodeCard(data) {
  const v2 = { ...Object.fromEntries(V1_FIELDS.map((k) => [k, data[k] ?? ''])), spec: 'chara_card_v2', spec_version: '2.0', data };
  v2.tags = data.tags;
  v2.creatorcomment = data.creator_notes;
  v2.fav = !!data.extensions?.fav;
  v2.create_date = data.extensions?.create_date || data.creation_date || undefined;
  const v3 = { ...v2, spec: 'chara_card_v3', spec_version: '3.0', data: { ...data, group_only_greetings: data.group_only_greetings || [] } };
  const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
  return { chara: b64(v2), ccv3: b64(v3) };
}

/** Image identity that ignores text chunks, so editing a card keeps its thumbnail. */
function imageVersion(buf) {
  let len = 0, crc = '';
  for (const c of readChunks(buf)) {
    if (c.type === 'IDAT') {
      len += c.data.length;
      if (!crc) crc = buf.readUInt32BE(c.end - 4).toString(36);
    }
  }
  return `${crc}${len.toString(36)}`;
}

function chatStats(base) {
  const dir = path.join(DIRS.chats, base);
  let chats = 0, last = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      chats++;
      const m = fs.statSync(path.join(dir, f)).mtimeMs;
      if (m > last) last = m;
    }
  } catch { /* no chats yet */ }
  return { chats, last };
}

function chatDirMtime(base) {
  try { return fs.statSync(path.join(DIRS.chats, base)).mtimeMs; } catch { return 0; }
}

function buildEntry(file, st) {
  const buf = fs.readFileSync(path.join(DIRS.characters, file));
  const d = readCardFromPng(buf);
  const base = file.replace(/\.png$/i, '');
  const notes = String(d.creator_notes || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    m: st.mtimeMs, s: st.size, iv: imageVersion(buf),
    name: d.name || base, tags: d.tags.slice(0, 20), fav: !!d.extensions.fav, creator: d.creator || '',
    note: notes.slice(0, 140), cdm: chatDirMtime(base), ...chatStats(base),
  };
}

export function listCharacters() {
  const idx = loadIndex();
  let changed = false;
  const seen = new Set();
  for (const file of fs.readdirSync(DIRS.characters)) {
    if (!/\.png$/i.test(file)) continue;
    seen.add(file);
    const st = fs.statSync(path.join(DIRS.characters, file));
    const e = idx.files[file];
    if (!e || e.m !== st.mtimeMs || e.s !== st.size) {
      try { idx.files[file] = buildEntry(file, st); } catch (err) { idx.files[file] = { m: st.mtimeMs, s: st.size, iv: '0', name: file, error: err.message, tags: [], chats: 0, last: 0, cdm: 0 }; }
      changed = true;
    } else {
      const base = file.replace(/\.png$/i, '');
      const cdm = chatDirMtime(base);
      if (cdm !== e.cdm) { Object.assign(e, { cdm }, chatStats(base)); changed = true; }
    }
  }
  for (const f of Object.keys(idx.files)) if (!seen.has(f)) { delete idx.files[f]; changed = true; }
  if (changed) saveIndexSoon();
  return Object.entries(idx.files).map(([file, e]) => ({
    file, name: e.name, tags: e.tags, fav: !!e.fav, creator: e.creator, note: e.note || '',
    iv: e.iv, chats: e.chats, last: e.last, error: e.error,
  }));
}

/** Called by the chat module after it writes, so "recent" sorting stays right without rescans. */
export function touchChats(base, { added = 0 } = {}) {
  const e = loadIndex().files[`${base}.png`];
  if (!e) return;
  e.last = Date.now();
  e.chats += added;
  e.cdm = chatDirMtime(base);
  saveIndexSoon();
}

function charPath(file) {
  safeName(file);
  if (!/\.png$/i.test(file)) throw new HttpError(400, 'Character file must be a .png');
  const p = path.join(DIRS.characters, file);
  if (!fs.existsSync(p)) throw new HttpError(404, 'Character not found');
  return p;
}

export function getCharacter(file) {
  return readCardFromPng(fs.readFileSync(charPath(file)));
}

export function imagePath(file) { return charPath(file); }

function refreshEntry(file) {
  const p = path.join(DIRS.characters, file);
  try { loadIndex().files[file] = buildEntry(file, fs.statSync(p)); saveIndexSoon(); } catch { /* ignore */ }
  return loadIndex().files[file];
}

export function saveCharacter(file, data) {
  const p = charPath(file);
  const card = normalizeCard({ spec: 'chara_card_v2', data });
  card.extensions.modification_date = Date.now();
  writeFileAtomic(p, writeTextChunks(fs.readFileSync(p), encodeCard(card)));
  const e = refreshEntry(file);
  return { file, iv: e?.iv, card };
}

export function setFavorite(file, fav) {
  const card = getCharacter(file);
  card.extensions.fav = !!fav;
  return saveCharacter(file, card);
}

/** Replace the portrait, keeping the card text. Body must already be a PNG (the browser converts). */
export function setImage(file, png) {
  if (!isPng(png)) throw new HttpError(415, 'Image must be a PNG');
  const p = charPath(file);
  const card = getCharacter(file);
  writeFileAtomic(p, writeTextChunks(png, encodeCard(card)));
  removeThumbs(file);
  return { file, iv: refreshEntry(file)?.iv };
}

export function createCharacter(data, png) {
  const card = normalizeCard({ spec: 'chara_card_v2', data });
  if (!card.name.trim()) throw new HttpError(400, 'Name is required');
  card.extensions.create_date = card.extensions.create_date || new Date().toISOString();
  const file = uniqueFile(DIRS.characters, slug(card.name), '.png');
  const img = png && isPng(png) ? png : defaultAvatarPng([...card.name].reduce((a, c) => a + c.charCodeAt(0) * 7, 0));
  writeFileAtomic(path.join(DIRS.characters, file), writeTextChunks(img, encodeCard(card)));
  const e = refreshEntry(file);
  return { file, iv: e?.iv, name: card.name };
}

/** Import a PNG card or a JSON card file. */
export function importCharacter(fileName, buf) {
  if (isPng(buf)) {
    const card = readCardFromPng(buf);
    return createCharacter(card, buf);
  }
  let json;
  try { json = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(415, `${fileName || 'File'} is not a PNG or JSON character card`); }
  return createCharacter(normalizeCard(json), null);
}

export function exportCharacterJson(file) {
  const data = getCharacter(file);
  return { spec: 'chara_card_v3', spec_version: '3.0', ...Object.fromEntries(V1_FIELDS.map((k) => [k, data[k]])), data };
}

export function deleteCharacter(file, { withChats = false } = {}) {
  const p = charPath(file);
  moveToTrash(p);
  removeThumbs(file);
  if (withChats) moveToTrash(path.join(DIRS.chats, file.replace(/\.png$/i, '')));
  delete loadIndex().files[file];
  saveIndexSoon();
}

export function duplicateCharacter(file) {
  const p = charPath(file);
  const card = getCharacter(file);
  return createCharacter({ ...card, name: card.name }, fs.readFileSync(p));
}

// ---- thumbnails (generated by the browser, cached here) ----
export function thumbPath(kind, file, v) {
  safeName(file); safeName(String(v || '0'));
  return path.join(DIRS.thumbs, kind === 'persona' ? 'persona' : 'avatar', `${file}.${v}.webp`);
}
export function removeThumbs(file, kind = 'avatar') {
  const dir = path.join(DIRS.thumbs, kind);
  try { for (const f of fs.readdirSync(dir)) if (f.startsWith(`${file}.`) && f.endsWith('.webp')) fs.unlinkSync(path.join(dir, f)); } catch { /* none */ }
}
export function saveThumb(kind, file, v, buf) {
  if (buf.length > 600 * 1024) throw new HttpError(413, 'Thumbnail too large');
  if (buf.subarray(0, 4).toString('latin1') !== 'RIFF' && buf.subarray(0, 3).toString('latin1') !== '\xff\xd8\xff') throw new HttpError(415, 'Thumbnail must be WebP or JPEG');
  removeThumbs(file, kind === 'persona' ? 'persona' : 'avatar');
  writeFileAtomic(thumbPath(kind, file, v), buf);
}

export function invalidateIndex() { index = { v: 2, files: {} }; }
