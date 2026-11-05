/**
 * The lead fields the detail dialog may edit, in the raw shape the client sends.
 *
 * The Server Action canonicalises these values (phone, state, county, ZIP and
 * date) before they reach the database. Everything else on a lead is read-only
 * in the UI: the Lawmatics id, the attribution fields, and the Brightwater
 * submission state are owned by the systems that produced them.
 */
import type { LeadStage } from "@/lib/db/schema";

export interface LeadFieldPatch {
  /** Canonical case type, or an empty string to clear. */
  caseType?: string;
  injuredFirstName?: string;
  injuredLastName?: string;
  injuredPhone?: string;
  injuredEmail?: string;
  /** The person who submitted the form, on an on-behalf lead. */
  fillerFirstName?: string;
  fillerLastName?: string;
  fillerPhone?: string;
  fillerEmail?: string;
  relationshipToInjured?: string;
  /** `YYYY-MM-DD`, or an empty string to clear. */
  dateOfAccident?: string;
  state?: string;
  county?: string;
  postcode?: string;
  injuryDetails?: string;
  accidentDetails?: string;
  /** Free-form internal notes for the intake team. */
  notes?: string;
  isAtFault?: boolean | null;
  hasAttorney?: boolean | null;
  hasReceivedSettlement?: boolean | null;
  stage?: LeadStage;
  assignedToId?: number | null;
}
