/**
 * In-process queue for potential-duplicate checks.
 *
 * Matching happens after the response has been produced: intake and autosave
 * call `scheduleDupCheck` (which only records an id and arms a short timer) and
 * never await the comparison. Edits to the same lead coalesce, and `flush`
 * yields between leads so a burst cannot starve request handlers.
 *
 * The queue is deliberately not persisted. There is no recurring sweep by
 * design — a lost job is recovered by the one-off backfill script, not by
 * re-checking existing leads on boot.
 */
import { recheckLead } from "./dup-groups";

type Timer = ReturnType<typeof setTimeout>;

interface DupQueueState {
  pending: Set<number>;
  timer: Timer | null;
  running: boolean;
}

// A global keeps dev hot-reloads from creating competing timers for one queue.
const globalForDup = globalThis as typeof globalThis & {
  __apexDupQueue?: DupQueueState;
};

const state: DupQueueState = (globalForDup.__apexDupQueue ??= {
  pending: new Set<number>(),
  timer: null,
  running: false,
});

/** Short enough to feel immediate, long enough to coalesce a typing burst. */
const DEBOUNCE_MS = 300;

/** Queue one lead for a background re-check. Returns immediately. */
export function scheduleDupCheck(leadId: number): void {
  if (!Number.isInteger(leadId) || leadId <= 0) return;

  state.pending.add(leadId);
  if (state.timer !== null) return;

  state.timer = setTimeout(() => {
    state.timer = null;
    void flush();
  }, DEBOUNCE_MS);
}

async function flush(): Promise<void> {
  if (state.running) return;
  state.running = true;

  try {
    while (state.pending.size > 0) {
      const ids = [...state.pending];
      state.pending.clear();

      for (const id of ids) {
        try {
          recheckLead(id);
        } catch (error) {
          // A failed check must never affect the submission or edit that
          // queued it; the next matching event will try the lead again.
          console.error(`[dup] Could not re-check lead ${id}:`, error);
        }

        // Let request handlers run between leads.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  } finally {
    state.running = false;

    // An id added after the loop condition was evaluated still needs a run.
    if (state.pending.size > 0 && state.timer === null) {
      state.timer = setTimeout(() => {
        state.timer = null;
        void flush();
      }, DEBOUNCE_MS);
    }
  }
}
