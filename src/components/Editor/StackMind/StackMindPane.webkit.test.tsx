import { describe, expect, it, afterEach, beforeAll, vi } from "vitest";
import i18n from "@/i18n";
import "@/styles/index.css";
import "@/styles/button-shared.css";
import "@/styles/icon-button-shared.css";
import "@/styles/select-shared.css";
import { page } from "vitest/browser";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { useDocumentStore } from "@/stores/documentStore";
import { registerWysiwygFlusher } from "@/utils/wysiwygFlush";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { Editor } from "@tiptap/core";
import { mockIPC, mockConvertFileSrc, clearMocks } from "@tauri-apps/api/mocks";
import StarterKit from "@tiptap/starter-kit";
import StackMindPane from "./StackMindPane";

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
  await i18n.loadNamespaces(["editor", "settings", "common"]);
});

const roots: Root[] = [];
const views: EditorView[] = [];
const hosts: HTMLElement[] = [];

function mount(id: string, source: string, readOnly = false) {
  const store = useDocumentStore.getState();
  store.initDocument(id, source, id + ".md");
  store.setReadOnly(id, readOnly);
  const host = document.createElement("div");
  host.style.cssText = "width:800px;height:420px";
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.push(root);
  flushSync(() => root.render(<><div className="source-mount" /><StackMindPane key={id} tabId={id} /></>));
  const view = new EditorView({ parent: host.querySelector(".source-mount")!, state: EditorState.create({
    doc: source, extensions: [history(), EditorState.readOnly.of(readOnly), EditorView.updateListener.of(u => {
      if (u.selectionSet) store.setCursorInfo(id, { sourceLine: u.state.doc.lineAt(u.state.selection.main.head).number, nodeType: "paragraph", wordAtCursor:"", offsetInWord:0, percentInLine:0, contextBefore:"", contextAfter:"" });
      if (u.docChanged) store.setEditorContent(id, u.state.doc.toString());
    })],
  }) });
  views.push(view);
  useUIStore.getState().setSourceMode(true);
  useEditorStore.getState().setActiveSourceView(view, id);
  return { host, view, switchTo(next: string) {
    store.initDocument(next, source, next + ".md");
    flushSync(() => root.render(<><div className="source-mount" /><StackMindPane key={next} tabId={next} /></>));
  } };
}

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  for (const view of views.splice(0)) view.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

