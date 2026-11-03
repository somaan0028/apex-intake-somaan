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

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  MVA: "MVA",
  MASS_TORT: "Mass Tort",
  OTHER: "Other",
};

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
