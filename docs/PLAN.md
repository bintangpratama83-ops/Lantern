# Build Plan — Lantern

> A lightweight, mobile-first roleplay frontend that reads the same files SillyTavern does
> (cards, chats, presets, lorebooks, regex), with the slow parts redesigned.
> Name confirmed: **Lantern**. Stack updated 2026-11-03: zero dependencies (see CONTEXT.md).

---

## 1. Goals

1. **Fast on a phone.** Open the app, the character list and a long chat in about a second, even with hundreds of cards, over Termux or LAN.
2. **SillyTavern parity where it matters for RP.** Your FF / Eclipse Forge / Chimera presets, regex bundles and lorebooks must import and behave the same.
3. **Clean, new interface.** Not a reskin of SillyTavern's drawer layout; one consistent design for laptop and phone.
4. **Fix the known annoyances**, starting with the avatar viewer.

## 2. Why SillyTavern feels heavy (what we design around)

| Problem in SillyTavern | Cause | What Lantern does instead |
|---|---|---|
| Slow character list on start | Server reads every character PNG and sends the full card text of **every** character to the browser at startup | Server keeps a small **index file** (name, tags, favourite, thumbnail id, modified time). Only changed files are re-read. The full card loads only when you open that character |
| Slow avatar / card images | Large PNGs (often 1–5 MB) loaded in lists; thumbnails are made by the server with an image library | **WebP thumbnails** (small + medium size) cached forever with strong browser caching. Full image loads only in the viewer. Thumbnails are generated in the browser (canvas), so no native image library needed — Termux install stays simple |
| Slow page load | One giant HTML page with every panel built at once, jQuery, plus every extension script loaded at start | Small app shell (target < 150 KB gzipped). Each panel (Lorebook editor, Prompt Manager, Settings…) loads only when opened |
| Long chats lag, especially on phone | Whole chat file parsed and many messages rendered at once; markdown re-rendered often | Load the **last 50 messages**, fetch older ones as you scroll up. Only messages on screen exist in the page (virtual list). Markdown rendered once per message and cached |
| Streaming makes the page stutter | Re-render on every token | Re-render at most once per animation frame |
| Reloading the page on phone is slow | Nothing cached | **Installable app (PWA)** with an offline app shell, so reopen is near-instant |
| Heavy install on Termux | Many dependencies, some native | Few pure-JavaScript dependencies; no compiling on the phone |

## 3. Avatar viewer fix (built in Phase 1)

- Full-screen dark backdrop **above everything** (including the top bar), so nothing gets cut off.
- Image fits inside the screen with safe margins for the phone notch / status bar.
- **Tap or click anywhere outside the image → closes.**
- Also closes with: **Esc** key, **swipe down** on phone, and the **Android back button** (back closes the viewer instead of leaving the page).
- The ✕ button is still there, but placed inside the safe area so it's always reachable.
- Pinch / double-tap to zoom on phone, scroll-wheel zoom on laptop.
- Same viewer used for character avatars, persona avatars and images inside messages.

## 4. Architecture

```
lantern/
├─ server/            Small Node.js server (Node 20+, works in Termux)
│  ├─ api/            characters, chats, presets, worlds, regex, settings, proxy
│  ├─ formats/        PNG card read/write (V2 + V3), chat JSONL, preset JSON
│  └─ index/          character index cache + thumbnail cache
├─ web/               Frontend (plain ES modules, no build step — see CONTEXT.md)
│  ├─ app/            shell, router, layout, theme
│  ├─ features/       characters, chat, presets, lorebook, regex, personas, groups…
│  ├─ engine/         prompt builder, macros, world-info scanner, regex runner, tokenizer
│  └─ ui/             shared components (virtual list, modal, image viewer, toasts)
├─ data/              Your data — same folder layout as SillyTavern's data/default-user
└─ docs/CONTEXT.md    Living context file (decisions, formats, status)
```

**Why a server at all (instead of a pure browser app):** most AI providers block direct browser requests (CORS), API keys are safer on the server, and files on disk are easier to back up and share with SillyTavern. The server is just files + a pass-through to the AI API, so it stays light.

**How you run it**
- Laptop: `npm install` once, then `npm start` → open `http://localhost:8000`.
- Phone: same commands in Termux (same as you run SillyTavern now), **or** open your laptop's server from the phone over Wi-Fi / Tailscale.
- Phone home screen: "Add to Home screen" → opens like a normal app.

**Prompt engine runs in the browser** (like SillyTavern), so you can see the exact final prompt before it's sent ("Prompt inspector").

## 5. SillyTavern compatibility

