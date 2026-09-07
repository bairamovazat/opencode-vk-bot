import { clearSession, getCurrentSession } from "../../app/services/session-service.js";
import { foregroundSessionState } from "../../app/managers/foreground-session-state-manager.js";
import { getProjects } from "../../app/services/project-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";
import type { PickerOption } from "../keyboards.js";
import { sendPickerView } from "../picker.js";

/**
 * /new (flow F2): drop the current session binding; when several projects
 * exist, let the owner pick the project for the new task (US5). The next
 * free-text message then starts the session in the chosen project.
 */
export async function handleNewCommand(sender: VkSender, peerId: number): Promise<void> {
  const session = getCurrentSession();
  if (session) {
    foregroundSessionState.markIdle(session.id);
  }
  clearSession();
  logger.info("[VkBot] Session cleared via /new");

  const projects = await getProjects();
  if (projects.length > 1) {
    const options: PickerOption[] = projects.map((project) => ({
      label: (project.name || project.worktree).slice(0, 40),
      action: { kind: "switch-project", id: project.id, name: project.name || project.worktree },
    }));
    await sendPickerView(sender, peerId, "projects", options, "vk.new_pick_project");
    return;
  }

  await sender.sendText(peerId, t("vk.new_cleared"), { mainKeyboard: true });
}
