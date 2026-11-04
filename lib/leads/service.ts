/**
 * Lead mutations and viewer-aware reads, free of HTTP and the UI.
 *
 * The lead Server Actions (the detail dialog) and the AI tool layer both call
 * these, so the permission checks and the "send at most once" rule exist in one
 * place. The caller always passes a freshly loaded actor and a lead id: the row
 * is read from the database here, never taken from a client payload, because a
 * caller could otherwise claim ownership they don't have.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  ForbiddenError,
  requireLeadAssignment,
  requireLeadReadyToSend,
  requireLeadSend,
  requireLeadStageChange,
  requireLeadView,
} from "@/lib/auth/authorize";
import { sendLeadToBrightwater } from "@/lib/brightwater";
import { getDb } from "@/lib/db";
import { leads, type Lead, type LeadStage } from "@/lib/db/schema";
import type { Actor } from "@/lib/rbac";

/** Result of a lead mutation; `ok` means the change was applied. */
export interface LeadMutationResult {
  ok: boolean;
  error?: string;
}

/** Result of a firm submission; on success carries the recorded values. */
export interface SendLeadResult extends LeadMutationResult {
  sentToFirmAt?: Date;
  brightwaterLeadId?: string | null;
}

/** The raw lead row, or `undefined` when no such lead exists. */
export function findLead(id: number): Lead | undefined {
  return getDb().select().from(leads).where(eq(leads.id, id)).get();
}

/**
 * Load a lead the actor is allowed to see.
 *
 * Throws `ForbiddenError` when the lead does not exist or is outside the actor's
 * visibility, so a caller that leaks the reason also leaks the existence of a
 * lead. Callers map it to a message.
 */
export function requireVisibleLead(actor: Actor, id: number): Lead {
  const lead = findLead(id);
  if (!lead) throw new ForbiddenError("That lead no longer exists.");
  requireLeadView(actor, lead);
  return lead;
}

/**
 * Update a lead's stage and assignee.
 *
 * Each field is checked against the freshly loaded row only when it actually
 * changes, so a viewer who may do one thing but not the other can still submit
 * the other. Fields that did not change are not written.
 */
export function updateLeadForActor(
  actor: Actor,
  input: { id: number; stage: LeadStage; assignedToId: number | null },
): LeadMutationResult {
  try {
    const lead = requireVisibleLead(actor, input.id);

    const stageChanged = lead.stage !== input.stage;
    const assigneeChanged = lead.assignedToId !== input.assignedToId;

    if (stageChanged) requireLeadStageChange(actor, lead, input.stage);
    if (assigneeChanged) {
      requireLeadAssignment(actor, lead, input.assignedToId);
    }
    if (!stageChanged && !assigneeChanged) return { ok: true };

    getDb()
      .update(leads)
      .set({
        ...(stageChanged ? { stage: input.stage } : {}),
        ...(assigneeChanged ? { assignedToId: input.assignedToId } : {}),
      })
      .where(eq(leads.id, input.id))
      .run();

    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Send a lead to Brightwater, then record the outcome.
 *
 * Guarded three ways before the network call: the actor must hold
 * `leads.send_to_firm`, the lead must be MVA, and neither `sent_to_firm_at` nor
 * `brightwater_lead_id` may already be set. The write that follows is a
 * conditional update on the same two columns, so two requests racing on one lead
 * cannot both record a send — the loser is told it was already sent.
 */
export async function sendLeadForActor(
  actor: Actor,
  id: number,
): Promise<SendLeadResult> {
  try {
    const lead = requireVisibleLead(actor, id);
    requireLeadSend(actor, lead);
    requireLeadReadyToSend(lead);

    const result = await sendLeadToBrightwater(lead);
    if (!result.ok) return { ok: false, error: result.error };

    const sentToFirmAt = new Date();
    const update = getDb()
      .update(leads)
      .set({
        brightwaterLeadId: result.leadId,
        sentToFirmAt,
        stage: "SENT_TO_FIRM",
      })
      .where(
        and(
          eq(leads.id, id),
          isNull(leads.sentToFirmAt),
          isNull(leads.brightwaterLeadId),
        ),
      )
      .run();

    if (update.changes === 0) {
      return { ok: false, error: "This lead was already sent to the firm." };
    }

    return { ok: true, sentToFirmAt, brightwaterLeadId: result.leadId };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
}
