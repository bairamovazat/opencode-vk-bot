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
import { isSttConfigured, transcribeAudio } from "../../app/services/stt-service.js";
import { formatErrorDetails } from "../../utils/error-format.js";
import { logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import { t } from "../../i18n/index.js";
import type { VkMessage } from "../types.js";
import type { VkSender } from "../send.js";
import type { VkRunCollector } from "../run-collector.js";
import { handleAbortIfRequested } from "../commands/abort.js";

const PROJECT_AUTO_SELECT_LOG = "[VkBot] No project selected: auto-selecting the first project";

export interface VkMessageHandlerDeps {
  sender: VkSender;
  runCollector: VkRunCollector;
  peerId: number;
  /** Called after the backend accepted the prompt (US2 status start). */
  onRunStarted?: (sessionId: string, directory: string) => void;
  /** Called when the owner aborted the current session. */
  onAborted?: (sessionId: string) => void;
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

  const abort = await handleAbortIfRequested(message.text, sender, peerId);
  if (abort.handled) {
    const active = getCurrentSession();
    if (active) {
      deps.onAborted?.(active.id);
    }
    return;
  }

  const hasVoice = (message.attachments ?? []).some(
    (attachment) => attachment.type === "audio_message",
  );
  if (message.text.trim().length === 0 && !hasVoice) {
    return;
  }

  try {
    const speech = await resolveVoiceInput(message, sender, peerId);
    if (speech === null) {
      return;
    }
    const promptText = [message.text.trim(), speech].filter((part) => part.length > 0).join("\n");
    if (promptText.length === 0) {
      return;
    }

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
    const parts: Array<TextPartInput | FilePartInput> = [{ type: "text", text: promptText }];

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
        deps.onRunStarted?.(session.id, session.directory);
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

/**
 * Voice input (US8): VK often carries its own transcript inside
 * `audio_message`; when absent (or pending) and a Whisper-compatible STT
 * endpoint is configured, the audio is downloaded and transcribed.
 * Returns the extra prompt text ("") when there is no voice input, or null
 * when the prompt cannot be built at all.
 */
async function resolveVoiceInput(
  message: VkMessage,
  sender: VkSender,
  peerId: number,
): Promise<string | null> {
  const voiceMessages = (message.attachments ?? []).filter(
    (attachment) => attachment.type === "audio_message" && isRecord(attachment.audio_message),
  );
  if (voiceMessages.length === 0) {
    return "";
  }

  const transcripts: string[] = [];
  let sttAttempted = false;
  let sttAvailable = false;

  for (const attachment of voiceMessages) {
    const audio = attachment.audio_message as Record<string, unknown>;
    const transcript =
      audio.transcript_state === "done" && typeof audio.transcript === "string"
        ? audio.transcript.trim()
        : "";
    if (transcript.length > 0) {
      transcripts.push(transcript);
      continue;
    }
    const url = typeof audio.url === "string" ? audio.url : "";
    if (!isSttConfigured() || !url) {
      continue;
    }
    sttAvailable = true;
    sttAttempted = true;
    const transcribed = await downloadAndTranscribe(url, sender, peerId);
    if (transcribed !== null) {
      transcripts.push(transcribed);
    }
  }

  if (transcripts.length === 0) {
    if (message.text.trim().length > 0) {
      await sender.sendText(peerId, t("vk.voice_transcribe_error"));
      return message.text.trim();
    }
    await sender.sendText(
      peerId,
      sttAttempted && sttAvailable
        ? t("vk.voice_transcribe_error")
        : t("vk.voice_not_configured"),
    );
    return null;
  }

  return transcripts.map((text) => `(голосовое сообщение): ${text}`).join("\n");
}

async function downloadAndTranscribe(
  url: string,
  sender: VkSender,
  peerId: number,
): Promise<string | null> {
  try {
    await sender.sendText(peerId, t("vk.voice_transcribing"));
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn("[VkBot] Voice download failed", { status: response.status });
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const result = await transcribeAudio(buffer, "voice.ogg");
    return result.text.trim();
  } catch (error) {
    logger.error("[VkBot] Voice transcription failed:", error);
    return null;
  }
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
