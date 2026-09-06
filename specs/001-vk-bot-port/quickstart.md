# Quickstart: End-to-End Validation Guide

**Feature**: 001-vk-bot-port | **Date**: 2026-09-06

Runnable scenarios proving the feature works. Mapping: scenario → spec
user story / success criterion.

## Prerequisites

1. **VK community**: create a group; enable "Возможности ботов"
   (bot features) in settings; allow messages from the community.
2. **Token**: community → Manage → API usage → create access token with
   scope `messages` (add `manage` if project browsing needs it). Put in
   `.env` — never in the repo (constitution III).
3. **Owner id**: your numeric VK id → `VK_ALLOWED_USER_ID`.
4. **OpenCode backend**: `opencode serve` reachable at
   `OPENCODE_API_URL` (default `http://localhost:4096`), authenticated
   and authorized in (`OPENCODE_SERVER_PASSWORD`, provider auth).
5. **Build**: Node 22.14+; `npm ci && npm run build`.

## Setup

```bash
cp .env.example .env       # fill VK_GROUP_TOKEN, VK_GROUP_ID, VK_ALLOWED_USER_ID
npm test                   # unit gates (constitution IV)
npm run lint && npm run typecheck
npm start                  # bot daemon; logs to logs/
```

## Automated validation

- `npm test` — all upstream shared-layer tests keep passing + new
  `tests/vk/*` suites (chunker tables, payload packer ≤255 B, keyboard
  ≤1000 B / ≤10 buttons, long-poll `failed` 1/2/3, dedup, allowlist).
- Secrets gate before push: `git grep -nIE
  '(vk1\.a\.)|([0-9]{8,10}:AA[A-Za-z0-9_-]{30,})'` over staged diffs →
  no matches (constitution III).

## Manual scenarios (owner's phone + machine)

| # | Steps | Expected | Covers |
|---|---|---|---|
| 1 | Send "hello, what can you do?" from owner account | first status ≤ 2 s; readable answer in same dialog | US1 / SC-001 |
| 2 | Send a task touching a repo file ("rename function X in src/y.ts") | status shows tool activity ≤1/3 s; final summary arrives; file changed on disk | US1, US2 / SC-002 |
| 3 | Send a long task, then `/abort` mid-run | agent stops; status marks aborted; next prompt works immediately | US2 |
| 4 | While busy, send another message | queued (or explicit busy-reject per policy); never mixed silently | US2 / FR-016 |
| 5 | Task that triggers a permission (file write with permission mode) | button menu; tap Allow → agent continues; menu inert after tap; spinner clears | US3 / SC-003 |
| 6 | Task ending with a question (agent asks choice) | options as buttons; tap delivers answer; agent proceeds | US3 |
| 7 | `/new` → message → `/sessions` → resume earlier session | agent recalls earlier context | US4 |
| 8 | `/projects` → switch project → send project-specific task | agent works in the chosen directory; selection survives bot restart | US5 / FR-017 |
| 9 | `/models` → switch model → next prompt | agent reports new model | US6 |
| 10 | Send photo + "what's in this image?"; then request a diff after a code task | answer references image; readable diff delivered | US7 |
| 11 | Write from a second VK account | zero response, zero processing (log shows drop only) | FR-001 / SC-004 |
| 12 | Kill network for 30 s mid-task; restore | bot reconnects ≤ 30 s; status resumes; no duplicate prompts | FR-014 / SC-005 |
| 13 | Restart bot process mid-task | bot re-attaches; result delivered exactly once | FR-014 |
| 14 | Send 3 messages rapidly | merged/queued in order; nothing lost | edge case |
| 15 | Tap a button from a menu sent before restart | polite "outdated" notice once; no crash | edge case |
| 16 | Stop `opencode serve`, send message | clear Russian failure notice ≤ 10 s; auto-recovers when backend returns | US1 / FR-015 |

## Release gate

SC-006: scenarios 1–13 (P1+P2 coverage) pass before first release;
14–16 strongly recommended at the same gate.
