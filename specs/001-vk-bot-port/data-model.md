# Phase 1 Data Model: VK Bot Port

**Feature**: 001-vk-bot-port | **Date**: 2026-09-06

Entities owned by the VK transport (`src/vk/`). Where an upstream manager
already models the concept, we reuse it and only add VK-facing fields;
those are marked **[upstream]**.

## Owner

The single allowlisted controller of the bot.

| Field | Type | Source | Notes |
|---|---|---|---|
| vk_user_id | integer | env `VK_ALLOWED_USER_ID` | every update's `from_id`/`user_id` MUST match |
| display_name | string | `users.get` (lazy) | used in greetings only |

Rules: mismatch → drop event pre-parse (FR-001). No storage; env is the
single source of truth.

## Dialog

The one VK conversation (community ↔ owner).

| Field | Type | Notes |
|---|---|---|
| peer_id | integer | stable VK dialog id; persisted in settings **[upstream: settings-store]** |

## SessionBinding

Maps the dialog to the current agent session. **[upstream:
foreground/background session state managers]** — VK adds nothing; VK
layer reads/writes through existing services.

State machine: `none → attached(sessionId) ⇄ detached`; `attached` +
agent busy → `busy` (new prompts → queue/reject per FR-016, policy from
upstream prompt-queue manager).

## PermissionRequest **[upstream: permission-manager]**

| Field | Type | Notes |
|---|---|---|
| permission_id | string | from OpenCode event |
| session_id | string |  |
| tool / action_label | string | rendered into menu text |
| status | asked → answered(allow|deny) | single-use; resolved menu becomes inert (FR-006) |

## Question **[upstream: question-manager]**

| Field | Type | Notes |
|---|---|---|
| question_id | string |  |
| options | string[] | rendered as buttons (paginated >10) |
| status | asked → answered(option) | single-use |

## MenuBinding (new, VK-only)

Binds a sent message's inline keyboard to a handler + state snapshot, so
`message_event` taps route correctly and stale taps resolve gracefully.

| Field | Type | Notes |
|---|---|---|
| message_id (conversation_message_id) | integer | VK id of the message carrying the keyboard |
| kind | enum: sessions \| projects \| models \| agents \| permission \| question \| confirm | discriminator in payload |
| state_key | string | opaque handle into in-memory state store (keeps payload ≤255 B) |
| expires_at | epoch ms | stale taps after expiry → polite no-op (spec edge case) |

Lifecycle: created on send → resolved on tap (or superseded by newer menu
of same kind) → expired. In-memory only; restart loses bindings; stale
taps after restart answered with "outdated" notice (no crash).

## PromptQueueItem **[upstream: prompt-queue-manager]**

Queued text/attachment while busy. VK layer contributes only
normalization of VK message parts (text + attachments) into the upstream
prompt type.

## Attachment (transport view)

Direction in/out; kinds `photo | doc`.

| Field | Type | Notes |
|---|---|---|
| kind | enum |  |
| vk_attachment_ref | string | out: `photo{oid}_{id}` / `doc{oid}_{id}` after upload chain |
| local_path | string | in: downloaded temp file for the agent |
| size_bytes | integer | cap enforcement (FR-010) |

## LongPollCursor (new, VK-only)

| Field | Type | Storage | Notes |
|---|---|---|---|
| ts | string | SQLite kv (shared db) | persisted after handler completion (D6) |
| server, key | string | memory only | re-issued on failed=2/3 and restart |
| seen_event_ids | string[] (LRU-256) | memory | dedup window |

## StatusRun (new, VK-only)

One live-status representation per agent run.

State machine: `hidden → shown → refreshed*→ finished(result|abort|error)`
; refresh interval ≥ 3 s; delete+resend per D5; final transition deletes
status message (or morphs it into short result footer) — decided at impl
against D5 fallback.

## Validation rules (from spec/constitution)

- outgoing message chunk ≤ 4000 chars (FR-003 / SC-007) — chunker unit tests
- keyboard JSON ≤ 1000 bytes, ≤ 10 buttons — builder unit tests
- payload string ≤ 255 bytes — payload packer unit tests
- status refresh interval ≥ 3 s — throttle unit tests
- all user-visible strings resolved through i18n (FR-012) — lint-ish test scanning `src/vk` for hardcoded cyrillic/cyrillic-free literals is NOT feasible; covered by code review + i18n key completeness test for ru locale
