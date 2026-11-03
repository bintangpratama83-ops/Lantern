// Character browser: instant search, tag filters, favourites, lazy thumbnails.
import { el, clear, debounce, relTime, onLongPress, download, pickFiles } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, charImg } from '../lib/api.js';
import { state, on } from '../lib/state.js';
import { avatarImg } from '../lib/thumbs.js';
import { menu, toast, confirmBox, dialog } from '../ui/overlays.js';
import { refreshCharacters } from '../app.js';

const pref = (k, d) => { try { return localStorage.getItem(`lantern.chars.${k}`) ?? d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(`lantern.chars.${k}`, v); } catch { /* private mode */ } };

export async function mount(main) {
  let query = '';
  let tag = pref('tag', '');
  let sort = pref('sort', 'recent');
  let favOnly = pref('fav', '0') === '1';
  const tiles = new Map(); // file -> { node, iv, sig }

  const search = el('input', { class: 'input search', type: 'search', placeholder: 'Search characters, tags, creators', 'aria-label': 'Search characters', value: '' });
  const count = el('span', { class: 'count muted' });
  const sortBtn = el('button', { class: 'btn ghost', onclick: () => menu(sortBtn, [
    { label: 'Recently chatted', checked: sort === 'recent', onclick: () => setSort('recent') },
    { label: 'Name A–Z', checked: sort === 'name', onclick: () => setSort('name') },
    { label: 'Most chats', checked: sort === 'chats', onclick: () => setSort('chats') },
  ], { title: 'Sort by' }) }, icon('sort', 18), el('span', { class: 'hide-sm' }, 'Sort'));
  const importBtn = el('button', { class: 'btn ghost', onclick: importCards }, icon('upload', 18), el('span', { class: 'hide-sm' }, 'Import'));
  const newBtn = el('button', { class: 'btn primary', onclick: () => openEditorLazy(null) }, icon('plus', 18), el('span', { class: 'hide-sm' }, 'New'));
  const chips = el('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Filter by tag' });
  const grid = el('div', { class: 'char-grid', role: 'list' });
  const empty = el('div', { class: 'empty', hidden: true });

  const header = el('header', { class: 'page-head' },
    el('div', { class: 'page-title' }, el('h1', {}, 'Characters'), count),
    el('div', { class: 'toolbar' }, el('label', { class: 'search-wrap' }, icon('search', 18), search), sortBtn, importBtn, newBtn));
  main.append(header, chips, grid, empty);

  search.addEventListener('input', debounce(() => { query = search.value.trim().toLowerCase(); render(); }, 80));

  function setSort(s) { sort = s; setPref('sort', s); render(); }

  function buildChips() {
    clear(chips);
    const freq = new Map();
    for (const c of state.characters) for (const t of c.tags || []) freq.set(t, (freq.get(t) || 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([t]) => t);
    if (tag && !top.includes(tag)) top.unshift(tag);
    const chip = (label, active, onclick, ic) => el('button', { class: `chip${active ? ' on' : ''}`, 'aria-pressed': String(active), onclick }, ic ? icon(ic, 14) : null, label);
    chips.append(
      chip('Favorites', favOnly, () => { favOnly = !favOnly; setPref('fav', favOnly ? '1' : '0'); buildChips(); render(); }, 'star'),
      ...top.map((t) => chip(t, tag === t, () => { tag = tag === t ? '' : t; setPref('tag', tag); buildChips(); render(); })),
    );
  }

  function tileFor(c) {
    const sig = `${c.iv}|${c.name}|${c.fav}|${c.chats}|${c.last}`;
    const hit = tiles.get(c.file);
    if (hit && hit.sig === sig) return hit.node;
    const star = el('button', { class: `star${c.fav ? ' on' : ''}`, 'aria-label': c.fav ? 'Remove from favorites' : 'Add to favorites', title: 'Favorite', onclick: (e) => { e.stopPropagation(); toggleFav(c); } }, icon('star', 16));
    const more = el('button', { class: 'tile-more', 'aria-label': `More for ${c.name}`, onclick: (e) => { e.stopPropagation(); charMenu(c, more); } }, icon('more', 18));
    const node = el('div', { class: 'tile', role: 'listitem' },
      el('a', { class: 'tile-link', href: `#/chat/${encodeURIComponent(c.file)}`, 'aria-label': `Chat with ${c.name}` },
        el('div', { class: 'tile-img' }, avatarImg('avatar', c.file, c.iv, { alt: '', name: c.name, cls: 'tile-pic' })),
        el('div', { class: 'tile-meta' },
          el('div', { class: 'tile-name' }, c.name),
          el('div', { class: 'tile-sub' }, c.error ? 'Card could not be read' : c.chats ? `${c.chats} chat${c.chats > 1 ? 's' : ''} · ${relTime(c.last)}` : (c.creator ? `by ${c.creator}` : 'No chats yet')))),
      star, more);
    onLongPress(node, (e) => charMenu(c, node));
    node.querySelector('.tile-link').addEventListener('click', (e) => { if (node.dataset.longpressed) e.preventDefault(); });
    tiles.set(c.file, { node, sig });
    return node;
  }

  function render() {
    const list = state.characters.filter((c) => {
      if (favOnly && !c.fav) return false;
      if (tag && !(c.tags || []).includes(tag)) return false;
      if (!query) return true;
      return c.name.toLowerCase().includes(query) || (c.creator || '').toLowerCase().includes(query) || (c.tags || []).some((t) => t.toLowerCase().includes(query)) || (c.note || '').toLowerCase().includes(query);
    });
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (sort === 'name') list.sort(byName);
    else if (sort === 'chats') list.sort((a, b) => (b.chats - a.chats) || byName(a, b));
    else list.sort((a, b) => (b.last || 0) - (a.last || 0) || byName(a, b));
    list.sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0)); // stable: favourites first
    count.textContent = `${list.length}${list.length !== state.characters.length ? ` of ${state.characters.length}` : ''}`;

    grid.replaceChildren(...list.map(tileFor));
    empty.hidden = list.length > 0;
    if (!list.length) {
      clear(empty);
      if (!state.characters.length) {
        empty.append(
          el('div', { class: 'empty-mark' }, icon('lantern', 44)),
          el('h2', {}, 'No characters yet'),
          el('p', {}, 'Bring your SillyTavern library over in one step, or add character cards (PNG or JSON).'),
          el('div', { class: 'row center' },
            el('a', { class: 'btn primary', href: '#/settings/import' }, icon('folder', 18), 'Import from SillyTavern'),
            el('button', { class: 'btn', onclick: importCards }, icon('upload', 18), 'Add card files'),
            el('button', { class: 'btn', onclick: () => openEditorLazy(null) }, icon('plus', 18), 'Create one')));
      } else {
        empty.append(el('h2', {}, 'Nothing matches'), el('p', {}, 'Try a different search or clear the filters.'),
          el('button', { class: 'btn', onclick: () => { query = ''; search.value = ''; tag = ''; favOnly = false; setPref('tag', ''); setPref('fav', '0'); buildChips(); render(); } }, 'Clear filters'));
      }
    }
  }

  async function toggleFav(c) {
    try {
      await api.favorite(c.file, !c.fav);
      c.fav = !c.fav;
      render();
    } catch (e) { toast(e.message, 'error'); }
  }

  function charMenu(c, anchor) {
    menu(anchor, [
      { label: 'Open chat', icon: 'chat', onclick: () => { location.hash = `#/chat/${encodeURIComponent(c.file)}`; } },
      { label: 'Edit card', icon: 'edit', onclick: () => openEditorLazy(c.file) },
      { label: c.fav ? 'Remove from favorites' : 'Add to favorites', icon: 'star', onclick: () => toggleFav(c) },
      { label: 'Duplicate', icon: 'copy', onclick: async () => { try { await api.duplicate(c.file); await refreshCharacters(); toast(`Duplicated ${c.name}`); } catch (e) { toast(e.message, 'error'); } } },
      'sep',
      { label: 'Download PNG card', icon: 'download', onclick: () => download(charImg(c.file, c.iv), c.file) },
      { label: 'Download JSON', icon: 'download', onclick: () => download(`/api/characters/${encodeURIComponent(c.file)}/export.json`) },
      'sep',
      { label: 'Delete…', icon: 'trash', danger: true, onclick: () => deleteChar(c) },
    ], { title: c.name });
  }

  async function deleteChar(c) {
    const box = el('input', { type: 'checkbox', id: 'delchats' });
    const ok = await dialog({
      title: `Delete ${c.name}?`,
      message: 'The card moves to the trash folder inside your data folder.',
      content: el('label', { class: 'check' }, box, ' Also move this character’s chats to the trash'),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, danger: true }],
    });
    if (!ok) return;
    try { await api.deleteCharacter(c.file, box.checked); tiles.delete(c.file); await refreshCharacters(); toast(`Deleted ${c.name}`); } catch (e) { toast(e.message, 'error'); }
  }

  async function importCards() {
    const files = await pickFiles({ accept: '.png,.json,image/png,application/json', multiple: true });
    if (!files.length) return;
    let ok = 0;
    for (const f of files) {
      try { await api.importCharacter(f.name, f); ok++; } catch (e) { toast(`${f.name}: ${e.message}`, 'error'); }
    }
    await refreshCharacters();
    if (ok) toast(`Imported ${ok} character${ok > 1 ? 's' : ''}`);
  }

  const off = on('characters', () => { buildChips(); render(); });
  buildChips();
  render();
  // Refresh in the background (picks up files added outside Lantern).
  refreshCharacters().catch(() => {});
  if (!matchMedia('(pointer: coarse)').matches) search.focus({ preventScroll: true });
  return () => off();
}

async function openEditorLazy(file) {
  const { openEditor } = await import('./editor.js');
  openEditor(file);
}
