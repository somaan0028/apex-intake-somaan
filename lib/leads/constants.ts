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

/**
 * Why a duplicate grouping cannot be dismissed by someone who cannot see every
 * member. Shared by the service (the refusal) and the dialog (the toast), so the
 * two cannot drift apart.
 */
export const DUPLICATE_GROUP_HIDDEN_MESSAGE =
  "You don't have access to some of the potentially similar leads. Please contact an Admin.";

/**
 * Campaign selector on the Analytics page. `OTHER` is the same bucket the lead
 * grid uses: every stored case type that is not MVA or Mass Tort, including raw
 * ad-campaign values. `all` means no campaign filter.
 */
export const CAMPAIGN_FILTER_OPTIONS = [
  { value: "all", label: "All campaigns" },
  { value: "MVA", label: "MVA" },
  { value: "MASS_TORT", label: "Mass Tort" },
  { value: "OTHER", label: "Other" },
] as const;

export type CampaignFilterValue =
  (typeof CAMPAIGN_FILTER_OPTIONS)[number]["value"];

/** How the leads page is displayed. */
export type LeadsView = "table" | "kanban";

/** The starting date for the custom added-date picker: seven days ago. */
export function defaultAddedFrom(): string {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
