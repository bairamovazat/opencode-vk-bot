import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";
import { buildSessionsMenu } from "../menus.js";
import { vkClient } from "../client-instance.js";

/** /sessions: recent sessions for the current project as a resume menu (FR-007). */
export async function handleSessionsCommand(sender: VkSender, peerId: number): Promise<void> {
  const project = getCurrentProject();
  if (!project) {
    await sender.sendText(peerId, t("bot.project_not_selected"));
    return;
  }

  const { data, error } = await opencodeClient.session.list({
    directory: project.worktree,
    limit: 10,
  });
  if (error || !data || data.length === 0) {
    await sender.sendText(peerId, t("vk.sessions_empty"));
    return;
  }

  const sessions = data.slice(0, 10).map((session) => ({
    id: session.id,
    title: session.title || session.id,
    directory: session.directory || project.worktree,
  }));

  logger.info(`[VkBot] /sessions: ${sessions.length} session(s) for ${project.worktree}`);
  await buildSessionsMenu({ client: vkClient, sender }, peerId, sessions);
}
