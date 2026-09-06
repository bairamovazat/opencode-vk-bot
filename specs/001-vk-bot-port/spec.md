# Feature Specification: VK Bot Port of opencode-telegram-bot

**Feature Branch**: `001-vk-bot-port`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "Переписать текущий репозиторий под VK-бота: тот же мобильный клиент для агента OpenCode, но чат-платформа — ВКонтакте вместо Telegram"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Send a coding task from VK and receive the result (Priority: P1)

The owner opens a dialog with the community bot in VK on their phone and
writes a coding task in natural language ("fix the failing test in
src/auth", "add a /version command"). The agent working on the owner's
machine receives the task, performs it, and the owner receives the agent's
final answer back in the same VK dialog. The owner never opens a desktop
client during the whole task.

**Why this priority**: This is the core product loop. Without it nothing
else has value; with only this, the product is already a viable MVP
(remote coding agent from a phone).

**Independent Test**: With the bot running and the agent idle, send one
task message and verify a complete, relevant answer arrives in the same
dialog.

**Acceptance Scenarios**:

1. **Given** the agent is idle and a project is selected, **When** the
   owner sends a task message, **Then** the message is delivered to the
   agent as a prompt and the agent's final response arrives in the same
   dialog, readable on a phone screen.
2. **Given** the agent backend is unreachable, **When** the owner sends a
   task message, **Then** the owner receives a clear, human-readable
   failure notification in Russian within 10 seconds, and no prompt is
   silently lost.
3. **Given** the agent's answer exceeds the platform's single-message
   length limit, **When** the response is delivered, **Then** it arrives
   as several consecutive messages in correct order with no truncation
   and no broken code blocks at split points.

---

### User Story 2 - Monitor progress and stop a running task (Priority: P1)

While the agent works (tens of seconds to many minutes), the owner sees
live progress: that the agent is busy, what it is currently doing
(summarized tool activity, e.g. "reading file…", "running tests…"),
updated in place rather than flooding the chat. The owner can stop the
task at any moment with a stop command/button and the agent aborts.

**Why this priority**: Coding tasks are long and opaque; without visible
progress and a stop control the core loop (US1) is unusable in practice.

**Independent Test**: Submit a task that takes over 30 seconds, observe
progress indications appear during the run, then stop the task mid-run and
verify the agent stops and the owner is informed.

**Acceptance Scenarios**:

1. **Given** a task is running, **When** the agent performs tool actions,
   **Then** the owner sees a compact live status update (one editable
   status representation, not one message per tool call).
2. **Given** a task is running, **When** the owner sends the stop
   command, **Then** the agent aborts, the status reflects completion
   ("aborted"), and the dialog is ready for a new task.
3. **Given** a task is running, **When** the owner sends a new text
   message, **Then** the system either queues it for after the current
   run or clearly rejects it with a busy notice — it is never silently
   mixed into the running task.

---

### User Story 3 - Answer agent questions and approve permissions via buttons (Priority: P2)

When the agent asks a clarifying question with options, or requests
permission for a protected action (e.g. writing files, running a
command), the owner sees the options/approval as tappable buttons under
the message. Tapping a button answers the agent, which continues
immediately.

**Why this priority**: The agent regularly blocks on questions and
permission prompts; answering from the phone without typing is the
difference between "usable remotely" and "must go to the computer".

**Independent Test**: Trigger a task that asks a question mid-run; answer
it via a button and verify the agent receives the chosen answer and
continues.

**Acceptance Scenarios**:

1. **Given** the agent requested permission for a protected action,
   **When** the owner taps "Allow" (or "Deny"), **Then** the agent
   receives the decision and proceeds (or skips the action), and the
   buttons become visually resolved (cannot be tapped twice).
2. **Given** the agent asked a multiple-choice question, **When** the
   owner taps one option, **Then** the choice is delivered to the agent
   as the answer.
3. **Given** a question or permission prompt, **When** the owner taps an
   option more than once or an outdated menu is tapped, **Then** the
   duplicate/stale tap is ignored gracefully without errors visible to
   the owner.

---

### User Story 4 - Manage sessions (Priority: P2)

The owner starts a fresh task context with /new, lists recent sessions
with /sessions, resumes a previous session (its full history is loaded),
aborts, renames, and checks current status with /status. Each dialog
tracks exactly one "current" session at a time.

**Why this priority**: Multi-step work needs context separation: start
new topics without polluting old ones, and return to earlier threads.

**Independent Test**: Create a session, send a task, start a new session,
then resume the first and verify the agent still knows the earlier
context.

**Acceptance Scenarios**:

1. **Given** an active session with history, **When** the owner runs
   /new, **Then** subsequent messages go to a fresh session and the
   previous one remains in the list.
2. **Given** several existing sessions, **When** the owner opens
   /sessions and picks one, **Then** that session becomes current and the
   agent answers with full memory of it.
3. **Given** any state, **When** the owner runs /status, **Then** the
   owner sees the current project, session, model, and busy state.

---

### User Story 5 - Switch the working project (Priority: P2)

The owner selects which local project directory the agent works on via
/projects. The selection persists across restarts. Sessions are kept per
project.

**Why this priority**: The owner has multiple repositories; remote work is
useless if switching context requires desktop access.

**Independent Test**: Switch from project A to project B, send a task,
and verify the agent operates on project B (references its files).

**Acceptance Scenarios**:

1. **Given** multiple registered projects, **When** the owner opens
   /projects and picks one, **Then** the bot confirms the switch and
   subsequent tasks run against that project.
2. **Given** a selected project, **When** the bot restarts, **Then** the
   project selection and current session are restored without owner
   action.

---

### User Story 6 - Choose model and agent (Priority: P3)

The owner lists available models/agents and switches the current one via
buttons. The choice applies to subsequent prompts in the current session.

**Why this priority**: Useful for cost/capability tuning, but not needed
for the core loop.

**Independent Test**: Open the model picker, switch to another model,
send a prompt, and verify the agent reports using the chosen model.

**Acceptance Scenarios**:

1. **Given** the backend reports several available models, **When** the
   owner opens the picker, **Then** models are listed with readable
   names, paginated if long.
2. **Given** a running session, **When** the owner switches model,
   **Then** the next prompt uses the new model without restarting the
   session.

---

### User Story 7 - Exchange files and see diffs (Priority: P3)

The owner attaches photos/documents to a prompt; the agent receives them.
When the agent changes files, the owner can request the diff; small
diffs/files are delivered as messages or attachments in the dialog.

**Why this priority**: Enhances the loop but text-only prompting already
delivers the core value.

**Independent Test**: Send a message with an attached document together
with a question about it; verify the agent's answer reflects the
document's content. Request a diff after a code change and verify it
arrives readable.

**Acceptance Scenarios**:

1. **Given** the owner sends a document with a prompt, **When** the
   agent processes it, **Then** the agent's answer references the
   document content.
2. **Given** the agent modified files in a task, **When** the owner
   requests the diff, **Then** a readable diff of the changes arrives in
   the dialog.

---

### Edge Cases

- What happens when the owner sends several messages rapidly? They are
  merged (within a short window) into one prompt or queued in order —
  never lost, never reordered.
- What happens when the connection drops mid-task (network flap, machine
  sleep)? The bot reconnects automatically and resumes live updates for
  the still-running session; no duplicate prompts are sent.
- What happens when the bot process restarts while a task is running?
  After restart the bot re-attaches to the running session and continues
  delivering its result.
- What happens when a stranger writes to the bot? Their messages are
  ignored completely (no processing, no reply, no information disclosure).
- What happens when a button from an old/outdated menu is tapped? The tap
  is answered politely (or silently) without crashing and without
  affecting the current state.
- What happens when an attachment exceeds supported size? The owner gets
  a clear rejection message; the text part of the prompt still processes.
- What happens when the agent backend is stopped? The owner gets a clear
  notice; the bot recovers automatically when the backend returns.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST process dialog messages only from an explicitly
  allowlisted owner identity; all other senders are ignored without any
  response or log of their content.
- **FR-002**: System MUST verify the origin of every incoming platform
  event before processing it, rejecting events that fail verification.
- **FR-003**: System MUST deliver the agent's final responses to the same
  dialog the prompt came from, split across consecutive messages when
  exceeding the platform's per-message limit, preserving reading order
  and code-block integrity.
- **FR-004**: System MUST present live task progress as a single,
  updating status representation (not one message per tool event) with
  summarized tool activity, refreshing at most once every 3 seconds.
- **FR-005**: System MUST allow the owner to abort the running task via
  command or button at any time.
- **FR-006**: System MUST render agent permission requests and
  multiple-choice questions as tappable button menus, deliver the chosen
  option back to the agent, and make menus single-use (resolved after
  answer).
- **FR-007**: System MUST provide session commands: start new session,
  list sessions, resume a selected session, rename, abort, and show
  status (project, session, model, busy state).
- **FR-008**: System MUST provide a project picker that switches the
  working directory for subsequent tasks and persists the selection
  across restarts.
- **FR-009**: System MUST provide model and agent pickers listing
  backend-available options, paginated when long, applying the choice to
  subsequent prompts.
- **FR-010**: System MUST attach owner-sent photos/documents to the
  prompt, subject to platform size limits, rejecting oversized
  attachments with a clear message.
- **FR-011**: System MUST deliver agent-produced diffs and files to the
  dialog on request, within platform limits.
- **FR-012**: System MUST present all user-facing text in Russian;
  changing the interface language MUST NOT require code changes.
- **FR-013**: System MUST work without any publicly reachable network
  address on the owner's machine (outbound connectivity only).
- **FR-014**: System MUST automatically restore its connection and
  re-attach to running sessions after connection loss or process restart,
  delivering still-pending results exactly once (no duplicates).
- **FR-015**: System MUST NOT log secrets (tokens, credentials) or show
  stack traces to the owner; internal errors appear as short
  human-readable notices.
- **FR-016**: System MUST queue or clearly reject prompts sent while the
  agent is busy (owner-visible policy, never silent mixing).
- **FR-017**: System MUST persist owner preferences (selected project,
  session, model) across restarts.
- **FR-018**: System MUST accept voice messages as prompts, using the VK
  transcript when available and a configured speech-to-text service
  otherwise (FR-012 locale applies to all notices).
- **FR-019**: System MUST reject voice input with a clear notice when
  neither a transcript nor a speech-to-text service is available.

### Key Entities *(include if feature involves data)*

- **Owner**: the single allowlisted user identity permitted to control
  the agent; all authorization derives from it.
- **Dialog**: the VK conversation with the owner; the unit that receives
  prompts, responses, status, and menus; exactly one active (current)
  session context at a time.
- **Session (agent task context)**: a conversation with the coding agent,
  with full history, owned by a project; can be resumed, renamed,
  aborted; has a busy/idle state.
- **Project**: a local working directory registered with the agent
  backend; scopes sessions.
- **Permission Request**: a pending agent request for a protected action;
  has allow/deny options; single-use.
- **Question**: a pending agent question with predefined options;
  single-use.
- **Menu / Callback Action**: a tappable button set bound to a specific
  dialog state; expires when the state it belongs to is resolved.
- **Attachment**: a photo/document sent by the owner or produced by the
  agent; has size constraints.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A submitted task shows its first visible progress
  indication within 2 seconds when the agent is idle.
- **SC-002**: A complete coding task (submit → agent edits files →
  summary received) can be finished entirely from a phone without
  opening any desktop tool.
- **SC-003**: 100% of agent permission requests and questions are
  answerable via at most 3 taps (open menu excluded).
- **SC-004**: 100% of messages from non-allowlisted senders are ignored
  (zero replies, zero processing), verified by testing with a second
  account.
- **SC-005**: After a forced connection interruption, the bot restores
  updates within 30 seconds without owner action and without duplicating
  any prompt.
- **SC-006**: All P1 and P2 user stories pass their acceptance scenarios
  before first release; P3 stories may follow in a later release.
- **SC-007**: An agent reply 3× longer than the single-message limit is
  delivered complete: correct order, no truncation, no broken code
  blocks.

---

### User Story 8 - Talk to the agent with voice messages (Priority: P2)

The owner records a voice message in VK. The bot transcribes it (VK's
built-in transcript when present, otherwise a configured Whisper-compatible
service) and sends the text to the agent as a prompt; the reply follows the
usual text flow.

**Why this priority**: the owner explicitly requested voice-first
communication from the phone.

**Independent Test**: send a voice message asking a known question; verify
the agent answers its content.

**Acceptance Scenarios**:

1. **Given** a voice message with a VK-provided transcript, **When** it is
   sent, **Then** the agent receives the transcribed text as the prompt.
2. **Given** no VK transcript and no STT service configured, **When** a
   voice message is sent, **Then** the owner receives a clear notice and no
   prompt is dispatched.

## Assumptions

- Single-owner deployment (matches the source project): exactly one
  allowlisted user identity; multi-user support is out of scope.
- The bot operates through a VK community (group) dialog; personal
  message dialogs are not targeted.
- The end goal is feature parity with the source project; delivery is
  phased (P1 core loop → P2 control/management → P3 media/models).
  Voice input was promoted to US8 by owner request (2026-09-06).
  Source-only extras (text-to-speech replies, scheduled tasks, worktree
  management, prompt-queue editing) remain explicitly deferred.
- The OpenCode agent backend already exists on the owner's machine and
  is reused as-is; this feature adds no new backend capabilities.
- Russian is the primary and initially only maintained locale; other
  locales inherited from the source may be updated opportunistically.
- The owner runs the bot on a personal machine with stable outbound
  internet; no high-availability requirements.
