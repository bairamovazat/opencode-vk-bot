import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";

/** /status: project, session, model, busy state summary (FR-007). */
export async function handleStatusCommand(sender: VkSender, peerId: number): Promise<void> {
  const project = getCurrentProject();
  const session = getCurrentSession();
  const model = getStoredModel();

  let state = t("vk.status_state_idle");
  try {
    if (session) {
      const { data, error } = await opencodeClient.session.status({ directory: session.directory });
      const status = error || !data ? undefined : (data as Record<string, { type?: string }>)[session.id];
      if (status?.type === "busy") {
        state = t("vk.status_state_busy");
      }
    }
  } catch (error) {
    logger.warn("[VkBot] status check failed:", error);
  }

  await sender.sendText(
    peerId,
    t("vk.status_report", {
      project: project?.name ?? t("status.project_not_selected"),
      session: session?.title ?? t("status.project_not_selected"),
      model: model.modelID || t("status.project_not_selected"),
      state,
    }),
  );
}
