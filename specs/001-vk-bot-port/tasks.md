---
description: "Task list for feature implementation"
---

# Tasks: VK Bot Port of opencode-telegram-bot

**Input**: Design documents from `/specs/001-vk-bot-port/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUDED — constitution principle IV mandates test-first for
core logic; every `src/vk/` module lands with a Vitest suite.

**Organization**: by user story for independent implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no incomplete-dependency)
- **[Story]**: user story from spec.md (US1…US7)
- Exact file paths in every description

## Path Conventions

Single project: `src/`, `tests/` at repository root (matches upstream).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: config, seam for transport swap, i18n readiness — no
behavior change yet; upstream tests stay green.

- [ ] T001 Extend config with VK_* variables and fail-fast startup validation per contracts/environment.md in src/config.ts and .env.example
- [ ] T002 Introduce transport binding seam in src/runtime/container.ts: extract interface consumed by bootstrap so a VKBot implementation can replace TelegramBotApp without touching src/app or src/opencode
- [ ] T003 [P] Audit and complete ru locale for all planned VK-facing strings (menus, commands, status, errors) in src/i18n/ru.ts; register keys in src/i18n/index.ts
- [ ] T004 [P] Create VK API test helpers: fetch interceptor with scripted responses/errors and fake timers setup in tests/vk/helpers/mock-vk-api.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: VK connectivity core — no user story starts without it.
Research: D1, D2, D6; data-model: LongPollCursor.

- [ ] T005 Implement VK API client (fetch wrapper: group token, v param, typed errors 6/9/14/100/901, backoff retry on 6/1/10, token-bucket 20 rps) in src/vk/client.ts
- [ ] T006 Write unit tests for client: error mapping, retry-on-6 with fake timers, rate limiting in tests/vk/client.test.ts
- [ ] T007 [P] Implement Bots Long Poll loop (getLongPollServer, act=a_check with wait, failed=1 ts refresh, failed=2/3 re-issue, exponential backoff 1s→30s, graceful abort) in src/vk/longpoll.ts
- [ ] T008 [P] Write unit tests for longpoll: failed=1, failed=2/3, network error backoff sequence, clean shutdown in tests/vk/longpoll.test.ts
- [ ] T009 [P] Implement update normalization: message_new/message_event mapping, group_id gate, event_id LRU dedup, persistent ts checkpoint in shared SQLite kv (D6) in src/vk/events.ts
- [ ] T010 [P] Write unit tests for events: gating, duplicate event_id drop, ts checkpoint persistence across simulated restart in tests/vk/events.test.ts
- [ ] T011 [P] Implement owner allowlist gate (from_id/user_id vs VK_ALLOWED_USER_ID, drop pre-parse without content logging, FR-001) in src/vk/auth.ts
- [ ] T012 [P] Write unit tests for auth: match pass, mismatch drop, no-content-log assertion in tests/vk/auth.test.ts
- [ ] T013 Implement outbound send wrapper: chunking ≤4000 chars with paragraph/fence-aware boundaries, random_id generation, disable_notification, attachment refs, flood-error text mutation (D2) in src/vk/send.ts
- [ ] T014 Write chunker test table: 4096+ replies, code fences, lists, no broken fences (SC-007, FR-003) in tests/vk/send-chunker.test.ts

**Checkpoint**: long poll receives owner events and can send text back —
independent of any user story.

---

## Phase 3: User Story 1 — Send a coding task from VK and receive the result (P1) 🎯 MVP

**Goal**: full core loop text→agent→text. **Independent test**:
quickstart scenario 1–2 with a real backend, or mocked end-to-end test.

- [ ] T015 [P] [US1] Implement markdown→plain-text render pipeline reusing upstream remark block parser (move needed Telegram-free parts, imports-only change in src/app if any) in src/vk/render/pipeline.ts
- [ ] T016 [P] [US1] Write render pipeline tests: tables/lists/code blocks to plain text, chunk-boundary integration with send chunker in tests/vk/render-pipeline.test.ts
- [ ] T017 [US1] Implement message_new handler: text → merge-window handling → upstream session-service prompt path → deliver final response chunks to dialog (FR-003, FR-016-queue entry) in src/vk/handlers/message-new.ts
- [ ] T018 [US1] Implement error path: backend unreachable/auth failure → i18n failure notice within 10 s, prompt not lost silently (FR-015) in src/vk/handlers/message-new.ts
- [ ] T019 [US1] Implement VKBot composition root (longpoll→events→auth→handlers→send) and wire it through the T002 seam in src/vk/index.ts, src/runtime/container.ts, src/index.ts
- [ ] T020 [US1] Write handler flow tests with mocked client and mocked upstream services: single prompt, response chunking delivery, failure notice in tests/vk/handlers/message-new.test.ts
- [ ] T021 [US1] Manual validation: run quickstart scenarios 1–2 against a real `opencode serve`; record outcomes in specs/001-vk-bot-port/impl-notes.md

---

## Phase 4: User Story 2 — Monitor progress and stop a running task (P1)

**Goal**: live status + abort + busy policy. **Independent test**:
quickstart scenario 3–4.

- [ ] T022 [US2] Implement status run lifecycle: silent status message with delete+resend, ≥3 s throttle, finished/aborted/error transitions, D5 fallback flag in src/vk/status.ts
- [ ] T023 [US2] Write status tests: throttle timing with fake timers, delete+resend sequence, fallback milestone mode in tests/vk/status.test.ts
- [ ] T024 [US2] Integrate upstream event subscription + summary aggregation (tool-message-batcher, summary formatters) to render status content from agent SSE events without changing src/app logic in src/vk/handlers/progress.ts
- [ ] T025 [US2] Implement abort via /abort text command and abort of running session through upstream run-control path; status reflects aborted (FR-005) in src/vk/commands/abort.ts
- [ ] T026 [US2] Implement busy policy visibility: incoming prompt during run → upstream prompt-queue manager (queued ack) or explicit busy-reject notice (FR-016) in src/vk/handlers/message-new.ts
- [ ] T027 [US2] Write tests: abort mid-run ends status run; busy prompt queued ack in tests/vk/busy-and-abort.test.ts

---

## Phase 5: User Story 3 — Answer questions and approve permissions via buttons (P2)

**Goal**: interactive buttons. **Depends on**: T013 (send), Phase 4
status runs. **Independent test**: quickstart scenario 5–6.

- [ ] T028 [P] [US3] Implement keyboard builder: ≤10 buttons, ≤1000 bytes JSON, payload packer per contracts/callback-payloads.md (≤255 bytes) in src/vk/keyboards.ts
- [ ] T029 [P] [US3] Write keyboard/payload tests: size budgets asserted, envelope schema, all kinds/actions in tests/vk/keyboards.test.ts
- [ ] T030 [US3] Implement message_event router: envelope validation, MenuBinding store lookup, expired/stale handling with single outdated notice, spinner clear via sendMessageEventAnswer (router rules 1–5) in src/vk/callbacks.ts
- [ ] T031 [US3] Write callback router tests: stale menu, duplicate tap, unknown envelope, spinner clear called in tests/vk/callbacks.test.ts
- [ ] T032 [US3] Implement permission and question menus bound to upstream permission-manager and question-manager: render options, single-use resolve, answer delivery (FR-006) in src/vk/menus/permission-menu.ts and src/vk/menus/question-menu.ts
- [ ] T033 [US3] Write menu tests: permission allow/deny reaches upstream manager; question option delivery; resolved menu inert in tests/vk/menus/permission-question.test.ts

---

## Phase 6: User Story 4 — Manage sessions (P2)

**Goal**: session commands + resume menu. **Depends on**: T030 (menus)
for selection UI. **Independent test**: quickstart scenario 7.

- [ ] T034 [US4] Implement text commands /new /sessions /status /rename /help /start reusing upstream command catalog definitions in src/vk/commands/new.ts, sessions.ts, status.ts, rename.ts, help.ts
- [ ] T035 [US4] Implement session selection menu over upstream session-cache-service with pagination via payload `page` in src/vk/menus/session-menu.ts
- [ ] T036 [US4] Write tests: /new detaches to fresh session, resume restores context binding, /status reports project+session+model+busy in tests/vk/commands/session-commands.test.ts

---

## Phase 7: User Story 5 — Switch the working project (P2)

**Goal**: project picker + persistence. **Depends on**: menus. **Independent test**: quickstart scenario 8.

- [ ] T037 [US5] Implement /projects command and project menu over upstream project-service/project-switch-service; persist selection via settings store (FR-017) in src/vk/commands/projects.ts and src/vk/menus/project-menu.ts
- [ ] T038 [US5] Write tests: switch project, restart persistence restore, project list pagination in tests/vk/commands/projects.test.ts

---

## Phase 8: User Story 6 — Choose model and agent (P3)

**Depends on**: menus. **Independent test**: quickstart scenario 9.

- [ ] T039 [P] [US6] Implement /models and agent picker menus over upstream model-selection-service/agent-selection-service with pagination in src/vk/menus/model-menu.ts and src/vk/menus/agent-menu.ts
- [ ] T040 [P] [US6] Write tests: model switch applies to next prompt, provider list pagination in tests/vk/menus/model-agent.test.ts

---

## Phase 9: User Story 7 — Exchange files and see diffs (P3)

**Depends on**: US1 flow. **Independent test**: quickstart scenario 10.

- [ ] T041 [US7] Implement upload chains photo/doc with VK_MAX_ATTACHMENT_MB cap and i18n rejection notice (D10) in src/vk/upload.ts
- [ ] T042 [US7] Write upload tests: successful chain → attachment ref, oversize rejection, upload error mapping in tests/vk/upload.test.ts
- [ ] T043 [US7] Implement incoming attachment handling: download photo/doc to temp dir (size cap), attach to prompt path; and outgoing file/diff delivery reusing upstream file-download-service in src/vk/handlers/attachments.ts
- [ ] T044 [US7] Write attachment handler tests: photo+text prompt reaches agent with temp file, diff arrives as document in tests/vk/handlers/attachments.test.ts

---

## Phase 10: Polish & Cross-Cutting

**Purpose**: complete the port as a standalone VK project (D3).

- [ ] T045 Delete Telegram layer wholesale: git rm src/bot/, remove grammy/@grammyjs/menu from package.json, remove src/utils/telegram-*.ts, rewire any remaining src/app imports to moved helpers (imports-only diffs, D3)
- [ ] T046 [P] Update project metadata: package.json name/description/keywords, README.md (VK setup from quickstart), Dockerfile/docker-compose env (VK_*), e2e/.env.example in package.json, README.md, Dockerfile, docker-compose.yml, e2e/.env.example
- [ ] T047 [P] Add secrets-scan pre-push gate script over staged diffs (vk1.a. / bot-token / PEM patterns) wired as npm run guard:secrets in scripts/secrets-scan.mjs and package.json
- [ ] T048 Apply runtime mode defaults for fork: BOT_LOCALE default ru and MESSAGE_FORMAT_MODE=markdown fallback warning per contracts/environment.md in src/config.ts and src/vk/index.ts
- [ ] T049 Full manual pass of quickstart scenarios 1–16; record results and fixes in specs/001-vk-bot-port/impl-notes.md
- [ ] T050 Final gates: npm run build && npm run lint && npm run typecheck && npm test all green; upstream shared-layer diff review (imports-only assertion) before release tag

---

## Dependencies & Execution Order

```text
Phase 1 (T001–T004)
   └─▶ Phase 2 (T005–T014)  ── checkpoint: connect + send text
          └─▶ Phase 3 US1 (T015–T021)  🎯 MVP SHIP
                 ├─▶ Phase 4 US2 (T022–T027)
                 │      └─▶ Phase 5 US3 (T028–T033)
                 │             ├─▶ Phase 6 US4 (T034–T036)
                 │             ├─▶ Phase 7 US5 (T037–T038)
                 │             └─▶ Phase 8 US6 (T039–T040)
                 └─▶ Phase 9 US7 (T041–T044)   [needs only US1]
                        └─▶ Phase 10 (T045–T050)
```

- US2 blocks US3 (status runs host menus contextually) — planned, not accidental
- US4/US5/US6 are independent of each other after US3
- US7 depends only on US1

## Parallel Opportunities

- Within Phase 2: T007/T008, T009/T010, T011/T012 fully parallel (distinct modules)
- Within stories: every [P] test task can run alongside its neighbors
- After US1: US2-track and US7 can proceed in parallel
- After US3: US4, US5, US6 in parallel

## MVP Scope

**US1 alone (Phases 1–3, T001–T021)** delivers the product core: text
task from VK → agent runs → result back. Ship-safe per spec SC-006
(P1+P2 required for first release: add Phases 4–7).

## Implementation Strategy

1. Land Phase 1–2 as one reviewable increment (green upstream tests).
2. MVP increment ends at T021 with a manual quickstart note.
3. Each subsequent story = separate commit series; upstream shared-layer
   diffs stay imports-only (constitution V).
4. Deletions (T045) happen last so every intermediate state builds and
   tests green.
