<!--
SYNC IMPACT REPORT
==================
Version change: (none) → 1.0.0
Modified principles: (initial ratification)
Added sections:
  - Core Principles (I–V): Platform-Agnostic Core; Direct API, Minimal
    Dependencies; Security First (Public Repository); Test-First for Core
    Logic; Surgical Port & Upstream Compatibility
  - Additional Constraints
  - Development Workflow & Quality Gates
  - Governance
Removed sections: (none)
Follow-up TODOs: (none)
-->

# opencode-vk-bot Constitution

## Core Principles

### I. Platform-Agnostic Core

The OpenCode integration layer (`src/app/`, `src/opencode/`) MUST remain
free of messenger-specific imports, types, and formatting. All VK-specific
code (transport, keyboards, callbacks, message rendering) MUST live under
`src/vk/` and its dedicated render utilities. A future second transport
(e.g. Telegram) MUST be addable without touching `src/app/` or
`src/opencode/`. Rationale: the fork is a port of opencode-telegram-bot;
keeping the seam clean preserves upstream merges and keeps the port surface
explicit and reviewable.

### II. Direct API, Minimal Dependencies

VK is integrated via raw HTTPS calls (`fetch`) against the VK API and the
Bots Long Poll protocol. Third-party VK SDKs or bot frameworks MUST NOT be
introduced. A new runtime dependency is allowed only when: (a) the standard
library cannot do the job, (b) the package is actively maintained, and
(c) the need is documented in the plan artifact. Rationale: the VK bot
surface is small (long poll loop, message send, keyboard attach, file
upload); a thin internal client is easier to audit, test, and keep
dependency-free than a framework.

### III. Security First (Public Repository)

The repository is public; every pushed byte is a disclosure risk.
Non-negotiable rules:

- Secrets (VK access/confirmation/secret tokens, OpenCode credentials,
  API keys) exist only in `.env`, which MUST stay gitignored; only
  placeholder `.env.example` files are committed.
- Code, config, docs, logs, tests, and git history MUST NOT contain real
  tokens, chat identifiers of private accounts, or machine paths that
  disclose identity.
- The bot MUST verify incoming events (VK `secret` / confirmation
  handshake) and MUST restrict control to an allowlisted user ID
  (`VK_ALLOWED_USER_ID`), mirroring `TELEGRAM_ALLOWED_USER_ID`.
- Errors shown to the user MUST NOT include stack traces, tokens, or
  internal URLs.
- A secrets scan (`git grep` patterns or equivalent) MUST run before every
  push; CI SHOULD enforce it.

### IV. Test-First for Core Logic

Business logic — long-poll event normalization, message chunking,
keyboard/callback routing, retry/backoff, session mapping — MUST have unit
tests written in Vitest before or alongside implementation, following the
Arrange-Act-Assert style and `vi.mock()` boundaries already used in
`tests/`. Pure formatting/rendering functions MUST be tested against VK
hard limits (message length, keyboard JSON size). Rationale: the port
replaces a transport layer; regressions are cheapest to catch at the seam.

### V. Surgical Port & Upstream Compatibility

This repository is a fork of grinev/opencode-telegram-bot with
`upstream` configured. Every changed line MUST trace to the VK port goal.
The Telegram layer (`src/bot/`) is replaced, not modified in place; shared
layers (`src/app/`, `src/opencode/`, `src/i18n/`, `src/utils/`) are kept
byte-identical to upstream whenever possible so future
`git fetch upstream` merges stay cheap. Dead code left by the Telegram
removal MUST be removed in the same change that orphans it. Unrelated
upstream bugs are reported upstream, not silently patched here.

## Additional Constraints

- **Language**: TypeScript strict mode, ESM, Node.js 22.14+ (matches
  upstream `engines`). ESLint + Prettier must pass with zero warnings.
- **i18n**: user-facing strings go through `src/i18n/`; Russian (`ru`) is
  the primary locale for this fork and MUST be complete before release;
  other locales inherited from upstream SHOULD be updated opportunistically.
- **VK platform limits** are first-class constraints, not afterthoughts:
  outgoing message text ≤ 4000 characters (VK hard cap 4096), keyboard JSON
  ≤ 1000 characters with ≤ 10 buttons total, Long Poll `wait` ≤ 90 s, and
  VK API rate limits (~20 requests/s per group) shape batching and retry
  policy.
- **Process**: the bot runs as a local process next to `opencode serve`;
  it MUST NOT require inbound ports (Long Poll is outbound-only), which
  keeps it deployable behind NAT without tunnels.
- **Commits**: Conventional Commits style, in English, referencing the
  feature slug from `specs/` when applicable. Commits happen only on
  explicit request.

## Development Workflow & Quality Gates

- **Spec-Driven Development** (Spec Kit): features follow
  `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` →
  `/speckit.implement` → `/speckit.converge`. A feature enters
  implementation only with an approved plan artifact under `specs/`.
- **Quality gates before any commit**: `npm run build`, `npm run lint`,
  `npm run typecheck`, `npm test` — all green.
- **Secrets gate before any push**: scan staged files and history slice for
  token patterns (VK tokens, bearer keys, private-key PEM blocks).
- **Upstream sync**: periodic `git fetch upstream && git merge upstream/main`
  or rebase; conflicts in replaced layers resolve in favor of the VK port;
  conflicts in shared layers resolve in favor of upstream.

## Governance

- This constitution supersedes ad-hoc practices; conflicts between a task
  instruction and this document resolve in favor of the constitution until
  it is amended.
- Amendments: propose in a commit touching this file, update
  `LAST_AMENDED_DATE`, increment `CONSTITUTION_VERSION` (MAJOR = principle
  removal/redefinition, MINOR = new principle or material expansion,
  PATCH = wording/clarification), and record the change in the Sync Impact
  Report comment.
- Compliance review: every `/speckit.converge` and every PR review checks
  changes against Principles I–V; violations block merge.
- Runtime development guidance lives in `AGENTS.md`; `AGENTS.md` MUST stay
  consistent with this constitution.

**Version**: 1.0.0 | **Ratified**: 2026-09-06 | **Last Amended**: 2026-09-06
