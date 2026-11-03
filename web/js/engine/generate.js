// Sends a request through the server proxy and parses streaming (SSE) or plain JSON replies.
// Handles reasoning from OpenRouter (`reasoning`), DeepSeek/GLM (`reasoning_content`)
// and inline <think>…</think> blocks.

export async function generate({ profileId, body, signal, onUpdate }) {
  const res = await fetch('/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, body }), signal,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = (await res.json()).error || msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  let text = '', reasoning = '';
  const started = performance.now();
  let reasoningMs = 0;
  const push = () => onUpdate?.(split(text, reasoning));

  const ctype = res.headers.get('content-type') || '';
  if (!body.stream || !ctype.includes('event-stream')) {
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    const msg = j.choices?.[0]?.message || {};
    text = msg.content ?? j.choices?.[0]?.text ?? '';
    reasoning = msg.reasoning || msg.reasoning_content || '';
    push();
    return { ...split(text, reasoning), reasoningMs: 0, finish: j.choices?.[0]?.finish_reason };
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', finish = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
        const ch = j.choices?.[0];
        if (!ch) continue;
        const d = ch.delta || ch.message || {};
        const r = d.reasoning ?? d.reasoning_content ?? '';
        if (r) { reasoning += r; reasoningMs = performance.now() - started; }
        if (d.content) text += d.content;
        else if (typeof ch.text === 'string') text += ch.text;
        if (ch.finish_reason) finish = ch.finish_reason;
        push();
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') return { ...split(text, reasoning), reasoningMs, aborted: true };
    throw e;
  }
  return { ...split(text, reasoning), reasoningMs, finish };
}

/** Move a leading <think>…</think> block into reasoning. */
function split(text, reasoning) {
  const m = text.match(/^\s*<think(?:ing)?>([\s\S]*?)(<\/think(?:ing)?>|$)/i);
  if (m) {
    const closed = !!m[2];
    return { text: closed ? text.slice(m[0].length).replace(/^\s+/, '') : '', reasoning: (reasoning + m[1]).trim(), thinking: !closed };
  }
  return { text, reasoning: reasoning.trim(), thinking: !!reasoning && !text };
}
