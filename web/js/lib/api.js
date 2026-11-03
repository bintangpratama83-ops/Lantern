// Fetch wrappers. Errors throw with the server's message.
async function req(method, url, body, { raw = false, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer || typeof body === 'string') opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  const r = await fetch(url, opts);
  if (raw) return r;
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(data?.error || `${r.status} ${r.statusText}`);
  return data;
}

const enc = encodeURIComponent;
export const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b ?? {}),
  put: (u, b) => req('PUT', u, b ?? {}),
  del: (u) => req('DELETE', u),
  raw: req,

  bootstrap: () => req('GET', '/api/bootstrap'),
  characters: () => req('GET', '/api/characters'),
  character: (f) => req('GET', `/api/characters/${enc(f)}`),
  saveCharacter: (f, card) => req('PUT', `/api/characters/${enc(f)}`, { card }),
  createCharacter: (card) => req('POST', '/api/characters', { card }),
  setCharacterImage: (f, blob) => req('PUT', `/api/characters/${enc(f)}/image`, blob),
  favorite: (f, fav) => req('POST', `/api/characters/${enc(f)}/fav`, { fav }),
  duplicate: (f) => req('POST', `/api/characters/${enc(f)}/duplicate`),
  deleteCharacter: (f, chats) => req('DELETE', `/api/characters/${enc(f)}${chats ? '?chats=1' : ''}`),
  importCharacter: (name, blob) => req('POST', `/api/characters/import?name=${enc(name)}`, blob),

  chats: (c) => req('GET', `/api/chats/${enc(c)}`),
  chat: (c, f, end, limit = 50) => req('GET', `/api/chats/${enc(c)}/${enc(f)}?limit=${limit}${end != null ? `&end=${end}` : ''}`),
  newChat: (c, body) => req('POST', `/api/chats/${enc(c)}`, body),
  chatOps: (c, f, ops) => req('POST', `/api/chats/${enc(c)}/${enc(f)}/ops`, { ops }),
  branch: (c, f, upTo) => req('POST', `/api/chats/${enc(c)}/${enc(f)}/branch`, { upTo }),
  renameChat: (c, f, name) => req('POST', `/api/chats/${enc(c)}/${enc(f)}/rename`, { name }),
  deleteChat: (c, f) => req('DELETE', `/api/chats/${enc(c)}/${enc(f)}`),
  importChat: (c, name, text) => req('POST', `/api/chats/${enc(c)}/import?name=${enc(name)}`, text),
  chatDownloadUrl: (c, f) => `/api/chats/${enc(c)}/${enc(f)}/download`,

  settings: () => req('GET', '/api/settings'),
  saveSettings: (patch) => req('PUT', '/api/settings', patch),
  saveProfile: (p) => req('POST', '/api/profiles', p),
  deleteProfile: (id) => req('DELETE', `/api/profiles/${enc(id)}`),
  models: (id) => req('GET', `/api/models?profile=${enc(id)}`),

  personas: () => req('GET', '/api/personas'),
  savePersona: (p) => req('POST', '/api/personas', p),
  setPersonaImage: (a, blob) => req('PUT', `/api/personas/${enc(a)}/image`, blob),
  deletePersona: (a) => req('DELETE', `/api/personas/${enc(a)}`),

  scanST: (path) => req('POST', '/api/import/st/scan', { path }),
  importST: (path, parts) => req('POST', '/api/import/st', { path, parts }),
};

export const charImg = (file, iv) => `/img/char/${enc(file)}?v=${enc(iv || '0')}`;
export const personaImg = (avatar, iv) => `/img/persona/${enc(avatar)}?v=${enc(iv || '0')}`;
export const thumbUrl = (kind, file, iv) => `/img/thumb/${kind}/${enc(file)}?v=${enc(iv || '0')}`;
