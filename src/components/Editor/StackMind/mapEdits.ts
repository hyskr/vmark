/**
 * Source-mapped branch edits for the whole-document StackMind canvas.
 * Adapted from StackMind's surgical line edits (see src-tauri/resources/StackMind-NOTICES.txt).
 * The VMark parser supplies exact source positions, including heading markers
 * inside a moved section, so examples in fences never get re-indented as headings.
 * @module components/Editor/StackMind/mapEdits
 */
import type { Heading, List, Root, RootContent } from "mdast";
import type { ChangeSpec } from "@codemirror/state";
import { createMarkdownProcessor } from "@/utils/markdownPipeline/parser/processorFactory";
import { visit } from "unist-util-visit";
import { checkNestingDepth } from "@/utils/markdownPipeline/nestingDepth";

import { asMapBlock, type MapBlock, type MarkdownPart } from "./mapContent";

const parser = createMarkdownProcessor();

export interface Branch {
  id: string;
  topic: string;
  kind: "root" | "heading" | "item";
  start: number;
  end: number;
  labelFrom: number;
  labelTo: number;
  level: number;
  indent: number;
  contentIndent: number;
  marker: string;
  label?: MarkdownPart;
  blocks: MapBlock[];
  images: { url: string; alt: string; start: number; offset: number; length: number }[];
  children: Branch[];
}

export interface MapModel extends Branch {
  source: string;
  lines: string[];
  offsets: number[];
}

function branch(kind: Branch["kind"], start: number, end: number): Branch {
  return { kind, start, end, id: kind + start, topic: "", level: 0, indent: 0,
    contentIndent: 0, marker: "", blocks: [], images: [], labelFrom: -1, labelTo: -1, children: [] };
}

