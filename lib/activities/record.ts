/**
 * Write one activity row.
 *
 * Callers pass structured details, never a finished sentence: the description
 * is built here so every surface words an event the same way, and so no caller
 * can accidentally bake a person's current name into a row that outlives a
 * rename. The one deliberate exception is `lead:deleted`: the row is gone, so
 * the deletion description must keep the name it had at that moment.
 *
 * A logging failure propagates to the caller. The lead/user mutations run their
 * write and this insert in one transaction, so an action cannot be applied
 * without its audit row.
 */
import { getDb } from "@/lib/db";
import { activities, type ActivityType, type LeadStage } from "@/lib/db/schema";
import { LEAD_STAGE_LABELS } from "@/lib/labels";

interface ActivityBase {
  /** The person who performed the action (or on whose behalf AI acted). */
  doerId: number;
  /** True when the action came through the AI/MCP tool layer. */
  isAi?: boolean;
}

/**
 * The details each activity type requires.
 *
 * Required fields are part of the variant, so a caller cannot record a stage
 * change without both stages or a send without its outcome.
 */
export type ActivityInput =
  | (ActivityBase & {
      type: "lead:stage_update";
      leadId: number;
      from: LeadStage;
      to: LeadStage;
    })
  | (ActivityBase & {
      type: "lead:claimed" | "lead:released";
      leadId: number;
    })
  | (ActivityBase & {
      type: "lead:assigned";
      leadId: number;
      /** The person the lead was assigned to. */
      userId: number;
    })
  | (ActivityBase & {
      type: "lead:unassigned";
      leadId: number;
      /** The person whose assignment was removed. */
      userId?: number | null;
    })
  | (ActivityBase & {
      type: "lead:send_to_firm";
      leadId: number;
      /** Whether the firm accepted the lead. */
      succeeded: boolean;
      /** Brightwater's rejection text, only when the provider returned one. */
      providerResponse?: string | null;
    })
  | (ActivityBase & {
      type: "lead:marked-not-duplicate";
      leadId: number;
    })
  | (ActivityBase & {
      type: "lead:deleted";
      leadId: number;
      /**
       * The lead's name at deletion time. Stored in the description because the
       * lead row is gone and can no longer supply a name to readers.
       */
      leadName: string;
    })
  | (ActivityBase & {
      type: "user:added" | "user:deleted";
      userId: number;
    });

/** Build the one-line description for a structured activity. */
function describeActivity(input: ActivityInput): string {
  switch (input.type) {
    case "lead:stage_update":
      return `Changed the stage from ${LEAD_STAGE_LABELS[input.from]} to ${LEAD_STAGE_LABELS[input.to]}`;
    case "lead:claimed":
      return "Claimed unassigned lead";
    case "lead:released":
      return "Released lead";
    case "lead:assigned":
      return "Assigned lead";
    case "lead:unassigned":
      return "Unassigned lead";
    case "lead:send_to_firm": {
      if (input.succeeded) return "Successfully sent lead to firm";
      // Keep the description one line even if the provider's reason contains
      // line breaks. The reason is the useful part for anyone reading later.
      const response = input.providerResponse?.replace(/\s+/g, " ").trim();
      return response
        ? `Failed to send lead to firm. Response: ${response}`
        : "Failed to send lead to firm. Unexpected error occurred";
    }
    case "lead:marked-not-duplicate":
      return "Marked lead as not a duplicate";
    case "lead:deleted":
      return `Deleted lead: ${input.leadName}`;
    case "user:added":
      return "Added user";
    case "user:deleted":
      return "Deleted user";
  }
}

/** Whether a variant carries an affected/assigned user. */
function affectedUserId(input: ActivityInput): number | null {
  if (
    input.type === "lead:assigned" ||
    input.type === "user:added" ||
    input.type === "user:deleted"
  ) {
    return input.userId;
  }
  if (input.type === "lead:unassigned") return input.userId ?? null;
  return null;
}

/** The lead a variant is about, or `null` for user-only events. */
function affectedLeadId(input: ActivityInput): number | null {
  switch (input.type) {
    case "user:added":
    case "user:deleted":
      return null;
    default:
      return input.leadId;
  }
}

/** Persist one activity. */
export function recordActivity(input: ActivityInput): void {
  const type: ActivityType = input.type;
  getDb()
    .insert(activities)
    .values({
      type,
      description: describeActivity(input),
      doerId: input.doerId,
      isAi: input.isAi ?? false,
      leadId: affectedLeadId(input),
      userId: affectedUserId(input),
      createdAt: new Date(),
    })
    .run();
}
