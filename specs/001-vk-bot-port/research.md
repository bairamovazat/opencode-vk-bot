# Phase 0 Research: VK Bot Port

**Feature**: 001-vk-bot-port | **Date**: 2026-09-06

Method signatures below are verified against the official VK API schema
repository (`VKCOM/vk-api-schema`, `methods.json` per section). Items
marked **[verify-at-impl]** are documented protocol behavior that must be
confirmed by integration tests during implementation.

## D1 — Transport: Bots Long Poll (not Callback API)

**Decision**: receive events via Bots Long Poll.

**Rationale**: outbound-only connectivity (spec FR-013) — the bot machine
needs no public address, ports, or TLS certificates. Callback API would
require a public HTTPS endpoint plus confirmation/secret handshake.

**Protocol** (documented behavior, [verify-at-impl] exact fields):
1. `groups.getLongPollServer` (param: `group_id`, required) →
   `{ key, server, ts }`.
2. `GET {server}?act=a_check&key={key}&ts={ts}&wait=25&mode=2&version=3`
   — long poll; server holds up to `wait` seconds. Response:
   `{ ts, updates: [{ type, object, group_id, event_id }] }` or
   `{ failed: 1|2|3 }`.
3. `failed=1` → use `new ts` from response, continue.
   `failed=2|3` → key/server expired → re-issue `groups.getLongPollServer`.
4. Network errors/timeout → retry with exponential backoff (1 s → 30 s
   cap), jittered; reset backoff on success. Mirrors upstream
   `src/opencode/events.ts` reconnect policy for consistency.

**Alternatives considered**: Callback API (needs public endpoint —
violates FR-013); User Long Poll (user token — wrong actor, we act as the
community).

## D2 — No VK SDK; native `fetch` client

**Decision**: thin internal client over VK HTTPS API; no third-party VK
framework.

**Rationale** (evaluated 2026-09-06 with npm registry data):
`node-vk-bot-api` — dead (latest 2021-04); `vk-io` — latest 2025-10,
7 runtime deps incl. legacy `node-fetch`/`abort-controller`, its context
model would still require an adapter into `src/app`; `puregram` — active
but multi-platform with VK secondary (6k downloads/mo). The port uses 9
API methods total; owning ~300 auditable lines beats a 7-dep dependency
tree for a public security-conscious repo (constitution II, III).

**Methods used** (all verified in schema):
`groups.getLongPollServer(group_id)`,
`messages.send(peer_id, random_id, message, keyboard?, attachment?,
disable_notification?, dont_parse_links?)`,
`messages.sendMessageEventAnswer(event_id, user_id, peer_id)`,
`messages.delete` (own messages, for D5) **[verify-at-impl]**,
`messages.getByConversationMessageId(peer_id, conversation_message_ids)`
(button→message resolution),
`photos.getMessagesUploadServer(peer_id)` / `photos.saveMessagesPhoto`,
`docs.getMessagesUploadServer(type, peer_id)` / `docs.save(file, title)`,
`users.get`.

**Client behavior**: base `https://api.vk.com/method/`, `v` from config
(default `5.199`), bearer group token; errors
`{error:{error_code,error_msg}}` → typed error; retry only idempotent/
throttle cases: `6` (too many requests) backoff-retry, `10`/`1` transient
backoff-retry; `9` (flood, identical text) → mutation of text; `14`
(captcha) → surfaced as owner-readable failure (single-owner bot;
no captcha solving); `100` → bug, log+report; `901/902` (cannot write to
peer) → owner-readable notice.

## D3 — Replacement strategy: delete Telegram layer, no dual transport

**Decision**: `src/bot/` is deleted wholesale (`git rm`) in the port;
`TELEGRAM_*` env keys replaced by `VK_*` (see
[contracts/environment.md](./contracts/environment.md)); entrypoints and
runtime container bind `VKBot`. No Telegram-compatible mode is kept.

**Rationale**: spec targets a single platform; dual-transport would keep
grammY alive violating simplicity (constitution II) and slow upstream
merges (principle V applies to shared layers, not the replaced one).

**Caveat (principle I follow-up)**: a few files under `src/app` import
Telegram-specific text helpers (e.g. `telegram-text.ts` consumers). These
helpers move to `src/vk/render/`; `src/app` files get their imports
rewired in the same commit — the only permitted `src/app` diff class
(imports only, no logic).

## D4 — Platform capability gaps and adaptations

