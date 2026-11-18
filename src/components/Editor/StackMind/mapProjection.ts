/**
 * Project Markdown blocks and images onto Mind Elixir nodes. Source ranges,
 * presentation and edit identity are kept separately.
 * @module components/Editor/StackMind/mapProjection
 */
import type { NodeObj } from "mind-elixir";
import { renderPart, type MapBlock } from "./mapContent";
import type { Branch, MapModel } from "./mapEdits";

export type MapEntry = { id: string; line: number; end: number; parent?: string; branch?: Branch; block?: MapBlock; image?: { offset: number; length: number } };

export function projectMap(model: MapModel, version: number, urls: ReadonlyMap<string, string>, folded: ReadonlySet<string>) {
  const entries = new Map<string, MapEntry>();
  const labels = new Map<string, string>();
  function convert(n: Branch, parent?: string): NodeObj {
    entries.set(n.id, { id: n.id, line: n.start, end: n.end, ...(parent && { parent }), branch: n });
    if (n.label) {
      const rendered = n.label.children?.map(c => renderPart(c, model.source)).join("") ?? "";
      const check = n.kind === "item" && /^\s*\[( |x)\]\s/i.test(model.lines[n.start].slice(n.contentIndent))
        ? (/^\s*\[x\]/i.test(model.lines[n.start].slice(n.contentIndent)) ? "☑ " : "☐ ") : "";
      labels.set(n.id, check + rendered);
    }
    const children: NodeObj[] = [];
    for (const body of n.blocks) {
      entries.set(body.id, { id: body.id, parent: n.id, line: body.start, end: body.end, block: body });
      labels.set(body.id, renderPart(body.part, model.source));
      children.push({ id: body.id, topic: model.source.slice(body.from, body.to), metadata: version });
    }
    for (const [i, image] of n.images.entries()) {
      const id = n.id + "img" + i;
      const url = urls.get(image.url);
      entries.set(id, { id, parent: n.id, line: image.start, end: image.start + 1, image });
      children.push({ id, topic: image.alt, metadata: version,
        ...(url && { image: { url, width: 160, height: 100, fit: "contain" as const } }) });
    }
    for (const c of n.children) children.push(convert(c, n.id));
    children.sort((a,b) => entries.get(a.id)!.line - entries.get(b.id)!.line);
    return { id: n.id, topic: n.topic || "…", metadata: version, expanded: !folded.has(n.id + n.topic), children };
  }
  return { data: { nodeData: convert(model) }, entries, labels };
}
