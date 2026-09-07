import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end flow tests (spec 002, "End-to-End Flows" F0–F9): every test
 * drives the REAL pipeline — raw Long Poll update → normalizer → command
 * router → pickers → inline tap resolution → sender — with only the
 * transport boundaries mocked (VK HTTPS API via a scripted fetch, OpenCode
 * SDK via module mocks). Assertions inspect the outbound messages.send
 * calls (text + keyboard), i.e. exactly what the owner sees in VK.
 */

const mocks = vi.hoisted(() => ({
  sessionList: vi.fn(),
  sessionCreate: vi.fn(),
  sessionStatus: vi.fn(),
  sessionAbort: vi.fn(),
  sessionPromptAsync: vi.fn(),
  sessionUpdate: vi.fn(),
  permissionReply: vi.fn(),
  questionReply: vi.fn(),
  subscribeToEvents: vi.fn(),
  getCurrentProject: vi.fn(),
  setCurrentProject: vi.fn(),
  getCurrentSession: vi.fn(),
  setCurrentSession: vi.fn(),
  clearSession: vi.fn(),
  getProjects: vi.fn(),
  getStoredModel: vi.fn(),
  getStoredAgent: vi.fn(),
  getProviders: vi.fn(),
  getProviderModels: vi.fn(),
  selectModel: vi.fn(),
  ingestSessionInfoForCache: vi.fn(),
  safeBackgroundTask: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      list: mocks.sessionList,
      create: mocks.sessionCreate,
      status: mocks.sessionStatus,
      abort: mocks.sessionAbort,
      promptAsync: mocks.sessionPromptAsync,
      update: mocks.sessionUpdate,
    },
    permission: { reply: mocks.permissionReply },
    question: { reply: mocks.questionReply },
  },
}));

vi.mock("../../src/opencode/events.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/opencode/events.js")>()),
  subscribeToEvents: mocks.subscribeToEvents,
}));

vi.mock("../../src/app/stores/settings-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/stores/settings-store.js")>()),
  getCurrentProject: mocks.getCurrentProject,
  setCurrentProject: mocks.setCurrentProject,
}));

vi.mock("../../src/app/services/session-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/services/session-service.js")>()),
  getCurrentSession: mocks.getCurrentSession,
  setCurrentSession: mocks.setCurrentSession,
  clearSession: mocks.clearSession,
}));

vi.mock("../../src/app/services/project-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/services/project-service.js")>()),
  getProjects: mocks.getProjects,
}));

vi.mock("../../src/app/services/model-selection-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/services/model-selection-service.js")>()),
  getStoredModel: mocks.getStoredModel,
  getProviders: mocks.getProviders,
  getProviderModels: mocks.getProviderModels,
  selectModel: mocks.selectModel,
}));

vi.mock("../../src/app/services/agent-selection-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/services/agent-selection-service.js")>()),
  getStoredAgent: mocks.getStoredAgent,
  resolveProjectAgent: vi.fn(async () => undefined),
}));

vi.mock("../../src/app/services/session-cache-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/app/services/session-cache-service.js")>()),
  ingestSessionInfoForCache: mocks.ingestSessionInfoForCache,
}));

vi.mock("../../src/utils/safe-background-task.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/safe-background-task.js")>()),
  safeBackgroundTask: mocks.safeBackgroundTask,
}));

import { VkBot } from "../../src/vk/index.js";

const PEER = 2000000042;
const OWNER = 123456789;

const PROJECT_A = { id: "proj-a", name: "alpha", worktree: "/repo-a" };
const PROJECT_B = { id: "proj-b", name: "beta", worktree: "/repo-b" };
const SESSION_1 = { id: "ses-1", title: "fix bug", directory: "/repo-a" };
const SESSION_2 = { id: "ses-2", title: "write docs", directory: "/repo-a" };

interface RecordedRequest {
  method: string;
  params: URLSearchParams;
}

/** Minimal scripted VK HTTPS API mock: records calls, answers success. */
function createVkApiMock(): { requests: RecordedRequest[]; fetchImpl: typeof fetch } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const method = String(input).replace("https://api.vk.com/method/", "");
    const rawBody = init?.body;
    const body = typeof rawBody === "string" || rawBody instanceof URLSearchParams
      ? String(rawBody)
      : "";
    requests.push({ method, params: new URLSearchParams(body) });
    return Response.json({ response: requests.length }, { status: 200 });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

let vkApi: { requests: RecordedRequest[]; fetchImpl: typeof fetch };
let bot: VkBot;
let eventSeq = 0;
/** Captured SSE event handler from the mocked subscribeToEvents. */
let emitEvent: ((event: unknown) => void) | null = null;

