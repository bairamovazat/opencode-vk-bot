# Feature Specification: Reply-Keyboard Navigation for VK Bot

**Feature Branch**: `002-keyboard-navigation`

**Created**: 2026-09-07

**Status**: Draft

**Input**: User description: "Управлять ботом целиком через reply-клавиатуру: когда сессии нет — кнопка старт/меню; из меню — выбор сессии, начать новую, статус; нажал «Сессии» — выходит клавиатура с текущими сессиями, выбрал — сессия активна и можно вводить текст; плюс кнопки управления текущей сессией (стоп и другие — придумать). Спека, анализ, реализация."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Main menu replaces command typing (Priority: P1)

The owner always has a persistent keyboard under the message input with the
main actions: start a new task, sessions, projects, models, status, help.
Tapping a button performs the same action as the corresponding command; the
keyboard never disappears — management actions are reachable without typing.

**Why this priority**: this is the core UX change; without the main menu
nothing else in this feature matters.

**Independent Test**: open the dialog: the main keyboard is present; tap
each button and verify the corresponding action happens without typing.

**Acceptance Scenarios**:

1. **Given** any dialog state, **When** the owner taps «🆕 Новая», **Then**
   the current session binding is cleared and the confirmation is shown.
2. **Given** the main keyboard, **When** the owner taps «📊 Статус»,
   **Then** the status summary arrives and the keyboard remains.
3. **Given** the owner types free text instead of tapping, **Then** the
   text goes to the agent as a prompt (buttons never block typing).

---

### User Story 2 - Session selection via keyboard (Priority: P1)

Tapping «📋 Сессии» replaces the keyboard with the recent-sessions view
(one button per session plus «⬅️ Меню»). Tapping a session resumes it; the
bot confirms and returns to the main keyboard; the owner can immediately
type a task for the resumed session.

**Why this priority**: resuming prior work without typing is the most
frequent management action.

**Independent Test**: with ≥1 saved session, tap «📋 Сессии», tap a
session button, then send a message that references the earlier context.

**Acceptance Scenarios**:

1. **Given** saved sessions exist, **When** the owner taps «📋 Сессии»,
   **Then** the keyboard shows up to 10 session buttons and «⬅️ Меню».
2. **Given** the sessions keyboard, **When** a session button is tapped,
   **Then** the session becomes current, confirmation arrives, and the
   main keyboard returns.
3. **Given** the sessions view is open, **When** the owner types free text
   instead of tapping, **Then** the text goes to the agent and the view
   resets to the main keyboard.

---

### User Story 3 - Projects and models pickers via keyboard (Priority: P2)

«📁 Проекты» and «🤖 Модели» open corresponding pickers (buttons +
«⬅️ Меню»). Tapping a project switches the working directory; tapping a
model switches the model. Both return to the main keyboard with a
confirmation.

**Why this priority**: same interaction pattern as US2, lower frequency.

**Independent Test**: tap «📁 Проекты», pick a project, verify the
confirmation; repeat for «🤖 Модели».

**Acceptance Scenarios**:

1. **Given** several projects, **When** a project button is tapped,
   **Then** the project is switched, persisted, and confirmed.
2. **Given** the models picker, **When** a model button is tapped,
   **Then** subsequent prompts use that model and a confirmation arrives.

---

### User Story 4 - Run controls while the agent works (Priority: P2)

While a task is running, the keyboard automatically switches to the run
view: «⏹ Стоп», «📊 Статус», «🏠 Меню». «⏹ Стоп» aborts the run; the view
returns to the main keyboard when the run ends (reply delivered or
aborted).

**Why this priority**: stopping a runaway task without typing is a safety
and convenience win; automatic view switching reflects the real state.

**Independent Test**: start a long task, verify the run keyboard appears,
tap «⏹ Стоп», verify the abort notice and the return of the main keyboard
with the final/aborted state.

**Acceptance Scenarios**:

1. **Given** a running task, **When** the run starts, **Then** the
   keyboard shows the run view (Стоп/Статус/Меню).
2. **Given** the run view, **When** «⏹ Стоп» is tapped, **Then** the task
   aborts with a confirmation and the main keyboard returns.
3. **Given** a running task, **When** it completes normally, **Then** the
   main keyboard returns together with the reply.

---

### Edge Cases

- What happens when a keyboard button from a stale view is tapped (e.g.
  the sessions list changed or the bot restarted)? The tap is answered
  with the main keyboard and a short hint; no crash, no wrong selection.
- What happens when two session buttons share the same title? The view
  stores session ids, so the tap resolves by id, not by title.
- What happens when the agent finishes while the owner is inside another
  menu? The reply arrives; the view switches to main only if the finished
  run's view was active (menu browsing is not interrupted mid-lookup).
- What happens when the projects/models lists have more than 10 entries?
  Only the first 10 are offered; the rest remain reachable after
  narrowing (full pagination is out of scope).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-101**: System MUST present the persistent main command keyboard by
  default (after start, restart, /help, /new, /status) with buttons:
  Новая, Сессии, Статус, Проекты, Модели, Стоп, Помощь.
- **FR-102**: System MUST perform the same action for a keyboard button as
  for the corresponding typed command; typed `/commands` keep working.
- **FR-103**: System MUST open a picker view (sessions/projects/models)
  when its menu button is tapped, showing up to 10 option buttons plus
  «⬅️ Меню».
- **FR-104**: System MUST resolve picker taps by stored option identity
  (session id / project id / provider+model), not by visible label.
- **FR-105**: System MUST return to the main keyboard after a successful
  pick (resume/switch) with a confirmation message.
- **FR-106**: System MUST switch to the run view (Стоп, Статус, Меню) when
  a run starts and back to the main keyboard when it ends or is aborted.
- **FR-107**: System MUST treat free text at any view as an agent prompt;
  non-menu text resets the view to main.
- **FR-108**: System MUST handle taps of stale/unknown options gracefully:
  return to the main keyboard with a short hint (no silent ignore).
- **FR-109**: System MUST keep all button labels and hints in Russian via
  the i18n layer (no hardcoded strings).
- **FR-110**: System MUST NOT send more than one keyboard replacement per
  navigation action (no duplicate keyboard updates).

### Key Entities *(include if feature involves data)*

- **KeyboardView**: current per-dialog view (main / sessions / projects /
  models / run) with the stored options for the active picker; in-memory,
  defaults to main after restart.
- **PickerOption**: identity + label pairs captured when a picker is
  rendered; taps resolve against these, never against live lookups.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-101**: 100% of management actions (new, resume, status, projects,
  models, stop, help) are reachable in ≤2 taps without typing.
- **SC-102**: Free-text prompting keeps working at any view (0 prompts
  lost to the keyboard layer).
- **SC-103**: Picker taps resolve by identity: renaming a session between
  rendering and tapping still resumes the correct session id.
- **SC-104**: A stale tap (bot restart between render and tap) returns the
  owner to the main keyboard with a hint within 3 seconds.

## Assumptions

- The dialog has exactly one keyboard at a time; every bot message may
  carry a replacement keyboard.
- Reply keyboards are client-side state; after a bot restart the main view
  is the safe default.
- More than 10 options: truncated to the first 10 (consistent with
  previous menus); full pagination stays out of scope.
- Typed `/commands` remain fully functional (keyboard is an addition, not
  a replacement of the command layer).
