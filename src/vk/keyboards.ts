import { isRecord } from "../utils/type-guards.js";

/**
 * Reply-keyboard navigation (specs/002-keyboard-navigation): a per-dialog
 * view state machine.
 *
 * Layout rules learned live:
 * - reply keyboards are limited in rows (VK error 911) -> only the stable
 *   main menu (3 rows) and the run view (1 row) use them;
 * - pickers (sessions/projects/models) use INLINE button keyboards inside
 *   a message; taps arrive as message_event with a payload object.
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

interface MenuState {
  view: ViewName;
  options: PickerOption[];
}

const MAX_KEYBOARD_BYTES = 10000;

const MAIN_LABELS: string[][] = [
  ["🆕 Новая", "📋 Сессии", "📊 Статус"],
  ["📁 Проекты", "🤖 Модели", "⏹ Стоп"],
  ["❓ Помощь"],
];

const MAIN_HINT_LABEL = "🏠 Меню";

/** menuId -> state (inline picker taps resolve through this). */
const menus = new Map<string, MenuState>();
/** peerId -> current view (reply-keyboard layout + free-text semantics). */
const views = new Map<number, ViewName>();
let menuSeq = 0;

function createMenuId(): string {
  menuSeq += 1;
  const id = `m${menuSeq}`;
  if (menus.size >= 32) {
    const oldest = menus.keys().next().value;
    if (oldest !== undefined) {
      menus.delete(oldest);
    }
  }
  menus.set(id, { view: "main", options: [] });
  return id;
}

export function setView(peerId: number, view: ViewName, options: PickerOption[] = []): void {
  views.set(peerId, view);
  void options;
}

export function getView(peerId: number): ViewName {
  return views.get(peerId) ?? "main";
}

/** Registers picker options and returns the menu id for inline payloads. */
export function registerPicker(view: ViewName, options: PickerOption[]): string {
  const id = createMenuId();
  menus.set(id, { view, options });
  return id;
}

export interface VkKeyboard {
  inline?: boolean;
  buttons: Array<Array<{ action: { type: "text" | "callback"; label: string; payload?: string } }>>;
}

export function buildMainReplyKeyboard(): VkKeyboard {
  return {
    buttons: MAIN_LABELS.map((row) =>
      row.map((label) => ({ action: { type: "text" as const, label } })),
    ),
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

/** VK hard limit verified live: 6 rows per keyboard (7th = error 911);
 * one row is reserved for the back button. */
const MAX_PICKER_OPTIONS = 5;

/** Inline picker: one row per option (≤9) + back row (≤10 rows total). */
export function buildInlinePickerKeyboard(menuId: string, options: PickerOption[]): VkKeyboard {
  const rows = options.slice(0, MAX_PICKER_OPTIONS).map((option, index) => [
    {
      action: {
        type: "callback" as const,
        label: option.label,
        payload: JSON.stringify({ v: 1, k: "pick", m: menuId, x: index }),
      },
    },
  ]);
  rows.push([
    {
      action: {
        type: "callback" as const,
        label: "⬅️ Меню",
        payload: JSON.stringify({ v: 1, k: "back", m: menuId, x: 0 }),
      },
    },
  ]);
  // Without inline:true VK treats this as a reply keyboard (text buttons).
  return { inline: true, buttons: rows as VkKeyboard["buttons"] };
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
]);

/** Maps a reply-keyboard button label to its command; passthrough otherwise. */
export function resolveButtonText(text: string): string {
  return LABEL_TO_COMMAND.get(text.trim()) ?? text;
}

export interface InlineTap {
  menuId: string;
  index: number;
  kind: "pick" | "back";
}

/** Parses an inline button payload (message_event.object.payload). */
export function parseInlinePayload(payload: unknown): InlineTap | null {
  const raw = isRecord(payload) ? payload : null;
  if (!raw || raw.v !== 1) {
    return null;
  }
  const menuId = typeof raw.m === "string" ? raw.m : null;
  const index = typeof raw.x === "number" ? raw.x : -1;
  if (!menuId || index < 0) {
    return null;
  }
  if (raw.k === "pick") {
    return { menuId, index, kind: "pick" };
  }
  if (raw.k === "back") {
    return { menuId, index, kind: "back" };
  }
  return null;
}

/** Returns the stored action for a validated inline tap. */
export function resolveInlineTap(tap: InlineTap): { action?: KeyboardAction; stale: boolean } {
  const state = menus.get(tap.menuId);
  if (!state) {
    return { stale: true };
  }
  if (tap.kind === "back") {
    menus.delete(tap.menuId);
    return { stale: false, action: { kind: "back" } };
  }
  const option = state.options[tap.index];
  if (!option) {
    return { stale: true };
  }
  menus.delete(tap.menuId);
  return { stale: false, action: option.action };
}
