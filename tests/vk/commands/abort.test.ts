import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VkSender } from "../../../src/vk/send.js";

const mocks = vi.hoisted(() => ({
  sessionAbort: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      abort: mocks.sessionAbort,
    },
  },
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: mocks.getCurrentSession,
}));

import { handleAbortIfRequested } from "../../../src/vk/commands/abort.js";

const PEER = 2000000042;
const SESSION = { id: "ses-1", title: "repo", directory: "/repo" };

function createSender() {
  return { sendText: vi.fn(async () => [] as number[]) } as unknown as VkSender;
}

describe("/abort command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores non-abort text", async () => {
    const sender = createSender();

    const outcome = await handleAbortIfRequested("обычный текст", sender, PEER);

    expect(outcome.handled).toBe(false);
    expect(sender.sendText).not.toHaveBeenCalled();
  });

  it("reports when there is no running session", async () => {
    mocks.getCurrentSession.mockReturnValue(null);
    const sender = createSender();

    const outcome = await handleAbortIfRequested("/abort", sender, PEER);

    expect(outcome.handled).toBe(true);
    const sent = (sender.sendText as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(sent).toContain("No running task");
  });

  it("aborts the current session through the backend", async () => {
    mocks.getCurrentSession.mockReturnValue(SESSION);
    mocks.sessionAbort.mockResolvedValue({ data: true, error: null });
    const sender = createSender();

    const outcome = await handleAbortIfRequested("/abort", sender, PEER);

    expect(outcome.handled).toBe(true);
    expect(mocks.sessionAbort).toHaveBeenCalledWith(
      { sessionID: SESSION.id, directory: SESSION.directory },
      expect.anything(),
    );
    const sent = (sender.sendText as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(sent).toContain("stopped");
  });

  it("reports backend abort failures", async () => {
    mocks.getCurrentSession.mockReturnValue(SESSION);
    mocks.sessionAbort.mockResolvedValue({ data: null, error: { message: "boom" } });
    const sender = createSender();

    const outcome = await handleAbortIfRequested("/abort", sender, PEER);

    expect(outcome.handled).toBe(true);
    const sent = (sender.sendText as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(sent).toContain("Failed to stop");
  });
});