function ownerTextUpdate(text: string): Record<string, unknown> {
  eventSeq += 1;
  return {
    type: "message_new",
    group_id: 12345,
    event_id: `me-${eventSeq}`,
    object: {
      message: { id: 100 + eventSeq, date: 1, peer_id: PEER, from_id: OWNER, text },
    },
  };
}

/** Long Poll delivers button payloads as already-parsed objects (FR-111). */
function buttonEventUpdate(payload: unknown): Record<string, unknown> {
  eventSeq += 1;
  return {
    type: "message_event",
    group_id: 12345,
    event_id: `be-${eventSeq}`,
    object: { user_id: OWNER, peer_id: PEER, event_id: `be-${eventSeq}`, payload },
  };
}

function sentMessages(): RecordedRequest[] {
  return vkApi.requests.filter((r) => r.method === "messages.send");
}

function messageTexts(): string[] {
  return sentMessages().map((r) => String(r.params.get("message") ?? ""));
}

function deletedMessageIds(): number[] {
  return vkApi.requests
    .filter((r) => r.method === "messages.delete")
    .map((r) => Number(r.params.get("message_ids")));
}

function lastText(): string {
  const texts = messageTexts();
  expect(texts.length, "expected at least one sent message").toBeGreaterThan(0);
  return texts.at(-1)!;
}

interface SentKeyboard {
  inline: boolean | undefined;
  labels: string[][];
  payloads: Array<Record<string, unknown>>;
}

function sentKeyboards(): SentKeyboard[] {
  return sentMessages()
    .map((r) => r.params.get("keyboard"))
    .filter((raw): raw is string => raw !== null)
    .map((raw) => {
      const kb = JSON.parse(raw) as {
        inline?: boolean;
        buttons: Array<Array<{ action: { label: string; payload?: string } }>>;
      };
      return {
        inline: kb.inline,
        labels: kb.buttons.map((row) => row.map((b) => b.action.label)),
        payloads: kb.buttons
          .flat()
          .map((b) => (b.action.payload ? (JSON.parse(b.action.payload) as Record<string, unknown>) : {})),
      };
    });
}

/** Payload of the first button of the most recent inline keyboard message. */
function lastInlinePayload(): Record<string, unknown> {
  const inlines = sentKeyboards().filter((kb) => kb.inline === true);
  expect(inlines.length, "expected an inline picker message").toBeGreaterThan(0);
  return inlines.at(-1)!.payloads[0]!;
}

/** Payload of the «◀️»/«▶️»/«⬅️ Меню» button of the most recent picker. */
function lastInlineNavPayload(kind: "prev" | "next" | "back"): Record<string, unknown> {
  const inlines = sentKeyboards().filter((kb) => kb.inline === true);
  expect(inlines.length, "expected an inline picker message").toBeGreaterThan(0);
  const button = inlines.at(-1)!.payloads.find((p) => p.k === kind);
  if (!button) {
    throw new Error(`no ${kind} button on the last picker`);
  }
  return button;
}

function inlinePickerRows(): string[][] {
  const inlines = sentKeyboards().filter((kb) => kb.inline === true);
  expect(inlines.length, "expected an inline picker message").toBeGreaterThan(0);
  return inlines.at(-1)!.labels;
}

function lastMainKeyboardAttached(): boolean {
  const last = sentMessages().at(-1);
  if (!last) {
    return false;
  }
  const raw = last.params.get("keyboard");
  if (!raw) {
    return false;
  }
  const kb = JSON.parse(raw) as { inline?: boolean; buttons: unknown[][] };
  return kb.inline !== true && kb.buttons.length === 3;
}

/** Wait until `predicate` holds on the sent messages (fire-and-forget sends). */
async function waitUntil(predicate: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    expect(predicate()).toBe(true);
  });
}

