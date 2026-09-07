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
  type VkKeyboard,
} from "../../src/vk/keyboards.js";

function labels(keyboard: VkKeyboard): string[][] {
  return keyboard.buttons.map((row) => row.map((b) => b.action.label));
}

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
    expect(resolveButtonText("🏠 Меню")).toBe("/menu");
    expect(resolveButtonText("обычный текст")).toBe("обычный текст");
  });

  it("forces a keyboard redraw: buttons JSON differs per build, labels identical", () => {
    const first = buildMainReplyKeyboard();
    const second = buildMainReplyKeyboard();

    // Fresh sequence numbers → the client sees a NEW keyboard every action.
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
    // Visible part stays identical: same labels in the same places.
    expect(labels(first)).toEqual(labels(second));

    // Documented schema: every button carries a payload with the command.
    for (const button of first.buttons.flat()) {
      const payload = JSON.parse(button.action.payload!) as { cmd: string; n: number };
      expect(payload.cmd).toMatch(/^\//);
      expect(payload.n).toBeGreaterThan(0);
    }
    expect(resolveButtonText(first.buttons[0]![0]!.action.label)).toBe("/new");

    const runFirst = buildRunKeyboard();
    const runSecond = buildRunKeyboard();
    expect(JSON.stringify(runFirst)).not.toBe(JSON.stringify(runSecond));
    expect(labels(runFirst)).toEqual(labels(runSecond));
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

describe("pagination taps", () => {
  it("nav row holds only the available directions plus the back button", () => {
    const options = Array.from({ length: 12 }, (_, i) => sessionOption(`s${i}`, `id-${i}`));

    const first = buildInlinePickerKeyboard("m1", options.slice(0, 5), {
      hasPrev: false,
      hasNext: true,
    });
    expect(first.buttons.at(-1)!.map((b) => b.action.label)).toEqual(["⬅️ Меню", "▶️"]);

    const middle = buildInlinePickerKeyboard("m2", options.slice(5, 10), {
      hasPrev: true,
      hasNext: true,
    });
    expect(middle.buttons.at(-1)!.map((b) => b.action.label)).toEqual([
      "◀️",
      "⬅️ Меню",
      "▶️",
    ]);
    // Option rows + nav row stay within the verified 6-row platform limit.
    expect(middle.buttons).toHaveLength(6);
    expect(isKeyboardWithinBudget(middle)).toBe(true);

    const last = buildInlinePickerKeyboard("m3", options.slice(10, 12), {
      hasPrev: true,
      hasNext: false,
    });
    expect(last.buttons.at(-1)!.map((b) => b.action.label)).toEqual(["◀️", "⬅️ Меню"]);
  });

  it("prev/next taps keep the menu alive and compute the target page", () => {
    const menuId = registerPicker("sessions", [sessionOption("s5", "id-5")], 1);

    const next = resolveInlineTap(parseInlinePayload({ v: 1, k: "next", m: menuId, x: 0 })!);
    expect(next.stale).toBe(false);
    expect(next.action).toMatchObject({ kind: "page", view: "sessions", page: 2 });

    // The menu was NOT consumed: paging again works from the same message.
    const prev = resolveInlineTap(parseInlinePayload({ v: 1, k: "prev", m: menuId, x: 0 })!);
    expect(prev.action).toMatchObject({ kind: "page", view: "sessions", page: 0 });
  });

  it("nav taps on an evicted menu are stale", () => {
    const resolution = resolveInlineTap(
      parseInlinePayload({ v: 1, k: "next", m: "m-gone", x: 0 })!,
    );
    expect(resolution.stale).toBe(true);
  });
});
