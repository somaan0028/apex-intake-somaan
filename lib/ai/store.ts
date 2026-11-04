/**
 * Conversation storage.
 *
 * The server owns the transcript: the streaming route rebuilds the model input
 * from these rows instead of trusting the messages the browser sends, so the
 * same history serves the in-app panel and — later — an MCP client that has no
 * browser transcript at all.
 *
 * A chat is private to the user who started it. Every read and write here takes
 * the actor and asserts ownership, so a guessed chat id is refused.
 */
import type { ModelMessage } from "@tanstack/ai";
import { and, asc, desc, eq } from "drizzle-orm";
import { ForbiddenError } from "@/lib/auth/authorize";
import { getDb } from "@/lib/db";
import { chatMessages, chats, type Chat } from "@/lib/db/schema";
import type { Actor } from "@/lib/rbac";
import { MAX_HISTORY_MESSAGES, MAX_TITLE_LENGTH } from "./config";
import { formatMentionContext } from "./mentions";
import type {
  ChatSummary,
  ChatTranscript,
  MentionRef,
  StoredMessage,
} from "./types";

/** The title a chat carries until its first user message names it. */
export const DEFAULT_CHAT_TITLE = "New chat";

/** How many conversations the history list shows. */
const CHAT_LIST_LIMIT = 50;

/** The chat row when the actor owns it, `null` when it does not exist. */
function findOwnedChat(actor: Actor, chatId: string): Chat | null {
  const chat = getDb()
    .select()
    .from(chats)
    .where(eq(chats.id, chatId))
    .get();
  if (!chat) return null;
  if (chat.userId !== actor.id) {
    throw new ForbiddenError("That conversation belongs to someone else.");
  }
  return chat;
}

/**
 * Create the conversation on first use.
 *
 * The id is minted by the browser (it doubles as the TanStack AI `threadId`), so
 * a chat exists before its first message and abandoned chats never leave empty
 * rows. Ownership is asserted here, so a guessed id belonging to another user is
 * refused rather than taken over.
 */
export function ensureChat(actor: Actor, chatId: string): void {
  const existing = getDb()
    .select({ userId: chats.userId })
    .from(chats)
    .where(eq(chats.id, chatId))
    .get();

  if (existing) {
    if (existing.userId !== actor.id) {
      throw new ForbiddenError("That conversation belongs to someone else.");
    }
    return;
  }

  const now = new Date();
  getDb()
    .insert(chats)
    .values({
      id: chatId,
      userId: actor.id,
      title: DEFAULT_CHAT_TITLE,
      createdAt: now,
      updatedAt: now,
    })
    // Two first messages racing on one thread must not fail the request.
    .onConflictDoNothing()
    .run();
}

/** The actor's conversations, newest first. */
export function listChats(actor: Actor): ChatSummary[] {
  return getDb()
    .select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt })
    .from(chats)
    .where(eq(chats.userId, actor.id))
    .orderBy(desc(chats.updatedAt))
    .limit(CHAT_LIST_LIMIT)
    .all()
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt.getTime(),
    }));
}

/** The transcript as the panel consumes it. */
function listStoredMessages(chatId: string): StoredMessage[] {
  return getDb()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(asc(chatMessages.id))
    .all()
    .map((row) => ({
      // Fall back to the row id so every message has a stable React key.
      id: row.externalId ?? `stored-${row.id}`,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt.getTime(),
      mentions: parseMentions(row.mentions),
    }));
}

/** A conversation with its transcript, or `null` when it does not exist. */
export function getTranscript(
  actor: Actor,
  chatId: string,
): ChatTranscript | null {
  const chat = findOwnedChat(actor, chatId);
  if (!chat) return null;
  return {
    id: chat.id,
    title: chat.title,
    messages: listStoredMessages(chat.id),
  };
}

/** Delete a conversation (the transcript cascades). */
export function deleteChat(actor: Actor, chatId: string): boolean {
  const result = getDb()
    .delete(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, actor.id)))
    .run();
  return result.changes > 0;
}

