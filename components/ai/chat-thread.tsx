"use client";

/**
 * One conversation: the transcript, the streaming reply, and the composer.
 *
 * `useChat` owns the message list and the SSE connection; this component owns
 * only the compose box. The panel remounts it per chat id, so the hook always
 * starts from the right `initialMessages`.
 *
 * Referencing a record writes it into the text as `lead:Jennifer Price` /
 * `user:Dana Whitfield` and styles it in place, like a chat `@`-mention. The
 * compose box renders that styling with a mirror layer behind the textarea: the
 * textarea's own text is drawn transparent and an identical, exactly-aligned
 * copy is painted underneath, so a token can carry a background without the
 * caret, selection, or layout moving. The mirror's token styling must therefore
 * never change metrics — no padding, no font weight — or everything after it
 * would drift. The message bubbles are real DOM and can style freely.
 */
import {
  fetchServerSentEvents,
  useChat,
  type UIMessage,
} from "@tanstack/ai-react";
import {
  Loader2,
  RotateCcw,
  SendHorizontal,
  Square,
  Wrench,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { searchMentions } from "@/lib/ai/actions";
import {
  activeMentions,
  mentionToken,
  mergeMentions,
  splitMentions,
} from "@/lib/ai/mention-tokens";
import type {
  MentionKind,
  MentionOption,
  MentionRef,
  StoredMessage,
} from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

/** A prompt the empty state offers, to make the first turn obvious. */
const STARTER_PROMPTS = [
  "Show me the newest unassigned leads",
  "How many leads are at each stage?",
  "Which MVA leads are ready to send to the firm?",
];

/**
 * The reference token under the caret: `@` for anything, `lead:` or `user:` to
 * narrow to one kind.
 */
const MENTION_PATTERN = /(^|\s)(@|lead:|user:)([^\s]*)$/;

/** Classes shared by the textarea and its mirror, so they line up exactly. */
const INPUT_BOX =
  "border px-2.5 py-2 text-sm leading-6 break-words whitespace-pre-wrap";

/**
 * A tag in the composer.
 *
 * The composer's tags are painted by the mirror layer behind the textarea. Only
 * colour and weight-free decoration may differ from the plain text — anything
 * that changes metrics (padding, font weight, a border) would push every
 * character after the tag out of line with the transparent textarea text
 * underneath, so the caret and selection would visibly drift.
 */
const COMPOSER_TAG =
  "text-primary underline decoration-primary/50 underline-offset-4";

/** A tag inside a sent message, which is ordinary DOM and may style freely. */
const MESSAGE_TAG = "font-bold";

/** Rebuild the hook's message list from the stored transcript. */
function toInitialMessages(messages: StoredMessage[]): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: "text", content: message.content }],
    createdAt: new Date(message.createdAt),
  }));
}

/** The `@…` / `lead:…` token immediately before the caret, if there is one. */
function readMentionQuery(
  value: string,
  caret: number,
): {
  start: number;
  end: number;
  kind: MentionKind | null;
  query: string;
} | null {
  const match = MENTION_PATTERN.exec(value.slice(0, caret));
  if (!match) return null;
  const trigger = match[2] ?? "";
  const query = match[3] ?? "";
  return {
    start: caret - trigger.length - query.length,
    end: caret,
    kind: trigger === "lead:" ? "lead" : trigger === "user:" ? "user" : null,
    query,
  };
}

/** Join a message's text parts. */
function textOf(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .map((part) =>
      part.type === "text"
        ? ((part as { content?: string }).content ?? "")
        : "",
    )
    .join("");
}

/** A tool call shown inline, so the user can see the assistant working. */
function ToolCallChip({ name, state }: { name: string; state?: string }) {
  const running = state !== "complete";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-background/60 px-2 py-1 text-xs text-muted-foreground">
      {running ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Wrench className="size-3" />
      )}
      {name}
    </span>
  );
}