| Telegram capability | VK reality | Adaptation |
|---|---|---|
| Edit sent message (live status, streaming draft) | Bots cannot edit dialog messages; schema for `messages.send` has no `parse_mode` (verified) | D5 status pattern below; streaming "draft" mode not portable → final-only delivery with milestone status |
| Native slash-command registry (setMyCommands) | None — commands are plain text | Reuse upstream command router; `/start` message + help lists commands; pinned message with commands |
| Markdown/HTML rendering in messages | None (plain text only) | Render pipeline runs in plain-text mode: upstream `block-plain-text.ts` parser already exists in `src/bot/render`; moved to `src/vk/render`; code blocks delimited by unicode rules; no unicode styling beyond plain structure |
| Inline keyboard + callback_data (64 B) | Inline keyboards + `payload` string (≤ 255 B, JSON-in-string) **[verify-at-impl]** | Compact payload contract (contracts/callback-payloads.md); spinner cleared via `messages.sendMessageEventAnswer` |
| Menu button events | `message_event` updates with `event_id`, `payload`, `peer_id`, `user_id` | Same routing shape as upstream callback router |

## D5 — Live progress without message editing (FR-004)

**Decision**: "status message" = silent (`disable_notification`) message
deleted and re-sent with fresh content, throttled to ≥ 3 s interval;
final answer is a normal (non-silent) message.

**Rationale**: approximates an updating single status line within VK
limits; 2 API calls per refresh is trivial vs 20 req/s budget for one
owner. Deletion of bot's own dialog messages is documented behavior
**[verify-at-impl]**.

**Fallback**: if delete+resend proves noisy/racy in integration tests →
downgrade to milestone status (task started / N actions digest every 15 s
/ finished), still satisfying "not one message per tool event" (FR-004).

## D6 — Authentication and exactly-once (FR-001, FR-002, FR-014)

- Owner gate: `from_id`/`user_id` of every update MUST equal
  `VK_ALLOWED_USER_ID`; anything else dropped before parsing (no logging
  of content).
- Group gate: `group_id` of update MUST equal configured `VK_GROUP_ID`.
- Origin: Long Poll connection is initiated by us with our key — no
  inbound endpoint exists to spoof; verification = key possession +
  group/user gates.
- Exactly-once: track last `ts` persistently across restarts (SQLite
  key-value, shared store pattern); deduplicate `event_id` in a small
  LRU within a run; long poll only advances `ts` after handler
  completion for `message_new` (crash between poll and persist →
  redelivery, dedup by event_id catches the window).

## D7 — Commands

No native registry (D4): text commands `/new /sessions /status /projects
/models /agents /abort /rename /help /start /stop` reuse the upstream
command-catalog definitions (shared layer) with the VK handler layer.
Command list surfaced by `/start`, `/help`, and a pinned message.

## D8 — Config keys

`TELEGRAM_*` → `VK_*` mapping, full contract in
[contracts/environment.md](./contracts/environment.md). `OPENCODE_*`,
`STT_*`, `TTS_*`, `LOG_*` keys unchanged (shared layers).

## D9 — Markdown → plain text rendering

Reuse upstream render pipeline's block parser (markdown AST via
`remark`, already a dependency) feeding the plain-text block renderer;
new `vkLimits` chunker: split at 4000 chars, prefer paragraph/fence
boundaries, never split inside a fenced block when avoidable (unit-test
table required, constitution IV).

## D10 — Attachments

- Incoming: `message_new.object.message.attachments[]` — photos carry
  `sizes[]` (pick largest), docs carry `url` (direct download). Size cap
  per spec assumptions; oversized → clear rejection, text part still
  processed (FR-010).
- Outgoing: photo chain `getMessagesUploadServer → multipart POST →
  saveMessagesPhoto → "photo{owner_id}_{id}"`; doc chain
  `getMessagesUploadServer(type=doc) → POST → docs.save →
  "doc{owner_id}_{id}"` (signatures verified in schema). Limits
  **[verify-at-impl]** (≈50 MB photo, ≈200 MB doc) — enforced by config,
  not hardcoded guesses.

## D11 — Rate limiting

Single-owner traffic is far below VK's ~20 req/s budget; still, the
client wraps calls in a token-bucket (20/s) + per-call retry on code 6
with `Retry-After`-style delay. Keyboard JSON size (≤ 1000 B) and payload
(≤ 255 B) asserted by unit tests at build time (constitution IV).
