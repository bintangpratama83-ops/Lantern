// SillyTavern-style macros. Phase 1 covers the common set; Phase 2 adds the rest.
// ctx: { char, user, card, persona, chat: [messages], vars: {}, globalVars: {}, seed }

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function seeded(seed) {
  let h = 2166136261;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

function splitArgs(s) {
  if (s.includes('::')) return s.split('::');
  return s.split(/(?<!\\),/).map((x) => x.replace(/\\,/g, ','));
}

function roll(expr) {
  const m = String(expr).trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i) || String(expr).trim().match(/^()(\d+)()$/);
  if (!m) return '';
  const n = Math.min(100, Number(m[1] || 1)), sides = Number(m[2]), add = Number(m[3] || 0);
  let total = add;
  for (let i = 0; i < n; i++) total += 1 + Math.floor(Math.random() * sides);
  return String(total);
}

export function substitute(text, ctx = {}) {
  if (!text || typeof text !== 'string' || !text.includes('{{') && !/<(USER|BOT|CHAR)>/i.test(text)) return text || '';
  const card = ctx.card || {};
  const chat = ctx.chat || [];
  const vars = ctx.vars || {};
  const last = (pred) => { for (let i = chat.length - 1; i >= 0; i--) if (pred(chat[i])) return chat[i].mes || ''; return ''; };
  const now = new Date();
  const pickRng = seeded(`${ctx.seed || ''}`);

  let s = text.replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
  const simple = {
    char: ctx.char || card.name || '', user: ctx.user || 'User', persona: ctx.persona || '',
    description: card.description || '', personality: card.personality || '', scenario: card.scenario || '',
    mesexamples: card.mes_example || '', mesexamplesraw: card.mes_example || '', charprompt: card.system_prompt || '',
    charinstruction: card.post_history_instructions || '', charjailbreak: card.post_history_instructions || '',
    charversion: card.character_version || '', char_version: card.character_version || '', creatornotes: card.creator_notes || '',
    model: ctx.model || '', newline: '\n', noop: '', input: ctx.input || '',
    lastmessage: last(() => true), lastcharmessage: last((m) => !m.is_user && !m.is_system), lastusermessage: last((m) => m.is_user),
    lastmessageid: String(Math.max(0, chat.length - 1)), messagecount: String(chat.length),
    time: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), date: now.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }),
    weekday: WEEKDAYS[now.getDay()], isotime: now.toTimeString().slice(0, 5), isodate: now.toISOString().slice(0, 10),
    idle_duration: 'a while',
  };

  // Up to 4 passes so macros that output macros resolve (e.g. description containing {{char}}).
  for (let pass = 0; pass < 4 && s.includes('{{'); pass++) {
    const before = s;
    s = s.replace(/\{\{([^{}]*)\}\}/g, (m, inner) => {
      const raw = inner.trim();
      const low = raw.toLowerCase();
      if (low in simple) return simple[low];
      let a;
      if ((a = raw.match(/^random\s*(?:::|:)\s*([\s\S]*)$/i))) { const opts = splitArgs(a[1]); return opts[Math.floor(Math.random() * opts.length)] ?? ''; }
      if ((a = raw.match(/^pick\s*(?:::|:)\s*([\s\S]*)$/i))) { const opts = splitArgs(a[1]); return opts[Math.floor(pickRng() * opts.length)] ?? ''; }
      if ((a = raw.match(/^roll\s*(?:::|:)\s*(.+)$/i))) return roll(a[1]);
      if ((a = raw.match(/^getvar::([^:]+)$/i))) return vars[a[1].trim()] ?? '';
      if ((a = raw.match(/^setvar::([^:]+)::([\s\S]*)$/i))) { vars[a[1].trim()] = a[2]; return ''; }
      if ((a = raw.match(/^addvar::([^:]+)::([\s\S]*)$/i))) { const k = a[1].trim(); const n = Number(vars[k] || 0) + Number(a[2]); vars[k] = Number.isNaN(n) ? `${vars[k] || ''}${a[2]}` : String(n); return ''; }
      if ((a = raw.match(/^incvar::([^:]+)$/i))) { const k = a[1].trim(); vars[k] = String(Number(vars[k] || 0) + 1); return ''; }
      if ((a = raw.match(/^decvar::([^:]+)$/i))) { const k = a[1].trim(); vars[k] = String(Number(vars[k] || 0) - 1); return ''; }
      if ((a = raw.match(/^getglobalvar::([^:]+)$/i))) return (ctx.globalVars || {})[a[1].trim()] ?? '';
      if ((a = raw.match(/^setglobalvar::([^:]+)::([\s\S]*)$/i))) { if (ctx.globalVars) ctx.globalVars[a[1].trim()] = a[2]; return ''; }
      if ((a = raw.match(/^(upper|lower)::([\s\S]*)$/i))) return a[1].toLowerCase() === 'upper' ? a[2].toUpperCase() : a[2].toLowerCase();
      if ((a = raw.match(/^reverse:([\s\S]*)$/i))) return [...a[1]].reverse().join('');
      if ((a = raw.match(/^banned\s+"[\s\S]*"$/i))) return '';
      if (low === 'trim') return '\u0000TRIM\u0000';
      return m; // unknown: leave as written
    });
    if (s === before) break;
  }
  s = s.replace(/\s*\u0000TRIM\u0000\s*/g, '');
  s = s.replace(/<USER>/gi, simple.user).replace(/<BOT>|<CHAR>/gi, simple.char);
  return s;
}
