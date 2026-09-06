import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";
import {
  clearSession,
  getCurrentSession,
  setCurrentSession,
  type SessionInfo,
} from "../../app/services/session-service.js";
import { ingestSessionInfoForCache } from "../../app/services/session-cache-service.js";
import { getCurrentProject, setCurrentProject } from "../../app/stores/settings-store.js";
import { getProjects } from "../../app/services/project-service.js";
import { getStoredAgent, resolveProjectAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { foregroundSessionState } from "../../app/managers/foreground-session-state-manager.js";
import { safeBackgroundTask } from "../../utils/safe-background-task.js";
import { formatErrorDetails } from "../../utils/error-format.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkMessage } from "../types.js";
import type { VkSender } from "../send.js";
import type { VkRunCollector } from "../run-collector.js";

const PROJECT_AUTO_SELECT_LOG = "[VkBot] No project selected: auto-selecting the first project";

export interface VkMessageHandlerDeps {
  sender: VkSender;
  runCollector: VkRunCollector;
  peerId: number;
}

/**
 * US1 prompt flow for VK text messages: mirrors the platform-agnostic part
 * of the upstream Telegram prompt handler (project → session → subscribe →
 * promptAsync) and delivers the final assistant text (research D4).
 */
export async function handleOwnerTextMessage(
  message: VkMessage,
  deps: VkMessageHandlerDeps,
): Promise<void> {
  const { sender, runCollector, peerId } = deps;

  if (message.text.trim().length === 0) {
    return;
  }

  try {
    const project = await ensureProjectSelected(sender, peerId);
    if (!project) {
      return;
    }

    let session = getCurrentSession();
    if (session && session.directory !== project.worktree) {
      logger.warn(
        `[VkBot] Session/project mismatch (session=${session.directory}, project=${project.worktree}); resetting session`,
      );
      clearSession();
      session = null;
    }

    if (!session) {
      await sender.sendText(peerId, t("bot.creating_session"));
      const { data: created, error } = await opencodeClient.session.create({
        directory: project.worktree,
      });
      if (error || !created) {
        await sender.sendText(peerId, t("bot.create_session_error"));
        return;
      }
      session = {
        id: created.id,
        title: created.title,
        directory: project.worktree,
      } satisfies SessionInfo;
      setCurrentSession(session);
      await ingestSessionInfoForCache(created);
      logger.info(`[VkBot] Created session ${session.id} for ${project.worktree}`);
    }

    const busy = await isSessionBusy(session.id, session.directory);
    if (busy) {
      await sender.sendText(peerId, t("bot.session_busy"));
      return;
    }

    await runCollector.begin(session.id, session.directory);

    const currentAgent = await resolveProjectAgent(getStoredAgent());
    const storedModel = getStoredModel();
    const parts: Array<TextPartInput | FilePartInput> = [{ type: "text", text: message.text }];

    logger.info(
      `[VkBot] Dispatching promptAsync session=${session.id} agent=${currentAgent ?? "default"}`,
    );

    foregroundSessionState.markBusy(session.id, session.directory);

    const promptOptions: Parameters<typeof opencodeClient.session.promptAsync>[0] = {
      sessionID: session.id,
      directory: session.directory,
      parts,
    };
    if (currentAgent) {
      promptOptions.agent = currentAgent;
    }
    if (storedModel.providerID && storedModel.modelID) {
      promptOptions.model = { providerID: storedModel.providerID, modelID: storedModel.modelID };
    }
    if (storedModel.variant) {
      promptOptions.variant = storedModel.variant;
    }

    safeBackgroundTask({
      taskName: "vk.session.promptAsync",
      task: () => opencodeClient.session.promptAsync(promptOptions),
      onSuccess: ({ error }) => {
        if (error) {
          foregroundSessionState.markIdle(session.id);
          logger.error("[VkBot] session.promptAsync API error:", formatErrorDetails(error, 4000));
          void sender.sendText(peerId, t("bot.prompt_send_error"));
          return;
        }
        logger.info("[VkBot] session.promptAsync accepted");
      },
      onError: (error) => {
        foregroundSessionState.markIdle(session.id);
        logger.error("[VkBot] session.promptAsync failed:", error);
        void sender.sendText(peerId, t("bot.prompt_send_error"));
      },
    });
  } catch (error) {
    logger.error("[VkBot] Unexpected failure in message handler:", error);
    await sender.sendText(peerId, t("error.generic"));
  }
}

/**
 * Single-owner convenience (spec assumption + quickstart scenario 1):
 * the first project is selected automatically when none was chosen yet.
 * Explicit switching stays in the /projects story (US5).
 */
async function ensureProjectSelected(
  sender: VkSender,
  peerId: number,
): Promise<{ worktree: string } | null> {
  const selected = getCurrentProject();
  if (selected) {
    return selected;
  }

  logger.info(PROJECT_AUTO_SELECT_LOG);
  const projects = await getProjects();
  const first = projects[0];
  if (!first) {
    await sender.sendText(peerId, t("bot.project_not_selected"));
    return null;
  }

  setCurrentProject(first);
  return first;
}

async function isSessionBusy(sessionId: string, directory: string): Promise<boolean> {
  try {
    const { data, error } = await opencodeClient.session.status({ directory });
    if (error || !data) {
      logger.warn("[VkBot] Failed to check session status before prompt:", error);
      return false;
    }
    const status = (data as Record<string, { type?: string }>)[sessionId];
    return status?.type === "busy";
  } catch (error) {
    logger.warn("[VkBot] Error checking session status:", error);
    return false;
  }
}
