import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";

const ABORT_COMMANDS = new Set(["/abort", "/stop"]);

export interface AbortOutcome {
  handled: boolean;
}

/** Sessions successfully aborted: registered so their follow-up error is suppressed. */
const abortedSessionIds = new Set<string>();

export function markSessionAborted(sessionId: string): void {
  abortedSessionIds.add(sessionId);
}

/**
 * Minimal /abort / /stop handling for US2 (full command router arrives in
 * US4). Aborts the current session through the OpenCode API.
 */
export async function handleAbortIfRequested(
  text: string,
  sender: VkSender,
  peerId: number,
): Promise<AbortOutcome> {
  if (!ABORT_COMMANDS.has(text.trim())) {
    return { handled: false };
  }

  const session = getCurrentSession();
  if (!session) {
    await sender.sendText(peerId, t("vk.abort_no_session"));
    return { handled: true };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    timeout.unref?.();
    const { error } = await opencodeClient.session.abort(
      { sessionID: session.id, directory: session.directory },
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (error) {
      logger.warn("[VkBot] Abort request failed:", error);
      await sender.sendText(peerId, t("vk.abort_failed"));
      return { handled: true };
    }

    logger.info(`[VkBot] Aborted session ${session.id}`);
    markSessionAborted(session.id);
    await sender.sendText(peerId, t("vk.abort_done"), { mainKeyboard: true });
  } catch (error) {
    logger.error("[VkBot] Abort failed:", error);
    await sender.sendText(peerId, t("vk.abort_failed"));
  }
  return { handled: true };
}
