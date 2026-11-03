/**
 * SQLite connection + Drizzle client.
 *
 * A single `better-sqlite3` connection is reused across the process. In
 * development Next.js re-evaluates modules on hot reload, so the connection is
 * cached on `globalThis` to avoid opening (and leaking) a new handle each time.
 */
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

/** Absolute path to the SQLite file (configurable via `DATABASE_PATH`). */
export function getDatabasePath(): string {
  const configured = process.env.DATABASE_PATH ?? "./data/apex.db";
  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);
}

/** Cached handles, keyed on `globalThis` so hot reload does not leak them. */
const globalForDb = globalThis as unknown as {
  __apexSqlite?: Database.Database;
  __apexDb?: AppDatabase;
};

/** The underlying `better-sqlite3` connection (opens/creates the file). */
export function getRawDb(): Database.Database {
  if (!globalForDb.__apexSqlite) {
    const db = new Database(getDatabasePath());
    // WAL improves concurrent read performance; enforce FK constraints since
    // SQLite does not do so by default.
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    globalForDb.__apexSqlite = db;
  }
  return globalForDb.__apexSqlite;
}

/** The Drizzle client bound to the application schema. */
export function getDb(): AppDatabase {
  if (!globalForDb.__apexDb) {
    globalForDb.__apexDb = drizzle(getRawDb(), { schema });
  }
  return globalForDb.__apexDb;
}
