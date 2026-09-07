# Feature Specification: Reply-Keyboard Navigation for VK Bot

**Feature Branch**: `002-keyboard-navigation`

**Created**: 2026-09-07

**Status**: Active (iteration 2 — flows fixed after live bring-up failures)

**Input**: User description: "Управлять ботом целиком через reply-клавиатуру: когда сессии нет — кнопка старт/меню; из меню — выбор сессии, начать новую, статус; нажал «Сессии» — выходит клавиатура с текущими сессиями, выбрал — сессия активна и можно вводить текст; плюс кнопки управления текущей сессией (стоп и другие — придумать). Спека, анализ, реализация."

## Interaction Model (platform facts, verified live)

- There is exactly ONE **reply keyboard** per dialog at any time: either the
  **main view** (3 rows) or the **run view** (1 row). The reply keyboard is
  client-side state and never becomes a picker.
- **Pickers** (sessions / projects / models / new-task project) are INLINE
  button keyboards attached to a single message; taps arrive as
  `message_event` with a payload object. They overlay whatever reply
  keyboard is currently shown and disappear with the message context.
- VK platform limits (verified by probes, see impl-notes.md): inline
  keyboards accept at most **6 rows** → a picker shows **at most 5 option
  rows + 1 nav row**; reply keyboards accept at most 6 rows too (main uses
  3).
- Button labels («🆕 Новая», «⏹ Стоп», …) are fixed Russian constants, not
  localized (single-owner Russian-facing bot; FR-109 applies to message
  texts only). Every label maps to exactly one action; a label must NEVER
  leak to the agent as prompt text.
- `message_event.payload` arrives from Long Poll as an **already parsed
  object**; older code paths may still see JSON strings. Both shapes MUST
  be accepted (FR-111).

## End-to-End Flows (normative)

Each flow lists every step: user action → bot response (message + keyboard
state). Every step must have a code path and an E2E test
(tests/vk/flows.e2e.test.ts).

### Keyboard views

- **Main view** (reply keyboard): rows
  `[🆕 Новая, 📋 Сессии, 📊 Статус]`, `[📁 Проекты, 🤖 Модели, ⏹ Стоп]`,
  `[❓ Помощь]`.
- **Run view** (reply keyboard): row `[⏹ Стоп, 📊 Статус, 🏠 Меню]`.
- Every picker message also shows a nav row as its last inline row:
  «⬅️ Меню» when everything fits on one page, otherwise
  «◀️ / ⬅️ Меню / ▶️» (only available directions).

### F0 — First contact / baseline prompt loop

1. Bot process starts; long poll connects. The bot sends nothing
   proactively. (If the owner's client has no keyboard yet, any of F1–F7
   replies attach the main view.)
2. Owner sends any free text → if no project is selected, the first
   project is auto-selected (single-owner convenience); a new session is
   created in it («Создаю сессию…»), the prompt is dispatched.
3. When the run starts, the bot sends «⚙️ Задача запущена…» SILENTLY (no
   notification) with the **run view** (reply keyboard switches to run
   view).
4. While the run is active, a single silent live-status line is kept up to
   date (throttled ≈3 s): «⏳ {tool} · действий: {count}» — the current
   tool call with compact context (e.g. the edited file path) and the
   action count, so the owner can see the run is alive and what it is
   doing. The status line is deleted when the run ends.
5. When the run finishes, the bot delivers the final text WITH a
   notification — the only message of a run allowed to notify — with the
   **main view** (reply keyboard switches back).
6. If the run errors (and was not owner-aborted), the bot delivers an
   error text with a notification and the main view.

### F1 — Help

1. Owner taps «❓ Помощь» (or types `/help`, `/start`) → help text with the
   **main view** attached.

### F2 — New task with project choice

1. Owner taps «🆕 Новая» (or types `/new`) → current session binding is
   cleared immediately.
2. If MORE than one project exists → the bot sends «🆕 Сессия сброшена.
   Выбери проект для новой задачи:» with an inline **project picker**
   (5 per page, see F3 pagination).
   - Tap a project → the project becomes current, any session binding
     stays cleared, bot confirms «✅ Проект переключён: {project}» with the
     **main view**. The next free text creates a NEW session in that
     project (continues as F0.2).
   - Tap «⬅️ Меню» → bot confirms «🏠 Главное меню.» with the **main
     view**.
3. If zero or one project exists → the bot just confirms «🆕 Сессия
   сброшена…» with the **main view** (project auto-selection will pick the
   only project).

### F3 — Resume a session

1. Owner taps «📋 Сессии» (or types `/sessions`) → if the current project
   has sessions: header «Недавние сессии — нажми, чтобы продолжить:» plus a
   status line «Всего: {total}» (when paging: «Всего: {total} · стр. {n}
   из {m}»), with an inline picker showing page 1 — up to 5 sessions,
   newest first. If none: «Сохранённых сессий пока нет.» (no picker).
