import { describe, expect, it } from "vitest";
import {
  buildInlinePickerKeyboard,
  buildMainReplyKeyboard,
  buildRunKeyboard,
  isKeyboardWithinBudget,
  parseInlinePayload,
  registerPicker,
  resolveButtonText,
  resolveInlineTap,
  type PickerOption,
} from "../../src/vk/keyboards.js";

function sessionOption(title: string, id = `ses-${title}`): PickerOption {
  return {
    label: title.slice(0, 40),
    action: { kind: "resume-session", id, title, directory: "/repo" },
  };
}

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

  it("inline picker stays within the verified 6-row limit (5 options + back)", () => {
    const options = Array.from({ length: 14 }, (_, i) => sessionOption(`s${i}`, `id-${i}`));
    const menuId = registerPicker("sessions", options);
    const keyboard = buildInlinePickerKeyboard(menuId, options);

    // Verified live: 7+ rows trigger VK API error 911.
    expect(keyboard.buttons).toHaveLength(6);
    expect(keyboard.buttons.at(-1)![0]!.action.label).toBe("⬅️ Меню");
    expect(isKeyboardWithinBudget(keyboard)).toBe(true);
  });

  it("maps button labels to commands", () => {
    expect(resolveButtonText("🆕 Новая")).toBe("/new");
    expect(resolveButtonText("⏹ Стоп")).toBe("/abort");
    expect(resolveButtonText("обычный текст")).toBe("обычный текст");
  });
});

describe("inline tap resolution", () => {
  it("resolves taps by stored identity, not by label (SC-103)", () => {
    const options = [sessionOption("Same", "ses-a"), sessionOption("Same", "ses-b")];
    const menuId = registerPicker("sessions", options);

    const second = buildInlinePickerKeyboard(menuId, options).buttons[1]![0]!.action;
    void second;
    const tap = parseInlinePayload(
      JSON.parse(
        (buildInlinePickerKeyboard(menuId, options).buttons[1]![0]!.action as { payload: string })
          .payload,
      ),
    );
    expect(tap).not.toBeNull();

    // Re-register a fresh menu where option 0 has a different id.
    const freshId = registerPicker("sessions", [sessionOption("Same", "ses-c")]);
    void freshId;
    void tap;
    const menuId2 = registerPicker("sessions", options);
    const resolution = resolveInlineTap({
      menuId: menuId2,
      index: 1,
      kind: "pick",
    });
    expect(resolution.stale).toBe(false);
    expect(resolution.action).toMatchObject({ id: "ses-b" });
  });

  it("marks unknown menu ids as stale", () => {
    const resolution = resolveInlineTap({ menuId: "m-missing", index: 0, kind: "pick" });
    expect(resolution.stale).toBe(true);
  });

  it("back tap removes the menu and returns a back action", () => {
    const menuId = registerPicker("sessions", [sessionOption("x")]);
    const tap = parseInlinePayload(
      JSON.parse((buildInlinePickerKeyboard(menuId, [sessionOption("x")]).buttons[1]![0]!.action as { payload: string }).payload),
    );
    expect(tap?.kind).toBe("back");

    const resolution = resolveInlineTap(tap!);
    expect(resolution.action).toMatchObject({ kind: "back" });
    // Second tap on the same menu is stale (resolved menus are removed).
    expect(resolveInlineTap(tap!).stale).toBe(true);
  });

  it("rejects malformed payloads", () => {
    expect(parseInlinePayload("nope")).toBeNull();
    expect(parseInlinePayload({ v: 2, k: "pick", m: "m1", x: 0 })).toBeNull();
    expect(parseInlinePayload({ v: 1, k: "pick", m: "m1", x: -1 })).toBeNull();
  });
});
