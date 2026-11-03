/**
 * Reset the local database.
 *
 * Deletes the SQLite file (and its WAL/journal sidecars), then recreates,
 * migrates and re-seeds it by reusing the same boot path the server uses
 * (`lib/db/bootstrap.ts` → `ensureDatabase`). That means a reset can never drift
 * from what a fresh clone does.
 *
 * Usage: `npm run db:reset` (stop the dev server first so the file isn't locked).
 */
import { rmSync } from "node:fs";
import { ensureDatabase } from "../lib/db/bootstrap";
import { getDatabasePath } from "../lib/db/index";

const dbPath = getDatabasePath();

// Remove the database plus any sidecars left behind by WAL mode.
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  rmSync(`${dbPath}${suffix}`, { force: true });
}
console.log(`[db] Removed ${dbPath}*`);

// With the file gone, `ensureDatabase()` creates it, applies migrations and
// runs the CSV seed import.
ensureDatabase();
