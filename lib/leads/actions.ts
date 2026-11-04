"use server";

/**
 * Server Actions for editing a lead.
 *
 * These are thin HTTP-facing wrappers: they parse the form payload, hand the
 * work to the shared service in `lib/leads/service.ts` (which the AI tools also
 * call), and revalidate the grid. The service re-checks every change against the
 * row freshly loaded from the database — the dialog's disabled controls are a
 * convenience, not the boundary.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { LEAD_STAGES, type LeadStage } from "@/lib/db/schema";
import { UNASSIGNED } from "./constants";
import {
  sendLeadForActor,
  updateLeadForActor,
  type LeadMutationResult,
  type SendLeadResult,
} from "./service";

export type { LeadMutationResult as LeadActionResult, SendLeadResult };

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

/** Update the editable fields of a lead — its stage and its assignee. */
export async function updateLead(
  formData: FormData,
): Promise<LeadMutationResult> {
  const actor = await requireUser();

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

  const result = updateLeadForActor(actor, {
    id,
    stage: stageValue,
    assignedToId: assignee,
  });
  if (result.ok) revalidatePath("/leads");
  return result;
}

/** Send a lead to the partner firm, then record the outcome. */
export async function sendLeadToFirm(
  formData: FormData,
): Promise<SendLeadResult> {
  const actor = await requireUser();

  const id = Number(readText(formData, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "Unknown lead." };
  }

  const result = await sendLeadForActor(actor, id);
  if (result.ok) revalidatePath("/leads");
  return result;
}
