import { VkApiClient } from "./client.js";
import { VkEventNormalizer, type NormalizedEvent } from "./events.js";
import { VkLongPoll } from "./longpoll.js";
import { VkSender } from "./send.js";
import {
  VkRunCollector,
  type RunResult,
  type ToolActivity,
  type PermissionAsked,
  type QuestionAsked,
} from "./run-collector.js";
import { buildPermissionMenu, buildQuestionMenu } from "./menus.js";
import { buildRunKeyboard, setView, type KeyboardAction } from "./keyboards.js";
import { VkStatusRun } from "./status.js";
import { handleOwnerTextMessage, type VkMessageHandlerDeps } from "./handlers/message-new.js";
import { handleSessionsCommand } from "./commands/sessions.js";
import { handleProjectsCommand } from "./commands/projects.js";
import { handleModelsCommand } from "./commands/models.js";
import { renderMarkdownToPlainText } from "./render/pipeline.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { t } from "../i18n/index.js";
import { handleMenuButton } from "./menus.js";

/**
 * VK transport composition root: long poll → normalization → handlers →
 * OpenCode → final text delivery. Owns the run collector whose completion
 * renders markdown to plain text and sends it back to the dialog.
 */
export class VkBot {
  private readonly client: VkApiClient;
  private readonly sender: VkSender;
  private readonly normalizer: VkEventNormalizer;
  private readonly runCollector: VkRunCollector;
  private readonly abortController = new AbortController();
  private longPoll: VkLongPoll | null = null;
  private lastOwnerPeerId: number | null = null;
  private statusRun: VkStatusRun | null = null;
  private currentDirectory: string | null = null;
  /** Sessions aborted by the owner: their session.error is expected noise. */
  private abortedSessionIds = new Set<string>();

  constructor() {
    this.client = new VkApiClient();
    this.sender = new VkSender(this.client);
    this.normalizer = new VkEventNormalizer({
      groupId: config.vk.groupId,
      allowedUserId: config.vk.allowedUserId,
      selfTest: config.vk.selfTest,
    });
    this.runCollector = new VkRunCollector({
      onComplete: (result) => this.deliverRunResult(result),
      onError: (sessionId, message) => this.deliverRunError(sessionId, message),
      onActivity: (activity) => this.reportActivity(activity),
      onPermission: (asked) => this.showPermissionMenu(asked),
      onQuestion: (asked) => this.showQuestionMenu(asked),
    });
  }

  async start(): Promise<void> {
    this.longPoll = new VkLongPoll({
      client: this.client,
      groupId: config.vk.groupId,
      waitSec: config.vk.longPollWaitSec,
      signal: this.abortController.signal,
      onUpdate: (update) => this.handleUpdate(update),
    });

    logger.info("[VkBot] Starting long poll loop");
    await this.longPoll.run();
  }

  stop(): void {
    this.abortController.abort();
    this.runCollector.abort();
    void this.statusRun?.finish();
    this.statusRun = null;
  }

  /**
   * Entry point for one raw Long Poll update. Public so the E2E flow tests
   * can drive the full pipeline (tests/vk/flows.e2e.test.ts).
   */
  async handleUpdate(update: unknown): Promise<void> {
    logger.debug(
      `[VkBot] update: ${JSON.stringify(update).slice(0, 300)}`,
    );
    const event = this.normalizer.normalize(update);
    if (!event) {
      return;
    }

    if (event.kind === "message") {
      this.lastOwnerPeerId = event.message.peer_id;
      const deps: VkMessageHandlerDeps = {
        sender: this.sender,
        runCollector: this.runCollector,
        peerId: event.message.peer_id,
        onRunStarted: (sessionId, directory) => {
          this.currentDirectory = directory;
          this.startStatusRun(sessionId, event.message.peer_id);
        },
        onAborted: (sessionId) => {
          // Owner-initiated abort: the follow-up session.error is expected
          // noise and must be suppressed (F6.1).
          this.abortedSessionIds.add(sessionId);
        },
      };
      await handleOwnerTextMessage(event.message, deps);
      return;
    }

    await this.handleButtonEvent(event);
  }

  /**
   * Routes an inline button tap (pickers, permission/question menus)
   * through menus.ts; spinner is always cleared (FR-108).
   */
  private async handleButtonEvent(event: NormalizedEvent & { kind: "button" }): Promise<void> {
    await handleMenuButton(
      {
        client: this.client,
        sender: this.sender,
        performKeyboardAction: (action) => this.performKeyboardAction(action, event.peerId),
      },
      event,
    );
  }

