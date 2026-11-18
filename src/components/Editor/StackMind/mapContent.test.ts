// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderPart } from "./mapContent";
import { buildMap } from "./mapEdits";
import { projectMap } from "./mapProjection";

describe("Markdown map presentation", () => {
  it("keeps raw topics separate from rich labels and source ranges", () => {
    const source = "# **H**\n\nA ==marked== and `literal` paragraph.\n\n- [x] Task\n  - Nested\n\n> quote";
    const model = buildMap(source, "Document");
    const { entries, data, labels } = projectMap(model, 3, new Map(), new Set(["heading0**H**"]));
    const heading = data.nodeData.children![0];
    expect(heading.topic).toBe("**H**");
    expect(heading.expanded).toBe(false);
    expect(labels.get(heading.id)).toContain("<strong>H</strong>");
    const para = model.children[0].blocks[0];
    expect(entries.get(para.id)?.line).toBe(2);
    expect(labels.get(para.id)).toContain("<mark>marked</mark>");
    expect(labels.get(para.id)).toContain("<code>literal</code>");
    expect(source.slice(para.from, para.to)).toBe("A ==marked== and `literal` paragraph.");
  });
  it("renders semantic table headers, aligned cells, code and untrusted text", () => {
    const source = "| Rank | Cost |\n| --- | ---: |\n| 1 | 2 |\n\n```js\nconst x = '<unsafe>';\n```";
    const model = buildMap(source, "Document");
    const table = renderPart(model.blocks[0].part, source);
    expect(table).toContain("<thead>");
    expect(table).toContain('<td style="text-align:right">2</td>');
    const code = renderPart(model.blocks[1].part, source);
    expect(code).toContain("hljs-keyword");
    expect(code).not.toContain("<unsafe>");
  });
  it("preserves unknown blocks as their original source and renders invalid math visibly", () => {
    expect(renderPart({ type:"extension", position:{start:{line:1,offset:0},end:{line:1,offset:3}} }, "<x>")).toBe("&lt;x&gt;");
    expect(renderPart({type:"inlineMath",value:"\\notACommand"}, "")).toContain("notACommand");
  });
});
