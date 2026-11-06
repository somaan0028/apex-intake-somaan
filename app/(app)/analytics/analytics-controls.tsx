"use client";

/**
 * Analytics toolbar: the same date-range control the leads and activity grids
 * use, plus a campaign selector.
 *
 * Both write the URL (so a view is shareable and the back button works) and let
 * the server recompute the report. The campaign selector defaults to "All
 * campaigns"; "Other" is the bucket for every case type that is not MVA or
 * Mass Tort, matching the lead grid's `caseType=OTHER` filter.
 */
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  DATE_RANGE_ANY_OPTIONS,
  DateRangeFilter,
} from "@/components/date-range-filter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CAMPAIGN_FILTER_OPTIONS,
  defaultAddedFrom,
  type CampaignFilterValue,
} from "@/lib/leads/constants";
import type { AnalyticsDatePreset } from "@/lib/leads/analytics";
import { cn } from "@/lib/utils";

interface AnalyticsControlsProps {
  dateWithin: AnalyticsDatePreset;
  dateFrom?: string;
  dateTo?: string;
  campaign: CampaignFilterValue;
}

export function AnalyticsControls({
  dateWithin,
  dateFrom,
  dateTo,
  campaign,
}: AnalyticsControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function navigate(next: AnalyticsControlsProps) {
    const params = new URLSearchParams();
    // Always write the date preset, including `any`: the page defaults to 30
    // days when the parameter is absent, so omitting it would snap All Time
    // back to Last 30 days.
    params.set("dateWithin", next.dateWithin);
    if (next.dateWithin === "custom") {
      if (next.dateFrom) params.set("dateFrom", next.dateFrom);
      if (next.dateTo) params.set("dateTo", next.dateTo);
    }
    // Always write the campaign, including `all`: the page's default is MVA,
    // so an omitted parameter would silently snap back to MVA.
    params.set("campaign", next.campaign);

    const search = params.toString();
    startTransition(() => {
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    });
  }

  function changePreset(next: string) {
    if (next === "any") {
      navigate({ dateWithin: "any", campaign });
    } else if (next === "custom") {
      navigate({
        dateWithin: "custom",
        dateFrom: dateFrom || defaultAddedFrom(),
        dateTo,
        campaign,
      });
    } else {
      navigate({ dateWithin: next as AnalyticsDatePreset, campaign });
    }
  }

  function changeDates(from: string, to: string) {
    navigate({
      dateWithin: "custom",
      dateFrom: from || defaultAddedFrom(),
      dateTo: to || undefined,
      campaign,
    });
  }

  return (
    <div
      aria-busy={isPending}
      className={
        isPending
          ? "flex flex-wrap items-center gap-x-5 gap-y-3 opacity-60 transition-opacity"
          : "flex flex-wrap items-center gap-x-5 gap-y-3 transition-opacity"
      }
    >
      <DateRangeFilter
        label="Date"
        options={DATE_RANGE_ANY_OPTIONS}
        preset={dateWithin}
        from={dateFrom ?? defaultAddedFrom()}
        to={dateTo ?? ""}
        onPresetChange={changePreset}
        onChange={changeDates}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium whitespace-nowrap text-muted-foreground">
          Campaign
        </span>
        <Select
          items={CAMPAIGN_FILTER_OPTIONS.map((option) => ({ ...option }))}
          value={campaign}
          onValueChange={(value) => {
            if (!value) return;
            navigate({
              dateWithin,
              dateFrom,
              dateTo,
              campaign: value as CampaignFilterValue,
            });
          }}
        >
          <SelectTrigger
            size="sm"
            className={cn(
              "w-44",
              campaign !== "all" &&
                "border-primary/50 bg-primary/10 hover:bg-primary/15 dark:bg-primary/20 dark:hover:bg-primary/25",
            )}
            aria-label="Campaign filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CAMPAIGN_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
