// Full-screen image viewer.
// Closes on: tap/click outside the image, Esc, swipe down, Android/browser back, or the ✕.
// Sits above every other layer (incl. top bar) and respects phone safe areas.
import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let current = null;

export function openImage(src, { alt = '', placeholder = '' } = {}) {
  if (current) current.close(true);

  const img = el('img', { class: 'viewer-img', alt, draggable: 'false', src: placeholder || src });
  if (placeholder) {
    const full = new Image();
    full.onload = () => { img.src = src; };
    full.src = src;
  }
  const closeBtn = el('button', { class: 'viewer-close', 'aria-label': 'Close image', title: 'Close (Esc)' }, icon('x', 22));
  const stage = el('div', { class: 'viewer-stage' }, img);
  const root = el('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': alt || 'Image' }, stage, closeBtn);

  // Size the <img> to exactly the visible picture (scaled up or down to fit), so
  // "outside the image" really means outside what you see.
  const fit = () => {
    const nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh) return;
    const cs = getComputedStyle(stage);
    const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const k = Math.min(aw / nw, ah / nh, 3);
    img.style.width = `${Math.round(nw * k)}px`;
    img.style.height = `${Math.round(nh * k)}px`;
  };
  img.addEventListener('load', fit);
  window.addEventListener('resize', fit);

  // zoom/pan state
  let scale = 1, tx = 0, ty = 0, dragY = 0;
  const apply = (animate) => {
    img.style.transition = animate ? 'transform .18s ease' : 'none';
    img.style.transform = `translate(${tx}px, ${ty + dragY}px) scale(${scale})`;
    root.style.setProperty('--fade', String(Math.max(0.25, 1 - Math.abs(dragY) / 400)));
    root.classList.toggle('zoomed', scale > 1.01);
  };
  const reset = () => { scale = 1; tx = 0; ty = 0; dragY = 0; apply(true); };

  let closed = false;
  const close = (fromHistory) => {
    if (closed) return;
    closed = true;
    current = null;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('resize', fit);
    root.classList.add('leaving');
    setTimeout(() => root.remove(), 160);
    if (!fromHistory && history.state?.lanternViewer) history.back();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const onPop = () => close(true);

  // Tap/click outside the image closes. A tap on the image does not.
  let downTarget = null, moved = false;
  root.addEventListener('pointerdown', (e) => { downTarget = e.target; moved = false; });
  root.addEventListener('click', (e) => {
    if (moved) return;
    if (e.target === img || closeBtn.contains(e.target)) return;
    if (downTarget !== e.target) return; // ignore drags that end outside
    close();
  });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });

  // Pointer gestures: swipe-down to close, pinch/drag when zoomed, double-tap zoom.
  const pts = new Map();
  let start = null, pinch0 = null, lastTap = 0;
  img.addEventListener('pointerdown', (e) => {
    img.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, tx, ty };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), scale };
    }
  });
  img.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch0) {
      const [a, b] = [...pts.values()];
      scale = Math.min(6, Math.max(1, pinch0.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d));
      moved = true; apply(false);
    } else if (pts.size === 1 && start) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (scale > 1.01) { tx = start.tx + dx; ty = start.ty + dy; }
      else dragY = Math.max(0, dy) * 0.9;
      apply(false);
    }
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch0 = null;
    if (pts.size) return;
    if (scale <= 1.01 && dragY > 110) { close(); return; }
    if (scale <= 1.01) reset(); else { dragY = 0; apply(true); }
    if (!moved) {
      const now = Date.now();
      if (now - lastTap < 300) { if (scale > 1.01) reset(); else { scale = 2.2; apply(true); } lastTap = 0; }
      else lastTap = now;
    }
    start = null;
  };
  img.addEventListener('pointerup', end);
  img.addEventListener('pointercancel', end);
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.min(6, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (scale <= 1.01) { tx = 0; ty = 0; }
    apply(true);
  }, { passive: false });

  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('open'));
  history.pushState({ ...(history.state || {}), lanternViewer: true }, '');
  window.addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey);
  closeBtn.focus({ preventScroll: true });

  current = { close };
  return current;
}
