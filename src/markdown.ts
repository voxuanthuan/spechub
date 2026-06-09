import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

marked.use({
  gfm: true,
  breaks: false
});

export function renderMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false }) as string;

  return sanitizeHtml(rendered, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "h1",
      "h2",
      "img",
      "input",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td"
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      code: ["class"],
      img: ["src", "alt", "title"],
      input: ["type", "checked", "disabled"]
    },
    allowedSchemes: ["http", "https", "mailto", "data"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noreferrer"
      })
    }
  });
}
