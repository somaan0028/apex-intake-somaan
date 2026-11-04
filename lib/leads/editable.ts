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
  injuredFirstName?: string;
  injuredLastName?: string;
  injuredPhone?: string;
  injuredEmail?: string;
  /** `YYYY-MM-DD`, or an empty string to clear. */
  dateOfAccident?: string;
  state?: string;
  county?: string;
  postcode?: string;
  injuryDetails?: string;
  accidentDetails?: string;
  isAtFault?: boolean | null;
  hasAttorney?: boolean | null;
  hasReceivedSettlement?: boolean | null;
  stage?: LeadStage;
  assignedToId?: number | null;
}
