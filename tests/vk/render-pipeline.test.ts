import { describe, expect, it } from "vitest";
import { renderMarkdownToPlainText } from "../../src/vk/render/pipeline.js";

describe("render pipeline: markdown to VK plain text", () => {
  it("returns empty string for empty input", () => {
    expect(renderMarkdownToPlainText("")).toBe("");
    expect(renderMarkdownToPlainText("   \n  ")).toBe("");
  });

  it("keeps plain paragraphs as-is", () => {
    expect(renderMarkdownToPlainText("Просто текст без разметки.")).toBe(
      "Просто текст без разметки.",
    );
  });

  it("renders headings with a plain marker", () => {
    expect(renderMarkdownToPlainText("## Итоги")).toBe("■ Итоги");
  });

  it("strips bold and italic markers but keeps text", () => {
    expect(renderMarkdownToPlainText("**важно** и *аккуратно* и ~~убрано~~")).toBe(
      "важно и аккуратно и убрано",
    );
  });

  it("preserves code blocks with fences and language hint", () => {
    const input = "До.\n\n```ts\nconst a = 1;\n```\n\nПосле.";

    expect(renderMarkdownToPlainText(input)).toBe(
      "До.\n\n```ts\nconst a = 1;\n```\n\nПосле.",
    );
  });

  it("keeps inline code markers", () => {
    expect(renderMarkdownToPlainText("Use `npm test` now")).toBe("Use `npm test` now");
  });

  it("collapses links to text with url", () => {
    expect(renderMarkdownToPlainText("[дока](https://vk.com/dev)")).toBe(
      "дока (https://vk.com/dev)",
    );
  });

  it("keeps bare label when url repeats the label", () => {
    expect(renderMarkdownToPlainText("[https://example.com](https://example.com)")).toBe(
      "https://example.com",
    );
  });

  it("renders lists with dash markers", () => {
    const input = "- первый\n- второй\n- третий";

    expect(renderMarkdownToPlainText(input)).toBe("- первый\n- второй\n- третий");
  });

  it("renders ordered lists with numbers", () => {
    expect(renderMarkdownToPlainText("1. раз\n2. два")).toBe("1. раз\n2. два");
  });

  it("prefixes blockquotes", () => {
    expect(renderMarkdownToPlainText("> цитата\n> продолжение")).toBe(
      "> цитата\n> продолжение",
    );
  });

  it("renders tables as pipe rows", () => {
    const input = "| a | b |\n|---|---|\n| 1 | 2 |";

    expect(renderMarkdownToPlainText(input)).toBe("a | b\n1 | 2");
  });

  it("collapses excessive blank lines", () => {
    const input = "один\n\n\n\n\nдва";

    expect(renderMarkdownToPlainText(input)).toBe("один\n\nдва");
  });
});
