import { VkApiClient } from "./client.js";
import { VkEventNormalizer, type NormalizedEvent } from "./events.js";
import { VkLongPoll } from "./longpoll.js";
import { VkSender } from "./send.js";
import { VkRunCollector, type RunResult, type ToolActivity } from "./run-collector.js";
import { VkStatusRun } from "./status.js";
import { handleOwnerTextMessage, type VkMessageHandlerDeps } from "./handlers/message-new.js";
import { renderMarkdownToPlainText } from "./render/pipeline.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { t } from "../i18n/index.js";
import { sendMessageEventAnswer } from "./callbacks.js";

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

  private async handleUpdate(update: unknown): Promise<void> {
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
        onRunStarted: (sessionId) => this.startStatusRun(sessionId, event.message.peer_id),
      };
      await handleOwnerTextMessage(event.message, deps);
      return;
    }

    await this.handleButtonEvent(event);
  }

  /**
   * Button taps arrive with US3; until then the spinner is cleared so the
   * client does not hang, and the tap is otherwise ignored.
   */
  private async handleButtonEvent(event: NormalizedEvent & { kind: "button" }): Promise<void> {
    logger.debug("[VkBot] Button tap ignored (menus arrive with US3)", { eventId: event.eventId });
    await sendMessageEventAnswer(this.client, {
      eventId: event.eventId,
      userId: event.userId,
      peerId: event.peerId,
    });
  }

  private startStatusRun(sessionId: string, peerId: number): void {
    void sessionId;
    this.statusRun = new VkStatusRun({ client: this.client, peerId });
    void this.statusRun.start();
  }

  private async reportActivity(activity: ToolActivity): Promise<void> {
    if (!this.statusRun) {
      this.statusRun = new VkStatusRun({
        client: this.client,
        peerId: this.lastOwnerPeerId ?? config.vk.allowedUserId,
      });
      await this.statusRun.start();
    }
    await this.statusRun.setActivity(t("vk.status_running", { count: activity.toolCount }));
  }

  private async deliverRunResult(result: RunResult): Promise<void> {
    await this.statusRun?.finish();
    this.statusRun = null;
    const peerId = this.lastOwnerPeerId;
    if (peerId === null) {
      logger.warn("[VkBot] Run finished but no owner dialog is known yet");
      return;
    }

    const text = renderMarkdownToPlainText(result.text);
    if (text.length === 0) {
      logger.info("[VkBot] Run finished with empty assistant text; nothing to deliver");
      return;
    }

    await this.sender.sendText(peerId, text);
  }

  private async deliverRunError(sessionId: string, message: string): Promise<void> {
    await this.statusRun?.finish();
    this.statusRun = null;
    const peerId = this.lastOwnerPeerId;
    logger.error("[VkBot] Delivering run error to dialog", { sessionId, message });
    if (peerId === null) {
      return;
    }
    await this.sender.sendText(peerId, t("error.generic"));
  }
}

export { VkApiClient } from "./client.js";
export { VkSender } from "./send.js";
