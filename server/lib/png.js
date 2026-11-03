// PNG helpers: read/write tEXt chunks (character cards) and encode a tiny PNG.
// Zero dependencies — uses Node's built-in zlib only.
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(buf) {
  return buf.length > 8 && buf.subarray(0, 8).equals(SIG);
}

export function readChunks(buf) {
  if (!isPng(buf)) throw new Error('Not a PNG file');
  const chunks = [];
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    chunks.push({ type, data, start: p, end: p + 12 + len });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Returns { keyword: text } for tEXt and uncompressed/compressed iTXt/zTXt chunks. */
export function readTextChunks(buf) {
  const out = {};
  for (const c of readChunks(buf)) {
    try {
      if (c.type === 'tEXt') {
        const z = c.data.indexOf(0);
        out[c.data.toString('latin1', 0, z)] = c.data.toString('latin1', z + 1);
      } else if (c.type === 'zTXt') {
        const z = c.data.indexOf(0);
        out[c.data.toString('latin1', 0, z)] = zlib.inflateSync(c.data.subarray(z + 2)).toString('latin1');
      } else if (c.type === 'iTXt') {
        const z = c.data.indexOf(0);
        const key = c.data.toString('latin1', 0, z);
        const compressed = c.data[z + 1] === 1;
        let p = z + 3;
        p = c.data.indexOf(0, p) + 1; // language tag
        p = c.data.indexOf(0, p) + 1; // translated keyword
        const raw = c.data.subarray(p);
        out[key] = (compressed ? zlib.inflateSync(raw) : raw).toString('utf8');
      }
    } catch { /* ignore malformed chunk */ }
  }
  return out;
}

/** Replace (or add) tEXt chunks for the given keywords, inserted before IEND. */
export function writeTextChunks(buf, entries) {
  const keys = new Set(Object.keys(entries));
  const chunks = readChunks(buf);
  const parts = [SIG];
  for (const c of chunks) {
    if ((c.type === 'tEXt' || c.type === 'iTXt' || c.type === 'zTXt')) {
      const z = c.data.indexOf(0);
      if (keys.has(c.data.toString('latin1', 0, z))) continue;
    }
    if (c.type === 'IEND') {
      for (const [k, v] of Object.entries(entries)) {
        parts.push(makeChunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(v, 'latin1')])));
      }
    }
    parts.push(buf.subarray(c.start, c.end));
  }
  return Buffer.concat(parts);
}

/** Encode an RGB image (Uint8Array w*h*3) as PNG. */
export function encodeRgbPng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIG, makeChunk('IHDR', ihdr), makeChunk('IDAT', zlib.deflateSync(raw)), makeChunk('IEND', Buffer.alloc(0))]);
}

/** Small portrait gradient used for characters created without an image. */
export function defaultAvatarPng(seed = 0) {
  const w = 200, h = 300;
  const rgb = new Uint8Array(w * h * 3);
  const hue = (seed % 360) / 360;
  const toRgb = (hh, s, l) => {
    const f = (n) => {
      const k = (n + hh * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  };
  for (let y = 0; y < h; y++) {
    const [r, g, b] = toRgb(hue, 0.35, 0.18 + (y / h) * 0.22);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
    }
  }
  return encodeRgbPng(w, h, rgb);
}
