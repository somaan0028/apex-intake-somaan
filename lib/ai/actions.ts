"use server";

/**
 * Server Actions the assistant panel calls directly.
 *
 * These are the non-streaming half of the feature: the history list, loading a
 * past conversation, deleting one, and the `@`-mention autocomplete. All of them
 * resolve the session themselves and scope every read to the signed-in user.
 */
import { ForbiddenError } from "@/lib/auth/authorize";
import { requireUser } from "@/lib/auth/session";
import { searchMentionables } from "./mentions";
import { deleteChat, getTranscript, listChats } from "./store";
import type { ChatSummary, ChatTranscript, MentionSearchResult } from "./types";

/** The signed-in user's conversations, newest first. */
export async function getChatList(): Promise<ChatSummary[]> {
  return listChats(await requireUser());
}

/**
 * Load one conversation. Returns `null` when it does not exist, or when it
 * belongs to someone else — the caller cannot tell the two apart, so no chat id
 * leaks another user's activity.
 */
export async function loadChat(chatId: string): Promise<ChatTranscript | null> {
  const actor = await requireUser();
  try {
    return getTranscript(actor, chatId);
  } catch (error) {
    if (error instanceof ForbiddenError) return null;
    throw error;
  }
}

/** Delete a conversation the signed-in user owns. */
export async function removeChat(chatId: string): Promise<{ ok: boolean }> {
  const actor = await requireUser();
  try {
    return { ok: deleteChat(actor, chatId) };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false };
    throw error;
  }
}

/**
 * Autocomplete for `@`-mentions. Leads respect the viewer's row-level
 * visibility; users are scoped to the team they may reference.
 */
export async function searchMentions(
  term: string,
): Promise<MentionSearchResult> {
  const actor = await requireUser();
  return searchMentionables(actor, term);
}
