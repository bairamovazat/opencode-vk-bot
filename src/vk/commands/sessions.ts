import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";
import type { PickerOption } from "../keyboards.js";
import { sendPickerView } from "../picker.js";

/** /sessions: open the sessions picker view (FR-103, US2, F3). */
export async function handleSessionsCommand(
  sender: VkSender,
  peerId: number,
  page = 0,
): Promise<void> {
  const project = getCurrentProject();
  if (!project) {
    await sender.sendText(peerId, t("bot.project_not_selected"), { mainKeyboard: true });
    return;
  }

  // Fetch well beyond one page so the header can show the real total.
  const { data, error } = await opencodeClient.session.list({
    directory: project.worktree,
    limit: 100,
  });
  if (error || !data || data.length === 0) {
    await sender.sendText(peerId, t("vk.sessions_empty"), { mainKeyboard: true });
    return;
  }

  const options: PickerOption[] = data.map((session) => ({
    label: (session.title || session.id).slice(0, 40),
    action: {
      kind: "resume-session",
      id: session.id,
      title: session.title || session.id,
      directory: session.directory || project.worktree,
    },
  }));

  logger.info(`[VkBot] /sessions: ${options.length} session(s) for ${project.worktree}`);
  await sendPickerView(sender, peerId, "sessions", options, "vk.sessions_header", page);
}
