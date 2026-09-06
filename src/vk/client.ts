import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const VK_API_BASE_URL = "https://api.vk.com/method/";
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 50; // ~20 requests/s, VK per-group budget
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 300;
const RETRY_MAX_DELAY_MS = 5000;

/** VK API error codes that are worth a retry with backoff. */
const RETRYABLE_ERROR_CODES = new Set([
  1, // Unknown/internal error (transient on VK side)
  6, // Too many requests per second
  10, // Internal server error
]);

export type VkRequestParamValue = string | number | boolean | undefined | null;

export interface VkApiClientOptions {
  groupToken?: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  /** Minimum delay between request starts; 0 disables throttling (tests). */
  minRequestIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class VkApiError extends Error {
  readonly code: number;
  readonly requestParams?: unknown;

  constructor(code: number, message: string, requestParams?: unknown) {
    super(`VK API error ${code}: ${message}`);
    this.name = "VkApiError";
    this.code = code;
    this.requestParams = requestParams;
  }
}

interface VkApiEnvelope<T> {
  response?: T;
  error?: {
    error_code: number;
    error_msg: string;
    request_params?: unknown;
  };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Thin VK HTTPS API client: token + version injection, typed errors,
 * bounded retry on transient codes, and a conservative rate limiter.
 * See specs/001-vk-bot-port/research.md D2 and D11.
 */
export class VkApiClient {
  private readonly groupToken: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly minRequestIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastRequestStartedAt = 0;
  private queueTail: Promise<void> = Promise.resolve();

  constructor(options: VkApiClientOptions = {}) {
    this.groupToken = options.groupToken ?? config.vk.groupToken;
    this.apiVersion = options.apiVersion ?? config.vk.apiVersion;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.minRequestIntervalMs = options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Calls a VK API method. Params are sent as a form body; undefined/null
   * values are skipped. The rate limiter serializes request starts so the
   * per-group budget is respected even under concurrent callers.
   */
  async call<T>(method: string, params: Record<string, VkRequestParamValue> = {}): Promise<T> {
    const body = this.buildBody(params);

    const run = async (): Promise<T> => {
      await this.waitForRateLimit();
      return this.callOnce<T>(method, body);
    };

    const result = this.queueTail.then(run);
    // The queue only serializes request starts; failures must not poison it.
    this.queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private buildBody(params: Record<string, VkRequestParamValue>): URLSearchParams {
    const body = new URLSearchParams();
    body.set("access_token", this.groupToken);
    body.set("v", this.apiVersion);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }
      body.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
    }
    return body;
  }

  private async waitForRateLimit(): Promise<void> {
    if (this.minRequestIntervalMs <= 0) {
      return;
    }
    const elapsed = this.now() - this.lastRequestStartedAt;
    const waitMs = this.minRequestIntervalMs - elapsed;
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
    this.lastRequestStartedAt = this.now();
  }

  private async callOnce<T>(method: string, body: URLSearchParams): Promise<T> {
    let lastError: VkApiError | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let envelope: VkApiEnvelope<T>;
      try {
        const httpResponse = await this.fetchImpl(`${VK_API_BASE_URL}${method}`, {
          method: "POST",
          body,
        });
        envelope = (await httpResponse.json()) as VkApiEnvelope<T>;
      } catch (error) {
        // Network-level failures are transient by nature: retry like code 6.
        logger.debug("[VkClient] Network error, will retry", { method, error });
        lastError = new VkApiError(6, `network error: ${String(error)}`);
        await this.backoff(attempt);
        continue;
      }

      if (envelope.response !== undefined) {
        return envelope.response;
      }

      const apiError = envelope.error;
      if (!apiError) {
        lastError = new VkApiError(-1, "malformed VK API response without response or error");
        break;
      }

      lastError = new VkApiError(apiError.error_code, apiError.error_msg, apiError.request_params);
      if (!RETRYABLE_ERROR_CODES.has(apiError.error_code)) {
        break;
      }
      logger.debug("[VkClient] Retryable VK API error", {
        method,
        code: apiError.error_code,
        attempt,
      });
      await this.backoff(attempt);
    }

    throw lastError ?? new VkApiError(-1, "VK API call failed without an error");
  }

  private async backoff(attempt: number): Promise<void> {
    if (attempt >= MAX_RETRIES) {
      return;
    }
    const delayMs = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** attempt);
    await this.sleep(delayMs);
  }
}
