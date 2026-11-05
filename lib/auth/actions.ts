"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { preferencesFromUserRow } from "@/lib/preferences/queries";
import { clearThemeCookie, setThemeCookie } from "@/lib/themes/cookie";
import { verifyPassword } from "./password";
import { createSession, destroySession } from "./session";

/** State handed back to the login form through `useActionState`. */
export interface LoginState {
  error?: string;
}

/**
 * Verify credentials against the `users` table and start a session.
 * Every seeded account shares the demo password (see `lib/db/seed.ts`).
 */
export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const user = getDb().select().from(users).where(eq(users.email, email)).get();

  // Generic message: never reveal whether the email exists.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: "Invalid email or password." };
  }

  await createSession(user.id);

  // The boot script needs the theme before the first paint on the next request;
  // the database remains the source of truth.
  const preferences = preferencesFromUserRow(user);
  await setThemeCookie(
    preferences.appearance.theme,
    preferences.appearance.mode,
  );

  redirect("/dashboard");
}

/** End the current session and return to the login page. */
export async function logout(): Promise<void> {
  await destroySession();
  await clearThemeCookie();
  redirect("/login");
}
