# Contract: Environment Variables (.env)

**Feature**: 001-vk-bot-port | **Date**: 2026-09-06

Public repo (constitution III): real values only in gitignored `.env`;
`.env.example` carries placeholders and docs.

## New: VK transport

| Variable | Req | Default | Meaning |
|---|---|---|---|
| `VK_GROUP_TOKEN` | yes | — | community access token, scope `messages` (+`manage` optional); NEVER committed |
| `VK_GROUP_ID` | yes | — | community id (positive int); checked against every update's `group_id` (D6) |
| `VK_ALLOWED_USER_ID` | yes | — | owner's VK user id; every update's `from_id` MUST match (FR-001) |
| `VK_API_VERSION` | no | `5.199` | API version sent as `v` |
| `VK_LONG_POLL_WAIT_SEC` | no | `25` | `a_check` wait (≤ 90, ≥ 5) |
| `VK_MAX_ATTACHMENT_MB` | no | `45` | incoming/outgoing attachment cap (FR-010) |
| `VK_SELF_TEST` | no | `false` | **Test-only.** When `1`, community-sent messages (`message_reply` from the group itself, text prefixed `SELFTEST:`) are treated as prompts so the transport can be exercised end-to-end without the owner. MUST stay off in production (constitution III) |

## Removed (Telegram layer deleted, D3)

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `TELEGRAM_PROXY_URL`,
`TELEGRAM_API_ROOT`, `TELEGRAM_PROXY_SECRET`, `TELEGRAM_FORCE_IPV4`,
`OPENCODE_TELEGRAM_CONTAINER`.

`OPENCODE_TELEGRAM_CONTAINER` is renamed `OPENCODE_IN_CONTAINER` (same
docker-compose semantics).

## Unchanged (shared layers reuse as-is)

`OPENCODE_API_URL`, `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`,
`OPENCODE_AUTO_RESTART_ENABLED`, `OPENCODE_MONITOR_INTERVAL_SEC`,
`OPENCODE_MODEL_PROVIDER`, `OPENCODE_MODEL_ID`, `LOG_LEVEL`,
`LOG_RETENTION`, `SESSIONS_LIST_LIMIT`, `MESSAGES_LIST_LIMIT`,
`PROJECTS_LIST_LIMIT`, `PROJECTS_EXCLUDED_PATHS`, `MODELS_LIST_LIMIT`,
`TASK_LIMIT`, `SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES`,
`SCHEDULED_TASK_DISABLE_NOTIFICATION`, `BASH_TOOL_DISPLAY_MAX_LENGTH`,
`BOT_LOCALE` (must be `ru` for first release; other locales compile but
are unmaintained), `TRACK_BACKGROUND_SESSIONS`, `MESSAGE_FORMAT_MODE`
(only `raw` is honored by the VK renderer; `markdown` falls back to raw
with a startup warning), `MESSAGE_MERGE_WINDOW_MS`,
`INITIAL_SETTINGS_PRESET`, `OPEN_BROWSER_ROOTS`, `CODE_FILE_MAX_SIZE_KB`,
`STT_*`, `DOC_EXTRACTOR_*`, `TTS_*` (kept for deferred features; unused
code paths are not ported until their phase).

## Startup validation (fail fast, mirroring upstream config style)

Missing `VK_GROUP_TOKEN` / `VK_GROUP_ID` / `VK_ALLOWED_USER_ID` → abort
with named-variable error. `BOT_LOCALE` missing → defaults `ru` (fork
default; upstream default was `en`).
