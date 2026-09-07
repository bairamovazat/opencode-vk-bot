import { describe, expect, it, vi } from "vitest";
import { VkApiClient } from "../../src/vk/client.js";
import { VkLongPoll, type LongPollTsStore } from "../../src/vk/longpoll.js";
import { createMockVkApi } from "./helpers/mock-vk-api.js";

interface ScriptedPollResponse {
  status: number;
  body: unknown;
}

function createPollFetch(script: Array<ScriptedPollResponse | Error>) {
  const requestedUrls: string[] = [];
  let call = 0;
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = String(input);
    requestedUrls.push(url);
    const next = script[call];
    call += 1;
    if (!next) {
      throw new Error("poll fetch: script exhausted");
    }
    if (next instanceof Error) {
      throw next;
    }
    return Response.json(next.body, { status: next.status });
  }) as typeof fetch;
  return { fetchImpl, requestedUrls };
}

interface TestHarness {
  longPoll: VkLongPoll;
  mock: ReturnType<typeof createMockVkApi>;
  requestedUrls: string[];
  updates: unknown[];
  sleeps: number[];
  savedTs: string[];
  tsStore: LongPollTsStore;
  controller: AbortController;
}

function createHarness(
  pollScript: Array<ScriptedPollResponse | Error>,
  onUpdate: (update: unknown) => Promise<void> | void = () => {},
  tsSeed: string | null = null,
): TestHarness {
  const mock = createMockVkApi();
  mock.enqueue("groups.getLongPollServer", { key: "k1", server: "https://lp.example", ts: "100" });
  const { fetchImpl, requestedUrls } = createPollFetch(pollScript);
  const controller = new AbortController();
  const updates: unknown[] = [];
  const sleeps: number[] = [];
  const savedTs: string[] = [];
  const tsStore: LongPollTsStore = {
    load: vi.fn(async () => tsSeed),
    save: vi.fn(async (ts: string) => {
      savedTs.push(ts);
    }),
  };
  const longPoll = new VkLongPoll({
    client: new VkApiClient(mock.clientOptions),
    groupId: 12345,
    waitSec: 25,
    fetchImpl,
    tsStore,
    onUpdate: (update) => {
      updates.push(update);
      return onUpdate(update);
    },
    signal: controller.signal,
    sleep: (ms) => {
      sleeps.push(ms);
      // The test scripts are finite: once the loop starts consuming more
      // backoffs than scripted, stop it deterministically (all test I/O is
      // microtask-based, so real timers would starve).
      if (sleeps.length >= 3) {
        controller.abort();
      }
      return Promise.resolve();
    },
  });
  return { longPoll, mock, requestedUrls, updates, sleeps, savedTs, tsStore, controller };
}

const UPDATE_A = { type: "message_new", group_id: 12345, event_id: "a", object: {} };
const UPDATE_B = { type: "message_new", group_id: 12345, event_id: "b", object: {} };

async function runUntilIdle(longPoll: VkLongPoll): Promise<void> {
  // Exits when the harness aborts (script exhausted or scenario finished).
  await longPoll.run();
}

describe("vk long poll", () => {
  it("delivers updates in order and checkpoints ts after each batch", async () => {
    const harness = createHarness([
      { status: 200, body: { ts: "101", updates: [UPDATE_A, UPDATE_B] } },
      { status: 200, body: { ts: "102", updates: [] } },
    ]);

    await runUntilIdle(harness.longPoll);

    expect(harness.updates).toEqual([UPDATE_A, UPDATE_B]);
    expect(harness.savedTs).toEqual(["101", "102"]);
  });

  it("resumes from a persisted ts checkpoint", async () => {
    const harness = createHarness([{ status: 200, body: { ts: "201", updates: [] } }], undefined, "200");

    await runUntilIdle(harness.longPoll);

    expect(harness.requestedUrls[0]).toContain("ts=200");
    expect(harness.requestedUrls[0]).toContain("key=k1");
    expect(harness.requestedUrls[0]).toContain("act=a_check");
    expect(harness.requestedUrls[0]).toContain("wait=25");
    expect(harness.savedTs).toEqual(["201"]);
  });

  it("handles failed=1 by adopting the new ts from the response", async () => {
    const harness = createHarness([
      { status: 200, body: { failed: 1, ts: "300" } },
      { status: 200, body: { ts: "301", updates: [] } },
    ]);

    await runUntilIdle(harness.longPoll);

    expect(harness.requestedUrls[1]).toContain("ts=300");
    expect(harness.savedTs).toEqual(["301"]);
  });

  it("re-issues the long poll server on failed=2 keeping the ts position", async () => {
    const harness = createHarness([
      { status: 200, body: { failed: 2 } },
      { status: 200, body: { ts: "401", updates: [] } },
    ]);
    harness.mock.enqueue("groups.getLongPollServer", {
      key: "k2",
      server: "https://lp.example",
      ts: "400",
    });

    await runUntilIdle(harness.longPoll);

    expect(harness.requestedUrls[1]).toContain("key=k2");
    // Our ts position survives the session re-issue (VK accepts the old ts
    // with a fresh key; only failed=1 rewrites it).
    expect(harness.requestedUrls[1]).toContain("ts=100");
  });

  it("backs off after a network error and keeps the same ts", async () => {
    const harness = createHarness([
      new Error("connection reset"),
      { status: 200, body: { ts: "501", updates: [] } },
    ]);

    await runUntilIdle(harness.longPoll);

    // First backoff is 1s; later cycles exhaust the script and back off
    // again until the harness aborts the loop.
    expect(harness.sleeps[0]).toBe(1000);
    expect(harness.sleeps.every((ms) => ms <= 30000)).toBe(true);
    expect(harness.requestedUrls[1]).toContain("ts=100");
    expect(harness.savedTs).toEqual(["501"]);
  });

  it("redelivers the same batch when a handler throws (ts not advanced)", async () => {
    let calls = 0;
    const harness = createHarness(
      [
        { status: 200, body: { ts: "601", updates: [UPDATE_A] } },
        { status: 200, body: { ts: "602", updates: [UPDATE_A] } },
      ],
      (update) => {
        calls += 1;
        if (calls <= 2) {
          throw new Error("handler boom");
        }
        void update;
      },
    );

    await runUntilIdle(harness.longPoll);

    // The failing handler is retried with backoff until it succeeds; ts
    // stays untouched during failures (redelivery) and advances afterwards.
    // 2 failed attempts + 1 success in batch 1, then the redelivered event
    // succeeds in batch 2: the event is observed 4 times in total.
    expect(harness.updates).toEqual([UPDATE_A, UPDATE_A, UPDATE_A, UPDATE_A]);
    expect(harness.savedTs).toEqual(["601", "602"]);
  });

  it("stops without further requests once aborted", async () => {
    const harness = createHarness([
      { status: 200, body: { ts: "701", updates: [UPDATE_A] } },
      { status: 200, body: { ts: "702", updates: [] } },
    ]);
    harness.controller.abort();

    await runUntilIdle(harness.longPoll);

    expect(harness.updates).toEqual([]);
    expect(harness.requestedUrls).toHaveLength(0);
  });
});
