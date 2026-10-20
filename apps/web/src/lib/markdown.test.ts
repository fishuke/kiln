import { describe, expect, it } from "vitest";
import { renderMarkdown, safeUrl } from "./markdown";

describe("renderMarkdown", () => {
  it("renders GitHub-flavored Markdown", () => {
    const html = renderMarkdown("# Title\n\n- [x] done\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table>");
    expect(html).toContain('class="language-ts"');
  });

  it("escapes raw HTML and blocks script links", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nHi <img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) ![i](data:text/html,1)');
    expect(html).toContain('<a href="#">x</a>');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
  });

  it("keeps safe links and opens external ones in a new tab", () => {
    expect(renderMarkdown("[a](https://example.com)")).toContain('target="_blank"');
    expect(safeUrl("/files/runs/1/a.png")).toBe("/files/runs/1/a.png");
    expect(safeUrl("JaVaScRiPt:alert(1)")).toBe("#");
  });
});