export function buildMap(source: string, title: string): MapModel {
  checkNestingDepth(source);
  const tree = parser.parse(source) as Root;
  const lines = source.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const offsets = [0];
  for (const line of lines) offsets.push(offsets[offsets.length - 1] + line.length + 1);
  const root: MapModel = { ...branch("root", 0, lines.length), topic: title, source, lines, offsets };
  const parents: Branch[] = [root];

  const definitions = new Map<string, string>();
  visit(tree, "definition", (n) => { if (!definitions.has(n.identifier)) definitions.set(n.identifier, n.url); });
  function collectImages(block: RootContent, owner: Branch) {
    visit(block, (n) => {
      const pos = (n as { position?: Heading["position"] }).position;
      if (!pos) return;
      const record = (url: string, alt: string) => {
        owner.images.push({ url, alt, start: pos.start.line - 1, offset: pos.start.offset!,
          length: pos.end.offset! - pos.start.offset! });
      };
      if (n.type === "image") record(n.url, n.alt ?? "");
      if (n.type === "imageReference") {
        const url = definitions.get(n.identifier);
        if (url) record(url, n.alt ?? "");
      }
      if (n.type === "html" && /<img\b/i.test(n.value)) {
        const template = document.createElement("template");
        template.innerHTML = n.value;
        for (const image of template.content.querySelectorAll<HTMLImageElement>("img[src]")) {
          record(image.getAttribute("src")!, image.alt);
        }
      }
    });
  }

  function addHeading(h: Heading) {
    const start = h.position!.start.line - 1;
    while (parents.length > 1 && parents[parents.length - 1].level >= h.depth) {
      parents.pop()!.end = start;
    }
    const node = branch("heading", start, lines.length);
    node.level = h.depth;
    node.marker = lines[start].match(/^ {0,3}(#{1,6})(?:\s|$)/)?.[1] ?? "";
    const inline = h.children as { position?: Heading["position"] }[];
    node.labelFrom = inline[0]?.position?.start.offset ?? h.position!.end.offset!;
    node.labelTo = inline.at(-1)?.position?.end.offset ?? node.labelFrom;
    // Some mark transforms produce children without positions. For ATX
    // headings the raw line also preserves optional trailing hashes.
    if (node.marker) {
      const prefix = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(lines[start])![0];
      const label = lines[start].slice(prefix.length).replace(/(?:[ \t]+#+)?[ \t]*$/, "");
      node.labelFrom = offsets[start] + prefix.length;
      node.labelTo = node.labelFrom + label.length;
    }
    node.topic = source.slice(node.labelFrom, node.labelTo);
    parents[parents.length - 1].children.push(node);
    parents.push(node);
    node.label = h;
    collectImages(h, node);
  }

  function addList(list: List, parent: Branch) {
    for (const item of list.children) {
      const start = item.position!.start.line - 1;
      const node = branch("item", start, item.position!.end.line);
      const prefix = /^(\s*)([-+*]|\d+[.)])([ \t]*)/.exec(lines[start]);
      if (!prefix) continue;
      node.marker = prefix[2];
      node.indent = prefix[1].length;
      node.contentIndent = prefix[0].length + (prefix[3] ? 0 : 1);
      const paragraph = item.children[0];
      const textStart = paragraph?.type === "paragraph" && paragraph.position?.start.line === start + 1
        ? paragraph.position.start.offset : undefined;
      node.labelFrom = textStart ?? offsets[start] + prefix[0].length;
      const checkbox = source.slice(node.labelFrom, offsets[start] + lines[start].length).match(/^\[[ xX]\][ \t]+/);
      if (checkbox) node.labelFrom += checkbox[0].length;
      node.labelTo = offsets[start] + lines[start].length;
      node.topic = source.slice(node.labelFrom, node.labelTo);
      parent.children.push(node);
      for (const child of item.children) {
        if (child.type === "list") addList(child, node);
        else {
          collectImages(child, node);
          if (child === paragraph && child.type === "paragraph" && child.position?.start.line === start + 1) node.label = child;
          else { const body = asMapBlock(child); if (body) node.blocks.push(body); }
        }
      }
    }
  }

  for (const block of tree.children) {
    if (block.type === "heading") addHeading(block);
    else if (block.type === "list") addList(block, parents[parents.length - 1]);
    else {
      const parent = parents[parents.length - 1];
      collectImages(block, parent);
      const body = asMapBlock(block);
      if (body) parent.blocks.push(body);
    }
  }
  return root;
}

export function renameNode(node: Branch, title: string): ChangeSpec | null {
  if (node.kind === "root" || !title.trim() || /[\r\n]/.test(title)) return null;
  const needsSpace = !node.topic && node.labelFrom === node.labelTo;
  return { from: node.labelFrom, to: node.labelTo, insert: (needsSpace ? " " : "") + title };
}

function replaceLines(map: MapModel, from: number, to: number, lines: string[]): ChangeSpec {
  const prefix = from === map.lines.length && map.source && !map.source.endsWith("\n") ? "\n" : "";
  const suffix = lines.length && (to < map.lines.length || map.source.endsWith("\n")) ? "\n" : "";
  return { from: Math.min(map.offsets[from], map.source.length), to: Math.min(map.offsets[to], map.source.length),
    insert: prefix + lines.join("\n") + suffix };
}

export function insertChild(map: MapModel, parent: Branch, title: string): ChangeSpec {
  const marker = parent.kind === "item" ? " ".repeat(parent.contentIndent) + "-"
    : parent.level === 6 ? "-" : "#".repeat(parent.level + 1);
  return replaceLines(map, parent.end, parent.end, [marker + " " + title]);
}

export function removeBranch(map: MapModel, node: Branch): ChangeSpec | null {
  return node.kind === "root" ? null : replaceLines(map, node.start, node.end, []);
}

/** Shift only real ATX/Setext headings, preserving prose and fenced source. */
function shiftHeadings(lines: string[], origin: number, node: Branch, delta: number): boolean {
  if (node.kind !== "heading") return true;
  const depth = node.level + delta;
  if (depth < 1 || depth > 6) return false;
  const index = node.start - origin;
  // Setext underlines can represent two depths. Keep their source style.
  if (!node.marker) {
    if (depth > 2) return false;
    const underline = lines.findIndex((line, i) => i > index && /^ {0,3}(?:=+|-+)\s*$/.test(line));
    if (underline < 0) return false;
    lines[underline] = lines[underline].replace(/[=-]+/, (s) => (depth === 1 ? "=" : "-").repeat(s.length));
  } else {
    lines[index] = lines[index].replace(/^( {0,3})#+/, "$1" + "#".repeat(depth));
  }
  return node.children.every((child) => shiftHeadings(lines, origin, child, delta));
}

export function moveBranch(map: MapModel, node: Branch, target: Branch, where: "before" | "after" | "in"): ChangeSpec | null {
  if (node.kind === "root" || node === target || (target.kind === "root" && where !== "in")) return null;
  if (target.kind !== "root" && target.start >= node.start && target.start < node.end) return null;
  const block = map.lines.slice(node.start, node.end);
  let at = where === "before" ? target.start : target.end;
  if (node.kind === "item" && where === "in" && target.kind !== "item") {
    // A list written after a subsection belongs to that subsection in Markdown.
    at = target.children.find((child) => child.kind === "heading")?.start ?? target.end;
  }
  if (node.kind === "heading") {
    if (target.kind === "item") return null;
    const delta = target.level + Number(where === "in") - node.level;
    if (delta && !shiftHeadings(block, node.start, node, delta)) return null;
  } else {
    if (target.kind !== "item" && where !== "in") return null;
    const delta = (where === "in" ? target.contentIndent : target.indent) - node.indent;
    for (let i = 0; i < block.length; i++) {
      if (!block[i]) continue;
      block[i] = delta >= 0 ? " ".repeat(delta) + block[i] : block[i].replace(new RegExp(`^ {0,${-delta}}`), "");
    }
  }
  return at <= node.start
    ? replaceLines(map, at, node.end, block.concat(map.lines.slice(at, node.start)))
    : replaceLines(map, node.start, at, map.lines.slice(node.end, at).concat(block));
}

/** Prose, fences and tables move as Markdown slices. Blank lines separate the
 * destination block and list continuation indentation belongs to the new owner. */
export function moveBody(map: MapModel, block: MapBlock, owner: Branch, neighbor: MapBlock | undefined,
  where: "before" | "after" | "in"): ChangeSpec | null {
  if (neighbor && (where === "in" || neighbor.id === block.id)) return null;
  if (!neighbor && where !== "in") return null;
  const line = neighbor ? (where === "before" ? neighbor.start : neighbor.end)
    : (owner.children[0]?.start ?? owner.end);
  const at = Math.min(map.offsets[line], map.source.length);
  if (at >= block.from && at <= block.to) return null;
  const originalIndent = block.from - map.offsets[block.start];
  const indent = owner.kind === "item" ? " ".repeat(owner.contentIndent) : "";
  const text = map.source.slice(block.from, block.to).split("\n").map((part, i) =>
    indent + (i && originalIndent ? part.replace(new RegExp(`^ {0,${originalIndent}}`), "") : part)).join("\n");
  const prefix = at === 0 || map.source.slice(0, at).endsWith("\n\n") ? "" : map.source[at - 1] === "\n" ? "\n" : "\n\n";
  const suffix = at < map.source.length ? "\n\n" : map.source.endsWith("\n") ? "\n" : "";
  const insertion = { from: at, insert: prefix + text + suffix };
  const deletion = { from: block.from, to: block.to, insert: "" };
  return at < block.from ? [insertion, deletion] : [deletion, insertion];
}