beforeEach(() => {
  eventSeq = 0;
  emitEvent = null;
  vkApi = createVkApiMock();
  vi.stubGlobal("fetch", vkApi.fetchImpl);
  bot = new VkBot();

  mocks.safeBackgroundTask.mockImplementation(async ({ task, onSuccess }) => {
    const result = await task();
    await onSuccess?.(result);
  });
  mocks.subscribeToEvents.mockImplementation(
    async (_directory: string, handler: (event: unknown) => void) => {
      emitEvent = handler;
      await new Promise(() => {}); // long-running listener, never resolves
    },
  );

  mocks.getCurrentProject.mockReturnValue(PROJECT_A);
  mocks.setCurrentProject.mockImplementation((project: { id: string }) => {
    mocks.getCurrentProject.mockReturnValue(project);
  });
  mocks.getCurrentSession.mockReturnValue(null);
  mocks.setCurrentSession.mockImplementation((session: { id: string }) => {
    mocks.getCurrentSession.mockReturnValue(session);
  });
  mocks.clearSession.mockImplementation(() => {
    mocks.getCurrentSession.mockReturnValue(null);
  });
  mocks.getProjects.mockResolvedValue([PROJECT_A, PROJECT_B]);
  mocks.getStoredModel.mockReturnValue({ providerID: "prov", modelID: "test-model" });
  mocks.getStoredAgent.mockReturnValue(undefined);
  mocks.getProviders.mockResolvedValue([{ id: "prov" }]);
  mocks.getProviderModels.mockResolvedValue([
    { providerID: "prov", modelID: "model-a" },
    { providerID: "prov", modelID: "model-b" },
  ]);
  mocks.selectModel.mockImplementation((model: { providerID: string; modelID: string }) => {
    mocks.getStoredModel.mockReturnValue(model);
  });
  mocks.sessionList.mockResolvedValue({
    data: [
      { id: SESSION_1.id, title: SESSION_1.title, directory: SESSION_1.directory },
      { id: SESSION_2.id, title: SESSION_2.title, directory: SESSION_2.directory },
    ],
    error: null,
  });
  mocks.sessionCreate.mockResolvedValue({
    data: { id: "ses-new", title: "New session" },
    error: null,
  });
  mocks.sessionStatus.mockResolvedValue({ data: {}, error: null });
  mocks.sessionPromptAsync.mockResolvedValue({ error: null });
  mocks.sessionAbort.mockResolvedValue({ error: null });
});

/** Drives F0.2–F0.4: free text → session → run view → completion → main view. */
async function runFullPromptCycle(text: string): Promise<void> {
  await bot.handleUpdate(ownerTextUpdate(text));
  await waitUntil(() => messageTexts().some((t) => t.startsWith("⚙️ Task started.")));

  emitEvent!({
    type: "message.part.updated",
    properties: {
      part: { type: "text", id: "p1", messageID: "msg-1", sessionID: "ses-new", text: "Done." },
    },
  });
  emitEvent!({ type: "session.idle", properties: { sessionID: "ses-new" } });
  await waitUntil(() => messageTexts().some((t) => t === "Done."));
}describe("F0 — baseline prompt loop", () => {
  it("free text auto-selects a project, creates a session, switches to run view, and returns to main view on completion", async () => {
    mocks.getCurrentProject.mockReturnValue(undefined);

    await runFullPromptCycle("implement feature X");

    expect(mocks.setCurrentProject).toHaveBeenCalledWith(PROJECT_A);
    expect(mocks.sessionCreate).toHaveBeenCalledTimes(1);
    expect(mocks.sessionPromptAsync).toHaveBeenCalledTimes(1);
    expect(mocks.sessionPromptAsync.mock.calls[0]![0].sessionID).toBe("ses-new");

    // Run view keyboard on the run-started message (silent, FR-114).
    expect(messageTexts().some((t) => t === "⚙️ Task started. Controls below.")).toBe(true);
    const runKeyboardMessage = sentMessages().find((r) =>
      String(r.params.get("message") ?? "").startsWith("⚙️ Task started."),
    );
    expect(runKeyboardMessage!.params.get("disable_notification")).toBe("1");
    const runKb = JSON.parse(runKeyboardMessage!.params.get("keyboard")!) as {
      buttons: Array<Array<{ action: { label: string } }>>;
    };
    expect(runKb.buttons.flat().map((b) => b.action.label)).toEqual([
      "⏹ Стоп",
      "📊 Статус",
      "🏠 Меню",
    ]);

    // Final reply restores the main view (3-row reply keyboard) and is the
    // one message allowed to notify (FR-114).
    expect(lastText()).toBe("Done.");
    expect(lastMainKeyboardAttached()).toBe(true);
    const finalMessage = sentMessages().at(-1)!;
    expect(finalMessage.params.get("disable_notification")).toBeNull();
  });

  it("live status shows the running tool and its context (FR-115)", async () => {
    await bot.handleUpdate(ownerTextUpdate("do work with tools"));
    await waitUntil(() => messageTexts().some((t) => t.startsWith("⚙️ Task started.")));

    emitEvent!({
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          tool: "edit",
          sessionID: "ses-new",
          state: { input: { filePath: "/repo-a/src/index.ts" } },
        },
      },
    });
    await waitUntil(() => messageTexts().some((t) => t.includes("edit")));

    const statusMessage = messageTexts().find((t) => t.includes("edit"))!;
    expect(statusMessage).toContain("/repo-a/src/index.ts");
    expect(statusMessage).toContain("1");
    // Status updates are silent (FR-114).
    const statusSend = sentMessages().find((r) =>
      String(r.params.get("message") ?? "").includes("edit"),
    );
    expect(statusSend!.params.get("disable_notification")).toBe("1");
  });

  it("session/project mismatch resets the session instead of prompting into a foreign directory", async () => {
    mocks.getCurrentSession.mockReturnValue({ ...SESSION_1, directory: "/repo-a" });
    mocks.getCurrentProject.mockReturnValue(PROJECT_B);

    await bot.handleUpdate(ownerTextUpdate("hello there"));

    expect(mocks.clearSession).toHaveBeenCalled();
    expect(mocks.sessionPromptAsync.mock.calls[0]![0].directory).toBe("/repo-b");
  });

  it("a run finishing with empty text still returns the main view (F0.4)", async () => {
    await bot.handleUpdate(ownerTextUpdate("say nothing"));
    await waitUntil(() => messageTexts().some((t) => t.startsWith("⚙️ Task started.")));

    emitEvent!({ type: "session.idle", properties: { sessionID: "ses-new" } });

    await waitUntil(() =>
      messageTexts().some((t) => t === "✅ Task finished (no text reply)."),
    );
    expect(lastMainKeyboardAttached()).toBe(true);
  });

  it("a run error delivers the error text and restores the main view (F0.5)", async () => {
    await bot.handleUpdate(ownerTextUpdate("break things"));
    await waitUntil(() => messageTexts().some((t) => t.startsWith("⚙️ Task started.")));

    emitEvent!({
      type: "session.error",
      properties: { sessionID: "ses-new", error: { message: "boom" } },
    });

    await waitUntil(() => messageTexts().some((t) => t === "🔴 Something went wrong."));
    expect(lastMainKeyboardAttached()).toBe(true);
    // Run errors are completion signals: they notify (FR-114).
    const errorSend = sentMessages().find((r) =>
      String(r.params.get("message") ?? "") === "🔴 Something went wrong.",
    );
    expect(errorSend!.params.get("disable_notification")).toBeNull();
  });
});

