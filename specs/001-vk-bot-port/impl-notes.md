# Implementation Notes: vk-bot-port

## 2026-09-06 — Live E2E validation (US1 core loop)

Environment: WSL2, Node v22.23.2 (nvm), `opencode serve` on :4096
(v1.18.29), community id 100081755, model `zai-coding-plan/glm-5.3-flash`.

Setup steps performed:

1. `uv` + `specify-cli 1.0.4` installed (spec-kit workflow).
2. VK community token placed OUTSIDE the repo (`~/.env-vk`); project `.env`
   is generated from it and stays gitignored (constitution III).
3. Token scopes required: **Управление сообществом (manage)** — without it
   `groups.getLongPollServer` returns error 15; **Сообщения сообщества**.
4. Community settings → Работа с API → **Bots Long Poll: включено**;
   message types: Входящее сообщение + Действие с сообщением are enough.

Defects found and fixed during live bring-up:

- `runCollector.begin()` awaited `subscribeToEvents`, which is a
  long-running SSE listener → handler froze after session creation.
  Fixed: fire-and-forget with error logging.
- User-message echo leaked into the assembled reply → collector now tracks
  message roles via `message.updated` and drops user parts.
- Reasoning deltas leaked into the reply → delta events are accepted only
  for parts proven to be `text` (knownTextParts registry, mirrors upstream).

Self-test harness (owner-requested, so testing works without the owner):

- `VK_SELF_TEST=1` in `.env`; messages sent BY the community with the
  `SELFTEST:` prefix are treated as prompts (`message_reply` → synthetic
  message). Loop-guarded by the marker; MUST be disabled in production.

Verified E2E (via SELFTEST messages):

- text prompt → agent run → clean final reply delivered to the dialog
  (no echo, no reasoning, correct length).
- messages.send delivery path verified (bot → owner dialog).

Voice input (US8): implemented — VK `audio_message.transcript` is used
when present (`transcript_state=done`), otherwise falls back to a
Whisper-compatible endpoint (`STT_API_URL`/`STT_API_KEY`), otherwise a
clear i18n notice is sent. Live voice test awaits the owner's voice
message; unit tests cover transcript and unconfigured branches.

Still pending (tasks.md): US2 status/abort, US3 buttons, US4–US7, cleanup
phases (Telegram layer removal, metadata, secrets gate), T048 locale
default, T049/T050 full manual pass and final gates.