/** A user's own message, with its references shown as tags. */
function UserMessage({
  text,
  mentions,
}: {
  text: string;
  mentions: ReadonlyArray<MentionRef>;
}) {
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap">
      {splitMentions(text, mentions).map((segment, index) =>
        segment.mention ? (
          <span key={index} className={MESSAGE_TAG}>
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

/** An assistant reply: Markdown, with tool calls shown as chips. */
function AssistantMessage({ message }: { message: UIMessage }) {
  const text = textOf(message);
  const hasText = text.trim().length > 0;

  return (
    <div className="grid gap-1.5">
      {message.parts.map((part, index) => {
        if (part.type !== "tool-call") return null;
        const call = part as unknown as {
          id?: string;
          name: string;
          state?: string;
        };
        return (
          <ToolCallChip
            key={call.id ?? index}
            name={call.name}
            state={call.state}
          />
        );
      })}
      {hasText ? <Markdown content={text} /> : null}
    </div>
  );
}

/** A prompt a page asked the assistant to start with, and a counter identifying
 * the request. The counter is what lets the composer apply each request exactly
 * once, even if the same question is asked twice. */
export interface ComposerDraft {
  text: string;
  seq: number;
}

export function ChatThread({
  chatId,
  initialMessages,
  draft,
  onTurnComplete,
}: {
  chatId: string;
  initialMessages: StoredMessage[];
  /** Text to place in the composer, chosen elsewhere (e.g. Overview suggestions). */
  draft?: ComposerDraft;
  /** Called after each completed turn, so the panel can refresh titles/order. */
  onTurnComplete?: () => void;
}) {
  // `initialMessages` only matters on mount; the panel keys this component by
  // chat id, so a new conversation always gets a fresh client.
  const seeded = useMemo(
    () => toInitialMessages(initialMessages),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed on mount only
    [chatId],
  );

  const { messages, sendMessage, reload, isLoading, error, stop } = useChat({
    connection: fetchServerSentEvents("/api/ai/chat"),
    threadId: chatId,
    initialMessages: seeded,
    onFinish: () => onTurnComplete?.(),
  });

  const [input, setInput] = useState(draft?.text ?? "");
  const [appliedDraftSeq, setAppliedDraftSeq] = useState(draft?.seq ?? 0);
  const [mentions, setMentions] = useState<MentionRef[]>([]);
  const [sessionMentions, setSessionMentions] = useState<MentionRef[]>([]);
  const [mentionQuery, setMentionQuery] =
    useState<ReturnType<typeof readMentionQuery>>(null);
  const [suggestionState, setSuggestionState] = useState<{
    query: string;
    kind: MentionKind | null;
    items: MentionOption[];
  }>({ query: "", kind: null, items: [] });
  const [activeIndex, setActiveIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A question chosen elsewhere (a suggestion on the Overview page) is folded
  // into the composer. Adjusting state during render is React's documented
  // alternative to an effect here: the counter means each request lands exactly
  // once, and it converges on the next render.
  if (draft && draft.seq !== appliedDraftSeq) {
    setAppliedDraftSeq(draft.seq);
    setInput(draft.text);
  }

  // Every reference this conversation has shown, so a tag renders as a tag when
  // a past chat is reloaded — the transcript carries its own references.
  const knownMentions = useMemo(() => {
    const stored = initialMessages.flatMap((message) => message.mentions ?? []);
    return mergeMentions(stored, sessionMentions);
  }, [initialMessages, sessionMentions]);

  // Keep the newest content in view as tokens stream in.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, isLoading]);

  // Debounced autocomplete for the token under the caret.
  useEffect(() => {
    const query = mentionQuery?.query ?? "";
    if (query.length < 1) return;
    const kind = mentionQuery?.kind ?? null;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchMentions(query)
        .then((result) => {
          if (cancelled) return;
          setSuggestionState({
            query,
            kind,
            items: [...result.leads, ...result.users].filter(
              (item) => kind === null || item.kind === kind,
            ),
          });
          setActiveIndex(0);
        })
        .catch(() => {
          if (!cancelled) setSuggestionState({ query, kind, items: [] });
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mentionQuery?.query, mentionQuery?.kind]);

  // Results are tagged with the token they answer, so a stale response can never
  // appear under a newer token and clearing needs no state write in an effect.
  const suggestions =
    mentionQuery &&
    suggestionState.query === mentionQuery.query &&
    suggestionState.kind === mentionQuery.kind
      ? suggestionState.items
      : [];
  const open = suggestions.length > 0;

  /** Recompute the mention token from the textarea's current caret. */
  const syncMention = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    setMentionQuery(readMentionQuery(node.value, node.selectionStart ?? 0));
  }, []);

  /** Keep the mirror aligned when the textarea scrolls under its max height. */
  const syncScroll = useCallback(() => {
    if (mirrorRef.current && textareaRef.current) {
      mirrorRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  function handleInputChange(value: string) {
    setInput(value);
    // A reference whose token no longer appears was edited away.
    setMentions((previous) => activeMentions(value, previous));
    syncMention();
  }

  /** Write a reference into the text and style it in place. */
  function selectMention(option: MentionOption) {
    if (!mentionQuery) return;
    const node = textareaRef.current;
    const caret = node?.selectionStart ?? input.length;
    const token = mentionToken(option);
    const before = input.slice(0, mentionQuery.start);
    const after = input.slice(caret);
    const spacer = after.length === 0 || /^\s/.test(after) ? "" : " ";

    setInput(`${before}${token}${spacer}${after}`);
    setMentions((previous) => mergeMentions(previous, [option]));
    setMentionQuery(null);
    setSuggestionState({ query: "", kind: null, items: [] });

    const nextCaret = before.length + token.length + spacer.length;
    requestAnimationFrame(() => {
      if (!node) return;
      node.focus();
      node.setSelectionRange(nextCaret, nextCaret);
    });
  }

  async function handleSend() {
    const text = input.trim();
    const refs = activeMentions(input, mentions);
    if ((!text && refs.length === 0) || isLoading) return;

    setInput("");
    setMentions([]);
    setMentionQuery(null);
    setSuggestionState({ query: "", kind: null, items: [] });
    setSessionMentions((previous) => mergeMentions(previous, refs));

    await sendMessage(
      text || "Tell me about this.",
      refs.length
        ? { body: { mentions: refs.map((m) => ({ kind: m.kind, id: m.id })) } }
        : undefined,
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (index) => (index - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const option = suggestions[activeIndex];
        if (option) selectMention(option);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuggestionState({ query: "", kind: null, items: [] });
        setMentionQuery(null);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  const segments = useMemo(
    () => splitMentions(input, mentions),
    [input, mentions],
  );

  const isEmpty = messages.length === 0;
  const lastMessage = messages[messages.length - 1];
  // A settled turn that produced no text at all is surfaced rather than leaving
  // a tool chip with no explanation and no error.
  const emptyReply =
    !isLoading &&
    messages.length > 0 &&
    lastMessage?.role === "assistant" &&
    textOf(lastMessage).trim().length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {isEmpty ? (
          <div className="grid gap-3 py-6">
            <p className="text-sm text-muted-foreground">
              What would you like to know? To point the assistant at a specific
              lead or teammate, type <span className="font-medium">@</span> and
              pick them from the list.
            </p>
            <div className="grid gap-1.5">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => {
                    setInput(prompt);
                    textareaRef.current?.focus();
                  }}
                  className="rounded-lg border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {messages.map((message) => {
              const isUser = message.role === "user";
              return (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[90%] rounded-xl px-3 py-2",
                    isUser
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "bg-muted/60",
                  )}
                >
                  {isUser ? (
                    <UserMessage
                      text={textOf(message)}
                      mentions={knownMentions}
                    />
                  ) : (
                    <AssistantMessage message={message} />
                  )}
                </div>
              );
            })}
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Working…
              </div>
            ) : null}
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error.message ||
              "The assistant could not reply. Please try again."}
          </p>
        ) : null}

        {emptyReply ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
          >
            <span className="flex-1">
              The assistant returned no reply. This is usually a temporary
              hiccup from the model.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void reload()}
            >
              <RotateCcw />
              Try again
            </Button>
          </div>
        ) : null}
      </div>

      <div className="relative border-t p-3">
        {open ? (
          <ul
            // Anchored above the composer, since the panel is bottom-heavy.
            className="absolute inset-x-3 bottom-full mb-2 max-h-64 overflow-y-auto rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10"
            role="listbox"
            aria-label="Reference suggestions"
          >
            {suggestions.map((option, index) => (
              <li key={`${option.kind}-${option.id}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    // Keep the textarea focused while the option is chosen.
                    event.preventDefault();
                    selectMention(option);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    index === activeIndex ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {option.kind === "lead" ? "Lead" : "User"}
                    {option.description ? ` · ${option.description}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="relative">
          {/* Paints the text with tags; the textarea above it is transparent. */}
          <div
            ref={mirrorRef}
            aria-hidden
            className={cn(
              INPUT_BOX,
              "pointer-events-none absolute inset-0 overflow-hidden rounded-lg border-transparent",
            )}
          >
            {segments.map((segment, index) =>
              segment.mention ? (
                <span key={index} className={COMPOSER_TAG}>
                  {segment.text}
                </span>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
          </div>

          <textarea
            ref={textareaRef}
            value={input}
            rows={1}
            placeholder="Ask the assistant…  (@ or lead: to reference a record)"
            className={cn(
              INPUT_BOX,
              "field-sizing-content relative block max-h-40 min-h-9 w-full resize-none rounded-lg border-input bg-transparent text-transparent caret-foreground outline-none selection:bg-primary/25 selection:text-foreground placeholder:text-muted-foreground",
            )}
            onChange={(event) => handleInputChange(event.target.value)}
            onScroll={syncScroll}
            onSelect={syncMention}
            onClick={syncMention}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Enter to send · Shift+Enter for a new line
          </span>
          {isLoading ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Stop"
              onClick={() => stop()}
            >
              <Square />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              aria-label="Send"
              disabled={!input.trim() && mentions.length === 0}
              onClick={() => void handleSend()}
            >
              <SendHorizontal />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
