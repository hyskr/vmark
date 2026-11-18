// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { buildMap, moveBranch, renameNode, insertChild } from "./mapEdits";

const edit = (source: string, changes: ReturnType<typeof moveBranch>) =>
  EditorState.create({ doc: source }).update({ changes: changes ?? [] }).state.doc.toString();

describe("StackMind source edits", () => {
  it("keeps heading, list and body images with their own branch, including references", () => {
    const map = buildMap("# Section ![logo](logo.png)\n![body][fig]\n- ![item](a.png)\n\n[fig]: <assets/a b.png>\n\n```md\n![none](x.png)\n```", "Doc");
    const heading = map.children[0];
    expect(heading.images.map(i => i.url)).toEqual(["logo.png", "assets/a b.png"]);
    expect(heading.children[0].images.map(i => i.url)).toEqual(["a.png"]);
  });
  it("moves a whole chapter and shifts only actual headings", () => {
    const source = "---\ntitle: 本\n---\n# A\n## B\ntext\n\n| x |\n|---|\n| 1 |\n\n```sh\n# literal\n```\n### 子\n正文\n# C\nend";
    const map = buildMap(source, "Doc");
    const [a, c] = map.children;
    const b = a.children[0];
    expect(edit(source, moveBranch(map, b, c, "in"))).toBe(
      source.replace("# A\n## B", "# A\n# C\nend\n## B").replace("正文\n# C\nend", "正文"),
    );
    expect(edit(source, moveBranch(map, a, c, "in"))).toContain("### B\ntext\n\n| x |\n|---|\n| 1 |\n\n```sh\n# literal\n```\n#### 子");
    expect(moveBranch(map, a, b, "in")).toBeNull();
  });
  it("renames only the inline source, retaining checkbox, markup and continuation", () => {
    const source = "# A\n- [x] **旧**\n  next\n  - 子\n";
    const map = buildMap(source, "Doc");
    const item = map.children[0].children[0];
    expect(item.topic).toBe("**旧**");
    expect(edit(source, renameNode(item, "**新**"))).toBe(source.replace("旧", "新"));
  });
  it("adds the first heading after frontmatter and moves a list item with its children", () => {
    const yaml = "---\ntitle: A\n---\n";
    const root = buildMap(yaml, "Doc");
    expect(edit(yaml, insertChild(root, root, "标题"))).toBe(yaml + "# 标题\n");
    const source = "- a\n  - b\n- c";
    const map = buildMap(source, "Doc");
    expect(edit(source, moveBranch(map, map.children[0], map.children[1], "in"))).toBe("- c\n  - a\n    - b");
  });
  it("attaches a list to its destination heading before that heading's subsections", () => {
    const source = "# A\n## Sub\nbody\n# B\n- task";
    const map = buildMap(source, "Doc");
    const [a, b] = map.children;
    expect(edit(source, moveBranch(map, b.children[0], a, "in"))).toBe("# A\n- task\n## Sub\nbody\n# B");
  });
  it("keeps empty sources, closing hashes and code-block contents intact", () => {
    const source = "# 旧 #\n```md\n# no\n```";
    const map = buildMap(source, "Doc");
    expect(map.children).toHaveLength(1);
    expect(edit(source, renameNode(map.children[0], "新"))).toBe(source.replace("旧", "新"));
    const empty = buildMap("", "Doc");
    expect(edit("", insertChild(empty, empty, "x"))).toBe("# x");
  });
});

describe("body block projection and edits", () => {
  it("moves a list continuation into another heading with its code indentation intact", async () => {
    const { moveBody } = await import("./mapEdits");
    const source = "# A\n- item\n\n  ```js\n  const x = 2\n  ```\n\n# B\ntext";
    const map = buildMap(source, "Doc");
    const item = map.children[0].children[0];
    const body = item.blocks[0];
    const moved = edit(source, moveBody(map, body, map.children[1], undefined, "in"));
    const next = buildMap(moved, "Doc");
    expect(next.children[0].children[0].blocks).toEqual([]);
    expect(next.children[1].blocks.map(b => b.part.type)).toEqual(["paragraph", "code"]);
    expect(next.children[1].blocks[1].part.value).toBe("const x = 2");
  });
  it("retains closing hashes when renaming a heading made entirely from marked text", () => {
    const source = "## ==Before== ##\nBody";
    const map = buildMap(source, "Doc");
    expect(edit(source, renameNode(map.children[0], "After"))).toBe("## After ##\nBody");
  });
});
