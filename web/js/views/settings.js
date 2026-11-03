// Appearance, behaviour, SillyTavern import, and about.
import { el, clear } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { toast } from '../ui/overlays.js';
import { saveSettings, refreshCharacters } from '../app.js';

export async function mount(main, [section]) {
  const ui = () => state.settings.ui;
  const setUi = (patch) => saveSettings({ ui: patch }).catch((e) => toast(e.message, 'error'));

  const seg = (key, options) => {
    const wrap = el('div', { class: 'seg', role: 'radiogroup' });
    const draw = () => {
      clear(wrap);
      for (const [v, label] of options) wrap.append(el('button', { class: `seg-btn${ui()[key] === v ? ' on' : ''}`, role: 'radio', 'aria-checked': String(ui()[key] === v), onclick: async () => { await setUi({ [key]: v }); draw(); } }, label));
    };
    draw();
    return wrap;
  };
  const range = (key, min, max, step, unit) => {
    const out = el('span', { class: 'muted' }, `${ui()[key]}${unit}`);
    const r = el('input', { type: 'range', min, max, step, value: ui()[key] });
    r.addEventListener('input', () => { out.textContent = `${r.value}${unit}`; document.documentElement.style.setProperty(key === 'fontSize' ? '--fs' : '--chat-w', `${r.value}px`); });
    r.addEventListener('change', () => setUi({ [key]: Number(r.value) }));
    return [r, out];
  };
  const accents = ['#f0b44c', '#e8846b', '#d77fa1', '#9f8cf0', '#5fb3d9', '#6cc49a'];
  const accentRow = el('div', { class: 'swatches' }, accents.map((c) => el('button', { class: `swatch${ui().accent === c ? ' on' : ''}`, style: { background: c }, 'aria-label': `Accent ${c}`, onclick: async (e) => {
    await setUi({ accent: c });
    for (const b of accentRow.children) b.classList.toggle('on', b === e.currentTarget);
  } })));
  const [fsR, fsO] = range('fontSize', 13, 22, 1, 'px');
  const [cwR, cwO] = range('chatWidth', 560, 1200, 20, 'px');
  const reason = el('input', { type: 'checkbox', checked: !!ui().reasoningOpen, onchange: () => setUi({ reasoningOpen: reason.checked }) });

  // ---- SillyTavern import ----
  const stPath = el('input', { class: 'input', placeholder: 'e.g. C:\\SillyTavern  or  ~/SillyTavern', value: localStorage.getItem('lantern.stPath') || '' });
  const scanOut = el('div', { class: 'import-out' });
  const parts = { characters: true, chats: true, personas: true, worlds: true, presets: true, regex: true };
  const partBoxes = el('div', { class: 'checks' }, Object.keys(parts).map((k) => el('label', { class: 'check' },
    el('input', { type: 'checkbox', checked: true, onchange: (e) => { parts[k] = e.target.checked; } }), ` ${k[0].toUpperCase()}${k.slice(1)}`)));
  const scanBtn = el('button', { class: 'btn', onclick: scan }, icon('search', 18), 'Check folder');
  const importBtn = el('button', { class: 'btn primary', disabled: true, onclick: doImport }, icon('download', 18), 'Import');
  async function scan() {
    localStorage.setItem('lantern.stPath', stPath.value);
    scanOut.textContent = 'Looking…';
    try {
      const r = await api.scanST(stPath.value);
      scanOut.replaceChildren(el('p', {}, `Found: ${r.characters} characters, ${r.chats} chats, ${r.personas} persona images, ${r.worlds} lorebooks, ${r.presets} presets.`), el('p', { class: 'muted small' }, r.dir));
      importBtn.disabled = false;
    } catch (e) { scanOut.replaceChildren(el('p', { class: 'error-text' }, e.message)); importBtn.disabled = true; }
  }
  async function doImport() {
    importBtn.disabled = true;
    scanOut.textContent = 'Copying files… (your SillyTavern folder is not changed)';
    try {
      const r = await api.importST(stPath.value, parts);
      await refreshCharacters();
      state.personas = await api.personas();
      scanOut.replaceChildren(el('p', {}, `Imported ${r.characters} characters, ${r.chats} chats${r.groupChats ? ` (+${r.groupChats} group chats)` : ''}, ${r.personas} personas, ${r.worlds} lorebooks, ${r.presets} presets, ${r.regex} regex scripts.`),
        el('p', { class: 'muted small' }, 'Files that already existed in Lantern were skipped. Lorebooks, presets and regex are stored now and switch on in Phase 2.'),
        el('a', { class: 'btn primary', href: '#/chars' }, 'Go to characters'));
      toast('Import finished');
    } catch (e) { scanOut.replaceChildren(el('p', { class: 'error-text' }, e.message)); } finally { importBtn.disabled = false; }
  }

  const importSec = el('section', { class: 'section', id: 'import' },
    el('h2', {}, 'Import from SillyTavern'),
    el('p', { class: 'muted' }, 'Point to your SillyTavern folder (the one with server.js) or its data/default-user folder. Lantern copies the files; nothing in SillyTavern changes.'),
    el('div', { class: 'row' }, stPath, scanBtn), partBoxes, el('div', { class: 'row' }, importBtn), scanOut);

  main.append(
    el('header', { class: 'page-head' }, el('div', { class: 'page-title' }, el('h1', {}, 'Settings'))),
    el('section', { class: 'section' }, el('h2', {}, 'Appearance'),
      el('div', { class: 'settings-grid' },
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Theme'), seg('theme', [['night', 'Night'], ['day', 'Day']])),
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Accent'), accentRow),
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Story text font'), seg('proseFont', [['serif', 'Book serif'], ['sans', 'Sans']])),
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Text size ', fsO), fsR),
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Chat width (laptop) ', cwO), cwR))),
    el('section', { class: 'section' }, el('h2', {}, 'Chat behaviour'),
      el('div', { class: 'settings-grid' },
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Enter key sends'), seg('sendOnEnter', [['desktop', 'On laptop only'], ['always', 'Always'], ['never', 'Never (Ctrl+Enter)']])),
        el('label', { class: 'check' }, reason, ' Show AI reasoning expanded'))),
    importSec,
    el('section', { class: 'section' }, el('h2', {}, 'About'),
      el('p', {}, `Lantern ${state.version}. Data folder: `, el('code', {}, state.dataDir || '')),
      el('p', { class: 'muted' }, 'Lantern reads and writes SillyTavern file formats, so cards and chats move freely between the two.')));

  if (section === 'import') requestAnimationFrame(() => { importSec.scrollIntoView({ block: 'start' }); stPath.focus({ preventScroll: true }); });
}
