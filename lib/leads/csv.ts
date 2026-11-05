/**
 * CSV export for the leads grid.
 *
 * The route layer decides *which* rows (the same filters and visibility the
 * grid uses) and whether attribution columns are allowed; this module only
 * turns those rows into RFC 4180-ish text. Cells are always quoted, dates are
 * written as ISO/calendar values rather than the UI's "Mar 4, 2026" display
 * strings, and labels replace the enum codes so the file is readable in Excel.
 */
import {
  LEAD_STAGE_LABELS,
  caseTypeLabel,
  relationshipLabel,
  stateLabel,
} from "@/lib/labels";
import type { LeadRow } from "./queries";

/** One CSV column; `get` may return a boolean/date and is normalized below. */
interface Column {
  header: string;
  get: (row: LeadRow) => string | null | undefined;
}

/** Yes/No/Unknown for the tri-state qualifying answers. */
function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "Unknown";
  return value ? "Yes" : "No";
}

/** Calendar date in the server's local zone, matching how the UI shows it. */
function calendarDate(value: Date | null | undefined): string {
  if (!value) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Timestamp as a portable ISO 8601 string (empty when missing). */
function timestamp(value: Date | null | undefined): string {
  return value ? value.toISOString() : "";
}

/**
 * Quote a cell and neutralise spreadsheet formula injection.
 *
 * Excel and Sheets execute a cell that starts with `=`, `+`, `-` or `@`, so a
 * free-text note could become a formula. Prefixing those with an apostrophe
 * keeps the text literal; every value is quoted regardless.
 */
function cell(value: string | null | undefined): string {
  const text = value ?? "";
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Columns always exported. Attribution fields are appended separately because
 * only viewers with `leads.view.attribution` may see them.
 */
const BASE_COLUMNS: Column[] = [
  { header: "Lead ID", get: (row) => String(row.id) },
  { header: "Matter ID", get: (row) => row.matterId },
  { header: "Created", get: (row) => timestamp(row.createdAt) },
  { header: "Stage", get: (row) => LEAD_STAGE_LABELS[row.stage] },
  { header: "Case type", get: (row) => caseTypeLabel(row.caseType) },
  { header: "Assigned to", get: (row) => row.assignedToName ?? "Unassigned" },
  { header: "Injured first name", get: (row) => row.injuredFirstName },
  { header: "Injured last name", get: (row) => row.injuredLastName },
  { header: "Injured phone", get: (row) => row.injuredPhone },
  { header: "Injured email", get: (row) => row.injuredEmail },
  { header: "Accident date", get: (row) => calendarDate(row.dateOfAccident) },
  { header: "State", get: (row) => stateLabel(row.state) },
  { header: "County", get: (row) => row.county },
  { header: "ZIP code", get: (row) => row.postcode },
  { header: "Injury details", get: (row) => row.injuryDetails },
  { header: "Accident details", get: (row) => row.accidentDetails },
  { header: "Notes", get: (row) => row.notes },
  { header: "At fault", get: (row) => yesNo(row.isAtFault) },
  { header: "Has attorney", get: (row) => yesNo(row.hasAttorney) },
  {
    header: "Received settlement",
    get: (row) => yesNo(row.hasReceivedSettlement),
  },
  {
    header: "Filed for someone else",
    get: (row) => yesNo(row.isFillingForSomeoneElse),
  },
  { header: "Filler first name", get: (row) => row.fillerFirstName },
  { header: "Filler last name", get: (row) => row.fillerLastName },
  { header: "Filler phone", get: (row) => row.fillerPhone },
  { header: "Filler email", get: (row) => row.fillerEmail },
  {
    header: "Relationship to injured",
    get: (row) => relationshipLabel(row.relationshipToInjured),
  },
  {
    header: "Potential duplicate",
    get: (row) => (row.dupGroupId ? "Yes" : "No"),
  },
  { header: "Sent to firm at", get: (row) => timestamp(row.sentToFirmAt) },
  { header: "Brightwater lead ID", get: (row) => row.brightwaterLeadId },
];

/** Attribution columns, present only when the viewer may see attribution. */
const ATTRIBUTION_COLUMNS: Column[] = [
  { header: "Source", get: (row) => row.source },
  { header: "Medium", get: (row) => row.medium },
  { header: "Content", get: (row) => row.content },
  { header: "IP address", get: (row) => row.ipaddress },
  { header: "TrustedForm", get: (row) => row.trustedform },
  { header: "Jornaya", get: (row) => row.journaya },
];

/**
 * Serialize rows to CSV with a UTF-8 BOM (so Excel detects the encoding) and
 * CRLF line endings (the format's conventional line break).
 */
export function buildLeadsCsv(
  rows: LeadRow[],
  options: { includeAttribution: boolean },
): string {
  const columns = options.includeAttribution
    ? [...BASE_COLUMNS, ...ATTRIBUTION_COLUMNS]
    : BASE_COLUMNS;

  const lines: string[] = [
    columns.map((column) => cell(column.header)).join(","),
  ];
  for (const row of rows) {
    lines.push(columns.map((column) => cell(column.get(row))).join(","));
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
