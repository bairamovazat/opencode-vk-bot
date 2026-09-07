// Live VK probe (specs/002-keyboard-navigation, "Verification"): sends the
// three keyboard shapes the bot uses to the owner's dialog and reports VK
// API acceptance. Run AFTER `npm run build`:
//
//   node scripts/vk-live-probe.mjs
//
// Requires VK_GROUP_TOKEN + VK_ALLOWED_USER_ID in .env. The owner sees
// three "[probe]" messages; a rejection (error 911/912) fails the probe.
import "dotenv/config";
import { VkApiClient } from "../dist/vk/client.js";
import {
  buildMainReplyKeyboard,
  buildRunKeyboard,
  buildInlinePickerKeyboard,
  registerPicker,
} from "../dist/vk/keyboards.js";

const peerId = Number.parseInt(process.env.VK_ALLOWED_USER_ID ?? "", 10);
if (!peerId || peerId <= 0) {
  console.error("[probe] VK_ALLOWED_USER_ID is missing or invalid");
  process.exit(1);
}

const client = new VkApiClient();

async function send(label, text, keyboard) {
  const params = {
    peer_id: peerId,
    message: text,
    random_id: Math.floor(Math.random() * 2_000_000_000),
    dont_parse_links: 1,
  };
  if (keyboard) {
    params.keyboard = JSON.stringify(keyboard);
  }
  try {
    const messageId = await client.call("messages.send", params);
    console.log(`[probe] ${label}: OK (message_id=${typeof messageId === "object" ? messageId.message_id : messageId})`);
  } catch (error) {
    const code = error && typeof error.code === "number" ? error.code : "?";
    console.error(`[probe] ${label}: FAIL (code=${code}, ${error?.message ?? error})`);
    process.exitCode = 1;
  }
}

await send("main-reply-keyboard", "[probe 1/3] Главное меню — проверка reply-клавиатуры", buildMainReplyKeyboard());
await send("run-keyboard", "[probe 2/3] Режим задачи — проверка run-клавиатуры", buildRunKeyboard());

const options = [1, 2, 3, 4, 5].map((i) => ({
  label: `Вариант ${i}`,
  action: { kind: "resume-session", id: `probe-${i}`, title: `probe ${i}`, directory: "/probe" },
}));
const menuId = registerPicker("sessions", options);
await send(
  "inline-picker-keyboard",
  "[probe 3/3] Пикер — проверка инлайн-клавиатуры (кнопки не нажимаются, это тест рендеринга)",
  buildInlinePickerKeyboard(menuId, options),
);
