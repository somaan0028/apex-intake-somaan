"use server";

/**
 * Save the caller's appearance choice.
 *
 * Only the signed-in user's own row is updated; there is no admin path to this
 * action. The stored JSON is merged rather than replaced so future preferences
 * in the same blob survive an older code path.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { isThemeId, type ThemeId } from "@/lib/themes/registry";
import { isThemeMode, type ThemeMode } from "./types";

export interface AppearanceResult {
  ok: boolean;
  error?: string;
}

/** Persist the selected theme and colour mode for the signed-in user. */
export async function updateAppearance(input: {
  theme: string;
  mode: string;
}): Promise<AppearanceResult> {
  const actor = await requireUser();

  if (!isThemeId(input.theme) || !isThemeMode(input.mode)) {
    return { ok: false, error: "Choose a valid theme and colour mode." };
  }

  const theme: ThemeId = input.theme;
  const mode: ThemeMode = input.mode;
  const db = getDb();

  const current = db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, actor.id))
    .get();
  if (!current) {
    return { ok: false, error: "Your account no longer exists." };
  }

  const raw =
    current.preferences && typeof current.preferences === "object"
      ? current.preferences
      : {};
  const currentAppearance =
    raw.appearance && typeof raw.appearance === "object" ? raw.appearance : {};

  db.update(users)
    .set({
      preferences: {
        ...raw,
        appearance: {
          ...currentAppearance,
          theme,
          mode,
        },
      },
    })
    .where(eq(users.id, actor.id))
    .run();

  revalidatePath("/settings/preferences");
  return { ok: true };
}
