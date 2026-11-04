/**
 * Chat models for the AI assistant — the conversation transcripts it works on.
 *
 * Two tables:
 *
 *   - `chats`          — one conversation, owned by the user who started it.
 *   - `chat_messages`  — the transcript, one row per turn.
 *
 * The **server is the source of truth**: the streaming route rebuilds the model
 * input from these rows rather than trusting the transcript the browser sends,
 * so the same history powers the in-app panel and (later) the MCP surface,
 * which has no browser transcript at all.
 *
 * Token/cost columns are nullable and only populated for assistant turns that
 * actually made a model call. OpenRouter reports the USD cost of a call in its
 * usage block, so `cost_usd` is the provider's own figure rather than a locally
 * computed estimate. They are recorded now so an admin analytics view can read
 * them later.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./users";

/** Who authored a stored message. Tool traffic is not persisted as its own row. */
export const CHAT_ROLES = ["user", "assistant"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export const chats = sqliteTable(
  "chats",
  {
    /**
     * Client-generated UUID that doubles as the TanStack AI `threadId`. Letting
     * the browser mint it means a conversation exists before its first message,
     * so no empty rows are created for chats the user opens and abandons.
     */
    id: text("id").primaryKey(),
    /** Owner. A chat is private to the user who started it. */
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Derived from the first user message; renamed by the user optionally later. */
    title: text("title").notNull().default("New chat"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // The history list reads "this user's chats, newest first".
    index("chats_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    /**
     * The AG-UI message id from the client, kept so a retried or resent turn
     * updates the existing row instead of duplicating it. The unique index
     * below enforces that; `NULL` never collides (SQLite treats nulls as
     * distinct), so a row without an external id is always insertable.
     */
    externalId: text("external_id"),
    role: text("role").$type<ChatRole>().notNull(),
    /** Plain display text; mentions are also present inline as `@Name`. */
    content: text("content").notNull(),
    /** JSON array of `MentionRef`, the records `@`-referenced in this message. */
    mentions: text("mentions"),
    // --- AI-call accounting (assistant turns only) ---
    /** Model that produced the turn, e.g. `google/gemini-2.5-flash-lite`. */
    model: text("model"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    totalTokens: integer("total_tokens"),
    /** Provider-reported cost for the call, in USD. */
    costUsd: real("cost_usd"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    // Rebuilding a transcript reads the whole conversation in order.
    index("chat_messages_chat_id_idx").on(table.chatId, table.id),
    uniqueIndex("chat_messages_external_id_unique").on(
      table.chatId,
      table.externalId,
    ),
    check(
      "chat_messages_role_check",
      sql`${table.role} in ('user', 'assistant')`,
    ),
  ],
);

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
