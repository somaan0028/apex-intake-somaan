/**
 * Database bootstrap.
 *
 * Runs once when the Next.js server starts (via `instrumentation.ts`).
 *
 * Behaviour, per the project requirement:
 *   - If the SQLite file does NOT exist: create it, apply the schema, then import
 *     the CSV seed data.
 *   - If the SQLite file already exists: do not re-import the seed data.
 *
 * Migrations are applied on every boot because they are idempotent — this lets
 * new tables/columns land automatically as the app grows, without ever
 * re-running the (potentially expensive) CSV import.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDatabasePath, getDb } from "./index";
import { seedDatabase } from "./seed";

/** Apply any pending Drizzle migrations (`drizzle/` folder). */
function applyMigrations(): void {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (!existsSync(migrationsFolder)) {
    throw new Error(
      `[db] Migrations folder not found at ${migrationsFolder}. Run "npm run db:generate".`,
    );
  }
  migrate(getDb(), { migrationsFolder });
}

/**
 * Ensure the database exists, is up to date, and is seeded on first boot.
 * Safe to call repeatedly (e.g. across dev hot reloads).
 */
export function ensureDatabase(): void {
  const dbPath = getDatabasePath();
  // Check BEFORE opening a connection: better-sqlite3 creates the file on open.
  const isNewDatabase = !existsSync(dbPath);

  if (isNewDatabase) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    console.log(`[db] No database found at ${dbPath}. Creating and seeding…`);
  }

  applyMigrations();

  if (isNewDatabase) {
    const result = seedDatabase(getDb());
    console.log(
      `[db] Seed complete: ${result.users} users, ${result.leads} leads.`,
    );
  }
}
