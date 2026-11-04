"use client";

/**
 * Renders an assistant reply as Markdown.
 *
 * The model writes Markdown (`**bold**`, bullet lists, `code`), so the reply is
 * rendered rather than shown as source text. Only assistant messages go through
 * here — a user's own words are shown as typed.
 *
 * Raw HTML is not enabled, so a reply cannot inject markup.
 */
import { createElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Props react-markdown hands each element: DOM props plus its AST node. */
type ElementProps = Record<string, unknown>;

/** Build a styled renderer for one Markdown element. */
function element(tag: keyof React.JSX.IntrinsicElements, className: string) {
  return function MarkdownElement(props: ElementProps) {
    // `node` is react-markdown's AST, not a DOM prop — never forward it.
    const { node, children, ...rest } = props;
    void node;
    return createElement(tag, { className, ...rest }, children as ReactNode);
  };
}

const COMPONENTS = {
  p: element("p", "leading-relaxed [&:not(:first-child)]:mt-2"),
  strong: element("strong", "font-semibold"),
  em: element("em", "italic"),
  a: element("a", "font-medium underline underline-offset-2"),
  ul: element("ul", "my-2 grid list-disc gap-1 pl-5"),
  ol: element("ol", "my-2 grid list-decimal gap-1 pl-5"),
  li: element("li", "leading-relaxed"),
  h1: element("h1", "mt-3 mb-1 text-base font-semibold first:mt-0"),
  h2: element("h2", "mt-3 mb-1 text-sm font-semibold first:mt-0"),
  h3: element("h3", "mt-2 mb-1 text-sm font-semibold first:mt-0"),
  blockquote: element(
    "blockquote",
    "border-l-2 border-border pl-3 text-muted-foreground italic",
  ),
  hr: element("hr", "my-3 border-border"),
  code: element(
    "code",
    "rounded bg-background/70 px-1 py-0.5 font-mono text-[0.8em]",
  ),
  pre: element(
    "pre",
    "my-2 overflow-x-auto rounded-lg bg-background/70 p-2 text-xs [&>code]:bg-transparent [&>code]:p-0",
  ),
  table: element("table", "my-2 w-full border-collapse text-xs"),
  th: element(
    "th",
    "border border-border px-2 py-1 text-left font-semibold",
  ),
  td: element("td", "border border-border px-2 py-1"),
} as unknown as Components;

export function Markdown({ content }: { content: string }) {
  return (
    <div className="text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
