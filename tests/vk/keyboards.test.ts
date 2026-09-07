import { beforeEach, describe, expect, it } from "vitest";
import {
  buildMainReplyKeyboard,
  buildPickerKeyboard,
  buildRunKeyboard,
  isKeyboardWithinBudget,
  resolveButtonText,
  resolveKeyboardTap,
  setView,
  type PickerOption,
} from "../../src/vk/keyboards.js";

const PEER = 2000000042;

function sessionOption(title: string, id = `ses-${title}`): PickerOption {
  return {
    label: title.slice(0, 40),
    action: { kind: "resume-session", id, title, directory: "/repo" },
  };
}

describe("keyboard view store", () => {
  beforeEach(() => {
    // Fresh store per test: default view is main.
    setView(PEER, "main", []);
  });

  it("defaults to the main view with no options", () => {
    const view = resolveKeyboardTap(PEER + 1, "что-то своё");
    expect(view.kind).toBe("passthrough");
  });

  it("opens a picker view and resolves taps by stored identity", () => {
    setView(PEER, "sessions", [sessionOption("Моя задача")]);

    const resolution = resolveKeyboardTap(PEER, "Моя задача");

    expect(resolution.kind).toBe("action");
    expect(resolution.action).toMatchObject({
      kind: "resume-session",
      id: "ses-Моя задача",
    });
  });

  it("resolves identical labels to distinct stored identities (SC-103)", () => {
    setView(PEER, "sessions", [sessionOption("Same", "ses-a"), sessionOption("Same", "ses-b")]);

    const first = resolveKeyboardTap(PEER, "Same");
    expect(first.action).toMatchObject({ id: "ses-a" });
  });

  it("returns to main on the back label", () => {
    setView(PEER, "projects", [
      { label: "repo", action: { kind: "switch-project", id: "p1", name: "repo" } },
    ]);

    const resolution = resolveKeyboardTap(PEER, "⬅️ Меню");

    expect(resolution.kind).toBe("action");
    expect(resolution.action).toMatchObject({ kind: "back" });
    // Following free text is a passthrough at main.
    expect(resolveKeyboardTap(PEER, "свободный текст").kind).toBe("passthrough");
  });

  it("resets to main and passes free text typed inside a picker (FR-107)", () => {
    setView(PEER, "models", [
      {
        label: "zai/glm",
        action: { kind: "switch-model", providerID: "zai", modelID: "glm", label: "zai/glm" },
      },
    ]);

    const resolution = resolveKeyboardTap(PEER, "напиши стихи");

    expect(resolution.kind).toBe("passthrough");
  });

  it("ignores main-view taps in main view (labels are handled by the router)", () => {
    setView(PEER, "main", []);

    expect(resolveKeyboardTap(PEER, "📊 Статус").kind).toBe("passthrough");
  });
});

describe("keyboard builders", () => {
  it("main keyboard is within budget and holds the documented buttons", () => {
    const keyboard = buildMainReplyKeyboard();
    const labels = keyboard.buttons.flat().map((b) => b.action.label);

    expect(labels).toEqual([
      "🆕 Новая",
      "📋 Сессии",
      "📊 Статус",
      "📁 Проекты",
      "🤖 Модели",
      "⏹ Стоп",
      "❓ Помощь",
    ]);
    expect(isKeyboardWithinBudget(keyboard)).toBe(true);
  });

  it("run keyboard offers stop, status and menu", () => {
    const labels = buildRunKeyboard().buttons.flat().map((b) => b.action.label);
    expect(labels).toEqual(["⏹ Стоп", "📊 Статус", "🏠 Меню"]);
  });

  it("picker keyboard appends the back button and truncates at 10 options", () => {
    const options = Array.from({ length: 14 }, (_, i) => sessionOption(`s${i}`, `id-${i}`));
    const keyboard = buildPickerKeyboard(options);

    expect(keyboard.buttons).toHaveLength(11); // 10 options + back
    expect(keyboard.buttons.at(-1)![0]!.action.label).toBe("⬅️ Меню");
    expect(isKeyboardWithinBudget(keyboard)).toBe(true);
  });

  it("maps button labels to commands", () => {
    expect(resolveButtonText("🆕 Новая")).toBe("/new");
    expect(resolveButtonText("⏹ Стоп")).toBe("/abort");
    expect(resolveButtonText("обычный текст")).toBe("обычный текст");
  });
});
