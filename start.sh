#!/bin/bash
# Запуск opencode-vk-bot после перезагрузки: сервер агента + сам бот.
set -e
cd "$(dirname "$0")"

# 1. OpenCode backend (если ещё не запущен)
if ! curl -s --max-time 3 http://localhost:4096/global/health > /dev/null; then
  echo "[start] Запускаю opencode serve..."
  nohup "$HOME/.opencode/bin/opencode" serve > /tmp/opencode-serve.log 2>&1 &
  sleep 4
fi

# 2. Бот (если ещё не запущен)
if pgrep -f "node dist/index.js" > /dev/null; then
  echo "[start] Бот уже работает."
  exit 0
fi

echo "[start] Собираю и запускаю бота..."
npm run build --silent
nohup npm start > /tmp/opencode-vk-bot.log 2>&1 &
sleep 5
LOG=$(ls -t logs | head -1)
if grep -q "Starting long poll loop" "logs/$LOG"; then
  echo "[start] Бот работает. Лог: logs/$LOG"
else
  echo "[start] Проверь лог: logs/$LOG (хвост: tail -20 logs/$LOG)"
fi
