import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";
import {
  buildPickerKeyboard,
  isKeyboardWithinBudget,
  setView,
  type PickerOption,
} from "../keyboards.js";

/** /sessions: open the sessions picker view (FR-103, US2). */
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

  const options: PickerOption[] = data.slice(0, 10).map((session) => ({
    label: (session.title || session.id).slice(0, 40),
    action: {
      kind: "resume-session",
      id: session.id,
      title: session.title || session.id,
      directory: session.directory || project.worktree,
    },
  }));

  logger.info(`[VkBot] /sessions: ${options.length} session(s) for ${project.worktree}`);
  setView(peerId, "sessions", options);

  const keyboard = buildPickerKeyboard(options);
  const textFallback =
    t("vk.sessions_header") + "\n" + options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  if (isKeyboardWithinBudget(keyboard)) {
    await sender.sendText(peerId, t("vk.sessions_header"), {
      keyboard,
      fallbackText: textFallback,
    });
  } else {
    await sender.sendText(peerId, textFallback);
  }
}
