// Live VK self-test driver (specs/002-keyboard-navigation, "Verification"):
// posts SELFTEST-marked messages as the community. With VK_SELF_TEST=1 the
// bot treats its own marked replies as owner prompts, so this drives the
// REAL pipeline (long poll → normalizer → router → commands → OpenCode →
// sender) without the owner's phone. Requires a running bot:
//
//   node scripts/vk-live-selftest.mjs "/help" "📋 Сессии" "/status"
//
// Outcomes are asserted from the bot's log (LOG_LEVEL=debug shows every
// messages.send). OpenCode runs real sessions for free-text prompts.
import "dotenv/config";
import { VkApiClient } from "../dist/vk/client.js";

const peerId = Number.parseInt(process.env.VK_ALLOWED_USER_ID ?? "", 10);
if (!peerId || peerId <= 0) {
  console.error("[selftest] VK_ALLOWED_USER_ID is missing or invalid");
  process.exit(1);
}

const texts = process.argv.slice(2);
if (texts.length === 0) {
  console.error("[selftest] usage: node scripts/vk-live-selftest.mjs <text> [more texts…]");
  process.exit(1);
}

const client = new VkApiClient();
for (const text of texts) {
  try {
    await client.call("messages.send", {
      peer_id: peerId,
      message: `SELFTEST:${text}`,
      random_id: Math.floor(Math.random() * 2_000_000_000),
    });
    console.log(`[selftest] posted: ${text}`);
  } catch (error) {
    console.error(`[selftest] FAILED to post "${text}": ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
