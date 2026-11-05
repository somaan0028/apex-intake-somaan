"use client";

/**
 * Auto-save plumbing for the lead dialog.
 *
 * Text fields are debounced so a sentence is one request, not one per keystroke;
 * selects, dates and the claim/release button call `saveNow`. Requests run in a
 * queue, so an older patch can never land after a newer one, and a counter lets
 * the UI say "Saved" only once the last request has returned.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { saveLeadFields } from "@/lib/leads/actions";
import type { LeadFieldPatch } from "@/lib/leads/editable";

export type SaveStatus = "idle" | "saving" | "saved";

/** How long a text field waits after the last keystroke, in milliseconds. */
const DEBOUNCE_MS = 700;

export interface LeadAutoSave {
  status: SaveStatus;
  error: string | null;
  /** Save a patch immediately. Resolves true when the server accepted it. */
  saveNow: (patch: LeadFieldPatch) => Promise<boolean>;
  /** Debounce a patch for one field; `key` identifies the field. */
  schedule: (key: string, patch: LeadFieldPatch) => void;
  /** Send the debounced patch for `key` now (e.g. on blur). */
  flush: (key: string) => void;
  /** Drop the debounced patch for `key` (e.g. after it became invalid). */
  cancel: (key: string) => void;
  /** Send every debounced patch now (e.g. when the dialog closes). */
  flushAll: () => void;
  /** Flush, then resolve once every queued save has settled. */
  flushAllNow: () => Promise<void>;
}

export function useLeadAutoSave(leadId: number): LeadAutoSave {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const latest = useRef(new Map<string, LeadFieldPatch>());

  useEffect(() => {
    mounted.current = true;
    const pendingTimers = timers.current;
    const pendingPatches = latest.current;
    return () => {
      // Closing the dialog must not drop a keystroke that was still inside the
      // debounce window. Send each waiting field before the timers are cleared;
      // the request outlives the component, and the Server Action revalidates
      // the grid on its own.
      for (const [key, timer] of pendingTimers) {
        clearTimeout(timer);
        const patch = pendingPatches.get(key);
        if (patch) void saveLeadFields(leadId, patch);
      }
      pendingTimers.clear();
      pendingPatches.clear();
      mounted.current = false;
    };
  }, [leadId]);

  const saveNow = useCallback(
    (patch: LeadFieldPatch) => {
      pending.current += 1;
      if (mounted.current) {
        setStatus("saving");
        setError(null);
      }

      const task = queue.current.then(async () => {
        let ok = false;
        try {
          const result = await saveLeadFields(leadId, patch);
          ok = result.ok;
          if (!result.ok && mounted.current) {
            setError(result.error ?? "Could not save. Please try again.");
          }
        } catch {
          if (mounted.current) {
            setError("Could not save. Please try again.");
          }
        } finally {
          pending.current -= 1;
          if (mounted.current) {
            if (!ok) {
              setStatus("idle");
            } else if (pending.current === 0) {
              // Stay on "Saved" until the next edit starts another save.
              setStatus("saved");
            }
          }
        }
        return ok;
      });

      queue.current = task.catch(() => undefined);
      return task;
    },
    [leadId],
  );

  const flush = useCallback(
    (key: string) => {
      const timer = timers.current.get(key);
      if (timer) {
        clearTimeout(timer);
        timers.current.delete(key);
      }
      const patch = latest.current.get(key);
      if (patch) {
        latest.current.delete(key);
        void saveNow(patch);
      }
    },
    [saveNow],
  );

  const cancel = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(key);
    }
    latest.current.delete(key);
  }, []);

  const schedule = useCallback(
    (key: string, patch: LeadFieldPatch) => {
      latest.current.set(key, patch);
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          const next = latest.current.get(key);
          if (next) {
            latest.current.delete(key);
            void saveNow(next);
          }
        }, DEBOUNCE_MS),
      );
    },
    [saveNow],
  );

  const flushAll = useCallback(() => {
    for (const key of Array.from(timers.current.keys())) flush(key);
  }, [flush]);

  const flushAllNow = useCallback(async () => {
    flushAll();
    // `flushAll` queues its saves synchronously, so the current promise covers
    // them. Awaiting here is what lets "Check for Duplicates" see the edits the
    // person has just typed rather than the last persisted values.
    await queue.current;
  }, [flushAll]);

  return {
    status,
    error,
    saveNow,
    schedule,
    flush,
    cancel,
    flushAll,
    flushAllNow,
  };
}
