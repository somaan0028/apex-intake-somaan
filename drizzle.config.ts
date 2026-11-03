import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config — used to generate SQL migrations from the schema.
 * `npm run db:generate` writes them to `drizzle/`, which the server applies
 * automatically on boot.
 */
export default defineConfig({
  dialect: "sqlite",
  // The schema is split into one file per model under `lib/db/schema/`.
  schema: "./lib/db/schema/*",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "./data/apex.db",
  },
});