describe("F1/F7 — help and status labels", () => {
  it("«❓ Помощь» label answers with the help text and the main view (F1)", async () => {
    await bot.handleUpdate(ownerTextUpdate("❓ Помощь"));

    expect(lastText()).toContain("Available commands:");
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled();
  });

  it("typed /help answers identically (F1, FR-102)", async () => {
    await bot.handleUpdate(ownerTextUpdate("/help"));

    expect(lastText()).toContain("Available commands:");
    expect(lastMainKeyboardAttached()).toBe(true);
  });

  it("«📊 Статус» label answers with the status report (F7)", async () => {
    await bot.handleUpdate(ownerTextUpdate("📊 Статус"));

    expect(lastText()).toContain("Project: alpha");
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled();
  });
});

describe("F2 — new task with project choice", () => {
  it("«🆕 Новая» with several projects opens the project picker (F2.1–F2.2)", async () => {
    await bot.handleUpdate(ownerTextUpdate("🆕 Новая"));

    expect(mocks.clearSession).toHaveBeenCalled();
    expect(lastText()).toBe("🆕 Session cleared. Pick the project for the new task:\nTotal: 2");
    expect(inlinePickerRows()).toEqual([["alpha"], ["beta"], ["⬅️ Меню"]]);
  });

  it("tapping a project switches to it and returns the main view; the next text starts a session there (F2.2)", async () => {
    await bot.handleUpdate(ownerTextUpdate("🆕 Новая"));
    const tap = lastInlinePayload();
    vkApi.requests.length = 0;

    await bot.handleUpdate(buttonEventUpdate({ ...tap, x: 1 }));

    expect(lastText()).toBe("✅ Project switched: beta");
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(mocks.clearSession).toHaveBeenCalled();

    // Next free text: session created in the chosen project, no picker.
    await bot.handleUpdate(ownerTextUpdate("do the task"));
    await waitUntil(() => mocks.sessionPromptAsync.mock.calls.length > 0);
    expect(mocks.sessionPromptAsync.mock.calls[0]![0].directory).toBe("/repo-b");
  });

  it("«⬅️ Меню» on the /new picker returns the main view (F2.2/F9.3)", async () => {
    await bot.handleUpdate(ownerTextUpdate("🆕 Новая"));
    await bot.handleUpdate(buttonEventUpdate({ ...lastInlinePayload(), k: "back" }));

    expect(lastText()).toBe("🏠 Main menu.");
    expect(lastMainKeyboardAttached()).toBe(true);
  });

  it("with a single project «🆕 Новая» just confirms the reset (F2.3)", async () => {
    mocks.getProjects.mockResolvedValue([PROJECT_A]);

    await bot.handleUpdate(ownerTextUpdate("/new"));

    expect(lastText()).toBe("🆕 Session cleared. Your next message starts a new task.");
    expect(lastMainKeyboardAttached()).toBe(true);
  });

  it("with zero projects «🆕 Новая» just confirms the reset (F2.3)", async () => {
    mocks.getProjects.mockResolvedValue([]);

    await bot.handleUpdate(ownerTextUpdate("/new"));

    expect(lastText()).toBe("🆕 Session cleared. Your next message starts a new task.");
    expect(lastMainKeyboardAttached()).toBe(true);
  });
});

