import type { ReactNode } from "react";

/**
 * A deliberately small Markdown renderer for blog posts.
 *
 * **It renders to React elements, never to an HTML string.** That is the whole security design:
 * there is no `dangerouslySetInnerHTML` anywhere below, so raw HTML in a post body — whether typed
 * by an author or left by somebody who got hold of an author's account — arrives on the page as
 * visible text rather than as markup. A renderer that produced HTML would need an allow-list and a
 * sanitiser to be safe, and would be one dependency upgrade away from not being.
 *
 * It supports what a directory's blog actually uses: headings, paragraphs, bold, italics, links,
 * bullet and numbered lists, and blockquotes. Tables, images and footnotes are not supported, and
 * an author who writes one gets their text shown literally rather than silently losing it.
 *
 * No dependency. A full Markdown library would be larger than this file by three orders of
 * magnitude and would bring the HTML-string problem back with it.
 */
export function Markdown({ source }: { source: string }) {
  return <div className="grid gap-4">{renderBlocks(source)}</div>;
}

function renderBlocks(source: string): ReactNode[] {
  // Normalise line endings first: a post pasted from Word arrives with \r\n and would otherwise
  // never match the blank-line split below.
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="text-[16px] leading-relaxed text-ink">
          {inline(paragraph.join(" "))}
        </p>,
      );
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list) {
      const className = "grid gap-1.5 pl-5 text-[16px] leading-relaxed text-ink";
      blocks.push(
        list.ordered ? (
          <ol key={`l-${blocks.length}`} className={`${className} list-decimal`}>
            {list.items.map((item, i) => (
              <li key={i}>{inline(item)}</li>
            ))}
          </ol>
        ) : (
          <ul key={`l-${blocks.length}`} className={`${className} list-disc`}>
            {list.items.map((item, i) => (
              <li key={i}>{inline(item)}</li>
            ))}
          </ul>
        ),
      );
      list = null;
    }
  };

  const flushQuote = () => {
    if (quote.length > 0) {
      blocks.push(
        <blockquote
          key={`q-${blocks.length}`}
          className="border-l-4 border-brand-200 pl-4 text-[16px] leading-relaxed text-muted italic"
        >
          {inline(quote.join(" "))}
        </blockquote>,
      );
      quote = [];
    }
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      flushAll();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushAll();
      /* h1 belongs to the page title, so a post's own headings start at h2 however many hashes
         the author typed. Written out rather than built from a variable tag name: four branches
         are clearer than one dynamic component, and the type checker can see them. */
      const level = (heading[1] ?? "#").length;
      const text = inline(heading[2] ?? "");
      const key = `h-${blocks.length}`;
      blocks.push(
        level === 1 ? (
          <h2 key={key} className="text-2xl font-black text-brand-800">
            {text}
          </h2>
        ) : level === 2 ? (
          <h3 key={key} className="text-xl font-black text-brand-800">
            {text}
          </h3>
        ) : level === 3 ? (
          <h4 key={key} className="text-lg font-black text-brand-800">
            {text}
          </h4>
        ) : (
          <h5 key={key} className="text-base font-black text-brand-800">
            {text}
          </h5>
        ),
      );
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      flushQuote();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1] ?? "");
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      flushQuote();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1] ?? "");
      continue;
    }

    const quoted = /^>\s?(.*)$/.exec(trimmed);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1] ?? "");
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }

  flushAll();
  return blocks;
}

/**
 * Bold, italics, inline code and links inside one line of text.
 *
 * Everything is returned as React nodes, so any character the author typed — including `<` — ends
 * up as text. A link's href is checked: only http and https survive, which is what stops
 * `[click](javascript:…)` becoming a working script link.
 */
function inline(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key++} className="rounded bg-brand-50 px-1.5 py-0.5 text-[14px]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const href = link?.[2]?.trim() ?? "";
      const safe = /^https?:\/\//i.test(href);
      nodes.push(
        safe ? (
          <a
            key={key++}
            href={href}
            className="font-bold text-brand-700 underline-offset-2 hover:underline"
            rel="nofollow noopener"
          >
            {label}
          </a>
        ) : (
          // Not a web link. Shown as plain text rather than dropped, so the author can see what
          // they wrote and fix it.
          <span key={key++}>{token}</span>
        ),
      );
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
