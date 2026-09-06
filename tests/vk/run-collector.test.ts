import { describe, expect, it, vi } from "vitest";
import { defined } from "../helpers/defined.js";
import { VkRunCollector, type RunResult } from "../../src/vk/run-collector.js";

// The collector subscribes through opencode/events.ts; in unit tests the
// event stream is fed directly via processEvent(). The rest of the module's
// exports stay real — global test setup (resetSingletonState) uses them.
vi.mock("../../src/opencode/events.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  subscribeToEvents: vi.fn(async () => {}),
}));

const SESSION = "ses-1";
const DIRECTORY = "/repo";

function partUpdated(text: string, partId = "p1", messageId = "m1") {
  return {
    type: "message.part.updated",
    properties: {
      part: { id: partId, sessionID: SESSION, messageID: messageId, type: "text", text },
    },
  };
}

function partDelta(delta: string, partId = "p1", messageId = "m1") {
  return {
    type: "message.part.delta",
    properties: { sessionID: SESSION, messageID: messageId, partID: partId, type: "text", delta },
  };
}

function sessionIdle(sessionId = SESSION) {
  return { type: "session.idle", properties: { sessionID: sessionId } };
}

function sessionError(message: string, sessionId = SESSION) {
  return { type: "session.error", properties: { sessionID: sessionId, error: { message } } };
}

async function createCollector() {
  const results: RunResult[] = [];
  const errors: Array<{ sessionId: string; message: string }> = [];
  const collector = new VkRunCollector({
    onComplete: async (result) => {
      results.push(result);
    },
    onError: async (sessionId, message) => {
      errors.push({ sessionId, message });
    },
  });
  return { collector, results, errors };
}

describe("vk run collector", () => {
  it("assembles full-text part updates and finishes on session.idle", async () => {
    const { collector, results } = await createCollector();
    await collector.begin(SESSION, DIRECTORY);

    collector.processEvent(partUpdated("Первый абзац.", "p1", "m1"));
    collector.processEvent(partUpdated("Второй абзац.", "p2", "m1"));
    collector.processEvent(sessionIdle());

    expect(results).toHaveLength(1);
    expect(defined(results[0]).sessionId).toBe(SESSION);
    expect(defined(results[0]).text).toBe("Первый абзац.\n\nВторой абзац.");
    expect(collector.isActive()).toBe(false);
  });

  it("appends streaming deltas to the same part", async () => {
    const { collector, results } = await createCollector();
    await collector.begin(SESSION, DIRECTORY);

    collector.processEvent(partUpdated("При", "p1", "m1"));
    collector.processEvent(partDelta("вет", "p1", "m1"));
    collector.processEvent(partDelta(" мир", "p1", "m1"));
    collector.processEvent(sessionIdle());

    expect(defined(results[0]).text).toBe("Привет мир");
  });

  it("keeps ordering between distinct messages and parts", async () => {
    const { collector, results } = await createCollector();
    await collector.begin(SESSION, DIRECTORY);

    collector.processEvent(partUpdated("из m1", "p1", "m1"));
    collector.processEvent(partUpdated("из m2", "p9", "m2"));
    collector.processEvent(sessionIdle());

    expect(defined(results[0]).text).toBe("из m1\n\nиз m2");
  });

  it("ignores events of other sessions", async () => {
    const { collector, results } = await createCollector();
    await collector.begin(SESSION, DIRECTORY);

    collector.processEvent(partUpdated("чужое", "p1", "m1"));
    collector.processEvent({ type: "session.idle", properties: { sessionID: "other" } });

    expect(results).toHaveLength(0);
    expect(collector.isActive()).toBe(true);
  });

  it("skips synthetic parts", async () => {
    const { collector, results } = await createCollector();
    await collector.begin(SESSION, DIRECTORY);

    collector.processEvent({
      type: "message.part.updated",
      properties: {
        part: { id: "s1", sessionID: SESSION, messageID: "m1", type: "text", synthetic: true, text: "synthetic" },
      },
    });
    collector.processEvent(sessionIdle());

    expect(defined(results[0]).text).toBe("");
  });

  it("reports session errors through onError", async () => {
    const { collector, results, errors } = await createCollector();
    await collector.begin(SESSION, DIRECTORY);

    collector.processEvent(sessionError("model exploded"));

    expect(errors).toEqual([{ sessionId: SESSION, message: "model exploded" }]);
    expect(results).toHaveLength(0);
    expect(collector.isActive()).toBe(false);
  });

  it("drops everything after abort()", async () => {
    const { collector, results } = await createCollector();
    await collector.begin(SESSION, DIRECTORY);

    collector.abort();
    collector.processEvent(sessionIdle());

    expect(results).toHaveLength(0);
  });
});
