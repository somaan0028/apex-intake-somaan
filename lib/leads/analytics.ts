/**
 * Analytics - acquisition performance for admins.
 *
 * Everything here reads the same `leads` table the grid does, but groups it by
 * the four attribution columns the ad platforms give us:
 *
 *   - `caseType` - the campaign (MVA / Mass Tort / a raw `utm_campaign` value)
 *   - `source`   - where the lead came from (Facebook, Google Ads, ...)
 *   - `medium`   - the channel type (`utm_medium`, e.g. `cpc`, `organic`)
 *   - `content`  - the creative (`utm_content`, e.g. a specific ad variant)
 *
 * Volume alone does not answer "what is working", so each grouped row also
 * carries the funnel outcome: how many leads qualified, retained, were sent to
 * the partner firm, or were disqualified. The dashboard turns those counts into
 * conversion rates.
 *
 * Filters mirror the leads and activity grids: a rolling date preset or a
 * custom from/to range, plus a campaign selector where `OTHER` is a bucket for
 * every stored case type that is not MVA or Mass Tort.
 *
 * The functions are server-only (they import the database) and are called from
 * the Analytics page, which re-checks the admin policy itself. The module never
 * widens visibility: an admin sees every lead, which is exactly the audience
 * this page is for.
 */
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  lte,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import {
  CAMPAIGN_FILTER_OPTIONS,
  type CampaignFilterValue,
} from "./constants";

/** URL param names, kept together so the page and the controls agree. */
export const ANALYTICS_PARAMS = {
  dateWithin: "dateWithin",
  dateFrom: "dateFrom",
  dateTo: "dateTo",
  campaign: "campaign",
} as const;

/** The date presets shared with `DateRangeFilter`. */
export type AnalyticsDatePreset =
  | "any"
  | "24h"
  | "3d"
  | "7d"
  | "30d"
  | "custom";

const DATE_PRESETS: readonly AnalyticsDatePreset[] = [
  "any",
  "24h",
  "3d",
  "7d",
  "30d",
  "custom",
];

/** The active filters for one analytics render. */
export interface AnalyticsFilters {
  dateWithin: AnalyticsDatePreset;
  /** `YYYY-MM-DD`, only meaningful for a custom range. */
  dateFrom?: string;
  /** `YYYY-MM-DD`, only meaningful for a custom range. */
  dateTo?: string;
  campaign: CampaignFilterValue;
}

/** Default custom lower bound, matching the leads/activity grids. */
export const DEFAULT_ANALYTICS_FROM_DAYS = 7;

