/**
 * The assistant's tool layer — the one place the assistant's capabilities are
 * defined.
 *
 * Every tool is built for a specific actor and calls the same services the UI
 * uses, so the assistant can do exactly what that person can do and nothing
 * more. The tool set is deliberately decoupled from the HTTP chat route: the
 * future MCP server can expose `buildAiTools(actor)` to an external agent
 * unchanged, which is why nothing here depends on the request or the UI.
 *
 * Refusals come back as `{ error }` rather than thrown, so the model can read
 * the reason and explain it instead of failing the whole turn.
 */
import { toolDefinition } from "@tanstack/ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ForbiddenError } from "@/lib/auth/authorize";
import { getDb } from "@/lib/db";
import { CASE_TYPES, LEAD_STAGES, users, type Lead } from "@/lib/db/schema";
import {
  LEAD_STAGE_LABELS,
  caseTypeLabel,
  relationshipLabel,
} from "@/lib/labels";
import { UNASSIGNED } from "@/lib/leads/constants";
import { listLeads } from "@/lib/leads/queries";
import {
  requireVisibleLead,
  sendLeadForActor,
  updateLeadForActor,
} from "@/lib/leads/service";
import { can, type Actor } from "@/lib/rbac";
import { listAssignableUsers } from "@/lib/users/queries";
import { MAX_TOOL_ROWS } from "./config";

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
function leadSummary(lead: {
  id: number;
  matterId: string;
  stage: Lead["stage"];
  caseType: Lead["caseType"];
  injuredFirstName: string | null;
  injuredLastName: string | null;
  injuredPhone: string | null;
  injuredEmail: string | null;
  createdAt: Date | null;
  assignedToName: string | null;
}) {
  return {
    leadId: lead.id,
    stage: LEAD_STAGE_LABELS[lead.stage],
    caseType: lead.caseType ? caseTypeLabel(lead.caseType) : null,
    injuredPerson: personName(lead.injuredFirstName, lead.injuredLastName),
    phone: lead.injuredPhone,
    email: lead.injuredEmail,
    assignedTo: lead.assignedToName ?? "Unassigned",
    createdOn: isoDate(lead.createdAt),
  };
}

/**
 * The detail shape for a single lead. Attribution is only present when the
 * actor holds `leads.view.attribution`, matching the grid and the dialog.
 */
function leadDetail(actor: Actor, lead: Lead) {
  const showAttribution = can(actor.role, "leads.view.attribution");

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
    firmSubmission: {
      sentToFirmAt: lead.sentToFirmAt?.toISOString() ?? null,
      brightwaterLeadId: lead.brightwaterLeadId,
    },
    ...(showAttribution
      ? {
          attribution: {
            source: lead.source,
            ipAddress: lead.ipaddress,
            trustedForm: lead.trustedform,
            jornaya: lead.jornaya,
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

/**
 * Build the tool set for one actor.
 *
 * Built per request because each tool closes over the actor it runs as — there
 * is no ambient "current user" for a tool to reach for, which is what makes the
 * same set safe to hand to an MCP server later.
 */
export function buildAiTools(actor: Actor) {
  const searchLeads = toolDefinition({
    name: "search_leads",
    description:
      "Search the leads the signed-in user can see, newest first. Use this to find a lead by the injured person's name, email or phone, or to list leads by stage, case type or assignee. Each result carries an internal leadId that lets you call other tools — never show it to the user.",
    inputSchema: z.object({
      search: z
        .string()
        .optional()
        .describe(
          "Free text matched against the injured person's name, email and phone.",
        ),
      stage: z
        .enum(LEAD_STAGES)
        .optional()
        .describe("Exact stage to filter on."),
      caseType: z
        .enum(CASE_TYPES)
        .optional()
        .describe("Exact case type to filter on."),
      assignedTo: z
        .enum(["any", "me", "unassigned"])
        .optional()
        .describe(
          "Owner filter. 'any' is everything the user can see, 'me' is their own leads, 'unassigned' is the open pool.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_TOOL_ROWS)
        .optional()
        .describe(`Maximum rows to return (default 10, max ${MAX_TOOL_ROWS}).`),
    }),
  }).server(async (input) => {
    const filters: Record<string, string> = {};
    if (input.stage) filters.stage = input.stage;
    if (input.caseType) filters.caseType = input.caseType;
    if (input.assignedTo === "me") filters.assignedTo = String(actor.id);
    if (input.assignedTo === "unassigned") filters.assignedTo = UNASSIGNED;

    const page = listLeads(
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
      leads: page.rows.map(leadSummary),
    };
  });

  const getLead = toolDefinition({
    name: "get_lead",
    description:
      "Fetch one lead's full detail by lead id. Use it after search_leads, or when a referenced lead gives you its id. The leadId is an internal handle — never show it to the user.",
    inputSchema: z.object({
      leadId: z.number().int().positive().describe("The lead's internal id."),
    }),
  }).server(async (input) =>
    guarded(() => leadDetail(actor, resolveVisibleLead(actor, input.leadId))),
  );

  const updateLeadStage = toolDefinition({
    name: "update_lead_stage",
    description:
      "Move a lead to a different stage. The user's own permissions apply: an agent can move a lead they own up to Retained, and nobody but an administrator can set Sent to firm this way (sending to the firm uses its own tool).",
    inputSchema: z.object({
      leadId: z.number().int().positive(),
      stage: z.enum(LEAD_STAGES).describe("The stage to move the lead to."),
    }),
  }).server(async (input) =>
    guarded(async () => {
      const lead = requireVisibleLead(actor, input.leadId);
      const result = updateLeadForActor(actor, {
        id: lead.id,
        stage: input.stage,
        assignedToId: lead.assignedToId,
      });
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
      const lead = requireVisibleLead(actor, input.leadId);
      const result = updateLeadForActor(actor, {
        id: lead.id,
        stage: lead.stage,
        assignedToId: input.assigneeUserId,
      });
      return result.ok
        ? {
            ok: true,
            leadId: lead.id,
            assignedTo: assigneeName(input.assigneeUserId),
          }
        : { error: result.error ?? "The lead could not be reassigned." };
    }),
  );

  const listUsers = toolDefinition({
    name: "list_users",
    description:
      "List the intake team the signed-in user may reference. An administrator sees everyone; an agent sees only themselves. Use it to resolve a person's name to a user id before assigning a lead.",
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

  const sendLeadToFirm = toolDefinition({
    name: "send_lead_to_firm",
    description:
      "Send an MVA lead to the partner firm (Brightwater). The lead must already be Retained, and a lead can only ever be sent once. Only an administrator can do this. Confirm with the user before calling it.",
    inputSchema: z.object({
      leadId: z.number().int().positive(),
    }),
  }).server(async (input) =>
    guarded(async () => {
      const result = await sendLeadForActor(actor, input.leadId);
      if (!result.ok)
        return { error: result.error ?? "The lead could not be sent." };
      return {
        ok: true,
        leadId: input.leadId,
        brightwaterLeadId: result.brightwaterLeadId ?? null,
        sentAt: result.sentToFirmAt?.toISOString() ?? null,
      };
    }),
  );

  return [
    searchLeads,
    getLead,
    updateLeadStage,
    assignLead,
    listUsers,
    sendLeadToFirm,
  ] as const;
}

/** Re-exported so the chat route and (later) the MCP server share one shape. */
export type AiTools = ReturnType<typeof buildAiTools>;
