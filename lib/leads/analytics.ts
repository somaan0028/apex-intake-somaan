/**
 * Campaign Analytics — acquisition performance for admins.
 *
 * Everything here reads the same `leads` table the grid does, but groups it by
 * the four attribution columns the ad platforms give us:
 *
 *   - `caseType` — the campaign (MVA / Mass Tort / a raw `utm_campaign` value)
 *   - `source`   — where the lead came from (Facebook, Google Ads, …)
 *   - `medium`   — the channel type (`utm_medium`, e.g. `cpc`, `organic`)
 *   - `content`  — the creative (`utm_content`, e.g. a specific ad variant)
 *
 * Volume alone does not answer "what is working", so each grouped row also
 * carries the funnel outcome: how many leads qualified, retained, were sent to
 * the partner firm, or were disqualified. The dashboard turns those counts into
 * conversion rates.
 *
 * The functions are server-only (they import the database) and are called from
 * the Campaign Analytics page, which re-checks the admin policy itself. The
 * module never widens visibility: an admin sees every lead, which is exactly
 * the audience this page is for.
 */
import { count, desc, gte, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "@/lib/db";
import { leads } from "@/lib/db/schema";

/** How far back the dashboard can look. `all` means no lower bound. */
export const ANALYTICS_RANGES = [
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
  { value: "12m", label: "12 months", days: 365 },
  { value: "all", label: "All time", days: null },
] as const;

export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number]["value"];

/** The default when the URL carries no (or an unknown) range. */
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = "all";

/** Reads a range from URL params, falling back to the default. */
export function readAnalyticsRange(
  value: string | string[] | undefined,
): AnalyticsRange {
  const raw = Array.isArray(value) ? value[0] : value;
  return (
    ANALYTICS_RANGES.find((range) => range.value === raw)?.value ??
    DEFAULT_ANALYTICS_RANGE
  );
}

/** The lower bound of `range`, or `undefined` for all time. */
function rangeCondition(range: AnalyticsRange): SQL | undefined {
  const days = ANALYTICS_RANGES.find((entry) => entry.value === range)?.days;
  if (!days) return undefined;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return gte(leads.createdAt, since);
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

/** A grouped row for the source × campaign crosstab. */
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

/** One bucket in the trend chart. */
export interface TrendPoint {
  /** Stable bucket key (day/week/month). */
  key: string;
  /** Display label for the axis. */
  label: string;
  total: number;
}

export interface CampaignAnalytics {
  range: AnalyticsRange;
  totals: DimensionCounts;
  byCampaign: DimensionRow[];
  bySource: DimensionRow[];
  byMedium: DimensionRow[];
  byContent: DimensionRow[];
  sourceCampaign: SourceCampaignRow[];
  combinations: CombinationRow[];
  trend: TrendPoint[];
}

/** `count(*)` as a plain number. */
function totalLeads(where: SQL | undefined): number {
  return getDb().select({ value: count() }).from(leads).where(where).get()?.value ?? 0;
}

/** Funnel counts for one grouped expression. */
function countsFor(where: SQL | undefined) {
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
    total: row?.total ?? 0,
    qualified: row?.qualified ?? 0,
    retained: row?.retained ?? 0,
    sent: row?.sent ?? 0,
    disqualified: row?.disqualified ?? 0,
  };
}

/**
 * A grouped attribution dimension. Empty strings and NULLs collapse into a
 * single "Not tracked" bucket so the dashboard never hides unattributed leads.
 */
function dimensionColumn(column: AnySQLiteColumn): SQL<string> {
  return sql<string>`coalesce(nullif(trim(${column}), ''), 'Not tracked')`;
}

/** Group the visible window by one attribution dimension. */
function groupByDimension(
  column: AnySQLiteColumn,
  where: SQL | undefined,
  limit: number,
): DimensionRow[] {
  const key = dimensionColumn(column);
  const rows = getDb()
    .select({ key, ...countsFor(where) })
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
  const row = getDb()
    .select(countsFor(where))
    .from(leads)
    .where(where)
    .get();
  return toCounts(row);
}

