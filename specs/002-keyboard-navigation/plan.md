# Implementation Plan: Reply-Keyboard Navigation

**Branch**: `001-vk-bot-port` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-keyboard-navigation/spec.md`

## Summary

Replace command typing with a view-based reply-keyboard navigation layer:
per-dialog keyboard views (main / sessions / projects / models / run),
identity-resolved picker taps, automatic run-view switching, free text
always reaching the agent.

## Technical Context

**Language/Version**: TypeScript 5.x strict, ESM, Node.js 22.14+
**Primary Dependencies**: none new (existing VK transport)
**Storage**: in-memory per-dialog view state (safe default after restart)
**Testing**: Vitest, AAA + vi.mock boundaries
**Target Platform**: existing VK transport process
**Performance Goals**: view switch = one message with replacement keyboard
**Constraints**: keyboard JSON ≤1000 bytes, ≤10 buttons per view, ≤1
keyboard replacement per navigation action (FR-110)

## Constitution Check

| Principle | Status | Evidence |
|---|---|---|
| I. Platform-Agnostic Core | PASS | all changes in `src/vk/` |
| II. Direct API, Minimal Dependencies | PASS | no new deps |
| III. Security First | PASS | picker taps resolve stored identities; no new inbound surface |
| IV. Test-First | PASS | view store + resolution tests before wiring |
| V. Surgical Port | PASS | shared layers untouched; typed /commands keep working |

## Project Structure

```text
src/vk/
├── keyboards.ts        # EXTEND: views, builders, per-dialog view store
├── commands/router.ts  # EXTEND: route button labels through view store
├── handlers/message-new.ts  # EXTEND: resolve button taps first
└── index.ts            # EXTEND: run view switching hooks
tests/vk/keyboards.test.ts   # NEW
```

## Post-Design Constitution Re-Check

All principles re-checked after design: PASS (no changes outside src/vk).

## Key design decisions

- **D1**: Keyboard views are a small state machine per dialog:
  `main | sessions | projects | models | run`. Store: `{view, options[]}`
  in memory (Map per peer id).
- **D2**: Tap resolution: when a message text matches the stored options of
  the current view → dispatch the stored identity; otherwise free text →
  prompt (and view resets to main per FR-107).
- **D3**: Every picker/bot navigation message carries the NEXT view's
  keyboard (one replacement per action, FR-110).
- **D4**: Run view switch is driven by the existing run lifecycle hooks
  (onRunStarted → run view; onComplete/onError/abort → main).
