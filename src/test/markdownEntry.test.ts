import { describe, expect, it } from "vitest";
import { withTypingSession } from "./typingHarness";

describe("rich editor Markdown entry", () => {
  it.each([["= ", 1], ["== ", 2], ["## ", 2]] as const)("converts %s at the start of a paragraph", (prefix, level) => {
    withTypingSession({ markdown: "" }, s => {
      s.type(prefix + "Title");
      expect(s.editor.state.doc.firstChild?.type.name).toBe("heading");
      expect(s.editor.state.doc.firstChild?.attrs.level).toBe(level);
      expect(s.editor.state.doc.firstChild?.textContent).toBe("Title");
    });
  });
  it("saves unpaired equals in plain text without introducing a backslash", () => {
    withTypingSession({ markdown: "" }, s => {
      s.type("==");
      expect(s.markdown().trimEnd()).toBe("==");
    });
  });
  it("accepts a double-backtick code span inside a heading", () => {
    withTypingSession({ markdown: "" }, s => {
      s.type("## ``a`b`` ");
      const heading = s.editor.state.doc.firstChild!;
      expect(heading.type.name).toBe("heading");
      expect(heading.firstChild?.textContent).toBe("a`b");
      expect(heading.firstChild?.marks.some(m => m.type.name === "code")).toBe(true);
    });
  });
  it("starts display math on a new list item and retains the surrounding list", () => {
    withTypingSession({ markdown: "- First" }, s => {
      s.setCursor(8);
      s.press("Enter");
      s.type("$$");
      s.press("Enter");
      s.type("x^2");
      const item = s.editor.state.doc.firstChild!.lastChild!;
      expect(item.type.name).toBe("listItem");
      expect(item.lastChild?.attrs.language).toBe("$$math$$");
      expect(item.lastChild?.textContent).toBe("x^2");
    });
  });
});
