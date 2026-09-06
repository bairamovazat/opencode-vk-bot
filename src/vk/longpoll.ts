import { logger } from "../utils/logger.js";
import type { VkApiClient } from "./client.js";
import type { VkLongPollServer } from "./types.js";

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

export interface LongPollTsStore {
  load(): Promise<string | null>;
  save(ts: string): Promise<void>;
}

export interface VkLongPollOptions {
  client: VkApiClient;
  groupId: number;
  waitSec?: number;
  fetchImpl?: typeof fetch;
  tsStore?: LongPollTsStore;
  onUpdate: (update: unknown) => Promise<void> | void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  requestTimeoutMs?: number;
}

interface LongPollPollResponse {
  ts?: string;
  updates?: unknown[];
  failed?: number;
}

/**
 * Bots Long Poll receive loop (research D1): issues the session once,
 * polls with `act=a_check`, survives `failed` 1/2/3 and network errors
 * with capped exponential backoff, and advances the `ts` checkpoint only
 * after every update of the batch has been handled (at-least-once
 * delivery; duplicates are removed downstream by event_id).
 */
export class VkLongPoll {
  private readonly client: VkApiClient;
  private readonly groupId: number;
  private readonly waitSec: number;
  private readonly fetchImpl: typeof fetch;
  private readonly tsStore: LongPollTsStore | null;
  private readonly onUpdate: (update: unknown) => Promise<void> | void;
  private readonly signal: AbortSignal | null;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly requestTimeoutMs: number;

  private session: VkLongPollServer | null = null;
  private ts: string | null = null;
  private consecutiveErrors = 0;
  private running = false;

  constructor(options: VkLongPollOptions) {
    this.client = options.client;
    this.groupId = options.groupId;
    this.waitSec = options.waitSec ?? 25;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.tsStore = options.tsStore ?? null;
    this.onUpdate = options.onUpdate;
    this.signal = options.signal ?? null;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    this.requestTimeoutMs = options.requestTimeoutMs ?? (this.waitSec + 5) * 1000;
  }

  async run(): Promise<void> {
    if (this.running) {
      throw new Error("VkLongPoll is already running");
    }
    this.running = true;
    try {
      this.ts = (await this.tsStore?.load()) ?? null;
      while (!this.isAborted()) {
        await this.pollOnce();
      }
      logger.info("[VkLongPoll] Stopped");
    } finally {
      this.running = false;
    }
  }

  private isAborted(): boolean {
    return this.signal?.aborted === true;
  }

  private async pollOnce(): Promise<void> {
    try {
      if (!this.session || this.ts === null) {
        await this.issueSession();
        if (!this.session || this.ts === null) {
          return;
        }
      }

      const data = await this.pollRequest();

      if (typeof data.failed === "number") {
        await this.handleFailed(data);
        return;
      }

      const updates = Array.isArray(data.updates) ? data.updates : [];
      // ts advances only after every handler succeeded: a thrown handler
      // (or an abort mid-batch) leaves the position untouched so the batch
      // is redelivered on the next poll (at-least-once; duplicates are
      // dropped downstream by event_id).
      for (const update of updates) {
        if (this.isAborted()) {
          return;
        }
        await this.onUpdate(update);
      }

      if (typeof data.ts === "string") {
        this.ts = data.ts;
        await this.tsStore?.save(data.ts);
      }

      this.consecutiveErrors = 0;
    } catch (error) {
      if (this.isAborted()) {
        return;
      }
      this.consecutiveErrors += 1;
      const delayMs = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (this.consecutiveErrors - 1));
      logger.warn("[VkLongPoll] Poll failed, backing off", { delayMs, error });
      await this.sleep(delayMs);
    }
  }

  private async issueSession(): Promise<void> {
    this.session = await this.client.call<VkLongPollServer>("groups.getLongPollServer", {
      group_id: this.groupId,
    });
    this.ts = this.ts ?? this.session.ts;
  }

  private async pollRequest(): Promise<LongPollPollResponse> {
    if (!this.session || this.ts === null) {
      throw new Error("Long poll session is not initialized");
    }
    const url = new URL(this.session.server);
    url.searchParams.set("act", "a_check");
    url.searchParams.set("key", this.session.key);
    url.searchParams.set("ts", this.ts);
    url.searchParams.set("wait", String(this.waitSec));
    url.searchParams.set("mode", "2");
    url.searchParams.set("version", "3");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(url.toString(), { signal: controller.signal });
      return (await response.json()) as LongPollPollResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleFailed(data: LongPollPollResponse): Promise<void> {
    const failed = data.failed as number;
    if (failed === 1) {
      // Events history expired inside the session: response carries the new ts.
      if (typeof data.ts === "string") {
        this.ts = data.ts;
      }
      return;
    }
    // failed=2|3: key (or whole session) expired — re-issue and resume.
    logger.info(`[VkLongPoll] failed=${failed}, re-issuing long poll server`);
    this.session = null;
    await this.issueSession();
  }
}
