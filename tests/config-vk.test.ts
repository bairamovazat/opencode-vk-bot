import { beforeEach, describe, expect, it, vi } from "vitest";

describe("vk config parsing", () => {
  let buildVkConfig: typeof import("../src/config.js").buildVkConfig;

  beforeEach(async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("VK_GROUP_TOKEN", "test-vk-group-token");
    vi.stubEnv("VK_GROUP_ID", "12345");
    vi.stubEnv("VK_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("VK_API_VERSION", "");
    vi.stubEnv("VK_LONG_POLL_WAIT_SEC", "");
    vi.stubEnv("VK_MAX_ATTACHMENT_MB", "");
    // Drive buildVkConfig directly: re-importing the whole config module to
    // observe a top-level throw turned out to be flaky under vitest (see the
    // telegram config tests). The exported builder is the unit under test.
    ({ buildVkConfig } = await import("../src/config.js"));
  });

  it("parses required VK credentials", () => {
    const vk = buildVkConfig();

    expect(vk.groupToken).toBe("test-vk-group-token");
    expect(vk.groupId).toBe(12345);
    expect(vk.allowedUserId).toBe(123456789);
  });

  it("applies documented defaults", () => {
    const vk = buildVkConfig();

    expect(vk.apiVersion).toBe("5.199");
    expect(vk.longPollWaitSec).toBe(25);
    expect(vk.maxAttachmentMb).toBe(45);
  });

  it("throws when VK_GROUP_TOKEN is missing", () => {
    vi.stubEnv("VK_GROUP_TOKEN", "");

    expect(() => buildVkConfig()).toThrow(/VK_GROUP_TOKEN/);
  });

  it("throws when VK_GROUP_ID is not a positive integer", () => {
    vi.stubEnv("VK_GROUP_ID", "not-a-number");

    expect(() => buildVkConfig()).toThrow(/VK_GROUP_ID/);
  });

  it("throws when VK_GROUP_ID is negative (community ids arrive as -id in events)", () => {
    vi.stubEnv("VK_GROUP_ID", "-12345");

    expect(() => buildVkConfig()).toThrow(/VK_GROUP_ID/);
  });

  it("throws when VK_ALLOWED_USER_ID is missing", () => {
    vi.stubEnv("VK_ALLOWED_USER_ID", "");

    expect(() => buildVkConfig()).toThrow(/VK_ALLOWED_USER_ID/);
  });

  it("clamps VK_LONG_POLL_WAIT_SEC into the documented 5..90 range", () => {
    vi.stubEnv("VK_LONG_POLL_WAIT_SEC", "2");
    expect(buildVkConfig().longPollWaitSec).toBe(5);

    vi.stubEnv("VK_LONG_POLL_WAIT_SEC", "500");
    expect(buildVkConfig().longPollWaitSec).toBe(90);
  });

  it("parses VK_MAX_ATTACHMENT_MB", () => {
    vi.stubEnv("VK_MAX_ATTACHMENT_MB", "10");

    expect(buildVkConfig().maxAttachmentMb).toBe(10);
  });
});
