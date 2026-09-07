import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";

/** /help and /start: static command reference. */
export async function handleHelpCommand(sender: VkSender, peerId: number): Promise<void> {
  const lines = [
    t("vk.help_header"),
    "• /new — " + t("cmd.description.new"),
    "• /sessions — " + t("cmd.description.sessions"),
    "• /status — " + t("cmd.description.status"),
    "• /rename <новое_название> — " + t("cmd.description.rename"),
    "• /abort — " + t("cmd.description.stop"),
  ];
  await sender.sendText(peerId, lines.join("\n"), { mainKeyboard: true });
}
