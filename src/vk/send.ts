import { randomInt } from "node:crypto";
import { logger } from "../utils/logger.js";
import { VkApiClient, type VkRequestParamValue } from "./client.js";

/**
 * VK rejects messages longer than 4096 characters; we stay under it to
 * keep room for platform-side rendering quirks (spec FR-003, SC-007).
 */
export const VK_MESSAGE_HARD_LIMIT = 4096;
export const VK_MESSAGE_SAFE_LIMIT = 4000;

const CODE_FENCE = "```";
/** VK flood control (identical messages in a row): retry once with a tweak. */
const FLOOD_ERROR_CODE = 9;

/**
 * Splits text into chunks within `limit`, preferring paragraph and then
 * line boundaries. An open code fence is closed at the end of a chunk and
 * re-opened at the start of the next one; a single line larger than the
 * limit is hard-split with fences kept on both parts.
 */
export function chunkMessageText(text: string, limit: number = VK_MESSAGE_SAFE_LIMIT): string[] {
  if (text.length === 0) {
    return [];
  }
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let current = "";
  let insideFence = false;

  const pushChunk = (body: string): void => {
    if (body.length > 0) {
      chunks.push(body);
    }
  };

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    pushChunk(insideFence ? `${current}\n${CODE_FENCE}` : current);
    current = insideFence ? `${CODE_FENCE}\n` : "";
  };

  for (const line of text.split("\n")) {
    const candidateLength = current.length === 0 ? line.length : current.length + 1 + line.length;

    if (line.length + 1 > limit) {
      // A single line that cannot fit a fresh chunk: hard-split it.
      flush();
      const overhead = insideFence ? CODE_FENCE.length * 2 + 2 : 0;
      const capacity = limit - overhead;
      let rest = line;
      while (rest.length > capacity) {
        const piece = rest.slice(0, capacity);
        rest = rest.slice(capacity);
        pushChunk(insideFence ? `${CODE_FENCE}\n${piece}\n${CODE_FENCE}` : piece);
      }
      current = insideFence ? `${CODE_FENCE}\n${rest}` : rest;
      continue;
    }

    if (candidateLength > limit) {
      flush();
    }

    current = current.length === 0 ? line : `${current}\n${line}`;

    if (line.trim().startsWith(CODE_FENCE)) {
      insideFence = !insideFence;
    }
  }

  flush();
  return chunks.length > 0 ? chunks : [text];
}

export interface SendTextOptions {
  silent?: boolean;
  keyboard?: unknown;
  attachment?: string;
}

export interface VkSenderOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Outbound message wrapper over `messages.send`: chunking, unique
 * random_id per message, silent flag, keyboard serialization, and a
 * single flood-control retry with a text variation (research D2).
 */
export class VkSender {
  private readonly client: VkApiClient;

  constructor(client: VkApiClient) {
    this.client = client;
  }

  async sendText(
    peerId: number,
    text: string,
    options: SendTextOptions = {},
  ): Promise<number[]> {
    const chunks = chunkMessageText(text);
    const messageIds: number[] = [];

    for (const chunk of chunks) {
      const params: Record<string, VkRequestParamValue> = {
        peer_id: peerId,
        message: chunk,
        random_id: randomInt(1, 2_147_483_647),
        dont_parse_links: true,
      };
      if (options.silent) {
        params.disable_notification = true;
      }
      if (options.keyboard) {
        params.keyboard = JSON.stringify(options.keyboard);
      }
      if (options.attachment) {
        params.attachment = options.attachment;
      }

      const messageId = await this.sendChunk(params);
      if (messageId !== null) {
        messageIds.push(messageId);
      }
    }

    return messageIds;
  }

  private async sendChunk(
    params: Record<string, VkRequestParamValue>,
  ): Promise<number | null> {
    try {
      const response = await this.client.call<{ message_id?: number }>("messages.send", params);
      return typeof response.message_id === "number" ? response.message_id : null;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "VkApiError" &&
        "code" in error &&
        (error as { code: number }).code === FLOOD_ERROR_CODE
      ) {
        logger.debug("[VkSender] Flood control, retrying with text variation");
        const varied = {
          ...params,
          message: `${String(params.message ?? "")}\n\u200b`,
        };
        const retry = await this.client.call<{ message_id?: number }>("messages.send", varied);
        return typeof retry.message_id === "number" ? retry.message_id : null;
      }
      throw error;
    }
  }
}
