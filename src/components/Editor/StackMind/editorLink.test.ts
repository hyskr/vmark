import { afterEach, describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { useEditorStore } from "@/stores/editorStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { registerWysiwygFlusher } from "@/utils/wysiwygFlush";
import { buildMap, renameNode } from "./mapEdits";
import { commitMapEdit, goToMapLine, mapHistory, richCursorLine } from "./editorLink";

const id = "map-history";
const text = "# First\n\nBody\n\n# First";
let raw: EditorView | undefined;
let rich: Editor | undefined;
afterEach(() => {
  useEditorStore.getState().clearActiveEditors();
  registerWysiwygFlusher(id, null);
  raw?.destroy();
  rich?.destroy();
  raw = undefined;
  rich = undefined;
});

function source(readOnly = false) {
  const store = useDocumentStore.getState();
  store.initDocument(id, text);
  store.setReadOnly(id, readOnly);
  useUIStore.getState().setSourceMode(true);
  raw = new EditorView({ state: EditorState.create({ doc:text, extensions:[history(), EditorState.readOnly.of(readOnly),
    EditorView.updateListener.of(u => { if (u.docChanged) store.setEditorContent(id, u.state.doc.toString()); })] }) });
  useEditorStore.getState().setActiveSourceView(raw, id);
  return buildMap(text, "Document");
}

describe("map editing and navigation boundaries", () => {
  it("locates a repeated heading, applies an isolated edit and uses the registered source history", () => {
    const model = source();
    const h = model.children[1];
    goToMapLine(id, h.start, model, h);
    expect(raw!.state.selection.main.head).toBe(raw!.state.doc.line(5).from);
    expect(commitMapEdit(id, model, renameNode(h, "Second"))).toBe(true);
    expect(raw!.state.doc.toString()).toBe(text.replace(/First$/, "Second"));
    expect(commitMapEdit(id, model, renameNode(h, "Stale"))).toBe(false);
    mapHistory(id, false);
    expect(raw!.state.doc.toString()).toBe(text);
    mapHistory(id, true);
    expect(raw!.state.doc.toString()).toContain("Second");
  });
  it("preserves read-only text and refuses a stale view belonging to another tab", () => {
    const model = source(true);
    expect(commitMapEdit(id, model, renameNode(model.children[0], "X"))).toBe(false);
    mapHistory(id, false);
    useDocumentStore.getState().setReadOnly(id, false);
    useEditorStore.getState().setActiveSourceView(raw!, "other");
    expect(commitMapEdit(id, model, { from:0, insert:"X" })).toBe(false);
    expect(commitMapEdit(id, model, null)).toBe(false);
    expect(richCursorLine(id, model, 4)).toBe(4);
  });
  it("uses structure for rich-text navigation and preserves rich editor undo/redo", () => {
    const store = useDocumentStore.getState();
    store.initDocument(id, text);
    store.setReadOnly(id, false);
    useUIStore.getState().setSourceMode(false);
    rich = new Editor({ extensions:[StarterKit], content:"<h1>First</h1><p>Body</p><h1>First</h1>" });
    useEditorStore.getState().setActiveWysiwygEditor(rich, id);
    registerWysiwygFlusher(id, () => {});
    const model = buildMap(text,"Document");
    const h = model.children[1];
    goToMapLine(id, h.start, model, h);
    expect(richCursorLine(id,model,0)).toBe(h.start);
    expect(commitMapEdit(id,model,renameNode(h,"Second"))).toBe(true);
    expect(rich.getText()).toContain("Second");
    mapHistory(id,false);
    expect(rich.getText()).not.toContain("Second");
    mapHistory(id,true);
    expect(rich.getText()).toContain("Second");
  });
});
