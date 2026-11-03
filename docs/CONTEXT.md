# CONTEXT — Lantern

> Living context file. Read this first in any new session working on this project.
> Update "Status" and "Decision log" whenever something changes.

## What this is
A new, lightweight roleplay frontend inspired by SillyTavern (https://github.com/SillyTavern/SillyTavern, AGPL-3.0).
Owner: Bintang. Runs locally on laptop and on Android (Termux) or via LAN/Tailscale from the phone.
Main use: immersive RP with heavy Chat Completion presets (Freaky Frankenstein 5.x/6.x, Eclipse Forge R6.x, Chimera RP, Aetheris Chimera) plus regex bundles and lorebooks (Acoustic & Onomatopoeia Lorebook). These presets output HTML/CSS HUD panels, so HTML-in-message rendering must match SillyTavern.

## Non-negotiables
1. **Performance first on phone.** Never send all card data to the client; never render a whole chat; never load features that aren't open.
2. **File compatibility with SillyTavern.** Cards, chats, presets, lorebooks, regex must round-trip.
3. **Prompt parity.** Same inputs → same final prompt as SillyTavern for CC presets (verify with Prompt inspector).
4. **Avatar/image viewer:** closes on tap/click outside the image, Esc, swipe-down, Android back; sits above all UI incl. top bar; respects safe-area insets.
5. **No native npm dependencies** (Termux must install without compiling).

## Stack (decided 2026-11-03)
- **Zero dependencies, no build step.** Server: plain Node.js 18+ (`node:http`, `zlib`, `fetch`). Frontend: plain ES modules + a tiny `el()` DOM helper. Termux runs it with no `npm install`.
- Panels/views load on demand with dynamic `import()`. First load ≈ 23 KB gzipped.
- Markdown: own renderer (`web/js/lib/markdown.js`) mimicking ST display (`*em*`, `"<q>"`, raw HTML blocks kept, newlines → `<br>`). Sanitiser: `web/js/lib/sanitize.js` (drops scripts/handlers/js: URLs; `<style>` scoped to `.mes-text`; `:root/html/body` rules dropped).
- Lists: chat loads 50 messages, renders 30, pages older on scroll; `content-visibility: auto` on messages and tiles.
- Thumbnails: browser makes WebP (JPEG on Safari) via canvas → `PUT /img/thumb/:kind/:file?v=<iv>`; `iv` = image version from IDAT CRC, so editing card text keeps the thumbnail.
- Prompt engine (macros, prompt assembly) runs client-side. Server only adds the API key and streams.

## Code map
- `server/server.js` routes · `lib/png.js` PNG chunks · `lib/characters.js` index/cards/thumbs · `lib/chats.js` JSONL paging + ops · `lib/settings.js` settings/profiles/secrets/personas · `lib/proxy.js` AI pass-through · `lib/importer.js` ST import
- `web/js/app.js` shell/router · `views/` characters, chat, editor, personas, connections, settings · `engine/` macros, prompt, generate · `ui/` viewer, overlays · `lib/` dom, api, state, thumbs, markdown, sanitize, icons
- Chat writes are ops (`append/set/delete/truncate/header`) on 0-based message indices, applied server-side atomically.

## SillyTavern formats (verify against repo source in Phase 0)

**Data folder (`data/default-user/`):** `characters/*.png`, `chats/<character>/*.jsonl`, `group chats/`, `groups/`, `worlds/*.json`, `OpenAI Settings/*.json` (CC presets), `TextGen Settings/`, `instruct/`, `context/`, `sysprompt/`, `reasoning/`, `themes/`, `backgrounds/`, `User Avatars/`, `thumbnails/`, `QuickReplies/`, `settings.json`, `secrets.json`.

**Character card:** PNG `tEXt` chunk `chara` = base64 JSON (`spec: "chara_card_v2"`, `data: {name, description, personality, scenario, first_mes, mes_example, creator_notes, system_prompt, post_history_instructions, alternate_greetings, character_book, tags, creator, character_version, extensions}`). V3 uses chunk `ccv3`, `spec: "chara_card_v3"` (adds assets, nickname, group_only_greetings, creation/modification dates…). Write both chunks on export.

**Chat JSONL:** line 1 = header (`user_name`, `character_name`, `create_date`, `chat_metadata`). Following lines = messages (`name`, `is_user`, `is_system`, `send_date`, `mes`, `swipes`, `swipe_id`, `swipe_info`, `extra` incl. `reasoning`).

**Regex script:** `id, scriptName, findRegex, replaceString, trimStrings[], placement[] (1 user input, 2 AI output, 3 slash cmd, 5 world info, 6 reasoning), disabled, markdownOnly, promptOnly, runOnEdit, substituteRegex, minDepth, maxDepth`. Scopes: global (settings.json → extension_settings.regex), preset-bound (preset extensions), character-bound (card data.extensions.regex_scripts).

**CC preset:** `prompts[]` (`identifier, name, role, content, system_prompt, marker, injection_position, injection_depth, injection_order, forbid_overrides`), `prompt_order[]` (per `character_id`, list of `{identifier, enabled}`), sampler fields, `extensions`.

## Out of scope
- Running SillyTavern third-party extensions unchanged (they rely on ST's DOM/jQuery globals). Lantern gets its own plugin API instead.
- Full STscript (common subset only, Phase 4).

## Status
- [x] Plan written (PLAN.md)
- [x] Decisions (2026-11-03): name **Lantern**; own data folder + one-click import from ST; providers OpenRouter, NanoGPT, custom OpenAI-compatible, local KoboldCpp/llama.cpp (via their OpenAI-compatible endpoints in Phase 1, full Text Completion + instruct templates in Phase 3); build phase by phase, testing on laptop + phone between phases
- [x] Phase 0 — Foundation (v0.1)
- [x] Phase 1 — Daily driver (v0.1) — awaiting Bintang's laptop + phone test
- [ ] Phase 2 — Preset workflow (FF / EF / Chimera parity test)
- [ ] Phase 3 — Power features
- [ ] Phase 4 — Extras

## Decision log
- 2026-11-03 — Plan drafted. Server + browser architecture (server needed for CORS, keys, files). Licence recommendation: AGPL-3.0 so ST logic can be ported for parity.
- 2026-11-03 — Stack changed to zero-dependency vanilla JS (workspace couldn't reach npm; also lighter for Termux). Proxy covers OpenRouter, NanoGPT, custom OpenAI-compatible, KoboldCpp/llama.cpp via /v1.
- 2026-11-03 — v0.1 built and tested headless (laptop 1280×800, phone 390×844): viewer closes on outside tap / Esc / back / swipe-down; 3,000-message chat opens in ~0.2 s; long-press sheet, swipes, streaming, reasoning OK.

## Known gaps / next (Phase 2 start)
- Prompt Manager (CC preset import with prompt_order, toggles, injection depth), regex engine (`data/regex.json` already imported), World Info, Author's Note, prompt inspector UI (`window.__lanternLastPrompt` holds the last prompt for now).
- Per-message id uniquifying for HTML HUD checkbox/label toggles (same issue exists in ST).
- Group chats copied on import but not shown yet.

- 2026-11-03 — v0.1.1: NanoGPT model list returned only auto-model for Bintang; Lantern now merges NanoGPT all/personalized/subscription/paid lists, shows per-list counts, and uses a searchable picker instead of <datalist>.
- 2026-11-03 — v0.1.2: checked endpoints against official docs. NanoGPT chat now uses api.nano-gpt.com (docs recommend it for API-key chat; model lists stay on nano-gpt.com). llama.cpp default port 9931 per current server README. OpenRouter title header X-OpenRouter-Title. Real providers still untested from the workspace (blocked); mock-tested only.
