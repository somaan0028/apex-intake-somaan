/**
 * Next.js instrumentation hook — `register()` is called once when a new server
 * instance starts, before it handles any request.
 *
 * We use it to bootstrap the SQLite database (create + seed on first run).
 */
export async function register(): Promise<void> {
  // Only the Node.js runtime can open the native SQLite binding; skip on Edge.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Imported dynamically so the native module never reaches the Edge bundle.
  const { ensureDatabase } = await import("@/lib/db/bootstrap");
  ensureDatabase();
}
