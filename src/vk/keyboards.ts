/** Persistent reply keyboard with command buttons (no typing required). */

const MAIN_BUTTONS: Array<Array<{ label: string; command: string }>> = [
  [
    { label: "🆕 Новая", command: "/new" },
    { label: "📋 Сессии", command: "/sessions" },
    { label: "📊 Статус", command: "/status" },
  ],
  [
    { label: "📁 Проекты", command: "/projects" },
    { label: "🤖 Модели", command: "/models" },
    { label: "⏹ Стоп", command: "/abort" },
  ],
  [{ label: "❓ Помощь", command: "/help" }],
];

/** Label → command mapping for text-button taps. */
const LABEL_TO_COMMAND = new Map<string, string>(
  MAIN_BUTTONS.flatMap((row) => row.map((button) => [button.label, button.command])),
);

/** Maps a reply-keyboard button label to its command; passthrough otherwise. */
export function resolveButtonText(text: string): string {
  return LABEL_TO_COMMAND.get(text.trim()) ?? text;
}

export function buildMainReplyKeyboard(): { buttons: Array<Array<{ action: { type: "text"; label: string } }>> } {
  return {
    buttons: MAIN_BUTTONS.map((row) =>
      row.map((button) => ({ action: { type: "text", label: button.label } })),
    ),
  };
}
