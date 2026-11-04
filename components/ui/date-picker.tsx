"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const DISPLAY_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

/** Parse a stored `YYYY-MM-DD` value as a local date (never shifts the day). */
function fromIso(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Serialize a picked date to the `YYYY-MM-DD` the form and API use. */
function toIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

interface DatePickerProps {
  id?: string;
  /** `YYYY-MM-DD`, or an empty string when nothing is chosen. */
  value: string;
  onChange: (value: string) => void;
  /** Latest selectable `YYYY-MM-DD`. */
  max?: string;
  /** Earliest selectable `YYYY-MM-DD`. */
  min?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A calendar in a popover, replacing the browser's native date input.
 *
 * Native pickers are cramped, styled by the browser and unusable with a thumb,
 * so every date in the app should use this. The trigger is a full-width button
 * that reads like an input, the month/year captions are dropdowns (faster than
 * paging back through years), and the day cells are large touch targets.
 */
export function DatePicker({
  id,
  value,
  onChange,
  max,
  min,
  placeholder = "Pick a date",
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = fromIso(value);
  const maxDate = fromIso(max);
  const minDate = fromIso(min);
  const today = startOfDay(new Date());

  // A date cannot be both outside the allowed range and a sensible default.
  const defaultMonth = selected ?? maxDate ?? today;
  const pickToday =
    (!minDate || today >= startOfDay(minDate)) &&
    (!maxDate || today <= startOfDay(maxDate));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            data-empty={!selected}
            className={cn(
              "h-11 w-full justify-start gap-2 px-3 text-left font-normal",
              // Match the plain inputs around it: transparent fill, input border.
              "border-input bg-transparent dark:bg-input/30",
              "data-[empty=true]:text-muted-foreground",
              className,
            )}
          />
        }
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">
          {selected
            ? selected.toLocaleDateString("en-US", DISPLAY_FORMAT)
            : placeholder}
        </span>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        // Wider cells on phones (thumbs), slightly tighter once there is a mouse.
        className="w-auto max-w-[calc(100vw-1.5rem)] p-0"
      >
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={defaultMonth}
          onSelect={(date) => {
            if (!date) return;
            onChange(toIso(date));
            setOpen(false);
          }}
          captionLayout="dropdown"
          startMonth={minDate ?? new Date(1940, 0)}
          endMonth={maxDate ?? today}
          disabled={[
            ...(minDate ? [{ before: startOfDay(minDate) }] : []),
            ...(maxDate ? [{ after: startOfDay(maxDate) }] : []),
          ]}
        />

        <div className="flex items-center justify-between gap-2 border-t p-2">
          <span className="px-1 text-xs text-muted-foreground">
            {maxDate
              ? `Up to ${maxDate.toLocaleDateString("en-US", DISPLAY_FORMAT)}`
              : null}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!pickToday}
            onClick={() => {
              onChange(toIso(today));
              setOpen(false);
            }}
          >
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
