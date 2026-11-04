/**
 * RBAC — the source of truth for *which roles may do what*.
 *
 * This module is the first of two layers:
 *
 *   1. **Capabilities** (here) — flat, role-level grants. `can(role, x)` answers
 *      "is this role allowed to do x at all?".
 *   2. **Policies** (`./policy`) — resource-aware decisions ("may *this* actor
 *      edit *this* lead?") built on top of the grants.
 *
 * Everything here imports only *types* from the schema, so Client Components can
 * use it to hide UI. Hiding is cosmetic — the same rules are re-run on the
 * server (see `lib/auth/authorize.ts`), which is the real security boundary.
 */
import type { UserRole } from "@/lib/db/schema";

/**
 * Every atomic capability the app recognises.
 *
 * Add one here (and grant it in `ROLE_PERMISSIONS`) and the rest of the app can
 * gate on it; there is no other list to keep in sync.
 */
export const PERMISSIONS = [
  /** See every lead, regardless of owner. */
  "leads.view.all",
  /** See leads assigned to me. */
  "leads.view.assigned",
  /** See the unassigned pool. */
  "leads.view.unassigned",
  /** Edit any lead's fields and stage. */
  "leads.edit.any",
  /** Edit leads assigned to me. */
  "leads.edit.own",
  /** (Re)assign any lead to anyone. */
  "leads.assign.any",
  /** Claim an unassigned lead for myself. */
  "leads.claim",
  /** Give up a lead I own, returning it to the unassigned pool. */
  "leads.release",
  /** Send / retry a lead to the partner firm. */
  "leads.send_to_firm",
  /** Permanently delete a lead. */
  "leads.delete",
  /** See a lead's attribution/tracking fields (IP, TrustedForm, Journaya, source). */
  "leads.view.attribution",
  /** See every user's activity, not just your own. */
  "activities.view.all",
  /** See the Campaign Analytics dashboard (campaign/source/medium/content performance). */
  "analytics.view",
  /** Create and manage intake users. */
  "users.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role → granted capabilities. **This map is the source of truth.**
 *
 * Typing it as a complete `Record<UserRole, …>` makes adding a role to
 * `USER_ROLES` a compile error until its grants are declared here — the same
 * guard the label maps in `lib/labels.ts` use. A permission string that isn't in
 * `PERMISSIONS` is likewise a compile error.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  // Admins can do anything; granting the whole set keeps new capabilities
  // automatically in their hands.
  ADMIN: PERMISSIONS,
  USER: [
    "leads.view.assigned",
    "leads.view.unassigned",
    "leads.edit.own",
    "leads.claim",
    "leads.release",
  ],
};

/** The identity a permission decision is made for (a full `AuthUser` satisfies it). */
export interface Actor {
  id: number;
  role: UserRole;
}

/** Whether `role` holds `permission`. */
export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
