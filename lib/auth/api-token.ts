/**
 * Personal access tokens — minting, resolving and revoking the credentials an
 * external AI harness presents to the MCP server.
 *
 * These are deliberately *not* a second permission system. A token identifies a
 * user; everything it can then do is decided by that user's role and the same
 * policies the UI uses (see `lib/rbac` and `lib/auth/authorize.ts`). Resolving a
 * token always re-reads the `users` row, so permissions are current on every
 * request.
 *
 * Tokens are opaque 256-bit random strings, stored only as a SHA-256 hash, and
 * are recognisable in a config file by their `apex_mcp_` prefix.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { apiTokens, users } from "@/lib/db/schema";
import type { AuthUser } from "./session";

/** Prefix on every token, so one is recognisable in a client config file. */
const TOKEN_PREFIX = "apex_mcp_";

/** 256 bits of entropy, encoded so it survives copy/paste and JSON configs. */
const TOKEN_BYTES = 32;

/** Characters of the raw token kept in the clear, purely so it can be listed. */
const DISPLAY_LENGTH = TOKEN_PREFIX.length + 4;

/**
 * How stale `last_used_at` may get before a request rewrites it. The MCP server
 * resolves the token on every call, and most calls happen in bursts, so writing
 * on each one would be pointless churn.
 */
const LAST_USED_RESOLUTION_MS = 60_000;

/** A token as the owner sees it — never the hash, and never the raw value. */
export interface ApiTokenSummary {
  id: number;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

/** SHA-256 (hex) of a raw token. */
export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Mint a fresh token.
 *
 * Returns the raw value alongside what should be stored; the raw value is the
 * only copy that will ever exist, so the caller must show it immediately.
 */
export function mintApiToken(): {
  token: string;
  tokenHash: string;
  prefix: string;
} {
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return {
    token,
    tokenHash: hashApiToken(token),
    prefix: token.slice(0, DISPLAY_LENGTH),
  };
}

/** Create a token for `userId` and return the raw value to show once. */
export function createApiToken(
  userId: number,
  name: string,
): { token: string; summary: ApiTokenSummary } {
  const { token, tokenHash, prefix } = mintApiToken();
  const createdAt = new Date();

  const row = getDb()
    .insert(apiTokens)
    .values({ userId, name, tokenHash, prefix, createdAt })
    .returning()
    .get();

  return {
    token,
    summary: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
    },
  };
}

/** Every token belonging to `userId`, newest first. */
export function listApiTokens(userId: number): ApiTokenSummary[] {
  return getDb()
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt))
    .all();
}

/**
 * Delete one of `userId`'s tokens. Scoped by owner, so an id belonging to
 * somebody else deletes nothing and reports `false`.
 */
export function revokeApiToken(userId: number, tokenId: number): boolean {
  const deleted = getDb()
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .returning({ id: apiTokens.id })
    .all();
  return deleted.length > 0;
}

/** A token resolved to the user it belongs to. */
export interface ResolvedApiToken {
  user: AuthUser;
  tokenId: number;
}

/**
 * Resolve a raw bearer token to its owner.
 *
 * Returns `null` for an unknown, expired or revoked (deleted) token. The user
 * row is re-read here rather than cached in the token, which is what keeps the
 * agent's abilities identical to the signed-in person's.
 */
export function resolveApiToken(raw: string): ResolvedApiToken | null {
  if (!raw) return null;

  const now = new Date();
  const row = getDb()
    .select({
      tokenId: apiTokens.id,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      avatarPath: users.avatarPath,
    })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(eq(apiTokens.tokenHash, hashApiToken(raw)))
    .get();

  if (!row) return null;
  if (row.expiresAt && row.expiresAt <= now) return null;

  if (
    !row.lastUsedAt ||
    now.getTime() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS
  ) {
    getDb()
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(eq(apiTokens.id, row.tokenId))
      .run();
  }

  return {
    tokenId: row.tokenId,
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      avatarPath: row.avatarPath,
    },
  };
}
