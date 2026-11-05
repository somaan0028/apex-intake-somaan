/**
 * Verify the potential-duplicate similarity threshold.
 *
 * The four pairs below are the known duplicates in the bundled CSV export
 * (same person, different formatting or a different email). The negative cases
 * are same-name records that must not be grouped, plus two name-only records
 * with no contact details.
 *
 *   npm run leads:check
 *
 * Adjust `DUP_MATCH_THRESHOLD` if the seeded pairs stop passing.
 */
import {
  DUP_MATCH_THRESHOLD,
  buildDupMatchString,
  dupMatchScore,
  isPotentialDuplicate,
} from "../lib/leads/dup-matcher";

const identity = (
  first: string,
  last: string,
  email: string,
  phone: string,
) => buildDupMatchString(first, last, email, phone);

const cases: Array<{
  label: string;
  a: string;
  b: string;
  expected: boolean;
}> = [
  {
    label: "Tamika Brooks (email case, phone formatting)",
    a: identity(
      "Tamika",
      "Brooks",
      "tamika.brooks@example.com",
      "(919) 555-0112",
    ),
    b: identity("Tamika", "Brooks", "Tamika.Brooks@example.com", "9195550112"),
    expected: true,
  },
  {
    label: "Luis Ortega (name case, +1 phone)",
    a: identity("Luis", "Ortega", "luis.ortega@example.net", "5205550192"),
    b: identity("luis", "ortega ", "luis.ortega@example.net", "+1 520 555 0192"),
    expected: true,
  },
  {
    label: "Terrence Holloway (identical contact details)",
    a: identity(
      "Terrence",
      "Holloway",
      "terrence_holloway@example.com",
      "404-555-0106",
    ),
    b: identity(
      "Terrence",
      "Holloway",
      "terrence_holloway@example.com",
      "404.555.0106",
    ),
    expected: true,
  },
  {
    label: "Brianna Kowalski (different email, same name and phone)",
    a: identity(
      "Brianna",
      "Kowalski",
      "brianna25@example.com",
      "(708) 555-0197",
    ),
    b: identity(
      "Brianna",
      "Kowalski",
      "brianna92@example.org",
      "7085550197",
    ),
    expected: true,
  },
  {
    label: "Two different John Smiths (different contacts)",
    a: identity("John", "Smith", "john.smith.one@example.com", "3035550101"),
    b: identity("John", "Smith", "john.smith.two@example.com", "3035550102"),
    expected: false,
  },
  {
    label: "Family sharing a phone, different names",
    a: identity("Jane", "Doe", "jane@example.com", "3035550103"),
    b: identity("John", "Doe", "john@example.com", "3035550103"),
    expected: false,
  },
  {
    label: "Same name only, no email or phone",
    a: identity("John", "Smith", "", ""),
    b: identity("John", "Smith", "", ""),
    expected: false,
  },
];

let failures = 0;

console.log(`[dup] Threshold: ${DUP_MATCH_THRESHOLD}`);

for (const testCase of cases) {
  const score = dupMatchScore(testCase.a, testCase.b);
  const actual = isPotentialDuplicate(testCase.a, testCase.b);
  const ok = actual === testCase.expected;
  if (!ok) failures++;

  console.log(
    `${ok ? "PASS" : "FAIL"}  ${score.toFixed(3)}  ${testCase.label} ` +
      `(expected ${testCase.expected ? "match" : "no match"})`,
  );
}

if (failures > 0) {
  console.error(`[dup] ${failures} case(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("[dup] All similarity cases passed.");
}
