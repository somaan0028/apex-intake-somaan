/**
 * Lead mutations and viewer-aware reads, free of HTTP and the UI.
 *
 * The lead Server Actions (the detail dialog) and the AI tool layer both call
 * these, so the permission checks and the "send at most once" rule exist in one
 * place. The caller always passes a freshly loaded actor and a lead id: the row
 * is read from the database here, never taken from a client payload, because a
 * caller could otherwise claim ownership they don't have.
 */
import {
  and,
  count,
  eq,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  ForbiddenError,
  requireDuplicateResolve,
  requireLeadAssignment,
  requireLeadDelete,
  requireLeadEdit,
  requireLeadReadyToSend,
  requireLeadSend,
  requireLeadStageChange,
  requireLeadView,
} from "@/lib/auth/authorize";
import { leadLabel } from "@/lib/activities/queries";
import { recordActivity } from "@/lib/activities/record";
import { sendLeadToBrightwater } from "@/lib/brightwater";
import { getDb } from "@/lib/db";
import {
  toCounty,
  toNullableText,
  toStateCode,
  toUsPhone,
} from "@/lib/db/normalize";
import {
  CASE_TYPES,
  LEAD_STAGES,
  RELATIONSHIPS,
  leads,
  type Lead,
  type LeadStage,
  type Relationship,
} from "@/lib/db/schema";
import { isValidEmail, normalizePostcode } from "@/lib/validation";
import type { Actor } from "@/lib/rbac";
import { buildDupMatchString } from "./dup-matcher";
import { reconcileDupGroup, recheckLead } from "./dup-groups";
import { scheduleDupCheck } from "./dup-queue";
import type { LeadFieldPatch } from "./editable";
import { leadsVisibilityCondition } from "./queries";

/** Result of a lead mutation; `ok` means the change was applied. */
export interface LeadMutationResult {
  ok: boolean;
  error?: string;
}

/**
 * How a mutation was requested. The UI leaves this empty; the AI/MCP tool
 * layer sets `isAi` so the activity log can tell the two apart without
 * changing who the doer is.
 */
export interface LeadMutationOptions {
  isAi?: boolean;
}

/** Result of a firm submission; on success carries the recorded values. */
export interface SendLeadResult extends LeadMutationResult {
  sentToFirmAt?: Date;
  brightwaterLeadId?: string | null;
}

