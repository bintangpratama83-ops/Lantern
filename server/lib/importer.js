// One-click import from a SillyTavern install. Copies files; never modifies the source.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATA, DIRS, HttpError, readJson, writeJson } from './store.js';

function expand(p) {
  let s = String(p || '').trim().replace(/^["']|["']$/g, '');
  if (s.startsWith('~')) s = path.join(os.homedir(), s.slice(1));
  return path.resolve(s);
}

/** Accepts the SillyTavern folder, its data folder, or data/<user>. */
export function findStUserDir(input) {
  const base = expand(input);
  const candidates = [base, path.join(base, 'data', 'default-user'), path.join(base, 'default-user'), path.join(base, 'public')];
  try {
    const dataDir = path.join(base, 'data');
    for (const u of fs.readdirSync(dataDir)) candidates.push(path.join(dataDir, u));
  } catch { /* not a root */ }
  for (const c of candidates) if (fs.existsSync(path.join(c, 'characters'))) return c;
  throw new HttpError(404, `No SillyTavern data found at ${base}. Pick the SillyTavern folder (the one with server.js) or data/default-user.`);
}

function copyDir(src, dest, filter = () => true) {
  let n = 0;
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name), d = path.join(dest, ent.name);
    if (ent.isDirectory()) n += copyDir(s, d, filter);
    else if (ent.isFile() && filter(ent.name) && !fs.existsSync(d)) { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

export function scanSillyTavern(input) {
  const dir = findStUserDir(input);
  const count = (sub, re) => { try { return fs.readdirSync(path.join(dir, sub)).filter((f) => re.test(f)).length; } catch { return 0; } };
  let chats = 0;
  try { for (const d of fs.readdirSync(path.join(dir, 'chats'))) chats += count(path.join('chats', d), /\.jsonl$/); } catch { /* none */ }
  return {
    dir,
    characters: count('characters', /\.png$/i), chats,
    worlds: count('worlds', /\.json$/), presets: count('OpenAI Settings', /\.json$/),
    personas: count('User Avatars', /\.(png|jpe?g|webp)$/i),
  };
}

export function importSillyTavern(input, parts = {}) {
  const dir = findStUserDir(input);
  const want = (k) => parts[k] !== false;
  const out = { dir, characters: 0, chats: 0, groupChats: 0, worlds: 0, presets: 0, personas: 0, regex: 0, skippedExisting: true };
  if (want('characters')) out.characters = copyDir(path.join(dir, 'characters'), DIRS.characters, (f) => /\.png$/i.test(f));
  if (want('chats')) {
    out.chats = copyDir(path.join(dir, 'chats'), DIRS.chats, (f) => f.endsWith('.jsonl'));
    out.groupChats = copyDir(path.join(dir, 'group chats'), DIRS.groupChats, (f) => f.endsWith('.jsonl'));
    copyDir(path.join(dir, 'groups'), DIRS.groups, (f) => f.endsWith('.json'));
  }
  if (want('worlds')) out.worlds = copyDir(path.join(dir, 'worlds'), DIRS.worlds, (f) => f.endsWith('.json'));
  if (want('presets')) out.presets = copyDir(path.join(dir, 'OpenAI Settings'), DIRS.presets, (f) => f.endsWith('.json'));

  const st = readJson(path.join(dir, 'settings.json'), {});
  if (want('personas')) {
    copyDir(path.join(dir, 'User Avatars'), DIRS.userAvatars);
    const names = st.power_user?.personas || {};
    const descs = st.power_user?.persona_descriptions || {};
    const file = path.join(DATA, 'personas.json');
    const cur = readJson(file, { list: [] });
    for (const [avatar, name] of Object.entries(names)) {
      if (cur.list.some((p) => p.avatar === avatar)) continue;
      cur.list.push({ avatar, name, description: descs[avatar]?.description || '' });
      out.personas++;
    }
    writeJson(file, cur);
  }
  if (want('regex')) {
    // Kept for Phase 2 (regex engine). Stored now so nothing is lost.
    const scripts = st.extension_settings?.regex;
    if (Array.isArray(scripts) && scripts.length) {
      const file = path.join(DATA, 'regex.json');
      const cur = readJson(file, { global: [] });
      const ids = new Set(cur.global.map((s) => s.id));
      for (const s of scripts) if (!ids.has(s.id)) { cur.global.push(s); out.regex++; }
      writeJson(file, cur);
    }
  }
  return out;
}
