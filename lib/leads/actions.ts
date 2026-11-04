"use server";

/**
 * Server Actions for editing a lead.
 *
 * The dialog renders most fields read-only and only enables the controls the
 * viewer is allowed to use, but every change is re-checked here against the row
 * freshly loaded from the database — the UI is a convenience, not the boundary.
 */
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  ForbiddenError,
  requireLeadAssignment,
  requireLeadReadyToSend,
  requireLeadSend,
  requireLeadStageChange,
  requireLeadView,
} from "@/lib/auth/authorize";
import { requireUser } from "@/lib/auth/session";
import { sendLeadToBrightwater } from "@/lib/brightwater";
import { getDb } from "@/lib/db";
import { LEAD_STAGES, leads, type LeadStage } from "@/lib/db/schema";
import { UNASSIGNED } from "./constants";

/** Result the dialog renders; `ok` means the change was applied. */
export interface LeadActionResult {
  ok: boolean;
  error?: string;
}

/** Result of a firm submission; on success carries the recorded values. */
export interface SendLeadResult {
  ok: boolean;
  error?: string;
  sentToFirmAt?: Date;
  brightwaterLeadId?: string | null;
}

function readText(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function isLeadStage(value: string): value is LeadStage {
  return (LEAD_STAGES as readonly string[]).includes(value);
}

/**
 * Parses the assignee select value: the unassigned sentinel (or blank) becomes
 * `null`, a numeric id becomes a number, anything else is rejected.
 */
function parseAssignee(value: string): number | null | undefined {
  if (value === "" || value === UNASSIGNED) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/**
 * Update the editable fields of a lead — its stage and its assignee.
 *
 * Both checks run against the freshly loaded row *before* any write, so a
 * tampered request can change neither field it isn't allowed to. Fields that
 * did not change are not written, so a viewer who may do one thing but not the
 * other can still submit the other.
 */
export async function updateLead(
  formData: FormData,
): Promise<LeadActionResult> {
  const actor = await requireUser();

  try {
    const id = Number(readText(formData, "id"));
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "Unknown lead." };
    }

    const stageValue = readText(formData, "stage");
    if (!isLeadStage(stageValue)) {
      return { ok: false, error: "Unknown stage." };
    }

    const assignee = parseAssignee(readText(formData, "assignedToId"));
    if (assignee === undefined) {
      return { ok: false, error: "Unknown assignee." };
    }

    const db = getDb();
    const lead = db.select().from(leads).where(eq(leads.id, id)).get();
    if (!lead) return { ok: false, error: "That lead no longer exists." };

    // A viewer may only act on a lead they can see at all.
    requireLeadView(actor, lead);

    const stageChanged = lead.stage !== stageValue;
    const assigneeChanged = lead.assignedToId !== assignee;

    if (stageChanged) requireLeadStageChange(actor, lead, stageValue);
    if (assigneeChanged) requireLeadAssignment(actor, lead, assignee);

    if (!stageChanged && !assigneeChanged) return { ok: true };

    db.update(leads)
      .set({
        ...(stageChanged ? { stage: stageValue } : {}),
        ...(assigneeChanged ? { assignedToId: assignee } : {}),
      })
      .where(eq(leads.id, id))
      .run();

    revalidatePath("/leads");
    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/**
 * Send a lead to Brightwater, then record the outcome.
 *
 * The send is guarded three ways before the network call: the viewer must hold
 * `leads.send_to_firm`, the lead must be `MVA`, and neither `sent_to_firm_at`
 * nor `brightwater_lead_id` may already be set. The write that follows is a
 * conditional update on the same two columns, so two requests racing on the same
 * lead cannot both record a send (and the second is told it was already sent).
 */
export async function sendLeadToFirm(
  formData: FormData,
): Promise<SendLeadResult> {
  const actor = await requireUser();

  try {
    const id = Number(readText(formData, "id"));
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "Unknown lead." };
    }

    const db = getDb();
    const lead = db.select().from(leads).where(eq(leads.id, id)).get();
    if (!lead) return { ok: false, error: "That lead no longer exists." };

    requireLeadView(actor, lead);
    requireLeadSend(actor, lead);
    requireLeadReadyToSend(lead);

    const result = await sendLeadToBrightwater(lead);
    if (!result.ok) return { ok: false, error: result.error };

    // Record only if nothing else wrote a send result while the request was
    // in flight; a re-run then reports "already sent" instead of overwriting.
    const sentToFirmAt = new Date();
    const update = db
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

    revalidatePath("/leads");
    return { ok: true, sentToFirmAt, brightwaterLeadId: result.leadId };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