/** Parse `YYYY-MM-DD`; the end bound covers the whole local day. */
function parseFilterDate(
  value: string | undefined,
  endOfDay = false,
): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** A valid `YYYY-MM-DD` string, or `undefined`. */
function readDateParam(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/**
 * Read filters from URL params, clamping anything unknown to a safe default.
 * A URL that carries from/to dates without a preset is treated as a custom
 * range so drilldown links keep their window.
 */
export function readAnalyticsFilters(
  params: Record<string, string | string[] | undefined>,
): AnalyticsFilters {
  const read = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const dateFrom = readDateParam(read(ANALYTICS_PARAMS.dateFrom));
  const dateTo = readDateParam(read(ANALYTICS_PARAMS.dateTo));
  const rawPreset = read(ANALYTICS_PARAMS.dateWithin);
  const dateWithin: AnalyticsDatePreset = DATE_PRESETS.includes(
    rawPreset as AnalyticsDatePreset,
  )
    ? (rawPreset as AnalyticsDatePreset)
    : dateFrom || dateTo
      ? "custom"
      : "30d";

  const rawCampaign = read(ANALYTICS_PARAMS.campaign);
  const campaign = CAMPAIGN_FILTER_OPTIONS.some(
    (option) => option.value === rawCampaign,
  )
    ? (rawCampaign as CampaignFilterValue)
    : "MVA";

  return { dateWithin, dateFrom, dateTo, campaign };
}

/** The bucket width the trend chart uses for a given window. */
type Granularity = "hour" | "day" | "week" | "month";

interface ResolvedWindow {
  start: Date;
  end: Date;
  granularity: Granularity;
}

/** The funnel counts every grouped row reports. */
export interface DimensionCounts {
  /** Every lead in the group. */
  total: number;
  /** Reached Qualified or beyond. */
  qualified: number;
  /** Reached Retained or beyond. */
  retained: number;
  /** Delivered to the partner firm. */
  sent: number;
  /** Closed as Disqualified. */
  disqualified: number;
}

/** One row of a grouped breakdown. */
export interface DimensionRow extends DimensionCounts {
  /** The stored value; "Not tracked" for empty/null. */
  key: string;
}

/** A grouped row for the source x campaign crosstab. */
export interface SourceCampaignRow extends DimensionCounts {
  source: string;
  campaign: string;
}

/** A creative + channel + campaign combination. */
export interface CombinationRow extends DimensionCounts {
  source: string;
  medium: string;
  content: string;
  campaign: string;
}

/** One bucket in the trend chart, carrying every plotted series. */
export interface TrendPoint extends DimensionCounts {
  /** Stable bucket key (hour/day/week/month). */
  key: string;
  /** Short label for the axis. */
  label: string;
  /** Full label for the hover tooltip. */
  fullLabel: string;
}

export interface CampaignAnalytics {
  filters: AnalyticsFilters;
  window: { start: Date; end: Date; granularity: Granularity };
  totals: DimensionCounts;
  byCampaign: DimensionRow[];
  bySource: DimensionRow[];
  byMedium: DimensionRow[];
  byContent: DimensionRow[];
  sourceCampaign: SourceCampaignRow[];
  combinations: CombinationRow[];
  trend: TrendPoint[];
}

/** The funnel counts for one grouped expression. */
function countsFor() {
  return {
    total: count(),
    qualified: sql<number>`sum(case when ${leads.stage} in ('QUALIFIED', 'RETAINED', 'SENT_TO_FIRM') then 1 else 0 end)`,
    retained: sql<number>`sum(case when ${leads.stage} in ('RETAINED', 'SENT_TO_FIRM') then 1 else 0 end)`,
    sent: sql<number>`sum(case when ${leads.stage} = 'SENT_TO_FIRM' then 1 else 0 end)`,
    disqualified: sql<number>`sum(case when ${leads.stage} = 'DISQUALIFIED' then 1 else 0 end)`,
  };
}

/** Normalises an aggregate row's nullable sums to numbers. */
function toCounts(row: DimensionCounts | undefined): DimensionCounts {
  return {
    total: Number(row?.total ?? 0),
    qualified: Number(row?.qualified ?? 0),
    retained: Number(row?.retained ?? 0),
    sent: Number(row?.sent ?? 0),
    disqualified: Number(row?.disqualified ?? 0),
  };
}

/**
 * A grouped attribution dimension. Empty strings and NULLs collapse into a
 * single "Not tracked" bucket so the dashboard never hides unattributed leads.
 */
function dimensionColumn(column: AnySQLiteColumn): SQL<string> {
  return sql<string>`coalesce(nullif(trim(${column}), ''), 'Not tracked')`;
}

/** Every non-date condition (currently just the campaign bucket). */
function campaignCondition(campaign: CampaignFilterValue): SQL | undefined {
  if (campaign === "all") return undefined;
  if (campaign === "OTHER") {
    // "Other" is a bucket, not just the literal code: it covers every stored
    // case type that is not one of the two ad campaigns, including raw
    // campaign values we did not recognise (e.g. `workers_comp`).
    return and(
      isNotNull(leads.caseType),
      notInArray(leads.caseType, ["MVA", "MASS_TORT"]),
    );
  }
  return eq(leads.caseType, campaign);
}

/** The earliest lead inside the campaign scope (for the "Any time" start). */
function earliestLead(campaignWhere: SQL | undefined): Date | null {
  const row = getDb()
    .select({ value: sql<number | null>`min(${leads.createdAt})` })
    .from(leads)
    .where(campaignWhere)
    .get();
  return row?.value ? new Date(row.value * 1000) : null;
}

/** A rolling preset converted to a lower bound, or `null` for custom/any. */
function presetDays(preset: AnalyticsDatePreset): number | null {
  if (preset === "24h") return 1;
  if (preset === "3d") return 3;
  if (preset === "7d") return 7;
  if (preset === "30d") return 30;
  return null;
}

/** Choose a bucket width that keeps the chart readable at every range. */
function granularityFor(start: Date, end: Date): Granularity {
  const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
  if (days <= 2) return "hour";
  if (days <= 45) return "day";
  if (days <= 180) return "week";
  return "month";
}

/**
 * Resolve the actual window. Presets roll back from now; `custom` uses the
 * picker dates (and falls back to seven days when a hand-edited URL has no
 * lower bound); `any` starts at the earliest lead in scope.
 */
function resolveWindow(
  filters: AnalyticsFilters,
  campaignWhere: SQL | undefined,
): ResolvedWindow {
  const now = new Date();
  const days = presetDays(filters.dateWithin);

  let start: Date;
  let end = now;

  if (days) {
    start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  } else {
    const from = parseFilterDate(filters.dateFrom);
    const to = parseFilterDate(filters.dateTo, true);

    if (from) {
      start = from;
    } else if (filters.dateWithin === "custom") {
      start = new Date(
        now.getTime() -
          DEFAULT_ANALYTICS_FROM_DAYS * 24 * 60 * 60 * 1000,
      );
    } else {
      start = earliestLead(campaignWhere) ?? now;
    }

    if (to && to < now) end = to;
  }

  // A reversed or hand-edited range must not produce an empty or runaway axis.
  if (start > end) start = end;

  return { start, end, granularity: granularityFor(start, end) };
}

/** Combine the window with the campaign scope. */
function dateCondition(window: ResolvedWindow): SQL | undefined {
  return and(
    gte(leads.createdAt, window.start),
    lte(leads.createdAt, window.end),
  );
}

/** Group the visible window by one attribution dimension. */
function groupByDimension(
  column: AnySQLiteColumn,
  where: SQL | undefined,
  limit: number,
): DimensionRow[] {
  const key = dimensionColumn(column);
  const rows = getDb()
    .select({ key, ...countsFor() })
    .from(leads)
    .where(where)
    .groupBy(key)
    .orderBy(desc(count()))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    key: row.key ?? "Not tracked",
    ...toCounts(row),
  }));
}

