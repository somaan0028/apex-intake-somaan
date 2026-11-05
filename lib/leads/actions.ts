"use server";

/**
 * Server Actions for editing a lead.
 *
 * These are thin HTTP-facing wrappers: they parse the payload, hand the work to
 * the shared service in `lib/leads/service.ts` (which the AI tools also call),
 * and revalidate the grid. The service re-checks every change against the row
 * freshly loaded from the database — the dialog's disabled controls are a
 * convenience, not the boundary.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import type { LeadFieldPatch } from "./editable";
import {
  checkLeadForDuplicatesForActor,
  deleteLeadForActor,
  markLeadNotDuplicateForActor,
  saveLeadFieldsForActor,
  sendLeadForActor,
  setLeadBookmarkForActor,
  type DuplicateCheckResult,
  type LeadMutationResult,
  type SendLeadResult,
} from "./service";

export type {
  DuplicateCheckResult,
  LeadMutationResult as LeadActionResult,
  SendLeadResult,
};

/**
 * Auto-save one or more editable fields of a lead.
 *
 * The dialog sends only the fields that changed. The service canonicalises and
 * validates them, and refuses any field the signed-in user may not edit.
 */
export async function saveLeadFields(
  id: number,
  patch: LeadFieldPatch,
): Promise<LeadMutationResult> {
  const actor = await requireUser();

  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "Unknown lead." };
  }

  const result = saveLeadFieldsForActor(actor, id, patch);
  if (result.ok) revalidatePath("/leads");
  return result;
}

/** Add or remove the signed-in user's bookmark for a lead. */
export async function setLeadBookmark(
  id: number,
  bookmarked: boolean,
): Promise<LeadMutationResult> {
  const actor = await requireUser();

  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "Unknown lead." };
  }

  const result = setLeadBookmarkForActor(actor, id, bookmarked);
  if (result.ok) revalidatePath("/leads");
  return result;
}

/**
 * Permanently delete a lead (admin only).
 */
export async function deleteLead(
  formData: FormData,
): Promise<LeadMutationResult> {
  const actor = await requireUser();

  const id = Number(String(formData.get("id") ?? "").trim());
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "Unknown lead." };
  }

  const result = deleteLeadForActor(actor, id);
  if (result.ok) {
    // The lead disappears from every view that counts or lists it.
    revalidatePath("/leads");
    revalidatePath("/dashboard");
    revalidatePath("/activity");
    revalidatePath("/analytics");
  }
  return result;
}

/** Dismiss one lead's potential-duplicate grouping (admin only). */
export async function markLeadNotDuplicate(
  id: number,
): Promise<LeadMutationResult> {
  const actor = await requireUser();

  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "Unknown lead." };
  }

  const result = markLeadNotDuplicateForActor(actor, id);
  if (result.ok) revalidatePath("/leads");
  return result;
}

/** Re-run the duplicate matcher for one lead (explicit user action). */
export async function checkLeadForDuplicates(
  id: number,
): Promise<DuplicateCheckResult> {
  const actor = await requireUser();

  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "Unknown lead." };
  }

  const result = checkLeadForDuplicatesForActor(actor, id);
  if (result.ok) revalidatePath("/leads");
  return result;
}

/** Send a lead to the partner firm, then record the outcome. */
export async function sendLeadToFirm(
  formData: FormData,
): Promise<SendLeadResult> {
  const actor = await requireUser();

  const id = Number(String(formData.get("id") ?? "").trim());
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "Unknown lead." };
  }

  const result = await sendLeadForActor(actor, id);
  if (result.ok) revalidatePath("/leads");
  return result;
}