describe("F3 — session resume", () => {
  it("«📋 Сессии» shows the picker; tapping a session resumes it and the next text prompts THAT session (F3.1–F3.2)", async () => {
    await bot.handleUpdate(ownerTextUpdate("📋 Сессии"));

    expect(lastText()).toBe("Recent sessions — tap to resume:\nTotal: 2");
    expect(inlinePickerRows()).toEqual([["fix bug"], ["write docs"], ["⬅️ Меню"]]);

    await bot.handleUpdate(buttonEventUpdate(lastInlinePayload()));

    expect(lastText()).toBe("✅ Session resumed: fix bug");
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(mocks.setCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: SESSION_1.id, directory: SESSION_1.directory }),
    );

    // Resumed: the next prompt goes to the resumed session, no new session.
    await bot.handleUpdate(ownerTextUpdate("continue the task"));
    await waitUntil(() => mocks.sessionPromptAsync.mock.calls.length > 0);
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    expect(mocks.sessionPromptAsync.mock.calls[0]![0].sessionID).toBe(SESSION_1.id);
  });

  it("/sessions with no sessions answers without a picker (F3.1)", async () => {
    mocks.sessionList.mockResolvedValue({ data: [], error: null });

    await bot.handleUpdate(ownerTextUpdate("/sessions"));

    expect(lastText()).toBe("No saved sessions yet.");
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(sentKeyboards().filter((kb) => kb.inline === true)).toHaveLength(0);
  });

  it("«⬅️ Меню» on the sessions picker returns the main view (F3.3)", async () => {
    await bot.handleUpdate(ownerTextUpdate("📋 Сессии"));
    await bot.handleUpdate(buttonEventUpdate({ ...lastInlinePayload(), k: "back" }));

    expect(lastText()).toBe("🏠 Main menu.");
    expect(lastMainKeyboardAttached()).toBe(true);
  });

  it("removes the consumed picker message so dead buttons disappear (FR-116)", async () => {
    await bot.handleUpdate(ownerTextUpdate("📋 Сессии"));
    const pickerMessageId = vkApi.requests.length;

    await bot.handleUpdate(buttonEventUpdate(lastInlinePayload()));

    expect(lastText()).toBe("✅ Session resumed: fix bug");
    expect(deletedMessageIds()).toContain(pickerMessageId);
  });

  it("back removes the picker message too (FR-116)", async () => {
    await bot.handleUpdate(ownerTextUpdate("📋 Сессии"));
    const pickerMessageId = vkApi.requests.length;

    await bot.handleUpdate(buttonEventUpdate({ ...lastInlinePayload(), k: "back" }));

    expect(lastText()).toBe("🏠 Main menu.");
    expect(deletedMessageIds()).toContain(pickerMessageId);
  });

  it("paging removes the previous page message (FR-116)", async () => {
    mocks.sessionList.mockResolvedValue({
      data: Array.from({ length: 12 }, (_, i) => ({
        id: `s-${i}`,
        title: `session ${i}`,
        directory: "/repo-a",
      })),
      error: null,
    });

    await bot.handleUpdate(ownerTextUpdate("/sessions"));
    const page1MessageId = vkApi.requests.length;

    await bot.handleUpdate(buttonEventUpdate(lastInlineNavPayload("next")));

    expect(lastText()).toContain("page 2 of 3");
    expect(deletedMessageIds()).toContain(page1MessageId);
  });
});

