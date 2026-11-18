/**
 * Link the map to the focused document's live editing surface. Navigation
 * changes selection only. Graph edits enter the same native undo history as typing.
 * @module components/Editor/StackMind/editorLink
 */
import { EditorState, type ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isolateHistory, undo, redo } from "@codemirror/commands";
import { NodeSelection, Selection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { useEditorStore } from "@/stores/editorStore";
import { useDocumentStore, useLargeFileSessionStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { parseMarkdown } from "@/utils/markdownPipeline";
import { findClosestSourceLine } from "@/utils/cursorSync/pmHelpers";
import { flushWysiwygNow } from "@/utils/wysiwygFlush";
import type { Branch, MapModel } from "./mapEdits";

function views(id: string) {
  const a = useEditorStore.getState().active;
  const ui = useUIStore.getState();
  const raw = ui.sourceMode || ui.markdownSplitView || useLargeFileSessionStore.getState().isForcedSource(id);
  return { cm: raw && a.activeSourceTabId === id ? a.activeSourceView : null,
    pm: !raw && a.activeWysiwygTabId === id ? a.activeWysiwygEditor : null };
}

/** Rich-text headings and list items retain their structural ordinal even when a
 * live edit inserted lines above them and the initial sourceLine is outdated. */
export function richCursorLine(id: string, model: MapModel, fallback: number) {
  const pm = views(id).pm;
  if (!pm || pm.isDestroyed) return fallback;
  const selection = pm.state.selection;
  if (selection instanceof NodeSelection && typeof selection.node.attrs.sourceLine === "number") {
    return selection.node.attrs.sourceLine - 1;
  }
  const { $from } = selection;
  let kind: Branch["kind"] = "heading";
  let target = -1;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "listItem" || name === "heading") {
      kind = name === "listItem" ? "item" : "heading";
      target = $from.before(d);
      break;
    }
  }
  const name = kind === "item" ? "listItem" : "heading";
  let ordinal = -1;
  pm.state.doc.nodesBetween(0, target < 0 ? $from.pos : Math.min(target + 1, pm.state.doc.content.size), n => {
    if (n.type.name === name) ordinal++;
  });
  const candidates: Branch[] = [];
  function collect(n: Branch) {
    if (n.kind === kind) candidates.push(n);
    n.children.forEach(collect);
  }
  collect(model);
  const current = candidates[ordinal];
  if (!current) return fallback;
  return target < 0 && fallback >= current.start && fallback < current.end ? fallback : current.start;
}

export function goToMapLine(id: string, line: number, model: MapModel, branch?: Branch, image = false) {
  const { cm, pm } = views(id);
  if (cm && cm.state.doc.toString() === model.source) {
    const at = cm.state.doc.line(Math.min(line + 1, cm.state.doc.lines)).from;
    cm.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
  }
  if (!pm || pm.isDestroyed) return;
  const { state } = pm;
  let pos: number | null = null;
  // New rich-text blocks can lack sourceLine until the next parse. Map structural
  // nodes by order in that case, including duplicate heading and list labels.
  if (branch && branch.kind !== "root") {
    const name = branch.kind === "heading" ? "heading" : "listItem";
    let ordinal = 0;
    function count(n: Branch) {
      if (n.kind === branch!.kind && n.start < branch!.start) ordinal++;
      for (const c of n.children) count(c);
    }
    count(model);
    state.doc.descendants((n, p) => {
      if (pos === null && n.type.name === name && ordinal-- === 0) pos = p + 1;
    });
  }
  if (image) {
    let imageAt = -1;
    state.doc.descendants((n, at) => {
      if (imageAt < 0 && n.attrs.sourceLine === line + 1 && (n.type.name === "image" || n.type.name === "block_image")) imageAt = at;
    });
    if (imageAt >= 0) {
      pm.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, imageAt)).scrollIntoView());
      return;
    }
  }
  pos ??= findClosestSourceLine(state.doc, line + 1).pos ?? 0;
  const selection = Selection.near(state.doc.resolve(pos));
  pm.view.dispatch(state.tr.setSelection(selection).scrollIntoView());
}

export function commitMapEdit(id: string, model: MapModel, change: ChangeSpec | null) {
  if (!change) return false;
  const { cm, pm } = views(id);
  if (pm) {
    if (pm.isDestroyed || pm.view.composing) return false;
    flushWysiwygNow(id);
  }
  const doc = useDocumentStore.getState().documents[id];
  if (!doc || doc.readOnly || doc.content !== model.source) return false;
  if (cm && !cm.composing && !cm.state.readOnly && cm.state.doc.toString() === model.source) {
    cm.dispatch({ changes: change, annotations: isolateHistory.of("full"), userEvent: "input.mindmap" });
    return true;
  }
  if (!pm || pm.isDestroyed || !pm.isEditable || pm.view.composing) return false;
  const next = EditorState.create({ doc: model.source }).update({ changes: change }).newDoc.toString();
  const parsed = parseMarkdown(pm.schema, next, { preserveLineBreaks: useSettingsStore.getState().markdown.preserveLineBreaks });
  const state = pm.state;
  const from = state.doc.content.findDiffStart(parsed.content);
  const end = state.doc.content.findDiffEnd(parsed.content);
  if (from == null || !end) return true;
  const overlap = Math.max(0, from - Math.min(end.a, end.b));
  pm.view.dispatch(closeHistory(state.tr).replace(from, end.a + overlap, parsed.slice(from, end.b + overlap)));
  pm.view.dispatch(closeHistory(pm.state.tr));
  flushWysiwygNow(id);
  return true;
}

export function mapHistory(id: string, forward: boolean) {
  if (useDocumentStore.getState().documents[id]?.readOnly) return;
  const { cm, pm } = views(id);
  if (cm) (forward ? redo : undo)(cm);
  else if (pm) {
    if (forward) pm.commands.redo();
    else pm.commands.undo();
    flushWysiwygNow(id);
  }
}
