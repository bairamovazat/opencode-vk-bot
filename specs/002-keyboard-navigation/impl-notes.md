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
