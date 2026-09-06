import { describe, expect, it } from "vitest";
import { VkEventNormalizer } from "../../src/vk/events.js";

const OPTIONS = { groupId: 12345, allowedUserId: 42 };

function eventOrThrow<T>(value: T | null): T {
  if (value === null) {
    throw new Error("Expected event to be defined");
  }
  return value;
}

function messageNew(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "message_new",
    group_id: 12345,
    event_id: eventId,
    object: {
      message: {
        id: 100,
        date: 1,
        peer_id: 2000000042,
        from_id: 42,
        text: "hello",
        conversation_message_id: 5,
        ...overrides,
      },
    },
  };
}

describe("event normalizer", () => {
  it("maps message_new into a typed message event", () => {
    const normalizer = new VkEventNormalizer(OPTIONS);

    const event = normalizer.normalize(messageNew("e1"));

    expect(event).toMatchObject({
      kind: "message",
      message: { text: "hello", peer_id: 2000000042, from_id: 42, conversation_message_id: 5 },
    });
  });

  it("maps message_event into a typed button event", () => {
    const normalizer = new VkEventNormalizer(OPTIONS);
    const update = {
      type: "message_event",
      group_id: 12345,
      object: { user_id: 42, peer_id: 2000000042, event_id: "be1", payload: '{"k":"prm"}', conversation_message_id: 9 },
    };

    const event = normalizer.normalize(update);

    expect(event).toMatchObject({
      kind: "button",
      userId: 42,
      peerId: 2000000042,
      eventId: "be1",
      payload: '{"k":"prm"}',
      conversationMessageId: 9,
    });
  });

  it("drops unknown update types", () => {
    const normalizer = new VkEventNormalizer(OPTIONS);

    expect(normalizer.normalize({ type: "wall_post_new", group_id: 12345, event_id: "e2" })).toBeNull();
  });

  it("drops updates from a foreign group", () => {
    const normalizer = new VkEventNormalizer(OPTIONS);

    expect(eventOrThrow(normalizer.normalize(messageNew("e3", {}))).kind).toBe("message");
    expect(
      normalizer.normalize({
        type: "message_new",
        group_id: 999,
        event_id: "e4",
        object: { message: { id: 1, date: 1, peer_id: 1, from_id: 42, text: "x" } },
      }),
    ).toBeNull();
  });

  it("drops updates from non-owner senders", () => {
    const normalizer = new VkEventNormalizer(OPTIONS);

    expect(
      normalizer.normalize(messageNew("e5", { from_id: 777 })),
    ).toBeNull();
  });

  it("deduplicates repeated event_ids (redelivery protection)", () => {
    const normalizer = new VkEventNormalizer(OPTIONS);

    expect(eventOrThrow(normalizer.normalize(messageNew("dup"))).kind).toBe("message");
    expect(normalizer.normalize(messageNew("dup"))).toBeNull();
    expect(eventOrThrow(normalizer.normalize(messageNew("other"))).kind).toBe("message");
  });

  it("turns marked community replies into prompts only in self-test mode", () => {
    const update = {
      type: "message_reply",
      group_id: 12345,
      object: { id: 9, date: 2, peer_id: 158377194, from_id: -12345, text: "SELFTEST: ping" },
    };

    const strict = new VkEventNormalizer(OPTIONS);
    expect(strict.normalize(update)).toBeNull();

    const harness = new VkEventNormalizer({ ...OPTIONS, selfTest: true });
    expect(harness.normalize(update)).toMatchObject({
      kind: "message",
      message: { text: "ping", from_id: -12345, peer_id: 158377194 },
    });
  });

  it("drops unmarked community replies even in self-test mode", () => {
    const harness = new VkEventNormalizer({ ...OPTIONS, selfTest: true });
    const update = {
      type: "message_reply",
      group_id: 12345,
      object: { id: 10, date: 2, peer_id: 158377194, from_id: -12345, text: "обычный ответ бота" },
    };

    expect(harness.normalize(update)).toBeNull();
  });

  it("evicts the oldest event_id when the dedup window overflows", () => {
    const normalizer = new VkEventNormalizer({ ...OPTIONS, maxTrackedEventIds: 2 });

    normalizer.normalize(messageNew("a"));
    normalizer.normalize(messageNew("b"));
    normalizer.normalize(messageNew("c"));
    // "a" was evicted: redelivery is treated as fresh again.
    expect(eventOrThrow(normalizer.normalize(messageNew("a"))).kind).toBe("message");
  });
});
