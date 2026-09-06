# Contract: Inline Button Payloads (VK `message_event.payload`)

**Feature**: 001-vk-bot-port | **Date**: 2026-09-06

VK delivers button taps as `message_event` updates with `payload` — a
JSON **string**, budget ≤ 255 bytes **[verify-at-impl]**. The payload is
the whole contract between keyboards (`src/vk/keyboards.ts`) and the
callback router (`src/vk/callbacks.ts`).

## Envelope

```json
{ "v": 1, "k": "<kind>", "s": "<state_key>", "a": "<action>", "x": <option> }
```

| Key | Type | Req | Meaning |
|---|---|---|---|
| `v` | int | yes | payload schema version (migration safety) |
| `k` | string | yes | menu kind: `sess` sessions, `prj` projects, `mdl` models, `agn` agents, `prm` permission, `q` question, `cfm` confirm |
| `s` | string | yes | opaque state handle into MenuBinding store (short id, not serialized state) |
| `a` | string | yes | action: `pick`, `page`, `cancel`, `refresh` |
| `x` | int/string | no | option index / page number |

Large values (titles, lists, permission bodies) NEVER travel in the
payload — they live in the MenuBinding state store keyed by `s`.

## Actions per kind

| kind | valid actions | handler effect |
|---|---|---|
| `sess` | pick, page | resume session / paginate list |
| `prj` | pick, page | switch project / paginate |
| `mdl` | pick, page, refresh | set model / paginate / reload provider list |
| `agn` | pick, page | set agent |
| `prm` | pick (`x` = 0 deny, 1 allow) | answer OpenCode permission; menu resolves (single-use) |
| `q` | pick (`x` = option idx) | answer OpenCode question; menu resolves |
| `cfm` | pick (`x` = 0 no, 1 yes) | generic confirm (rename, detach, worktree-deferred ops) |

## Router rules (FR-006, spec edge cases)

1. Unknown `v`, `k`, `a`, or missing `s` → ignore + debug log (no reply).
2. `s` not found (restart/expired) → send polite "outdated menu" notice
   once, then ignore further taps of that message.
3. Resolved menu tapped again → clear spinner
   (`messages.sendMessageEventAnswer`), no other effect.
4. Every processed tap MUST clear the spinner; failure to clear is logged.
5. Every handler MUST be idempotent: duplicate `event_id` is dropped by
   the events layer before routing (D6).
