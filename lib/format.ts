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

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * A date and time as "Mar 4, 2026, 2:05 PM"; an em dash for missing/invalid
 * input. Used where an exact timestamp matters (the lead dialog and history).
 */
export function formatDateTime(
  value: Date | string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATE_TIME_FORMAT.format(date);
}

/**
 * Progressive US phone formatting for a field being typed or pasted:
 * `3035550168`, `303-555-0168`, `+1 303 555 0168` all become
 * `(303) 555-0168` as far as the digits go. A leading country code is dropped;
 * the server normalises the stored value with `toUsPhone`.
 */
export function formatPhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat("en-US", {
  numeric: "auto",
});

/**
 * How long ago something happened: "just now", "10 minutes ago", "2 hours
 * ago", "9 days ago", "3 months ago".
 *
 * Rendered on the server as a snapshot of the request, so it does not tick; the
 * Activity page shows exact timestamps for anything that matters.
 */
export function formatRelativeTime(
  value: Date | string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const distance = Math.abs(seconds);

  if (distance < 45) return "just now";
  if (distance < 60 * 60) {
    return RELATIVE_TIME_FORMAT.format(Math.round(seconds / 60), "minute");
  }
  if (distance < 24 * 60 * 60) {
    return RELATIVE_TIME_FORMAT.format(Math.round(seconds / 3600), "hour");
  }
  if (distance < 30 * 24 * 60 * 60) {
    return RELATIVE_TIME_FORMAT.format(Math.round(seconds / 86400), "day");
  }
  if (distance < 365 * 24 * 60 * 60) {
    return RELATIVE_TIME_FORMAT.format(
      Math.round(seconds / (30 * 86400)),
      "month",
    );
  }
  return RELATIVE_TIME_FORMAT.format(
    Math.round(seconds / (365 * 86400)),
    "year",
  );
}
