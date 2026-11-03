/**
 * Small, dependency-free display helpers shared by the UI.
 *
 * Formatting is pinned to an explicit locale so Server Components and the
 * browser render byte-identical strings (avoids React hydration mismatches).
 */

/** First letters of the first two words, e.g. "Dana Whitfield" -> "DW". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** A calendar date as "Mar 4, 2026"; an em dash for missing/invalid input. */
export function formatDate(
  value: Date | string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATE_FORMAT.format(date);
}
