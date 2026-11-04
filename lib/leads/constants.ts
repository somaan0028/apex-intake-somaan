/**
 * Client-safe lead constants.
 *
 * These live outside `lib/leads/queries.ts` (which imports the database) so
 * Client Components can build filter options from the same list the server
 * validates against — one source of truth for both sides.
 */

/** The campaign sources a lead can arrive from. */
export const LEAD_SOURCES = [
  "Facebook",
  "Google Ads",
  "Website",
  "Referral",
  "TikTok",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

/** Assignee filter value meaning "no one owns this lead yet". */
export const UNASSIGNED = "unassigned";

/** How the leads page is displayed. */
export type LeadsView = "table" | "kanban";

/** The starting date for the custom added-date picker: seven days ago. */
export function defaultAddedFrom(): string {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
