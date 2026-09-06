/**
 * Scriptable interceptor for the VK HTTPS API, shared by src/vk tests.
 * Records every request and replays queued responses/errors per method.
 */
import { VkApiError, type VkApiClientOptions } from "../../../src/vk/client.js";

export interface RecordedVkRequest {
  method: string;
  params: URLSearchParams;
}

interface QueuedVkResponse {
  status: number;
  body: unknown;
}

export interface MockVkApi {
  requests: RecordedVkRequest[];
  /** Queues the next call result for `method` (wrapped into the VK `response` envelope). */
  enqueue(method: string, response: unknown): void;
  /** Queues a VK API error envelope for `method`. */
  enqueueError(method: string, code: number, message: string): void;
  /** Queues a network-level failure (fetch rejects) for `method`. */
  enqueueNetworkError(method: string, message?: string): void;
  /** Queues a malformed envelope (no response/error keys) for `method`. */
  enqueueMalformed(method: string): void;
  fetchImpl: typeof fetch;
  clientOptions: VkApiClientOptions;
}

export function createMockVkApi(): MockVkApi {
  const requests: RecordedVkRequest[] = [];
  const queue = new Map<string, QueuedVkResponse[]>();

  const takeNext = (method: string): QueuedVkResponse | undefined => {
    const list = queue.get(method);
    if (!list || list.length === 0) {
      return undefined;
    }
    return list.shift();
  };

  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const url = String(input);
    const method = url.replace("https://api.vk.com/method/", "");
    const rawBody = init?.body;
    const bodyString =
      typeof rawBody === "string" || rawBody instanceof URLSearchParams ? String(rawBody) : "";
    const recorded: RecordedVkRequest = { method, params: new URLSearchParams(bodyString) };
    requests.push(recorded);

    const next = takeNext(method);
    if (!next) {
      throw new Error(`mock-vk-api: no scripted response for ${method}`);
    }
    if (next.status === 0) {
      throw new TypeError(next.body as string);
    }
    return Response.json(next.body, { status: next.status });
  }) as typeof fetch;

  const push = (method: string, body: unknown): void => {
    const list = queue.get(method) ?? [];
    list.push({ status: 200, body });
    queue.set(method, list);
  };

  const enqueue = (method: string, response: unknown): void => {
    push(method, { response });
  };

  const api: MockVkApi = {
    requests,
    enqueue,
    enqueueError: (method, code, message) => {
      push(method, { error: { error_code: code, error_msg: message } });
    },
    enqueueNetworkError: (method, message = "simulated network failure") => {
      const list = queue.get(method) ?? [];
      list.push({ status: 0, body: message });
      queue.set(method, list);
    },
    enqueueMalformed: (method) => {
      push(method, { unexpected: true });
    },
    fetchImpl,
    clientOptions: {
      groupToken: "test-token",
      apiVersion: "5.199",
      fetchImpl,
      minRequestIntervalMs: 0,
      sleep: () => Promise.resolve(),
    },
  };

  return api;
}

export function isVkApiErrorWithCode(error: unknown, code: number): error is VkApiError {
  return error instanceof VkApiError && error.code === code;
}
