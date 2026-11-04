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
import { LEAD_SOURCES } from "@/lib/leads/constants";
import {
  ANALYTICS_RANGES,
  campaignAnalytics,
  readAnalyticsRange,
  type AnalyticsRange,
  type DimensionCounts,
  type DimensionRow,
  type TrendPoint,
} from "@/lib/leads/analytics";
import { caseTypeLabel } from "@/lib/labels";
import { can } from "@/lib/rbac";

export const metadata: Metadata = {
  title: "Campaign Analytics · Apex Intake Desk",
};

/** Percentage with no decimals; an em dash when there is nothing to divide by. */
function rate(value: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((value / total) * 100)}%`;
}

/** "MVA" instead of the raw enum, but keep raw campaign values readable. */
function campaignLabel(key: string): string {
  if (key === "Not tracked") return key;
  return caseTypeLabel(key);
}

/** Range switcher — links so the view stays server-rendered and shareable. */
function RangeTabs({ active }: { active: AnalyticsRange }) {
  return (
    <nav
      aria-label="Analytics time range"
      className="inline-flex items-center gap-1 rounded-lg border bg-card p-1"
    >
      {ANALYTICS_RANGES.map((range) => {
        const isActive = range.value === active;
        return (
          <Link
            key={range.value}
            href={
              range.value === "all"
                ? "/campaign-analytics"
                : `/campaign-analytics?range=${range.value}`
            }
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            }
          >
            {range.label}
          </Link>
        );
      })}
    </nav>
  );
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
            <table className="w-full min-w-[26rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 pb-2 font-medium">Name</th>
                  <th className="px-2 pb-2 text-right font-medium">Leads</th>
                  <th className="px-2 pb-2 text-right font-medium">
                    Qualified
                  </th>
                  <th className="px-2 pb-2 text-right font-medium">Retained</th>
                  <th className="px-2 pb-2 text-right font-medium">Sent</th>
                  <th className="px-2 pb-2 text-right font-medium">Disq.</th>
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
                      <td className="px-2 py-2 text-right tabular-nums">
                        {rate(row.qualified, row.total)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {rate(row.retained, row.total)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {row.sent}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
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

/** Best retention among rows with enough volume to be meaningful. */
function bestByRetention(
  rows: DimensionRow[],
  minimum = 10,
): DimensionRow | null {
  const eligible = rows.filter((row) => row.total >= minimum);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, row) => {
    const bestRate = best.total ? best.retained / best.total : 0;
    const rowRate = row.total ? row.retained / row.total : 0;
    return rowRate > bestRate ? row : best;
  });
}

/** Trend as CSS bars — server-rendered, responsive and accessible. */
function TrendChart({ points }: { points: TrendPoint[] }) {
  const peak = points.reduce((max, point) => Math.max(max, point.total), 0);

  if (points.length === 0 || peak === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No leads in this window yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex h-36 items-end gap-1">
        {points.map((point) => (
          <div
            key={point.key}
            className="group relative flex h-full min-w-0 flex-1 items-end"
          >
            <div
              title={`${point.label}: ${point.total} lead${point.total === 1 ? "" : "s"}`}
              aria-label={`${point.label}: ${point.total} lead${point.total === 1 ? "" : "s"}`}
              className="w-full rounded-t-sm bg-primary/70 transition-colors group-hover:bg-primary"
              style={{
                // An empty bucket stays empty; otherwise keep a visible sliver.
                height: point.total
                  ? `${Math.max(2, (point.total / peak) * 100)}%`
                  : "0%",
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Peak: {peak} lead{peak === 1 ? "" : "s"} per period.
      </p>
    </div>
  );
}

function funnelSummary(counts: DimensionCounts) {
  return {
    qualifiedRate: rate(counts.qualified, counts.total),
    retentionRate: rate(counts.retained, counts.total),
    disqualificationRate: rate(counts.disqualified, counts.total),
  };
}

export default async function CampaignAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireUser();
  // Cosmetic gating happens in the sidebar; this is the real boundary. A
  // hand-typed URL must not reach attribution data without the permission.
  if (!can(user.role, "analytics.view")) redirect("/dashboard");

  const params = await searchParams;
  const range = readAnalyticsRange(params.range);
  const data = campaignAnalytics(range);
  const totals = funnelSummary(data.totals);

  const bestSource = bestByRetention(data.bySource);
  const bestMedium = bestByRetention(data.byMedium);
  const bestContent = bestByRetention(data.byContent);

  // Campaign links only work for canonical codes; raw campaign values are
  // stored verbatim and the grid's caseType filter only accepts the enum.
  const campaignLink = (key: string) =>
    key === "MVA" || key === "MASS_TORT" || key === "OTHER"
      ? `/leads?filter.caseType=${key}`
      : null;

  // The grid's source filter accepts only the known sources, so "Not tracked"
  // and raw values get no link rather than one that silently does nothing.
  const sourceLink = (key: string) =>
    (LEAD_SOURCES as readonly string[]).includes(key)
      ? `/leads?filter.source=${encodeURIComponent(key)}`
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Campaign Analytics
          </h1>
          <p className="text-muted-foreground">
            Which campaigns, sources, mediums and creatives bring the best
            leads.
          </p>
        </div>
        <RangeTabs active={range} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          hint={`${totals.disqualificationRate} disqualified`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Leads over time</CardTitle>
            <CardDescription>
              Intake volume in the selected window.
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
              Best retention among groups with at least 10 leads.
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
            How the {data.totals.total} leads split across campaigns.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ShareBar
            rows={data.byCampaign}
            total={data.totals.total}
            colors={MIX_COLORS}
          />
          <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {data.byCampaign.map((row, index) => (
              <li
                key={row.key}
                className="flex items-center gap-2 py-1 text-sm"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: MIX_COLORS[index % MIX_COLORS.length],
                  }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {campaignLabel(row.key)}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {row.total} ({rate(row.total, data.totals.total)})
                </span>
              </li>
            ))}
          </ul>
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
              <table className="w-full min-w-[42rem] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 pb-2 font-medium">Source</th>
                    <th className="px-2 pb-2 font-medium">Medium</th>
                    <th className="px-2 pb-2 font-medium">Creative</th>
                    <th className="px-2 pb-2 font-medium">Campaign</th>
                    <th className="px-2 pb-2 text-right font-medium">Leads</th>
                    <th className="px-2 pb-2 text-right font-medium">
                      Qualified
                    </th>
                    <th className="px-2 pb-2 text-right font-medium">
                      Retained
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
                      <td className="px-2 py-2 text-right tabular-nums">
                        {rate(row.qualified, row.total)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
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
            <table className="w-full min-w-[30rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 pb-2 font-medium">Source</th>
                  <th className="px-2 pb-2 font-medium">Campaign</th>
                  <th className="px-2 pb-2 text-right font-medium">Leads</th>
                  <th className="px-2 pb-2 text-right font-medium">
                    Qualified
                  </th>
                  <th className="px-2 pb-2 text-right font-medium">Retained</th>
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
                    <td className="px-2 py-2 text-right tabular-nums">
                      {rate(row.qualified, row.total)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
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
          render={<Link href="/leads?sort=createdAt&sortDir=desc" />}
        >
          Open the lead grid
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
