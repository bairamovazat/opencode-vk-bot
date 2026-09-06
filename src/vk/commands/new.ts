import { clearSession, getCurrentSession } from "../../app/services/session-service.js";
import { foregroundSessionState } from "../../app/managers/foreground-session-state-manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";

/** /new: drop the current session binding; the next message starts fresh. */
export async function handleNewCommand(sender: VkSender, peerId: number): Promise<void> {
  const session = getCurrentSession();
  if (session) {
    foregroundSessionState.markIdle(session.id);
  }
  clearSession();
  logger.info("[VkBot] Session cleared via /new");
  await sender.sendText(peerId, t("vk.new_cleared"));
}
