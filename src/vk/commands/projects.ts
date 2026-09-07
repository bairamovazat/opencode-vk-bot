import { getProjects } from "../../app/services/project-service.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";
import {
  buildInlinePickerKeyboard,
  isKeyboardWithinBudget,
  registerPicker,
  setView,
  type PickerOption,
} from "../keyboards.js";

/** /projects: open the projects picker view (FR-103, US3). */
export async function handleProjectsCommand(sender: VkSender, peerId: number): Promise<void> {
  const projects = await getProjects();
  if (projects.length === 0) {
    await sender.sendText(peerId, t("bot.project_not_selected"));
    return;
  }

  const options: PickerOption[] = projects.slice(0, 10).map((project) => ({
    label: (project.name || project.worktree).slice(0, 40),
    action: { kind: "switch-project", id: project.id, name: project.name || project.worktree },
  }));

  setView(peerId, "projects", options);

  const menuId = registerPicker("projects", options);
  const keyboard = buildInlinePickerKeyboard(menuId, options);
  const textFallback =
    t("vk.projects_header") + "\n" + options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  if (isKeyboardWithinBudget(keyboard)) {
    await sender.sendText(peerId, t("vk.projects_header"), {
      keyboard,
      fallbackText: textFallback,
    });
  } else {
    await sender.sendText(peerId, textFallback);
  }
}
