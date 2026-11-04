/**
 * Human-friendly labels for the enums we store as canonical codes.
 *
 * Storage stays machine-friendly (`MASS_TORT`, `SENT_TO_FIRM`); the UI reads
 * these maps instead of printing raw values:
 *
 *     import { LEAD_STAGE_LABELS } from "@/lib/labels";
 *     <Badge>{LEAD_STAGE_LABELS[lead.stage]}</Badge>
 *
 * The `Record<Enum, string>` shape makes a new enum member a compile error until
 * it has a label, so the two can't drift. Imports are type-only, so this module
 * stays safe to use from Client Components.
 */
import type {
  CaseType,
  LeadStage,
  Relationship,
  UserRole,
} from "@/lib/db/schema";
import { US_STATES } from "@/lib/us-states";

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  MVA: "MVA",
  MASS_TORT: "Mass Tort",
  OTHER: "Other",
};

/**
 * Label for a stored case type.
 *
 * `case_type` normally holds one of the codes above, but an unrecognised ad
 * campaign is stored verbatim, so fall back to a readable form of the raw value
 * ("workers_comp" → "Workers comp").
 */
export function caseTypeLabel(value: string | null | undefined): string {
  if (!value) return "";
  const known = CASE_TYPE_LABELS[value as CaseType];
  if (known) return known;
  const words = value.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Label for a stored state code. The full name is shown alongside the code
 * ("Colorado (CO)") so the two-letter abbreviations are never ambiguous; an
 * unrecognised value is returned unchanged.
 */
export function stateLabel(value: string | null | undefined): string {
  if (!value) return "";
  const state = US_STATES.find(
    (entry) => entry.code === value.trim().toUpperCase(),
  );
  return state ? `${state.name} (${state.code})` : value;
}

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  RETAINED: "Retained",
  SENT_TO_FIRM: "Sent to Firm",
  DISQUALIFIED: "Disqualified",
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  USER: "User",
};

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  SPOUSE: "Spouse or partner",
  PARENT: "Parent",
  STEP_PARENT: "Step parent",
  CHILD: "Child",
  STEP_CHILD: "Step child",
  SIBLING: "Sibling",
  GRANDPARENT: "Grandparent",
  GRANDCHILD: "Grandchild",
  AUNT_UNCLE: "Aunt or uncle",
  NIECE: "Niece",
  NEPHEW: "Nephew",
  COUSIN: "Cousin",
  IN_LAW: "In-law",
  FRIEND: "Friend",
  COLLEAGUE: "Colleague",
  NEIGHBOR: "Neighbor",
  OTHER: "Other",
};

/** Label for a stored relationship code (falls back to the raw value). */
export function relationshipLabel(value: string | null | undefined): string {
  if (!value) return "";
  return RELATIONSHIP_LABELS[value as Relationship] ?? value;
}

/**
 * Label for a person in an assignee dropdown.
 *
 * The signed-in user's own name is marked, so "Maria Delgado" reads as
 * "(You) Maria Delgado" wherever they could pick themselves.
 */
export function assigneeLabel(
  assignee: { id: number; name: string },
  viewerId: number,
): string {
  return assignee.id === viewerId ? `${assignee.name} (You)` : assignee.name;
}
