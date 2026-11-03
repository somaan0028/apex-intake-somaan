/**
 * Dependency-free input validators shared by the intake form (client) and the
 * public submission endpoint (server). Kept separate from `lib/db/normalize` so
 * importing them never pulls database code into the browser bundle.
 */

/** Pragmatic email check — good enough for intake, not a full RFC parser. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** US phone: exactly 10 digits once non-digits are stripped. */
export function isValidPhone(value: string): boolean {
  return value.replace(/\D/g, "").length === 10;
}

/**
 * Canonicalise a US ZIP: accepts `12345`, `123456789` and `12345-6789`, and
 * returns `12345` or `12345-6789`. Anything else → `null`.
 */
export function normalizePostcode(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{5}$/.test(trimmed)) return trimmed;
  if (/^\d{9}$/.test(trimmed)) {
    return `${trimmed.slice(0, 5)}-${trimmed.slice(5)}`;
  }
  if (/^\d{5}-\d{4}$/.test(trimmed)) return trimmed;
  return null;
}
