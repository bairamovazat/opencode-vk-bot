import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VkSender } from "../../src/vk/send.js";
import type { NormalizedButtonEvent } from "../../src/vk/events.js";
import type { VkApiClient } from "../../src/vk/client.js";

const mocks = vi.hoisted(() => ({
  permissionReply: vi.fn(),
  questionReply: vi.fn(),
  sendMessageEventAnswer: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    permission: { reply: mocks.permissionReply },
    question: { reply: mocks.questionReply },
  },
}));

vi.mock("../../src/vk/callbacks.js", () => ({
  sendMessageEventAnswer: mocks.sendMessageEventAnswer,
}));

import {
  buildPermissionMenu,
  buildQuestionMenu,
  handleMenuButton,
  isPayloadWithinBudget,
} from "../../src/vk/menus.js";

const PEER = 2000000042;

function createDeps() {
  const sender = { sendText: vi.fn(async () => [] as number[]) } as unknown as VkSender;
  const client = {} as VkApiClient;
  return { sender, client };
}

function buttonEvent(payload?: string): NormalizedButtonEvent {
  const event: NormalizedButtonEvent = {
    kind: "button",
    userId: 42,
    peerId: PEER,
    eventId: `evt-${Math.random()}`,
    conversationMessageId: 1,
  };
  if (payload !== undefined) {
    event.payload = payload;
  }
  return event;
}

async function lastKeyboard(sender: VkSender): Promise<{ buttons: Array<Array<{ action: { payload: string; label: string } }>> }> {
  const calls = (sender.sendText as ReturnType<typeof vi.fn>).mock.calls;
  const last = definedLast(calls);
  const options = last[2] as { keyboard: { buttons: Array<Array<{ action: { payload: string; label: string } }>> } };
  return options.keyboard;
}

function definedLast<T>(array: Array<T>): T {
  const value = array.at(-1);
  if (value === undefined) {
    throw new Error("expected at least one call");
  }
  return value;
}

describe("vk menus (US3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissionReply.mockResolvedValue({ data: true, error: null });
    mocks.questionReply.mockResolvedValue({ data: true, error: null });
  });

  it("keeps the permission payload within the VK budget", async () => {
    const { sender, client } = createDeps();

    await buildPermissionMenu({ client, sender }, PEER, {
      requestId: "per-1",
      directory: "/repo",
      tool: "edit",
      patterns: ["src/**"],
    });

    const keyboard = await lastKeyboard(sender);
    const payload = keyboard.buttons[0]![0]!.action.payload;
    expect(isPayloadWithinBudget(payload)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(keyboard), "utf8")).toBeLessThan(1000);
  });

  it("delivers permission decisions through the opencode client", async () => {
    const { sender, client } = createDeps();
    await buildPermissionMenu({ client, sender }, PEER, {
      requestId: "per-2",
      directory: "/repo",
      tool: "bash",
      patterns: [],
    });
    const keyboard = await lastKeyboard(sender);
    const allowOnce = keyboard.buttons[0]!.find((b) => b.action.label.includes("once"))!;

    await handleMenuButton({ client, sender }, buttonEvent(allowOnce.action.payload));

    expect(mocks.sendMessageEventAnswer).toHaveBeenCalled();
    expect(mocks.permissionReply).toHaveBeenCalledWith({
      requestID: "per-2",
      directory: "/repo",
      reply: "once",
    });
    const sentTexts = (sender.sendText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(sentTexts.some((text: string) => text.includes("Allowed once"))).toBe(true);
  });

  it("treats a resolved menu tap as outdated", async () => {
    const { sender, client } = createDeps();
    await buildPermissionMenu({ client, sender }, PEER, {
      requestId: "per-3",
      directory: "/repo",
      tool: "bash",
      patterns: [],
    });
    const keyboard = await lastKeyboard(sender);
    const deny = keyboard.buttons[0]!.find((b) => b.action.label.includes("Deny"))!;
    await handleMenuButton({ client, sender }, buttonEvent(deny.action.payload));
    (sender.sendText as ReturnType<typeof vi.fn>).mockClear();

    await handleMenuButton({ client, sender }, buttonEvent(deny.action.payload));

    const sentTexts = (sender.sendText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(sentTexts.some((text: string) => text.includes("outdated"))).toBe(true);
  });

  it("walks through question menus and submits all answers", async () => {
    const { sender, client } = createDeps();
    await buildQuestionMenu({ client, sender }, PEER, {
      requestId: "q-1",
      directory: "/repo",
      questions: [
        {
          question: "Какую БД?",
          header: "База данных",
          options: [
            { label: "SQLite", description: "встроенная" },
            { label: "Postgres", description: "серверная" },
          ],
        },
        {
          question: "Тесты?",
          header: "Тестирование",
          options: [
            { label: "Vitest", description: "быстрый" },
            { label: "Jest", description: "классика" },
          ],
        },
      ],
    });

    const firstKeyboard = await lastKeyboard(sender);
    expect(firstKeyboard.buttons).toHaveLength(2);
    await handleMenuButton({ client, sender }, buttonEvent(firstKeyboard.buttons[0]![0]!.action.payload));

    const secondKeyboard = await lastKeyboard(sender);
    expect(secondKeyboard.buttons[0]![0]!.action.label).toBe("Vitest");
    await handleMenuButton({ client, sender }, buttonEvent(secondKeyboard.buttons[0]![0]!.action.payload));

    expect(mocks.questionReply).toHaveBeenCalledWith({
      requestID: "q-1",
      directory: "/repo",
      answers: [["SQLite"], ["Vitest"]],
    });
    const sentTexts = (sender.sendText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(sentTexts.some((text: string) => text.includes("delivered"))).toBe(true);
  });

  it("answers unknown payloads with only a spinner clear", async () => {
    const { sender, client } = createDeps();

    await handleMenuButton({ client, sender }, buttonEvent("not-json"));

    expect(mocks.sendMessageEventAnswer).toHaveBeenCalled();
    expect(sender.sendText).not.toHaveBeenCalled();
  });
});
