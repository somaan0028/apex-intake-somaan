"use client";

/**
 * Small read-only history dialog opened from the lead detail form.
 *
 * It shows one activity type for one lead: stage changes below the stage
 * control, and send attempts beside the Firm submission heading. Rows name the
 * doer and the generated description, so the reader can see what happened
 * without exposing the whole activity log.
 */
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getLeadActivities,
  getLeadActivityCount,
} from "@/lib/activities/actions";
import type { LeadHistoryRow, LeadHistoryType } from "@/lib/activities/history";
import { formatDateTime } from "@/lib/format";
import { UserAvatar } from "@/components/user-avatar";

export function LeadHistoryDialog({
  leadId,
  type,
  triggerLabel,
  title,
  emptyMessage,
  refreshKey = 0,
}: {
  leadId: number;
  type: LeadHistoryType;
  triggerLabel: string;
  title: string;
  emptyMessage: string;
  /** Bump to reload the trigger count after an action recorded a new row. */
  refreshKey?: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LeadHistoryRow[]>([]);
  const [count, setCount] = useState<number | null>(null);

  // Load the count when the lead dialog opens, and again whenever the caller
  // reports a new activity (a stage change, a firm submission attempt), so the
  // trigger is current without closing and reopening the lead.
  useEffect(() => {
    let cancelled = false;
    void getLeadActivityCount(leadId, type)
      .then((value) => {
        if (!cancelled) setCount(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [leadId, type, refreshKey]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await getLeadActivities(leadId, type));
    } catch {
      setError("Could not load this history. Close the dialog and try again.");
    } finally {
      setLoading(false);
    }
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) void load();
  }

  return (
    <>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto px-0 text-xs"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        {triggerLabel}
        {count === null ? "" : ` (${count})`}
      </Button>

      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-lg" forceBackdrop>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Loading…
            </p>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            <ul className="max-h-[50vh] divide-y overflow-y-auto">
              {rows.map((row) => (
                <li key={row.id} className="py-2 text-sm leading-relaxed">
                  <div className="flex items-start gap-2.5">
                    <UserAvatar
                      size="sm"
                      userId={row.doerId}
                      name={row.doerName}
                      avatarPath={row.doerAvatarPath}
                    />
                    <p className="min-w-0">
                      <span className="font-medium">{row.doerName}</span>:{" "}
                      {row.description}{" "}
                      <span className="whitespace-nowrap text-muted-foreground">
                        Date: {formatDateTime(row.createdAt)}
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
