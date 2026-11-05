/**
 * The assistant's tool layer — the one place the assistant's capabilities are
 * defined.
 *
 * Every tool is built for a specific actor and calls the same services the UI
 * uses, so the assistant can do exactly what that person can do and nothing
 * more. The tool set is deliberately decoupled from the HTTP chat route: the
 * MCP server exposes `buildAiTools(actor)` to an external agent unchanged, which
 * is why nothing here depends on the request or the UI.
 *
 * Two actions are deliberately absent and additionally refused by the services
 * when `isAi` is set: **sending a lead to the firm** and **deleting a lead**.
 * Those stay human decisions.
 *
 * Refusals come back as `{ error }` rather than thrown, so the model can read
 * the reason and explain it instead of failing the whole turn.
 */
import { toolDefinition } from "@tanstack/ai";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { LEAD_HISTORY_TYPES } from "@/lib/activities/history";
import { listActivities } from "@/lib/activities/queries";
import { ForbiddenError } from "@/lib/auth/authorize";
import { getDb } from "@/lib/db";
import {
  CASE_TYPES,
  LEAD_STAGES,
  activities,
  leadBookmarks,
  leads,
  users,
  type Lead,
} from "@/lib/db/schema";
import {
  LEAD_STAGE_LABELS,
  caseTypeLabel,
  relationshipLabel,
} from "@/lib/labels";
import {
  campaignAnalytics,
  readAnalyticsFilters,
  type AnalyticsDatePreset,
} from "@/lib/leads/analytics";
import {
  LEAD_SOURCES,
  UNASSIGNED,
} from "@/lib/leads/constants";
import type { LeadFieldPatch } from "@/lib/leads/editable";
import { leadMetrics } from "@/lib/leads/metrics";
import {
  leadsVisibilityCondition,
  listLeads,
  type LeadRow,
} from "@/lib/leads/queries";
import {
  checkLeadForDuplicatesForActor,
  markLeadNotDuplicateForActor,
  requireVisibleLead,
  saveLeadFieldsForActor,
  sendEligibilityForActor,
  setLeadBookmarkForActor,
  updateLeadForActor,
} from "@/lib/leads/service";
import { can, type Actor } from "@/lib/rbac";
import { listAssignableUsers } from "@/lib/users/queries";
import { MAX_TOOL_ROWS } from "./config";

/** Case-type filter values; `OTHER` is the grid's raw-campaign bucket. */
const CASE_TYPE_FILTERS = CASE_TYPES;

/** Quad-state text for a nullable boolean column (`null` = not recorded). */
function triState(value: boolean | null): string {
  if (value === null) return "Unknown";
  return value ? "Yes" : "No";
}

function personName(first: string | null, last: string | null): string | null {
  const name = [first, last].filter(Boolean).join(" ");
  return name || null;
}

function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** The assignee's display name, or "Unassigned". */
function assigneeName(assignedToId: number | null): string {
  if (assignedToId === null) return "Unassigned";
  return (
    getDb()
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, assignedToId))
      .get()?.name ?? `User #${assignedToId}`
  );
}

/** The compact shape list tools return, so a page of leads stays cheap. */
function leadSummary(lead: LeadRow) {
  return {
    leadId: lead.id,
    stage: LEAD_STAGE_LABELS[lead.stage],
    caseType: lead.caseType ? caseTypeLabel(lead.caseType) : null,
    injuredPerson: personName(lead.injuredFirstName, lead.injuredLastName),
    phone: lead.injuredPhone,
    email: lead.injuredEmail,
    assignedTo: lead.assignedToName ?? "Unassigned",
    createdOn: isoDate(lead.createdAt),
    mayBeSamePersonAsAnotherLead: lead.dupGroupId !== null,
    otherSimilarLeads: Math.max(lead.dupGroupCount - 1, 0),
    bookmarked: lead.bookmarked,
  };
}