/** The totals across the whole window. */
function overallTotals(where: SQL | undefined): DimensionCounts {
  const row = getDb().select(countsFor()).from(leads).where(where).get();
  return toCounts(row);
}

/** Source x campaign, ordered by volume. */
function groupBySourceCampaign(where: SQL | undefined): SourceCampaignRow[] {
  const source = dimensionColumn(leads.source);
  const campaign = dimensionColumn(leads.caseType);
  const rows = getDb()
    .select({ source, campaign, ...countsFor() })
    .from(leads)
    .where(where)
    .groupBy(source, campaign)
    .orderBy(desc(count()))
    .all();

  return rows.map((row) => ({
    source: row.source ?? "Not tracked",
    campaign: row.campaign ?? "Not tracked",
    ...toCounts(row),
  }));
}

/** The best-converting creatives, by volume. */
function topCombinations(
  where: SQL | undefined,
  limit: number,
): CombinationRow[] {
  const source = dimensionColumn(leads.source);
  const medium = dimensionColumn(leads.medium);
  const content = dimensionColumn(leads.content);
  const campaign = dimensionColumn(leads.caseType);
  const rows = getDb()
    .select({ source, medium, content, campaign, ...countsFor() })
    .from(leads)
    .where(where)
    .groupBy(source, medium, content, campaign)
    .orderBy(desc(count()))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    source: row.source ?? "Not tracked",
    medium: row.medium ?? "Not tracked",
    content: row.content ?? "Not tracked",
    campaign: row.campaign ?? "Not tracked",
    ...toCounts(row),
  }));
}

/** The SQL bucket expression for a granularity. */
function trendExpression(granularity: Granularity): SQL<string> {
  switch (granularity) {
    case "hour":
      return sql<string>`strftime('%Y-%m-%dT%H', ${leads.createdAt}, 'unixepoch', 'localtime')`;
    case "day":
      return sql<string>`strftime('%Y-%m-%d', ${leads.createdAt}, 'unixepoch', 'localtime')`;
    case "week":
      // Monday of the week, so weekly buckets align to a real calendar week.
      return sql<string>`date(${leads.createdAt}, 'unixepoch', 'localtime', 'weekday 0', '-6 days')`;
    case "month":
      return sql<string>`strftime('%Y-%m', ${leads.createdAt}, 'unixepoch', 'localtime')`;
  }
}

const HOUR_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
});
const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const DAY_FULL_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
});
const MONTH_FULL_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

