/**
 * Client-safe AI types.
 *
 * These cross the Server Action boundary into Client Components, so nothing
 * here may import the database, the provider adapter, or anything else that only
 * exists on the server.
 */

/** One conversation in the history list. */
export interface ChatSummary {
  id: string;
  title: string;
  /** Epoch milliseconds, so it serialises cleanly across the action boundary. */
  updatedAt: number;
}

/** A persisted message as the panel loads it. */
export interface StoredMessage {
  /** Stable id used by the chat hook (the stored external id). */
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Records the message references, so their tokens render as tags on reload. */
  mentions?: MentionRef[];
}

/** A conversation with its transcript. */
export interface ChatTranscript {
  id: string;
  title: string;
  messages: StoredMessage[];
}

/** The kinds of record a message may `@`-reference. */
export const MENTION_KINDS = ["lead", "user"] as const;
export type MentionKind = (typeof MENTION_KINDS)[number];

/**
 * A resolved reference, stored with the message and re-resolved server-side on
 * every request — the label a client sends is never trusted.
 */
export interface MentionRef {
  kind: MentionKind;
  /** Lead id or user id, depending on `kind`. */
  id: number;
  /** Display label, e.g. `APX-10001 Jane Doe` or `Dana Whitfield`. */
  label: string;
  /** Secondary detail: stage and case type for a lead, email for a user. */
  description?: string;
}

/** A reference the compose box may offer. Structurally a resolved reference. */
export type MentionOption = MentionRef;

/** Autocomplete results, grouped so the UI can label each section. */
export interface MentionSearchResult {
  leads: MentionOption[];
  users: MentionOption[];
}

/** Everything a `searchMentionables` call can return, empty when there is no term. */
export const EMPTY_MENTION_RESULT: MentionSearchResult = { leads: [], users: [] };
