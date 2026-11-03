/**
 * Session handling — real, DB-backed login sessions.
 *
 * The browser holds an opaque random token in an httpOnly cookie; the server
 * stores only its SHA-256 hash in `sessions`. Reading the session joins that
 * row back to `users` and rejects expired tokens.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { sessions, users, type UserRole } from "@/lib/db/schema";
import { SESSION_COOKIE } from "./session-cookie";

/** The subset of user data the rest of the app needs. */
export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

/** Session lifetime (7 days). */
const SESSION_TTL_MS = 60 * 60 * 24 * 7 * 1000;

/** Cookie lifetime in seconds (mirrors the DB expiry). */
const MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

/** SHA-256 (hex) of a raw session token. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Whether to set the cookie's `Secure` flag. Defaults to production-only, and
 * can be forced with `AUTH_COOKIE_SECURE` (e.g. `false` when testing a
 * production build over plain HTTP).
 */
function useSecureCookies(): boolean {
  return process.env.AUTH_COOKIE_SECURE
    ? process.env.AUTH_COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production";
}

/** Read the signed-in user from the session cookie, or `null`. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  // `better-sqlite3` is synchronous, so its queries would otherwise run during
  // prerendering. Wait for a real request first (also covers the `new Date()` below).
  await connection();

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = getDb();
  const tokenHash = hashToken(token);

  const row = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .get();

  if (!row) return null;

  // Reject (and clean up) expired sessions.
  if (row.expiresAt <= new Date().toISOString()) {
    db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
    return null;
  }

  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

/**
 * Read the session or redirect to `/login`. Use this in protected server code
 * (pages and Server Actions) so the check happens next to the data rather than
 * relying on `proxy.ts` alone.
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Create a session for `userId` and set the session cookie. */
export async function createSession(userId: number): Promise<void> {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();

  // Opportunistic cleanup so expired rows don't accumulate.
  db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())).run();

  db.insert(sessions)
    .values({
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
    })
    .run();

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: useSecureCookies(),
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Delete the current session (DB row + cookie). */
export async function destroySession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    getDb()
      .delete(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)))
      .run();
  }
  (await cookies()).delete(SESSION_COOKIE);
}
