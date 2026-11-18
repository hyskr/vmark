import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import StackMindPane from "./StackMindPane";

const id = "dock-test";
let source: EditorView;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches:false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
function mount(text: string, locked = false) {
  const store = useDocumentStore.getState();
  store.initDocument(id, text, "/notes/example.md");
  store.setReadOnly(id, locked);
  useUIStore.getState().setSourceMode(true);
  source = new EditorView({ state: EditorState.create({ doc:text, extensions:[
    history(), EditorView.updateListener.of(u => { if (u.docChanged) store.setEditorContent(id, u.state.doc.toString()); }),
  ] }) });
  useEditorStore.getState().setActiveSourceView(source, id);
  return render(<StackMindPane tabId={id} />);
}
afterEach(() => { source?.destroy(); useEditorStore.getState().clearActiveEditors(); vi.unstubAllGlobals(); });

describe("document map controls", () => {
  it("navigates and deletes only the selected body block, then undoes in the source", async () => {
    const {container} = mount("# One\n\nParagraph.\n\n## Two");
    const node = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('me-tpc[data-nodeid="meblock7"]');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(node);
    expect(source.state.selection.main.head).toBe(7);
    fireEvent.click(container.querySelectorAll(".stackmind__tools button")[1]);
    expect(source.state.doc.toString()).not.toContain("Paragraph.");
    expect(source.state.doc.toString()).toContain("## Two");
    fireEvent.keyDown(container.querySelector(".map-container")!, { key:"z", ctrlKey:true });
    expect(source.state.doc.toString()).toContain("Paragraph.");
    fireEvent.keyDown(container.querySelector(".map-container")!, { key:"z", metaKey:true, shiftKey:true });
    expect(source.state.doc.toString()).not.toContain("Paragraph.");
  });
  it("shows read-only rich content and changes its layout and theme without changing the file", async () => {
    const text = "# Title\n\nA ==mark==.\n\n```js\nconst n = 3;\n```";
    const {container} = mount(text, true);
    await waitFor(() => expect(container.querySelector("mark")?.textContent).toBe("mark"));
    const tools = container.querySelectorAll<HTMLButtonElement>(".stackmind__tools button");
    expect(tools[0].disabled).toBe(true);
    expect(tools[1].disabled).toBe(true);
    fireEvent.click(tools[2]);
    const [layout,theme] = container.querySelectorAll("select");
    fireEvent.change(layout, { target:{value:"left"} });
    fireEvent.change(layout, { target:{value:"both"} });
    fireEvent.change(theme, { target:{value:"dark"} });
    fireEvent.change(theme, { target:{value:"light"} });
    expect(source.state.doc.toString()).toBe(text);
    fireEvent.keyDown(layout,{key:"Escape"});
    expect(container.querySelector(".stackmind__appearance")).toBeNull();
    act(() => useDocumentStore.getState().setCursorInfo(id, { sourceLine: 5, nodeType:"code_block", wordAtCursor:"", offsetInWord:0, percentInLine:0, contextBefore:"", contextAfter:"" }));
    expect(container.querySelector('[aria-current="location"] pre')).not.toBeNull();
  });
});
