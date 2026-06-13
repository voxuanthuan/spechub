import DOMPurify from "dompurify";
import { marked, type MarkedOptions } from "marked";

export const markedOptions: MarkedOptions = {
  gfm: true,
  breaks: false
};

export function sanitizeMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown, markedOptions) as string;
  return DOMPurify.sanitize(rendered, {
    ADD_ATTR: ["checked", "target"],
    ADD_TAGS: ["input"]
  }) as unknown as string;
}
