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
  requireLeadEdit,
  requireLeadReadyToSend,
  requireLeadSend,
  requireLeadStageChange,
  requireLeadView,
} from "@/lib/auth/authorize";
import { sendLeadToBrightwater } from "@/lib/brightwater";
import { getDb } from "@/lib/db";
import {
  toCounty,
  toNullableText,
  toStateCode,
  toUsPhone,
} from "@/lib/db/normalize";
import { LEAD_STAGES, leads, type Lead, type LeadStage } from "@/lib/db/schema";
import { isValidEmail, normalizePostcode } from "@/lib/validation";
import type { Actor } from "@/lib/rbac";
import type { LeadFieldPatch } from "./editable";

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

/** Every field a lead update may carry. `undefined` means "not provided". */
export interface LeadUpdate {
  stage?: LeadStage;
  assignedToId?: number | null;
  injuredFirstName?: string | null;
  injuredLastName?: string | null;
  injuredPhone?: string | null;
  injuredEmail?: string | null;
  dateOfAccident?: Date | null;
  state?: string | null;
  county?: string | null;
  postcode?: string | null;
  injuryDetails?: string | null;
  accidentDetails?: string | null;
  isAtFault?: boolean | null;
  hasAttorney?: boolean | null;
  hasReceivedSettlement?: boolean | null;
}

/** Free-text guard, matching the intake endpoint. */
const MAX_TEXT_LENGTH = 5000;

/** Compare a stored column with a proposed value (dates included). */
function sameValue(current: unknown, next: unknown): boolean {
  if (current instanceof Date && next instanceof Date) {
    return current.getTime() === next.getTime();
  }
  return current === next;
}

/**
 * Update any editable field of a lead.
 *
 * Stage and assignment keep their own policies (an agent may claim a lead
 * without holding edit rights yet); every other field requires `leads.edit.*`
 * for the row. Fields that did not change are not written, so one saved patch
 * cannot clobber another field a different request just changed.
 */
export function updateLeadForActor(
  actor: Actor,
  input: { id: number } & LeadUpdate,
): LeadMutationResult {
  try {
    const lead = requireVisibleLead(actor, input.id);
    return applyLeadUpdate(actor, lead, input);
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    throw error;
  }
}

function applyLeadUpdate(
  actor: Actor,
  lead: Lead,
  update: LeadUpdate,
): LeadMutationResult {
  const stageChanged =
    update.stage !== undefined && update.stage !== lead.stage;
  const assigneeChanged =
    update.assignedToId !== undefined &&
    update.assignedToId !== lead.assignedToId;

  const otherKeys = (Object.keys(update) as Array<keyof LeadUpdate>).filter(
    (key) =>
      key !== "stage" && key !== "assignedToId" && update[key] !== undefined,
  );

  if (otherKeys.length > 0) requireLeadEdit(actor, lead);
  if (stageChanged) {
    // The sent stage is a record of an actual submission, not a free choice.
    if (
      update.stage === "SENT_TO_FIRM" &&
      lead.sentToFirmAt === null &&
      lead.brightwaterLeadId === null
    ) {
      return {
        ok: false,
        error: "This lead hasn't been sent to the firm yet.",
      };
    }
    requireLeadStageChange(actor, lead, update.stage!);
  }
  if (assigneeChanged) {
    requireLeadAssignment(actor, lead, update.assignedToId!);
  }

  const set: Partial<Lead> = {};
  if (stageChanged) set.stage = update.stage;
  if (assigneeChanged) set.assignedToId = update.assignedToId;

  for (const key of otherKeys) {
    const next = update[key];
    const current = lead[key as keyof Lead];
    if (!sameValue(current, next)) {
      (set as Record<string, unknown>)[key] = next;
    }
  }

  if (Object.keys(set).length === 0) return { ok: true };

  getDb().update(leads).set(set).where(eq(leads.id, lead.id)).run();
  return { ok: true };
}

/** Parse `YYYY-MM-DD` as UTC midnight, matching how imported accident dates are stored. */
function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

type NormalizedPatch =
  { ok: true; update: LeadUpdate } | { ok: false; error: string };

/**
 * Canonicalise the raw values the dialog sends.
 *
 * The dialog validates as it goes, but the Server Action is the boundary: an
 * unrecognised state, county or phone must not reach the database through a
 * hand-written request.
 */
