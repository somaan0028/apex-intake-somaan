"use client";

/**
 * A preset + custom date range filter, shared by the leads and activity grids.
 *
 * The presets use rolling windows; "Custom range" reveals two `DatePicker`s.
 * Callers own the URL filters and decide how a preset maps to them.
 */
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface DateRangeOption {
  label: string;
  value: string;
}

export const DATE_RANGE_PRESET_OPTIONS: DateRangeOption[] = [
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 3 days", value: "3d" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Custom range", value: "custom" },
];

/** The same presets with a way to clear the filter. */
export const DATE_RANGE_ANY_OPTIONS: DateRangeOption[] = [
  { label: "All Time", value: "any" },
  ...DATE_RANGE_PRESET_OPTIONS,
];

export function DateRangeFilter({
  label,
  preset,
  from,
  to,
  options = DATE_RANGE_PRESET_OPTIONS,
  onPresetChange,
  onChange,
}: {
  label: string;
  preset: string;
  from: string;
  to: string;
  options?: DateRangeOption[];
  onPresetChange: (preset: string) => void;
  onChange: (from: string, to: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium whitespace-nowrap text-muted-foreground">
        {label}
      </span>
      <Select
        items={options}
        value={preset}
        onValueChange={(value) => {
          if (value) onPresetChange(value);
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-40"
          aria-label={`${label} date range`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {preset === "custom" ? (
        <div className="flex items-center gap-1.5">
          <DatePicker
            value={from}
            max={to || today}
            placeholder="From"
            className="h-8 w-36"
            onChange={(value) => {
              if (!value) return;
              onChange(value, to && to < value ? value : to);
            }}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <DatePicker
            value={to}
            min={from || undefined}
            max={today}
            placeholder="Any date"
            className="h-8 w-36"
            onChange={(value) => onChange(from, value)}
          />
          {to ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Clear end date"
              onClick={() => onChange(from, "")}
            >
              <X />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