/** Pull a short, single-line title out of the first thing the user said. */
function deriveTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return DEFAULT_CHAT_TITLE;
  return flat.length > MAX_TITLE_LENGTH
    ? `${flat.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : flat;
}

/**
 * Bump a conversation's recency, and name it from its first user message.
 * `updatedAt` drives the history order, so every turn moves its chat to the top.
 */
function touchChat(chatId: string, now: Date, firstUserText?: string): void {
  const db = getDb();
  const chat = db
    .select({ title: chats.title })
    .from(chats)
    .where(eq(chats.id, chatId))
    .get();
  if (!chat) return;

  const patch: { updatedAt: Date; title?: string } = { updatedAt: now };
  if (firstUserText && chat.title === DEFAULT_CHAT_TITLE) {
    patch.title = deriveTitle(firstUserText);
  }
  db.update(chats).set(patch).where(eq(chats.id, chatId)).run();
}

/** A user turn on its way into storage. */
export interface UserTurn {
  /** The AG-UI message id, used to de-duplicate a resent or retried turn. */
  externalId: string | null;
  content: string;
  /** Server-resolved references; a client-supplied label is never trusted. */
  mentions: MentionRef[];
}

/**
 * Store a user turn. Re-sending the same message id updates nothing — the
 * unique index on `(chat_id, external_id)` makes the insert idempotent, which is
 * what keeps a retried turn from duplicating in the transcript.
 */
export function saveUserTurn(chatId: string, turn: UserTurn): void {
  const db = getDb();
  const now = new Date();
  const values = {
    chatId,
    externalId: turn.externalId,
    role: "user" as const,
    content: turn.content,
    mentions: turn.mentions.length ? JSON.stringify(turn.mentions) : null,
    createdAt: now,
  };

  db.insert(chatMessages)
    .values(values)
    .onConflictDoNothing({
      target: [chatMessages.chatId, chatMessages.externalId],
    })
    .run();

  touchChat(chatId, now, turn.content);
}

/** An assistant turn, with the accounting for the model call that produced it. */
export interface AssistantTurn {
  externalId: string | null;
  content: string;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
}

/** Store an assistant turn and its token/cost accounting. */
export function saveAssistantTurn(chatId: string, turn: AssistantTurn): void {
  const db = getDb();
  const now = new Date();

  db.insert(chatMessages)
    .values({
      chatId,
      externalId: turn.externalId,
      role: "assistant",
      content: turn.content,
      model: turn.model,
      promptTokens: turn.promptTokens,
      completionTokens: turn.completionTokens,
      totalTokens: turn.totalTokens,
      costUsd: turn.costUsd,
      createdAt: now,
    })
    .onConflictDoNothing({
      target: [chatMessages.chatId, chatMessages.externalId],
    })
    .run();

  touchChat(chatId, now);
}

/** Parse the stored mention JSON, tolerating a malformed or absent value. */
function parseMentions(value: string | null): MentionRef[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is MentionRef =>
        !!entry &&
        typeof entry === "object" &&
        "kind" in entry &&
        "id" in entry &&
        "label" in entry,
    );
  } catch {
    return [];
  }
}

/**
 * Rebuild the transcript as model input.
 *
 * A user turn keeps the exact text the person wrote, with a compact list of the
 * records it referenced appended, so the model can act on `@APX-10001 Jane Doe`
 * without the whole record being pasted into the prompt. Only the most recent
 * window is sent, which bounds the cost of a long conversation.
 */
export function listModelMessages(actor: Actor, chatId: string): ModelMessage[] {
  const rows = getDb()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(asc(chatMessages.id))
    .all();

  return rows.slice(-MAX_HISTORY_MESSAGES).map((row) => {
    const context =
      row.role === "user" ? formatMentionContext(parseMentions(row.mentions)) : null;
    return {
      role: row.role,
      content: context ? `${row.content}\n\n${context}` : row.content,
    };
  });
}
