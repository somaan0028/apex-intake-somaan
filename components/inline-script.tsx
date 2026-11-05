"use client";

/**
 * An inline script that runs during HTML parsing, before the first paint.
 *
 * A plain `<script>` rendered inside a React tree only executes when the server
 * sends it as part of the document. On a client-side render (login → dashboard)
 * React has no way to run it and logs "Encountered a script tag while rendering
 * React component". This wrapper keeps both behaviours honest: the server
 * renders a real `text/javascript` script, while after hydration the same
 * element is inert (`text/plain`), so React never warns and never pretends to
 * execute it. Anything that must happen on a soft navigation belongs in a
 * client component's layout effect instead (see `ThemeScope`).
 *
 * See the Next.js guide "Preventing flash before hydration".
 */
export function InlineScript({ id, html }: { id?: string; html: string }) {
  return (
    <script
      id={id}
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      // The server renders `text/javascript`; hydration sees `text/plain`.
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
