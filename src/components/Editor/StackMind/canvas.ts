/**
 * StackMind canvas. Mind Elixir owns the layout, gestures and inline editor;
 * Markdown remains authoritative for the node tree.
 * @module components/Editor/StackMind/canvas
 */
import MindElixir, { type MindElixirInstance, type NodeObj, type Topic } from "mind-elixir";
import { escapeHtml } from "@/utils/sanitize";
import { commitMapEdit, goToMapLine, mapHistory } from "./editorLink";
import { insertChild, moveBranch, removeBranch, renameNode, type Branch, type MapModel } from "./mapEdits";

export type Layout = "left" | "both" | "right";
export type MapTheme = "auto" | "light" | "dark";
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

type Entry = { id: string; line: number; end: number; parent?: string; branch?: Branch };

export function mountCanvas(host: HTMLElement, tabId: string, newTitle: string, report: (failed: boolean) => void, onScale: (scale: number) => void) {
  let model: MapModel | undefined;
  let locked = true;
  let autoFit = true;
  let fitting = false;
  let version = 0;
  let activeId = "";
  let entries = new Map<string, Entry>();
  const folded = new Set<string>();
  const imageLabels = new Map<string, string>();
  let followLine = 0;
  let layout: Layout = "right";
  let theme: MapTheme = "auto";
  let pendingEditAt: number | null = null;

  function entry(raw?: NodeObj) {
    return raw?.metadata === version ? entries.get(raw.id) : undefined;
  }
  function apply(change: ReturnType<typeof moveBranch>) {
    try {
      const ok = !!model && !locked && commitMapEdit(tabId, model, change);
      report(!ok);
      return ok;
    } catch {
      report(true);
      return false;
    }
  }
  function move(from: Topic[], to: Topic, where: "before" | "after" | "in") {
    if (!model || from.length !== 1 || !host.contains(to) || !host.contains(from[0])) return false;
    const a = entry(from[0].nodeObj)?.branch, b = entry(to.nodeObj)?.branch;
    if (a && b) apply(moveBranch(model, a, b, where));
    return false;
  }

  const mind: MindElixirInstance = new MindElixir({
    el: host, direction: MindElixir.RIGHT, toolBar: false, contextMenu: false, keypress: false,
    allowUndo: false, selectionContainer: host, scaleMin: MIN_ZOOM, scaleMax: MAX_ZOOM,
    markdown: (text, raw) => escapeHtml(imageLabels.get(raw.id) ?? text),
    before: {
      beginEdit(el) {
        const branch = entry((el ?? mind.currentNode)?.nodeObj)?.branch;
        return !locked && !!branch && branch.kind !== "root";
      },
      moveNodeIn: (a, b) => move(a, b, "in"),
      moveNodeBefore: (a, b) => move(a, b, "before"),
      moveNodeAfter: (a, b) => move(a, b, "after"),
    },
  });
  mind.bus.addListener("scale", scale => {
    if (!fitting) autoFit = false;
    onScale(scale);
  });

  function fit() {
    autoFit = true;
    if (!model || !host.clientWidth || !host.clientHeight) return;
    fitting = true;
    try { mind.scaleFit(); } finally { fitting = false; }
  }

  function scaleTo(next: number, center?: { x: number; y: number }) {
    if (model) mind.scale(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next)), center);
  }

  function zoom(inward: boolean) {
    scaleTo(inward ? mind.scaleVal * ZOOM_STEP : mind.scaleVal / ZOOM_STEP);
  }

  // macOS WebKit reports a trackpad pinch relative to the start of the
  // gesture. Other engines already send the modified wheel event Mind Elixir handles.
  let pinchStart: number | null = null;
  function pinch(e: Event & { scale?: number; clientX?: number; clientY?: number }) {
    if (!model) return;
    e.preventDefault();
    if (e.type === "gesturestart") pinchStart = mind.scaleVal;
    else if (e.type === "gestureend") pinchStart = null;
    else if (pinchStart !== null && typeof e.scale === "number" && e.scale > 0) {
      const center = e.clientX !== undefined && e.clientY !== undefined ? { x: e.clientX, y: e.clientY } : undefined;
      scaleTo(pinchStart * e.scale, center);
    }
  }
  function skipDuplicateWheel(e: WheelEvent) {
    if (pinchStart !== null && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  const gestures = ["gesturestart", "gesturechange", "gestureend"];
  for (const name of gestures) host.addEventListener(name, pinch, { passive: false });
  host.addEventListener("wheel", skipDuplicateWheel, { capture: true, passive: false });

  function refreshTheme() {
    const dark = theme === "dark" || (theme === "auto" && document.documentElement.classList.contains("dark-theme"));
    mind.changeTheme(dark ? MindElixir.DARK_THEME : MindElixir.THEME, false);
  }
  const observer = new MutationObserver(refreshTheme);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  function highlight(id: string, scroll: boolean) {
    if (!entries.has(id)) return;
    const node = host.querySelector<HTMLElement>(`[data-nodeid="me${id}"]`);
    if (activeId === id && node?.hasAttribute("aria-current")) return;
    const path: string[] = [];
    for (let p = entries.get(id)?.parent; p; p = entries.get(p)?.parent) path.unshift(p);
    for (const p of path) {
      const el = mind.findEle(p);
      if (el.nodeObj.expanded === false) mind.expandNode(el, true);
    }
    host.querySelector("[aria-current]")?.removeAttribute("aria-current");
    const el = mind.findEle(id);
    el.setAttribute("aria-current", "location");
    if (scroll) mind.scrollIntoView(el);
    activeId = id;
  }

  function follow(line: number) {
    followLine = line;
    if (!model || !mind.nodeData || host.querySelector("#input-box")) return;
    let best = model.id;
    for (const candidate of entries.values()) {
      if (candidate.line <= line && line < candidate.end) best = candidate.id;
    }
    highlight(best, true);
  }

  function clicked(e: MouseEvent) {
    const el = (e.target as Element).closest<Topic>("me-tpc");
    const found = entry(el?.nodeObj);
    if (!el || !found || !model) return;
    goToMapLine(tabId, found.line, model, found.branch);
    highlight(found.id, false);
  }
  host.addEventListener("click", clicked);

  function selected() {
    // Clicking a toolbar control leaves the canvas selection intact.
    const active = entries.get(activeId);
    return active?.branch ?? (active?.parent ? entries.get(active.parent)?.branch : undefined) ?? entry(mind.currentNode?.nodeObj)?.branch;
  }
  function add(sibling = false) {
    if (!model || locked) return;
    const n = selected() ?? model;
    if (sibling && n.kind !== "root") {
      const prefix = n.kind === "heading" ? "#".repeat(n.level) : " ".repeat(n.indent) + n.marker;
      const at = Math.min(model.offsets[n.end], model.source.length);
      const before = at > 0 && model.source[at - 1] !== "\n" ? "\n" : "";
      pendingEditAt = n.end;
      if (!apply({ from: at, insert: before + prefix + " " + newTitle + (at < model.source.length || model.source.endsWith("\n") ? "\n" : "") })) pendingEditAt = null;
    } else {
      pendingEditAt = n.end;
      if (!apply(insertChild(model, n, newTitle))) pendingEditAt = null;
    }
  }
  function remove() {
    const n = selected();
    if (model && n && n.kind !== "root") apply(removeBranch(model, n));
  }
  function keys(e: KeyboardEvent) {
    const input = host.querySelector("#input-box");
    if (e.isComposing || e.keyCode === 229) { if (input) e.stopPropagation(); return; }
    if (input || locked || !model) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") mapHistory(tabId, e.shiftKey);
    else if (e.metaKey || e.ctrlKey || e.altKey) return;
    else if (e.key === "Tab" && !e.shiftKey && mind.currentNode) add();
    else if (e.key === "Enter" && mind.currentNode) add(true);
    else if (e.key === "Delete" || (e.shiftKey && e.key === "Backspace")) remove();
    else if ((e.key === "F2" || e.key === "Backspace") && mind.currentNode) void mind.beginEdit(mind.currentNode);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  host.addEventListener("keydown", keys, true);
  mind.bus.addListener("operation", op => {
    if (op.name === "beginEdit") {
      host.querySelector<HTMLElement>("#input-box")?.focus({ preventScroll: true });
      return;
    }
    if (op.name !== "finishEdit") return;
    const n = entry(op.obj)?.branch;
    if (!n) return;
    const change = renameNode(n, op.obj.topic);
    // React may coalesce a rename immediately followed by Undo. Keep the
    // canvas at its last source snapshot until a new snapshot is delivered.
    op.obj.topic = op.origin;
    mind.refresh();
    apply(change);
  });
  mind.bus.addListener("expandNode", n => {
    const key = n.id + n.topic;
    if (n.expanded === false) folded.add(key); else folded.delete(key);
  });
  function setLayout(value: Layout) {
    layout = value;
    if (!model) return;
    if (value === "left") mind.initLeft();
    else if (value === "both") mind.initSide();
    else mind.initRight();
    if (autoFit) fit();
    follow(followLine);
  }

  return {
    update(next: MapModel, readOnly: boolean, urls: ReadonlyMap<string, string>) {
      const initial = !model;
      model = next;
      locked = readOnly;
      mind.editable = !locked;
      version++;
      entries = new Map();
      imageLabels.clear();
      function convert(n: Branch, parent?: string): NodeObj {
        entries.set(n.id, { id: n.id, line: n.start, end: n.end, ...(parent && { parent }), branch: n });
        // Keep the raw Markdown for inline editing and substitute image alt
        // text only in the rendered label, including after a layout change.
        if (n.images.length) {
          let label = n.topic;
          for (const img of n.images.slice().reverse()) {
            if (img.offset < n.labelFrom || img.offset + img.length > n.labelTo) continue;
            const at = img.offset - n.labelFrom;
            label = label.slice(0, at) + img.alt + label.slice(at + img.length);
          }
          imageLabels.set(n.id, label || "…");
        }
        const children: NodeObj[] = [];
        for (const [i, image] of n.images.entries()) {
          const id = n.id + "img" + i;
          const url = urls.get(image.url);
          entries.set(id, { id, parent: n.id, line: image.start, end: image.start + 1 });
          children.push({ id, topic: image.alt, metadata: version,
            ...(url && { image: { url, width: 160, height: 100, fit: "contain" as const } }) });
        }
        for (const c of n.children) children.push(convert(c, n.id));
        children.sort((a,b) => entries.get(a.id)!.line - entries.get(b.id)!.line);
        return { id: n.id, topic: n.topic || "…", metadata: version, expanded: !folded.has(n.id + n.topic), children };
      }
      const data = { nodeData: convert(next) };
      if (initial) { mind.init(data); refreshTheme(); setLayout(layout); }
      else mind.refresh(data);
      follow(followLine);
      if (pendingEditAt !== null) {
        const fresh = [...entries.values()].find(e => e.line === pendingEditAt && e.branch?.topic === newTitle);
        pendingEditAt = null;
        if (fresh) {
          highlight(fresh.id, true);
          const el = mind.findEle(fresh.id);
          mind.selectNode(el);
          void mind.beginEdit(el);
        }
      }
    },
    follow, add: () => add(), remove, setLayout,
    setTheme(value: MapTheme) { theme = value; if (model) refreshTheme(); },
    zoom, fit, resize: () => { if (autoFit) fit(); },
    destroy() {
      for (const name of gestures) host.removeEventListener(name, pinch);
      host.removeEventListener("wheel", skipDuplicateWheel, true);
      observer.disconnect();
      host.removeEventListener("keydown", keys, true);
      host.removeEventListener("click", clicked);
      mind.destroy();
    },
  };
}
