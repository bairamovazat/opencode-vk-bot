import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession, setCurrentSession } from "../../app/services/session-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";

/** /rename <title>: renames the current session (FR-007). */
export async function handleRenameCommand(
  args: string,
  sender: VkSender,
  peerId: number,
): Promise<void> {
  const title = args.trim();
  const session = getCurrentSession();

  if (title.length === 0 || !session) {
    await sender.sendText(peerId, t(session ? "vk.rename_usage" : "vk.rename_no_session"));
    return;
  }

  const { error } = await opencodeClient.session.update({
    sessionID: session.id,
    directory: session.directory,
    title,
  });
  if (error) {
    logger.warn("[VkBot] session.update failed:", error);
    await sender.sendText(peerId, t("error.generic"));
    return;
  }

  setCurrentSession({ ...session, title });
  await sender.sendText(peerId, t("vk.rename_done", { title }));
}
