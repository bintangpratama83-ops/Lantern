// Chat view: paged history, markdown/HTML rendering, streaming, swipes,
// regenerate, continue, impersonate, edit/delete/branch, chat management.
import { el, clear, rafThrottle, autosize, isTouch, onLongPress, relTime, download, pickFiles } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, charImg, personaImg } from '../lib/api.js';
import { state, charByFile, activePersona, userName, activeProfile, on, emit } from '../lib/state.js';
import { avatarImg } from '../lib/thumbs.js';
import { renderMarkdown } from '../lib/markdown.js';
import { sanitize } from '../lib/sanitize.js';
import { substitute } from '../engine/macros.js';
import { buildPrompt, requestBody, estimateTokens } from '../engine/prompt.js';
import { generate } from '../engine/generate.js';
import { openImage } from '../ui/viewer.js';
import { openPanel, menu, toast, confirmBox, promptBox } from '../ui/overlays.js';
import { saveSettings } from '../app.js';

const PAGE = 50;
const RENDER_STEP = 30;
const htmlCache = new Map(); // source text -> sanitized fragment (LRU)

function renderText(src) {
  let frag = htmlCache.get(src);
  if (frag) { htmlCache.delete(src); htmlCache.set(src, frag); return frag.cloneNode(true); }
  frag = sanitize(renderMarkdown(src));
  htmlCache.set(src, frag);
  if (htmlCache.size > 400) htmlCache.delete(htmlCache.keys().next().value);
  return frag.cloneNode(true);
}

