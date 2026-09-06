import type { VkApiClient } from "./client.js";
import { logger } from "../utils/logger.js";
import { t } from "../i18n/index.js";

const MIN_UPDATE_INTERVAL_MS = 3000; // FR-004: refresh at most once per 3 s

export interface VkStatusRunOptions {
  client: VkApiClient;
  peerId: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * One live-status representation per agent run (research D5): a silent
 * message deleted and re-sent with fresh content, throttled so the dialog
 * is not flooded. The final assistant reply is delivered separately; the
 * status message is simply removed when the run ends.
 */
export class VkStatusRun {
  private readonly client: VkApiClient;
  private readonly peerId: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private messageId: number | null = null;
  private lastRenderedAt = 0;
  private lastText = "";
  private pendingText: string | null = null;
  private refreshTimer: Promise<void> | null = null;
  private finished = false;

  constructor(options: VkStatusRunOptions) {
    this.client = options.client;
    this.peerId = options.peerId;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  }

  async start(): Promise<void> {
    await this.render(t("vk.status_running", { count: 0 }), true);
  }

  async setActivity(text: string): Promise<void> {
    if (this.finished) {
      return;
    }
    const elapsed = this.now() - this.lastRenderedAt;
    if (elapsed >= MIN_UPDATE_INTERVAL_MS && this.refreshTimer === null) {
      await this.render(text, false);
      return;
    }
    this.pendingText = text;
    if (this.refreshTimer === null) {
      const waitMs = Math.max(0, MIN_UPDATE_INTERVAL_MS - elapsed);
      this.refreshTimer = this.sleep(waitMs).then(async () => {
        this.refreshTimer = null;
        const pending = this.pendingText;
        this.pendingText = null;
        if (pending !== null && !this.finished) {
          await this.render(pending, false);
        }
      });
    }
    // Await the deferred refresh so callers observe the applied update.
    return this.refreshTimer;
  }

  /** Removes the status message when the run ends (reply arrives separately). */
  async finish(): Promise<void> {
    this.finished = true;
    this.pendingText = null;
    const messageId = this.messageId;
    this.messageId = null;
    if (messageId !== null) {
      await this.deleteMessage(messageId);
    }
  }

  private async render(text: string, immediate: boolean): Promise<void> {
    if (immediate || text !== this.lastText) {
      this.lastText = text;
    }
    const oldMessageId = this.messageId;
    let messageId: number | null = null;
    try {
      const response = await this.client.call<{ message_id?: number }>("messages.send", {
        peer_id: this.peerId,
        message: text,
        random_id: Math.floor(Math.random() * 2_147_483_647),
        disable_notification: true,
        dont_parse_links: true,
      });
      messageId = typeof response.message_id === "number" ? response.message_id : null;
    } catch (error) {
      logger.warn("[VkStatus] Failed to send status message", error);
    }
    this.lastRenderedAt = this.now();
    if (messageId === null) {
      return;
    }
    this.messageId = messageId;
    if (oldMessageId !== null) {
      await this.deleteMessage(oldMessageId);
    }
  }

  private async deleteMessage(messageId: number): Promise<void> {
    try {
      await this.client.call("messages.delete", {
        message_ids: messageId,
        delete_for_all: true,
      });
    } catch (error) {
      logger.debug("[VkStatus] Status message delete failed", error);
    }
  }
}