/** How many other similar leads this one has, and how many the viewer can open. */
function duplicateInfo(actor: Actor, lead: Lead) {
  if (lead.dupGroupId === null) {
    return {
      mayBeSamePersonAsAnotherLead: false,
      otherSimilarLeads: 0,
      otherSimilarLeadsYouCanSee: 0,
    };
  }

  const groupId = lead.dupGroupId;
  const groupSize =
    getDb()
      .select({ value: count() })
      .from(leads)
      .where(eq(leads.dupGroupId, groupId))
      .get()?.value ?? 0;

  const visibleMembers =
    getDb()
      .select({ value: count() })
      .from(leads)
      .where(
        and(eq(leads.dupGroupId, groupId), leadsVisibilityCondition(actor)),
      )
      .get()?.value ?? 0;

  return {
    mayBeSamePersonAsAnotherLead: true,
    otherSimilarLeads: Math.max(groupSize - 1, 0),
    otherSimilarLeadsYouCanSee: Math.max(visibleMembers - 1, 0),
  };
}

/** Whether the actor has bookmarked this lead. */
function isBookmarked(actor: Actor, leadId: number): boolean {
  return Boolean(
    getDb()
      .select({ leadId: leadBookmarks.leadId })
      .from(leadBookmarks)
      .where(
        and(
          eq(leadBookmarks.userId, actor.id),
          eq(leadBookmarks.leadId, leadId),
        ),
      )
      .get(),
  );
}

/**
 * The detail shape for a single lead. Attribution is only present when the
 * actor holds `leads.view.attribution`, matching the grid and the dialog.
 */
function leadDetail(actor: Actor, lead: Lead) {
  const showAttribution = can(actor.role, "leads.view.attribution");
  const eligibility = sendEligibilityForActor(actor, lead);

  return {
    leadId: lead.id,
    stage: LEAD_STAGE_LABELS[lead.stage],
    caseType: lead.caseType ? caseTypeLabel(lead.caseType) : null,
    createdOn: isoDate(lead.createdAt),
    assignedTo: assigneeName(lead.assignedToId),
    assignedToId: lead.assignedToId,
    injuredPerson: personName(lead.injuredFirstName, lead.injuredLastName),
    injuredPhone: lead.injuredPhone,
    injuredEmail: lead.injuredEmail,
    dateOfAccident: isoDate(lead.dateOfAccident),
    submittedBySomeoneElse: lead.isFillingForSomeoneElse,
    submittedBy: lead.isFillingForSomeoneElse
      ? {
          relationship: relationshipLabel(lead.relationshipToInjured) || null,
          name: personName(lead.fillerFirstName, lead.fillerLastName),
          phone: lead.fillerPhone,
          email: lead.fillerEmail,
        }
      : null,
    location: {
      state: lead.state,
      county: lead.county,
      postcode: lead.postcode,
    },
    caseFacts: {
      atFault: triState(lead.isAtFault),
      hasAttorney: triState(lead.hasAttorney),
      receivedSettlement: triState(lead.hasReceivedSettlement),
      injuryDetails: lead.injuryDetails,
      accidentDetails: lead.accidentDetails,
    },
    notes: lead.notes,
    bookmarked: isBookmarked(actor, lead.id),
    mayBeSamePersonAsAnotherLead: duplicateInfo(actor, lead),
    firmSubmission: {
      sentToFirmAt: lead.sentToFirmAt?.toISOString() ?? null,
      brightwaterLeadId: lead.brightwaterLeadId,
      /**
       * Informational only: the assistant cannot send. It tells the user
       * whether a human can send it now, and what is missing when they can't.
       */
      readyForHumanToSend: eligibility.canSend,
      blockers: eligibility.reason ? [eligibility.reason] : [],
      humanOnly: true,
    },
    ...(showAttribution
      ? {
          attribution: {
            source: lead.source,
            medium: lead.medium,
            content: lead.content,
            ipAddress: lead.ipaddress,
            trustedForm: lead.trustedform,
            journaya: lead.journaya,
          },
        }
      : {}),
  };
}

/** Run a tool body, turning a permission refusal into a readable result. */
async function guarded<T>(
  fn: () => T | Promise<T>,
): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }
}

/** Load a lead by id, enforcing that the actor may see it. */
function resolveVisibleLead(actor: Actor, leadId: number): Lead {
  return requireVisibleLead(actor, leadId);
}

/** Sort keys the assistant may ask for, mapped to the grid's own columns. */
const SORTS = {
  newest: { id: "createdAt", desc: true },
  oldest: { id: "createdAt", desc: false },
  name: { id: "injuredLastName", desc: false },
  stage: { id: "stage", desc: false },
  caseType: { id: "caseType", desc: false },
  assignedTo: { id: "assignedTo", desc: false },
} as const;

