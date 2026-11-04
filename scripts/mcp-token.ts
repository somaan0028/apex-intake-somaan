/**
 * Mint a personal access token for an existing user.
 *
 * The Settings page is the normal way to do this; the script exists so a token
 * can be issued during setup, or by an agent that has shell access but no
 * browser session.
 *
 * Usage:
 *   npm run mcp:token -- <email> [label]              create a token
 *   npm run mcp:token -- --list <email>               list a user's tokens
 *   npm run mcp:token -- --revoke <email> <id>        revoke one by id
 *
 * The token is printed once and never stored in the clear, so it cannot be
 * recovered later — only replaced.
 */
import { eq } from "drizzle-orm";
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "../lib/auth/api-token";
import { ensureDatabase } from "../lib/db/bootstrap";
import { getDb } from "../lib/db/index";
import { users } from "../lib/db/schema";

// Applies any pending migrations (idempotent), so this works on a fresh clone
// exactly as it does on an up-to-date one.
ensureDatabase();

/** Look up a user by email, or explain why we can't. */
function findUser(email: string) {
  const user = getDb()
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .get();

  if (!user) {
    console.error(`[mcp] No user with email "${email}".`);
    process.exitCode = 1;
    return null;
  }
  return user;
}

const [command, ...rest] = process.argv.slice(2);

if (command === "--revoke") {
  const user = findUser(rest[0] ?? "");
  const id = Number(rest[1]);

  if (user && !Number.isInteger(id)) {
    console.error("Usage: npm run mcp:token -- --revoke <email> <id>");
    process.exitCode = 1;
  } else if (user) {
    console.log(
      revokeApiToken(user.id, id)
        ? `[mcp] Revoked token #${id} for ${user.email}.`
        : `[mcp] ${user.email} has no token #${id}.`,
    );
  }
} else if (command === "--list") {
  const user = findUser(rest[0] ?? "");
  if (user) {
    const tokens = listApiTokens(user.id);
    if (tokens.length === 0) {
      console.log(`[mcp] ${user.email} has no tokens.`);
    } else {
      for (const token of tokens) {
        const used = token.lastUsedAt
          ? `last used ${token.lastUsedAt.toISOString()}`
          : "never used";
        console.log(`  #${token.id}  ${token.prefix}…  ${token.name}  (${used})`);
      }
    }
  }
} else if (command) {
  const user = findUser(command);
  if (user) {
    const label = rest.join(" ").trim() || "Command line";
    const { token, summary } = createApiToken(user.id, label);
    console.log(
      `[mcp] Token #${summary.id} created for ${user.name} <${user.email}> (${user.role}).`,
    );
    console.log(`\n  ${token}\n`);
    console.log("Shown once — it cannot be read back. Connect an agent with:");
    console.log(`  endpoint  http://localhost:3000/api/mcp`);
    console.log(`  header    Authorization: Bearer ${token}`);
  }
} else {
  console.log(
    "Usage:\n" +
      "  npm run mcp:token -- <email> [label]\n" +
      "  npm run mcp:token -- --list <email>\n" +
      "  npm run mcp:token -- --revoke <email> <id>",
  );
}
