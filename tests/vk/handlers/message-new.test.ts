import { beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../helpers/defined.js";
import type { VkMessage } from "../../../src/vk/types.js";
import type { VkSender } from "../../../src/vk/send.js";
import type { VkRunCollector } from "../../../src/vk/run-collector.js";

const mocks = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionStatus: vi.fn(),
  sessionPromptAsync: vi.fn(),
  getCurrentProject: vi.fn(),
  setCurrentProject: vi.fn(),
  getCurrentSession: vi.fn(),
  setCurrentSession: vi.fn(),
  clearSession: vi.fn(),
  getProjects: vi.fn(),
  getStoredModel: vi.fn(),
  getStoredAgent: vi.fn(),
  safeBackgroundTask: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: mocks.sessionCreate,
      status: mocks.sessionStatus,
      promptAsync: mocks.sessionPromptAsync,
    },
  },
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: mocks.getCurrentProject,
  setCurrentProject: mocks.setCurrentProject,
}));

vi.mock("../../../src/app/services/session-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/services/session-service.js")>()),
  getCurrentSession: mocks.getCurrentSession,
  setCurrentSession: mocks.setCurrentSession,
  clearSession: mocks.clearSession,
}));

vi.mock("../../../src/app/services/project-service.js", () => ({
  getProjects: mocks.getProjects,
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: mocks.getStoredModel,
}));

vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  getStoredAgent: mocks.getStoredAgent,
  resolveProjectAgent: vi.fn(async () => "build"),
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: mocks.safeBackgroundTask.mockImplementation(async ({ task, onSuccess }) => {
    const result = await task();
    await onSuccess?.(result);
  }),
}));

import { handleOwnerTextMessage } from "../../../src/vk/handlers/message-new.js";

const PEER = 2000000042;
const PROJECT = { worktree: "/repo", id: "p1", name: "repo" } as const;
const SESSION = { id: "ses-1", title: "repo", directory: "/repo" } as const;

function ownerMessage(text: string): VkMessage {
  return { id: 1, date: 1, peer_id: PEER, from_id: 42, text };
}

function createDeps() {
  const sender = { sendText: vi.fn(async () => [] as number[]) } as unknown as VkSender;
  const runCollector = { begin: vi.fn(async () => {}) } as unknown as VkRunCollector;
  return { sender, runCollector };
}

describe("vk message-new handler (US1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks() drops implementations set in the module factory.
    mocks.safeBackgroundTask.mockImplementation(async ({ task, onSuccess }) => {
      const result = await task();
      await onSuccess?.(result);
    });
    mocks.getProjects.mockResolvedValue([PROJECT]);
    mocks.getCurrentProject.mockReturnValue(undefined);
    mocks.getCurrentSession.mockReturnValue(null);
    mocks.sessionCreate.mockResolvedValue({ data: { id: SESSION.id, title: SESSION.title }, error: null });
    mocks.sessionStatus.mockResolvedValue({
      data: { [SESSION.id]: { type: "idle" } },
      error: null,
    });
    mocks.sessionPromptAsync.mockResolvedValue({ error: null });
    mocks.getStoredModel.mockReturnValue({ providerID: "anthropic", modelID: "claude" });
    mocks.getStoredAgent.mockReturnValue(undefined);
    mocks.setCurrentSession.mockImplementation((session) => {
      mocks.getCurrentSession.mockReturnValue(session);
    });
    mocks.setCurrentProject.mockImplementation((project) => {
      mocks.getCurrentProject.mockReturnValue(project);
    });
  });

  it("auto-selects the first project when none is selected", async () => {
    const { sender, runCollector } = createDeps();

    await handleOwnerTextMessage(ownerMessage("привет"), { sender, runCollector, peerId: PEER });

    expect(mocks.setCurrentProject).toHaveBeenCalledWith(PROJECT);
    expect(sender.sendText).toHaveBeenCalledWith(PEER, expect.stringContaining("Creating a new session"));
  });

  it("creates a session, subscribes the collector and dispatches promptAsync", async () => {
    mocks.getCurrentProject.mockReturnValue(PROJECT);
    const { sender, runCollector } = createDeps();

    await handleOwnerTextMessage(ownerMessage("сделай фичу"), { sender, runCollector, peerId: PEER });

    expect(runCollector.begin).toHaveBeenCalledWith(SESSION.id, "/repo");
    expect(mocks.sessionPromptAsync).toHaveBeenCalledTimes(1);
    const promptArgs = defined(mocks.sessionPromptAsync.mock.calls[0])[0];
    expect(promptArgs.sessionID).toBe(SESSION.id);
    expect(promptArgs.directory).toBe("/repo");
    expect(promptArgs.parts).toEqual([{ type: "text", text: "сделай фичу" }]);
    expect(promptArgs.model).toEqual({ providerID: "anthropic", modelID: "claude" });
    expect(sender.sendText).toHaveBeenCalledWith(PEER, expect.stringContaining("Creating a new session"));
  });

  it("rejects a prompt with a busy notice when the session is busy", async () => {
    mocks.getCurrentProject.mockReturnValue(PROJECT);
    mocks.getCurrentSession.mockReturnValue(SESSION);
    mocks.sessionStatus.mockResolvedValue({
      data: { [SESSION.id]: { type: "busy" } },
      error: null,
    });
    const { sender, runCollector } = createDeps();

    await handleOwnerTextMessage(ownerMessage("ещё"), { sender, runCollector, peerId: PEER });

    expect(runCollector.begin).not.toHaveBeenCalled();
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled();
    expect(sender.sendText).toHaveBeenCalledWith(PEER, expect.any(String));
    const sent = (sender.sendText as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(sent.toLowerCase()).toContain("already running");
  });

  it("replies with a failure notice when promptAsync reports an API error", async () => {
    mocks.getCurrentProject.mockReturnValue(PROJECT);
    mocks.getCurrentSession.mockReturnValue(SESSION);
    mocks.sessionPromptAsync.mockResolvedValue({ error: { message: "boom" } });
    const { sender, runCollector } = createDeps();

    await handleOwnerTextMessage(ownerMessage("тест"), { sender, runCollector, peerId: PEER });

    const sentTexts = (sender.sendText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(sentTexts.some((text: string) => text.includes("Failed to send request"))).toBe(true);
  });

  it("resets the session on project mismatch and reports the reset", async () => {
    mocks.getCurrentProject.mockReturnValue(PROJECT);
    mocks.getCurrentSession.mockReturnValue({ id: "old", title: "old", directory: "/other" });
    const { sender, runCollector } = createDeps();

    await handleOwnerTextMessage(ownerMessage("привет"), { sender, runCollector, peerId: PEER });

    expect(mocks.clearSession).toHaveBeenCalled();
    expect(mocks.sessionCreate).toHaveBeenCalled();
  });

  it("ignores empty text messages", async () => {
    const { sender, runCollector } = createDeps();

    await handleOwnerTextMessage(ownerMessage("   "), { sender, runCollector, peerId: PEER });

    expect(sender.sendText).not.toHaveBeenCalled();
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled();
  });
});
