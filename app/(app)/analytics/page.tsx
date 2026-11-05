import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { LEAD_SOURCES, type CampaignFilterValue } from "@/lib/leads/constants";
import {
  campaignAnalytics,
  readAnalyticsFilters,
  type AnalyticsFilters,
  type DimensionCounts,
  type DimensionRow,
} from "@/lib/leads/analytics";
import { caseTypeLabel } from "@/lib/labels";
import { can } from "@/lib/rbac";
import { AnalyticsControls } from "./analytics-controls";
import { TrendChart } from "./trend-chart";

export const metadata: Metadata = {
  title: "Analytics - Apex Intake Desk",
};

/** Percentage with no decimals; an em dash when there is nothing to divide by. */
function rate(value: number, total: number): string {
  if (total <= 0) return "\u2014";
  return `${Math.round((value / total) * 100)}%`;
}

/** "MVA" instead of the raw enum, but keep raw campaign values readable. */
function campaignLabel(key: string): string {
  if (key === "Not tracked") return key;
  return caseTypeLabel(key);
}

/** The label for the selected campaign filter. */
function campaignFilterLabel(value: CampaignFilterValue): string {
  if (value === "all") return "All campaigns";
  if (value === "OTHER") return "Other campaigns";
  return caseTypeLabel(value);
}