describe("whole-document mind map in WebKit", () => {
  it("zooms the actual canvas, keeps manual zoom across resizing and explicitly fits again", async () => {
    const { host } = mount("zoom", "# Parent\n## Child", true);
    await vi.waitFor(() => expect(host.querySelector(".stackmind")).not.toBeNull());
    const dock = host.querySelector<HTMLElement>(".stackmind")!;
    dock.style.cssText = "width:360px;height:250px;flex:none";
    const map = dock.querySelector<HTMLElement>(".map-canvas")!;
    const control = (name: string) => Array.from(dock.querySelectorAll(".stackmind__zoom button")).find(b => b.getAttribute("aria-label") === name) as HTMLButtonElement;
    const scale = () => new DOMMatrix(getComputedStyle(map).transform).a;
    await vi.waitFor(() => expect(dock.querySelector("output")).not.toBeNull());
    for (const name of ["缩小", "放大", "适应视图"]) {
      const button = control(name);
      expect(button).toBeDefined();
      expect(button.textContent).toBe("");
      expect(button.title).toBe(name);
      expect(button.querySelector("svg")).not.toBeNull();
    }
    control("适应视图").click();
    const initial = scale();
    control("放大").click();
    await vi.waitFor(() => expect(scale()).toBeGreaterThan(initial));
    const enlarged = scale();
    expect(dock.querySelector("output")!.textContent).toBe(Math.round(enlarged * 100) + "%");
    dock.style.width = "270px";
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    expect(scale()).toBeCloseTo(enlarged);
    control("缩小").click();
    await vi.waitFor(() => expect(scale()).toBeLessThan(enlarged));
    for (let i = 0; i < 35; i++) control("放大").click();
    await vi.waitFor(() => expect(control("放大").disabled).toBe(true));
    expect(scale()).toBeCloseTo(4);
    for (let i = 0; i < 35; i++) control("缩小").click();
    await vi.waitFor(() => expect(control("缩小").disabled).toBe(true));
    expect(scale()).toBeCloseTo(0.2);
    control("适应视图").click();
    await vi.waitFor(() => expect(scale()).toBeLessThanOrEqual(1));
    expect(scale()).toBeGreaterThan(0.2);
    expect(dock.scrollWidth).toBeLessThanOrEqual(dock.clientWidth);
  });

  it("reflects wheel zoom and WebKit pinch gestures in the displayed percentage", async () => {
    const { host } = mount("gestures", "# One\n## Two");
    await vi.waitFor(() => expect(host.querySelector(".map-container")).not.toBeNull());
    const area = host.querySelector<HTMLElement>(".map-container")!;
    const percent = () => Number.parseInt(host.querySelector("output")!.value, 10);
    const start = percent();
    area.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -10 }));
    await vi.waitFor(() => expect(percent()).toBeGreaterThan(start));
    const beforePinch = percent();
    function gesture(name: string, scale: number) {
      const e = Object.assign(new Event(name, { bubbles: true, cancelable: true }), { scale });
      area.dispatchEvent(e);
    }
    gesture("gesturestart", 1);
    gesture("gesturechange", 1.5);
    gesture("gestureend", 1.5);
    await vi.waitFor(() => expect(percent()).toBeGreaterThan(beforePinch));
  });

  it("renames in its own split, reflects source edits and shares source undo/redo", async () => {
    const other = mount("other", "# 同名");
    const { host, view } = mount("active", "# 同名");
    const topic = () => host.querySelector<HTMLElement>('me-tpc[data-nodeid="meheading0"]')!;
    await vi.waitFor(() => expect(topic()?.textContent).toBe("同名"));
    expect(topic().getBoundingClientRect().width).toBeGreaterThan(0);
    topic().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await vi.waitFor(() => expect(host.querySelector("#input-box")).not.toBeNull());
    const input = host.querySelector<HTMLElement>("#input-box")!;
    expect(document.activeElement === input).toBe(true);
    input.textContent = "新标题";
    flushSync(() => input.blur());
    expect(view.state.doc.toString()).toBe("# 新标题");
    expect(useDocumentStore.getState().documents.active?.isDirty).toBe(true);
    expect(other.view.state.doc.toString()).toBe("# 同名");
    expect(undo(view)).toBe(true);
    await vi.waitFor(() => expect(topic().textContent).toBe("同名"));
    expect(redo(view)).toBe(true);
    await vi.waitFor(() => expect(topic().textContent).toBe("新标题"));
    view.dispatch({ changes: { from: 2, to: view.state.doc.length, insert: "From source" } });
    await vi.waitFor(() => expect(topic().textContent).toBe("From source"));
  });
  it("drags a section under another heading and undoes the complete move once", async () => {
    const source = "# A\ntext\n\n```sh\n# literal\n```\n# B\nbody";
    const { host, view } = mount("drag", source);
    const from = host.querySelector<HTMLElement>('[data-nodeid="meheading0"]')!;
    const to = host.querySelector<HTMLElement>('[data-nodeid="meheading6"]')!;
    from.dataset.testid = "drag-from";
    to.dataset.testid = "drop-into";
    const origin = page.getByTestId("drag-from");
    const target = page.getByTestId("drop-into");
    await origin.click();
    await origin.dropTo(target, { targetPosition: { x: to.offsetWidth / 2, y: to.offsetHeight * 0.7 } });
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("# B\nbody\n## A\ntext\n\n```sh\n# literal\n```"));
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it("drops the old rename field on tab switch even when both documents contain identical text", async () => {
    const { host, switchTo } = mount("first", "# Same");
    host.querySelector<HTMLElement>('[data-nodeid="meheading0"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await vi.waitFor(() => expect(host.querySelector("#input-box")).not.toBeNull());
    host.querySelector<HTMLElement>("#input-box")!.textContent = "Uncommitted";
    switchTo("second");
    expect(host.querySelector("#input-box")).toBeNull();
    expect(host.querySelector('[data-nodeid="meroot0"]')!.textContent).toBe("second.md");
    expect(useDocumentStore.getState().documents.first?.content).toBe("# Same");
    expect(useDocumentStore.getState().documents.second?.content).toBe("# Same");
  });

  it("decodes body images, focuses source from the map, and reveals a folded branch from the cursor", async () => {
    const url = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    const { host, view } = mount("image", "# Root\n## Child\n![demo](" + url + ")");
    await vi.waitFor(() => expect(host.querySelector<HTMLImageElement>("me-tpc img")?.naturalWidth).toBe(1));
    host.querySelector<HTMLElement>('[data-nodeid="meheading1"]')!.click();
    expect(view.state.selection.main.head).toBe(view.state.doc.line(2).from);
    const first = host.querySelector<HTMLElement>('[data-nodeid="meheading0"]')!;
    first.parentElement!.querySelector("me-epd")!.dispatchEvent(new PointerEvent("pointerup", {bubbles:true, button:0, pointerType:"mouse"}));
    flushSync(() => view.dispatch({ selection: { anchor: view.state.doc.line(3).from } }));
    expect(host.querySelector('[aria-current="location"] img')).not.toBeNull();
    const toolbar = host.querySelector<HTMLElement>(".stackmind__tools")!;
    expect(toolbar.textContent?.trim()).toBe("外观");
    const dock = host.querySelector<HTMLElement>(".stackmind")!;
    dock.style.cssText = "width:330px;height:280px;flex:none";
    expect(host.querySelector(".stackmind__appearance")).toBeNull();
    const appearance = toolbar.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    flushSync(() => appearance.click());
    const [layout, theme] = host.querySelectorAll<HTMLSelectElement>(".stackmind__appearance select");
    expect(layout.labels?.[0].textContent).toContain("布局");
    flushSync(() => { layout.value = "left"; layout.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(layout.value).toBe("left");
    expect(theme.options.length).toBe(3);
    layout.focus();
    flushSync(() => layout.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector(".stackmind__appearance")).toBeNull();
    expect(document.activeElement).toBe(appearance);
    flushSync(() => appearance.click());
    expect(host.querySelector<HTMLSelectElement>(".stackmind__appearance select")!.value).toBe("left");
    flushSync(() => dock.querySelector(".stackmind__canvas")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(appearance.getAttribute("aria-expanded")).toBe("false");
  });

  it("resolves a relative reference image against the Markdown file that owns it", async () => {
    mockConvertFileSrc("macos");
    const calls: string[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "plugin:path|dirname") { calls.push(String((args as { path:string }).path)); return "/notes"; }
      if (cmd === "plugin:path|join") return (args as { paths:string[] }).paths.join("/");
    });
    try {
      const { host } = mount("/notes/owner", "# A\n![Photo][p]\n\n[p]: <assets/my photo.png>");
      await vi.waitFor(() => expect(decodeURIComponent(host.querySelector<HTMLImageElement>("me-tpc img")?.src ?? "")).toContain("/notes/assets/my photo.png"));
      expect(calls).toContain("/notes/owner.md");
    } finally { clearMocks(); }
  });

  it("locates duplicate headings in both directions in a rich-text editor", async () => {
    const { host } = mount("jump", "# Same\ntext\n# Same");
    const rich = new Editor({ extensions: [StarterKit], content: "<h1>Same</h1><p>text</p><h1>Same</h1>" });
    useUIStore.getState().setSourceMode(false);
    useEditorStore.getState().setActiveWysiwygEditor(rich, "jump");
    try {
      host.querySelector<HTMLElement>('[data-nodeid="meheading2"]')!.click();
      expect(rich.state.selection.from).toBe(13);
      rich.commands.setTextSelection(1);
      const info = { sourceLine: 1, nodeType: "heading" as const, wordAtCursor:"Same", offsetInWord:0, percentInLine:0, contextBefore:"", contextAfter:"" };
      flushSync(() => useDocumentStore.getState().setCursorInfo("jump", info));
      expect(host.querySelector('[aria-current="location"]')?.getAttribute("data-nodeid")).toBe("meheading0");
    } finally { rich.destroy(); useEditorStore.getState().clearActiveEditors(); }
  });

  it("renames inline in the rich editor and participates in its undo history", async () => {
    const { host } = mount("rich", "# Old");
    const rich = new Editor({ extensions:[StarterKit], content:"<h1>Old</h1>" });
    useUIStore.getState().setSourceMode(false);
    useEditorStore.getState().setActiveWysiwygEditor(rich, "rich");
    registerWysiwygFlusher("rich", () => useDocumentStore.getState().setEditorContent("rich", "# " + rich.getText()));
    try {
      const node = host.querySelector<HTMLElement>('[data-nodeid="meheading0"]')!;
      node.dispatchEvent(new MouseEvent("dblclick", { bubbles:true }));
      await vi.waitFor(() => expect(host.querySelector("#input-box")).not.toBeNull());
      const input = host.querySelector<HTMLElement>("#input-box")!;
      input.textContent = "Changed";
      input.blur();
      expect(rich.getText().trimEnd()).toBe("Changed");
      expect(rich.commands.undo()).toBe(true);
      expect(rich.getText().trimEnd()).toBe("Old");
    } finally { registerWysiwygFlusher("rich", null); rich.destroy(); useEditorStore.getState().clearActiveEditors(); }
  });
  it("inserts and removes branches using the dock toolbar and undoes their source edits", async () => {
    const { host, view } = mount("branches", "# Parent");
    const parent = host.querySelector<HTMLElement>('[data-nodeid="meheading0"]')!;
    parent.click();
    const buttons = host.querySelectorAll<HTMLButtonElement>(".stackmind__tools button");
    buttons[0].click();
    await vi.waitFor(() => expect(host.querySelector("#input-box")).not.toBeNull());
    const input = host.querySelector<HTMLElement>("#input-box")!;
    input.textContent = "Child";
    input.blur();
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("# Parent\n## Child"));
    await vi.waitFor(() => expect(host.querySelector('[data-nodeid="meheading1"] .text')?.textContent).toBe("Child"));
    const child = host.querySelector<HTMLElement>('[data-nodeid="meheading1"]')!;
    child.click();
    buttons[1].click();
    expect(view.state.doc.toString().trimEnd()).toBe("# Parent");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("# Parent\n## Child");
  });

  it("does not expose mutations on a read-only document", () => {
    const { host } = mount("locked", "# Read only", true);
    const buttons = host.querySelectorAll<HTMLButtonElement>(".stackmind__tools button");
    expect(Array.from(buttons).map(b => b.disabled)).toEqual([true, true, false, false]);
    host.querySelector("me-tpc")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.querySelector("#input-box")).toBeNull();
  });
});
