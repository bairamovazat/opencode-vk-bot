import { isRecord } from "../utils/type-guards.js";
import { logger } from "../utils/logger.js";
import { t } from "../i18n/index.js";
import { opencodeClient } from "../opencode/client.js";
import type { VkApiClient } from "./client.js";
import type { NormalizedButtonEvent } from "./events.js";
import type { VkSender } from "./send.js";
import { sendMessageEventAnswer } from "./callbacks.js";

/** Payload schema version (contracts/callback-payloads.md). */
const PAYLOAD_VERSION = 1;
/** VK inline keyboard budget: conservative self-imposed caps (spec FR limits). */
const MAX_BUTTONS = 10;
const MAX_KEYBOARD_BYTES = 1000;
/** VK button payload string budget (asserted in tests via pack size). */
export const MAX_PAYLOAD_BYTES = 255;

export interface PermissionMenuData {
  kind: "prm";
  requestId: string;
  directory: string;
  tool: string;
  patterns: string[];
}

export interface QuestionMenuData {
  kind: "q";
  requestId: string;
  directory: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
  }>;
  currentIndex: number;
  answers: Array<string[]>;
}

type MenuData = PermissionMenuData | QuestionMenuData;

export interface MenuDeps {
  /** VK API client used only for the button spinner answer. */
  client: VkApiClient;
  sender: VkSender;
}

interface MenuPayload {
  v: number;
  k: "prm" | "q" | "cfm" | "sess" | "prj" | "mdl" | "agn";
  s: string;
  a: "pick" | "page" | "cancel" | "refresh";
  x?: number;
}

function packPayload(payload: MenuPayload): string {
  return JSON.stringify(payload);
}

/** True when a packed payload fits the VK button budget. */
export function isPayloadWithinBudget(payload: string): boolean {
  return Buffer.byteLength(payload, "utf8") <= MAX_PAYLOAD_BYTES;
}

