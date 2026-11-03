// Personas: who you are in the chat ({{user}}), with optional portrait and description.
import { el, clear, autosize, pickFiles } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, personaImg } from '../lib/api.js';
import { state } from '../lib/state.js';
import { avatarImg } from '../lib/thumbs.js';
import { openPanel, toast, confirmBox } from '../ui/overlays.js';
import { openImage } from '../ui/viewer.js';
import { saveSettings } from '../app.js';
import { toPng } from './editor.js';

export async function mount(main) {
  const list = el('div', { class: 'persona-list' });
  main.append(
    el('header', { class: 'page-head' },
      el('div', { class: 'page-title' }, el('h1', {}, 'Personas')),
      el('div', { class: 'toolbar' }, el('button', { class: 'btn primary', onclick: () => edit(null) }, icon('plus', 18), 'New persona'))),
    el('p', { class: 'page-intro muted' }, 'A persona is you in the story. Its name fills {{user}} and its description is sent to the AI.'),
    list);

  async function reload() {
    state.personas = await api.personas();
    render();
  }

  function render() {
    clear(list);
    if (!state.personas.length) {
      list.append(el('div', { class: 'empty' }, el('h2', {}, 'No personas yet'), el('p', {}, 'Without one you appear as "User".'),
        el('button', { class: 'btn primary', onclick: () => edit(null) }, icon('plus', 18), 'Create your persona')));
      return;
    }
    for (const p of state.personas) {
      const active = p.avatar === state.settings.activePersona;
      const pic = avatarImg('persona', p.avatar, p.iv, { name: p.name, cls: 'avatar lg' });
      pic.addEventListener('click', (e) => { e.stopPropagation(); openImage(personaImg(p.avatar, p.iv), { alt: p.name }); });
      list.append(el('div', { class: `persona-card${active ? ' active' : ''}` },
        pic,
        el('div', { class: 'persona-main' },
          el('div', { class: 'persona-name' }, p.name, active ? el('span', { class: 'badge' }, 'In use') : null),
          el('div', { class: 'persona-desc muted' }, p.description ? p.description.slice(0, 220) : 'No description')),
        el('div', { class: 'persona-actions' },
          active ? null : el('button', { class: 'btn small', onclick: async () => { await saveSettings({ activePersona: p.avatar }); render(); } }, 'Use'),
          el('button', { class: 'icon-btn', 'aria-label': `Edit ${p.name}`, onclick: () => edit(p) }, icon('edit', 18)))));
    }
  }

  function edit(p) {
    let img = null;
    const name = el('input', { class: 'input big', value: p?.name || '', placeholder: 'Your name in the story' });
    const desc = el('textarea', { class: 'input', rows: 6, value: p?.description || '', placeholder: 'Appearance, personality, anything the AI should know about you.' });
    const pic = el('div', { class: 'editor-pic' });
    const setPic = (src) => pic.replaceChildren(src ? el('img', { src, alt: '' }) : el('div', { class: 'editor-pic-empty' }, icon('persona', 28)));
    setPic(p && p.iv !== '0' ? personaImg(p.avatar, p.iv) : null);
    const body = el('div', { class: 'editor' },
      el('div', { class: 'editor-top' }, pic, el('div', { class: 'editor-id' }, name,
        el('button', { class: 'btn small', onclick: async () => {
          const [f] = await pickFiles({ accept: 'image/*' });
          if (!f) return;
          try { img = await toPng(f, 1024); setPic(URL.createObjectURL(img)); } catch { toast('That image could not be read', 'error'); }
        } }, icon('image', 16), 'Choose portrait'))),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Description'), desc));
    autosize(desc, 420);
    const panel = openPanel({
      title: p ? `Edit ${p.name}` : 'New persona', body,
      footer: el('div', { class: 'row between' },
        p ? el('button', { class: 'btn ghost danger', onclick: async () => {
          if (!(await confirmBox(`Delete persona ${p.name}?`, { ok: 'Delete', danger: true }))) return;
          await api.deletePersona(p.avatar);
          if (state.settings.activePersona === p.avatar) await saveSettings({ activePersona: null });
          panel.close(); reload();
        } }, icon('trash', 18), 'Delete') : el('span'),
        el('button', { class: 'btn primary', onclick: async () => {
          if (!name.value.trim()) { toast('Enter a name', 'error'); return; }
          try {
            const saved = await api.savePersona({ avatar: p?.avatar, name: name.value.trim(), description: desc.value });
            if (img) await api.setPersonaImage(saved.avatar, img);
            if (!state.settings.activePersona) await saveSettings({ activePersona: saved.avatar });
            panel.close(); await reload(); toast('Persona saved');
          } catch (e) { toast(e.message, 'error'); }
        } }, icon('check', 18), 'Save persona')),
    });
  }

  render();
  reload().catch(() => {});
}
