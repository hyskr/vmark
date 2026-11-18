/**
 * Render the source-position Markdown tree inside map labels. Node topics
 * retain raw text for inline editing. The canvas HTML is presentation only.
 * @module components/Editor/StackMind/mapContent
 */
import { lowlight } from "@/plugins/codeBlockLineNumbers/languages";
import katex from "katex";
import "katex/dist/katex.min.css";
import { escapeHtml } from "@/utils/sanitize";

export interface MarkdownPart {
  type: string;
  value?: string | undefined;
  alt?: string | null | undefined;
  lang?: string | null | undefined;
  children?: readonly MarkdownPart[] | undefined;
  ordered?: boolean | null | undefined;
  url?: string | undefined;
  align?: readonly ("left" | "right" | "center" | null)[] | null | undefined;
  checked?: boolean | null | undefined;
  position?: { start: { line: number; offset?: number | undefined }; end: { line: number; offset?: number | undefined } } | undefined;
}

export interface MapBlock {
  id: string;
  part: MarkdownPart;
  from: number;
  to: number;
  start: number;
  end: number;
}

const wrappers: Record<string, string> = {
  paragraph: "p", emphasis: "em", strong: "strong", delete: "del", inlineCode: "code",
  highlight: "mark", subscript: "sub", superscript: "sup", underline: "u",
  blockquote: "blockquote", listItem: "li", tableCell: "td", tableRow: "tr",
  link: "span", linkReference: "span", heading: "span",
};

function colorCode(code: string, language?: string | null) {
  if (!language || !lowlight.registered(language)) return escapeHtml(code);
  type Token = { type: string; value?: string; properties?: { className?: unknown }; children?: readonly Token[] };
  function render(t: Token): string {
    if (t.type === "text") return escapeHtml(t.value ?? "");
    const classes = Array.isArray(t.properties?.className) ? t.properties.className.join(" ") : "";
    return `<span class="${escapeHtml(classes)}">${t.children?.map(render).join("") ?? ""}</span>`;
  }
  return lowlight.highlight(language, code).children.map(t => render(t as Token)).join("");
}

export function renderPart(n: MarkdownPart, source: string): string {
  const value = n.value ?? "";
  if (n.type === "math" || n.type === "inlineMath") {
    return katex.renderToString(value, { displayMode: n.type === "math", throwOnError: false, trust: false, maxSize: 10 });
  }
  if (n.type === "code") return `<pre><code>${colorCode(value, n.lang)}</code></pre>`;
  if (n.type === "break") return "<br>";
  if (n.type === "thematicBreak") return "<hr>";
  if (n.type === "image" || n.type === "imageReference") return escapeHtml(n.alt ?? "");
  if (n.type === "html" || n.type === "yaml") return `<code>${escapeHtml(value)}</code>`;
  const content = n.children ? n.children.map(child => renderPart(child, source)).join("") : escapeHtml(value);
  if (n.type === "list") {
    const tag = n.ordered ? "ol" : "ul";
    return `<${tag}>${content}</${tag}>`;
  }
  if (n.type === "table") {
    const [header, ...rows] = n.children ?? [];
    const row = (r: MarkdownPart, tag: "td" | "th") => "<tr>" + (r.children ?? []).map((c, i) => {
      const align = n.align?.[i];
      const attribute = align === "left" || align === "right" || align === "center" ? ` style="text-align:${align}"` : "";
      return `<${tag}${attribute}>${c.children?.map(part => renderPart(part, source)).join("") ?? ""}</${tag}>`;
    }).join("") + "</tr>";
    return `<table><thead>${header ? row(header, "th") : ""}</thead><tbody>${rows.map(r => row(r, "td")).join("")}</tbody></table>`;
  }
  if (n.type === "link" || n.type === "linkReference" || n.type === "wikiLink") {
    return `<span class="stackmind-link" title="${escapeHtml(n.url ?? value)}">${content}</span>`;
  }
  const tag = wrappers[n.type];
  if (tag) return `<${tag}>${content}</${tag}>`;
  if (content) return content;
  return escapeHtml(source.slice(n.position?.start.offset ?? 0, n.position?.end.offset ?? 0));
}

export function asMapBlock(n: MarkdownPart): MapBlock | undefined {
  const p = n.position;
  if (!p || p.start.offset === undefined || p.end.offset === undefined) return;
  // Image-only paragraphs already have a thumbnail with its own navigation target.
  if (n.type === "paragraph" && n.children?.every(c => c.type === "image" || c.type === "imageReference" ||
    (c.type === "text" && !c.value?.trim()))) return;
  return { id: "block" + p.start.offset, part: n, from: p.start.offset, to: p.end.offset,
    start: p.start.line - 1, end: p.end.line };
}
