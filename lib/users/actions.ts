"use server";

/**
 * Server Actions for managing intake users.
 *
 * These are the security boundary. The dialog hides controls an agent shouldn't
 * see, but a determined user can re-enable them in the browser, so every action
 * re-checks the *current session's* permission here, plus the "keep an admin"
 * invariants — all against the database's own state, never the client's.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  ForbiddenError,
  requirePermission,
  requireUserDelete,
  requireUserRoleChange,
} from "@/lib/auth/authorize";
import { hashPassword } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { USER_ROLES, users, type UserRole } from "@/lib/db/schema";
import { isValidEmail } from "@/lib/validation";
import { countAdmins, countAssignedLeads } from "./queries";

/** Result the dialog renders; `ok` means the change was applied. */
export interface UserActionResult {
  ok: boolean;
  error?: string;
}

/** Minimum length accepted for an admin-set password. */
const MIN_PASSWORD_LENGTH = 8;

function readText(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

interface ProfileInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

/**
 * Shared field validation for create/update. Returns the parsed values, or a
 * message describing the first problem. `passwordRequired` is true on create and
 * false on update, where a blank password means "keep the current one".
 */
function parseProfile(
  formData: FormData,
  passwordRequired: boolean,
): ProfileInput | string {
  const name = readText(formData, "name");
  const email = readText(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = readText(formData, "role");

  if (!name) return "Name is required.";
  if (!isValidEmail(email)) return "Enter a valid email address.";
  if (!isUserRole(role)) return "Choose a role.";
  if (passwordRequired && !password) return "Password is required.";
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  return { name, email, password, role };
}

/** Runs `run`, turning a `ForbiddenError` into a returned message. */
function guarded(run: () => UserActionResult): UserActionResult {
  try {
    return run();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** Admin-only: create a user. */
export async function createUser(
  formData: FormData,
): Promise<UserActionResult> {
  const actor = await requireUser();

  return guarded(() => {
    requirePermission(actor, "users.manage");

    const parsed = parseProfile(formData, true);
    if (typeof parsed === "string") return { ok: false, error: parsed };

    const db = getDb();
    const existing = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.email))
      .get();
    if (existing) return { ok: false, error: "That email is already in use." };

    db.insert(users)
      .values({
        name: parsed.name,
        email: parsed.email,
        role: parsed.role,
        passwordHash: hashPassword(parsed.password),
        createdAt: new Date(),
      })
      .run();

    revalidatePath("/users");
    return { ok: true };
  });
}

/** Admin-only: update a user's name, email, role, and (optionally) password. */
export async function updateUser(
  formData: FormData,
): Promise<UserActionResult> {
  const actor = await requireUser();

  return guarded(() => {
    requirePermission(actor, "users.manage");

    const id = Number(readText(formData, "id"));
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "Unknown user." };
    }

    const parsed = parseProfile(formData, false);
    if (typeof parsed === "string") return { ok: false, error: parsed };

    const db = getDb();
    const target = db.select().from(users).where(eq(users.id, id)).get();
    if (!target) return { ok: false, error: "That user no longer exists." };

    // Guards the last admin from being demoted.
    requireUserRoleChange(actor, target, parsed.role, countAdmins());

    const duplicate = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.email))
      .get();
    if (duplicate && duplicate.id !== id) {
      return { ok: false, error: "That email is already in use." };
    }

    db.update(users)
      .set({
        name: parsed.name,
        email: parsed.email,
        role: parsed.role,
        // A blank password leaves the existing hash untouched.
        ...(parsed.password
          ? { passwordHash: hashPassword(parsed.password) }
          : {}),
      })
      .where(eq(users.id, id))
      .run();

    revalidatePath("/users");
    return { ok: true };
  });
}

/** Admin-only: delete a user (never themselves, never the last admin). */
export async function deleteUser(
  formData: FormData,
): Promise<UserActionResult> {
  const actor = await requireUser();

  return guarded(() => {
    requirePermission(actor, "users.manage");

    const id = Number(readText(formData, "id"));
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "Unknown user." };
    }

    const db = getDb();
    const target = db.select().from(users).where(eq(users.id, id)).get();
    if (!target) return { ok: false, error: "That user no longer exists." };

    // Refuses a self-delete and protects the last admin.
    requireUserDelete(actor, target, countAdmins());

    // `assigned_to_id` references `users.id` and foreign keys are enforced, so a
    // delete would fail (or orphan leads). Refuse until the leads are moved.
    const assigned = countAssignedLeads(id);
    if (assigned > 0) {
      return {
        ok: false,
        error: `${target.name} still owns ${assigned} lead${
          assigned === 1 ? "" : "s"
        }. Reassign ${assigned === 1 ? "it" : "them"} before deleting.`,
      };
    }

    db.delete(users).where(eq(users.id, id)).run();

    revalidatePath("/users");
    return { ok: true };
  });
}
