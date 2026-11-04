"use server";

/**
 * Server Actions for a user's own profile — self-service, not user management.
 *
 * These are the security boundary for self-edits. The form hides what a person
 * may not change, but a determined user can re-enable any input in the browser,
 * so each action re-reads the session and the user's own row and **ignores**
 * submitted fields the caller has no right to set, rather than trusting them:
 *
 *   - everyone may change their name, and their own password (given the current
 *     one);
 *   - an administrator may additionally change their own email and role.
 *
 * The last-admin invariant still applies to a self-demotion, so an admin cannot
 * lock the desk out of user management by accident.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ForbiddenError, requireUserRoleChange } from "@/lib/auth/authorize";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { USER_ROLES, users, type UserRole } from "@/lib/db/schema";
import { can } from "@/lib/rbac";
import { countAdmins } from "@/lib/users/queries";
import { isValidEmail } from "@/lib/validation";

/** Minimum length accepted for a new password (matches user management). */
const MIN_PASSWORD_LENGTH = 8;

/** Result the profile forms render. */
export interface ProfileActionResult {
  ok: boolean;
  /** Set when something was refused or rejected. */
  error?: string;
  /** Set when the change was applied, for inline confirmation. */
  message?: string;
}

function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/** Runs `run`, turning a `ForbiddenError` into a returned message. */
function guarded(run: () => ProfileActionResult): ProfileActionResult {
  try {
    return run();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** Save the caller's own name, plus email and role when they are an admin. */
export async function updateProfile(
  formData: FormData,
): Promise<ProfileActionResult> {
  const actor = await requireUser();

  return guarded(() => {
    const db = getDb();
    const current = db.select().from(users).where(eq(users.id, actor.id)).get();
    if (!current) {
      return { ok: false, error: "Your account no longer exists." };
    }

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { ok: false, error: "Name is required." };

    // Only an admin may move their own email and role; for anyone else the
    // submitted values are dropped and their current ones are kept.
    const isAdmin = can(actor.role, "users.manage");
    let email = current.email;
    let nextRole: UserRole = current.role;

    if (isAdmin) {
      email = String(formData.get("email") ?? "")
        .trim()
        .toLowerCase();
      const submittedRole = String(formData.get("role") ?? "").trim();

      if (!isValidEmail(email)) {
        return { ok: false, error: "Enter a valid email address." };
      }
      if (!isUserRole(submittedRole)) {
        return { ok: false, error: "Choose a role." };
      }

      if (email !== current.email) {
        const duplicate = db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .get();
        if (duplicate && duplicate.id !== actor.id) {
          return { ok: false, error: "That email is already in use." };
        }
      }

      // Guards the last admin from demoting themselves out of the role.
      requireUserRoleChange(actor, current, submittedRole, countAdmins());
      nextRole = submittedRole;
    }

    db.update(users)
      .set({ name, email, role: nextRole })
      .where(eq(users.id, actor.id))
      .run();

    // The shell renders the user's name, so the whole layout is revalidated.
    revalidatePath("/", "layout");
    return { ok: true, message: "Your details were saved." };
  });
}

/** Change the caller's own password, after proving the current one. */
export async function changePassword(
  formData: FormData,
): Promise<ProfileActionResult> {
  const actor = await requireUser();

  return guarded(() => {
    const db = getDb();
    const current = db.select().from(users).where(eq(users.id, actor.id)).get();
    if (!current) {
      return { ok: false, error: "Your account no longer exists." };
    }

    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    // Proving the current password is what stops a borrowed session from
    // silently taking the account over.
    if (!currentPassword) {
      return { ok: false, error: "Enter your current password." };
    }
    if (!verifyPassword(currentPassword, current.passwordHash)) {
      return { ok: false, error: "That is not your current password." };
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return {
        ok: false,
        error: `New passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      };
    }
    if (newPassword !== confirmPassword) {
      return { ok: false, error: "The new passwords do not match." };
    }
    if (newPassword === currentPassword) {
      return {
        ok: false,
        error: "Your new password must be different from your current one.",
      };
    }

    db.update(users)
      .set({ passwordHash: hashPassword(newPassword) })
      .where(eq(users.id, actor.id))
      .run();

    revalidatePath("/", "layout");
    return { ok: true, message: "Your password was changed." };
  });
}