/** Monday that starts the local week containing `date`. */
function mondayOf(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

/** The first instant of the local bucket containing `date`. */
function startOfBucket(date: Date, granularity: Granularity): Date {
  const cursor = new Date(date);
  cursor.setMinutes(0, 0, 0);
  if (granularity !== "hour") cursor.setHours(0, 0, 0, 0);
  if (granularity === "week") return mondayOf(cursor);
  if (granularity === "month") cursor.setDate(1);
  return cursor;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A stable local key for the bucket containing `date`. */
function bucketKey(date: Date, granularity: Granularity): string {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  if (granularity === "hour") return `${year}-${month}-${day}T${pad(date.getHours())}`;
  if (granularity === "day") return `${year}-${month}-${day}`;
  if (granularity === "week") {
    const monday = mondayOf(date);
    return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
  }
  return `${year}-${month}`;
}

/** Parse a bucket key back into a local Date. */
function keyToDate(key: string, granularity: Granularity): Date {
  const [datePart, hourPart] = key.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  if (granularity === "month") return new Date(year, month - 1, 1);
  if (granularity === "hour") {
    return new Date(year, month - 1, day, Number(hourPart));
  }
  return new Date(year, month - 1, day);
}

/** Short axis label for a bucket key. */
function bucketLabel(key: string, granularity: Granularity): string {
  const date = keyToDate(key, granularity);
  if (granularity === "hour") return HOUR_LABEL.format(date);
  if (granularity === "day" || granularity === "week") {
    return DAY_LABEL.format(date);
  }
  return MONTH_LABEL.format(date);
}

/** Full label for the hover tooltip. */
function bucketFullLabel(key: string, granularity: Granularity): string {
  const date = keyToDate(key, granularity);
  if (granularity === "hour") return HOUR_LABEL.format(date);
  if (granularity === "day") return DAY_FULL_LABEL.format(date);
  if (granularity === "week") {
    return `Week of ${DAY_FULL_LABEL.format(date)}`;
  }
  return MONTH_FULL_LABEL.format(date);
}

/** Walk from `start` to `end` inclusive, one bucket at a time. */
function bucketsBetween(
  start: Date,
  end: Date,
  granularity: Granularity,
): string[] {
  const keys: string[] = [];
  const cursor = startOfBucket(start, granularity);
  const last = startOfBucket(end, granularity);

  while (cursor <= last) {
    keys.push(bucketKey(cursor, granularity));
    if (granularity === "hour") {
      cursor.setHours(cursor.getHours() + 1);
    } else if (granularity === "day") {
      cursor.setDate(cursor.getDate() + 1);
    } else if (granularity === "week") {
      cursor.setDate(cursor.getDate() + 7);
    } else {
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return keys;
}

/** Trend buckets, with empty periods filled in so the axis stays continuous. */
function trendFor(
  window: ResolvedWindow,
  where: SQL | undefined,
): TrendPoint[] {
  const expression = trendExpression(window.granularity);
  const rows = getDb()
    .select({ key: expression, ...countsFor() })
    .from(leads)
    .where(where)
    .groupBy(expression)
    .orderBy(expression)
    .all();

  const totalsByKey = new Map(rows.map((row) => [row.key, row]));
  return bucketsBetween(window.start, window.end, window.granularity).map(
    (key) => {
      const row = totalsByKey.get(key);
      return {
        key,
        label: bucketLabel(key, window.granularity),
        fullLabel: bucketFullLabel(key, window.granularity),
        ...toCounts(row),
      };
    },
  );
}

/**
 * Everything the Analytics page renders, for one window and campaign scope.
 *
 * The grouped queries are independent, so they run as separate round trips -
 * cheap against the indexed `case_type` and `stage` columns on a desktop-sized
 * dataset, and far easier to read than one clever union.
 */
export function campaignAnalytics(
  filters: AnalyticsFilters,
): CampaignAnalytics {
  const campaignWhere = campaignCondition(filters.campaign);
  const window = resolveWindow(filters, campaignWhere);
  const where = and(dateCondition(window), campaignWhere);

  return {
    filters,
    window,
    totals: overallTotals(where),
    byCampaign: groupByDimension(leads.caseType, where, 12),
    bySource: groupByDimension(leads.source, where, 12),
    byMedium: groupByDimension(leads.medium, where, 12),
    byContent: groupByDimension(leads.content, where, 12),
    sourceCampaign: groupBySourceCampaign(where),
    combinations: topCombinations(where, 12),
    trend: trendFor(window, where),
  };
}
