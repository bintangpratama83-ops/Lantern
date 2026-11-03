# Lantern

A lightweight roleplay chat frontend. It reads and writes the same files as SillyTavern
(character cards, chats, presets, lorebooks), so you can move between the two freely.

**Version 0.1 — Phase 0 + Phase 1** (foundation + daily-driver chat). See `docs/PLAN.md` for the roadmap.

## Run it

You only need **Node.js 18 or newer**. There is no `npm install` — Lantern has zero dependencies.

**Windows:** double-click `Start.bat`, then open http://localhost:8000

**Linux / macOS:** `./start.sh`, then open http://localhost:8000

**Android (Termux):**
```sh
pkg install nodejs-lts        # once
cd ~/lantern                  # wherever you unzipped it
./start.sh
```
Open http://localhost:8000 in Chrome, then menu → **Add to Home screen** so it opens like an app.

**Phone using your laptop's Lantern over Wi-Fi:**
1. Copy `config.example.json` to `config.json` and set a `"password"`.
2. Start with `./start.sh --lan` (or `node server/server.js --lan`). The console prints the LAN address.
3. Open that address on the phone and sign in with any user name + your password.
Connections from public internet addresses are blocked by default. Tailscale addresses (100.64.x.x) work.

Other flags: `--port=8001`, `--host=0.0.0.0`.

## First steps

1. **Settings → Import from SillyTavern.** Point it at your SillyTavern folder (the one with `server.js`)
   or `data/default-user`. On Termux that is usually `~/SillyTavern`. Lantern copies files; SillyTavern is not changed.
2. **Connections → Add connection.** OpenRouter, NanoGPT, any OpenAI-compatible URL, or local KoboldCpp / llama.cpp.
   Press **Load models**, pick one, save.
3. **Personas → New persona** (optional) — your name and description in the story.
4. Open a character and chat.

## What's in this version

- Character browser: instant search, tag chips, favourites, sort by recent chats, PNG/JSON import, export, duplicate, delete (to trash).
- Card editor: all fields, alternate greetings, portrait change, token estimates. Embedded lorebooks and regex are kept.
- Chat: streaming, swipes (arrows or swipe gesture on phone), regenerate, continue, impersonate, edit, copy, delete,
  branch, multiple chats per character, rename, download/import `.jsonl`, reasoning/thinking blocks.
- Message formatting like SillyTavern: *narration*, "dialogue", HTML/CSS panels from presets (sanitised, styles kept inside the message area).
- Personas with portraits.
- **Image viewer:** tap or click anywhere outside the picture to close. Also Esc, swipe down, the phone back button, or ✕.
  It sits above the top bar and phone notch, so nothing is cut off. Pinch / double-tap / scroll to zoom.
- Installable app (PWA) with offline app shell (on `localhost`; browsers only allow this on secure origins).

## Why it's fast

- The character list is a small cached index. Card text loads only when you open that character.
- Portraits are shown as ~10–20 KB WebP thumbnails, made once and cached forever. The full image loads only in the viewer.
- Chats open on the latest 50 messages; older ones load as you scroll up. A 3,000-message chat opens in ~0.2 s.
- The first page load is about 23 KB (gzipped). Other screens load only when opened.

## Your data

Everything lives in `data/` using SillyTavern's folder names (`characters/`, `chats/`, `User Avatars/`, `worlds/`, `OpenAI Settings/`).
API keys are stored in `data/secrets.json` and never sent to the browser. Deleted items go to `data/_trash/`.
Lantern-only files: `lantern-settings.json`, `personas.json`, `regex.json`, `_index/`, `thumbnails/`.

To update Lantern later, replace everything **except** `data/` and `config.json`.

## Not yet (coming in later phases)

- Phase 2: Chat Completion presets with Prompt Manager (your FF / Eclipse Forge / Chimera presets), regex scripts, World Info / lorebooks, Author's Note, prompt inspector.
- Phase 3: Text Completion + instruct templates, group chats, checkpoints, bookmarks, chat search, backups.
- Phase 4: summaries, Quick Replies, STscript subset, TTS, image generation, translation, plugins.

SillyTavern third-party extensions do not run in Lantern (they depend on SillyTavern's internal page code).

## Credits

Lantern is an independent project **inspired by [SillyTavern](https://github.com/SillyTavern/SillyTavern)**.
It is not a fork, contains no SillyTavern code, and is not affiliated with or endorsed by the SillyTavern team.
It reads and writes SillyTavern's file formats (character cards, `.jsonl` chats, presets, lorebooks) so your
library works in both apps. Thank you to the SillyTavern developers and community for the app that made this possible.

- Character Card V2 spec by malfoyslastname, V3 spec by kwaroran.
- Built with the help of Claude (Anthropic).

## Licence

GNU AGPL-3.0 — the same licence as SillyTavern. Copyright © 2026 Bintang.
