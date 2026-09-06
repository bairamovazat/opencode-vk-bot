import type { VkApiClient } from "./client.js";

export interface ButtonEventAnswerParams {
  eventId: string;
  userId: number;
  peerId: number;
}

/**
 * Clears the "…" spinner on an inline button after a tap. Required for
 * every processed `message_event` (contracts/callback-payloads.md, rule 5).
 */
export async function sendMessageEventAnswer(
  client: VkApiClient,
  params: ButtonEventAnswerParams,
): Promise<void> {
  try {
    await client.call("messages.sendMessageEventAnswer", {
      event_id: params.eventId,
      user_id: params.userId,
      peer_id: params.peerId,
    });
  } catch (error) {
    // Best-effort: a failed spinner clear must never break the handler.
    await import("../utils/logger.js").then(({ logger }) => {
      logger.debug("[VkCallbacks] sendMessageEventAnswer failed", error);
    });
  }
}
