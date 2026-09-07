import { getProviderModels, getProviders } from "../../app/services/model-selection-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import type { VkSender } from "../send.js";
import {
  buildInlinePickerKeyboard,
  isKeyboardWithinBudget,
  registerPicker,
  setView,
  type PickerOption,
} from "../keyboards.js";

/** /models: open the models picker view (FR-009, US3). */
export async function handleModelsCommand(sender: VkSender, peerId: number): Promise<void> {
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
    await sender.sendText(peerId, t("vk.models_empty"));
    return;
  }

  logger.info(`[VkBot] /models: ${options.length} model(s) listed`);
  setView(peerId, "models", options);

  const menuId = registerPicker("models", options);
  const keyboard = buildInlinePickerKeyboard(menuId, options);
  const textFallback =
    t("vk.models_header") + "\n" + options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  if (isKeyboardWithinBudget(keyboard)) {
    await sender.sendText(peerId, t("vk.models_header"), {
      keyboard,
      fallbackText: textFallback,
    });
  } else {
    await sender.sendText(peerId, textFallback);
  }
}
