/**
 * The assistant's streaming endpoint.
 *
 * The browser speaks the AG-UI protocol that `useChat` produces; this route
 * turns that request into a `chat()` call and streams the reply back as SSE.
 *
 * The important design choice is that the **server owns the transcript**. The
 * request body carries the client's own message list, but only the newest user
 * turn is read from it — the conversation handed to the model is rebuilt from
 * the database. That is what lets the same history back a non-browser client
 * (the planned MCP server) later, and it means a tampered body cannot inject a
 * fake assistant turn.
 */
import {
  chat,
  chatParamsFromRequest,
  toServerSentEventsResponse,
  type ChatMiddleware,
} from "@tanstack/ai";
import { NextResponse, type NextRequest } from "next/server";
import {
  AGENT_LOOP_STRATEGY,
  AI_MODEL,
  MAX_MESSAGE_LENGTH,
  createChatAdapter,
} from "@/lib/ai/config";
import { resolveMentions } from "@/lib/ai/mentions";
import { buildSystemPrompts } from "@/lib/ai/prompt";
import { stripIntermediateRunFinishes } from "@/lib/ai/stream";
import {
  ensureChat,
  listModelMessages,
  saveAssistantTurn,
  saveUserTurn,
} from "@/lib/ai/store";
import { buildAiTools } from "@/lib/ai/tools";
import type { MentionRef } from "@/lib/ai/types";
import { ForbiddenError } from "@/lib/auth/authorize";
import { getCurrentUser, type AuthUser } from "@/lib/auth/session";

/** Chat ids are UUIDs minted by the browser; anything else is refused. */
const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Pull the plain text out of a UIMessage (`parts`) or a ModelMessage (`content`). */
function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const candidate = message as { content?: unknown; parts?: unknown };

  if (Array.isArray(candidate.parts)) {
    return candidate.parts
      .map((part) =>
        part && typeof part === "object" && (part as { type?: unknown }).type === "text"
          ? String((part as { content?: unknown }).content ?? "")
          : "",
      )
      .join("");
  }
  if (typeof candidate.content === "string") return candidate.content;
  if (Array.isArray(candidate.content)) {
    return candidate.content
      .map((part) =>
        part && typeof part === "object" && "content" in part
          ? String((part as { content?: unknown }).content ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

/** Validate the `mentions` bag the composer sends; labels are ignored. */
function readMentionRefs(value: unknown): MentionRef[] {
  if (!Array.isArray(value)) return [];
  const refs: MentionRef[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const kind = (entry as { kind?: unknown }).kind;
    const id = Number((entry as { id?: unknown }).id);
    if ((kind !== "lead" && kind !== "user") || !Number.isInteger(id) || id <= 0) {
      continue;
    }
    refs.push({ kind, id, label: "" });
  }
  return refs;
}

/** The last user turn in the request, which is the one being sent now. */
function latestUserTurn(
  messages: ReadonlyArray<unknown>,
): { id: string | null; text: string } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; id?: unknown } | undefined;
    if (message?.role !== "user") continue;
    return {
      id: typeof message.id === "string" ? message.id : null,
      text: messageText(message),
    };
  }
  return { id: null, text: "" };
}

/**
 * Persists the assistant's reply once the run settles.
 *
 * Middleware is the supported lifecycle hook — `chat()` has no `onEnd`. The
 * write happens while the response stream drains, so it is fire-and-forget from
 * the client's point of view. `ctx` is closed over rather than read from the
 * request, which is no longer in scope by the time the stream finishes.
 */
function persistTurnMiddleware(user: AuthUser, chatId: string): ChatMiddleware {
  const record = (
    content: string,
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      cost?: number;
    },
  ) => {
    if (!content.trim()) return;
    saveAssistantTurn(chatId, {
      externalId: null,
      content,
      model: AI_MODEL,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      // OpenRouter reports the call's cost in USD in its usage block.
      costUsd: usage?.cost ?? null,
    });
  };

  return {
    name: "persist-assistant-turn",
    onFinish(_ctx, info) {
      record(info.content, info.usage);
    },
    onAbort(ctx) {
      // A stopped reply is still worth keeping, just without accounting.
      record(ctx.accumulatedContent);
    },
  };
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // `chatParamsFromRequest` throws a `Response` on a malformed body. Next.js
  // route handlers do not auto-return a thrown Response, so it is caught here.
  let params: Awaited<ReturnType<typeof chatParamsFromRequest>>;
  try {
    params = await chatParamsFromRequest(request);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  const chatId = params.threadId;
  if (!CHAT_ID_PATTERN.test(chatId)) {
    return NextResponse.json({ error: "Invalid conversation id." }, { status: 400 });
  }

  const turn = latestUserTurn(params.messages);
  const content = turn.text.trim();
  if (!content) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }
  if (content.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` },
      { status: 400 },
    );
  }

  let mentions: MentionRef[];
  try {
    ensureChat(user, chatId);
    // References are re-resolved server-side; a client-sent label is ignored and
    // a record the viewer may not see is dropped.
    mentions = resolveMentions(
      user,
      readMentionRefs(params.forwardedProps?.mentions),
    );
    saveUserTurn(chatId, {
      externalId: turn.id,
      content,
      mentions,
    });
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  // Rebuild the conversation from storage, not from the request body.
  const messages = listModelMessages(user, chatId);
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  const stream = chat({
    adapter: createChatAdapter(),
    messages,
    threadId: chatId,
    systemPrompts: buildSystemPrompts(user),
    tools: buildAiTools(user),
    agentLoopStrategy: AGENT_LOOP_STRATEGY,
    middleware: [persistTurnMiddleware(user, chatId)],
    abortController: controller,
  });

  return stripIntermediateRunFinishes(
    toServerSentEventsResponse(stream, { abortController: controller }),
  );
}
