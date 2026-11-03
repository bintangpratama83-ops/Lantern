// Pass-through to OpenAI-compatible chat completion APIs.
// The browser builds the prompt; the server adds the key and streams the reply back.
import { resolveProfile } from './settings.js';
import { HttpError } from './store.js';

function headersFor(p) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (p.key) h.Authorization = `Bearer ${p.key}`;
  if (p.type === 'openrouter') { h['HTTP-Referer'] = 'http://localhost'; h['X-Title'] = 'Lantern'; }
  for (const [k, v] of Object.entries(p.headers || {})) if (k && typeof v === 'string') h[k] = v;
  return h;
}

function parseModels(j) {
  const arr = Array.isArray(j) ? j : j.data || j.models || [];
  return arr.map((m) => (typeof m === 'string' ? { id: m, name: m } : {
    id: m.id || m.name, name: m.name || m.id,
    context: m.context_length || m.context_window || m.top_provider?.context_length || null,
  })).filter((m) => m.id);
}

async function fetchModelList(url, p) {
  const headers = headersFor(p);
  if (p.key) headers['x-api-key'] = p.key; // NanoGPT accepts either header
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  if (!r.ok) throw new HttpError(r.status, `Model list failed (${r.status}): ${text.slice(0, 300)}`);
  try { return parseModels(JSON.parse(text)); } catch { throw new HttpError(502, 'Model list was not JSON'); }
}

/**
 * Returns { models, sources }. Some providers filter their main list per account
 * (NanoGPT hides models depending on subscription settings), so for NanoGPT we ask
 * every list it offers and merge them.
 */
export async function listModels(profileId) {
  const p = resolveProfile(profileId);
  let lists = [{ label: 'models', url: `${p.baseUrl}/models` }];
  if (p.type === 'nanogpt' || /nano-gpt\.com/i.test(p.baseUrl)) {
    const origin = p.baseUrl.replace(/\/api(\/[a-z]+)?\/v1$/i, '');
    lists = [
      { label: 'all', url: `${origin}/api/v1/models?detailed=true` },
      { label: 'your visible', url: `${origin}/api/personalized/v1/models?detailed=true` },
      { label: 'subscription', url: `${origin}/api/subscription/v1/models?detailed=true` },
      { label: 'paid', url: `${origin}/api/paid/v1/models?detailed=true` },
    ];
  }
  const results = await Promise.allSettled(lists.map((l) => fetchModelList(l.url, p)));
  const byId = new Map();
  const sources = results.map((r, i) => {
    if (r.status === 'rejected') return { label: lists[i].label, error: r.reason.message };
    for (const m of r.value) if (!byId.has(m.id) || (!byId.get(m.id).context && m.context)) byId.set(m.id, m);
    return { label: lists[i].label, count: r.value.length };
  });
  if (!byId.size && results.every((r) => r.status === 'rejected')) throw results[0].reason;
  const models = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  console.log(`[models] ${p.name}: ${sources.map((s) => `${s.label}=${s.error ? 'error' : s.count}`).join(', ')}`);
  return { models, sources };
}

/** Streams the upstream response straight into `res`. Aborts upstream if the browser disconnects. */
export async function generate(req, res, payload) {
  const p = resolveProfile(payload.profileId);
  const body = { ...payload.body };
  if (!body.model) body.model = p.model;
  if (!body.model && (p.type === 'openrouter' || p.type === 'nanogpt')) throw new HttpError(400, 'Pick a model for this connection first');
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
  let up;
  try {
    up = await fetch(`${p.baseUrl}/chat/completions`, { method: 'POST', headers: headersFor(p), body: JSON.stringify(body), signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) return res.end();
    throw new HttpError(502, `Could not reach ${p.baseUrl}: ${e.cause?.code || e.message}`);
  }
  if (!up.ok) {
    const text = await up.text().catch(() => '');
    let msg = text;
    try { const j = JSON.parse(text); msg = j.error?.message || j.message || j.detail || text; } catch { /* plain text */ }
    throw new HttpError(up.status, `${p.name}: ${String(msg).slice(0, 600)}`);
  }
  res.writeHead(200, {
    'Content-Type': up.headers.get('content-type') || 'application/json',
    'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no',
  });
  try {
    for await (const chunk of up.body) res.write(chunk);
  } catch { /* client or upstream aborted */ }
  res.end();
}
