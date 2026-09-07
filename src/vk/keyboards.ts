
/**
 * Reply-keyboard navigation (specs/002-keyboard-navigation): a per-dialog
 * view state machine. Every bot navigation message carries the NEXT view's
 * keyboard; taps are resolved against stored option identities, never
 * against live lookups.
 */

export type ViewName = "main" | "sessions" | "projects" | "models" | "run";

export type KeyboardAction =
  | { kind: "resume-session"; id: string; title: string; directory: string }
  | { kind: "switch-project"; id: string; name: string }
  | { kind: "switch-model"; providerID: string; modelID: string; label: string }
  | { kind: "back" };

export interface PickerOption {
  label: string;
  action: KeyboardAction;
}

interface DialogViewState {
  view: ViewName;
  options: PickerOption[];
}

const MAX_BUTTONS = 10;
const MAX_KEYBOARD_BYTES = 1000;

const BACK_LABEL = "⬅️ Меню";
const MAIN_HINT_LABEL = "🏠 Меню";

/** Per-peer view state; defaults to main (safe after restart). */
const views = new Map<number, DialogViewState>();

export function setView(peerId: number, view: ViewName, options: PickerOption[] = []): void {
  views.set(peerId, { view, options });
}

export function getView(peerId: number): DialogViewState {
  return views.get(peerId) ?? { view: "main", options: [] };
}

export interface VkKeyboard {
  buttons: Array<Array<{ action: { type: "text"; label: string } }>>;
}

export function buildMainReplyKeyboard(): VkKeyboard {
  return {
    buttons: [
      [
        { action: { type: "text", label: "🆕 Новая" } },
        { action: { type: "text", label: "📋 Сессии" } },
        { action: { type: "text", label: "📊 Статус" } },
      ],
      [
        { action: { type: "text", label: "📁 Проекты" } },
        { action: { type: "text", label: "🤖 Модели" } },
        { action: { type: "text", label: "⏹ Стоп" } },
      ],
      [{ action: { type: "text", label: "❓ Помощь" } }],
    ],
  };
}

export function buildRunKeyboard(): VkKeyboard {
  return {
    buttons: [
      [
        { action: { type: "text", label: "⏹ Стоп" } },
        { action: { type: "text", label: "📊 Статус" } },
        { action: { type: "text", label: MAIN_HINT_LABEL } },
      ],
    ],
  };
}

export function buildPickerKeyboard(options: PickerOption[]): VkKeyboard {
  const rows = options.slice(0, MAX_BUTTONS).map((option) => [
    { action: { type: "text", label: option.label } },
  ]);
  rows.push([{ action: { type: "text", label: BACK_LABEL } }]);
  return { buttons: rows as VkKeyboard["buttons"] };
}

export function isKeyboardWithinBudget(keyboard: VkKeyboard): boolean {
  return Buffer.byteLength(JSON.stringify(keyboard), "utf8") <= MAX_KEYBOARD_BYTES;
}

/** Label → command mapping so reply-keyboard taps equal typed commands. */
const LABEL_TO_COMMAND = new Map<string, string>([
  ["🆕 Новая", "/new"],
  ["📋 Сессии", "/sessions"],
  ["📊 Статус", "/status"],
  ["📁 Проекты", "/projects"],
  ["🤖 Модели", "/models"],
  ["⏹ Стоп", "/abort"],
  ["❓ Помощь", "/help"],
  ["⏹ Стоп (текущая задача)", "/abort"],
]);

/** Maps a reply-keyboard button label to its command; passthrough otherwise. */
export function resolveButtonText(text: string): string {
  return LABEL_TO_COMMAND.get(text.trim()) ?? text;
}

export interface TapResolution {
  /** "action" — a picker/back tap was handled; "passthrough" — not a tap. */
  kind: "action" | "passthrough";
  action?: KeyboardAction;
}

/**
 * Resolves a free incoming text against the current view: picker options
 * and the back button are taps; everything else is passthrough (free text
 * goes to the agent, view resets to main per FR-107).
 */
export function resolveKeyboardTap(peerId: number, text: string): TapResolution {
  const trimmed = text.trim();
  const state = views.get(peerId);

  if (state && state.view !== "main") {
    if (trimmed === BACK_LABEL || trimmed === MAIN_HINT_LABEL) {
      setView(peerId, "main");
      return { kind: "action", action: { kind: "back" } };
    }
    const option = state.options.find((candidate) => candidate.label === trimmed);
    if (option) {
      return { kind: "action", action: option.action };
    }
    // Free text inside a picker: reset to main, let the text flow onward.
    setView(peerId, "main");
    return { kind: "passthrough" };
  }

  return { kind: "passthrough" };
}
