import { describe, expect, it } from "vitest";
import { isOwnerUpdate } from "../../src/vk/auth.js";

const GATE = { groupId: 12345, allowedUserId: 42 };

describe("owner gate", () => {
  it("accepts a message_new from the owner in the configured group", () => {
    const update = {
      type: "message_new",
      group_id: 12345,
      event_id: "e1",
      object: { message: { peer_id: 2000000042, from_id: 42, text: "hi" } },
    };

    expect(isOwnerUpdate(update, GATE)).toBe(true);
  });

  it("accepts a message_event from the owner", () => {
    const update = {
      type: "message_event",
      group_id: 12345,
      event_id: "e2",
      object: { user_id: 42, peer_id: 2000000042, event_id: "e2", payload: "{}" },
    };

    expect(isOwnerUpdate(update, GATE)).toBe(true);
  });

  it("rejects updates from any other user", () => {
    const update = {
      type: "message_new",
      group_id: 12345,
      event_id: "e3",
      object: { message: { peer_id: 1, from_id: 777, text: "intruder" } },
    };

    expect(isOwnerUpdate(update, GATE)).toBe(false);
  });

  it("rejects updates from a foreign group", () => {
    const update = {
      type: "message_new",
      group_id: 99999,
      event_id: "e4",
      object: { message: { peer_id: 1, from_id: 42, text: "hi" } },
    };

    expect(isOwnerUpdate(update, GATE)).toBe(false);
  });

  it("parses group_id delivered as a string", () => {
    const update = {
      type: "message_new",
      group_id: "12345",
      event_id: "e5",
      object: { message: { peer_id: 1, from_id: 42, text: "hi" } },
    };

    expect(isOwnerUpdate(update, GATE)).toBe(true);
  });

  it("rejects messages sent by a community (negative from_id)", () => {
    const update = {
      type: "message_new",
      group_id: 12345,
      event_id: "e6",
      object: { message: { peer_id: 1, from_id: -12345, text: "auto" } },
    };

    expect(isOwnerUpdate(update, GATE)).toBe(false);
  });

  it("rejects updates without a recognizable sender", () => {
    const update = { type: "message_typing_state", group_id: 12345, event_id: "e7", object: {} };

    expect(isOwnerUpdate(update, GATE)).toBe(false);
  });
});
