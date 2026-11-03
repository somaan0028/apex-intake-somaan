/**
 * Schema barrel — re-exports every model so the rest of the app can keep using a
 * single import root (`@/lib/db/schema`) regardless of how many tables exist.
 *
 * Drizzle Kit reads this folder (`drizzle.config.ts` -> `./lib/db/schema/*`).
 */
export * from "./users";
export * from "./leads";
export * from "./sessions";