/** Result of an explicit duplicate re-check; counts are the fresh group sizes. */
export interface DuplicateCheckResult extends LeadMutationResult {
  dupGroupId?: string | null;
  dupGroupCount?: number;
  dupGroupVisibleCount?: number;
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
  /**
   * Required canonical case type, or the current raw campaign value (so an
   * imported lead can be saved without changing it). It is never cleared.
   */
  caseType?: string | null;
  injuredFirstName?: string | null;
  injuredLastName?: string | null;
  injuredPhone?: string | null;
  injuredEmail?: string | null;
  fillerFirstName?: string | null;
  fillerLastName?: string | null;
  fillerPhone?: string | null;
  fillerEmail?: string | null;
  relationshipToInjured?: Relationship | null;
  dateOfAccident?: Date | null;
  state?: string | null;
  county?: string | null;
  postcode?: string | null;
  injuryDetails?: string | null;
  accidentDetails?: string | null;
  notes?: string | null;
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
  options: LeadMutationOptions = {},
): LeadMutationResult {
  try {
    // `id` selects the row; it is not an editable field and must not be treated
    // as one (otherwise claiming a lead would require full edit rights).
    const { id, ...update } = input;
    const lead = requireVisibleLead(actor, id);
    return applyLeadUpdate(actor, lead, update, options);
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Final validation before SQLite.
 *
 * `normalizeLeadPatch` canonicalises the dialog's raw strings, but this runs on
 * the canonical `LeadUpdate` too: the AI/MCP tools (and any future caller of
 * `updateLeadForActor`) must not be able to persist a malformed value by
 * skipping the dialog path.
 */
function validateLeadUpdate(lead: Lead, update: LeadUpdate): NormalizedPatch {
  const next: LeadUpdate = { ...update };

  // The injured person's names are always required.
  if (next.injuredFirstName !== undefined) {
    const value = toNullableText(next.injuredFirstName);
    if (!value) {
      return {
        ok: false,
        error: "The injured person's first name is required.",
      };
    }
    next.injuredFirstName = value;
  }
  if (next.injuredLastName !== undefined) {
    const value = toNullableText(next.injuredLastName);
    if (!value) {
      return {
        ok: false,
        error: "The injured person's last name is required.",
      };
    }
    next.injuredLastName = value;
  }

  // An email is never allowed to be blank or malformed.
  if (next.injuredEmail !== undefined) {
    const value = (next.injuredEmail ?? "").trim();
    if (!isValidEmail(value)) {
      return { ok: false, error: "Enter a valid email address." };
    }
    next.injuredEmail = value;
  }

  if (next.injuredPhone !== undefined) {
    const phone = toUsPhone(next.injuredPhone);
    if (!phone) {
      return { ok: false, error: "Enter a 10-digit US phone number." };
    }
    next.injuredPhone = phone;
  }

  if (next.dateOfAccident !== undefined && next.dateOfAccident !== null) {
    if (!(next.dateOfAccident instanceof Date)) {
      return { ok: false, error: "Enter a valid date." };
    }
    if (Number.isNaN(next.dateOfAccident.getTime())) {
      return { ok: false, error: "Enter a valid date." };
    }
    const now = new Date();
    const todayUtc = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    if (next.dateOfAccident.getTime() > todayUtc) {
      return { ok: false, error: "The date can't be in the future." };
    }
  }

  if (next.state !== undefined) {
    const raw = (next.state ?? "").trim();
    const state = raw === "" ? null : toStateCode(raw);
    if (raw !== "" && !state) {
      return { ok: false, error: "Choose a valid US state." };
    }
    next.state = state;
  }

  if (next.county !== undefined) {
    const raw = (next.county ?? "").trim();
    if (raw === "") {
      next.county = null;
    } else {
      const state = next.state !== undefined ? next.state : lead.state;
      if (!state) {
        return { ok: false, error: "Choose a state before choosing a county." };
      }
      const county = toCounty(state, raw);
      if (!county) {
        return { ok: false, error: "Choose a county from the list." };
      }
      next.county = county;
    }
  } else if (next.state !== undefined) {
    // A state change must not leave a county that belongs to the old state.
    if (next.state === null) {
      next.county = null;
    } else if (lead.county && !toCounty(next.state, lead.county)) {
      next.county = null;
    }
  }

  if (next.postcode !== undefined) {
    const raw = (next.postcode ?? "").trim();
    const postcode = raw === "" ? null : normalizePostcode(raw);
    if (raw !== "" && !postcode) {
      return { ok: false, error: "Enter a valid ZIP code." };
    }
    next.postcode = postcode;
  }

  for (const key of ["injuryDetails", "accidentDetails", "notes"] as const) {
    if (next[key] === undefined) continue;
    const value = toNullableText(next[key]);
    if (value && value.length > MAX_TEXT_LENGTH) {
      return { ok: false, error: "That text is too long." };
    }
    next[key] = value;
  }

  for (const key of [
    "isAtFault",
    "hasAttorney",
    "hasReceivedSettlement",
  ] as const) {
    if (next[key] === undefined) continue;
    const value = next[key];
    if (value !== null && typeof value !== "boolean") {
      return { ok: false, error: "Choose Yes, No, or Unknown." };
    }
  }

  if (next.caseType !== undefined) {
    const value = (next.caseType ?? "").trim();
    if (!value) {
      return { ok: false, error: "Choose a case type." };
    } else if (
      !(CASE_TYPES as readonly string[]).includes(value) &&
      value !== lead.caseType
    ) {
      return { ok: false, error: "Choose a valid case type." };
    } else {
      next.caseType = value;
    }
  }

  if (
    next.stage !== undefined &&
    !(LEAD_STAGES as readonly string[]).includes(next.stage)
  ) {
    return { ok: false, error: "Unknown stage." };
  }

  if (
    next.assignedToId !== undefined &&
    next.assignedToId !== null &&
    (!Number.isInteger(next.assignedToId) || next.assignedToId <= 0)
  ) {
    return { ok: false, error: "Unknown assignee." };
  }

  return { ok: true, update: next };
}

function applyLeadUpdate(
  actor: Actor,
  lead: Lead,
  update: LeadUpdate,
  options: LeadMutationOptions = {},
): LeadMutationResult {
  const validated = validateLeadUpdate(lead, update);
  if (!validated.ok) return validated;
  update = validated.update;

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

  // The injured person's name/email/phone is the duplicate identity. Rebuild
  // the comparison string now (cheap) and let the matcher run afterwards, so
  // an autosave never waits for the fuzzy pass.
  const identityChanged =
    set.injuredFirstName !== undefined ||
    set.injuredLastName !== undefined ||
    set.injuredEmail !== undefined ||
    set.injuredPhone !== undefined;

  let matchStringChanged = false;
  if (identityChanged) {
    const nextMatchString = buildDupMatchString(
      set.injuredFirstName !== undefined
        ? set.injuredFirstName
        : lead.injuredFirstName,
      set.injuredLastName !== undefined
        ? set.injuredLastName
        : lead.injuredLastName,
      set.injuredEmail !== undefined ? set.injuredEmail : lead.injuredEmail,
      set.injuredPhone !== undefined ? set.injuredPhone : lead.injuredPhone,
    );
    if (nextMatchString !== lead.dupMatchString) {
      set.dupMatchString = nextMatchString;
      matchStringChanged = true;
    }
  }

  if (Object.keys(set).length === 0) return { ok: true };

  getDb().transaction(() => {
    getDb().update(leads).set(set).where(eq(leads.id, lead.id)).run();

    if (stageChanged) {
      recordActivity({
        type: "lead:stage_update",
        leadId: lead.id,
        doerId: actor.id,
        isAi: options.isAi,
        from: lead.stage,
        to: update.stage!,
      });
    }

    if (assigneeChanged) {
      const next = update.assignedToId ?? null;
      if (next === null) {
        if (lead.assignedToId === actor.id) {
          recordActivity({
            type: "lead:released",
            leadId: lead.id,
            doerId: actor.id,
            isAi: options.isAi,
          });
        } else {
          recordActivity({
            type: "lead:unassigned",
            leadId: lead.id,
            doerId: actor.id,
            isAi: options.isAi,
            userId: lead.assignedToId,
          });
        }
      } else if (lead.assignedToId === null && next === actor.id) {
        recordActivity({
          type: "lead:claimed",
          leadId: lead.id,
          doerId: actor.id,
          isAi: options.isAi,
        });
      } else {
        recordActivity({
          type: "lead:assigned",
          leadId: lead.id,
          doerId: actor.id,
          isAi: options.isAi,
          userId: next,
        });
      }
    }
  });

  if (matchStringChanged) scheduleDupCheck(lead.id);

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
    const value = toNullableText(patch.injuredFirstName);
    if (!value) {
      return {
        ok: false,
        error: "The injured person's first name is required.",
      };
    }
    update.injuredFirstName = value;
  }
  if (provided("injuredLastName")) {
    const value = toNullableText(patch.injuredLastName);
    if (!value) {
      return {
        ok: false,
        error: "The injured person's last name is required.",
      };
    }
    update.injuredLastName = value;
  }

  if (provided("injuredPhone")) {
    const raw = (patch.injuredPhone ?? "").trim();
    const phone = toUsPhone(raw);
    if (!phone) {
      return { ok: false, error: "Enter a 10-digit US phone number." };
    }
    update.injuredPhone = phone;
  }

  if (provided("injuredEmail")) {
    const raw = (patch.injuredEmail ?? "").trim();
    if (!isValidEmail(raw)) {
      return { ok: false, error: "Enter a valid email address." };
    }
    update.injuredEmail = raw;
  }

  if (provided("fillerFirstName")) {
    update.fillerFirstName = toNullableText(patch.fillerFirstName);
  }
  if (provided("fillerLastName")) {
    update.fillerLastName = toNullableText(patch.fillerLastName);
  }

  if (provided("fillerPhone")) {
    const raw = (patch.fillerPhone ?? "").trim();
    if (raw === "") {
      update.fillerPhone = null;
    } else {
      const phone = toUsPhone(raw);
      if (!phone) {
        return { ok: false, error: "Enter a 10-digit US phone number." };
      }
      update.fillerPhone = phone;
    }
  }

  if (provided("fillerEmail")) {
    const raw = (patch.fillerEmail ?? "").trim();
    if (raw === "") {
      update.fillerEmail = null;
    } else if (!isValidEmail(raw)) {
      return { ok: false, error: "Enter a valid email address." };
    } else {
      update.fillerEmail = raw;
    }
  }

  if (provided("relationshipToInjured")) {
    const raw = (patch.relationshipToInjured ?? "").trim();
    if (raw === "") {
      update.relationshipToInjured = null;
    } else if (!(RELATIONSHIPS as readonly string[]).includes(raw)) {
      return { ok: false, error: "Choose a relationship." };
    } else {
      update.relationshipToInjured = raw as Relationship;
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

  for (const key of ["injuryDetails", "accidentDetails", "notes"] as const) {
    if (!provided(key)) continue;
    const value = toNullableText(patch[key]);
    if (value && value.length > MAX_TEXT_LENGTH) {
      return { ok: false, error: "That text is too long." };
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

  if (provided("caseType")) {
    const value = (patch.caseType ?? "").trim();
    if (!value) {
      return { ok: false, error: "Choose a case type." };
    } else if (
      !(CASE_TYPES as readonly string[]).includes(value) &&
      value !== lead.caseType
    ) {
      return { ok: false, error: "Choose a valid case type." };
    } else {
      update.caseType = value;
    }
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
  options: LeadMutationOptions = {},
): LeadMutationResult {
  try {
    const lead = requireVisibleLead(actor, id);
    const normalized = normalizeLeadPatch(lead, patch);
    if (!normalized.ok) return normalized;
    return applyLeadUpdate(actor, lead, normalized.update, options);
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Permanently delete a lead.
 *
 * Activity rows reference the lead by a plain integer (no foreign key), so the
 * audit trail survives the delete and readers show "Deleted lead" afterwards.
 */
export function deleteLeadForActor(
  actor: Actor,
  id: number,
  options: LeadMutationOptions = {},
): LeadMutationResult {
  try {
    const lead = requireVisibleLead(actor, id);
    requireLeadDelete(actor);

    // Capture the name before the row disappears: the activity description is
    // the only place readers can learn which lead was deleted.
    const leadName = leadLabel(lead);

    getDb().transaction(() => {
      getDb().delete(leads).where(eq(leads.id, id)).run();
      // The lead may have been one half of a pair; never leave the survivor
      // holding a group id for a cluster of one.
      reconcileDupGroup(lead.dupGroupId);
      recordActivity({
        type: "lead:deleted",
        leadId: id,
        doerId: actor.id,
        isAi: options.isAi,
        leadName,
      });
    });

    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Clear a lead's potential-duplicate grouping without deleting the lead.
 *
 * Admin-only: dismissing a match is a judgement about records the actor may
 * not be able to see. Other members keep the group id; if only one remains,
 * reconciliation returns it to a unique lead. The matcher is deliberately not
 * run here — a future new or edited lead can still re-link it, because nobody
 * knows whether that new signal is the same person.
 */
export function markLeadNotDuplicateForActor(
  actor: Actor,
  id: number,
): LeadMutationResult {
  try {
    const lead = requireVisibleLead(actor, id);
    requireDuplicateResolve(actor);
    if (lead.dupGroupId === null) return { ok: true };

    const groupId = lead.dupGroupId;
    getDb().transaction(() => {
      getDb()
        .update(leads)
        .set({ dupGroupId: null })
        .where(eq(leads.id, id))
        .run();
      reconcileDupGroup(groupId);
      recordActivity({
        type: "lead:marked-not-duplicate",
        leadId: id,
        doerId: actor.id,
      });
    });

    return { ok: true };
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Re-run the duplicate matcher for one lead on demand.
 *
 * This is the recovery path for an accidental "Not duplicate": the matcher
 * compares the lead against every other lead, including dismissed ones, so it
 * can re-link it. Any viewer who can see the lead may run it; it changes only
 * the grouping, never the lead's own fields.
 */
export function checkLeadForDuplicatesForActor(
  actor: Actor,
  id: number,
): DuplicateCheckResult {
  try {
    requireVisibleLead(actor, id);
    recheckLead(id);

    const updated = findLead(id);
    const dupGroupId = updated?.dupGroupId ?? null;
    if (!dupGroupId) {
      return {
        ok: true,
        dupGroupId: null,
        dupGroupCount: 0,
        dupGroupVisibleCount: 0,
      };
    }

    const dupGroupCount =
      getDb()
        .select({ value: count() })
        .from(leads)
        .where(eq(leads.dupGroupId, dupGroupId))
        .get()?.value ?? 0;
    const dupGroupVisibleCount =
      getDb()
        .select({ value: count() })
        .from(leads)
        .where(
          and(
            eq(leads.dupGroupId, dupGroupId),
            leadsVisibilityCondition(actor),
          ),
        )
        .get()?.value ?? 0;

    return { ok: true, dupGroupId, dupGroupCount, dupGroupVisibleCount };
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Send a lead to Brightwater, then record the outcome.
 *
 * Guarded five ways before the network call: the actor must hold
 * `leads.send_to_firm`, the lead must be MVA, neither `sent_to_firm_at` nor
 * `brightwater_lead_id` may already be set, the lead must not currently belong
 * to a potential-duplicate group, and no other lead with the same email may
 * already have a recorded submission. Brightwater rejects a second submission
 * for an email, so catching that ourselves avoids a guaranteed provider error.
 * The write that follows is a conditional update on the same two columns, so
 * two requests racing on one lead cannot both record a send — the loser is told
 * it was already sent.
 */
export async function sendLeadForActor(
  actor: Actor,
  id: number,
  options: LeadMutationOptions = {},
): Promise<SendLeadResult> {
  let lead: Lead;
  try {
    lead = requireVisibleLead(actor, id);
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    throw error;
  }

  // A refusal before the network call is not a submission; it is not logged.
  try {
    requireLeadSend(actor, lead);
    requireLeadReadyToSend(lead);
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    throw error;
  }

  // The desk has already warned that this lead may be the same person as
  // another. Sending it anyway ignores that warning, so make the server refuse
  // until the grouping is reviewed (View similar) and resolved (Mark as Not
  // Duplicate, or an edit that breaks the match).
  if (lead.dupGroupId !== null) {
    return {
      ok: false,
      error:
        "This lead is a potential duplicate. Either mark it as 'Not Duplicate', or remove the duplicate records, before sending it to the firm.",
    };
  }

  // Brightwater refuses a second lead with the same email. Our own sent records
  // are the source of truth: if any other lead with this email already has a
  // submission, stop here rather than sending a request we know will fail.
  // Emails are compared case-insensitively and trimmed, matching the provider's
  // practical behaviour (the seed itself has mixed-case variants).
  const emailKey = (lead.injuredEmail ?? "").trim().toLowerCase();
  if (emailKey) {
    const alreadySent = getDb()
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(
          ne(leads.id, lead.id),
          sql`lower(trim(${leads.injuredEmail})) = ${emailKey}`,
          or(
            isNotNull(leads.sentToFirmAt),
            isNotNull(leads.brightwaterLeadId),
          ),
        ),
      )
      .get();

    if (alreadySent) {
      return {
        ok: false,
        error:
          "A lead with this email has already been sent to Brightwater. It will not be sent again.",
      };
    }
  }

  const result = await sendLeadToBrightwater(lead);
  if (!result.ok) {
    recordActivity({
      type: "lead:send_to_firm",
      leadId: lead.id,
      doerId: actor.id,
      isAi: options.isAi,
      succeeded: false,
      providerResponse: result.response,
    });
    return { ok: false, error: result.error };
  }

  const sentToFirmAt = new Date();
  let recorded = false;

  getDb().transaction(() => {
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

    if (update.changes === 0) return;
    recorded = true;

    recordActivity({
      type: "lead:send_to_firm",
      leadId: lead.id,
      doerId: actor.id,
      isAi: options.isAi,
      succeeded: true,
    });
  });

  if (!recorded) {
    // Someone else recorded a send between our read and our update. The firm
    // request did go out, so this is still a failed submission attempt.
    recordActivity({
      type: "lead:send_to_firm",
      leadId: lead.id,
      doerId: actor.id,
      isAi: options.isAi,
      succeeded: false,
    });
    return { ok: false, error: "This lead was already sent to the firm." };
  }

  return { ok: true, sentToFirmAt, brightwaterLeadId: result.leadId };
}
