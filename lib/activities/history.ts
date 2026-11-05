/**
 * Shared shapes for the lead-detail history dialogs.
 *
 * Kept outside the `"use server"` module because that file may only export
 * async functions; a runtime constant there breaks the action loader.
 */

/** Activity types the lead detail dialog can show history for. */
export const LEAD_HISTORY_TYPES = [
  "lead:stage_update",
  "lead:send_to_firm",
] as const;
export type LeadHistoryType = (typeof LEAD_HISTORY_TYPES)[number];

/** One history row inside the lead detail dialog. */
export interface LeadHistoryRow {
  id: number;
  description: string;
  /** The doer's current name, or "Deleted user". */
  doerName: string;
  doerId: number;
  /** The doer's stored photo, or `null` for initials. */
  doerAvatarPath: string | null;
  createdAt: Date;
}
