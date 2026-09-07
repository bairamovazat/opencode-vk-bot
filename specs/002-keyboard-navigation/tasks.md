---
description: "Task list for feature implementation"
---

# Tasks: Reply-Keyboard Navigation

**Input**: Design documents from `specs/002-keyboard-navigation/`

**Tests**: included (constitution IV).

## Phase 1: View state machine (foundational)

- [x] T001 Implement keyboard view store: views main/sessions/projects/models/run, stored picker options with identities, per-peer, reset-on-restart to main, in src/vk/keyboards.ts
- [x] T002 Write view store tests: set/get/reset, option identity resolution, stale option detection in tests/vk/keyboards.test.ts
- [x] T003 Implement keyboard builders per view (main, pickers with ⬅️ Меню, run) with budgets (≤10 buttons, ≤1000 bytes) in src/vk/keyboards.ts
- [x] T004 Write builder tests: budgets, labels from i18n, option labels in tests/vk/keyboards.test.ts

## Phase 2: User Story 1 — Main menu replaces typing (P1)

- [x] T005 [US1] Resolve button taps before command parsing: view-aware label → action mapping in src/vk/commands/router.ts
- [x] T006 [US1] Attach main keyboard to default replies (help, new, status, run end) via sender option in src/vk/commands/*.ts, src/vk/index.ts
- [x] T007 [US1] Write tests: label taps map to actions; free text passthrough in tests/vk/keyboards.test.ts

## Phase 3: User Story 2 — Session selection (P1)

- [x] T008 [US2] Rework /sessions to render the sessions VIEW (options stored with session ids) instead of static menu payload in src/vk/commands/sessions.ts, src/vk/menus.ts
- [x] T009 [US2] Write sessions view tests: tap resumes by id, stale tap returns to main with hint in tests/vk/keyboards.test.ts

## Phase 4: User Story 3 — Projects and models pickers (P2)

- [x] T010 [US3] Rework /projects and /models onto the view store (identities: project id, provider+model) in src/vk/commands/projects.ts, src/vk/commands/models.ts, src/vk/menus.ts
- [x] T011 [US3] Write picker tests: switch + confirm + return to main in tests/vk/keyboards.test.ts

## Phase 5: User Story 4 — Run controls view (P2)

- [x] T012 [US4] Switch to run view on onRunStarted; back to main on complete/error/abort in src/vk/index.ts
- [x] T013 [US4] Write run view tests: transitions in tests/vk/keyboards.test.ts

## Phase 6: Polish

- [x] T014 Remove superseded static menu code (sess/prj/mdl inline menus) keeping permission/question inline menus in src/vk/menus.ts
- [x] T015 Live SELFTEST verification of all views; record in impl-notes.md

## Dependencies

- Phase 1 → all stories; US1 → US2/3/4 (views ride on the same store).

## MVP Scope

Phases 1–2 (main menu). US2–US4 build directly on the store.

## Implementation Strategy

Single increment: the store is the foundation; stories are thin views.
