import { Marked, type Tokens } from "marked";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Only http(s), mailto, relative and in-page links survive; `javascript:` and friends become "#". */
export function safeUrl(href: string | null | undefined): string {
  const h = (href ?? "").trim();
  if (/^(https?:|mailto:|\/|#|\.{0,2}\/)/i.test(h) || !/^[a-z][a-z0-9+.-]*:/i.test(h)) return h;
  return "#";
}

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // Raw HTML from agents or people is shown as text, never rendered.
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escape(text);
    },
    link({ href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      const url = safeUrl(href);
      const external = /^https?:/i.test(url);
      return `<a href="${escape(url)}"${title ? ` title="${escape(title)}"` : ""}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
    },
    image({ href, title, text }: Tokens.Image) {
      const url = safeUrl(href);
      return `<img src="${escape(url)}" alt="${escape(text)}"${title ? ` title="${escape(title)}"` : ""} loading="lazy" />`;
    },
  },
});

/** Renders untrusted Markdown to HTML that is safe to inject. */
export function renderMarkdown(src: string): string {
  return md.parse(src ?? "", { async: false }) as string;
}
