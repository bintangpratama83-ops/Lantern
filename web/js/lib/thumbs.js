// Avatar thumbnails. The server stores small WebP thumbnails; if one is missing,
// the browser makes it once from the full image (canvas) and uploads it.
// After that, lists only ever download ~10-20 KB per character, cached forever.
import { el } from './dom.js';
import { thumbUrl, charImg, personaImg } from './api.js';

const queue = [];
let running = 0;
const MAX = 2;
const inflight = new Map();

async function makeThumb(fullUrl, width = 300) {
  const res = await fetch(fullUrl);
  if (!res.ok) throw new Error('image fetch failed');
  const blob = await res.blob();
  let bmp;
  try { bmp = await createImageBitmap(blob, { resizeWidth: width, resizeQuality: 'high' }); } catch { bmp = await createImageBitmap(blob); }
  const scale = Math.min(1, width / bmp.width);
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : el('canvas', { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const toBlob = (type, q) => canvas.convertToBlob ? canvas.convertToBlob({ type, quality: q }) : new Promise((r) => canvas.toBlob(r, type, q));
  let out = await toBlob('image/webp', 0.82);
  if (!out || out.type !== 'image/webp') out = await toBlob('image/jpeg', 0.85); // Safari can't encode WebP
  return out;
}

function pump() {
  while (running < MAX && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => { running--; pump(); });
  }
}

/** Ensures the thumbnail exists; resolves with its URL. */
export function ensureThumb(kind, file, iv) {
  const key = `${kind}/${file}/${iv}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const full = kind === 'persona' ? personaImg(file, iv) : charImg(file, iv);
        const blob = await makeThumb(full);
        await fetch(thumbUrl(kind, file, iv), { method: 'PUT', body: blob });
        resolve(thumbUrl(kind, file, iv));
      } catch (e) { reject(e); }
    });
    pump();
  });
  inflight.set(key, p);
  p.catch(() => inflight.delete(key));
  return p;
}

/** <img> for a character/persona that falls back to generating its thumbnail. */
export function avatarImg(kind, file, iv, { alt = '', cls = 'avatar', name = '' } = {}) {
  if (kind === 'persona' && (!iv || iv === '0')) return initialTile(name || alt, cls); // persona without a picture
  const img = el('img', { class: cls, alt, loading: 'lazy', decoding: 'async', draggable: 'false' });
  let tried = false;
  img.onerror = () => {
    if (tried) { img.replaceWith(initialTile(name || alt, cls)); return; }
    tried = true;
    ensureThumb(kind, file, iv).then((u) => { img.src = `${u}&r=1`; }).catch(() => img.replaceWith(initialTile(name || alt, cls)));
  };
  img.src = thumbUrl(kind, file, iv);
  return img;
}

export function initialTile(name, cls = 'avatar') {
  const ch = (String(name || '?').trim()[0] || '?').toUpperCase();
  const hue = [...String(name)].reduce((a, c) => a + c.charCodeAt(0) * 13, 0) % 360;
  return el('div', { class: `${cls} initial`, style: { '--h': hue }, 'aria-hidden': 'true' }, ch);
}
