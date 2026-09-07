// Live VK long-poll smoke (specs/002-keyboard-navigation, "Verification"):
// connects to the real Long Poll and counts incoming updates for a few
// seconds WITHOUT processing or replying to anything (read-only).
//
//   node scripts/vk-live-smoke.mjs [seconds]
//
// Requires VK_GROUP_TOKEN + VK_GROUP_ID in .env. Exits 0 when the poll
// session was issued and kept running without errors.
import "dotenv/config";
import { VkApiClient } from "../dist/vk/client.js";
import { VkLongPoll } from "../dist/vk/longpoll.js";

const seconds = Number.parseInt(process.argv[2] ?? "12", 10);
const groupId = Number.parseInt(process.env.VK_GROUP_ID ?? "", 10);
if (!groupId || groupId <= 0) {
  console.error("[smoke] VK_GROUP_ID is missing or invalid");
  process.exit(1);
}

const client = new VkApiClient();
let received = 0;
const controller = new AbortController();

const longPoll = new VkLongPoll({
  client,
  groupId,
  waitSec: 5,
  signal: controller.signal,
  onUpdate: () => {
    received += 1;
  },
  sleep: async (ms) => {
    // Fail fast on polling errors instead of backing off for a smoke run.
    throw new Error(`smoke aborted: poll backoff requested (${ms}ms)`);
  },
});

setTimeout(() => controller.abort(), seconds * 1000);

try {
  await longPoll.run();
  console.log(`[smoke] OK: long poll ran for ~${seconds}s without errors`);
  process.exit(0);
} catch (error) {
  console.error(`[smoke] FAIL: ${error?.message ?? error}`);
  process.exit(1);
} finally {
  console.log(`[smoke] updates seen (not processed): ${received}`);
}
