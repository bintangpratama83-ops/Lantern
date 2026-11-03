// Connections (AI providers), model picker, and generation settings.
import { el, clear, debounce, autosize } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { state, emit } from '../lib/state.js';
import { openPanel, toast, confirmBox } from '../ui/overlays.js';
import { saveSettings } from '../app.js';

export async function mount(main) {
  const profiles = el('div', { class: 'profile-list' });
  const gen = el('div', { class: 'settings-grid' });
  const prompts = el('div', { class: 'stack' });
  main.append(
    el('header', { class: 'page-head' }, el('div', { class: 'page-title' }, el('h1', {}, 'Connections')),
      el('div', { class: 'toolbar' }, el('button', { class: 'btn primary', onclick: () => editProfile(null) }, icon('plus', 18), 'Add connection'))),
    el('section', { class: 'section' }, el('h2', {}, 'AI connections'), el('p', { class: 'muted' }, 'API keys stay on your Lantern server and are never sent to the browser.'), profiles),
    el('section', { class: 'section' }, el('h2', {}, 'Generation'), gen),
    el('section', { class: 'section' }, el('h2', {}, 'Prompts'), el('p', { class: 'muted' }, 'Simple prompt set for now. Full SillyTavern preset import (Prompt Manager) arrives in Phase 2.'), prompts));

  function renderProfiles() {
    clear(profiles);
    const s = state.settings;
    if (!s.profiles.length) {
      profiles.append(el('div', { class: 'empty small' }, el('p', {}, 'No connections yet. Add OpenRouter, NanoGPT, a custom OpenAI-compatible URL, or a local KoboldCpp / llama.cpp server.'),
        el('button', { class: 'btn primary', onclick: () => editProfile(null) }, icon('plus', 18), 'Add connection')));
      return;
    }
    for (const p of s.profiles) {
      const active = p.id === s.activeProfile;
      profiles.append(el('div', { class: `profile${active ? ' active' : ''}` },
        el('button', { class: 'radio', 'aria-pressed': String(active), 'aria-label': `Use ${p.name}`, onclick: async () => { await saveSettings({ activeProfile: p.id }); renderProfiles(); } }),
        el('div', { class: 'profile-main' },
          el('div', { class: 'profile-name' }, p.name),
          el('div', { class: 'muted small' }, `${state.providers[p.type]?.label || p.type} · ${p.model || 'no model picked'}${state.providers[p.type]?.needsKey && !p.hasKey ? ' · key missing' : ''}`)),
        el('button', { class: 'icon-btn', 'aria-label': `Edit ${p.name}`, onclick: () => editProfile(p) }, icon('edit', 18))));
    }
  }

  function editProfile(p) {
    const types = state.providers;
    const type = el('select', { class: 'input' }, Object.entries(types).map(([k, v]) => el('option', { value: k, selected: (p?.type || 'openrouter') === k }, v.label)));
    const name = el('input', { class: 'input', value: p?.name || '' , placeholder: 'e.g. OpenRouter – GLM' });
    const url = el('input', { class: 'input', value: p?.baseUrl || types[p?.type || 'openrouter'].baseUrl, placeholder: 'https://…/v1', inputmode: 'url' });
    const key = el('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: p?.hasKey ? 'Saved — leave empty to keep' : 'Paste your API key' });
    const model = el('input', { class: 'input', value: p?.model || '', placeholder: 'Type a model ID or press Load models', autocomplete: 'off', spellcheck: 'false' });
    const pick = el('div', { class: 'model-pick', role: 'listbox', hidden: true });
    pick.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the input
    const modelInfo = el('div', { class: 'hint' });
    const headers = el('textarea', { class: 'input mono', rows: 2, value: p?.headers && Object.keys(p.headers).length ? JSON.stringify(p.headers) : '', placeholder: '{"X-Header": "value"} (optional)' });
    type.addEventListener('change', () => { if (!p || !url.value) url.value = types[type.value].baseUrl; if (!name.value) name.placeholder = types[type.value].label; });
    let models = [];
    const loadBtn = el('button', { class: 'btn small', onclick: loadModels }, icon('refresh', 16), 'Load models');
    async function loadModels() {
      loadBtn.disabled = true;
      modelInfo.textContent = 'Saving and loading models…';
      try {
        const saved = await persist(false);
        const r = await api.models(saved.id);
        models = Array.isArray(r) ? r : r.models;
        const parts = (r.sources || []).filter((x) => x.label !== 'models').map((x) => `${x.label}: ${x.error ? 'error' : x.count}`);
        modelInfo.textContent = models.length > 1
          ? `${models.length} models found${parts.length ? ` (${parts.join(', ')})` : ''}. Type to search, then tap one.`
          : `The provider only returned ${models.length ? `"${models[0].id}"` : 'no models'}${parts.length ? ` (${parts.join(', ')})` : ''}. You can still type the model ID yourself (copy it from the provider's model list).`;
        drawPick(true);
        model.focus();
      } catch (e) { modelInfo.textContent = e.message; } finally { loadBtn.disabled = false; }
    }
    function drawPick(all = false) {
      const q = all ? '' : model.value.trim().toLowerCase();
      const hits = models.filter((m) => !q || m.id.toLowerCase().includes(q) || String(m.name || '').toLowerCase().includes(q)).slice(0, 300);
      pick.replaceChildren(...hits.map((m) => el('button', {
        class: `model-opt${m.id === model.value ? ' on' : ''}`, type: 'button', role: 'option',
        onclick: () => { model.value = m.id; pick.hidden = true; model.dispatchEvent(new Event('change')); },
      }, el('span', { class: 'model-id' }, m.id), m.context ? el('span', { class: 'muted small' }, `${Math.round(m.context / 1000)}k`) : null)));
      pick.hidden = !hits.length;
    }
    model.addEventListener('input', () => drawPick());
    model.addEventListener('focus', () => { if (models.length) drawPick(true); });
    model.addEventListener('blur', () => setTimeout(() => { pick.hidden = true; }, 150));
    model.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pick.hidden) { e.stopPropagation(); pick.hidden = true; } });
    model.addEventListener('change', () => {
      const m = models.find((x) => x.id === model.value);
      if (m?.context) modelInfo.textContent = `Context window: ${m.context.toLocaleString()} tokens.`;
    });
    let current = p;
    async function persist(close = true) {
      let hdr = {};
      if (headers.value.trim()) { try { hdr = JSON.parse(headers.value); } catch { throw new Error('Extra headers must be JSON'); } }
      const s = await api.saveProfile({ id: current?.id, type: type.value, name: name.value.trim() || types[type.value].label, baseUrl: url.value, key: key.value || undefined, model: model.value, headers: hdr });
      state.settings = s; emit('settings', s);
      current = s.profiles.find((x) => x.id === current?.id) || s.profiles[s.profiles.length - 1];
      if (key.value) { key.value = ''; key.placeholder = 'Saved — leave empty to keep'; }
      renderProfiles();
      if (close) { panel.close(); toast('Connection saved'); }
      return current;
    }
    const body = el('div', { class: 'stack' },
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Provider'), type),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Name'), name),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'API URL'), url, el('span', { class: 'hint' }, 'KoboldCpp and llama.cpp: use their OpenAI-compatible /v1 address.')),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'API key'), key),
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Model'), el('div', { class: 'row' }, model, loadBtn), pick, modelInfo),
      el('details', { class: 'more-fields' }, el('summary', {}, 'Advanced'), el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Extra headers'), headers)));
    const panel = openPanel({
      title: p ? `Edit ${p.name}` : 'Add connection', body,
      footer: el('div', { class: 'row between' },
        p ? el('button', { class: 'btn ghost danger', onclick: async () => {
          if (!(await confirmBox(`Remove ${p.name} and its saved key?`, { ok: 'Remove', danger: true }))) return;
          state.settings = await api.deleteProfile(p.id); emit('settings', state.settings); renderProfiles(); panel.close();
        } }, icon('trash', 18), 'Remove') : el('span'),
        el('button', { class: 'btn primary', onclick: () => persist(true).catch((e) => toast(e.message, 'error')) }, icon('check', 18), 'Save connection')),
    });
  }

  // ---- generation settings ----
  const g = () => state.settings.gen;
  const saveGen = debounce((patch) => saveSettings({ gen: patch }).catch((e) => toast(e.message, 'error')), 300);
  function slider(key, label, min, max, step, hint) {
    const val = el('input', { class: 'input num', type: 'number', min, max, step, value: g()[key] });
    const rng = el('input', { type: 'range', min, max, step, value: g()[key], 'aria-label': label });
    const set = (v) => { val.value = v; rng.value = v; saveGen({ [key]: Number(v) }); };
    rng.addEventListener('input', () => set(rng.value));
    val.addEventListener('change', () => set(val.value));
    return el('div', { class: 'field' }, el('span', { class: 'field-label' }, label, val), rng, hint ? el('span', { class: 'hint' }, hint) : null);
  }
  const stream = el('input', { type: 'checkbox', checked: !!g().stream, onchange: () => saveGen({ stream: stream.checked }) });
  const effort = el('select', { class: 'input', onchange: () => saveGen({ reasoning_effort: effort.value }) },
    [['', 'Model default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']].map(([v, l]) => el('option', { value: v, selected: g().reasoning_effort === v }, l)));
  gen.append(
    slider('context', 'Context size (tokens)', 2048, 1000000, 1024, 'How much chat history to send. Older messages are left out first.'),
    slider('max_tokens', 'Max reply length (tokens)', 50, 16000, 10),
    slider('temperature', 'Temperature', 0, 2, 0.01),
    slider('top_p', 'Top P', 0, 1, 0.01),
    slider('frequency_penalty', 'Frequency penalty', -2, 2, 0.01),
    slider('presence_penalty', 'Presence penalty', -2, 2, 0.01),
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Reasoning effort'), effort, el('span', { class: 'hint' }, 'For reasoning models on OpenRouter-style APIs.')),
    el('label', { class: 'check' }, stream, ' Stream replies as they are written'));

  // ---- prompts ----
  const P = state.settings.prompts;
  const savePrompts = debounce((patch) => saveSettings({ prompts: patch }).catch((e) => toast(e.message, 'error')), 400);
  for (const [key, label, hint] of [
    ['main', 'Main prompt', 'Sent first. A character card can override it.'],
    ['post', 'Post-history instructions', 'Sent after the chat history (like a jailbreak). A card can override it.'],
    ['continue', 'Continue nudge', 'Used by "Continue last message".'],
    ['impersonate', 'Impersonate prompt', 'Used by "Write as you".'],
  ]) {
    const ta = el('textarea', { class: 'input', rows: 3, value: P[key] || '' });
    ta.addEventListener('input', () => savePrompts({ [key]: ta.value }));
    autosize(ta, 300);
    prompts.append(el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), ta, el('span', { class: 'hint' }, hint)));
  }

  renderProfiles();
  if (!state.settings.profiles.length) setTimeout(() => editProfile(null), 300);
}
