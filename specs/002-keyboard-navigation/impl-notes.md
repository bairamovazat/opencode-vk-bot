# Implementation Notes: 002-keyboard-navigation

## 2026-09-07 — Live bring-up findings (VK platform facts, verified by probes)

- Reply keyboards and INLINE keyboards have different limits. Verified by
  direct API probes on the live community:
  - INLINE: max **6 rows** (7+ rows → error 911 "too much rows");
    10 options per view do not fit → pickers show 5 options + back row.
  - The old 1000-byte budget guess was wrong in practice for larger
    keyboards; the byte budget is now 10000 (still asserted in tests).
- Inline keyboards REQUIRE "inline": true — without it VK silently treats
  the keyboard as a reply keyboard: no keyboard field in history and taps
  arrive as plain text (this caused "Проекты ничего не происходит").
- Long Poll message_event delivers payload as an ALREADY PARSED object
  (not a JSON string) — normalizer accepts both shapes now.
- Handler errors inside pollOnce are retried with backoff and the event is
  skipped after 3 failed attempts (anti-poison guard; ts checkpoints after).

## Live state

- Main reply keyboard: 3 rows (Новая/Сессии/Статус, Проекты/Модели/Стоп,
  Помощь) — stable, well under limits.
- Pickers (sessions/projects/models): inline keyboards, 5 options + back,
  stale taps → main keyboard + hint (FR-108).
- Run view: 1 row (Стоп/Статус/Меню) attached to the run-started notice;
  main view returns with the final reply / abort confirmation.

## 2026-09-07 — Iteration 2: flow failures fixed and verified live

Owner-reported dead ends, all root-caused and fixed:
- "Выбрал сессию — ничего не происходит": Long Poll delivers message_event
  payloads as parsed objects; the normalizer only accepted strings, so every
  picker tap was silently dropped. Fixed in events.ts (FR-111).
