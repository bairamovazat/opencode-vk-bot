# opencode-vk-bot

VK bot client for [OpenCode](https://opencode.ai): run and monitor coding
tasks from a VK chat while everything executes locally on your machine.

This repository is a fork of
[grinev/opencode-telegram-bot](https://github.com/grinev/opencode-telegram-bot)
ported to VK. The platform-agnostic core (`src/app/`, `src/opencode/`) and
the i18n layer are kept close to upstream; the transport is VK-only
(`src/vk/`) using the Bots Long Poll protocol — outbound connections only,
no public endpoint required.

## Status

- Core loop live-verified: text/voice → agent → reply, live status,
  /abort, /sessions, /status, /projects, /models, attachments, buttons.
- Development follows spec-driven workflow (`.specify/`, `specs/`).

## Requirements

- Node.js 22.14+
- A VK community with **Bot features** enabled and **Bots Long Poll** turned on
- A community access token with **Manage** + **Messages** scopes
- `opencode serve` reachable locally

## Setup

```bash
npm ci
cp .env.example .env   # fill VK_GROUP_TOKEN, VK_GROUP_ID, VK_ALLOWED_USER_ID
npm run build
npm start
```

Never commit `.env` — secrets live only on your machine.

## VK community settings checklist

1. Управление → Сообщения → Настройки → **Возможности ботов: включены**
2. Управление → Настройки → Работа с API → **Bots Long Poll: включён**
3. Access token scopes: **Управление сообществом**, **Сообщения сообщества**

## Scripts

- `npm run build` / `npm run lint` / `npm run typecheck` / `npm test`
- `npm run guard:secrets` — scan staged diffs for tokens before push

## Security

Public repository: tokens and credentials exist only in your local `.env`.
See `.specify/memory/constitution.md` (principle III) for the rules and
`specs/001-vk-bot-port/` for the full spec, plan and task breakdown.
