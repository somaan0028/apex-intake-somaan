/**
 * Potential-duplicate fuzzy matching.
 *
 * A lead's identity for matching is the injured person's **name, email and
 * phone only**. Those three values are normalised and concatenated into
 * `dup_match_string`; the matcher splits that string back into its segments and
 * compares them.
 *
 * Why per-segment? A single-character difference in an email or a phone number
 * is far more significant than one in a name. Scoring the 60-character
 * concatenation as one blob lets a shared name prefix hide different contact
 * details, so each segment is scored separately and at least two must be
 * strongly similar (or the whole string must be almost identical).
 *
 * This module is pure (no database, no I/O) so the threshold can be exercised
 * by `scripts/check-dup-matching.ts`.
 */

/** Segment separator: keeps the name/email/phone boundaries recognizable. */
const SEPARATOR = "|";

/**
 * Whole-string similarity required when the segment rule does not already
 * decide the match. Overridable through `DUP_MATCH_THRESHOLD`.
 */
export const DUP_MATCH_THRESHOLD = (() => {
  const raw = Number(process.env.DUP_MATCH_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.95;
})();

/**
 * Per-segment floors. A name tolerates more variation than a contact detail:
 * `Jon` vs `John` is a typo, `…0101` vs `…0102` is a different phone number.
 */
const NAME_SIMILARITY = 0.8;
const EMAIL_SIMILARITY = 0.95;
const PHONE_SIMILARITY = 0.95;

/** Lowercase, strip accents and punctuation, collapse whitespace. */
function normalizeName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  return `${first ?? ""} ${last ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Digits only, with a leading US country code dropped (`+1 520…`). */
function normalizePhone(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

/**
 * Build the comparison string for one injured person.
 *
 * Example: `tamika brooks|tamika.brooks@example.com|9195550112`
 */
export function buildDupMatchString(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined,
  phone: string | null | undefined,
): string {
  return [
    normalizeName(firstName, lastName),
    normalizeEmail(email),
    normalizePhone(phone),
  ].join(SEPARATOR);
}

/** Split a stored match string back into its three segments. */
function segments(matchString: string): [string, string, string] {
  const [name = "", email = "", phone = ""] = matchString.split(SEPARATOR);
  return [name, email, phone];
}

/** Edit distance between two strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

/** Normalised similarity, 0 (nothing in common) to 1 (identical). */
function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const longest = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Similarity of two whole match strings. Kept as the tie-breaker for records
 * with small differences across more than one segment.
 */
export function dupMatchScore(a: string, b: string): number {
  if (!a || !b) return 0;
  return similarity(a, b);
}

/**
 * Whether two match strings describe the same potential lead.
 *
 * A match needs two strongly similar segments (name + email, name + phone, or
 * email + phone), or a whole string that is almost identical. A name-only
 * comparison is refused when both sides have no email and no phone: two
 * different people called "John Smith" must not be grouped on the name alone.
 */
export function isPotentialDuplicate(a: string, b: string): boolean {
  if (!a || !b) return false;

  const [nameA, emailA, phoneA] = segments(a);
  const [nameB, emailB, phoneB] = segments(b);

  if (!emailA && !phoneA && !emailB && !phoneB) return false;

  let strongSegments = 0;
  if (similarity(nameA, nameB) >= NAME_SIMILARITY) strongSegments++;
  if (emailA && emailB && similarity(emailA, emailB) >= EMAIL_SIMILARITY) {
    strongSegments++;
  }
  if (phoneA && phoneB && similarity(phoneA, phoneB) >= PHONE_SIMILARITY) {
    strongSegments++;
  }

  return strongSegments >= 2 || dupMatchScore(a, b) >= DUP_MATCH_THRESHOLD;
}
