import { renderMarkdown } from "../src/markdown.js";

describe("renderMarkdown", () => {
  it("renders GitHub-flavored Markdown and removes unsafe HTML", () => {
    const html = renderMarkdown([
      "# Title",
      "",
      "- [x] done",
      "- [ ] next",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const value: string = 'ok';",
      "```",
      "",
      "<script>alert('bad')</script>",
      "[Link](https://example.com)"
    ].join("\n"));

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("type=\"checkbox\"");
    expect(html).toContain("<table>");
    expect(html).toContain("<code class=\"language-ts\">");
    expect(html).toContain("href=\"https://example.com\"");
    expect(html).not.toContain("<script>");
  });
});