2. When more than 5 sessions exist, the bottom nav row holds «⬅️ Меню» and
   «▶️» (page 1) or «◀️ / ⬅️ Меню / ▶️» (middle pages). Tapping «▶️»/«◀️»
   renders the next/previous page as a fresh message (fresh data, new menu
   id) and REMOVES the previous page message — dead keyboards do not pile
   up. Out-of-range pages are clamped to the last available page.
3. Tap a session → the session becomes current; bot confirms «✅ Сессия
   продолжена: {title}» with the **main view** and REMOVES the picker
   message, so its buttons can no longer be tapped. The next free text
   prompts THAT session (F0 continues, no new session is created). Taps
   resolve by stored identity, so the same title on different pages is
   unambiguous.
4. Tap «⬅️ Меню» → «🏠 Главное меню.» with the main view.

### F4 — Switch project (management, not new-task)

1. Owner taps «📁 Проекты» (or types `/projects`) → inline project picker
   (5 per page + nav row).
2. Tap a project → project becomes current, session binding is cleared
   (sessions are per-project), bot confirms «✅ Проект переключён:
   {project}» with the main view. Next free text creates a session in the
   new project.
3. «⬅️ Меню» → main view hint (same as F2).

### F5 — Switch model

1. Owner taps «🤖 Модели» (or types `/models`) → inline model picker
   (5 per page + nav row); if no models: «Доступных
   моделей нет.»
2. Tap a model → model is stored; bot confirms «✅ Модель переключена:
   {model}» with the main view. Subsequent prompts use it.
3. «⬅️ Меню» → main view hint.

### F6 — Stop a running task

1. Owner taps «⏹ Стоп» (in run view or main view; or types `/abort`,
   `/stop`) → IF the bound session is actually running on the server, it
   is aborted via the OpenCode API and the bot confirms «⏹ Задача
   остановлена.» with the **main view**; the aborted session's follow-up
   error event is suppressed.
2. If nothing is running — no bound session, or the bound session is idle
   on the server — the bot answers «Нет запущенной задачи.» with the main
   view. Stop is IDEMPOTENT: pressing it repeatedly never claims to stop
   something that is not running. When the server state cannot be checked,
   the abort is attempted anyway (safe side).
3. The label «⏹ Стоп» must never reach the agent as a prompt.

### F7 — Status

1. Owner taps «📊 Статус» (or types `/status`) at ANY view → status report
   (project, session, model, busy state) with the **main view**.

### F8 — Free text at any view

1. Owner sends non-command text at any view → it goes to the agent as a
   prompt in the current session (creating one if needed); the reply
   keyboard becomes the run view (F0.3). No prompt is ever lost to the
   keyboard layer.

### F9 — Stale / unknown taps (no dead ends)

1. Owner taps an inline button of a picker that no longer exists (bot
   restart, menu already used, >32 newer menus) → bot answers «Это меню
   устарело. Запросите заново.» with the **main view**; no crash, no wrong
   selection.
2. A tap whose payload cannot be parsed at all is answered the same way
   (never silently ignored).
3. Tap «⬅️ Меню» on any picker always returns the main view. If the
   picker's menu id no longer exists (bot restart in between), the tap is
   answered as a stale tap (F9.1: outdated hint + main view) — the owner
   still ends up on the main view, never stuck.

### F10 — Permission / question prompts (unchanged, inline)

1. While running, the agent may ask for a permission → inline row
   [✅ Allow once, 🔁 Always, ⛔ Deny]; tap replies to OpenCode and the bot
   confirms; the prompt message is removed.
2. The agent may ask questions → one message per question showing BOTH
   the short header and the full question text with option rows; taps step
   through questions (each answered message is removed) and the last tap
   submits all answers.

## User Stories (mapped to flows)

- **US1 (P1)** Main menu replaces command typing → F0, F1, F7, F8.
- **US2 (P1)** Session selection via keyboard → F3.
- **US3 (P2)** Projects and models pickers → F4, F5.
- **US4 (P2)** Run controls while the agent works → F0.3–F0.5, F6.
- **US5 (P2)** New task with explicit project choice → F2.

## Requirements (mandatory)

- **FR-101**: System MUST present the persistent main command keyboard by
  default (after start, restart, /help, /new, /status and every other
  management reply) with buttons: Новая, Сессии, Статус, Проекты, Модели,
  Стоп, Помощь.
- **FR-102**: System MUST perform the same action for a keyboard button as
  for the corresponding typed command; typed `/commands` keep working.
