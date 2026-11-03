// Phase 1 prompt builder (Chat Completion). Phase 2 replaces the fixed order
// below with the Prompt Manager (preset prompt_order, toggles, injections),
// World Info and Regex — the same pipeline SillyTavern uses.
import { substitute } from './macros.js';

/** Rough token estimate (~3.6 chars/token for English prose). Good enough for trimming. */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 3.6) + 3;
}

function exampleBlocks(mesExample) {
  if (!mesExample?.trim()) return [];
  return mesExample.split(/<START>/i).map((b) => b.trim()).filter(Boolean);
}

/**
 * mode: 'normal' | 'swipe' | 'continue' | 'impersonate'
 * history: full message objects (ST format) in order, already excluding the one being swiped.
 */
export function buildPrompt({ card, persona, userName, settings, history, mode = 'normal', vars = {}, model = '' }) {
  const p = settings.prompts;
  const gen = settings.gen;
  const charName = card.name;
  const ctx = { char: charName, user: userName, card, persona: persona?.description || '', chat: history, vars, seed: charName, model };
  const sub = (t) => substitute(t, ctx);

  const head = [];
  const main = card.system_prompt?.trim() ? card.system_prompt.replace(/\{\{original\}\}/gi, p.main) : p.main;
  if (main.trim()) head.push({ role: 'system', content: sub(main) });
  const charBits = [
    card.description && sub(card.description),
    card.personality && `${charName}'s personality: ${sub(card.personality)}`,
    card.scenario && `Scenario: ${sub(card.scenario)}`,
  ].filter(Boolean);
  if (charBits.length) head.push({ role: 'system', content: charBits.join('\n\n') });
  if (persona?.description?.trim()) head.push({ role: 'system', content: sub(persona.description) });
  for (const block of exampleBlocks(card.mes_example)) head.push({ role: 'system', content: `[Example Chat]\n${sub(block)}` });

  const tail = [];
  const post = card.post_history_instructions?.trim() ? card.post_history_instructions.replace(/\{\{original\}\}/gi, p.post) : p.post;
  if (mode === 'continue') tail.push({ role: 'system', content: sub(p.continue) });
  else if (mode === 'impersonate') tail.push({ role: 'system', content: sub(p.impersonate) });
  if (post?.trim() && mode !== 'impersonate') tail.push({ role: 'system', content: sub(post) });

  // Fit history into the context window, newest first.
  const budget = Math.max(512, (gen.context || 8192) - (gen.max_tokens || 400));
  let used = [...head, ...tail].reduce((n, m) => n + estimateTokens(m.content), 0);
  const chat = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.is_system || m.extra?.hidden) continue;
    const content = sub(m.mes || '');
    const cost = estimateTokens(content);
    if (used + cost > budget && chat.length) break;
    used += cost;
    chat.unshift({ role: m.is_user ? 'user' : 'assistant', content });
  }
  chat.unshift({ role: 'system', content: '[Start a new Chat]' }); // SillyTavern's default "new chat" marker

  const messages = [...head, ...chat, ...tail];
  return { messages, tokens: used };
}

/** Request body for an OpenAI-compatible endpoint. */
export function requestBody(settings, messages, model) {
  const g = settings.gen;
  const body = {
    messages, model: model || undefined, stream: !!g.stream,
    temperature: Number(g.temperature), top_p: Number(g.top_p), max_tokens: Number(g.max_tokens),
  };
  if (Number(g.frequency_penalty)) body.frequency_penalty = Number(g.frequency_penalty);
  if (Number(g.presence_penalty)) body.presence_penalty = Number(g.presence_penalty);
  if (g.reasoning_effort) body.reasoning = { effort: g.reasoning_effort };
  return body;
}
