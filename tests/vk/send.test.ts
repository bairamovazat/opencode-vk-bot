import { describe, expect, it } from "vitest";
import { VkApiClient } from "../../src/vk/client.js";
import {
  VK_MESSAGE_SAFE_LIMIT,
  VkSender,
  chunkMessageText,
} from "../../src/vk/send.js";
import { defined } from "../helpers/defined.js";
import { createMockVkApi } from "./helpers/mock-vk-api.js";

describe("chunkMessageText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkMessageText("hello")).toEqual(["hello"]);
  });

  it("returns no chunks for empty text", () => {
    expect(chunkMessageText("")).toEqual([]);
  });

  it("returns the text unchanged at exactly the limit", () => {
    const text = "a".repeat(VK_MESSAGE_SAFE_LIMIT);

    expect(chunkMessageText(text)).toEqual([text]);
  });

  it("splits multi-paragraph text at paragraph boundaries", () => {
    const paragraph = "b".repeat(1500);
    const text = [paragraph, paragraph, paragraph].join("\n\n");

    const chunks = chunkMessageText(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(VK_MESSAGE_SAFE_LIMIT);
    }
    expect(chunks.join("\n").replace(/\n+$/g, "")).toContain(paragraph);
  });

  it("closes and re-opens an open code fence at chunk boundaries", () => {
    const intro = "intro\n";
    const fenceBody = "c".repeat(VK_MESSAGE_SAFE_LIMIT - intro.length - 20);
    const text = `${intro}\`\`\`\n${fenceBody}\nmore lines after the fence\n\`\`\``;

    const chunks = chunkMessageText(text);

    expect(chunks.length).toBeGreaterThan(1);
    // First chunk must not end inside an open fence: it either has no fence
    // or closes it. Every subsequent chunk must start with a re-opened fence
    // if the previous one ended closed.
    for (let i = 0; i < chunks.length; i += 1) {
      expect(defined(chunks[i]).length).toBeLessThanOrEqual(VK_MESSAGE_SAFE_LIMIT);
      const fenceCount = (defined(chunks[i]).match(/```/g) ?? []).length;
      if (i < chunks.length - 1) {
        expect(fenceCount % 2).toBe(0);
      }
    }
    // The tail of the message is still present after re-joining.
    expect(chunks[chunks.length - 1]).toContain("more lines after the fence");
  });

  it("hard-splits a single oversized line keeping both parts within the limit", () => {
    const text = "x".repeat(VK_MESSAGE_SAFE_LIMIT * 2 + 100);

    const chunks = chunkMessageText(text);

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(VK_MESSAGE_SAFE_LIMIT);
    }
    expect(chunks.join("")).toContain("x".repeat(100));
  });

  it("hard-splits an oversized line inside a fence and keeps both parts fenced", () => {
    const text = "```\n" + "y".repeat(VK_MESSAGE_SAFE_LIMIT * 2);

    const chunks = chunkMessageText(text);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(VK_MESSAGE_SAFE_LIMIT);
      // Every fragment of the fenced line keeps its fence markers.
      expect(chunk).toContain("```");
    }
  });
});

describe("VkSender", () => {
  function createSender(mock = createMockVkApi()): { sender: VkSender; mock: ReturnType<typeof createMockVkApi> } {
    return { sender: new VkSender(new VkApiClient(mock.clientOptions)), mock };
  }

  it("sends a short message with a unique random_id and link parsing off", async () => {
    const { sender, mock } = createSender();
    mock.enqueue("messages.send", { message_id: 7 });

    const ids = await sender.sendText(2000000042, "hello");

    expect(ids).toEqual([7]);
    const params = defined(mock.requests[0]).params;
    expect(params.get("peer_id")).toBe("2000000042");
    expect(params.get("message")).toBe("hello");
    expect(params.get("dont_parse_links")).toBe("1");
    expect(Number(params.get("random_id"))).not.toBeNaN();
  });

  it("marks silent messages with disable_notification", async () => {
    const { sender, mock } = createSender();
    mock.enqueue("messages.send", { message_id: 8 });

    await sender.sendText(1, "status update", { silent: true });

    expect(defined(mock.requests[0]).params.get("disable_notification")).toBe("1");
  });

  it("serializes the keyboard to a JSON string", async () => {
    const { sender, mock } = createSender();
    mock.enqueue("messages.send", { message_id: 9 });
    const keyboard = { inline: true, buttons: [[{ action: { type: "callback", label: "OK" } }]] };

    await sender.sendText(1, "pick", { keyboard });

    expect(defined(mock.requests[0]).params.get("keyboard")).toBe(JSON.stringify(keyboard));
  });

  it("delivers oversized replies as several ordered chunks (SC-007)", async () => {
    const { sender, mock } = createSender();
    const paragraph = "d".repeat(1500);
    const text = [paragraph, paragraph, paragraph].join("\n\n");
    for (let i = 0; i < 4; i += 1) {
      mock.enqueue("messages.send", { message_id: 10 + i });
    }

    const ids = await sender.sendText(1, text);

    expect(ids.length).toBe(mock.requests.length);
    expect(mock.requests.length).toBeGreaterThan(1);
    const joined = mock.requests.map((r) => r.params.get("message")).join("\n");
    for (const chunk of mock.requests) {
      expect(chunk.params.get("message")?.length).toBeLessThanOrEqual(VK_MESSAGE_SAFE_LIMIT);
    }
    expect(joined).toContain(paragraph);
  });

  it("retries once with a text variation on flood control (code 9)", async () => {
    const { sender, mock } = createSender();
    mock.enqueueError("messages.send", 9, "Flood control");
    mock.enqueue("messages.send", { message_id: 20 });

    const ids = await sender.sendText(1, "same text");

    expect(ids).toEqual([20]);
    expect(mock.requests).toHaveLength(2);
    const retriedMessage = defined(mock.requests[1]).params.get("message") ?? "";
    expect(retriedMessage).toContain("same text");
    expect(retriedMessage.length).toBeGreaterThan("same text".length);
  });

  it("propagates non-flood errors", async () => {
    const { sender, mock } = createSender();
    mock.enqueueError("messages.send", 901, "Cannot send messages to this user");

    await expect(sender.sendText(1, "hi")).rejects.toThrow(/901/);
  });
});
