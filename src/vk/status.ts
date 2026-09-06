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
  private pendingText: string | null = null;
  private refreshTimer: Promise<void> | null = null;
  private finished = false;
  /** Serializes renders: concurrent send+delete pairs race otherwise. */
  private chain: Promise<void> = Promise.resolve();

  constructor(options: VkStatusRunOptions) {
    this.client = options.client;
    this.peerId = options.peerId;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  }

  async start(): Promise<void> {
    await this.enqueueRender(t("vk.status_running", { count: 0 }));
  }

  private enqueueRender(text: string): Promise<void> {
    const run = this.chain.then(() => this.render(text));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async setActivity(text: string): Promise<void> {
    if (this.finished) {
      return;
    }
    const elapsed = this.now() - this.lastRenderedAt;
    if (elapsed >= MIN_UPDATE_INTERVAL_MS && this.refreshTimer === null) {
      await this.enqueueRender(text);
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
          await this.enqueueRender(pending);
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
    // Wait for any in-flight render so the freshest message id is removed.
    await this.chain.catch(() => {});
    const messageId = this.messageId;
    this.messageId = null;
    if (messageId !== null) {
      await this.deleteMessage(messageId);
    }
  }

  private async render(text: string): Promise<void> {
    if (this.finished) {
      return;
    }
    const oldMessageId = this.messageId;
    let messageId: number | null = null;
    try {
      // VK returns either a bare number or {message_id} depending on context.
      const response = await this.client.call<number | { message_id?: number }>(
        "messages.send",
        {
          peer_id: this.peerId,
          message: text,
          random_id: Math.floor(Math.random() * 2_147_483_647),
          disable_notification: true,
          dont_parse_links: true,
        },
      );
      if (typeof response === "number") {
        messageId = response;
      } else if (typeof response.message_id === "number") {
        messageId = response.message_id;
      }
    } catch (error) {
      logger.warn("[VkStatus] Failed to send status message", error);
    }
    this.lastRenderedAt = this.now();
    if (messageId === null) {
      return;
    }
    // The run may finish while the send is in flight: never resurrect the
    // status after finish() cleaned up.
    if (this.finished) {
      await this.deleteMessage(messageId);
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
