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
  | { kind: "page"; view: ViewName; page: number }
  | { kind: "back" };

export interface PickerOption {
  label: string;
  action: KeyboardAction;
}

interface MenuState {
  view: ViewName;
  options: PickerOption[];
  /** Zero-based page this picker message was rendered for (pagination). */
  page: number;
  /** VK message ids carrying this picker's inline keyboard (self-delete). */
  messageIds: number[];
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
  menus.set(id, { view: "main", options: [], page: 0, messageIds: [] });
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
export function registerPicker(view: ViewName, options: PickerOption[], page = 0): string {
  const id = createMenuId();
  menus.set(id, { view, options, page, messageIds: [] });
  return id;
}

/** Remembers which VK messages carry a picker's keyboard (FR-116). */
export function attachPickerMessages(menuId: string, messageIds: number[]): void {
  const state = menus.get(menuId);
  if (state) {
    state.messageIds = [...messageIds];
  }
}

/** Message ids of a still-registered picker (nav taps must not consume it). */
export function peekPickerMessages(menuId: string): number[] {
  const state = menus.get(menuId);
  return state ? [...state.messageIds] : [];
}

export interface VkKeyboard {
  inline?: boolean;
  buttons: Array<Array<{ action: { type: "text" | "callback"; label: string; payload?: string } }>>;
}

/**
 * VK clients skip re-rendering a reply keyboard whose `buttons` JSON is
 * identical to the currently shown one, so a tapped button keeps its
 * pressed highlight forever. Two counters here force a real redraw:
 * 1. `payload` is present on every text button (the documented schema
 *    expects it) and carries a monotonic sequence number, so the buttons
 *    JSON differs on every action while the visible labels stay identical;
 * 2. the top-level `inline: false` marker alternates as well (both shapes
 *    mean "reply keyboard").
 * Text buttons deliver only their label, so the payload never reaches the
 * bot and does not affect the label → command mapping.
 */
let keyboardSeq = 0;
let alternateReplyKeyboardShape = false;

function textButton(label: string): {
  action: { type: "text"; label: string; payload: string };
} {
  keyboardSeq += 1;
  return {
    action: {
      type: "text",
      label,
      payload: JSON.stringify({ cmd: resolveButtonText(label), n: keyboardSeq }),
    },
  };
}

function withRedrawToggle(keyboard: VkKeyboard): VkKeyboard {
  alternateReplyKeyboardShape = !alternateReplyKeyboardShape;
  return alternateReplyKeyboardShape ? { inline: false, ...keyboard } : keyboard;
}

export function buildMainReplyKeyboard(): VkKeyboard {
  return withRedrawToggle({
    buttons: MAIN_LABELS.map((row) => row.map((label) => textButton(label))),
  });
}

export function buildRunKeyboard(): VkKeyboard {
  return withRedrawToggle({
    buttons: [
      [
        textButton("⏹ Стоп"),
        textButton("📊 Статус"),
        textButton(MAIN_HINT_LABEL),
      ],
    ],
  });
}

/** VK hard limit verified live: 6 rows per keyboard (7th = error 911);
 * option rows + one nav row must fit. */
export const MAX_PICKER_OPTIONS = 5;

export interface PickerNav {
  hasPrev: boolean;
  hasNext: boolean;
}

/** Inline picker: one row per option (≤5) + a nav row (≤6 rows total,
 * verified platform limit). Without nav the last row is just the back
 * button; with nav it holds «◀️ / ⬅️ Меню / ▶️» (only enabled directions). */
export function buildInlinePickerKeyboard(
  menuId: string,
  options: PickerOption[],
  nav?: PickerNav,
): VkKeyboard {
  const rows = options.slice(0, MAX_PICKER_OPTIONS).map((option, index) => [
    {
      action: {
        type: "callback" as const,
        label: option.label,
        payload: JSON.stringify({ v: 1, k: "pick", m: menuId, x: index }),
      },
    },
  ]);
  const navButtons: Array<{
    action: { type: "callback"; label: string; payload: string };
  }> = [];
  if (nav?.hasPrev) {
    navButtons.push({
      action: {
        type: "callback",
        label: "◀️",
        payload: JSON.stringify({ v: 1, k: "prev", m: menuId, x: 0 }),
      },
    });
  }
  navButtons.push({
    action: {
      type: "callback",
      label: "⬅️ Меню",
      payload: JSON.stringify({ v: 1, k: "back", m: menuId, x: 0 }),
    },
  });
  if (nav?.hasNext) {
    navButtons.push({
      action: {
        type: "callback",
        label: "▶️",
        payload: JSON.stringify({ v: 1, k: "next", m: menuId, x: 0 }),
      },
    });
  }
  rows.push(navButtons);
  // Without inline:true VK treats this as a reply keyboard (text buttons).
  return { inline: true, buttons: rows as VkKeyboard["buttons"] };
}

export function isKeyboardWithinBudget(keyboard: VkKeyboard): boolean {
  return Buffer.byteLength(JSON.stringify(keyboard), "utf8") <= MAX_KEYBOARD_BYTES;
}

/** Label → command mapping so reply-keyboard taps equal typed commands
 * (FR-112): every reply-keyboard label maps to an action; no label may
 * leak to the agent as prompt text. */
const LABEL_TO_COMMAND = new Map<string, string>([
  ["🆕 Новая", "/new"],
  ["📋 Сессии", "/sessions"],
  ["📊 Статус", "/status"],
  ["📁 Проекты", "/projects"],
  ["🤖 Модели", "/models"],
  ["⏹ Стоп", "/abort"],
  ["🏠 Меню", "/menu"],
  ["❓ Помощь", "/help"],
]);

/** Maps a reply-keyboard button label to its command; passthrough otherwise. */
export function resolveButtonText(text: string): string {
  return LABEL_TO_COMMAND.get(text.trim()) ?? text;
}

export interface InlineTap {
  menuId: string;
  index: number;
  kind: "pick" | "back" | "prev" | "next";
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
  if (raw.k === "prev") {
    return { menuId, index, kind: "prev" };
  }
  if (raw.k === "next") {
    return { menuId, index, kind: "next" };
  }
  return null;
}

/**
 * Returns the stored action for a validated inline tap. Pick/back consume
 * the menu (a second tap is stale) and report the picker's message ids so
 * the caller can self-delete them (FR-116); prev/next keep the menu alive
 * so the owner can page repeatedly from the same message.
 */
export function resolveInlineTap(tap: InlineTap): {
  action?: KeyboardAction;
  stale: boolean;
  messageIds: number[];
} {
  const state = menus.get(tap.menuId);
  if (!state) {
    return { stale: true, messageIds: [] };
  }
  if (tap.kind === "back") {
    menus.delete(tap.menuId);
    return { stale: false, action: { kind: "back" }, messageIds: [...state.messageIds] };
  }
  if (tap.kind === "prev" || tap.kind === "next") {
    const delta = tap.kind === "next" ? 1 : -1;
    return {
      stale: false,
      action: { kind: "page", view: state.view, page: state.page + delta },
      messageIds: [],
    };
  }
  const option = state.options[tap.index];
  if (!option) {
    return { stale: true, messageIds: [] };
  }
  menus.delete(tap.menuId);
  return { stale: false, action: option.action, messageIds: [...state.messageIds] };
}
