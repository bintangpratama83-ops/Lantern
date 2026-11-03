// App settings, connection profiles (keys kept server-side) and personas.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, DIRS, HttpError, safeName, slug, uniqueFile, readJson, writeJson, writeFileAtomic, moveToTrash } from './store.js';
import { isPng } from './png.js';
import { removeThumbs } from './characters.js';

const SETTINGS = () => path.join(DATA, 'lantern-settings.json');
const SECRETS = () => path.join(DATA, 'secrets.json');
const PERSONAS = () => path.join(DATA, 'personas.json');

export const PROVIDERS = {
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  nanogpt: { label: 'NanoGPT', baseUrl: 'https://api.nano-gpt.com/api/v1', needsKey: true },
  custom: { label: 'Custom (OpenAI-compatible)', baseUrl: '', needsKey: false },
  koboldcpp: { label: 'KoboldCpp', baseUrl: 'http://127.0.0.1:5001/v1', needsKey: false },
  llamacpp: { label: 'llama.cpp server', baseUrl: 'http://127.0.0.1:9931/v1', needsKey: false },
};

export const DEFAULT_SETTINGS = {
  version: 1,
  ui: { theme: 'night', accent: '#f0b44c', fontSize: 16, chatWidth: 760, proseFont: 'serif', showAvatars: true, sendOnEnter: 'desktop', reasoningOpen: false },
  gen: {
    stream: true, temperature: 1, top_p: 1, max_tokens: 800, context: 32000,
    frequency_penalty: 0, presence_penalty: 0, reasoning_effort: '',
  },
  prompts: {
    main: "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.",
    post: '',
    impersonate: "[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don't write as or describe actions of {{char}}.]",
    continue: '[Continue your last message without repeating its original content.]',
  },
  activeProfile: null,
  activePersona: null,
  profiles: [],
};

function merge(def, val) {
  if (Array.isArray(def)) return Array.isArray(val) ? val : def;
  if (def && typeof def === 'object') {
    const out = { ...def };
    for (const k of Object.keys(val || {})) out[k] = k in def ? merge(def[k], val[k]) : val[k];
    return out;
  }
  return val === undefined ? def : val;
}

export function getSettings() {
  const s = merge(DEFAULT_SETTINGS, readJson(SETTINGS(), {}));
  const secrets = readJson(SECRETS(), {});
  s.profiles = s.profiles.map((p) => ({ ...p, hasKey: !!secrets[p.id] }));
  return s;
}

export function saveSettings(patch) {
  const cur = merge(DEFAULT_SETTINGS, readJson(SETTINGS(), {}));
  const next = merge(cur, patch || {});
  next.profiles = cur.profiles; // profiles only change through their own endpoints
  writeJson(SETTINGS(), next);
  return getSettings();
}

export function saveProfile(input) {
  const s = merge(DEFAULT_SETTINGS, readJson(SETTINGS(), {}));
  const type = PROVIDERS[input.type] ? input.type : 'custom';
  const baseUrl = String(input.baseUrl || PROVIDERS[type].baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) throw new HttpError(400, 'API URL must start with http:// or https://');
  const prof = {
    id: input.id || crypto.randomUUID(),
    name: String(input.name || PROVIDERS[type].label).slice(0, 80),
    type, baseUrl, model: String(input.model || '').trim(),
    headers: input.headers && typeof input.headers === 'object' ? input.headers : {},
  };
  const i = s.profiles.findIndex((p) => p.id === prof.id);
  if (i >= 0) s.profiles[i] = prof; else s.profiles.push(prof);
  if (!s.activeProfile) s.activeProfile = prof.id;
  writeJson(SETTINGS(), s);
  if (typeof input.key === 'string') {
    const sec = readJson(SECRETS(), {});
    if (input.key.trim()) sec[prof.id] = input.key.trim(); else delete sec[prof.id];
    writeJson(SECRETS(), sec);
  }
  return getSettings();
}

export function deleteProfile(id) {
  const s = merge(DEFAULT_SETTINGS, readJson(SETTINGS(), {}));
  s.profiles = s.profiles.filter((p) => p.id !== id);
  if (s.activeProfile === id) s.activeProfile = s.profiles[0]?.id || null;
  writeJson(SETTINGS(), s);
  const sec = readJson(SECRETS(), {});
  delete sec[id];
  writeJson(SECRETS(), sec);
  return getSettings();
}

/** Profile + key, server-side only. */
export function resolveProfile(id) {
  const s = merge(DEFAULT_SETTINGS, readJson(SETTINGS(), {}));
  const p = s.profiles.find((x) => x.id === (id || s.activeProfile));
  if (!p) throw new HttpError(400, 'No connection selected. Add one in Connections.');
  return { ...p, key: readJson(SECRETS(), {})[p.id] || '' };
}

// ---- personas ----
// Stored as { list: [{ avatar, name, description }] }; avatars live in "User Avatars".
export function listPersonas() {
  const d = readJson(PERSONAS(), { list: [] });
  return d.list.map((p) => {
    let iv = '0';
    try { iv = Math.round(fs.statSync(path.join(DIRS.userAvatars, p.avatar)).mtimeMs).toString(36); } catch { /* no image */ }
    return { ...p, iv };
  });
}

export function savePersona(input) {
  const d = readJson(PERSONAS(), { list: [] });
  const name = String(input.name || '').trim();
  if (!name) throw new HttpError(400, 'Persona name is required');
  let avatar = input.avatar;
  if (avatar) safeName(avatar);
  else avatar = uniqueFile(DIRS.userAvatars, slug(name), '.png');
  const p = { avatar, name, description: String(input.description || '') };
  const i = d.list.findIndex((x) => x.avatar === avatar);
  if (i >= 0) d.list[i] = { ...d.list[i], ...p }; else d.list.push(p);
  writeJson(PERSONAS(), d);
  return p;
}

export function setPersonaImage(avatar, png) {
  safeName(avatar);
  if (!isPng(png)) throw new HttpError(415, 'Image must be a PNG');
  writeFileAtomic(path.join(DIRS.userAvatars, avatar), png);
  removeThumbs(avatar, 'persona');
}

export function deletePersona(avatar) {
  safeName(avatar);
  const d = readJson(PERSONAS(), { list: [] });
  d.list = d.list.filter((p) => p.avatar !== avatar);
  writeJson(PERSONAS(), d);
  moveToTrash(path.join(DIRS.userAvatars, avatar));
}

export function personaImagePath(avatar) {
  safeName(avatar);
  const p = path.join(DIRS.userAvatars, avatar);
  if (!fs.existsSync(p)) throw new HttpError(404, 'No image');
  return p;
}
