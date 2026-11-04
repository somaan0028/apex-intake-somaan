/**
 * Server-side RBAC enforcement — the real security boundary.
 *
 * The checks in `lib/rbac` are cosmetic: they hide UI but a determined user can
 * re-enable anything in the browser. Every Server Action and API route that
 * touches protected data must re-check here, against the row it just loaded from
 * the database, before it mutates anything.
 *
 *     const user = await requireUser();
 *     const lead = getLeadById(id);            // fresh row, not client state
 *     requireLeadStageChange(user, lead, to);  // throws ForbiddenError
 *     updateStage(id, to);
 */
import type { LeadStage, UserRole } from "@/lib/db/schema";
import {
  can,
  canAssignLead,
  canChangeLeadStage,
  canChangeUserRole,
  canDeleteUser,
  canEditLead,
  canSendLeadToFirm,
  canViewLead,
  isLeadReadyToSend,
  type Actor,
  type LeadSubject,
  type Permission,
  type UserSubject,
} from "@/lib/rbac";

/**
 * Thrown when an actor lacks a permission. Map it to an HTTP 403 at the edge
 * (or let a Server Action surface its message to the client).
 */
export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Throw unless `actor` holds the role-level `permission`. */
export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}.`);
  }
}

/** Throw unless `actor` may see `lead`. */
export function requireLeadView(actor: Actor, lead: LeadSubject): void {
  if (!canViewLead(actor, lead)) {
    throw new ForbiddenError("You don't have access to this lead.");
  }
}

/** Throw unless `actor` may edit `lead`. */
export function requireLeadEdit(actor: Actor, lead: LeadSubject): void {
  if (!canEditLead(actor, lead)) {
    throw new ForbiddenError("You can't edit this lead.");
  }
}

/** Throw unless `actor` may move `lead` to `to`. */
export function requireLeadStageChange(
  actor: Actor,
  lead: LeadSubject,
  to: LeadStage,
): void {
  if (!canChangeLeadStage(actor, lead, to)) {
    throw new ForbiddenError("You can't move this lead to that stage.");
  }
}

/** Throw unless `actor` may assign `lead` to `targetUserId` (`null` = unassigned). */
export function requireLeadAssignment(
  actor: Actor,
  lead: LeadSubject,
  targetUserId: number | null,
): void {
  if (!canAssignLead(actor, lead, targetUserId)) {
    throw new ForbiddenError("You can't assign this lead to that user.");
  }
}

/** Throw unless `actor` may send `lead` to the partner firm. */
export function requireLeadSend(actor: Actor, lead: LeadSubject): void {
  if (!canSendLeadToFirm(actor, lead)) {
    throw new ForbiddenError("You can't send this lead to the firm.");
  }
}

/** Throw unless `lead` has reached the stage from which it may be sent. */
export function requireLeadReadyToSend(lead: { stage: LeadStage }): void {
  if (!isLeadReadyToSend(lead)) {
    throw new ForbiddenError(
      "This lead must be at Retained before it can be sent to the firm.",
    );
  }
}

/** Throw unless `actor` may delete `target` (protects self and the last admin). */
export function requireUserDelete(
  actor: Actor,
  target: UserSubject,
  adminCount: number,
): void {
  if (!canDeleteUser(actor, target, adminCount)) {
    throw new ForbiddenError("You can't delete this user.");
  }
}

/** Throw unless `actor` may change `target`'s role (protects the last admin). */
export function requireUserRoleChange(
  actor: Actor,
  target: UserSubject,
  nextRole: UserRole,
  adminCount: number,
): void {
  if (!canChangeUserRole(actor, target, nextRole, adminCount)) {
    throw new ForbiddenError("You can't change this user's role.");
  }
}
