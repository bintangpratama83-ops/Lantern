// HTML sanitiser for message content. Keeps layout HTML and <style> (needed for
// preset HUD panels) but removes scripts, event handlers and dangerous URLs.
// <style> rules are scoped to `.mes-text` so a message can't restyle the app.

const DROP = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'noscript', 'template', 'portal']);
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'srcset', 'data']);

function safeUrl(name, value, tag) {
  const v = String(value).trim().replace(/[\u0000-\u001f\s]+/g, '').toLowerCase();
  if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return false;
  if (v.startsWith('data:')) return (name === 'src' || name === 'srcset') && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)/.test(v) && tag === 'img';
  return true;
}

/** Prefix selectors with the scope; handles @media/@supports nesting; drops @import. */
export function scopeCss(css, scope = '.mes-text') {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/gi, '');
  let out = '', i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    // find matching brace
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    if (/^@(media|supports|container|layer)/i.test(head)) out += `${head}{${scopeCss(body, scope)}}`;
    else if (/^@/.test(head)) out += `${head}{${body}}`; // @keyframes, @font-face, @property
    else {
      const sel = head.split(',').map((s) => {
        s = s.trim();
        if (!s) return '';
        if (/^(:root|html|body)\b/i.test(s)) return ''; // a message may not restyle the page itself
        if (s.startsWith(scope)) return s;
        return `${scope} ${s}`;
      }).filter(Boolean).join(', ');
      if (sel) out += `${sel}{${body}}`;
    }
    i = j;
  }
  return out;
}

export function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT);
  const remove = [];
  let node;
  while ((node = walker.nextNode())) {
    const tag = node.localName;
    if (DROP.has(tag)) { remove.push(node); continue; }
    if (tag === 'style') { node.textContent = scopeCss(node.textContent); continue; }
    if (tag === 'input' && !/^(checkbox|radio|range|text|number)$/i.test(node.getAttribute('type') || 'text')) { remove.push(node); continue; }
    for (const a of [...node.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || n === 'formaction' || n === 'srcdoc') node.removeAttribute(a.name);
      else if (URL_ATTRS.has(n) && !safeUrl(n, a.value, tag)) node.removeAttribute(a.name);
      else if (n === 'style' && /expression\s*\(|url\s*\(\s*['"]?\s*javascript:/i.test(a.value)) node.removeAttribute(a.name);
    }
    if (tag === 'a') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    if (tag === 'img') { node.setAttribute('loading', 'lazy'); node.setAttribute('decoding', 'async'); }
  }
  for (const n of remove) n.remove();
  return tpl.content;
}
