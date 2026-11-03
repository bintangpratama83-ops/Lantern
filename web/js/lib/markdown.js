// Message formatter, modelled on how SillyTavern displays messages:
// *italic*, **bold**, "dialogue" wrapped in <q>, code, headings, lists, quotes,
// raw HTML blocks (HUD panels) kept intact, newlines -> <br>.
// Output must go through sanitize() before it touches the DOM.
import { escapeHtml } from './dom.js';

const BLOCK_TAGS = new Set(['div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'details', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'p', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figure', 'figcaption', 'center', 'fieldset', 'form', 'svg', 'style', 'hr', 'summary', 'font']);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'col', 'wbr', 'area', 'embed', 'track']);
const PH = (i) => `\u0001${i}\u0002`;
const PH_RE = /\u0001(\d+)\u0002/g;

function inline(s) {
  // s has HTML tags replaced by placeholders and is otherwise raw text.
  s = escapeHtml(s).replace(/&amp;(#?\w+;)/g, '&$1'); // keep entities the model wrote
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*\*(?!\s)([\s\S]+?)\*\*\*/g, '<em><strong>$1</strong></em>');
  s = s.replace(/\*\*(?!\s)([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?![\s*])([^*]+?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])__(?!\s)([\s\S]+?)__(?![\w_])/g, '$1<strong>$2</strong>');
  s = s.replace(/(^|[^\w_])_(?![\s_])([^_\n]+?)_(?![\w_])/g, '$1<em>$2</em>');
  s = s.replace(/~~(?!\s)([\s\S]+?)~~/g, '<del>$1</del>');
  // Dialogue quotes, like SillyTavern: literal quote marks kept inside <q>.
  s = s.replace(/&quot;([^\n]*?)&quot;/g, '<q>"$1"</q>');
  s = s.replace(/“([^”\n]*?)”/g, '<q>“$1”</q>');
  s = s.replace(/«([^»\n]*?)»/g, '<q>«$1»</q>');
  return s;
}

export function renderMarkdown(src) {
  const store = [];
  const keep = (html) => { store.push(html); return PH(store.length - 1); };
  let s = String(src ?? '').replace(/\r\n?/g, '\n');

  // 1. Protect code, comments and <style>/<script>.
  s = s.replace(/^(```|~~~)[^\n]*\n([\s\S]*?)(?:\n\1|$(?![\s\S]))/gm, (_, f, code) => keep(`<pre><code>${escapeHtml(code)}</code></pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${escapeHtml(c)}</code>`));
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, (m) => keep(m));
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');

  // 2. Replace every HTML tag with a placeholder, remembering block-level ones.
  const tagInfo = [];
  s = s.replace(/<\/?([a-zA-Z][\w-]*)(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g, (m, name) => {
    const n = name.toLowerCase();
    const closing = m[1] === '/';
    const selfClose = /\/>$/.test(m) || VOID.has(n);
    const id = store.length;
    store.push(m);
    tagInfo[id] = { block: BLOCK_TAGS.has(n), open: !closing && !selfClose, close: closing };
    return PH(id);
  });

  // 3. Block pass, line by line.
  const lines = s.split('\n');
  const out = [];
  let depth = 0; // inside raw HTML block
  let para = [];
  let list = null; // { type, items }
  let quote = [];
  const flushPara = () => { if (para.length) { out.push(para.map(inline).join('<br>')); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  const blockDelta = (line) => {
    let d = 0;
    line.replace(PH_RE, (_, i) => { const t = tagInfo[i]; if (t?.block) d += t.open ? 1 : t.close ? -1 : 0; return ''; });
    return d;
  };
  const startsWithBlock = (line) => { const m = line.trimStart().match(/^\u0001(\d+)\u0002/); return m && tagInfo[m[1]]?.block; };

  for (const line of lines) {
    if (depth > 0 || (startsWithBlock(line) && depth === 0 && blockDelta(line) > 0)) {
      if (depth === 0) flushAll();
      depth = Math.max(0, depth + blockDelta(line));
      out.push({ raw: line });
      continue;
    }
    const t = line.trim();
    if (!t) { flushAll(); out.push({ gap: true }); continue; }
    if (startsWithBlock(line)) { flushAll(); out.push({ raw: line }); continue; }
    let m;
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) { flushAll(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if (/^(\*\s*\*\s*\*|-{3,}|_{3,})[\s*_-]*$/.test(t) && !/[^*\-_\s]/.test(t)) { flushAll(); out.push('<hr>'); continue; }
    if ((m = t.match(/^>\s?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = t.match(/^[-+]\s+(.*)$/)) || (m = t.match(/^\*\s+(?!.*\*\s*$)(.*)$/))) { flushPara(); flushQuote(); if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { flushPara(); flushQuote(); if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushList(); flushQuote();
    para.push(line);
  }
  flushAll();

  // Join: paragraphs separated by blank lines get a blank-line gap like SillyTavern's <br><br>.
  let html = '';
  let prevText = false;
  for (const part of out) {
    if (typeof part === 'string') { if (prevText) html += '<br>'; html += part; prevText = !/^<(h\d|ul|ol|blockquote|hr|pre)/.test(part); }
    else if (part.gap) { if (prevText) { html += '<br>'; prevText = false; } }
    else { html += part.raw.replace(PH_RE, (_, i) => store[i]) + '\n'; prevText = false; }
  }
  // 4. Restore remaining placeholders (tags inside text, code, styles). Nested placeholders resolve repeatedly.
  for (let k = 0; k < 3 && /\u0001\d+\u0002/.test(html); k++) html = html.replace(PH_RE, (_, i) => store[i]);
  return html;
}