describe("F4/F5 — project and model switchers", () => {
  it("«📁 Проекты» → tap switches project and clears the session (F4.2)", async () => {
    mocks.getCurrentSession.mockReturnValue(SESSION_1);

    await bot.handleUpdate(ownerTextUpdate("📁 Проекты"));

    expect(inlinePickerRows()).toEqual([["alpha"], ["beta"], ["⬅️ Меню"]]);

    const pickerMessageId = vkApi.requests.length;
    await bot.handleUpdate(buttonEventUpdate(lastInlinePayload()));

    expect(lastText()).toBe("✅ Project switched: alpha");
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(deletedMessageIds()).toContain(pickerMessageId);
  });

  it("«🤖 Модели» → tap stores the model and confirms (F5.2)", async () => {
    await bot.handleUpdate(ownerTextUpdate("🤖 Модели"));

    expect(inlinePickerRows()).toEqual([
      ["prov/model-a"],
      ["prov/model-b"],
      ["⬅️ Меню"],
    ]);

    await bot.handleUpdate(buttonEventUpdate(lastInlinePayload()));

    expect(lastText()).toBe("✅ Model switched: prov/model-a");
    expect(mocks.selectModel).toHaveBeenCalledWith({ providerID: "prov", modelID: "model-a" });
    expect(lastMainKeyboardAttached()).toBe(true);
  });

  it("/models with no providers answers without a picker (F5.1)", async () => {
    mocks.getProviders.mockResolvedValue([]);

    await bot.handleUpdate(ownerTextUpdate("/models"));

    expect(lastText()).toBe("No models available.");
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(sentKeyboards().filter((kb) => kb.inline === true)).toHaveLength(0);
  });
});

