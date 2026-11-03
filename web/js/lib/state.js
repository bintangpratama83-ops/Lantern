// Shared app state + a minimal event bus.
const listeners = new Map();

export const state = {
  version: '',
  settings: null,
  providers: {},
  characters: [], // light index entries: { file, name, tags, fav, creator, note, iv, chats, last }
  personas: [],
  cardCache: new Map(), // file -> full card data
};

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  for (const fn of listeners.get(evt) || []) { try { fn(data); } catch (e) { console.error(e); } }
}

export function charByFile(file) { return state.characters.find((c) => c.file === file); }
export function activePersona() {
  const s = state.settings;
  return state.personas.find((p) => p.avatar === s?.activePersona) || null;
}
export function userName() { return activePersona()?.name || 'User'; }
export function activeProfile() {
  const s = state.settings;
  return s?.profiles.find((p) => p.id === s.activeProfile) || null;
}
