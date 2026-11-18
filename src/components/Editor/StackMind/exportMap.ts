/**
 * Export an expanded map at its intrinsic size, including rich text, code,
 * images and math. An offscreen canvas leaves the reader's viewport intact.
 * @module components/Editor/StackMind/exportMap
 */
import MindElixir, { type MindElixirInstance } from "mind-elixir";
import { toSvg, toPng } from "html-to-image";
import { escapeHtml } from "@/utils/sanitize";
import { projectMap } from "./mapProjection";
import type { MapModel } from "./mapEdits";

export type MapExportFormat = "svg" | "png" | "html";

export async function renderMapExport(format: MapExportFormat, live: Pick<MindElixirInstance, "theme" | "direction">, model: MapModel, urls: ReadonlyMap<string, string>): Promise<Blob> {
  const shell = document.createElement("div");
  shell.className = "stackmind stackmind-export";
  shell.style.cssText = "position:fixed;left:-100000px;top:0;width:1024px;height:768px;pointer-events:none";
  const host = document.createElement("div");
  host.className = "stackmind__canvas";
  shell.append(host);
  document.body.append(shell);
  const { data, labels } = projectMap(model, 0, urls, new Set());
  const snapshot = new MindElixir({ el: host, direction: live.direction, theme: live.theme, editable: false,
    keypress: false, toolBar: false, contextMenu: false, allowUndo: false,
    markdown: (text, node) => labels.get(node.id) ?? escapeHtml(text) });
  try {
    snapshot.init(data);
    await Promise.all(Array.from(host.querySelectorAll("img"), img => img.decode()));
    await document.fonts.ready;
    snapshot.linkDiv();
    const target = snapshot.nodes;
    const options = { width: target.offsetWidth, height: target.offsetHeight,
      backgroundColor: getComputedStyle(snapshot.container).backgroundColor, preferredFontFormat: "woff2" };
    if (format === "png") {
      const url = await toPng(target, { ...options, pixelRatio: 2 });
      return (await fetch(url)).blob();
    }
    const url = await toSvg(target, options);
    const svg = await (await fetch(url)).text();
    if (format === "svg") return new Blob([svg], { type: "image/svg+xml" });
    return new Blob([`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(model.topic)}</title></head><body>`, svg, "</body></html>"], { type: "text/html" });
  } finally { snapshot.destroy(); shell.remove(); }
}
