# Implementation Plan: VK Bot Port of opencode-telegram-bot

**Branch**: `001-vk-bot-port` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-vk-bot-port/spec.md`

## Summary

Port the repository from a Telegram client for OpenCode to a VK client.
Keep the platform-agnostic core (`src/app/`, `src/opencode/`) and the i18n
layer; replace the Telegram transport (`src/bot/`, grammY) with a VK
transport (`src/vk/`) built directly on the VK HTTPS API using the Bots
Long Poll protocol (no third-party VK SDK). Single-owner, Russian-first,
outbound-only connectivity.

## Technical Context

**Language/Version**: TypeScript 5.x strict, ESM, Node.js 22.14+ (matches
upstream `engines` field)

**Primary Dependencies**: unchanged upstream set except: removed —
`grammy`, `@grammyjs/menu` (Telegram-only), `node-fetch`, `ws`,
`https-proxy-agent`, `socks-proxy-agent` (Telegram networking; replaced by
native `fetch`/`FormData`/`WebSocket`); kept — `@opencode-ai/sdk`,
`better-sqlite3`, `dotenv`, `remark-*`/`unified` (markdown parsing shared
by render pipeline), `@google-cloud/text-to-speech` (deferred-feature dep,
kept to avoid churn in shared layer). No VK SDK added.

**Storage**: unchanged — `better-sqlite3` for scheduled-task store and
caches, `settings.json` for persisted preferences (both live in shared
layers and are reused as-is).

**Testing**: Vitest (upstream config, `vi.mock()` boundaries, AAA style)

**Target Platform**: local machine next to `opencode serve` (Linux/WSL and
Windows); outbound-only network access; single process CLI daemon
(`npm start` → `dist/index.js`).

**Performance Goals**: first progress indicator ≤ 2 s from idle (SC-001);
status refresh ≤ 1 per 3 s (FR-004); well within VK rate budget of ~20
requests/s for a single-owner bot.

**Constraints**: VK hard limits — outgoing message text ≤ 4096 chars;
keyboard JSON kept ≤ 1000 bytes with ≤ 10 buttons (conservative, inside
all documented variants); button payload string ≤ 255 bytes (verified by
integration test); Bots Long Poll `wait` ≤ 90 s (we use 25 s for snappy
shutdown); secrets only via `.env` (constitution III).

**Scale/Scope**: 1 owner, 1 community dialog, unbounded sessions/projects
delegated to the OpenCode backend. Port scope: 7 user stories
(spec), phases P1→P3.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (below).*

| Principle | Status | Evidence |
|---|---|---|
| I. Platform-Agnostic Core | PASS | `src/app/`, `src/opencode/` untouched; all VK code under `src/vk/`; Telegram render helpers used by `src/app` (e.g. `telegram-text` consumers) are moved/adapted under `src/vk/render/`, not called from `src/app` (see D3, R3) |
| II. Direct API, Minimal Dependencies | PASS | no VK SDK; 6+3 API methods via native fetch; net dependency count decreases (−7 runtime deps) |
| III. Security First | PASS | `VK_ALLOWED_USER_ID` gate + `group_id` check + event_id dedup (FR-001/002); secrets only in `.env`; secrets-scan gate kept in workflow; no inbound listener exists |
| IV. Test-First | PASS | every `src/vk/` module lands with Vitest unit tests; long-poll `failed` 1/2/3, chunker, payload builder get explicit test tables |
| V. Surgical Port & Upstream Compatibility | PASS | shared layers stay byte-identical where possible; `src/bot/` deleted wholesale (not edited) in the port branch; upstream merge strategy documented in R3 |

## Project Structure

### Documentation (this feature)

```text
specs/001-vk-bot-port/
├── plan.md              # This file
├── research.md          # Phase 0: decisions D1–D11
├── data-model.md        # Phase 1: entities, state machines
├── quickstart.md        # Phase 1: end-to-end validation guide
├── contracts/
│   ├── callback-payloads.md   # Button payload JSON contract
│   └── environment.md         # .env contract (VK_* replacing TELEGRAM_*)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── app/                  # UNCHANGED (platform-agnostic services/managers)
├── opencode/             # UNCHANGED (SDK client, SSE events, process mgmt)
├── i18n/                 # kept; ru completed as primary locale
├── runtime/              # kept; container wiring swaps bot→vk binding
├── utils/                # kept; telegram-specific utils deleted, vk utils added
├── vk/                   # NEW: the entire VK transport
│   ├── client.ts         #   VK API calls (fetch wrapper: token, v, retry, rate limit)
│   ├── longpoll.ts       #   Bots Long Poll loop (act=a_check, failed 1/2/3, backoff)
│   ├── events.ts         #   normalize VK updates → transport events; dedup by event_id
│   ├── auth.ts           #   owner allowlist + group_id verification
│   ├── send.ts           #   messages.send: chunking ≤4096, attachments, notifications
│   ├── keyboards.ts      #   keyboard builder (≤10 buttons, ≤1000 bytes JSON, payload pack)
│   ├── callbacks.ts      #   message_event routing → payload contract; sendMessageEventAnswer
│   ├── upload.ts         #   photo/doc upload chains (getUploadServer → POST → save)
│   ├── status.ts         #   silent status message: delete+resend throttle (D5)
│   ├── commands/         #   /new /sessions /status /projects /models /abort … text commands
│   ├── handlers/         #   message_new, message_event, attachment handlers
│   ├── menus/            #   session/project/model/permission/question menus (payload-driven)
│   ├── render/           #   markdown → VK plain-text pipeline (reuse app block parsers)
│   └── index.ts          #   VKBot: composition root wired into runtime container
├── bot/                  # DELETED (git rm) — whole Telegram layer
└── index.ts / cli.ts     # entrypoints rewired to VKBot
tests/
├── app/ opencode/ …      # UNCHANGED upstream tests keep passing
└── vk/                   # NEW: unit tests per module + payload/chunker tables
```

## Post-Design Constitution Re-Check

- Principle I: container wiring (`src/runtime/container.ts`) binds
  transport interface implemented by `VKBot`; `src/app` depends on
  interfaces only — unchanged upstream code compiles without VK imports.
  PASS.
- Principle II: dependency delta is negative (−7); native
  `fetch`/`FormData`/`WebSocket` from Node 22 cover VK needs. PASS.
- Principle III: no new inbound surface; token stored in `.env`
  (gitignored); `.env.example` gains VK_* placeholders; logs carry
  `peer_id`/`from_id` of the owner only. PASS.
- Principle IV: test plan per module defined (research.md D-dataset).
  PASS.
- Principle V: `src/bot/` removed in one deletion commit; shared-layer
  diffs limited to container binding + config keys; upstream merge
  procedure: `git fetch upstream`, merge, resolve `src/vk` as ours,
  shared as theirs. PASS.
