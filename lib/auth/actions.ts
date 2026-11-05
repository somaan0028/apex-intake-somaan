"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
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

  // Appearance is read from the user's row by the authenticated app layout, so
  // there is no separate boot cookie to keep in sync here.
  redirect("/dashboard");
}

/** End the current session and return to the login page. */
export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