function granularityLabel(value: "hour" | "day" | "week" | "month"): string {
  if (value === "hour") return "Hourly";
  if (value === "day") return "Daily";
  if (value === "week") return "Weekly";
  return "Monthly";
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <Card className="gap-2">
      <CardContent className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

/** Segment colours for the campaign mix, shared by the bar and its legend. */
const MIX_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/**
 * One stacked bar for a composition. Reuses the Overview pipeline's idea: a
 * single bar compares shares better than separate bars, and each segment keeps
 * a title/aria-label for screen readers and hover.
 */
function ShareBar({
  rows,
  total,
  colors,
}: {
  rows: DimensionRow[];
  total: number;
  colors: string[];
}) {
  if (total <= 0) {
    return (
      <div className="flex h-3 w-full items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
        No data in this window
      </div>
    );
  }

  return (
    <div className="flex h-3 w-full gap-px overflow-hidden rounded-full bg-muted">
      {rows.map((row, index) => {
        if (row.total === 0) return null;
        const share = (row.total / total) * 100;
        return (
          <div
            key={row.key}
            title={`${campaignLabel(row.key)}: ${row.total} (${Math.round(share)}%)`}
            aria-label={`${campaignLabel(row.key)}: ${row.total} leads`}
            className="h-full"
            style={{
              width: `${share}%`,
              backgroundColor: colors[index % colors.length],
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * The campaign mix legend. Each row is its own bordered card with a fixed-width
 * percentage, so a left column's value can never visually run into the next
 * column's label (the bug in the old two-column key).
 */
function CampaignMixLegend({
  rows,
  total,
}: {
  rows: DimensionRow[];
  total: number;
}) {
  if (rows.length === 0 || total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No campaign data in this window.
      </p>
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {rows.map((row, index) => {
        const share = total > 0 ? (row.total / total) * 100 : 0;
        const color = MIX_COLORS[index % MIX_COLORS.length];
        return (
          <li
            key={row.key}
            className="rounded-lg border bg-muted/20 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {campaignLabel(row.key)}
              </span>
              <span className="text-sm font-medium tabular-nums">
                {row.total}
              </span>
              <span className="w-11 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {rate(row.total, total)}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, share)}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The dimension table: volume plus the funnel outcomes that show quality. */
function DimensionTable({
  title,
  description,
  rows,
  total,
  labelFor,
  emptyHint,
  linkFor,
}: {
  title: string;
  description: string;
  rows: DimensionRow[];
  total: number;
  labelFor: (key: string) => string;
  emptyHint: string;
  linkFor?: (key: string) => string | null;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 || total === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[28rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 pb-2 font-medium">Name</th>
                  <th className="px-2 pb-2 text-right font-medium">Leads</th>
                  <th className="px-2 pb-2 text-right font-medium">
                    Qualified %
                  </th>
                  <th className="px-2 pb-2 text-right font-medium">
                    Retained %
                  </th>
                  <th className="px-2 pb-2 text-right font-medium">Sent</th>
                  <th className="px-2 pb-2 text-right font-medium">Disq. %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const href = linkFor?.(row.key) ?? null;
                  const name = labelFor(row.key);
                  return (
                    <tr key={row.key} className="border-t">
                      <td className="max-w-[12rem] px-2 py-2">
                        <div className="flex items-center gap-2">
                          {href ? (
                            <Link
                              href={href}
                              className="truncate hover:underline"
                            >
                              {name}
                            </Link>
                          ) : (
                            <span className="truncate">{name}</span>
                          )}
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {rate(row.total, total)}
                          </span>
                        </div>
                        <div
                          aria-hidden
                          className="mt-1 h-1 rounded-full bg-muted"
                        >
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{
                              width: `${Math.min(100, (row.total / total) * 100)}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {row.total}
                      </td>
                      <td
                        className="px-2 py-2 text-right tabular-nums"
                        title={`${row.qualified} of ${row.total} leads`}
                      >
                        {rate(row.qualified, row.total)}
                      </td>
                      <td
                        className="px-2 py-2 text-right tabular-nums"
                        title={`${row.retained} of ${row.total} leads`}
                      >
                        {rate(row.retained, row.total)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {row.sent}
                      </td>
                      <td
                        className="px-2 py-2 text-right tabular-nums"
                        title={`${row.disqualified} of ${row.total} leads`}
                      >
                        {rate(row.disqualified, row.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A row in the "what's working" callout. */
function BestCard({
  label,
  row,
  labelFor,
}: {
  label: string;
  row: DimensionRow | null;
  labelFor: (key: string) => string;
}) {
  if (!row) {
    return (
      <div className="rounded-lg border bg-muted/40 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Not enough data in this window.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="truncate text-sm font-medium">{labelFor(row.key)}</p>
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {rate(row.retained, row.total)} retained
        </Badge>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {row.total} leads · {row.qualified} qualified · {row.sent} sent to firm
      </p>
    </div>
  );
}

/**
 * Best retention among groups with enough volume to be meaningful.
 *
 * "Not tracked" is excluded: unattributed leads are a data gap, not a channel
 * that is working, and they would otherwise win every time UTM data is absent.
 */
const MIN_BEST_VOLUME = 25;

function bestByRetention(rows: DimensionRow[]): DimensionRow | null {
  const eligible = rows.filter(
    (row) => row.key !== "Not tracked" && row.total >= MIN_BEST_VOLUME,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, row) => {
    const bestRate = best.total ? best.retained / best.total : 0;
    const rowRate = row.total ? row.retained / row.total : 0;
    return rowRate > bestRate ? row : best;
  });
}

/** Leads links carry the current window and campaign so a drilldown matches. */
function leadsHref(
  filters: AnalyticsFilters,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams();
  if (filters.dateWithin !== "any") {
    params.set("filter.addedWithin", filters.dateWithin);
    if (filters.dateWithin === "custom") {
      if (filters.dateFrom) params.set("filter.addedFrom", filters.dateFrom);
      if (filters.dateTo) params.set("filter.addedTo", filters.dateTo);
    }
  }
  if (filters.campaign !== "all") {
    params.set("filter.caseType", filters.campaign);
  }
  for (const [key, value] of Object.entries(extra)) {
    params.set(key, value);
  }
  const search = params.toString();
  return search ? `/leads?${search}` : "/leads";
}

function funnelSummary(counts: DimensionCounts) {
  return {
    qualifiedRate: rate(counts.qualified, counts.total),
    retentionRate: rate(counts.retained, counts.total),
    sentRate: rate(counts.sent, counts.total),
    disqualificationRate: rate(counts.disqualified, counts.total),
  };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireUser();
  // Cosmetic gating happens in the sidebar; this is the real boundary. A
  // hand-typed URL must not reach attribution data without the permission.
  if (!can(user.role, "analytics.view")) redirect("/dashboard");

  const filters = readAnalyticsFilters(await searchParams);
  const data = campaignAnalytics(filters);
  const totals = funnelSummary(data.totals);
  const filtered = filters.campaign !== "all";

  const bestSource = bestByRetention(data.bySource);
  const bestMedium = bestByRetention(data.byMedium);
  const bestContent = bestByRetention(data.byContent);

  // Campaign links only work for canonical codes; raw campaign values are
  // stored verbatim and the grid's caseType filter only accepts the enum.
  const campaignLink = (key: string) =>
    key === "MVA" || key === "MASS_TORT" || key === "OTHER"
      ? leadsHref(filters, { "filter.caseType": key })
      : null;

  // The grid's source filter accepts only the known sources, so "Not tracked"
  // and raw values get no link rather than one that silently does nothing.
  const sourceLink = (key: string) =>
    (LEAD_SOURCES as readonly string[]).includes(key)
      ? leadsHref(filters, { "filter.source": key })
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">
            Which campaigns, sources, mediums and creatives bring the best
            leads.
            {filtered ? (
              <span className="ml-1">
                Showing {campaignFilterLabel(filters.campaign)} only.
              </span>
            ) : null}
          </p>
        </div>
        <AnalyticsControls
          dateWithin={filters.dateWithin}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          campaign={filters.campaign}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Leads"
          value={data.totals.total}
          hint="Captured in this window"
        />
        <KpiCard
          label="Qualified+"
          value={data.totals.qualified}
          hint={`${totals.qualifiedRate} of all leads`}
        />
        <KpiCard
          label="Retained+"
          value={data.totals.retained}
          hint={`${totals.retentionRate} of all leads`}
        />
        <KpiCard
          label="Sent to firm"
          value={data.totals.sent}
          hint={`${totals.sentRate} of all leads`}
        />
        <KpiCard
          label="Disqualified"
          value={data.totals.disqualified}
          hint={`${totals.disqualificationRate} of all leads`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Leads over time</CardTitle>
            <CardDescription>
              {granularityLabel(data.window.granularity)} intake volume and
              funnel outcomes in the selected window.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart points={data.trend} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What&apos;s working</CardTitle>
            <CardDescription>
              Best retention among groups with at least {MIN_BEST_VOLUME} leads.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <BestCard label="Source" row={bestSource} labelFor={(key) => key} />
            <BestCard label="Medium" row={bestMedium} labelFor={(key) => key} />
            <BestCard
              label="Creative"
              row={bestContent}
              labelFor={(key) => key}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campaign mix</CardTitle>
          <CardDescription>
            {filtered
              ? `${data.totals.total} leads from ${campaignFilterLabel(filters.campaign)} in this window.`
              : `How the ${data.totals.total} leads split across campaigns.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ShareBar
            rows={data.byCampaign}
            total={data.totals.total}
            colors={MIX_COLORS}
          />
          <CampaignMixLegend rows={data.byCampaign} total={data.totals.total} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <DimensionTable
          title="Sources"
          description="Where the leads come from."
          rows={data.bySource}
          total={data.totals.total}
          labelFor={(key) => key}
          emptyHint="No source data in this window."
          linkFor={sourceLink}
        />
        <DimensionTable
          title="Mediums"
          description="The channel type captured from UTM parameters."
          rows={data.byMedium}
          total={data.totals.total}
          labelFor={(key) => key}
          emptyHint="No medium data in this window."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DimensionTable
          title="Campaigns"
          description="MVA, Mass Tort and any other campaign values."
          rows={data.byCampaign}
          total={data.totals.total}
          labelFor={(key) => campaignLabel(key)}
          emptyHint="No campaign data in this window."
          linkFor={campaignLink}
        />
        <DimensionTable
          title="Creatives"
          description="The ad variants (UTM content) that brought leads in."
          rows={data.byContent}
          total={data.totals.total}
          labelFor={(key) => key}
          emptyHint="No creative data in this window."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top combinations</CardTitle>
          <CardDescription>
            Source × medium × creative × campaign, by volume. The retention
            column is the quickest read on quality.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.combinations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No attribution combinations in this window.
            </p>
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 pb-2 font-medium">Source</th>
                    <th className="px-2 pb-2 font-medium">Medium</th>
                    <th className="px-2 pb-2 font-medium">Creative</th>
                    <th className="px-2 pb-2 font-medium">Campaign</th>
                    <th className="px-2 pb-2 text-right font-medium">Leads</th>
                    <th className="px-2 pb-2 text-right font-medium">
                      Qualified %
                    </th>
                    <th className="px-2 pb-2 text-right font-medium">
                      Retained %
                    </th>
                    <th className="px-2 pb-2 text-right font-medium">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {data.combinations.map((row, index) => (
                    <tr
                      key={`${row.source}-${row.medium}-${row.content}-${row.campaign}-${index}`}
                      className="border-t"
                    >
                      <td className="px-2 py-2">{row.source}</td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {row.medium}
                      </td>
                      <td className="max-w-[12rem] truncate px-2 py-2">
                        {row.content}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant="secondary">
                          {campaignLabel(row.campaign)}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {row.total}
                      </td>
                      <td
                        className="px-2 py-2 text-right tabular-nums"
                        title={`${row.qualified} of ${row.total} leads`}
                      >
                        {rate(row.qualified, row.total)}
                      </td>
                      <td
                        className="px-2 py-2 text-right tabular-nums"
                        title={`${row.retained} of ${row.total} leads`}
                      >
                        {rate(row.retained, row.total)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {row.sent}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source × campaign</CardTitle>
          <CardDescription>
            Which channel produces which kind of case. Retained is the column to
            watch.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 pb-2 font-medium">Source</th>
                  <th className="px-2 pb-2 font-medium">Campaign</th>
                  <th className="px-2 pb-2 text-right font-medium">Leads</th>
                  <th className="px-2 pb-2 text-right font-medium">
                    Qualified %
                  </th>
                  <th className="px-2 pb-2 text-right font-medium">
                    Retained %
                  </th>
                  <th className="px-2 pb-2 text-right font-medium">Sent</th>
                </tr>
              </thead>
              <tbody>
                {data.sourceCampaign.map((row, index) => (
                  <tr
                    key={`${row.source}-${row.campaign}-${index}`}
                    className="border-t"
                  >
                    <td className="px-2 py-2">{row.source}</td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {campaignLabel(row.campaign)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.total}
                    </td>
                    <td
                      className="px-2 py-2 text-right tabular-nums"
                      title={`${row.qualified} of ${row.total} leads`}
                    >
                      {rate(row.qualified, row.total)}
                    </td>
                    <td
                      className="px-2 py-2 text-right tabular-nums"
                      title={`${row.retained} of ${row.total} leads`}
                    >
                      {rate(row.retained, row.total)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.sent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Attribution is captured from UTM parameters. Imported CRM leads may
          not carry medium or content.
        </span>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={leadsHref(filters)} />}
        >
          Open the lead grid
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