function normalizeLeadPatch(
  lead: Lead,
  patch: LeadFieldPatch,
): NormalizedPatch {
  const update: LeadUpdate = {};
  const provided = <K extends keyof LeadFieldPatch>(key: K) =>
    patch[key] !== undefined;

  if (provided("injuredFirstName")) {
    update.injuredFirstName = toNullableText(patch.injuredFirstName);
  }
  if (provided("injuredLastName")) {
    update.injuredLastName = toNullableText(patch.injuredLastName);
  }

  if (provided("injuredPhone")) {
    const raw = (patch.injuredPhone ?? "").trim();
    if (raw === "") {
      update.injuredPhone = null;
    } else {
      const phone = toUsPhone(raw);
      if (!phone) {
        return { ok: false, error: "Enter a 10-digit US phone number." };
      }
      update.injuredPhone = phone;
    }
  }

  if (provided("injuredEmail")) {
    const raw = (patch.injuredEmail ?? "").trim();
    if (raw === "") {
      update.injuredEmail = null;
    } else if (!isValidEmail(raw)) {
      return { ok: false, error: "Enter a valid email address." };
    } else {
      update.injuredEmail = raw;
    }
  }

  if (provided("dateOfAccident")) {
    const raw = (patch.dateOfAccident ?? "").trim();
    if (raw === "") {
      update.dateOfAccident = null;
    } else {
      const date = parseDateOnly(raw);
      if (!date) return { ok: false, error: "Enter a valid date." };
      const now = new Date();
      const todayUtc = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
      );
      if (date.getTime() > todayUtc) {
        return { ok: false, error: "The date can't be in the future." };
      }
      update.dateOfAccident = date;
    }
  }

  if (provided("state")) {
    const raw = (patch.state ?? "").trim();
    if (raw === "") {
      update.state = null;
    } else {
      const state = toStateCode(raw);
      if (!state) return { ok: false, error: "Choose a valid US state." };
      update.state = state;
    }
  }

  // A state change must not leave a county that belongs to the old state.
  if (provided("state") && !provided("county")) {
    const nextState = update.state ?? null;
    if (!nextState) {
      update.county = null;
    } else if (lead.county && !toCounty(nextState, lead.county)) {
      update.county = null;
    }
  }

  if (provided("county")) {
    const raw = (patch.county ?? "").trim();
    if (raw === "") {
      update.county = null;
    } else {
      const state = update.state !== undefined ? update.state : lead.state;
      if (!state) {
        return { ok: false, error: "Choose a state before choosing a county." };
      }
      const county = toCounty(state, raw);
      if (!county)
        return { ok: false, error: "Choose a county from the list." };
      update.county = county;
    }
  }

  if (provided("postcode")) {
    const raw = (patch.postcode ?? "").trim();
    if (raw === "") {
      update.postcode = null;
    } else {
      const postcode = normalizePostcode(raw);
      if (!postcode) return { ok: false, error: "Enter a valid ZIP code." };
      update.postcode = postcode;
    }
  }

  for (const key of ["injuryDetails", "accidentDetails"] as const) {
    if (!provided(key)) continue;
    const value = toNullableText(patch[key]);
    if (value && value.length > MAX_TEXT_LENGTH) {
      return { ok: false, error: "That description is too long." };
    }
    update[key] = value;
  }

  for (const key of [
    "isAtFault",
    "hasAttorney",
    "hasReceivedSettlement",
  ] as const) {
    if (!provided(key)) continue;
    const value = patch[key];
    if (value !== null && typeof value !== "boolean") {
      return { ok: false, error: "Choose Yes, No, or Unknown." };
    }
    update[key] = value;
  }

  if (provided("stage")) {
    const stage = patch.stage;
    if (!(LEAD_STAGES as readonly string[]).includes(stage as string)) {
      return { ok: false, error: "Unknown stage." };
    }
    update.stage = stage;
  }

  if (provided("assignedToId")) {
    const assignee = patch.assignedToId;
    if (
      assignee !== null &&
      (!Number.isInteger(assignee) || (assignee as number) <= 0)
    ) {
      return { ok: false, error: "Unknown assignee." };
    }
    update.assignedToId = assignee;
  }

  return { ok: true, update };
}

/** Canonicalise and apply a raw patch from the detail dialog. */
export function saveLeadFieldsForActor(
  actor: Actor,
  id: number,
  patch: LeadFieldPatch,
): LeadMutationResult {
  try {
    const lead = requireVisibleLead(actor, id);
    const normalized = normalizeLeadPatch(lead, patch);
    if (!normalized.ok) return normalized;
    return applyLeadUpdate(actor, lead, normalized.update);
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
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
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    throw error;
  }
}
