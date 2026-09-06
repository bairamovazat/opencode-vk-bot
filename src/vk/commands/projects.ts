import { getProjects } from "../../app/services/project-service.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";
import { buildProjectsMenu } from "../menus.js";

/** /projects: switch the working directory (FR-008, US5). */
export async function handleProjectsCommand(sender: VkSender, peerId: number): Promise<void> {
  const projects = await getProjects();
  if (projects.length === 0) {
    await sender.sendText(peerId, t("bot.project_not_selected"));
    return;
  }
  const list = projects.slice(0, 10).map((project) => ({
    id: project.id,
    name: project.name || project.worktree,
  }));
  const textFallback =
    t("vk.projects_header") + "\n" + list.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  await buildProjectsMenu({ sender }, peerId, list, textFallback);
}
