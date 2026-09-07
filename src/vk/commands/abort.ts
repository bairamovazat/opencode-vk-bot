import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";

const ABORT_COMMANDS = new Set(["/abort", "/stop"]);

export interface AbortOutcome {
  handled: boolean;
  /** True only when the OpenCode API actually aborted a running session. */
  aborted: boolean;
}

/**
 * Server-side run state of a session. "unknown" means the status check
 * itself failed — callers stay on the safe side (a stop request still
 * attempts the abort; a prompt still goes through).
 */
export type SessionBusyState = "busy" | "idle" | "unknown";

/**
 * Server-side run state of a session. "unknown" means the status check
 * itself failed — callers stay on the safe side (a stop request still
 * attempts the abort; a prompt still goes through).
 */export async function isSessionBusy(
  sessionId: string,
  directory: string,
): Promise<SessionBusyState> {
  try {
    const { data, error } = await opencodeClient.session.status({ directory });
    if (error || !data) {
      logger.warn("[VkBot] Failed to check session status:", error);
      return "unknown";
    }
    const status = (data as Record<string, { type?: string }>)[sessionId];
    // "retry" means the server is still working on the task.
    return status?.type === "busy" || status?.type === "retry" ? "busy" : "idle";
  } catch (error) {
    logger.warn("[VkBot] Error checking session status:", error);
    return "unknown";
  }
}

/**
 * F6 stop control: aborts the current session through the OpenCode API —
 * but only when it is actually running. An idle (merely bound) session is
 * answered with «Нет запущенной задачи», so pressing «⏹ Стоп» repeatedly
 * never claims to stop something that is not running (idempotent stop).
 * When the state cannot be checked, the abort is attempted anyway.
 */
export async function handleAbortIfRequested(
  text: string,
  sender: VkSender,
  peerId: number,
): Promise<AbortOutcome> {
  if (!ABORT_COMMANDS.has(text.trim())) {
    return { handled: false, aborted: false };
  }

  const session = getCurrentSession();
  if (!session) {
    await sender.sendText(peerId, t("vk.abort_no_session"), { mainKeyboard: true });
    return { handled: true, aborted: false };
  }

  const state = await isSessionBusy(session.id, session.directory);
  if (state === "idle") {
    logger.info(`[VkBot] Stop requested for idle session ${session.id}; nothing to abort`);
    await sender.sendText(peerId, t("vk.abort_no_session"), { mainKeyboard: true });
    return { handled: true, aborted: false };
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
      await sender.sendText(peerId, t("vk.abort_failed"), { mainKeyboard: true });
      return { handled: true, aborted: false };
    }

    logger.info(`[VkBot] Aborted session ${session.id}`);
    await sender.sendText(peerId, t("vk.abort_done"), { mainKeyboard: true });
    return { handled: true, aborted: true };
  } catch (error) {
    logger.error("[VkBot] Abort failed:", error);
    await sender.sendText(peerId, t("vk.abort_failed"), { mainKeyboard: true });
    return { handled: true, aborted: false };
  }
}
