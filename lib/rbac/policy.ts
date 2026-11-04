/**
 * Resource-aware RBAC policies.
 *
 * `./permissions` answers "what may this role do in general"; these functions
 * answer "may this actor do X to *this* record", combining a capability with the
 * record's attributes (owner, stage, case type).
 *
 * They are pure and client-safe, so the UI hides controls and the server
 * enforces with one rule set. On the server, always pass the row freshly read
 * from the database for this request — never a payload echoed back from the
 * client, or a caller could claim ownership they don't have.
 */
import type { LeadStage, UserRole } from "@/lib/db/schema";
import { can, type Actor } from "./permissions";

/**
 * The lead facts the policies read. A full `Lead` row satisfies this; a grid row
 * does too, as long as it carries these fields.
 */
export interface LeadSubject {
  assignedToId: number | null;
  caseType: string | null;
  sentToFirmAt: Date | null;
  /** Set once Brightwater has accepted the lead; a second signal of "already sent". */
  brightwaterLeadId: string | null;
}

/** The stage that is gated behind `leads.send_to_firm`. */
const SENT_STAGE: LeadStage = "SENT_TO_FIRM";

/** The stage a lead must reach before it may be sent to the partner firm. */
export const SEND_READY_STAGE: LeadStage = "RETAINED";

/** May `actor` see `lead`? */
export function canViewLead(actor: Actor, lead: LeadSubject): boolean {
  if (can(actor.role, "leads.view.all")) return true;
  if (lead.assignedToId === null) {
    return can(actor.role, "leads.view.unassigned");
  }
  return (
    lead.assignedToId === actor.id && can(actor.role, "leads.view.assigned")
  );
}

/** May `actor` edit `lead`'s fields? */
export function canEditLead(actor: Actor, lead: LeadSubject): boolean {
  if (can(actor.role, "leads.edit.any")) return true;
  return lead.assignedToId === actor.id && can(actor.role, "leads.edit.own");
}

/**
 * May `actor` move `lead` to stage `to`?
 *
 * The "up to Retained" cap is expressed as a capability, not a hard-coded stage
 * list: an actor without `leads.send_to_firm` cannot set the sent stage. Editing
 * rights come first, so an agent cannot touch an unassigned lead even if the
 * target stage would otherwise be allowed — they must claim it first.
 *
 * The capability only decides who may *try* to set `SENT_TO_FIRM`. The service
 * additionally refuses that stage until a firm submission has actually been
 * recorded, so the UI can show the server's explanation instead of silently
 * hiding the option.
 */
export function canChangeLeadStage(
  actor: Actor,
  lead: LeadSubject,
  to: LeadStage,
): boolean {
  if (!canEditLead(actor, lead)) return false;
  if (to === SENT_STAGE) return can(actor.role, "leads.send_to_firm");
  return true;
}

/**
 * May `actor` set `lead`'s assignee to `targetUserId` (`null` = unassigned)?
 *
 * Admins assign anyone to anyone. An agent manages only their *own* assignment:
 * they can claim an unassigned lead for themselves, or release a lead they own
 * back to the pool.
 */
export function canAssignLead(
  actor: Actor,
  lead: LeadSubject,
  targetUserId: number | null,
): boolean {
  if (can(actor.role, "leads.assign.any")) return true;

  // Claim: take an unassigned lead for yourself.
  if (
    can(actor.role, "leads.claim") &&
    lead.assignedToId === null &&
    targetUserId === actor.id
  ) {
    return true;
  }

  // Release: hand a lead you own back to the pool.
  return (
    can(actor.role, "leads.release") &&
    lead.assignedToId === actor.id &&
    targetUserId === null
  );
}

/**
 * May `actor` send `lead` to the partner firm?
 *
 * Only MVA leads go to Brightwater, and at most once. "Already sent" is checked
 * on both signals — the timestamp and the returned lead id — so a partially
 * recorded send can never be repeated.
 */
export function canSendLeadToFirm(actor: Actor, lead: LeadSubject): boolean {
  return (
    can(actor.role, "leads.send_to_firm") &&
    lead.caseType === "MVA" &&
    lead.sentToFirmAt === null &&
    lead.brightwaterLeadId === null
  );
}

/**
 * The workflow gate for sending: a lead must be Retained first.
 *
 * Kept separate from `canSendLeadToFirm` so the UI can still show the action and
 * explain *why* it isn't available yet, while the server uses the same rule to
 * refuse an early send.
 */
export function isLeadReadyToSend(lead: { stage: LeadStage }): boolean {
  return lead.stage === SEND_READY_STAGE;
}

/**
 * May `actor` permanently delete `lead`?
 *
 * Deletion is admin-only: it removes the record an agent may only be working
 * through the pipeline, and no part of the workflow is expected to undo it.
 */
export function canDeleteLead(actor: Actor): boolean {
  return can(actor.role, "leads.delete");
}

/** May `actor` manage intake users? */
export function canManageUsers(actor: Actor): boolean {
  return can(actor.role, "users.manage");
}

/**
 * The user facts the user-management policies read. A `UserRow` satisfies this.
 *
 * `adminCount` is passed in rather than read here so these stay pure: the caller
 * supplies the count from the database it is about to mutate, and the frontend
 * supplies the same count to disable controls that would break the invariant.
 */
export interface UserSubject {
  id: number;
  role: UserRole;
}

/**
 * May `actor` delete `target`?
 *
 * Two invariants protect the desk from locking itself out:
 *   - an admin may not delete their own account;
 *   - the last admin may not be deleted, so at least one always remains.
 */
export function canDeleteUser(
  actor: Actor,
  target: UserSubject,
  adminCount: number,
): boolean {
  if (!can(actor.role, "users.manage")) return false;
  if (target.id === actor.id) return false;
  if (target.role === "ADMIN" && adminCount <= 1) return false;
  return true;
}

/**
 * May `actor` change `target`'s role to `nextRole`?
 *
 * Only blocks the one dangerous move: demoting the last admin, which would leave
 * the desk with nobody who can manage users.
 */
export function canChangeUserRole(
  actor: Actor,
  target: UserSubject,
  nextRole: UserRole,
  adminCount: number,
): boolean {
  if (!can(actor.role, "users.manage")) return false;
  if (target.role === "ADMIN" && nextRole !== "ADMIN" && adminCount <= 1) {
    return false;
  }
  return true;
}
