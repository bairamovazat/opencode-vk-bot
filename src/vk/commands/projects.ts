import { getProjects } from "../../app/services/project-service.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";
import type { PickerOption } from "../keyboards.js";
import { sendPickerView } from "../picker.js";

/** /projects: open the projects picker view (FR-103, US3, F4). */
export async function handleProjectsCommand(
  sender: VkSender,
  peerId: number,
  page = 0,
): Promise<void> {
  const projects = await getProjects();
  if (projects.length === 0) {
    await sender.sendText(peerId, t("bot.project_not_selected"), { mainKeyboard: true });
    return;
  }

  const options: PickerOption[] = projects.map((project) => ({
    label: (project.name || project.worktree).slice(0, 40),
    action: { kind: "switch-project", id: project.id, name: project.name || project.worktree },
  }));

  await sendPickerView(sender, peerId, "projects", options, "vk.projects_header", page);
}
