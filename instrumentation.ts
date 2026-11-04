/**
 * Next.js instrumentation hook — `register()` is called once when a new server
 * instance starts, before it handles any request.
 *
 * We use it to validate the required secrets and to bootstrap the SQLite
 * database (create + seed on first run).
 */
import { assertServerEnv } from "@/lib/env";

export async function register(): Promise<void> {
  // Only the Node.js runtime can open the native SQLite binding and reach the
  // server-only secrets; skip on Edge.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Fail the boot, not the first AI or Brightwater call, when a key is absent.
  assertServerEnv();

  // Imported dynamically so the native module never reaches the Edge bundle.
  const { ensureDatabase } = await import("@/lib/db/bootstrap");
  ensureDatabase();
}
