/**
 * Inline math node — the Tiptap extension that defines the `math_inline` atom
 * node, preloads KaTeX fonts, and mounts `MathInlineNodeView` for it.
 *
 * @module plugins/latex/tiptapInlineMath
 */

import { Plugin, TextSelection } from "@tiptap/pm/state";
import { MATH_BLOCK_LANGUAGE } from "@/utils/markdownPipeline/mdastBlockConverters";
import { Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { MathInlineNodeView } from "./MathInlineNodeView";
import { scheduleKatexFontPreload } from "./katexFontPreload";
import {
  createInlineMathEditingRegistry,
  type InlineMathEditingRegistry,
} from "./inlineMathEditingRegistry";
import "./latex.css";

export interface MathInlineOptions {
  /**
   * Which node is open for editing.
   *
   * Defaults to the plugin's own registry, which is fully functional — the
   * host passes its own only so the popup layer sees the same state.
   */
  editingRegistry: InlineMathEditingRegistry;
}

/**
 * Inline math extension for Tiptap.
 *
 * Uses an atom approach: math content is stored as an attribute,
 * and the node displays rendered KaTeX output.
 * Supports inline editing with floating preview.
 */
export const mathInlineExtension = Node.create<MathInlineOptions>({
  name: "math_inline",

  addOptions() {
    return { editingRegistry: createInlineMathEditingRegistry() };
  },

  addProseMirrorPlugins() {
    return [new Plugin({ props: { handleDOMEvents: { keydown(view, e) {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
      const { state } = view;
      const { $from, empty } = state.selection;
      if (!empty || $from.parent.type.name !== "paragraph" || $from.parent.textContent !== "$$" || $from.parentOffset !== 2) return false;
      const code = state.schema.nodes.codeBlock;
      if (!code) return false;
      const container = $from.node(-1);
      const index = $from.index(-1);
      const formula = code.create({ language: MATH_BLOCK_LANGUAGE });
      const start = $from.before();
      const tr = state.tr;
      let caret = start + 1;
      if (container.canReplaceWith(index, index + 1, code)) tr.replaceWith(start, $from.after(), formula);
      else if (container.type.name === "listItem" && index === 0 && container.canReplaceWith(1, 1, code)) {
        const paragraph = $from.parent.type.create();
        tr.replaceWith(start, $from.after(), [paragraph, formula]);
        caret += paragraph.nodeSize;
      } else return false;
      e.preventDefault();
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, caret)).scrollIntoView());
      return true;
    } } } })];
  },

  onCreate() {
    // Load KaTeX's fonts while this editor is still empty — see
    // katexFontPreload.ts for the full-document restyle each late face costs.
    scheduleKatexFontPreload();
  },

  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      content: {
        default: "",
        parseHTML: (element) => element.textContent || "",
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math_inline"]' }];
  },

  renderHTML({ node }) {
    return ["span", { "data-type": "math_inline", class: "math-inline" }, node.attrs.content];
  },

  addNodeView() {
    /* v8 ignore start -- @preserve reason: addNodeView factory callback only runs in live Tiptap editor; not exercised in unit tests */
    const { editingRegistry } = this.options;
    return ({ node, view, getPos }) =>
      new MathInlineNodeView(node as PMNode, view, getPos, editingRegistry);
    /* v8 ignore stop */
  },
});
