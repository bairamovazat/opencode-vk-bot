import type { VkMessage } from "../types.js";
import type { VkSender } from "../send.js";
import { handleAbortIfRequested } from "./abort.js";
import { handleNewCommand } from "./new.js";
import { handleSessionsCommand } from "./sessions.js";
import { handleStatusCommand } from "./status.js";
import { handleRenameCommand } from "./rename.js";
import { handleHelpCommand } from "./help.js";
import { resolveButtonText, setView } from "../keyboards.js";
import { handleProjectsCommand } from "./projects.js";
import { handleModelsCommand } from "./models.js";
import { t } from "../../i18n/index.js";

export interface CommandDeps {
  sender: VkSender;
  peerId: number;
  /** Notified when the owner aborts the current session. */
  onAborted?: ((sessionId: string) => void) | undefined;
}

export function parseCommand(text: string): { name: string; args: string } | null {
  const trimmed = resolveButtonText(text).trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const [rawName, ...rest] = trimmed.split(/\s+/);
  const name = (rawName ?? "").split("@")[0]!.slice(1).toLowerCase();
  if (name.length === 0) {
    return null;
  }
  return { name, args: rest.join(" ") };
}

/**
 * US2/US4 command dispatch. Returns true when the message was a command
 * and has been fully handled (no agent prompt follows).
 */
export async function handleCommandIfRequested(
  message: VkMessage,
  deps: CommandDeps,
): Promise<boolean> {
  const command = parseCommand(message.text);
  if (!command) {
    return false;
  }
  const { sender, peerId } = deps;

  switch (command.name) {
    case "abort":
    case "stop": {
      // Pass the resolved command, never the raw label: keyboard labels
      // (e.g. «⏹ Стоп») would not match the abort command set and the
      // message would leak to the agent as a prompt (FR-112).
      const outcome = await handleAbortIfRequested(`/${command.name}`, sender, peerId);
      if (outcome.handled) {
        // Only a real abort may register the session for error suppression:
        // an idle no-op or failed attempt must not swallow future errors.
        if (outcome.aborted) {
          const { getCurrentSession } = await import("../../app/services/session-service.js");
          const active = getCurrentSession();
          if (active) {
            deps.onAborted?.(active.id);
          }
        }
        setView(peerId, "main");
      }
      return outcome.handled;
    }
    case "new":
      await handleNewCommand(sender, peerId);
      return true;
    case "sessions":
      await handleSessionsCommand(sender, peerId);
      return true;
    case "status":
      await handleStatusCommand(sender, peerId);
      return true;
    case "rename":
      await handleRenameCommand(command.args, sender, peerId);
      return true;
    case "projects":
      await handleProjectsCommand(sender, peerId);
      return true;
    case "models":
      await handleModelsCommand(sender, peerId);
      return true;
    case "menu":
      // Run-view «🏠 Меню»: return to the main keyboard (FR-112).
      setView(peerId, "main");
      await sender.sendText(peerId, t("vk.menu_main_hint"), { mainKeyboard: true });
      return true;
    case "help":
    case "start":
      await handleHelpCommand(sender, peerId);
      return true;
    default:
      // Unknown command: fall through to the agent like plain text.
      return false;
  }
}
