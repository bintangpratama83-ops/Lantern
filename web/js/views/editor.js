// Character card editor (side panel on laptop, full sheet on phone).
import { el, autosize, pickFiles } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, charImg } from '../lib/api.js';
import { state, charByFile, emit } from '../lib/state.js';
import { estimateTokens } from '../engine/prompt.js';
import { openPanel, toast, confirmBox } from '../ui/overlays.js';
import { openImage } from '../ui/viewer.js';
import { refreshCharacters } from '../app.js';

/** Convert any image file to a PNG blob (cards must be PNG). */
export async function toPng(file, maxSide = 2048) {
  if (file.type === 'image/png' && file.size < 12 * 1024 * 1024) return file;
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = el('canvas', { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

const FIELDS = [
  { key: 'description', label: 'Description', rows: 8, hint: 'Who the character is. Sent with every message.' },
  { key: 'personality', label: 'Personality summary', rows: 3 },
  { key: 'scenario', label: 'Scenario', rows: 3 },
  { key: 'first_mes', label: 'First message', rows: 6, hint: 'Opens every new chat.' },
  { key: 'mes_example', label: 'Example messages', rows: 6, hint: 'Separate examples with <START>.' },
];
const ADVANCED = [
  { key: 'system_prompt', label: 'Main prompt override', rows: 3, hint: 'Replaces the main prompt for this character. {{original}} inserts the default.' },
  { key: 'post_history_instructions', label: 'Post-history instructions', rows: 3, hint: 'Sent after the chat history. {{original}} inserts the default.' },
  { key: 'creator_notes', label: 'Creator notes', rows: 3, hint: 'Not sent to the AI.' },
];

export async function openEditor(file, { onSaved } = {}) {
  const isNew = !file;
  let card;
  try {
    card = isNew ? { name: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', alternate_greetings: [], tags: [], extensions: {} }
      : structuredClone(state.cardCache.get(file) || await api.character(file));
  } catch (e) { toast(e.message, 'error'); return; }
  const entry = file ? charByFile(file) : null;
  let newImage = null;
  let dirty = false;
  const mark = () => { dirty = true; };

  const pic = el('button', { class: 'editor-pic', type: 'button', 'aria-label': 'View portrait', onclick: () => {
    if (newImage) openImage(URL.createObjectURL(newImage), { alt: card.name });
    else if (file) openImage(charImg(file, entry?.iv), { alt: card.name });
  } });
  const setPic = (src) => { pic.replaceChildren(src ? el('img', { src, alt: '' }) : el('div', { class: 'editor-pic-empty' }, icon('image', 28))); };
  setPic(file ? charImg(file, entry?.iv) : null);
  const changePic = el('button', { class: 'btn small', type: 'button', onclick: async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    try { newImage = await toPng(f); setPic(URL.createObjectURL(newImage)); mark(); } catch { toast('That image could not be read', 'error'); }
  } }, icon('image', 16), file ? 'Change portrait' : 'Add portrait');

  const name = el('input', { class: 'input big', value: card.name, placeholder: 'Character name', 'aria-label': 'Name', oninput: mark });
  const tags = el('input', { class: 'input', value: (card.tags || []).join(', '), placeholder: 'fantasy, romance, …', oninput: mark });

  const area = (f) => {
    const ta = el('textarea', { class: 'input', rows: f.rows, value: card[f.key] || '', spellcheck: 'true' });
    const tok = el('span', { class: 'tok muted' });
    const upd = () => { tok.textContent = `~${estimateTokens(ta.value)} tokens`; };
    ta.addEventListener('input', () => { mark(); upd(); });
    upd();
    autosize(ta, 520);
    return { ta, node: el('label', { class: 'field' }, el('span', { class: 'field-label' }, f.label, tok), ta, f.hint ? el('span', { class: 'hint' }, f.hint) : null) };
  };
  const main = FIELDS.map(area);
  const adv = ADVANCED.map(area);

  // Alternate greetings
  const altList = el('div', { class: 'alt-list' });
  const addAlt = (text = '') => {
    const ta = el('textarea', { class: 'input', rows: 3, value: text, oninput: mark });
    const row = el('div', { class: 'alt-row' }, ta, el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove greeting', onclick: () => { row.remove(); mark(); } }, icon('trash', 18)));
    altList.append(row);
    autosize(ta, 400);
  };
  (card.alternate_greetings || []).forEach(addAlt);

  const creator = el('input', { class: 'input', value: card.creator || '', oninput: mark });
  const version = el('input', { class: 'input', value: card.character_version || '', oninput: mark });
  const book = card.character_book?.entries?.length || 0;
  const regex = card.extensions?.regex_scripts?.length || 0;

  const body = el('div', { class: 'editor' },
    el('div', { class: 'editor-top' }, pic, el('div', { class: 'editor-id' }, name, el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Tags'), tags), changePic)),
    main.map((m) => m.node),
    el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Alternate greetings'), el('span', { class: 'hint' }, 'Swipe the first message to pick one.'), altList,
      el('button', { class: 'btn small', type: 'button', onclick: () => { addAlt(); mark(); } }, icon('plus', 16), 'Add greeting')),
    el('details', { class: 'more-fields' }, el('summary', {}, 'More fields'),
      adv.map((m) => m.node),
      el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Creator'), creator), el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Version'), version)),
      (book || regex) ? el('p', { class: 'hint' }, `Embedded: ${book ? `lorebook with ${book} entries` : ''}${book && regex ? ', ' : ''}${regex ? `${regex} regex scripts` : ''}. Kept on save; used once lorebooks and regex arrive in Phase 2.`) : null),
  );

  const saveBtn = el('button', { class: 'btn primary', onclick: save }, icon('check', 18), isNew ? 'Create character' : 'Save changes');
  const footer = el('div', { class: 'row end' }, el('button', { class: 'btn ghost', onclick: () => panel.close() }, 'Cancel'), saveBtn);
  const panel = openPanel({ title: isNew ? 'New character' : `Edit ${card.name}`, body, footer, wide: true });
  if (isNew) setTimeout(() => name.focus(), 250);

  async function save() {
    if (!name.value.trim()) { toast('Give the character a name first', 'error'); name.focus(); return; }
    const out = { ...card, name: name.value.trim(), tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean),
      creator: creator.value, character_version: version.value,
      alternate_greetings: [...altList.querySelectorAll('textarea')].map((t) => t.value).filter((t) => t.trim()) };
    FIELDS.forEach((f, i) => { out[f.key] = main[i].ta.value; });
    ADVANCED.forEach((f, i) => { out[f.key] = adv[i].ta.value; });
    saveBtn.disabled = true;
    try {
      let target = file;
      if (isNew) target = (await api.createCharacter(out)).file;
      else await api.saveCharacter(file, out);
      if (newImage) await api.setCharacterImage(target, newImage);
      state.cardCache.set(target, out);
      await refreshCharacters();
      emit('card', { file: target, card: out });
      toast(isNew ? `Created ${out.name}` : 'Saved');
      dirty = false;
      panel.close();
      onSaved?.(target, out);
      if (isNew) location.hash = `#/chat/${encodeURIComponent(target)}`;
    } catch (e) { toast(e.message, 'error'); saveBtn.disabled = false; }
  }
  void dirty; void confirmBox;
}
