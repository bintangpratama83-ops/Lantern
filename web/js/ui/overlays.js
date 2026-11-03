// Panels (side drawer on laptop / full sheet on phone), dialogs, menus and toasts.
// Every overlay closes on backdrop tap, Esc and the back button, and stacks cleanly.
import { el, isPhone } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

const stack = [];

function pushOverlay(entry) {
  stack.push(entry);
  history.pushState({ ...(history.state || {}), lanternOverlay: stack.length }, '');
}
window.addEventListener('popstate', () => {
  const top = stack[stack.length - 1];
  if (top && (history.state?.lanternOverlay || 0) < stack.length) top.close(true);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !stack.length || document.querySelector('.viewer')) return;
  e.preventDefault();
  stack[stack.length - 1].close();
});

function makeCloser(root, onClose) {
  let closed = false;
  const entry = {
    close(fromHistory) {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      root.classList.remove('open');
      root.classList.add('leaving');
      setTimeout(() => root.remove(), 200);
      if (!fromHistory && history.state?.lanternOverlay) history.back();
      onClose?.();
    },
  };
  return entry;
}

/**
 * openPanel({ title, body, footer, wide }) -> { close, root, body }
 * Laptop: drawer from the right. Phone: full-height sheet with a drag handle.
 */
export function openPanel({ title, body, footer, wide = false, onClose } = {}) {
  const head = el('header', { class: 'panel-head' },
    el('div', { class: 'grab', 'aria-hidden': 'true' }),
    el('h2', { class: 'panel-title' }, title || ''),
    el('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => entry.close() }, icon('x')));
  const bodyEl = el('div', { class: 'panel-body' }, body);
  const panel = el('section', { class: `panel${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, head, bodyEl, footer ? el('footer', { class: 'panel-foot' }, footer) : null);
  const root = el('div', { class: 'overlay panel-wrap' }, el('div', { class: 'scrim' }), panel);
  const entry = makeCloser(root, onClose);
  root.addEventListener('pointerdown', (e) => { root._down = e.target; });
  root.addEventListener('click', (e) => { if (e.target === root || e.target.classList.contains('scrim')) if (root._down === e.target) entry.close(); });

  // Phone: drag the header down to dismiss.
  let y0 = null;
  head.addEventListener('pointerdown', (e) => { if (isPhone() && !e.target.closest('button')) { y0 = e.clientY; head.setPointerCapture(e.pointerId); } });
  head.addEventListener('pointermove', (e) => { if (y0 != null) panel.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  head.addEventListener('pointerup', (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null;
    panel.style.transform = '';
    if (dy > 120) entry.close();
  });

  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('open'));
  pushOverlay(entry);
  return { ...entry, close: () => entry.close(), root, body: bodyEl, panel };
}

/** Small centred dialog. Resolves with the clicked button's value (or null). */
export function dialog({ title, message, content, buttons = [{ label: 'OK', value: true, primary: true }] }) {
  return new Promise((resolve) => {
    let result = null;
    const box = el('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true' },
      title ? el('h3', {}, title) : null,
      message ? el('p', { class: 'dialog-msg' }, message) : null,
      content || null,
      el('div', { class: 'dialog-actions' }, buttons.map((b) => el('button', {
        class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`,
        onclick: () => { result = typeof b.value === 'function' ? b.value() : b.value; entry.close(); },
      }, b.label))));
    const root = el('div', { class: 'overlay dialog-wrap' }, el('div', { class: 'scrim' }), box);
    const entry = makeCloser(root, () => resolve(result));
    root.addEventListener('pointerdown', (e) => { root._down = e.target; });
    root.addEventListener('click', (e) => { if ((e.target === root || e.target.classList.contains('scrim')) && root._down === e.target) entry.close(); });
    document.body.append(root);
    requestAnimationFrame(() => { root.classList.add('open'); (box.querySelector('input,textarea') || box.querySelector('.btn.primary'))?.focus(); });
    pushOverlay(entry);
  });
}

export function confirmBox(message, { title = 'Are you sure?', ok = 'Confirm', danger = false } = {}) {
  return dialog({ title, message, buttons: [{ label: 'Cancel', value: false }, { label: ok, value: true, primary: !danger, danger }] });
}

export async function promptBox(title, value = '', { ok = 'Save', placeholder = '' } = {}) {
  const input = el('input', { class: 'input', value, placeholder });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.closest('.dialog').querySelector('.btn.primary').click(); });
  const r = await dialog({ title, content: input, buttons: [{ label: 'Cancel', value: null }, { label: ok, value: () => input.value, primary: true }] });
  return r;
}

/** Action menu: popover on laptop, bottom action sheet on phone. items: [{label, icon, onclick, danger}] | 'sep' */
export function menu(anchor, items, { title } = {}) {
  const list = el('div', { class: 'menu-list', role: 'menu' },
    title ? el('div', { class: 'menu-title' }, title) : null,
    items.filter(Boolean).map((it) => it === 'sep' ? el('hr') : el('button', {
      class: `menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`, role: 'menuitem', disabled: it.disabled,
      onclick: () => { entry.close(); setTimeout(() => it.onclick?.(), 0); },
    }, it.icon ? icon(it.icon, 18) : el('span', { class: 'ic-gap' }), el('span', {}, it.label), it.checked ? icon('check', 16) : null)));
  const phone = isPhone();
  const root = el('div', { class: `overlay menu-wrap${phone ? ' sheet' : ''}` }, el('div', { class: 'scrim' }), list);
  const entry = makeCloser(root);
  // Only a tap that *starts* on the backdrop closes it (the finger lifting after a long-press must not).
  root.addEventListener('pointerdown', (e) => { root._down = e.target; });
  root.addEventListener('click', (e) => { if ((e.target === root || e.target.classList.contains('scrim')) && root._down === e.target) entry.close(); });
  document.body.append(root);
  if (!phone && anchor) {
    const r = anchor.getBoundingClientRect();
    const w = 240;
    list.style.minWidth = w + 'px';
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
    const below = r.bottom + 6;
    list.style.left = left + 'px';
    requestAnimationFrame(() => {
      const h = list.offsetHeight;
      list.style.top = (below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below) + 'px';
    });
  }
  requestAnimationFrame(() => { root.classList.add('open'); list.querySelector('.menu-item')?.focus({ preventScroll: true }); });
  pushOverlay(entry);
  return entry;
}

let toastHost;
export function toast(message, kind = 'info', ms = 3200) {
  if (!toastHost) { toastHost = el('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = el('div', { class: `toast ${kind}`, onclick: () => t.remove() }, message);
  toastHost.append(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 250); }, kind === 'error' ? Math.max(ms, 6000) : ms);
}

/** Used on navigation: closes without touching history (the URL already changed). */
export function closeAllOverlays() { while (stack.length) stack[stack.length - 1].close(true); }
