import { unified, type Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { List, PhrasingContent, Root, RootContent, Table } from "mdast";

const processor = unified().use(remarkParse as Plugin).use(remarkGfm as Plugin);

const HEADING_MARKER = "■ ";
const HORIZONTAL_RULE = "———";

/**
 * Renders assistant markdown into VK-friendly plain text (research D4:
 * VK messages carry no formatting). Code fences are preserved; inline
 * markers are stripped; links collapse to "text (url)".
 */
export function renderMarkdownToPlainText(markdown: string): string {
  if (markdown.trim().length === 0) {
    return "";
  }

  const tree = processor.parse(markdown) as Root;
  const rendered = tree.children.map((node) => renderBlock(node)).filter((s) => s.length > 0);

  return collapseBlankLines(rendered.join("\n\n")).trim();
}

function renderBlock(node: RootContent): string {
  switch (node.type) {
    case "heading":
      return HEADING_MARKER + renderInline(node.children).trim();
    case "paragraph":
      return renderInline(node.children).trim();
    case "code":
      return renderFence(node.lang, node.value);
    case "blockquote": {
      const inner = node.children.map(renderBlock).filter((s) => s.length > 0).join("\n\n");
      return prefixLines(inner, "> ");
    }
    case "list":
      return renderList(node);
    case "table":
      return renderTable(node);
    case "thematicBreak":
      return HORIZONTAL_RULE;
    case "html":
      // VK cannot render HTML; keep the raw source as text.
      return node.value.trim();
    default:
      return "";
  }
}

function renderFence(lang: string | null | undefined, code: string): string {
  const info = lang ? lang : "";
  return `${"```"}${info}\n${code.replace(/\n$/, "")}\n${"```"}`;
}

function renderList(node: List, depth = 0): string {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  let index = 0;

  for (const item of node.children) {
    index += 1;
    const marker = node.ordered ? `${index}. ` : "- ";
    const itemLines: string[] = [];
    for (const child of item.children) {
      if (child.type === "paragraph") {
        itemLines.push(renderInline(child.children).trim());
      } else if (child.type === "list") {
        itemLines.push(renderList(child, depth + 1));
      } else if (child.type === "code") {
        itemLines.push(renderFence(child.lang, child.value));
      }
    }
    const [first, ...rest] = itemLines;
    if (first !== undefined) {
      lines.push(indent + marker + first);
      for (const extra of rest) {
        lines.push(prefixLines(extra, indent + "  "));
      }
    }
  }

  return lines.join("\n");
}

function renderTable(node: Table): string {
  const rows = node.children.map((row) =>
    row.children.map((cell) => renderInline(cell.children).trim().replace(/\|/g, "\\|")),
  );
  return rows.map((row) => row.join(" | ")).join("\n");
}

function renderInline(nodes: PhrasingContent[]): string {
  return nodes.map(renderPhrasing).join("");
}

function renderPhrasing(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "emphasis":
    case "strong":
    case "delete":
      return renderInline(node.children);
    case "inlineCode":
      return `\`${node.value}\``;
    case "link": {
      const label = renderInline(node.children).trim();
      const url = node.url;
      if (!url || url === label || url.startsWith("#") || url.startsWith("mailto:")) {
        return label;
      }
      return `${label} (${url})`;
    }
    case "image":
      return node.alt ? `[image: ${node.alt}]` : "[image]";
    case "break":
      return "\n";
    default: {
      const maybeChildren = node as { children?: PhrasingContent[] };
      if (Array.isArray(maybeChildren.children)) {
        return renderInline(maybeChildren.children);
      }
      return "";
    }
  }
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? prefix + line : prefix.trimEnd()))
    .join("\n");
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}