function unpackPayload(raw: string | undefined): MenuPayload | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      isRecord(parsed) &&
      parsed.v === PAYLOAD_VERSION &&
      typeof parsed.k === "string" &&
      typeof parsed.s === "string" &&
      typeof parsed.a === "string"
    ) {
      return parsed as unknown as MenuPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** In-memory menu state: conversation_message-independent, keyed by short id. */
const menus = new Map<string, MenuData>();
let menuSeq = 0;
const MAX_TRACKED_MENUS = 32;

function createMenuId(): string {
  menuSeq += 1;
  const id = `m${menuSeq}`;
  if (menus.size >= MAX_TRACKED_MENUS) {
    const oldest = menus.keys().next().value;
    if (oldest !== undefined) {
      menus.delete(oldest);
    }
  }
  menus.set(id, {} as MenuData);
  return id;
}

function getMenu(id: string): MenuData | undefined {
  const menu = menus.get(id);
  if (menu === undefined) {
    return undefined;
  }
  // LRU touch.
  menus.delete(id);
  menus.set(id, menu);
  return menu;
}

function resolveMenu(id: string): MenuData | undefined {
  const menu = getMenu(id);
  if (menu) {
    menus.delete(id);
  }
  return menu;
}

interface VkButton {
  action: { type: "callback"; label: string; payload: string };
}

export async function buildPermissionMenu(
  deps: MenuDeps,
  peerId: number,
  data: Omit<PermissionMenuData, "kind">,
): Promise<void> {
  const id = createMenuId();
  const menu: PermissionMenuData = { kind: "prm", ...data };
  menus.set(id, menu);

  const button = (label: string, x: number): VkButton => ({
    action: { type: "callback", label, payload: packPayload({ v: PAYLOAD_VERSION, k: "prm", s: id, a: "pick", x }) },
  });
  const keyboard = {
    inline: true,
    buttons: [[button("✅ Allow once", 1), button("🔁 Always", 2), button("⛔ Deny", 0)]],
  };

  const patterns = data.patterns.length > 0 ? ` (${data.patterns.join(", ")})` : "";
  const text = t("vk.perm_asked", { tool: data.tool }) + patterns;
  await sendKeyboard(deps, peerId, text, keyboard, menu);
}

export async function buildQuestionMenu(
  deps: MenuDeps,
  peerId: number,
  data: Omit<QuestionMenuData, "kind" | "currentIndex" | "answers">,
): Promise<void> {
  const id = createMenuId();
  const menu: QuestionMenuData = { kind: "q", ...data, currentIndex: 0, answers: [] };
  menus.set(id, menu);
  await showQuestion(deps, peerId, id, menu);
}

async function showQuestion(
  deps: MenuDeps,
  peerId: number,
  id: string,
  menu: QuestionMenuData,
): Promise<void> {
  const question = menu.questions[menu.currentIndex];
  if (!question) {
    return;
  }
  const options = question.options.slice(0, MAX_BUTTONS - 1);
  const rows = options.map((option, index): VkButton[] => [
    {
      action: {
        type: "callback",
        label: option.label.slice(0, 40),
        payload: packPayload({ v: PAYLOAD_VERSION, k: "q", s: id, a: "pick", x: index }),
      },
    },
  ]);
  const keyboard = { inline: true, buttons: rows };
  await sendKeyboard(deps, peerId, `❓ ${question.header || question.question}`, keyboard, menu);
}

async function sendKeyboard(
  deps: MenuDeps,
  peerId: number,
  text: string,
  keyboard: unknown,
  menu: MenuData,
): Promise<void> {
  const keyboardJson = JSON.stringify(keyboard);
  if (Buffer.byteLength(keyboardJson, "utf8") > MAX_KEYBOARD_BYTES) {
    logger.warn("[VkMenus] Keyboard JSON exceeds byte budget, dropping buttons", {
      bytes: Buffer.byteLength(keyboardJson, "utf8"),
    });
    await deps.sender.sendText(peerId, text);
    return;
  }
  void menu;
  await deps.sender.sendText(peerId, text, { keyboard });
}

/**
 * Routes a button tap (US3): resolves the menu state, clears the spinner,
 * applies the action and replies. Stale/unknown taps never crash — they
 * answer politely once (router rules, contracts/callback-payloads.md).
 */
export async function handleMenuButton(deps: MenuDeps, event: NormalizedButtonEvent): Promise<void> {
  const payload = unpackPayload(event.payload);
  if (!payload) {
    await sendMessageEventAnswer(deps.client, event);
    return;
  }

  const menu = menus.get(payload.s);
  if (!menu) {
    await sendMessageEventAnswer(deps.client, event);
    await deps.sender.sendText(event.peerId, t("vk.menu_outdated"));
    return;
  }

  if (menu.kind === "prm" && payload.k === "prm" && payload.a === "pick") {
    await resolvePermission(deps, event, payload.s, menu, payload.x ?? 0);
    return;
  }

  if (menu.kind === "q" && payload.k === "q" && payload.a === "pick") {
    await pickQuestionOption(deps, event, payload.s, menu, payload.x ?? 0);
    return;
  }

  await sendMessageEventAnswer(deps.client, event);
}

async function resolvePermission(
  deps: MenuDeps,
  event: NormalizedButtonEvent,
  id: string,
  menu: PermissionMenuData,
  x: number,
): Promise<void> {
  const reply = x === 1 ? "once" : x === 2 ? "always" : "reject";
  await sendMessageEventAnswer(deps.client, event);
  resolveMenu(id);

  try {
    const { error } = await opencodeClient.permission.reply({
      requestID: menu.requestId,
      directory: menu.directory,
      reply,
    });
    if (error) {
      logger.warn("[VkMenus] permission.reply error:", error);
      await deps.sender.sendText(event.peerId, t("error.generic"));
      return;
    }
    const key = reply === "once" ? "vk.perm_allowed_once" : reply === "always" ? "vk.perm_allowed_always" : "vk.perm_rejected";
    await deps.sender.sendText(event.peerId, t(key, { tool: menu.tool }));
  } catch (error) {
    logger.error("[VkMenus] permission.reply failed:", error);
    await deps.sender.sendText(event.peerId, t("error.generic"));
  }
}

async function pickQuestionOption(
  deps: MenuDeps,
  event: NormalizedButtonEvent,
  id: string,
  menu: QuestionMenuData,
  optionIndex: number,
): Promise<void> {
  await sendMessageEventAnswer(deps.client, event);

  const question = menu.questions[menu.currentIndex];
  const option = question?.options[optionIndex];
  if (!question || !option) {
    return;
  }

  menu.answers[menu.currentIndex] = [option.label];

  if (menu.currentIndex < menu.questions.length - 1) {
    menu.currentIndex += 1;
    await showQuestion(deps, event.peerId, id, menu);
    return;
  }

  resolveMenu(id);
  try {
    const { error } = await opencodeClient.question.reply({
      requestID: menu.requestId,
      directory: menu.directory,
      answers: menu.answers,
    });
    if (error) {
      logger.warn("[VkMenus] question.reply error:", error);
      await deps.sender.sendText(event.peerId, t("error.generic"));
      return;
    }
    await deps.sender.sendText(event.peerId, t("vk.q_answered"));
  } catch (error) {
    logger.error("[VkMenus] question.reply failed:", error);
    await deps.sender.sendText(event.peerId, t("error.generic"));
  }
}
