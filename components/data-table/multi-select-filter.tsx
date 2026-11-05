"use client";

/**
 * A checkbox popover for filters that accept more than one choice.
 *
 * It is controlled by the parent but keeps a local draft while the popover is
 * open, so several boxes can be ticked before the server round-trip that
 * carries the URL update finishes. The parent still owns the value: closing and
 * reopening reads the current query again.
 */
import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  label: string;
  value: string;
}

export function MultiSelectFilter({
  labelId,
  triggerId,
  allLabel,
  options,
  selected,
  onChange,
  className,
}: {
  /** Id of the visible label beside the trigger. */
  labelId?: string;
  /** Id for the trigger itself, when a `<label htmlFor>` points at it. */
  triggerId?: string;
  /** Text shown when nothing is selected. */
  allLabel: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(selected);

  // Only valid choices from the current option list take part in the summary
  // and the next value; a stale id from an old assignee list is ignored.
  const chosen = draft.filter((value) =>
    options.some((option) => option.value === value),
  );
  const chosenLabels = chosen
    .map((value) => options.find((option) => option.value === value)?.label)
    .filter((label): label is string => Boolean(label));
  const summary =
    chosenLabels.length === 0
      ? allLabel
      : chosenLabels.length === 1
        ? chosenLabels[0]
        : `${chosenLabels[0]} +${chosenLabels.length - 1}`;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setDraft(selected);
  }

  function toggle(value: string, checked: boolean) {
    const next = checked
      ? [...chosen, value]
      : chosen.filter((current) => current !== value);
    setDraft(next);
    onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            id={triggerId}
            variant="outline"
            size="sm"
            className={cn(
              "w-fit justify-between gap-2 font-normal",
              className,
            )}
            aria-labelledby={labelId}
          />
        }
      >
        <span className="truncate">{summary}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <div className="flex flex-col gap-0.5">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox
                checked={chosen.includes(option.value)}
                onCheckedChange={(checked) =>
                  toggle(option.value, checked === true)
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
          {chosen.length ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 justify-start"
              onClick={() => {
                setDraft([]);
                onChange([]);
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
