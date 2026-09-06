import { getProviderModels, getProviders } from "../../app/services/model-selection-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";
import { buildModelsMenu } from "../menus.js";

/** /models: switch the model used for subsequent prompts (FR-009, US6). */
export async function handleModelsCommand(sender: VkSender, peerId: number): Promise<void> {
  const providers = await getProviders();
  const models: Array<{ providerID: string; modelID: string; label: string }> = [];

  for (const provider of providers.slice(0, 6)) {
    const providerModels = await getProviderModels(provider.id);
    for (const model of providerModels.slice(0, 4)) {
      models.push({
        providerID: model.providerID,
        modelID: model.modelID,
        label: `${model.providerID}/${model.modelID}`,
      });
    }
  }

  if (models.length === 0) {
    await sender.sendText(peerId, t("vk.models_empty"));
    return;
  }

  logger.info(`[VkBot] /models: ${models.length} model(s) listed`);
  const short = models.slice(0, 10);
  const textFallback =
    t("vk.models_header") + "\n" + short.map((m, i) => `${i + 1}. ${m.label}`).join("\n");
  await buildModelsMenu({ sender }, peerId, short, textFallback);
}
