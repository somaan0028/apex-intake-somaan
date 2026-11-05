/**
 * Read access to a user's JSON preferences.
 *
 * A missing row or a malformed value yields the defaults, so callers never have
 * to seed a preferences object for existing users.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { normalizePreferences } from "./schema";
import type { UserPreferences } from "./types";

/** Preferences for `userId`, or the defaults when they have not saved any. */
export function getUserPreferences(userId: number): UserPreferences {
  const row = getDb()
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  return normalizePreferences(row?.preferences);
}
