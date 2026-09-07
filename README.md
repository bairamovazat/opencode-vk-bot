# opencode-vk-bot

VK bot client for [OpenCode](https://opencode.ai): run and monitor coding
tasks from a VK chat while everything executes locally on your machine.
Send a task as a message — the bot creates/resumes an OpenCode session,
streams live progress, and delivers the final result back to the chat.

This repository is a fork of
[grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot)
ported to VK. The platform-agnostic core (`src/app/`, `src/opencode/`) and
the i18n layer stay close to upstream; the transport is VK-only
(`src/vk/`) using the Bots Long Poll protocol — outbound connections only,
no public endpoint required.

## Features (stage 1)

### Keyboard-first navigation

- **Main menu** (persistent reply keyboard): `🆕 Новая`, `📋 Сессии`,
  `📊 Статус`, `📁 Проекты`, `🤖 Модели`, `⏹ Стоп`, `❓ Помощь` — every
  button equals the corresponding slash command; typed `/commands` keep
  working. The keyboard JSON is reshaped on every action so VK clients
  re-render it and tapped buttons do not stay highlighted.
- **Run view**: while the agent works the keyboard switches to
  `⏹ Стоп / 📊 Статус / 🏠 Меню`; the main view returns with the final
  reply.
- **Inline pickers** for sessions / projects / models (and the project
  choice after «🆕 Новая»): 5 options per page + a nav row
  (`⬅️ Меню / ▶️`, `◀️ / ⬅️ Меню / ▶️`), total count and page indicator in
  the header («Всего: 16 · стр. 2 из 4»). Taps resolve by stored identity
  (session id, project id, provider+model), never by label.
- **Self-deleting menus**: consumed one-shot messages (picker after
  pick/back, previous page after paging, answered questions, resolved
  permission prompts) are removed from the dialog — no dead buttons.

### Run control and live progress

- **Idempotent stop**: «⏹ Стоп» aborts only a session that is actually
  running on the server; otherwise you get «Нет запущенной задачи» —
  pressing it repeatedly never claims to stop something that is not
  running.
- **Live status line** (silent, refreshed ≤ once per 3 s): shows the
  current tool call with compact context (e.g. the file being edited) and
  the action count — so you can see the run is alive and where it is
  heading, and abort early if the model went off track.
- **Notifications**: run-started and progress updates are silent; the
  final answer and run errors notify.

### Sessions and tasks

- Free text at any time becomes an agent prompt: a session is created in
  the current project automatically, or the resumed session is reused.
- Sessions are per-project; switching a project clears the session
  binding; `/new` (and «🆕 Новая») resets the binding and offers the
  project picker when several projects exist.
- Photos and documents are downloaded and passed to the agent as file
  parts (size-capped).
- Agent permission requests and agent questions arrive as inline button
  menus (questions show the full text and step through multi-question
  flows).

### Voice messages

1. If the VK community has **voice transcription** enabled, VK delivers
   the transcript with the message — used directly, zero config.
2. Otherwise a **Whisper-compatible STT endpoint** can be configured (see
   [Configuration](#configuration)); the bot downloads the voice note and
   transcribes it. The transcript is prepended to the prompt as
   `(голосовое сообщение): …` and combined with any typed text.

## Requirements

- Node.js **22.14+** (Linux, macOS, Windows)
- A VK community with **Bot features** enabled and **Bots Long Poll** on
- A community access token with **Manage** + **Messages** scopes
- `opencode serve` reachable locally (default `http://localhost:4096`)

## Quick start

### Linux / macOS

```bash
npm ci
cp .env.example .env   # fill VK_GROUP_TOKEN, VK_GROUP_ID, VK_ALLOWED_USER_ID
npm run build
npm start              # node dist/index.js
```

Or use the bundled helper (starts OpenCode if needed + the bot):

```bash
./start.sh
```

### Windows (PowerShell)

```powershell
npm ci
Copy-Item .env.example .env   # fill in the VK_* values
npm run build
npm start
```

Never commit `.env` — secrets live only on your machine.

## VK community settings checklist

1. Управление → Сообщения → Настройки → **Возможности ботов: включены**
2. Управление → Настройки → Работа с API → **Bots Long Poll: включён**
3. Access token scopes: **Управление сообществом**, **Сообщения сообщества**
4. (Optional, voice) Включите **расшифровку голосовых сообщений** — then
   no external STT is needed.

## Configuration

All configuration lives in `.env` (loaded from the working directory in
source mode).

### Required

| Variable | Description |
| --- | --- |
| `VK_GROUP_TOKEN` | Community access token (Manage + Messages scopes) |
| `VK_GROUP_ID` | Community id **without** the minus sign (positive integer) |
| `VK_ALLOWED_USER_ID` | Your VK user id — the single owner; messages from everyone else are ignored |
| `OPENCODE_MODEL_PROVIDER` / `OPENCODE_MODEL_ID` | Model passed to OpenCode prompts |

### Optional

| Variable | Default | Description |
| --- | --- | --- |
| `OPENCODE_API_URL` | `http://localhost:4096` | OpenCode server URL |
| `BOT_LOCALE` | `en` | UI language: `en ru ar de es fr it ko pt zh` |
| `LOG_LEVEL` | `info` | `debug` logs every update, send and tap |
| `VK_LONG_POLL_WAIT_SEC` | `25` | Long poll hold (5–90) |
| `VK_MAX_ATTACHMENT_MB` | `45` | Download cap per attachment |
| `VK_SELF_TEST` | `false` | **Test-only**: lets the bot process its own `SELFTEST:`-marked messages so flows can be driven without the owner |
| `STT_API_URL` / `STT_API_KEY` | — | Whisper-compatible STT base URL + key (voice input without VK transcripts) |
| `STT_MODEL` | `whisper-large-v3-turbo` | STT model id |
| `STT_LANGUAGE` / `STT_NOTE_PROMPT` / `STT_REQUEST_FORMAT` | — | STT tuning; `STT_REQUEST_FORMAT=json` switches to the base64 `input_audio` body (OpenRouter-style) |

STT provider notes (verified against vendor docs): **Groq** and **OpenAI**
accept VK's `ogg` voice notes directly; **z.ai GLM-ASR** currently accepts
only wav/mp3 and clips at 30 s — it will reject VK voice notes as-is.

## Bot commands

| Command | Action |
| --- | --- |
| `/new` | Reset the session binding; offers the project picker when several projects exist |
| `/sessions` | Recent sessions of the current project (paginated picker) |
| `/projects` | Switch the working project (clears the session binding) |
| `/models` | Switch the model for subsequent prompts |
| `/status` | Project, session, model and busy-state report |
| `/rename <title>` | Rename the current session |
| `/abort`, `/stop` | Stop a running task (idempotent) |
| `/help`, `/start` | Command reference |
| `/menu` | Return to the main keyboard (also the `🏠 Меню` button) |

## Live verification scripts

With a real token in `.env` and the bot built:

```bash
node scripts/vk-live-probe.mjs        # VK accepts all three keyboard shapes
node scripts/vk-live-smoke.mjs 12     # read-only long-poll health check
node scripts/vk-live-selftest.mjs "/help" "📋 Сессии"   # drive real flows (VK_SELF_TEST=1)
```

`vk-live-selftest.mjs` posts `SELFTEST:`-marked messages as the community;
with `VK_SELF_TEST=1` the bot processes them through the real pipeline.
Requires the bot to be running and (for free-text prompts) OpenCode up.

## Development

```bash
npm run build       # tsc
npm run lint        # eslint, zero warnings allowed
npm run typecheck   # tests typecheck
npm test            # vitest: unit + end-to-end flow tests
npm run guard:secrets
```

- **Tests**: `tests/vk/flows.e2e.test.ts` drives every user flow
  (F0–F9) through the real pipeline — raw Long Poll update → normalizer →
  router → pickers → sender — with the VK HTTPS API and the OpenCode SDK
  mocked at the transport boundary, asserting the exact outbound messages
  and keyboards.
- **Spec-driven workflow**: features are specified in `specs/` (see
  `specs/002-keyboard-navigation/spec.md` for the normative flows F0–F10,
  requirements and the live-verified platform facts in `impl-notes.md`).
- **Agent instructions**: `AGENTS.md` (coding rules, reviewer validation,
  workflow); product scope in `PRODUCT.md`.

## Running as a service

For a systemd unit see [`docs/LINUX_SYSTEMD_SETUP.md`](docs/LINUX_SYSTEMD_SETUP.md)
(written for the packaged upstream CLI — adapt the paths for source mode:
`node <repo>/dist/index.js` with `WorkingDirectory=<repo>`). The simplest
setup is `./start.sh`, optionally from `/etc/rc.local`, cron `@reboot`, or
a small user unit.

Logs are written to `logs/bot-YYYY-MM-DD_HH-MM-SS_<pid>.log` in source
mode; each launch gets its own file.

## Security

Public repository: tokens and credentials exist only in your local `.env`
(gitignored). `npm run guard:secrets` scans staged diffs for tokens before
push. See `.specify/memory/constitution.md` (principle III) for the rules
and `specs/001-vk-bot-port/` for the port spec, plan and task breakdown.
