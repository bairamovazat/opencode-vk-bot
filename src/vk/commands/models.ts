import { getProviderModels, getProviders } from "../../app/services/model-selection-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";
import type { PickerOption } from "../keyboards.js";
import { sendPickerView } from "../picker.js";

/** /models: open the models picker view (FR-103, US3, F5). */
export async function handleModelsCommand(
  sender: VkSender,
  peerId: number,
  page = 0,
): Promise<void> {
  const providers = await getProviders();
  const options: PickerOption[] = [];

  for (const provider of providers.slice(0, 6)) {
    const providerModels = await getProviderModels(provider.id);
    for (const model of providerModels.slice(0, 4)) {
      options.push({
        label: `${model.providerID}/${model.modelID}`.slice(0, 40),
        action: {
          kind: "switch-model",
          providerID: model.providerID,
          modelID: model.modelID,
          label: `${model.providerID}/${model.modelID}`,
        },
      });
    }
  }

  if (options.length === 0) {
    await sender.sendText(peerId, t("vk.models_empty"), { mainKeyboard: true });
    return;
  }

  logger.info(`[VkBot] /models: ${options.length} model(s) listed`);
  await sendPickerView(sender, peerId, "models", options, "vk.models_header", page);
}
