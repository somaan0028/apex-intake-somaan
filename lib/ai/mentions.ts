/**
 * `@`-mention resolution for the assistant.
 *
 * A mention is a short way to point the assistant at a record: the compose box
 * offers matches as the user types, and the chosen references ride along with
 * the message. Two rules keep this honest:
 *
 *   - labels are resolved here from the database, never taken from the client;
 *   - a reference the viewer may not see is dropped, exactly as if the lead
 *     were outside their grid.
 *
 * The same helpers serve the runtime model input, so the assistant can act on a
 * mention without the client having to spell the record out again.
 */
import { and, asc, eq, like, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { LEAD_STAGE_LABELS, caseTypeLabel } from "@/lib/labels";
import { listLeads } from "@/lib/leads/queries";
import { findLead } from "@/lib/leads/service";
import { can, canViewLead, type Actor } from "@/lib/rbac";
import {
  EMPTY_MENTION_RESULT,
  type MentionRef,
  type MentionSearchResult,
} from "./types";

/** How many matches each section of the autocomplete shows. */
const MENTION_LIMIT = 6;

/** The injured person's name — the phrase the compose box shows for a lead. */
function leadLabel(lead: {
  injuredFirstName: string | null;
  injuredLastName: string | null;
}): string {
  const name = [lead.injuredFirstName, lead.injuredLastName]
    .filter(Boolean)
    .join(" ");
  return name || "Unnamed lead";
}

/**
 * Whether the actor may reference a user.
 *
 * Deliberately as narrow as the assignee lists they already see: an admin may
 * reference anyone, an agent only themselves. A user roster is not more visible
 * through the assistant than it is through the UI.
 */
function canSeeUser(actor: Actor, userId: number): boolean {
  return can(actor.role, "leads.view.all") || actor.id === userId;
}

/**
 * Search the records a message may reference.
 *
 * Leads go through the grid's own query, so visibility scoping and the
 * attribution stripping are the same as everywhere else. Users are scoped to
 * the assignee list the actor already sees.
 */
export function searchMentionables(
  actor: Actor,
  term: string,
): MentionSearchResult {
  const trimmed = term.trim();
  if (!trimmed) return EMPTY_MENTION_RESULT;

  // Reusing the grid query keeps row-level visibility in one place.
  const leadPage = listLeads(
    {
      page: 1,
      pageSize: MENTION_LIMIT,
      sort: null,
      search: trimmed,
      filters: {},
    },
    actor,
  );

  const leads = leadPage.rows.map((lead) => ({
    kind: "lead" as const,
    id: lead.id,
    label: leadLabel(lead),
    description: [
      LEAD_STAGE_LABELS[lead.stage],
      lead.caseType ? caseTypeLabel(lead.caseType) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const pattern = `%${trimmed}%`;
  const scope = can(actor.role, "leads.view.all")
    ? undefined
    : eq(users.id, actor.id);

  const userRows = getDb()
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(scope, or(like(users.name, pattern), like(users.email, pattern))),
    )
    .orderBy(asc(users.name))
    .limit(MENTION_LIMIT)
    .all();

  return {
    leads,
    users: userRows.map((user) => ({
      kind: "user" as const,
      id: user.id,
      label: user.name,
      description: user.email,
    })),
  };
}

/**
 * Re-resolve client-supplied references against the database.
 *
 * Anything the actor may not see — a lead outside their visibility, another
 * user's record — is silently dropped rather than stored, so a tampered message
 * cannot smuggle a hidden record into the transcript or the model's context.
 */
export function resolveMentions(
  actor: Actor,
  refs: ReadonlyArray<MentionRef>,
): MentionRef[] {
  const resolved: MentionRef[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (ref.kind === "lead") {
      const lead = findLead(ref.id);
      if (!lead || !canViewLead(actor, lead)) continue;
      resolved.push({
        kind: "lead",
        id: lead.id,
        label: leadLabel(lead),
        description: [
          LEAD_STAGE_LABELS[lead.stage],
          lead.caseType ? caseTypeLabel(lead.caseType) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      continue;
    }

    if (!canSeeUser(actor, ref.id)) continue;
    const user = getDb()
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, ref.id))
      .get();
    if (!user) continue;
    resolved.push({
      kind: "user",
      id: user.id,
      label: user.name,
      description: user.email,
    });
  }

  return resolved;
}

/**
 * The line appended to a user turn for the model, naming the referenced
 * records. The id is included because the model needs it to call tools, but it
 * is labelled as internal so it does not get echoed into the reply. Returns
 * `null` when there is nothing to add, so ordinary turns carry no extra tokens.
 */
export function formatMentionContext(
  refs: ReadonlyArray<MentionRef>,
): string | null {
  if (refs.length === 0) return null;
  const lines = refs.map((ref) => {
    const detail = ref.description ? ` — ${ref.description}` : "";
    const kind = ref.kind === "lead" ? "lead" : "user";
    return `- ${ref.label}${detail} (internal ${kind} id ${ref.id}, for your tool calls only — never mention it or any other id in your reply)`;
  });
  return `The user referenced these records:\n${lines.join("\n")}`;
}
