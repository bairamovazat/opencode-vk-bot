import { describe, expect, it } from "vitest";
import { defined } from "../helpers/defined.js";
import { VkApiClient, VkApiError } from "../../src/vk/client.js";
import { createMockVkApi, isVkApiErrorWithCode } from "./helpers/mock-vk-api.js";

function createClient(mock = createMockVkApi()): { client: VkApiClient; mock: ReturnType<typeof createMockVkApi> } {
  return { client: new VkApiClient(mock.clientOptions), mock };
}

describe("vk api client", () => {
  it("returns the response envelope and injects token and version", async () => {
    const { client, mock } = createClient();
    mock.enqueue("groups.getLongPollServer", { key: "k", server: "https://s", ts: 1 });

    const response = await client.call("groups.getLongPollServer", { group_id: 12345 });

    expect(response).toEqual({ key: "k", server: "https://s", ts: 1 });
    expect(mock.requests).toHaveLength(1);
    expect(defined(mock.requests[0]).params.get("access_token")).toBe("test-token");
    expect(defined(mock.requests[0]).params.get("v")).toBe("5.199");
    expect(defined(mock.requests[0]).params.get("group_id")).toBe("12345");
  });

  it("skips undefined and null params and stringifies booleans as 1/0", async () => {
    const { client, mock } = createClient();
    mock.enqueue("messages.send", {});

    await client.call("messages.send", {
      peer_id: 1,
      message: undefined,
      disable_notification: true,
      dont_parse_links: false,
      extra: null,
    });

    const params = defined(mock.requests[0]).params;
    expect(params.get("peer_id")).toBe("1");
    expect(params.has("message")).toBe(false);
    expect(params.get("disable_notification")).toBe("1");
    expect(params.get("dont_parse_links")).toBe("0");
    expect(params.has("extra")).toBe(false);
  });

  it("retries transient error code 6 and succeeds", async () => {
    const { client, mock } = createClient();
    mock.enqueueError("messages.send", 6, "Too many requests per second");
    mock.enqueue("messages.send", { ok: 1 });

    const response = await client.call("messages.send", { message: "hi" });

    expect(response).toEqual({ ok: 1 });
    expect(mock.requests).toHaveLength(2);
  });

  it("retries network failures and succeeds", async () => {
    const { client, mock } = createClient();
    mock.enqueueNetworkError("groups.isMember");
    mock.enqueue("groups.isMember", { member: 0 });

    const response = await client.call("groups.isMember", { group_id: 1 });

    expect(response).toEqual({ member: 0 });
    expect(mock.requests).toHaveLength(2);
  });

  it("gives up after max retries on persistent error code 6", async () => {
    const { client, mock } = createClient();
    for (let i = 0; i < 4; i += 1) {
      mock.enqueueError("messages.send", 6, "Too many requests per second");
    }

    const error = await client.call("messages.send", {}).catch((e: unknown) => e);

    expect(isVkApiErrorWithCode(error, 6)).toBe(true);
    expect(mock.requests).toHaveLength(4);
  });

  it.each([
    [9, "Flood control"],
    [14, "Captcha needed"],
    [100, "Invalid parameter"],
    [901, "Cannot send messages to this user"],
  ])("fails immediately without retry on non-retryable code %i", async (code, message) => {
    const { client, mock } = createClient();
    mock.enqueueError("messages.send", code, message);

    const error = await client.call("messages.send", {}).catch((e: unknown) => e);

    expect(isVkApiErrorWithCode(error, code)).toBe(true);
    expect(mock.requests).toHaveLength(1);
  });

  it("throws a typed error for malformed envelopes", async () => {
    const { client, mock } = createClient();
    mock.enqueueMalformed("messages.send");

    const error = await client.call("messages.send", {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VkApiError);
    expect((error as VkApiError).code).toBe(-1);
  });

  it("serializes concurrent calls with the rate limiter", async () => {
    const mock = createMockVkApi();
    let nowMs = 1000;
    const sleeps: number[] = [];
    const client = new VkApiClient({
      ...mock.clientOptions,
      minRequestIntervalMs: 50,
      now: () => nowMs,
      sleep: (ms) => {
        sleeps.push(ms);
        nowMs += ms;
        return Promise.resolve();
      },
    });
    mock.enqueue("messages.send", { ok: 1 });
    mock.enqueue("messages.send", { ok: 2 });

    const [first, second] = await Promise.all([
      client.call("messages.send", { random_id: 1 }),
      client.call("messages.send", { random_id: 2 }),
    ]);

    expect(first).toEqual({ ok: 1 });
    expect(second).toEqual({ ok: 2 });
    // First call starts immediately (clock is past the initial interval);
    // the second is held back for one interval after the first start.
    expect(sleeps).toEqual([50]);
  });
});