  /**
   * Executes a resolved inline-tap action (F2–F5, F9). The peer comes from
   * the button event itself, so taps work even right after a restart when
   * no owner message has been seen yet (FR-111).
   */
  private async performKeyboardAction(action: KeyboardAction, peerId: number): Promise<void> {
    if (action.kind === "back") {
      setView(peerId, "main");
      await this.sender.sendText(peerId, t("vk.menu_main_hint"), { mainKeyboard: true });
      return;
    }
    if (action.kind === "page") {
      // Pagination re-renders the picker as a fresh message with fresh
      // data; sendPickerView clamps the page to the available range.
      if (action.view === "sessions") {
        await handleSessionsCommand(this.sender, peerId, action.page);
      } else if (action.view === "projects") {
        await handleProjectsCommand(this.sender, peerId, action.page);
      } else if (action.view === "models") {
        await handleModelsCommand(this.sender, peerId, action.page);
      }
      return;
    }
    if (action.kind === "resume-session") {
      setView(peerId, "main");
      const { setCurrentSession } = await import("../app/services/session-service.js");
      setCurrentSession({ id: action.id, title: action.title, directory: action.directory });
      await this.sender.sendText(peerId, t("vk.session_resumed", { title: action.title }), {
        mainKeyboard: true,
      });
      return;
    }
    if (action.kind === "switch-project") {
      setView(peerId, "main");
      const { setCurrentProject } = await import("../app/stores/settings-store.js");
      const { getProjects } = await import("../app/services/project-service.js");
      const projects = await getProjects();
      const full = projects.find((project) => project.id === action.id);
      if (!full) {
        // Project vanished between render and tap: stale tap (FR-108).
        await this.sender.sendText(peerId, t("vk.menu_outdated"), { mainKeyboard: true });
        return;
      }
      setCurrentProject(full);
      const { clearSession } = await import("../app/services/session-service.js");
      clearSession();
      await this.sender.sendText(peerId, t("vk.project_switched", { project: action.name }), {
        mainKeyboard: true,
      });
      return;
    }
    if (action.kind === "switch-model") {
      setView(peerId, "main");
      const { selectModel } = await import("../app/services/model-selection-service.js");
      selectModel({ providerID: action.providerID, modelID: action.modelID });
      await this.sender.sendText(peerId, t("vk.model_switched", { model: action.label }), {
        mainKeyboard: true,
      });
    }
  }

  private startStatusRun(sessionId: string, peerId: number): void {
    void sessionId;
    setView(peerId, "run");
    // Silent (FR-114): during a run only the final reply may notify.
    void this.sender.sendText(peerId, t("vk.run_started"), {
      keyboard: buildRunKeyboard(),
      silent: true,
    });
  }

  setCurrentDirectory(directory: string): void {
    this.currentDirectory = directory;
  }

  private showPermissionMenu(asked: PermissionAsked): void {
    const peerId = this.lastOwnerPeerId;
    if (peerId === null) {
      return;
    }
    buildPermissionMenu(
      { client: this.client, sender: this.sender },
      peerId,
      {
        requestId: asked.requestId,
        directory: this.currentDirectory ?? "",
        tool: asked.permission,
        patterns: asked.patterns,
      },
    );
  }

  private showQuestionMenu(asked: QuestionAsked): void {
    const peerId = this.lastOwnerPeerId;
    if (peerId === null || asked.questions.length === 0) {
      return;
    }
    buildQuestionMenu(
      { client: this.client, sender: this.sender },
      peerId,
      {
        requestId: asked.requestId,
        directory: this.currentDirectory ?? "",
        questions: asked.questions,
      },
    );
  }

  private async reportActivity(activity: ToolActivity): Promise<void> {
    // Live progress line (FR-115): the current tool (+ optional detail like
    // the edited file) and the action count, so the owner can see the run
    // is alive and what it is doing right now.
    const detail = [activity.lastTool, activity.detail].filter((part): part is string =>
      typeof part === "string" && part.length > 0,
    );
    const text =
      detail.length > 0
        ? t("vk.status_running_tool", { tool: detail.join(" · "), count: activity.toolCount })
        : t("vk.status_running", { count: activity.toolCount });
    if (!this.statusRun) {
      this.statusRun = new VkStatusRun({
        client: this.client,
        peerId: this.lastOwnerPeerId ?? config.vk.allowedUserId,
      });
      // Render the first activity immediately (no throttle wait).
      await this.statusRun.start(text);
      return;
    }
    await this.statusRun.setActivity(text);
  }

  private async deliverRunResult(result: RunResult): Promise<void> {
    await this.statusRun?.finish();
    this.statusRun = null;
    const peerId = this.lastOwnerPeerId;
    if (peerId === null) {
      logger.warn("[VkBot] Run finished but no owner dialog is known yet");
      return;
    }
    setView(peerId, "main");

    const text = renderMarkdownToPlainText(result.text);
    if (text.length === 0) {
      // No assistant text: still return the main keyboard so the reply
      // keyboard does not stay in the run view (F0.4).
      logger.info("[VkBot] Run finished with empty assistant text");
      await this.sender.sendText(peerId, t("vk.run_finished_empty"), { mainKeyboard: true });
      return;
    }

    await this.sender.sendText(peerId, text, { mainKeyboard: true });
  }

  private async deliverRunError(sessionId: string, message: string): Promise<void> {
    await this.statusRun?.finish();
    this.statusRun = null;
    if (this.abortedSessionIds.delete(sessionId)) {
      logger.info(`[VkBot] Session ${sessionId} finished after owner abort; error suppressed`);
      return;
    }
    const peerId = this.lastOwnerPeerId;
    setView(peerId ?? config.vk.allowedUserId, "main");
    logger.error("[VkBot] Delivering run error to dialog", { sessionId, message });
    if (peerId === null) {
      return;
    }
    await this.sender.sendText(peerId, t("error.generic"), { mainKeyboard: true });
  }
}

export { VkApiClient } from "./client.js";
export { VkSender } from "./send.js";
