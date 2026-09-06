import { describe, expect, it } from "vitest";
import { VkApiClient } from "../../src/vk/client.js";
import { VkStatusRun } from "../../src/vk/status.js";
import { defined } from "../helpers/defined.js";
import { createMockVkApi } from "./helpers/mock-vk-api.js";

describe("vk status run", () => {
  function createStatus() {
    const mock = createMockVkApi();
    let nowMs = 1_000_000;
    const sleeps: number[] = [];
    const client = new VkApiClient({
      ...mock.clientOptions,
      now: () => nowMs,
      sleep: (ms) => {
        sleeps.push(ms);
        nowMs += ms;
        return Promise.resolve();
      },
    });
    const status = new VkStatusRun({
      client,
      peerId: 42,
      now: () => nowMs,
      sleep: (ms) => {
        sleeps.push(ms);
        nowMs += ms;
        return Promise.resolve();
      },
    });
    return { status, mock, sleeps, advance: (ms: number) => (nowMs += ms) };
  }

  it("starts with a silent status message", async () => {
    const { status, mock } = createStatus();
    mock.enqueue("messages.send", { message_id: 100 });

    await status.start();

    expect(mock.requests).toHaveLength(1);
    expect(defined(mock.requests[0]).method).toBe("messages.send");
    expect(defined(mock.requests[0]).params.get("disable_notification")).toBe("1");
    expect(defined(mock.requests[0]).params.get("message")).toContain("0");
  });

  it("throttles rapid updates and applies the pending one after the interval", async () => {
    const { status, mock, sleeps, advance } = createStatus();
    mock.enqueue("messages.send", { message_id: 1 });
    await status.start();

    advance(3100);
    mock.enqueue("messages.send", { message_id: 2 });
    mock.enqueue("messages.delete", {});
    await status.setActivity("step 1");
    expect(mock.requests).toHaveLength(3); // start + immediate update

    // Second update arrives within the 3 s window: deferred.
    mock.enqueue("messages.send", { message_id: 3 });
    mock.enqueue("messages.delete", {});
    const updatePromise = status.setActivity("step 2");

    expect(sleeps.length).toBeGreaterThan(0); // deferred via sleep
    await updatePromise;
    expect(mock.requests.filter((r) => r.method === "messages.send")).toHaveLength(3);
    const lastMessage = defined(mock.requests.filter((r) => r.method === "messages.send").at(-1));
    expect(lastMessage?.params.get("message")).toBe("step 2");
  });

  it("deletes the status message on finish", async () => {
    const { status, mock } = createStatus();
    mock.enqueue("messages.send", { message_id: 77 });
    await status.start();

    mock.enqueue("messages.delete", {});
    await status.finish();

    const deletes = mock.requests.filter((r) => r.method === "messages.delete");
    expect(deletes).toHaveLength(1);
    expect(defined(deletes[0]).params.get("message_ids")).toBe("77");
  });
});
