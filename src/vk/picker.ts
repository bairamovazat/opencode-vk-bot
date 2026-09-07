import { t } from "../i18n/index.js";
import type { VkSender } from "./send.js";
import {
  MAX_PICKER_OPTIONS,
  attachPickerMessages,
  buildInlinePickerKeyboard,
  isKeyboardWithinBudget,
  registerPicker,
  setView,
  type PickerOption,
  type ViewName,
} from "./keyboards.js";

/**
 * Renders one picker page (FR-103): registers the shown options under a
 * fresh menu id, sends the header (with the total count and, when paging,
 * the page indicator) plus the inline keyboard — ≤5 option rows and a nav
 * row («◀️ / ⬅️ Меню / ▶️» when paginating, just «⬅️ Меню» otherwise), 6
 * rows total per the verified VK platform limit. A plain-text fallback is
 * sent for keyboards rejected by community settings (VK error 912).
 *
 * Page taps re-render as fresh messages: the handler re-fetches, so the
 * next/prev target is clamped to the available range here.
 */
export async function sendPickerView(
  sender: VkSender,
  peerId: number,
  view: ViewName,
  options: PickerOption[],
  headerKey: Parameters<typeof t>[0],
  requestedPage = 0,
): Promise<void> {
  const total = options.length;
  const pages = Math.max(1, Math.ceil(total / MAX_PICKER_OPTIONS));
  const page = Math.min(Math.max(0, requestedPage), pages - 1);
  const shown = options.slice(page * MAX_PICKER_OPTIONS, (page + 1) * MAX_PICKER_OPTIONS);
  setView(peerId, view, shown);

  const menuId = registerPicker(view, shown, page);
  const keyboard = buildInlinePickerKeyboard(menuId, shown, {
    hasPrev: page > 0,
    hasNext: page < pages - 1,
  });
  const header = t(headerKey);
  const totalLine =
    pages > 1
      ? t("vk.picker_total_pages", { total, page: page + 1, pages })
      : t("vk.picker_total", { total });
  const text = `${header}\n${totalLine}`;
  const textFallback =
    text + "\n" + shown.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  if (isKeyboardWithinBudget(keyboard)) {
    const messageIds = await sender.sendText(peerId, text, {
      keyboard,
      fallbackText: textFallback,
    });
    attachPickerMessages(menuId, messageIds);
  } else {
    await sender.sendText(peerId, textFallback);
  }
}
