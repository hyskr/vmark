import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { Editor } from "@tiptap/core";
import { createTiptapExtensions } from "@/services/assembly/createTiptapExtensions";
import { serializeMarkdown } from "@/utils/markdownPipeline/adapter";

let host: HTMLElement;
let editor: Editor;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  editor = new Editor({element: host, extensions: createTiptapExtensions()});
  editor.view.focus();
});
afterEach(() => { editor.destroy(); host.remove(); });

describe("typing Markdown in WebKit", () => {
  it.each(["## ", "== "])("turns %s into H2 and keeps a literal backtick inside double delimiters", async prefix => {
    await userEvent.keyboard(prefix + "``a`b``");
    const node = editor.state.doc.firstChild!;
    expect(node.type.name).toBe("heading");
    expect(node.attrs.level).toBe(2);
    expect(node.firstChild?.textContent).toBe("a`b");
    expect(node.firstChild?.marks.some(m => m.type.name === "code")).toBe(true);
  });

  it("types display math in a list and serializes a nested math fence", async () => {
    await userEvent.keyboard("- First{Enter}$$");
    await userEvent.keyboard("{Enter}x^2");
    const item = editor.state.doc.firstChild!.lastChild!;
    expect(item.type.name).toBe("listItem");
    expect(item.lastChild?.attrs.language).toBe("$$math$$");
    expect(serializeMarkdown(editor.schema, editor.state.doc)).toContain("x^2");
  });
});
