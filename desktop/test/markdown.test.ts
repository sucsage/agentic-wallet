// The AI chat renders the model's text (which may quote untrusted documents) as markdown: no HTML
// injection may get through.
import { describe, expect, test } from "bun:test";

import "../src/ui/markdown.js";

const md = (s: string) => (globalThis as unknown as { renderMarkdown: (s: string) => string }).renderMarkdown(s);
const PAYLOADS = [
  "<script>alert(1)</script>",
  '<img src=x onerror="alert(1)">',
  "<svg/onload=alert(1)>",
  '<a href="javascript:alert(1)">x</a>',
  "[click](javascript:alert(1))",
  "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  '[x](https://ok.example/"onmouseover="alert(1))',
  "`<script>alert(1)</script>`",
  "```\n</code></pre><script>alert(1)</script>\n```",
  "| a | b |\n|---|---|\n| <iframe src=//evil> | **<b onclick=x>** |",
  "> <style>*{display:none}</style>",
  "**[x](https://a.example/)<script>**",
];

describe("markdown sanitizer", () => {
  /** Every real tag in the output: only an allowlist of names; attributes only on <a>, and only safe ones. */
  const ALLOWED = new Set(["p", "br", "strong", "em", "del", "code", "pre", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "hr", "table", "thead", "tbody", "tr", "th", "td", "a"]);
  test.each(PAYLOADS)("no live HTML from %p", (p) => {
    const html = md(p);
    for (const [, close, name, attrs] of html.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g)) {
      expect(ALLOWED.has(name.toLowerCase())).toBe(true);
      if (close || name !== "a") {
        expect(attrs.trim()).toBe("");
        continue;
      }
      const a = [...attrs.matchAll(/\s([a-z-]+)="([^"]*)"/g)];
      expect(a.map(([, k]) => k)).toEqual(["href", "target", "rel"]);
      expect(a[0][2]).toMatch(/^https?:\/\//);
      expect(attrs.replace(/\s[a-z-]+="[^"]*"/g, "").trim()).toBe(""); // nothing outside the three quoted attributes
    }
  });
  test("normal markdown still renders", () => {
    const html = md("## Deal\n- **300** THB\n- `D-63`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[site](https://example.com)");
    expect(html).toContain("<h4>Deal</h4>");
    expect(html).toContain("<strong>300</strong>");
    expect(html).toContain("<code>D-63</code>");
    expect(html).toContain("<table>");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">site</a>');
  });
});