describe("F6 — stop controls", () => {
  it("«⏹ Стоп» label aborts the current session and never reaches the agent (F6.1)", async () => {
    mocks.getCurrentSession.mockReturnValue(SESSION_1);
    mocks.sessionStatus.mockResolvedValue({
      data: { [SESSION_1.id]: { type: "busy" } },
      error: null,
    });

    await bot.handleUpdate(ownerTextUpdate("⏹ Стоп"));

    expect(mocks.sessionAbort).toHaveBeenCalledTimes(1);
    expect(lastText()).toBe("⏹ Task stopped.");
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled();
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it("«⏹ Стоп» on a merely bound (idle) session does not claim a stop (F6.2)", async () => {
    mocks.getCurrentSession.mockReturnValue(SESSION_1);
    mocks.sessionStatus.mockResolvedValue({
      data: { [SESSION_1.id]: { type: "idle" } },
      error: null,
    });

    await bot.handleUpdate(ownerTextUpdate("⏹ Стоп"));
    await bot.handleUpdate(ownerTextUpdate("⏹ Стоп"));

    expect(mocks.sessionAbort).not.toHaveBeenCalled();
    expect(lastText()).toBe("No running task to stop.");
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled();
  });

  it("«⏹ Стоп» with nothing running reports it (F6.2)", async () => {
    mocks.getCurrentSession.mockReturnValue(null);

    await bot.handleUpdate(ownerTextUpdate("/stop"));

    expect(lastText()).toBe("No running task to stop.");
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(mocks.sessionAbort).not.toHaveBeenCalled();
  });

  it("the follow-up error of an aborted session is suppressed (F6.1)", async () => {
    await bot.handleUpdate(ownerTextUpdate("start a long task"));
    await waitUntil(() => messageTexts().some((t) => t.startsWith("⚙️ Task started.")));

    mocks.getCurrentSession.mockReturnValue({
      id: "ses-new",
      title: "New session",
      directory: "/repo-a",
    });
    mocks.sessionStatus.mockResolvedValue({
      data: { "ses-new": { type: "busy" } },
      error: null,
    });
    await bot.handleUpdate(ownerTextUpdate("⏹ Стоп"));
    await waitUntil(() => messageTexts().some((t) => t === "⏹ Task stopped."));

    const countBefore = sentMessages().length;
    emitEvent!({
      type: "session.error",
      properties: { sessionID: "ses-new", error: { message: "aborted by owner" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(sentMessages().length).toBe(countBefore);
  });

  it("«🏠 Меню» label returns the main view and never reaches the agent (F6/F8.3)", async () => {
    await bot.handleUpdate(ownerTextUpdate("🏠 Меню"));

    expect(lastText()).toBe("🏠 Main menu.");
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(mocks.sessionPromptAsync).not.toHaveBeenCalled();
  });
});

describe("F8 — free text is never lost", () => {
  it("free text at any view goes to the agent as a prompt", async () => {
    await bot.handleUpdate(ownerTextUpdate("just build it"));

    await waitUntil(() => mocks.sessionPromptAsync.mock.calls.length > 0);
    const call = mocks.sessionPromptAsync.mock.calls[0]![0];
    expect(call.sessionID).toBe("ses-new");
    expect(call.parts[0]).toMatchObject({ type: "text", text: "just build it" });
  });
});

describe("F9 — stale and unknown taps", () => {
  it("a tap on an unknown menu id answers with the outdated hint and the main view (F9.1)", async () => {
    await bot.handleUpdate(buttonEventUpdate({ v: 1, k: "pick", m: "m-gone", x: 0 }));

    expect(lastText()).toBe("This menu is outdated. Ask again for a fresh one.");
    expect(lastMainKeyboardAttached()).toBe(true);
  });

  it("an unparseable payload is answered with the same hint, never silently (F9.2)", async () => {
    await bot.handleUpdate(buttonEventUpdate({ nonsense: true }));

    expect(lastText()).toBe("This menu is outdated. Ask again for a fresh one.");
    expect(lastMainKeyboardAttached()).toBe(true);
  });

  it("a tap on an already-used menu is stale too (double tap)", async () => {
    await bot.handleUpdate(ownerTextUpdate("📋 Сессии"));
    const payload = lastInlinePayload();
    await bot.handleUpdate(buttonEventUpdate(payload));
    const messagesBefore = sentMessages().length;

    await bot.handleUpdate(buttonEventUpdate(payload));

    expect(lastText()).toBe("This menu is outdated. Ask again for a fresh one.");
    expect(lastMainKeyboardAttached()).toBe(true);
    expect(sentMessages().length).toBeGreaterThan(messagesBefore);
  });

  it("a stale project tap (project vanished) answers with the hint instead of hanging", async () => {
    await bot.handleUpdate(ownerTextUpdate("📁 Проекты"));
    const tap = lastInlinePayload();
    mocks.getProjects.mockResolvedValue([]);

    await bot.handleUpdate(buttonEventUpdate(tap));

    expect(lastText()).toBe("This menu is outdated. Ask again for a fresh one.");
    expect(lastMainKeyboardAttached()).toBe(true);
  });
});

describe("payload shape compatibility (FR-111)", () => {
  it("accepts legacy JSON-string payloads as well as Long Poll object payloads", async () => {
    await bot.handleUpdate(ownerTextUpdate("📋 Сессии"));
    const payload = lastInlinePayload();
    const stringPayloadUpdate = {
      type: "message_event",
      group_id: 12345,
      event_id: "be-str",
      object: {
        user_id: OWNER,
        peer_id: PEER,
        event_id: "be-str",
        payload: JSON.stringify(payload),
      },
    };

    await bot.handleUpdate(stringPayloadUpdate);

    expect(lastText()).toBe("✅ Session resumed: fix bug");
  });
});

describe("option identity (FR-104/SC-103)", () => {
  it("taps resolve by stored identity, not by label", async () => {
    mocks.sessionList.mockResolvedValue({
      data: [
        { id: "ses-x", title: "Same title", directory: "/repo-a" },
        { id: "ses-y", title: "Same title", directory: "/repo-a" },
      ],
      error: null,
    });

    await bot.handleUpdate(ownerTextUpdate("📋 Сессии"));
    await bot.handleUpdate(buttonEventUpdate({ ...lastInlinePayload(), x: 1 }));

    expect(mocks.setCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ses-y" }),
    );
  });
});

describe("picker rendering constraints (FR-103)", () => {
  it("shows at most 5 options plus a nav row per page", async () => {
    mocks.sessionList.mockResolvedValue({
      data: Array.from({ length: 12 }, (_, i) => ({
        id: `s-${i}`,
        title: `session ${i}`,
        directory: "/repo-a",
      })),
      error: null,
    });

    await bot.handleUpdate(ownerTextUpdate("/sessions"));

    const rows = inlinePickerRows();
    expect(rows).toHaveLength(6);
    expect(rows.at(-1)).toEqual(["⬅️ Меню", "▶️"]);
    expect(lastText()).toBe(
      "Recent sessions — tap to resume:\nTotal: 12 · page 1 of 3",
    );
    expect(rows[0]).toEqual(["session 0"]);
  });

  it("pages forward and back through the picker without consuming the menu (F3.1)", async () => {
    mocks.sessionList.mockResolvedValue({
      data: Array.from({ length: 12 }, (_, i) => ({
        id: `s-${i}`,
        title: `session ${i}`,
        directory: "/repo-a",
      })),
      error: null,
    });

    await bot.handleUpdate(ownerTextUpdate("/sessions"));

    // Forward to page 2 (of 3).
    await bot.handleUpdate(buttonEventUpdate(lastInlineNavPayload("next")));

    expect(lastText()).toBe("Recent sessions — tap to resume:\nTotal: 12 · page 2 of 3");
    expect(inlinePickerRows()[0]).toEqual(["session 5"]);
    expect(inlinePickerRows().at(-1)).toEqual(["◀️", "⬅️ Меню", "▶️"]);

    // Forward again from the page-2 message.
    await bot.handleUpdate(buttonEventUpdate(lastInlineNavPayload("next")));

    expect(lastText()).toBe("Recent sessions — tap to resume:\nTotal: 12 · page 3 of 3");
    expect(inlinePickerRows()).toHaveLength(3); // 2 options + nav row
    expect(inlinePickerRows()[0]).toEqual(["session 10"]);
    expect(inlinePickerRows().at(-1)).toEqual(["◀️", "⬅️ Меню"]);

    // Back to page 2 via «◀️».
    await bot.handleUpdate(buttonEventUpdate(lastInlineNavPayload("prev")));

    expect(lastText()).toContain("page 2 of 3");
    expect(inlinePickerRows()[0]).toEqual(["session 5"]);
  });

  it("repeated taps on the SAME nav button keep working (menu not consumed, F3.2)", async () => {
    mocks.sessionList.mockResolvedValue({
      data: Array.from({ length: 12 }, (_, i) => ({
        id: `s-${i}`,
        title: `session ${i}`,
        directory: "/repo-a",
      })),
      error: null,
    });

    await bot.handleUpdate(ownerTextUpdate("/sessions"));
    const nextPayload = lastInlineNavPayload("next");

    await bot.handleUpdate(buttonEventUpdate(nextPayload));
    expect(lastText()).toBe("Recent sessions — tap to resume:\nTotal: 12 · page 2 of 3");

    // The SAME captured payload again: a consuming menu would answer
    // "outdated" — instead page 2 renders again as a fresh message.
    await bot.handleUpdate(buttonEventUpdate(nextPayload));
    expect(lastText()).toBe("Recent sessions — tap to resume:\nTotal: 12 · page 2 of 3");
    expect(inlinePickerRows()[0]).toEqual(["session 5"]);
  });

  it("a stale nav tap (unknown menu id) answers with the outdated hint", async () => {
    await bot.handleUpdate(buttonEventUpdate({ v: 1, k: "next", m: "m-gone", x: 0 }));

    expect(lastText()).toBe("This menu is outdated. Ask again for a fresh one.");
    expect(lastMainKeyboardAttached()).toBe(true);
  });

  it("picking an option on a later page resumes the right session (FR-104)", async () => {
    mocks.sessionList.mockResolvedValue({
      data: Array.from({ length: 12 }, (_, i) => ({
        id: `s-${i}`,
        title: `session ${i}`,
        directory: "/repo-a",
      })),
      error: null,
    });

    await bot.handleUpdate(ownerTextUpdate("/sessions"));
    const page1Menu = lastInlinePayload();
    await bot.handleUpdate(buttonEventUpdate({ ...page1Menu, k: "next" }));

    // Tap the second option on page 2 → session 6 (index 5 overall).
    await bot.handleUpdate(buttonEventUpdate({ ...lastInlinePayload(), x: 1 }));

    expect(lastText()).toBe("✅ Session resumed: session 6");
    expect(mocks.setCurrentSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s-6" }),
    );
  });

  it("clamps page taps when the list shrinks between renders", async () => {
    mocks.sessionList.mockResolvedValue({
      data: Array.from({ length: 12 }, (_, i) => ({
        id: `s-${i}`,
        title: `session ${i}`,
        directory: "/repo-a",
      })),
      error: null,
    });

    await bot.handleUpdate(ownerTextUpdate("/sessions"));
    const page1Menu = lastInlinePayload();
    await bot.handleUpdate(buttonEventUpdate({ ...page1Menu, k: "next" }));
    const page2Menu = lastInlinePayload();
    await bot.handleUpdate(buttonEventUpdate({ ...page2Menu, k: "next" }));
    expect(lastText()).toContain("page 3 of 3");

    // The list shrinks to a single session: the stale «◀️» to page 2 must
    // clamp to the last available page instead of rendering an empty one.
    mocks.sessionList.mockResolvedValue({
      data: [{ id: "s-only", title: "only one", directory: "/repo-a" }],
      error: null,
    });
    const page3Menu = lastInlinePayload();
    await bot.handleUpdate(buttonEventUpdate({ ...page3Menu, k: "prev" }));

    expect(lastText()).toBe("Recent sessions — tap to resume:\nTotal: 1");
    expect(inlinePickerRows()).toEqual([["only one"], ["⬅️ Меню"]]);
  });
});