- "Кнопка Меню назад не работает": tap actions resolved the peer from the
  bot's last-seen message instead of the event; after a restart the peer was
  null and taps no-oped. Fixed in index.ts (performKeyboardAction takes the
  event's peerId, FR-111).
- "⏹ Стоп" и «🏠 Меню» уходили агенту как текст: the router resolved labels
  to commands but passed the raw label to the abort check, and «🏠 Меню» had
  no mapping at all. Fixed in router.ts/keyboards.ts (FR-112).
- "При /new нельзя выбрать проект": /new now opens the project picker when
  more than one project exists (F2, US5).
- Owner abort suppression was dead code (two unrelated session-id sets);
  wired VkBot.abortedSessionIds to the abort path (F6.1).
- FR-101: every management reply now attaches the main keyboard; an empty
  run result still returns the main view (vk.run_finished_empty).

Live verification (real token/group, VK_SELF_TEST loop + probes):
- `scripts/vk-live-probe.mjs`: main/run/inline keyboards accepted by VK API.
- `scripts/vk-live-smoke.mjs`: long poll ran clean (read-only).
- `scripts/vk-live-selftest.mjs`: /help, /status, 📋 Сессии picker, and a
  full prompt round-trip (session created → promptAsync → run view →
  final answer) — all through the fixed build, 0 ERROR lines.

## 2026-09-07 — Iteration 3: picker totals + pagination

- Pickers (sessions/projects/models, /new project choice) now show the
  total count in the header: «Всего: {total}», and when paging
  «Всего: {total} · стр. {page} из {pages}» (vk.picker_total,
  vk.picker_total_pages).
- 5 options per page + a nav row (6 rows total, platform limit): page 0 →
  [⬅️ Меню, ▶️], middle → [◀️, ⬅️ Меню, ▶️], last → [◀️, ⬅️ Меню].
- Nav taps (k: prev/next) do NOT consume the menu — repeated paging from
  the same message works; pick/back still consume. Out-of-range pages are
  clamped to the last available page; stale nav taps answer with the
  outdated hint + main keyboard.
- /sessions fetches up to 100 entries (limit raised from 10) so the total
  is real; the OpenCode SDK returns them newest-first.
- Page taps re-render the picker as a fresh message via the real command
  handlers (fresh data each time).
- Verified live: /sessions rendered «Всего: 10 · стр. 1 из 2» with the nav
  row, VK accepted the keyboard (no 911/912).

## 2026-09-07 — Iteration 4: honest stop, mute runs, live tool progress

- «⏹ Стоп» is idempotent: abort fires only when the bound session is
  busy on the server (session.status). Idle/absent session → «Нет
  запущенной задачи.»; unknown state (API error) → abort attempted anyway.
  Fixes the repeated «Задача остановлена» on a dialog with no run.
- Silent during a run (FR-114): run-started notice and the live status
  line carry disable_notification; the final reply / run error notify.
- Live progress (FR-115): one throttled (3 s) status line shows the
  current tool + compact context (filePath/command/query… extracted from
  the tool part input, ≤60 chars) + action count; first activity renders
  immediately. The line is deleted when the run ends.
- Button "pressed" state: inline buttons clear their spinner via
  messages.sendMessageEventAnswer BEFORE the action runs (menus.ts). For
  REPLY-keyboard buttons (Стоп/Статус/Меню/…) VK has no API to reset the
  client-side pressed style — the old picker messages with used buttons
  also cannot be edited (VK forbids bot message edits in this setup). This
  is a platform limitation, not a bug: each new reply re-attaches the
  correct keyboard.

## 2026-09-07 — Iteration 5: question text, self-deleting menus

- Question prompts now show the full question text under the header
  (previously only «❓ {header}» — the actual question was invisible).
- FR-116, self-deleting menus: consumed one-shot messages are removed via
  messages.delete (best-effort) — picker after pick/back, the previous
  page after «▶️»/«◀️», each answered question, resolved permission
  prompt. Rationale: VK never clears the tapped-button highlight on old
  messages and cannot edit bot messages, so dead keyboards looked "stuck
  white"; deleting them removes the dead buttons entirely.
- Reply-keyboard buttons (main/run view) are TEXT buttons: the VK API has
  no way to reset the client-side pressed style. Every management reply
  re-attaches the keyboard; any residual highlight is client-side only.
- Live log check before the fix: 0 sendMessageEventAnswer failures — the
  spinner-clear API worked; the highlight was purely the stale message.

## 2026-09-07 — Iteration 6: reply-keyboard highlight reset

Owner report: after tapping «Новая» (and other reply-keyboard buttons) the
button keeps its pressed/gray highlight even after the reply. Root cause:
VK clients skip re-rendering a reply keyboard whose JSON is identical to
the currently shown one, and our keyboard JSON never changed.

Fix: buildMainReplyKeyboard/buildRunKeyboard alternate an innocuous no-op
field (explicit `inline: false` vs absent — both mean "reply keyboard")
so every action delivers a structurally new keyboard, forcing a client
redraw that clears the highlight. Labels and rows are untouched (button
mapping depends on exact labels). If the highlight still persists after
this, it is fully client-side and unfixable from the bot API.

## 2026-09-07 — Iteration 6b: real keyboard redraw (payload per button)

Iteration 6 (alternating top-level `inline: false`) did NOT reset the
tapped-button highlight: the client evidently compares/normalizes beyond
that no-op field. Corrected per the documented keyboard schema — `payload`
is expected on button actions, including `type: "text"`:

- every reply-keyboard text button now carries
  `payload = {"cmd": "<command>", "n": <monotonic seq>}`;
- the sequence number makes the `buttons` JSON differ on EVERY action, so
  the client receives a genuinely new keyboard and must re-render it
  (labels are unchanged; text buttons deliver only their label, so the
  payload never reaches the bot and the label→command map is unaffected);
- the `inline: false` alternation is kept as a secondary shape toggle.

Verified live: VK accepts the payload-carrying text buttons (no 911/912).
If the highlight STILL persists after this, the pressed style is fully
client-side and unreachable from the bot API.
