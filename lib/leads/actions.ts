"use server";

/**
 * Server Actions for editing a lead.
 *
 * The dialog renders most fields read-only and only enables the controls the
 * viewer is allowed to use, but every change is re-checked here against the row
 * freshly loaded from the database — the UI is a convenience, not the boundary.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  ForbiddenError,
  requireLeadAssignment,
  requireLeadStageChange,
  requireLeadView,
} from "@/lib/auth/authorize";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { LEAD_STAGES, leads, type LeadStage } from "@/lib/db/schema";
import { UNASSIGNED } from "./constants";

/** Result the dialog renders; `ok` means the change was applied. */
export interface LeadActionResult {
  ok: boolean;
  error?: string;
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