- **FR-103**: System MUST open a picker view (sessions/projects/models and
  the new-task project choice) when its menu button is tapped, showing at
  most 5 option buttons (platform-verified limit) plus a nav row: just
  «⬅️ Меню» when everything fits, otherwise «◀️ / ⬅️ Меню / ▶️» with only
  the available directions enabled (6 rows total). The picker message MUST
  show the total option count, and the page indicator when paginating.
- **FR-104**: System MUST resolve picker taps by stored option identity
  (session id / project id / provider+model), not by visible label.
- **FR-105**: System MUST return to the main keyboard after a successful
  pick (resume/switch) with a confirmation message.
- **FR-106**: System MUST switch to the run view when a run starts and
  back to the main keyboard when it ends, errors, or is aborted.
- **FR-107**: System MUST treat free text at any view as an agent prompt.
- **FR-108**: System MUST handle taps of stale/unknown/unparseable options
  gracefully: return to the main keyboard with a short hint (no silent
  ignore).
- **FR-109**: System MUST keep all button hints and replies in Russian via
  the i18n layer (button LABELS are fixed constants, see Interaction
  Model).
- **FR-110**: System MUST NOT send more than one keyboard replacement per
  navigation action.
- **FR-111**: System MUST accept `message_event` payloads in both shapes:
  Long Poll object payloads and legacy JSON strings; button taps MUST
  resolve against the peer carried by the event itself (so taps work
  immediately after a bot restart).
- **FR-112**: System MUST map every reply-keyboard label (including «🏠
  Меню» and «⏹ Стоп») to its action; no label may ever be forwarded to the
  agent as prompt text.
- **FR-114**: While a run is active, bot-initiated messages (run-started
  notice, live status line) MUST be sent silently (no notification). The
  final reply and run-error messages are the run's completion signals and
  MUST notify.
- **FR-115**: While a run is active, the system MUST keep a live progress
  line showing the current tool call (with compact context such as the
  edited file) and the action count, refreshed at most once per 3 s, so
  the owner can follow what the agent is doing and detect a stuck or
  misguided run.
- **FR-116**: One-shot menu messages (picker after pick/back, previous
  picker page after paging, answered question, resolved permission
  prompt) MUST be removed from the dialog, so consumed buttons cannot
  linger looking tappable. Removal is best-effort (a failed delete never
  breaks the flow).

## Key Entities

- **PickerOption**: identity + label pairs captured when a picker is
  rendered; taps resolve against these, never against live lookups.
  Stored in an in-memory LRU registry (32 entries) keyed by a short menu
  id embedded in the button payload.
- **KeyboardView**: informational per-dialog view name (main / sessions /
  projects / models / run). The reply keyboard actually shown is a
  property of the last message; the safe default after a restart is main.

## Success Criteria (mandatory)

- **SC-101**: 100% of management actions (new, resume, status, projects,
  models, stop, help) are reachable in ≤2 taps without typing.
- **SC-102**: Free-text prompting keeps working at any view (0 prompts
  lost to the keyboard layer, 0 labels leaked as prompts).
- **SC-103**: Picker taps resolve by identity: renaming a session between
  rendering and tapping still resumes the correct session id.
- **SC-104**: A stale tap (bot restart between render and tap) returns the
  owner to the main keyboard with a hint; «⬅️ Меню» always works.

## Assumptions

- The dialog has exactly one reply keyboard at a time; every bot message
  may carry a replacement reply keyboard.
- Reply keyboards are client-side state; after a bot restart the main view
  is the safe default.
- More than 5 options: paginated 5 per page via the inline nav row
  (platform-verified inline row limit of 6). Sessions fetch is capped at
  100 entries; deeper history stays out of scope.
- Paged-away picker pages have their messages removed (FR-116); re-tapping
  a nav button of an already-removed page message is impossible in the
  client, so orphan duplicates do not accumulate in practice (a simulated
  stale re-tap renders a fresh page — harmless).
- Typed `/commands` remain fully functional (keyboard is an addition, not
  a replacement of the command layer).

## Verification

- `tests/vk/flows.e2e.test.ts` runs every flow F0–F9 against the real
  composition (normalizer → router → commands → pickers → sender) with the
  VK HTTPS API and the OpenCode SDK mocked at the transport boundary,
  asserting the exact outbound `messages.send` calls (text + keyboard).
  F10 (permission/question prompts) is covered by unit tests in
  `tests/vk/menus.test.ts`.
  Tests run under the default `en` locale (BOT_LOCALE unset); the Russian
  message texts quoted in the flows live in `src/i18n/ru.ts` and the fixed
  button labels are Russian constants (Interaction Model).
- Live bring-up: `scripts/vk-live-probe.mjs` validates against the real VK
  API that every keyboard (main, run, each picker) is accepted
  (error 911/912 would reject), and a `VK_SELF_TEST` round-trip validates
  the prompt loop end-to-end.
