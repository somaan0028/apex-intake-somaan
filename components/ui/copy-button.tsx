"use client";

import type { MouseEvent } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/**
 * Copies a value to the clipboard and confirms with a toast.
 *
 * Click and keydown propagation are stopped so the button can sit inside a
 * clickable table row without opening the row's dialog.
 */
export function CopyButton({
  value,
  label,
  size = "icon-xs",
  className,
}: {
  value: string | null | undefined;
  /** What is being copied, e.g. "Email". */
  label: string;
  size?: "icon-xs" | "icon-sm";
  className?: string;
}) {
  if (!value) return null;

  async function handleCopy(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied", {
        description: `${label} copied to your clipboard.`,
      });
    } catch {
      toast.error("Could not copy", {
        description: "Please select it and copy it manually.",
      });
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      aria-label={`Copy ${label.toLowerCase()}`}
      title={`Copy ${label.toLowerCase()}`}
      className={cn("text-muted-foreground", className)}
      onClick={handleCopy}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Copy />
    </Button>
  );
}