/**
 * Build the tool set for one actor.
 *
 * Built per request because each tool closes over the actor it runs as — there
 * is no ambient "current user" for a tool to reach for, which is what makes the
 * same set safe to hand to an MCP server.
 */
export function buildAiTools(actor: Actor) {
  const searchLeads = toolDefinition({
    name: "search_leads",
    description:
      "Search the leads the signed-in user can see. Use this to find a lead by the injured person's name, email or phone, or to list leads by stage, case type, owner, possible similarity to another lead, bookmark or arrival window. Each result carries an internal leadId that lets you call other tools — never show it to the user.",
    inputSchema: z.object({
      search: z
        .string()
        .optional()
        .describe(
          "Free text matched against the injured person's name, email and phone.",
        ),
      stages: z
        .array(z.enum(LEAD_STAGES))
        .optional()
        .describe("Stages to include (any of them)."),
      caseTypes: z
        .array(z.enum(CASE_TYPE_FILTERS))
        .optional()
        .describe(
          "Case types to include. 'OTHER' is the grid's bucket for every stored campaign that is not MVA or Mass Tort.",
        ),
      assignedTo: z
        .enum(["any", "me", "unassigned"])
        .optional()
        .describe(
          "Owner filter. 'any' is everything the user can see, 'me' is their own leads, 'unassigned' is the open pool.",
        ),
      assignedToUserId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Only leads assigned to this user id (resolve it with list_users first).",
        ),
      potentialDuplicate: z
        .enum(["yes", "no"])
        .optional()
        .describe(
          "'yes' only leads that may be the same person as another lead, 'no' only leads with no such warning.",
        ),
      bookmarked: z
        .enum(["yes", "no"])
        .optional()
        .describe("Personal bookmark filter for the signed-in user."),
      source: z
        .enum(LEAD_SOURCES)
        .optional()
        .describe(
          "Attribution source. Only available to viewers who may see attribution.",
        ),
      addedWithin: z
        .enum(["any", "24h", "3d", "7d", "30d", "custom"])
        .optional()
        .describe("Arrival window. 'any' means no date limit."),
      addedFrom: z
        .string()
        .optional()
        .describe("Custom lower bound, YYYY-MM-DD (implies custom)."),
      addedTo: z
        .string()
        .optional()
        .describe("Custom upper bound, YYYY-MM-DD (implies custom)."),
      excludeDisqualified: z
        .boolean()
        .optional()
        .describe("Leave closed (Disqualified) leads out of the results."),
      sort: z
        .enum(["newest", "oldest", "name", "stage", "caseType", "assignedTo"])
        .optional()
        .describe("Result order. Defaults to newest first."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_TOOL_ROWS)
        .optional()
        .describe(`Maximum rows to return (default 10, max ${MAX_TOOL_ROWS}).`),
    }),
  }).server(async (input) => {
    if (input.source && !can(actor.role, "leads.view.attribution")) {
      return { error: "You don't have access to attribution data." };
    }

    const filters: Record<string, string> = {};

    // Stage: an explicit list wins; otherwise `excludeDisqualified` expands to
    // every stage that is still in play.
    const requestedStages = input.stages ?? [];
    let stageValues = requestedStages;
    if (input.excludeDisqualified) {
      stageValues = stageValues.filter((stage) => stage !== "DISQUALIFIED");
    }
    if (requestedStages.length > 0 && stageValues.length === 0) {
      return { totalMatching: 0, returned: 0, leads: [] };
    }
    if (stageValues.length === 0 && input.excludeDisqualified) {
      stageValues = LEAD_STAGES.filter((stage) => stage !== "DISQUALIFIED");
    }
    if (stageValues.length) filters.stage = stageValues.join(",");

    if (input.caseTypes?.length) {
      filters.caseType = input.caseTypes.join(",");
    }

    if (input.assignedToUserId) {
      filters.assignedTo = String(input.assignedToUserId);
    } else if (input.assignedTo === "me") {
      filters.assignedTo = String(actor.id);
    } else if (input.assignedTo === "unassigned") {
      filters.assignedTo = UNASSIGNED;
    }

    if (input.potentialDuplicate) {
      filters.potentialDuplicate = input.potentialDuplicate;
    }
    if (input.bookmarked) filters.bookmarked = input.bookmarked;
    if (input.source) filters.source = input.source;

    const addedWithin =
      input.addedWithin ??
      (input.addedFrom || input.addedTo ? "custom" : undefined);
    if (addedWithin) filters.addedWithin = addedWithin;
    if (input.addedFrom) filters.addedFrom = input.addedFrom;
    if (input.addedTo) filters.addedTo = input.addedTo;

    const page = listLeads(
      {
        page: 1,
        pageSize: input.limit ?? 10,
        sort: input.sort ? SORTS[input.sort] : null,
        search: input.search ?? "",
        filters,
      },
      actor,
    );

    return {
      totalMatching: page.total,
      returned: page.rows.length,
      leads: page.rows.map(leadSummary),
    };
  });

  const getLead = toolDefinition({
    name: "get_lead",
    description:
      "Fetch one lead's full detail by lead id, including internal notes, whether it may be the same person as another lead, bookmark state and whether a human can send it to the firm. The leadId is an internal handle — never show it to the user.",
    inputSchema: z.object({
      leadId: z.number().int().positive().describe("The lead's internal id."),
    }),
  }).server(async (input) =>
    guarded(() => leadDetail(actor, resolveVisibleLead(actor, input.leadId))),
  );

  const listSimilarLeads = toolDefinition({
    name: "list_similar_leads",
    description:
      "List the other leads that may be the same person as this lead. Only the ones the user may open are returned; the rest are assigned elsewhere and stay hidden. Use it before recommending whether a warning should be cleared.",
    inputSchema: z.object({
      leadId: z.number().int().positive().describe("The lead's internal id."),
    }),
  }).server(async (input) =>
    guarded(() => {
      const lead = resolveVisibleLead(actor, input.leadId);
      if (lead.dupGroupId === null) {
        return {
          mayBeSamePersonAsAnotherLead: false,
          otherSimilarLeads: 0,
          otherSimilarLeadsYouCanSee: 0,
          otherSimilarLeadsYouCannotSee: 0,
          leads: [],
        };
      }

      const groupId = lead.dupGroupId;
      const groupSize =
        getDb()
          .select({ value: count() })
          .from(leads)
          .where(eq(leads.dupGroupId, groupId))
          .get()?.value ?? 0;

      const page = listLeads(
        {
          page: 1,
          pageSize: MAX_TOOL_ROWS,
          sort: null,
          search: "",
          filters: { dupGroup: groupId },
        },
        actor,
      );

      const otherSimilarLeads = Math.max(groupSize - 1, 0);
      const otherSimilarLeadsYouCanSee = Math.max(page.total - 1, 0);

      return {
        mayBeSamePersonAsAnotherLead: true,
        otherSimilarLeads,
        otherSimilarLeadsYouCanSee,
        otherSimilarLeadsYouCannotSee:
          otherSimilarLeads - otherSimilarLeadsYouCanSee,
        leads: page.rows.map(leadSummary),
      };
    }),
  );

  const checkLeadForDuplicates = toolDefinition({
    name: "check_lead_for_duplicates",
    description:
      "Re-check whether one lead looks like any other lead and refresh that warning. This can bring back a warning that was previously cleared. Any viewer who can see the lead may run it.",
    inputSchema: z.object({
      leadId: z.number().int().positive(),
    }),
  }).server(async (input) =>
    guarded(() => {
      const result = checkLeadForDuplicatesForActor(actor, input.leadId);
      if (!result.ok)
        return { error: result.error ?? "The check could not be completed." };
      return {
        mayBeSamePersonAsAnotherLead: Boolean(result.dupGroupId),
        otherSimilarLeads: Math.max((result.dupGroupCount ?? 0) - 1, 0),
        otherSimilarLeadsYouCanSee: Math.max(
          (result.dupGroupVisibleCount ?? 0) - 1,
          0,
        ),
      };
    }),
  );

  const markLeadNotDuplicate = toolDefinition({
    name: "mark_lead_not_duplicate",
    description:
      "Clear a lead's 'possibly the same person' warning. Allowed for either role, but refused when a similar lead is assigned to someone else and therefore hidden from the user — in that case an administrator must review it. Confirm with the user before calling it.",
    inputSchema: z.object({
      leadId: z.number().int().positive(),
    }),
  }).server(async (input) =>
    guarded(async () => {
      const result = await markLeadNotDuplicateForActor(actor, input.leadId, {
        isAi: true,
      });
      if (!result.ok)
        return {
          error: result.error ?? "The warning could not be cleared.",
        };
      return {
        ok: true,
        leadId: input.leadId,
        mayBeSamePersonAsAnotherLead: false,
      };
    }),
  );

  const setLeadBookmark = toolDefinition({
    name: "set_lead_bookmark",
    description:
      "Add or remove the signed-in user's personal bookmark for a lead. Bookmarks are private and record no activity.",
    inputSchema: z.object({
      leadId: z.number().int().positive(),
      bookmarked: z
        .boolean()
        .describe("true to bookmark, false to remove the bookmark."),
    }),
  }).server(async (input) =>
    guarded(async () => {
      const result = await setLeadBookmarkForActor(
        actor,
        input.leadId,
        input.bookmarked,
      );
      if (!result.ok)
        return { error: result.error ?? "The bookmark could not be updated." };
      return { ok: true, leadId: input.leadId, bookmarked: input.bookmarked };
    }),
  );

  const updateLeadStage = toolDefinition({
    name: "update_lead_stage",
    description:
      "Move a lead to a different stage. The user's own permissions apply: an agent can move a lead they own up to Retained, and nobody can set Sent to Firm this way. Sending to the firm is a human-only action.",
    inputSchema: z.object({
      leadId: z.number().int().positive(),
      stage: z.enum(LEAD_STAGES).describe("The stage to move the lead to."),
    }),
  }).server(async (input) =>
    guarded(async () => {
      const lead = resolveVisibleLead(actor, input.leadId);
      const result = updateLeadForActor(
        actor,
        {
          id: lead.id,
          stage: input.stage,
          assignedToId: lead.assignedToId,
        },
        { isAi: true },
      );
      return result.ok
        ? { ok: true, leadId: lead.id, stage: LEAD_STAGE_LABELS[input.stage] }
        : { error: result.error ?? "The stage could not be changed." };
    }),
  );

  const assignLead = toolDefinition({
    name: "assign_lead",
    description:
      "Assign a lead to a user, or unassign it. An administrator may assign any lead to anyone; an agent may claim an unassigned lead for themselves or release a lead they own.",
    inputSchema: z.object({
      leadId: z.number().int().positive(),
      assigneeUserId: z
        .number()
        .int()
        .positive()
        .nullable()
        .describe(
          "The user id to assign to, or null to return the lead to the open pool.",
        ),
    }),
  }).server(async (input) =>
    guarded(async () => {
      const lead = resolveVisibleLead(actor, input.leadId);
      const result = updateLeadForActor(
        actor,
        {
          id: lead.id,
          stage: lead.stage,
          assignedToId: input.assigneeUserId,
        },
        { isAi: true },
      );
      return result.ok
        ? {
            ok: true,
            leadId: lead.id,
            assignedTo: assigneeName(input.assigneeUserId),
          }
        : { error: result.error ?? "The lead could not be reassigned." };
    }),
  );

  const updateLeadDetails = toolDefinition({
    name: "update_lead_details",
    description:
      "Change a lead's editable details (the injured person, the person who submitted the form, the case details, location, case type and notes). Only send the fields that change. The same validation and permissions as the lead dialog apply; the first refusal is returned as the error. Never send a lead to the firm or delete it — those are human actions.",
    inputSchema: z
      .object({
        leadId: z.number().int().positive(),
        caseType: z
          .string()
          .nullable()
          .optional()
          .describe("Canonical case type: MVA, MASS_TORT or OTHER."),
        injuredFirstName: z.string().nullable().optional(),
        injuredLastName: z.string().nullable().optional(),
        injuredPhone: z.string().nullable().optional(),
        injuredEmail: z.string().nullable().optional(),
        fillerFirstName: z.string().nullable().optional(),
        fillerLastName: z.string().nullable().optional(),
        fillerPhone: z.string().nullable().optional(),
        fillerEmail: z.string().nullable().optional(),
        relationshipToInjured: z.string().nullable().optional(),
        dateOfAccident: z
          .string()
          .nullable()
          .optional()
          .describe("YYYY-MM-DD, or null to clear."),
        state: z.string().nullable().optional().describe("Two-letter code."),
        county: z.string().nullable().optional(),
        postcode: z.string().nullable().optional(),
        injuryDetails: z.string().nullable().optional(),
        accidentDetails: z.string().nullable().optional(),
        notes: z
          .string()
          .nullable()
          .optional()
          .describe("Internal notes; never sent to the firm."),
        isAtFault: z.boolean().nullable().optional(),
        hasAttorney: z.boolean().nullable().optional(),
        hasReceivedSettlement: z.boolean().nullable().optional(),
      })
      .refine(
        (value) =>
          Object.entries(value).some(
            ([key, field]) => key !== "leadId" && field !== undefined,
          ),
        { message: "Provide at least one field to change." },
      ),
  }).server(async (input) =>
    guarded(async () => {
      const { leadId, ...fields } = input;
      const patch: LeadFieldPatch = {};

      for (const [key, value] of Object.entries(fields) as Array<
        [keyof typeof fields, unknown]
      >) {
        if (value === undefined) continue;
        // The dialog's patch shape carries text, so `null` means "clear".
        (patch as Record<string, unknown>)[key] =
          value === null ? "" : value;
      }

      const result = saveLeadFieldsForActor(actor, leadId, patch, {
        isAi: true,
      });
      return result.ok
        ? { ok: true, leadId }
        : { error: result.error ?? "The lead could not be updated." };
    }),
  );

  const listUsers = toolDefinition({
    name: "list_users",
    description:
      "List the intake team the signed-in user may reference. An administrator sees everyone; an agent sees only themselves. Use it to resolve a person's name to a user id before assigning a lead or filtering by owner.",
    inputSchema: z.object({
      search: z
        .string()
        .optional()
        .describe("Free text matched against name and email."),
    }),
  }).server(async (input) => {
    const term = input.search?.trim().toLowerCase();
    const team = listAssignableUsers(actor).filter((member) =>
      term
        ? member.name.toLowerCase().includes(term) ||
          member.email.toLowerCase().includes(term)
        : true,
    );
    return { returned: team.length, users: team };
  });

  const getDeskMetrics = toolDefinition({
    name: "get_desk_metrics",
    description:
      "The Overview page's headline numbers for the signed-in user: active leads, the stage breakdown, unassigned, assigned to them, new this week, ready to send, leads that may be the same person as another lead, and sent-to-firm. Scoped to the leads they can see.",
    inputSchema: z.object({}),
  }).server(async () => {
    const metrics = leadMetrics(actor);
    return {
      activeLeads: metrics.total,
      pipeline: LEAD_STAGES.filter(
        (stage) => stage !== "DISQUALIFIED",
      ).map((stage) => ({
        stage: LEAD_STAGE_LABELS[stage],
        count: metrics.byStage[stage],
      })),
      unassigned: metrics.unassigned,
      assignedToMe: metrics.assignedToMe,
      newThisWeek: metrics.newThisWeek,
      readyForBrightwater: metrics.readyToSend,
      possiblySamePersonAsAnotherLead: metrics.potentialDuplicates,
      sentToFirm: metrics.sentToFirm,
    };
  });

  const getCampaignAnalytics = toolDefinition({
    name: "get_campaign_analytics",
    description:
      "Campaign performance for administrators: leads, qualified, retained, sent and disqualified grouped by campaign, source, medium and content, plus the trend. Defaults to the last 30 days and the MVA campaign, matching the Analytics page.",
    inputSchema: z.object({
      dateWithin: z
        .enum(["any", "24h", "3d", "7d", "30d", "custom"])
        .optional()
        .describe("Rolling window; defaults to 30d."),
      dateFrom: z
        .string()
        .optional()
        .describe("Custom lower bound, YYYY-MM-DD."),
      dateTo: z.string().optional().describe("Custom upper bound, YYYY-MM-DD."),
      campaign: z
        .enum(["all", "MVA", "MASS_TORT", "OTHER"])
        .optional()
        .describe("Campaign scope; defaults to MVA."),
    }),
  }).server(async (input) =>
    guarded(() => {
      if (!can(actor.role, "analytics.view")) {
        throw new ForbiddenError("Analytics is for administrators.");
      }

      const filters = readAnalyticsFilters({
        dateWithin: input.dateWithin as AnalyticsDatePreset | undefined,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        campaign: input.campaign,
      });
      const data = campaignAnalytics(filters);

      return {
        window: {
          start: data.window.start.toISOString(),
          end: data.window.end.toISOString(),
          granularity: data.window.granularity,
        },
        campaign: filters.campaign,
        totals: data.totals,
        byCampaign: data.byCampaign,
        bySource: data.bySource,
        byMedium: data.byMedium,
        byContent: data.byContent,
        sourceCampaign: data.sourceCampaign,
        topCombinations: data.combinations,
        trend: data.trend.slice(-30),
      };
    }),
  );

  const getLeadHistory = toolDefinition({
    name: "get_lead_history",
    description:
      "The recorded stage changes and firm-submission attempts for one lead, newest first, including whether each was performed by the AI. Access follows lead visibility.",
    inputSchema: z.object({
      leadId: z.number().int().positive(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_TOOL_ROWS)
        .optional()
        .describe("Maximum rows (default 20)."),
    }),
  }).server(async (input) =>
    guarded(() => {
      resolveVisibleLead(actor, input.leadId);

      const rows = getDb()
        .select({
          id: activities.id,
          type: activities.type,
          description: activities.description,
          isAi: activities.isAi,
          createdAt: activities.createdAt,
          doerName: users.name,
        })
        .from(activities)
        .leftJoin(users, eq(activities.doerId, users.id))
        .where(
          and(
            eq(activities.leadId, input.leadId),
            inArray(activities.type, [...LEAD_HISTORY_TYPES]),
          ),
        )
        .orderBy(desc(activities.createdAt), desc(activities.id))
        .limit(input.limit ?? 20)
        .all();

      return {
        returned: rows.length,
        history: rows.map((row) => ({
          type: row.type,
          description: row.description,
          performedBy: row.doerName ?? "Deleted user",
          performedByAi: row.isAi,
          at: row.createdAt.toISOString(),
        })),
      };
    }),
  );

  const listActivity = toolDefinition({
    name: "list_activity",
    description:
      "The audit trail the signed-in user may read: an administrator sees every recorded activity, everyone else only their own. Newest first. Search matches the recorded description.",
    inputSchema: z.object({
      search: z.string().optional(),
      leadId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Only activity about this lead."),
      performedByUserId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Only activity performed by this user."),
      dateWithin: z.enum(["any", "24h", "3d", "7d", "30d", "custom"]).optional(),
      dateFrom: z.string().optional().describe("YYYY-MM-DD."),
      dateTo: z.string().optional().describe("YYYY-MM-DD."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_TOOL_ROWS)
        .optional()
        .describe("Maximum rows (default 10)."),
    }),
  }).server(async (input) => {
    const filters: Record<string, string> = {};
    if (input.leadId) filters.leadId = String(input.leadId);
    if (input.performedByUserId) {
      filters.performedBy = String(input.performedByUserId);
    }
    const dateWithin =
      input.dateWithin ??
      (input.dateFrom || input.dateTo ? "custom" : undefined);
    if (dateWithin) filters.dateWithin = dateWithin;
    if (input.dateFrom) filters.dateFrom = input.dateFrom;
    if (input.dateTo) filters.dateTo = input.dateTo;

    const page = listActivities(
      {
        page: 1,
        pageSize: input.limit ?? 10,
        sort: null,
        search: input.search ?? "",
        filters,
      },
      actor,
    );

    return {
      totalMatching: page.total,
      returned: page.rows.length,
      activities: page.rows.map((row) => ({
        type: row.type,
        description: row.description,
        performedBy: row.doerName,
        performedByAi: row.isAi,
        lead: row.affectedLeadName,
        at: row.createdAt.toISOString(),
      })),
    };
  });

  return [
    searchLeads,
    getLead,
    listSimilarLeads,
    checkLeadForDuplicates,
    markLeadNotDuplicate,
    setLeadBookmark,
    updateLeadStage,
    assignLead,
    updateLeadDetails,
    listUsers,
    getDeskMetrics,
    getCampaignAnalytics,
    getLeadHistory,
    listActivity,
  ] as const;
}

/** Re-exported so the chat route and the MCP server share one shape. */
export type AiTools = ReturnType<typeof buildAiTools>;