| Item | Compatibility |
|---|---|
| Character cards (PNG / JSON, V2 + V3, embedded lorebook, alt greetings, character regex) | Read + write, exports open in SillyTavern |
| Chats (`.jsonl`, swipes, reasoning, metadata) | Read + write same format |
| Chat Completion presets (prompt list, order, toggles, injection depth/position, samplers, preset-bound regex) | Import + export; FF / EF / Chimera are the test cases |
| Regex scripts (global, preset, character; placement, depth limits, markdown-only / prompt-only, trim strings, macro substitution) | Same behaviour |
| World Info / lorebooks (keys, secondary-key logic, recursion, scan depth, positions incl. @depth, order, probability, sticky / cooldown / delay, inclusion groups) | Same behaviour |
| Macros (`{{char}}`, `{{user}}`, `{{random}}`, `{{pick}}`, `{{roll}}`, `{{getvar}}/{{setvar}}`, `{{// }}`, `{{trim}}`, time/date…) | Same behaviour |
| HTML in messages (for HUD / Internal States panels, styled dialogue) | Rendered like SillyTavern (sanitised, `<style>` allowed) |
| Personas, Author's Note, group chats, instruct/context templates | Supported (see phases) |
| **Third-party SillyTavern extensions** | **Not compatible.** They depend on SillyTavern's internal page structure and code. Lantern gets its own small plugin system; extensions you care about (e.g. your Spider Walk idea) can be rebuilt on it |
| STscript slash commands | Common subset only (Phase 4) |

One-click **"Import from SillyTavern folder"** copies cards, chats, presets, lorebooks, regex, personas and settings.

## 6. Interface overview

- **Laptop:** left rail (Characters / Chats / Lorebooks / Presets / Settings), chat in the centre, a right panel that slides in for the open tool (card editor, preset, lorebook, prompt inspector). Panels never stack on top of each other.
- **Phone:** bottom tab bar + full-screen sheets that close with swipe-down or back button. Thumb-reachable send / swipe / regenerate controls. Input bar respects the on-screen keyboard (no jumping).
- **Character browser:** grid or list, search as you type, tags, favourites, folders, sort by recent chat.
- **Chat:** clean message cards, swipe left/right between swipes, long-press (phone) or hover (laptop) message menu: edit, copy, delete, branch, regenerate, continue, hide-from-prompt. Collapsible reasoning/thinking blocks. Token count per message.
- **Themes:** dark/light + accent colour + font size + chat width; custom CSS box for power users.

## 7. Phases

Each phase ends with something you can run and test. Phase order follows how much you use each feature.

**Phase 0 — Foundation** (scaffold + data)
- Project setup, server, data folder layout, PNG card reader/writer (V2/V3), chat JSONL, character index + thumbnail cache, SillyTavern import.
- Verify formats against the SillyTavern repo source.

**Phase 1 — Usable daily driver**
- Character browser (virtual grid, search, tags, favourites), card import/export, card editor.
- Chat: streaming, swipes, regenerate, continue, impersonate, edit/delete, multiple chats per character, alternate greetings.
- Personas.
- Chat Completion connections: OpenAI-compatible (custom URL), OpenRouter, NanoGPT, Claude, Gemini, DeepSeek; saved connection profiles.
- Avatar viewer fix, PWA, mobile layout.

**Phase 2 — Your preset workflow**
- Prompt Manager (import/export CC presets, toggle groups, drag order, injection depth/position).
- Macros, Regex (all three scopes), World Info / lorebooks with full editor, Author's Note.
- HTML/CSS message rendering for HUD-style output.
- Prompt inspector (see the exact final prompt + token counts).
- Acceptance test: FF 5.4.x, Eclipse Forge R6.x, Chimera RP + their regex bundles + Acoustic Lorebook produce the same final prompt as SillyTavern.

**Phase 3 — Power features**
- Text Completion (KoboldCpp, llama.cpp, Ooba, TabbyAPI) + instruct / context / system-prompt templates + samplers.
- Group chats. Branches / checkpoints. Bookmarks. Reasoning templates. Chat search.
- Backups + export all.

**Phase 4 — Extras**
- Summarize / memory, Quick Replies, STscript subset, TTS, image generation, auto-translate, vector memory.
- Plugin system (rebuilt Spider Walk as first plugin, if wanted).

## 8. Performance targets (checked each phase)

| Measure | Target |
|---|---|
| App shell download | < 150 KB gzipped |
| Character list visible (500 cards, phone, warm cache) | < 1 s |
| Open a 2,000-message chat | < 1 s to show the latest messages |
| Server memory at idle | < 80 MB |
| Termux install | no native compilation |

## 9. Licence note

SillyTavern is **AGPL-3.0**. Reading the same file formats is fine under any licence. To keep behaviour identical (World Info scanning, macros, prompt ordering), it's easiest to port some of SillyTavern's logic directly — in that case Lantern must also be **AGPL-3.0** (free to use and share; if published, source must be shared too). Recommended: license Lantern as AGPL-3.0 from day one.

## 10. Decisions needed before building

1. **Name** for the app.
2. **Data:** own data folder + one-click import from SillyTavern (recommended), or read/write SillyTavern's folder directly.
3. **Which AI providers** you actually use (sets Phase 1 order).
4. **Pace:** phase by phase with testing between (recommended), or build everything before testing.
