import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AlertBar } from "@/components/alert-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { recentActivities } from "@/lib/activities/queries";
import { LEAD_STAGES } from "@/lib/db/schema";
import { formatRelativeTime } from "@/lib/format";
import { LEAD_STAGE_LABELS, caseTypeLabel } from "@/lib/labels";
import { leadMetrics, recentLeads } from "@/lib/leads/metrics";
import { can } from "@/lib/rbac";
import { AssistantInvite } from "./assistant-invite";

export const metadata: Metadata = {
  title: "Overview · Apex Intake Desk",
};

/** A headline number, linked to the grid it was counted from. */
function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: number;
  hint: string;
  href: string;
}) {
  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-none">
      <Card className="h-full gap-2 transition-colors hover:border-primary/40">
        <CardContent className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Stages the pipeline shows. Disqualified closes a lead, so those rows are not
 * part of the active pipeline the card is describing.
 */
const PIPELINE_STAGES = LEAD_STAGES.filter(
  (stage) => stage !== "DISQUALIFIED",
);

/** Stage-by-stage breakdown as one stacked bar, with a legend below it. */
function Pipeline({
  byStage,
  className,
}: {
  byStage: Record<string, number>;
  className?: string;
}) {
  const total = PIPELINE_STAGES.reduce(
    (sum, stage) => sum + (byStage[stage] ?? 0),
    0,
  );

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Pipeline</CardTitle>
        <CardDescription>
          {total} lead{total === 1 ? "" : "s"} across different stages.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No leads yet, so there is nothing to break down.
          </p>
        ) : (
          <>
            <div className="flex h-4 w-full gap-px overflow-hidden rounded-full bg-muted">
              {PIPELINE_STAGES.map((stage) => {
                const value = byStage[stage] ?? 0;
                if (value === 0) return null;
                const label = LEAD_STAGE_LABELS[stage];
                return (
                  <Link
                    key={stage}
                    href={`/leads?filter.stage=${stage}`}
                    title={`${label}: ${value}`}
                    aria-label={`${label}: ${value} lead${value === 1 ? "" : "s"}`}
                    className="h-full outline-offset-2 transition-opacity hover:opacity-80"
                    style={{
                      // A share of the width rather than a fixed size, so the bar
                      // always spans the card exactly.
                      width: `${(value / total) * 100}%`,
                      backgroundColor: `var(--stage-${stage.toLowerCase()})`,
                    }}
                  />
                );
              })}
            </div>

            <Legend byStage={byStage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The key for the stacked bar: a two-column grid so it stays compact even with
 * six stages, each row linking to that stage in the grid.
 */
function Legend({ byStage }: { byStage: Record<string, number> }) {
  return (
    <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
      {PIPELINE_STAGES.map((stage) => {
        const value = byStage[stage] ?? 0;
        return (
          <li key={stage}>
            <Link
              href={`/leads?filter.stage=${stage}`}
              className="flex items-center gap-2 rounded-md py-1.5 text-sm hover:underline"
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: `var(--stage-${stage.toLowerCase()})`,
                }}
              />
              <span className="min-w-0 flex-1 truncate">
                {LEAD_STAGE_LABELS[stage]}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {value}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The newest visible leads, with a link through to the full grid. */
function LatestIntake({
  leads,
  className,
}: {
  leads: ReturnType<typeof recentLeads>;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Latest intake</CardTitle>
        <CardDescription>
          Leads that have recently been added to the system
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/leads" />}
          >
            See all leads
            <ArrowRight />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No leads yet. Submissions from the public intake form will appear
            here.
          </p>
        ) : (
          <ul className="divide-y">
            {leads.map((lead) => {
              const name = lead.injuredName ?? "Unnamed lead";
              return (
                <li key={lead.id}>
                  <Link
                    href={`/leads?search=${encodeURIComponent(name)}`}
                    className="flex items-center gap-3 py-2.5"
                  >
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">
                      {name}
                    </p>
                    <div className="flex shrink-0 items-center gap-3">
                      <time
                        dateTime={lead.createdAt?.toISOString()}
                        className="whitespace-nowrap text-xs text-muted-foreground"
                      >
                        {formatRelativeTime(lead.createdAt)}
                      </time>
                      <Badge variant="secondary" className="shrink-0">
                        {lead.caseType ? caseTypeLabel(lead.caseType) : "—"}
                      </Badge>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The newest actions the viewer may see. Admins get the whole desk; everyone
 * else only their own rows, exactly like the Activity page. Times are relative
 * because this is a glance-at-it feed, not the audit log.
 */
function RecentActivity({
  activities,
  className,
}: {
  activities: ReturnType<typeof recentActivities>;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
        <CardDescription>Latest actions that have taken place.</CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/activity" />}
          >
            View all
            <ArrowRight />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No activity yet.
          </p>
        ) : (
          <ul className="divide-y">
            {activities.map((activity) => (
              <li
                key={activity.id}
                className="flex items-start gap-3 py-2.5"
              >
                <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug">
                  <span className="mr-2 font-medium">
                    {activity.doerName}:
                  </span>
                  <span className="text-muted-foreground">
                    {activity.description}
                  </span>
                  {activity.affectedLeadName ? (
                    <span className="text-muted-foreground">
                      {" · "}Lead: {activity.affectedLeadName}
                    </span>
                  ) : null}
                </p>
                <time
                  dateTime={activity.createdAt.toISOString()}
                  className="shrink-0 whitespace-nowrap pt-0.5 text-xs text-muted-foreground"
                >
                  {formatRelativeTime(activity.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function OverviewPage() {
  const user = await requireUser();
  const metrics = leadMetrics(user);
  const latest = recentLeads(user, 7);
  const activity = recentActivities(user, 5);

  const firstName = user.name.split(" ")[0] ?? user.name;
  // The stage filter the headline cards land on: every open stage, so the grid
  // shows the same leads the card counted (Disqualified is closed).
  const activeStages = LEAD_STAGES.filter(
    (stage) => stage !== "DISQUALIFIED",
  ).join(",");
  // Only an admin can send to the firm, so only an admin is shown a queue for it.
  const showSendQueue = can(user.role, "leads.send_to_firm");
  const hasAlerts =
    (showSendQueue && metrics.readyToSend > 0) ||
    metrics.potentialDuplicates > 0;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">
          See what is happening across your leads.
        </p>
      </div>

      {/* Time-sensitive queues come first, but they are notices, not content.
          Each bar grows to share the row; a 20rem basis makes the second wrap
          onto its own full-width line when the header runs out of room. */}
      {hasAlerts ? (
        <div className="flex flex-wrap items-center gap-2">
          {showSendQueue && metrics.readyToSend > 0 ? (
            <AlertBar
              tone="positive"
              className="grow basis-80"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  // Rendering as an anchor: Base UI needs to know it is not a real
                  // <button> (same convention as `components/ui/pagination.tsx`).
                  nativeButton={false}
                  render={
                    <Link href="/leads?filter.stage=RETAINED&filter.caseType=MVA" />
                  }
                >
                  Review them
                  <ArrowRight />
                </Button>
              }
            >
              <span className="font-medium">
                {metrics.readyToSend} MVA lead
                {metrics.readyToSend === 1 ? "" : "s"}
              </span>{" "}
              {metrics.readyToSend === 1 ? "is" : "are"} retained and ready for
              Brightwater
            </AlertBar>
          ) : null}

          {metrics.potentialDuplicates > 0 ? (
            <AlertBar
              tone="warning"
              className="grow basis-80"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/leads?filter.potentialDuplicate=yes" />}
                >
                  Review duplicates
                  <ArrowRight />
                </Button>
              }
            >
              <span className="font-medium">
                {metrics.potentialDuplicates} potential duplicate lead
                {metrics.potentialDuplicates === 1 ? "" : "s"}
              </span>{" "}
              {metrics.potentialDuplicates === 1 ? "needs" : "need"} review
            </AlertBar>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Active leads"
          value={metrics.total}
          hint="Open leads, excluding Disqualified"
          href={`/leads?filter.stage=${activeStages}`}
        />
        <StatCard
          label="Unassigned"
          value={metrics.unassigned}
          hint="Active and waiting to be claimed"
          href={`/leads?filter.assignedTo=unassigned&filter.stage=${activeStages}`}
        />
        <StatCard
          label="New this week"
          value={metrics.newThisWeek}
          hint="Arrived in the last 7 days"
          href="/leads?filter.addedWithin=7d&sort=createdAt&sortDir=desc"
        />
        <StatCard
          label="Assigned to you"
          value={metrics.assignedToMe}
          hint="Active leads you own"
          href={`/leads?filter.assignedTo=${user.id}&filter.stage=${activeStages}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AssistantInvite
          firstName={firstName}
          className="lg:col-start-2 lg:row-start-1"
        />
        <RecentActivity
          activities={activity}
          className="lg:col-start-2 lg:row-start-2"
        />
        <Pipeline
          byStage={metrics.byStage}
          className="lg:col-start-1 lg:row-start-1"
        />
        <LatestIntake leads={latest} className="lg:col-start-1 lg:row-start-2" />
      </div>
    </div>
  );
}