const nowStr = () => {
  const d = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${String(d.getMinutes()).padStart(2, '0')}${ap}`;
};

export async function mount(main, [charFile, chatParam]) {
  if (!charFile) { location.replace('#/chars'); return; }
  const S = { charFile, chatFile: chatParam || null, card: null, header: {}, total: 0, start: 0, msgs: [], renderFrom: 0, busy: false, ctrl: null, vars: {} };
  const els = new Map(); // message object -> element
  const disposers = [];

  // ---------- skeleton ----------
  const entry = () => charByFile(charFile);
  const headAvatar = el('button', { class: 'head-avatar', 'aria-label': 'View character portrait' });
  const headName = el('div', { class: 'head-name' }, entry()?.name || '');
  const headSub = el('button', { class: 'head-sub', 'aria-label': 'Switch chat' });
  const scroller = el('div', { class: 'chat-scroll' });
  const inner = el('div', { class: 'chat-inner mes-host' });
  const sentinel = el('div', { class: 'sentinel', 'aria-hidden': 'true' });
  const loadingTop = el('div', { class: 'loading-top', hidden: true }, 'Loading earlier messages…');
  inner.append(sentinel, loadingTop);
  scroller.append(inner);
  const jump = el('button', { class: 'jump-bottom', hidden: true, 'aria-label': 'Scroll to latest', onclick: () => scrollBottom(true) }, icon('right', 18));

  const ta = el('textarea', { class: 'composer-input', rows: 1, placeholder: 'Write your message…', 'aria-label': 'Message', enterkeyhint: 'send' });
  const sendBtn = el('button', { class: 'send-btn', 'aria-label': 'Send', title: 'Send' }, icon('send', 20));
  const optsBtn = el('button', { class: 'icon-btn', 'aria-label': 'More actions', title: 'More actions' }, icon('more', 22));
  const personaBtn = el('button', { class: 'persona-btn', 'aria-label': 'Choose persona', title: 'Persona' });
  const composer = el('div', { class: 'composer' }, el('div', { class: 'composer-box' }, personaBtn, ta, optsBtn, sendBtn));

  const head = el('header', { class: 'chat-head' },
    el('a', { class: 'icon-btn back', href: '#/chars', 'aria-label': 'Back to characters' }, icon('back', 22)),
    headAvatar,
    el('div', { class: 'head-text' }, headName, headSub),
    el('div', { class: 'head-actions' },
      el('button', { class: 'icon-btn', 'aria-label': 'Chats', title: 'Chats', onclick: openChatList }, icon('list', 20)),
      el('button', { class: 'icon-btn', 'aria-label': 'Edit character', title: 'Edit character', onclick: editCard }, icon('edit', 20)),
      el('button', { class: 'icon-btn', 'aria-label': 'Chat options', title: 'Chat options', onclick: (e) => chatMenu(e.currentTarget) }, icon('more', 20))));
  main.append(head, scroller, jump, composer);
  document.body.classList.add('in-chat');
  disposers.push(() => document.body.classList.remove('in-chat'));
  autosize(ta, Math.round(window.innerHeight * 0.35));
  const draftKey = () => `lantern.draft.${charFile}/${S.chatFile}`;

  // ---------- helpers ----------
  function setHeadAvatar() {
    const e = entry();
    headAvatar.replaceChildren(avatarImg('avatar', charFile, e?.iv, { name: S.card.name, cls: 'avatar' }));
    headAvatar.onclick = () => openImage(charImg(charFile, e?.iv), { alt: S.card.name });
  }
  function updatePersonaBtn() {
    const p = activePersona();
    personaBtn.replaceChildren(p ? avatarImg('persona', p.avatar, p.iv, { name: p.name, cls: 'avatar sm' }) : el('div', { class: 'avatar sm initial', style: { '--h': 220 } }, (userName()[0] || 'U').toUpperCase()));
    personaBtn.title = `You are ${userName()}`;
  }
  personaBtn.onclick = () => menu(personaBtn, [
    ...state.personas.map((p) => ({ label: p.name, checked: p.avatar === state.settings.activePersona, onclick: async () => { await saveSettings({ activePersona: p.avatar }); updatePersonaBtn(); } })),
    state.personas.length ? 'sep' : null,
    { label: 'Manage personas', icon: 'persona', onclick: () => { location.hash = '#/personas'; } },
  ], { title: 'Speak as' });

  async function createChat() {
    const greet = [S.card.first_mes, ...(S.card.alternate_greetings || [])].filter((g) => g && g.trim());
    const ctx = { char: S.card.name, user: userName(), card: S.card, chat: [] };
    const swipes = greet.map((g) => substitute(g, ctx));
    const messages = swipes.length ? [{ name: S.card.name, is_user: false, is_system: false, send_date: nowStr(), mes: swipes[0], extra: {}, swipes, swipe_id: 0, swipe_info: swipes.map(() => ({ send_date: nowStr(), extra: {} })) }] : [];
    return api.newChat(charFile, { header: { user_name: userName(), character_name: S.card.name, create_date: nowStr(), chat_metadata: {} }, messages });
  }

  async function loadChat() {
    for (const n of els.values()) n.remove();
    els.clear();
    const d = await api.chat(charFile, S.chatFile, undefined, PAGE);
    Object.assign(S, { header: d.header || {}, total: d.total, start: d.start, msgs: d.messages, renderFrom: Math.max(0, d.messages.length - RENDER_STEP) });
    S.vars = S.header.chat_metadata?.variables || {};
    headSub.textContent = S.chatFile.replace(/\.jsonl$/, '');
    headSub.onclick = openChatList;
    const frag = document.createDocumentFragment();
    for (let i = S.renderFrom; i < S.msgs.length; i++) frag.append(msgNode(S.msgs[i]));
    inner.append(frag);
    refreshControls();
    ta.value = sessionStorage.getItem(draftKey()) || '';
    ta.dispatchEvent(new Event('input'));
    requestAnimationFrame(() => scrollBottom(false));
    loadingTop.hidden = true;
  }

  const absIndex = (m) => S.start + S.msgs.indexOf(m);
  const lastMsg = () => S.msgs[S.msgs.length - 1];
  const isGreeting = (m) => absIndex(m) === 0 && !m.is_user;

  // ---------- rendering ----------
  function personaFor(m) {
    return state.personas.find((p) => m.force_avatar?.endsWith(p.avatar)) || state.personas.find((p) => p.name === m.name) || activePersona();
  }

  function msgNode(m) {
    const user = !!m.is_user;
    let av;
    if (user) {
      const p = personaFor(m);
      av = p ? avatarImg('persona', p.avatar, p.iv, { name: p.name, cls: 'avatar' }) : el('div', { class: 'avatar initial', style: { '--h': 220 } }, (m.name || 'U')[0]);
      if (p) av.addEventListener('click', () => openImage(personaImg(p.avatar, p.iv), { alt: p.name }));
    } else {
      av = avatarImg('avatar', charFile, entry()?.iv, { name: S.card.name, cls: 'avatar' });
      av.addEventListener('click', () => openImage(charImg(charFile, entry()?.iv), { alt: S.card.name }));
    }
    const text = el('div', { class: 'mes-text' });
    const node = el('article', { class: `mes ${user ? 'user' : m.is_system ? 'system' : 'char'}` },
      el('div', { class: 'mes-av' }, av),
      el('div', { class: 'mes-body' },
        el('div', { class: 'mes-head' }, el('span', { class: 'mes-name' }, m.name || (user ? userName() : S.card.name)), el('span', { class: 'mes-meta' })),
        el('div', { class: 'mes-reason-slot' }),
        text,
        el('div', { class: 'mes-tools' })));
    els.set(m, node);
    fillText(m);
    fillTools(m);
    // Phone: tap shows tools, long-press opens the action sheet, horizontal drag swipes.
    node.addEventListener('click', (e) => {
      if (e.target.closest('a,button,summary,details,input,label,select,textarea,.mes-av')) return;
      if (!isTouch()) return;
      const was = node.classList.contains('show-tools');
      for (const n of inner.querySelectorAll('.mes.show-tools')) n.classList.remove('show-tools');
      if (!was) node.classList.add('show-tools');
    });
    onLongPress(node.querySelector('.mes-body'), (e) => { if (!e.target.closest('textarea')) msgMenu(m, node); });
    attachSwipeGesture(node, m);
    return node;
  }

  function displayText(m) {
    return substitute(m.mes || '', { char: S.card.name, user: m.is_user ? m.name : userName(), card: S.card, chat: [], vars: {} });
  }

  function fillText(m, { streaming = false } = {}) {
    const node = els.get(m);
    if (!node) return;
    const text = node.querySelector('.mes-text');
    if (text.dataset.editing) return;
    const src = displayText(m);
    text.replaceChildren(src ? (streaming ? sanitize(renderMarkdown(src)) : renderText(src)) : el('span', { class: 'typing', 'aria-label': 'Writing' }, el('i'), el('i'), el('i')));
    // reasoning
    const slot = node.querySelector('.mes-reason-slot');
    const r = m.extra?.reasoning;
    if (r) {
      let det = slot.firstChild;
      if (!det) {
        det = el('details', { class: 'reasoning', open: !!state.settings.ui.reasoningOpen || (streaming && !m.mes) }, el('summary', {}, icon('brain', 16), el('span', {})), el('div', { class: 'reasoning-text' }));
        slot.append(det);
      }
      det.querySelector('summary span').textContent = streaming && !m.mes ? 'Thinking…' : m.extra.reasoning_duration ? `Thought for ${Math.max(1, Math.round(m.extra.reasoning_duration / 1000))}s` : 'Reasoning';
      det.querySelector('.reasoning-text').replaceChildren(sanitize(renderMarkdown(r)));
      if (!streaming && m.mes && !state.settings.ui.reasoningOpen && det.dataset.auto !== 'kept') det.open = false;
    } else clear(slot);
    // meta: swipe counter
    const meta = node.querySelector('.mes-meta');
    const sw = m.swipes?.length || 0;
    meta.textContent = sw > 1 ? `${(m.swipe_id || 0) + 1}/${sw}` : '';
  }

  function fillTools(m) {
    const node = els.get(m);
    if (!node) return;
    const tools = node.querySelector('.mes-tools');
    clear(tools);
    const last = m === lastMsg();
    const b = (ic, label, fn, cls = '') => el('button', { class: `tool ${cls}`, 'aria-label': label, title: label, onclick: (e) => { e.stopPropagation(); fn(e); } }, icon(ic, 17));
    tools.append(
      b('edit', 'Edit', () => editMsg(m)),
      b('copy', 'Copy', () => copyMsg(m)),
      b('branch', 'Branch from here', () => branchAt(m)),
      b('trash', 'Delete', () => deleteMsg(m)),
    );
    if (last && !m.is_user && !m.is_system) {
      const sw = m.swipes?.length || 1;
      const greeting = isGreeting(m);
      tools.append(el('span', { class: 'tool-gap' }),
        b('left', 'Previous swipe', () => swipe(m, -1), (m.swipe_id || 0) > 0 ? '' : 'dim'),
        el('span', { class: 'swipe-count' }, `${(m.swipe_id || 0) + 1}/${sw}`),
        b('right', greeting && (m.swipe_id || 0) >= sw - 1 ? 'Last greeting' : 'Next swipe (generates a new one at the end)', () => swipe(m, 1), greeting && (m.swipe_id || 0) >= sw - 1 ? 'dim' : 'accent'));
      node.classList.add('is-last');
    } else node.classList.remove('is-last');
  }

  function refreshControls() {
    for (const m of S.msgs.slice(-3)) fillTools(m);
  }

  function attachSwipeGesture(node, m) {
    let x0 = null, y0 = null, dx = 0;
    node.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || m !== lastMsg() || m.is_user || S.busy) return;
      if (e.target.closest('textarea,input,.reasoning,pre,table')) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0;
    }, { passive: true });
    node.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      dx = e.clientX - x0;
      if (Math.abs(e.clientY - y0) > 40) { x0 = null; node.style.transform = ''; return; }
      if (Math.abs(dx) > 12) node.style.transform = `translateX(${dx * 0.35}px)`;
    }, { passive: true });
    const end = () => {
      if (x0 == null) return;
      node.style.transform = '';
      if (Math.abs(dx) > 70) swipe(m, dx < 0 ? 1 : -1);
      x0 = null;
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', () => { x0 = null; node.style.transform = ''; });
  }

  // ---------- scrolling & paging ----------
  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
  function scrollBottom(smooth) { scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); }
  scroller.addEventListener('scroll', () => { jump.hidden = nearBottom(); }, { passive: true });

  let paging = false;
  async function showOlder() {
    if (paging) return;
    paging = true;
    try {
      if (S.renderFrom === 0 && S.start > 0) {
        loadingTop.hidden = false;
        const d = await api.chat(charFile, S.chatFile, S.start, PAGE * 2);
        S.msgs = [...d.messages, ...S.msgs];
        S.renderFrom += d.messages.length;
        S.start = d.start;
        loadingTop.hidden = true;
      }
      if (S.renderFrom > 0) {
        const from = Math.max(0, S.renderFrom - RENDER_STEP);
        const frag = document.createDocumentFragment();
        for (let i = from; i < S.renderFrom; i++) frag.append(msgNode(S.msgs[i]));
        const before = scroller.scrollHeight;
        const anchor = loadingTop.nextSibling;
        inner.insertBefore(frag, anchor);
        S.renderFrom = from;
        scroller.scrollTop += scroller.scrollHeight - before;
      }
    } catch (e) { toast(e.message, 'error'); } finally { paging = false; }
  }
  const io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting) && (S.renderFrom > 0 || S.start > 0)) showOlder(); }, { root: scroller, rootMargin: '600px 0px 0px 0px' });
  io.observe(sentinel);
  disposers.push(() => io.disconnect());

  /** Make sure enough older messages are loaded (not rendered) to fill the context window. */
  async function ensureHistory() {
    const budget = (state.settings.gen.context || 8192);
    let tokens = S.msgs.reduce((n, m) => n + estimateTokens(m.mes), 0);
    while (S.start > 0 && tokens < budget) {
      const d = await api.chat(charFile, S.chatFile, S.start, 200);
      S.msgs = [...d.messages, ...S.msgs];
      S.renderFrom += d.messages.length;
      S.start = d.start;
      tokens += d.messages.reduce((n, m) => n + estimateTokens(m.mes), 0);
    }
  }

  // ---------- persistence ----------
  let saveChain = Promise.resolve();
  function save(ops) {
    saveChain = saveChain.then(() => api.chatOps(charFile, S.chatFile, ops)).then((r) => { S.total = r.total; }).catch((e) => toast(`Not saved: ${e.message}`, 'error'));
    return saveChain;
  }
  const setOp = (m) => ({ op: 'set', i: absIndex(m), msg: m });

  // ---------- generation ----------
  function setBusy(b) {
    S.busy = b;
    sendBtn.replaceChildren(icon(b ? 'stop' : 'send', 20));
    sendBtn.setAttribute('aria-label', b ? 'Stop' : 'Send');
    sendBtn.title = b ? 'Stop' : 'Send';
    sendBtn.classList.toggle('stop', b);
    main.classList.toggle('generating', b);
  }

  async function runGen(mode) {
    if (S.busy) return;
    const prof = activeProfile();
    if (!prof) { toast('Add a connection first (Connections tab).', 'error'); location.hash = '#/connections'; return; }
    setBusy(true);
    const ctrl = new AbortController();
    S.ctrl = ctrl;
    let target = null, baseText = '', node = null;
    const t0 = performance.now();
    try {
      await ensureHistory();
      let history = S.msgs.slice();
      if (mode === 'swipe') {
        target = lastMsg();
        history = history.slice(0, -1);
        target.swipes = target.swipes?.length ? target.swipes : [target.mes];
        target.swipe_info = target.swipe_info || target.swipes.map(() => ({}));
        target.swipes.push('');
        target.swipe_info.push({ send_date: nowStr(), extra: {} });
        target.swipe_id = target.swipes.length - 1;
        target.mes = '';
        target.extra = { ...(target.extra || {}) };
        delete target.extra.reasoning; delete target.extra.reasoning_duration;
        fillText(target, { streaming: true });
      } else if (mode === 'continue') {
        target = lastMsg();
        target.extra = target.extra || {};
        baseText = target.mes || '';
      } else if (mode === 'normal') {
        target = { name: S.card.name, is_user: false, is_system: false, send_date: nowStr(), mes: '', extra: {}, swipes: [''], swipe_id: 0, swipe_info: [{ send_date: nowStr(), extra: {} }] };
        S.msgs.push(target);
        node = msgNode(target);
        inner.append(node);
        fillText(target, { streaming: true });
        refreshControls();
        scrollBottom(true);
      }
      const persona = activePersona();
      const { messages } = buildPrompt({ card: S.card, persona, userName: userName(), settings: state.settings, history, mode: mode === 'swipe' ? 'normal' : mode, vars: S.vars, model: prof.model });
      window.__lanternLastPrompt = messages; // handy for debugging in the console
      const body = requestBody(state.settings, messages, prof.model);
      const update = rafThrottle((r) => {
        if (mode === 'impersonate') { ta.value = r.text; ta.dispatchEvent(new Event('input')); return; }
        const stick = nearBottom();
        target.mes = baseText + r.text;
        if (r.reasoning) { target.extra.reasoning = r.reasoning; }
        fillText(target, { streaming: true });
        if (stick) scrollBottom(false);
      });
      const res = await generate({ profileId: prof.id, body, signal: ctrl.signal, onUpdate: update });
      if (mode === 'impersonate') { ta.value = res.text; ta.dispatchEvent(new Event('input')); ta.focus(); return; }
      await new Promise((r) => requestAnimationFrame(r));
      target.mes = baseText + res.text;
      if (res.reasoning) { target.extra.reasoning = res.reasoning; target.extra.reasoning_duration = Math.round(res.reasoningMs || (performance.now() - t0)); }
      target.gen_finished = nowStr();
      if (!target.mes.trim() && !res.aborted) throw new Error('The AI returned an empty reply. Try again or check the model.');
      if (target.swipes) {
        target.swipes[target.swipe_id || 0] = target.mes;
        if (target.swipe_info?.[target.swipe_id || 0]) target.swipe_info[target.swipe_id || 0].extra = { ...target.extra };
      }
      fillText(target);
      if (mode === 'normal') await save([{ op: 'append', msg: target }]);
      else await save([setOp(target)]);
      refreshControls();
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'error');
      if (target && mode === 'normal' && !target.mes.trim()) {
        S.msgs.splice(S.msgs.indexOf(target), 1);
        els.get(target)?.remove(); els.delete(target);
      } else if (target && mode === 'swipe' && !target.mes.trim()) {
        target.swipes.pop(); target.swipe_info?.pop();
        target.swipe_id = target.swipes.length - 1;
        target.mes = target.swipes[target.swipe_id] || '';
        target.extra = { ...(target.swipe_info?.[target.swipe_id]?.extra || {}) };
        fillText(target);
      } else if (target && mode === 'normal' && target.mes.trim()) {
        target.swipes[0] = target.mes;
        fillText(target);
        await save([{ op: 'append', msg: target }]);
      } else if (target) {
        if (target.swipes) target.swipes[target.swipe_id || 0] = target.mes;
        fillText(target);
        if (target.mes !== baseText) await save([setOp(target)]);
      }
      refreshControls();
    } finally {
      S.ctrl = null;
      setBusy(false);
    }
  }

  async function send() {
    if (S.busy) { S.ctrl?.abort(); return; }
    const text = ta.value;
    if (text.trim()) {
      const p = activePersona();
      const msg = { name: userName(), is_user: true, is_system: false, send_date: nowStr(), mes: text, extra: {} };
      if (p) msg.force_avatar = `User Avatars/${p.avatar}`;
      S.msgs.push(msg);
      inner.append(msgNode(msg));
      ta.value = '';
      ta.dispatchEvent(new Event('input'));
      sessionStorage.removeItem(draftKey());
      refreshControls();
      scrollBottom(true);
      await save([{ op: 'append', msg }]);
    }
    runGen('normal');
  }

  sendBtn.addEventListener('click', send);
  ta.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const mode = state.settings.ui.sendOnEnter;
    const enterSends = mode === 'always' || (mode === 'desktop' && !isTouch());
    if ((e.ctrlKey || e.metaKey) || (enterSends && !e.shiftKey)) { e.preventDefault(); send(); }
  });
  ta.addEventListener('input', () => { try { sessionStorage.setItem(draftKey(), ta.value); } catch { /* full */ } });
  optsBtn.addEventListener('click', () => {
    const lm = lastMsg();
    const canAi = lm && !lm.is_user && !lm.is_system;
    menu(optsBtn, [
      { label: 'Continue last message', icon: 'forward', disabled: !canAi || S.busy, onclick: () => runGen('continue') },
      { label: 'Regenerate (new swipe)', icon: 'refresh', disabled: !canAi || S.busy || isGreeting(lm), onclick: () => runGen('swipe') },
      { label: `Write as ${userName()} (impersonate)`, icon: 'mask', disabled: S.busy, onclick: () => runGen('impersonate') },
      'sep',
      { label: 'Start new chat', icon: 'plus', onclick: newChat },
      { label: 'All chats', icon: 'list', onclick: openChatList },
    ]);
  });

  // ---------- message actions ----------
  async function swipe(m, dir) {
    if (S.busy || m !== lastMsg()) return;
    const n = m.swipes?.length || 1;
    const cur = m.swipe_id || 0;
    if (dir < 0 && cur === 0) return;
    if (dir > 0 && cur >= n - 1) { if (!isGreeting(m)) runGen('swipe'); return; }
    if (!m.swipes) m.swipes = [m.mes];
    m.swipe_id = cur + dir;
    m.mes = m.swipes[m.swipe_id];
    m.extra = { ...(m.extra || {}), ...(m.swipe_info?.[m.swipe_id]?.extra || {}) };
    if (!m.swipe_info?.[m.swipe_id]?.extra?.reasoning) { delete m.extra.reasoning; delete m.extra.reasoning_duration; }
    fillText(m); fillTools(m);
    save([setOp(m)]);
  }

  function editMsg(m) {
    const node = els.get(m);
    const text = node.querySelector('.mes-text');
    if (text.dataset.editing) return;
    text.dataset.editing = '1';
    node.classList.add('editing');
    const box = el('textarea', { class: 'input edit-box', value: m.mes });
    const done = (saveIt) => {
      delete text.dataset.editing;
      node.classList.remove('editing');
      if (saveIt && box.value !== m.mes) {
        m.mes = box.value;
        if (m.swipes) m.swipes[m.swipe_id || 0] = m.mes;
        save([setOp(m)]);
      }
      fillText(m);
    };
    text.replaceChildren(box, el('div', { class: 'row end edit-actions' },
      el('button', { class: 'btn small ghost', onclick: () => done(false) }, 'Cancel'),
      el('button', { class: 'btn small primary', onclick: () => done(true) }, 'Save')));
    autosize(box, Math.round(window.innerHeight * 0.6));
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) done(true);
    });
    box.focus();
  }

  async function copyMsg(m) {
    try { await navigator.clipboard.writeText(m.mes); toast('Copied'); } catch { toast('Copy failed — select the text instead', 'error'); }
  }

  async function deleteMsg(m) {
    if (S.busy) return;
    if (!(await confirmBox('Delete this message?', { ok: 'Delete', danger: true }))) return;
    const i = absIndex(m);
    S.msgs.splice(S.msgs.indexOf(m), 1);
    els.get(m)?.remove(); els.delete(m);
    refreshControls();
    save([{ op: 'delete', i }]);
  }

  async function branchAt(m) {
    try {
      await saveChain;
      const { file } = await api.branch(charFile, S.chatFile, absIndex(m));
      toast('Branch created');
      location.hash = `#/chat/${encodeURIComponent(charFile)}/${encodeURIComponent(file)}`;
    } catch (e) { toast(e.message, 'error'); }
  }

  function msgMenu(m, node) {
    const last = m === lastMsg() && !m.is_user;
    menu(node, [
      { label: 'Edit', icon: 'edit', onclick: () => editMsg(m) },
      { label: 'Copy text', icon: 'copy', onclick: () => copyMsg(m) },
      { label: 'Branch from here', icon: 'branch', onclick: () => branchAt(m) },
      last && !isGreeting(m) ? { label: 'Regenerate (new swipe)', icon: 'refresh', disabled: S.busy, onclick: () => runGen('swipe') } : null,
      last ? { label: 'Continue', icon: 'forward', disabled: S.busy, onclick: () => runGen('continue') } : null,
      'sep',
      { label: 'Delete', icon: 'trash', danger: true, onclick: () => deleteMsg(m) },
    ], { title: m.name });
  }

  // ---------- chat management ----------
  async function newChat() {
    if (S.busy) return;
    try {
      const { file } = await createChat();
      location.hash = `#/chat/${encodeURIComponent(charFile)}/${encodeURIComponent(file)}`;
    } catch (e) { toast(e.message, 'error'); }
  }

  async function openChatList() {
    const list = el('div', { class: 'chat-list' }, el('p', { class: 'muted' }, 'Loading…'));
    const panel = openPanel({
      title: `Chats with ${S.card.name}`, body: list,
      footer: el('div', { class: 'row between' },
        el('button', { class: 'btn ghost', onclick: async () => {
          const [f] = await pickFiles({ accept: '.jsonl' });
          if (!f) return;
          try { const r = await api.importChat(charFile, f.name, await f.text()); panel.close(); location.hash = `#/chat/${encodeURIComponent(charFile)}/${encodeURIComponent(r.file)}`; } catch (e) { toast(e.message, 'error'); }
        } }, icon('upload', 18), 'Import .jsonl'),
        el('button', { class: 'btn primary', onclick: () => { panel.close(); newChat(); } }, icon('plus', 18), 'New chat')),
    });
    const chats = await api.chats(charFile).catch((e) => { toast(e.message, 'error'); return []; });
    clear(list);
    if (!chats.length) list.append(el('p', { class: 'muted' }, 'No chats yet.'));
    for (const c of chats) {
      const more = el('button', { class: 'icon-btn', 'aria-label': 'Chat options', onclick: (e) => {
        e.stopPropagation();
        menu(more, [
          { label: 'Rename', icon: 'edit', onclick: async () => {
            const name = await promptBox('Rename chat', c.file.replace(/\.jsonl$/, ''));
            if (!name) return;
            try {
              const r = await api.renameChat(charFile, c.file, name);
              panel.close();
              if (c.file === S.chatFile) location.hash = `#/chat/${encodeURIComponent(charFile)}/${encodeURIComponent(r.file)}`; else openChatList();
            } catch (er) { toast(er.message, 'error'); }
          } },
          { label: 'Download .jsonl', icon: 'download', onclick: () => download(api.chatDownloadUrl(charFile, c.file), c.file) },
          { label: 'Delete', icon: 'trash', danger: true, onclick: async () => {
            if (!(await confirmBox(`Delete "${c.file.replace(/\.jsonl$/, '')}"? It moves to the trash folder.`, { ok: 'Delete', danger: true }))) return;
            try {
              await api.deleteChat(charFile, c.file);
              panel.close();
              if (c.file === S.chatFile) location.hash = `#/chat/${encodeURIComponent(charFile)}`; else openChatList();
            } catch (er) { toast(er.message, 'error'); }
          } },
        ]);
      } }, icon('more', 18));
      list.append(el('div', { class: `chat-row${c.file === S.chatFile ? ' current' : ''}`, role: 'button', tabindex: '0',
        onclick: () => { panel.close(); location.hash = `#/chat/${encodeURIComponent(charFile)}/${encodeURIComponent(c.file)}`; },
        onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); } },
        el('div', { class: 'chat-row-main' },
          el('div', { class: 'chat-row-title' }, c.file.replace(/\.jsonl$/, '')),
          el('div', { class: 'chat-row-prev' }, c.preview || 'Empty chat'),
          el('div', { class: 'chat-row-meta muted' }, `${relTime(c.mtime)} · ${(c.size / 1024).toFixed(c.size > 10240 ? 0 : 1)} KB`)),
        more));
    }
  }

  async function editCard() {
    const { openEditor } = await import('./editor.js');
    openEditor(charFile, { onSaved: (_, card) => { S.card = card; headName.textContent = card.name; setHeadAvatar(); for (const m of S.msgs.slice(S.renderFrom)) fillText(m); } });
  }

  function chatMenu(anchor) {
    menu(anchor, [
      { label: 'Start new chat', icon: 'plus', onclick: newChat },
      { label: 'All chats', icon: 'list', onclick: openChatList },
      { label: 'Rename this chat', icon: 'edit', onclick: async () => {
        const name = await promptBox('Rename chat', S.chatFile.replace(/\.jsonl$/, ''));
        if (!name) return;
        try { const r = await api.renameChat(charFile, S.chatFile, name); location.hash = `#/chat/${encodeURIComponent(charFile)}/${encodeURIComponent(r.file)}`; } catch (e) { toast(e.message, 'error'); }
      } },
      { label: 'Download this chat', icon: 'download', onclick: () => download(api.chatDownloadUrl(charFile, S.chatFile), S.chatFile) },
      'sep',
      { label: 'Edit character', icon: 'edit', onclick: editCard },
      { label: 'View portrait', icon: 'image', onclick: () => openImage(charImg(charFile, entry()?.iv), { alt: S.card.name }) },
    ], { title: S.card.name });
  }

  // ---------- load ----------
  try {
    S.card = state.cardCache.get(charFile) || await api.character(charFile);
    state.cardCache.set(charFile, S.card);
  } catch (e) {
    clear(main).append(el('div', { class: 'empty' }, el('h2', {}, 'Character not found'), el('p', {}, e.message), el('a', { class: 'btn', href: '#/chars' }, 'Back to characters')));
    return;
  }
  headName.textContent = S.card.name;
  setHeadAvatar();
  updatePersonaBtn();

  if (!S.chatFile) {
    const list = await api.chats(charFile).catch(() => []);
    if (list.length) S.chatFile = list[0].file;
    else S.chatFile = (await createChat()).file;
    history.replaceState(history.state, '', `#/chat/${encodeURIComponent(charFile)}/${encodeURIComponent(S.chatFile)}`);
  }
  localStorage.setItem('lantern.lastChat', `${encodeURIComponent(charFile)}/${encodeURIComponent(S.chatFile)}`);
  await loadChat();


  // HTML forms inside messages must never navigate the page.
  inner.addEventListener('submit', (e) => e.preventDefault());

  disposers.push(on('settings', () => { updatePersonaBtn(); }));
  disposers.push(() => S.ctrl?.abort());
  if (!isTouch()) ta.focus({ preventScroll: true });
  void emit;
  return () => disposers.forEach((d) => d());
}
