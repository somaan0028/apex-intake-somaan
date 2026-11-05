/**
 * A one-line notice, shared by the Overview and the leads page.
 *
 * Deliberately slimmer than a Card: these are banners, not content, so they use
 * bare padding and keep the action on the right.
 */
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "cn";

export function AlertBar({
  tone,
  action,
  className,
  children,
}: {
  tone: "positive" | "warning";
  action: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const positive = tone === "positive";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-1.5",
        positive
          ? "border-emerald-600/25 bg-emerald-500/10"
          : "border-amber-600/25 bg-amber-500/10",
        className,
      )}
    >
      {positive ? (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
      ) : (
        <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-500" />
      )}
      <p className="min-w-0 flex-1 text-sm">{children}</p>
      {action}
    </div>
  );
}