/** Source × campaign, ordered by volume. */
function groupBySourceCampaign(where: SQL | undefined): SourceCampaignRow[] {
  const source = dimensionColumn(leads.source);
  const campaign = dimensionColumn(leads.caseType);
  const rows = getDb()
    .select({ source, campaign, ...countsFor(where) })
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
    .select({ source, medium, content, campaign, ...countsFor(where) })
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

/**
 * The trend bucket expression. Daily buckets for short windows read better than
 * a smooth line over 30 points, and monthly buckets keep a year readable.
 */
function trendExpression(range: AnalyticsRange): SQL<string> {
  if (range === "7d" || range === "30d") {
    return sql<string>`strftime('%Y-%m-%d', ${leads.createdAt}, 'unixepoch')`;
  }
  if (range === "90d") {
    // Monday of the week, so weekly buckets align to a real calendar week.
    return sql<string>`date(${leads.createdAt}, 'unixepoch', 'weekday 0', '-6 days')`;
  }
  return sql<string>`strftime('%Y-%m', ${leads.createdAt}, 'unixepoch')`;
}

const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

function bucketKey(date: Date, range: AnalyticsRange): string {
  if (range === "7d" || range === "30d") return date.toISOString().slice(0, 10);
  if (range === "90d") return mondayOf(date).toISOString().slice(0, 10);
  return date.toISOString().slice(0, 7);
}

function bucketLabel(key: string, range: AnalyticsRange): string {
  if (range === "90d" || range === "7d" || range === "30d") {
    return DAY_LABEL.format(new Date(`${key}T00:00:00Z`));
  }
  return MONTH_LABEL.format(new Date(`${key}-01T00:00:00Z`));
}

/** UTC Monday that starts the week containing `date`. */
function mondayOf(date: Date): Date {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

/** Walk from `start` to `end` inclusive, one bucket at a time. */
function bucketsBetween(
  start: Date,
  end: Date,
  range: AnalyticsRange,
): string[] {
  const keys: string[] = [];
  const cursor = new Date(start);
  const stepDays = range === "7d" || range === "30d" ? 1 : 7;
  if (range === "12m" || range === "all") {
    cursor.setUTCDate(1);
  }
  while (cursor <= end) {
    keys.push(bucketKey(cursor, range));
    if (range === "12m" || range === "all") {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + stepDays);
    }
  }
  return keys;
}

/** The earliest lead's timestamp, for the "all time" trend start. */
function earliestLead(): Date | null {
  const row = getDb()
    .select({ value: sql<number | null>`min(${leads.createdAt})` })
    .from(leads)
    .get();
  return row?.value ? new Date(row.value * 1000) : null;
}

/** Trend buckets, with empty periods filled in so the axis stays continuous. */
function trendFor(range: AnalyticsRange, where: SQL | undefined): TrendPoint[] {
  const expression = trendExpression(range);
  const rows = getDb()
    .select({ key: expression, total: count() })
    .from(leads)
    .where(where)
    .groupBy(expression)
    .orderBy(expression)
    .all();

  const now = new Date();
  const days = ANALYTICS_RANGES.find((entry) => entry.value === range)?.days;
  let start: Date;
  if (days) {
    start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  } else {
    start = earliestLead() ?? now;
  }
  if (range === "90d") start = mondayOf(start);
  if (range === "12m" || range === "all") {
    start = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  }

  const totalsByKey = new Map(rows.map((row) => [row.key, row.total]));
  return bucketsBetween(start, now, range).map((key) => ({
    key,
    label: bucketLabel(key, range),
    total: totalsByKey.get(key) ?? 0,
  }));
}

/**
 * Everything the Campaign Analytics page renders, for one time window.
 *
 * The grouped queries are independent, so they run as separate round trips —
 * cheap against the indexed `case_type` and `stage` columns on a desktop-sized
 * dataset, and far easier to read than one clever union.
 */
export function campaignAnalytics(
  range: AnalyticsRange,
): CampaignAnalytics {
  const where = rangeCondition(range);

  return {
    range,
    totals: overallTotals(where),
    byCampaign: groupByDimension(leads.caseType, where, 12),
    bySource: groupByDimension(leads.source, where, 12),
    byMedium: groupByDimension(leads.medium, where, 12),
    byContent: groupByDimension(leads.content, where, 12),
    sourceCampaign: groupBySourceCampaign(where),
    combinations: topCombinations(where, 12),
    trend: trendFor(range, where),
  };
}

/** Exposed for callers that need the same "leads in this window" count. */
export function analyticsLeadCount(range: AnalyticsRange): number {
  return totalLeads(rangeCondition(range));
}
