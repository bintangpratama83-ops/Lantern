// Lantern app shell: boot, theme, navigation, hash router.
import { el, $, clear, isPhone } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { api } from './lib/api.js';
import { state, emit, on } from './lib/state.js';
import { toast, closeAllOverlays } from './ui/overlays.js';

const NAV = [
  { id: 'chars', label: 'Characters', icon: 'cards', href: '#/chars' },
  { id: 'chat', label: 'Chat', icon: 'chat', href: '#/chat' },
  { id: 'personas', label: 'Personas', icon: 'persona', href: '#/personas' },
  { id: 'connections', label: 'Connections', icon: 'plug', href: '#/connections' },
  { id: 'settings', label: 'Settings', icon: 'settings', href: '#/settings' },
];

const views = {
  chars: () => import('./views/characters.js'),
  chat: () => import('./views/chat.js'),
  personas: () => import('./views/personas.js'),
  connections: () => import('./views/connections.js'),
  settings: () => import('./views/settings.js'),
};

let cleanup = null;
let navEls = [];

export function applyTheme() {
  const ui = state.settings.ui;
  const r = document.documentElement;
  r.dataset.theme = ui.theme === 'day' ? 'day' : 'night';
  r.style.setProperty('--accent', ui.accent || '#f0b44c');
  r.style.setProperty('--fs', `${ui.fontSize || 16}px`);
  r.style.setProperty('--chat-w', `${ui.chatWidth || 760}px`);
  r.dataset.prose = ui.proseFont || 'serif';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', ui.theme === 'day' ? '#e9e6f0' : '#1a1730');
}

function buildShell() {
  const app = $('#app');
  clear(app);
  navEls = NAV.map((n) => el('a', { class: 'nav-item', href: n.href, dataset: { id: n.id }, 'aria-label': n.label }, icon(n.icon, 22), el('span', {}, n.label)));
  const rail = el('nav', { class: 'rail', 'aria-label': 'Main' },
    el('div', { class: 'brand', title: `Lantern ${state.version}` }, icon('lantern', 26)),
    navEls);
  const tabs = el('nav', { class: 'tabbar', 'aria-label': 'Main' }, NAV.map((n) => el('a', { class: 'nav-item', href: n.href, dataset: { id: n.id }, 'aria-label': n.label }, icon(n.icon, 22), el('span', {}, n.label))));
  navEls.push(...tabs.querySelectorAll('.nav-item'));
  app.append(rail, el('main', { id: 'main', tabindex: '-1' }), tabs);
}

function setActive(id) {
  for (const a of navEls) a.classList.toggle('active', a.dataset.id === id);
  document.body.dataset.view = id;
}

async function route() {
  closeAllOverlays();
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  let id = parts[0] || 'chars';
  if (!views[id]) id = 'chars';
  let params = parts.slice(1);
  if (id === 'chat' && !params[0]) {
    const last = localStorage.getItem('lantern.lastChat');
    if (last) { location.replace(`#/chat/${last}`); return; }
    toast('Pick a character to start chatting.');
    location.replace('#/chars');
    return;
  }
  setActive(id);
  const main = $('#main');
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  clear(main);
  main.className = `view-${id}`;
  try {
    const mod = await views[id]();
    cleanup = await mod.mount(main, params) || null;
  } catch (e) {
    console.error(e);
    main.append(el('div', { class: 'empty' }, el('h2', {}, 'This page failed to load'), el('p', {}, e.message)));
  }
}

async function boot() {
  try {
    const d = await api.bootstrap();
    Object.assign(state, { version: d.version, settings: d.settings, providers: d.providers, characters: d.characters, personas: d.personas, dataDir: d.dataDir });
  } catch (e) {
    $('#app').innerHTML = '';
    $('#app').append(el('div', { class: 'empty boot-error' }, el('h2', {}, 'Lantern server is not responding'), el('p', {}, 'Start it with "node server/server.js" and reload this page.'), el('p', { class: 'muted' }, e.message)));
    return;
  }
  applyTheme();
  buildShell();
  on('settings', () => applyTheme());
  window.addEventListener('hashchange', route);
  await route();
  // Prefetch the chat view in the background so opening a character is instant.
  setTimeout(() => views.chat(), 1200);
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

export async function saveSettings(patch) {
  state.settings = await api.saveSettings(patch);
  emit('settings', state.settings);
  return state.settings;
}

export async function refreshCharacters() {
  state.characters = await api.characters();
  emit('characters', state.characters);
}

window.addEventListener('resize', () => document.body.classList.toggle('phone', isPhone()));
document.body.classList.toggle('phone', isPhone());
boot();
