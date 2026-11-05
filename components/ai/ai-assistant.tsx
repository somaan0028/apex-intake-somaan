"use client";

/**
 * The assistant panel, its entry point, and the handle pages open it through.
 *
 * The panel lives in the app shell and is deliberately **non-modal**: it floats
 * over the page without a dimming backdrop or a blur, the page behind stays
 * usable, and it only closes when the user closes it. Clicking elsewhere — or
 * moving to another page, since it lives in the shell — leaves it open, so it
 * feels like a teammate that travels with you rather than a task you enter and
 * leave.
 *
 * `AiAssistantProvider` owns the state and publishes `open(prompt)` through
 * context (`./assistant-context`), so a page like the Overview can open the
 * panel with a suggested question already sent. It also owns the conversation
 * list: which chat is open, the "past chats" view, and starting or deleting a
 * conversation.
 */
import { History, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getChatList, loadChat, removeChat } from "@/lib/ai/actions";
import { ASSISTANT_NAME } from "@/lib/ai/identity";
import type { ChatSummary, StoredMessage } from "@/lib/ai/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AiAssistantContext, useAiAssistant } from "./assistant-context";
import { ChatThread, type ComposerDraft } from "./chat-thread";

/** Remembers the conversation to reopen, so a page reload resumes it. */
const LAST_CHAT_KEY = "apex.ai.lastChatId";

/** Mint the thread id a new conversation will use (it doubles as its DB key). */
function newChatId(): string {
  return crypto.randomUUID();
}

/** The header button. Kept separate so the provider can wrap the whole shell. */
export function AiAssistantButton() {
  const { open } = useAiAssistant();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="ml-auto"
      // Stable hook for automation; the label below is what users hear.
      id="open-ai-assistant"
      aria-label={`Open ${ASSISTANT_NAME}, your AI assistant`}
      title={`${ASSISTANT_NAME} — AI assistant`}
      onClick={() => open()}
    >
      <Sparkles />
    </Button>
  );
}

export function AiAssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<StoredMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComposerDraft>({ text: "", seq: 0 });

  // Remember the active conversation; this is a state → external-system sync,
  // so an effect is the right place for it.
  useEffect(() => {
    if (chatId) window.localStorage.setItem(LAST_CHAT_KEY, chatId);
  }, [chatId]);

  const refreshChats = useCallback(async () => {
    try {
      setChats(await getChatList());
    } catch {
      // A failed history fetch should not block chatting.
    }
  }, []);

  /** Open an existing conversation, loading its transcript. */
  const openChat = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setShowHistory(false);
    try {
      const transcript = await loadChat(id);
      if (!transcript) {
        // The remembered chat was deleted elsewhere; start fresh instead.
        setChatId(newChatId());
        setInitialMessages([]);
        return;
      }
      setChatId(transcript.id);
      setInitialMessages(transcript.messages);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Start an empty conversation. Its row is created on the first message. */
  const startChat = useCallback(() => {
    setError(null);
    setShowHistory(false);
    setChatId(newChatId());
    setInitialMessages([]);
  }, []);

  /**
   * Showing the panel is a user action, so the bootstrap runs here rather than
   * in an effect: resume the conversation the user last had, else the most
   * recent one, else start fresh.
   */
  const reveal = useCallback(() => {
    setOpen(true);
    if (chatId !== null) {
      void refreshChats();
      return;
    }

    const remembered = window.localStorage.getItem(LAST_CHAT_KEY);
    void getChatList()
      .then((list) => {
        setChats(list);
        const target =
          remembered && list.some((chat) => chat.id === remembered)
            ? remembered
            : list[0]?.id;
        if (target) return openChat(target);
        startChat();
      })
      .catch(() => startChat());
  }, [chatId, openChat, refreshChats, startChat]);

  /**
   * The handle pages use: show the panel, optionally sending a question right
   * away. The prompt is handed to the thread as a one-shot draft; `consumeDraft`
   * clears it once sent so remounting the thread (a new chat, a reopened panel)
   * never sends the same question twice.
   */
  const openWithPrompt = useCallback(
    (prompt?: string) => {
      if (prompt) {
        setDraft((previous) => ({ text: prompt, seq: previous.seq + 1 }));
      }
      reveal();
    },
    [reveal],
  );

  const consumeDraft = useCallback((seq: number) => {
    setDraft((previous) =>
      previous.seq === seq ? { ...previous, text: "" } : previous,
    );
  }, []);

  const handle = useMemo(() => ({ open: openWithPrompt }), [openWithPrompt]);

  const deleteChat = useCallback(
    async (id: string) => {
      await removeChat(id);
      const remaining = chats.filter((chat) => chat.id !== id);
      setChats(remaining);
      if (id === chatId) {
        if (remaining.length > 0) {
          await openChat(remaining[0].id);
        } else {
          startChat();
        }
      }
    },
    [chats, chatId, openChat, startChat],
  );

  return (
    <AiAssistantContext.Provider value={handle}>
      {children}

      <Sheet
        open={open}
        onOpenChange={setOpen}
        // Non-modal: no focus trap, no scroll lock, the page stays interactive.
        modal={false}
        // Only the user closes it — not an outside click, not a focus change.
        disablePointerDismissal
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          showOverlay={false}
          // The base sheet pins `data-[side=right]:w-3/4` and `…:sm:max-w-sm`.
          // Tailwind emits those variant utilities after a plain `w-full`, so
          // the panel kept 75% of a phone screen; repeat the same variants here
          // to override them (the merge in `cn` then drops the base ones).
          className="w-full gap-0 p-0 shadow-2xl data-[side=right]:w-full data-[side=right]:max-w-none sm:w-[26rem] data-[side=right]:sm:w-[26rem] sm:max-w-[26rem] data-[side=right]:sm:max-w-[26rem]"
        >
          <SheetHeader className="flex shrink-0 flex-row items-center gap-1 border-b p-3 pr-2">
            <Sparkles className="size-4 shrink-0 text-muted-foreground" />
            <SheetTitle className="mr-auto text-sm">{ASSISTANT_NAME}</SheetTitle>
            <SheetDescription className="sr-only">
              Chat with {ASSISTANT_NAME} about your leads and team.
            </SheetDescription>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="New chat"
              title="New chat"
              onClick={startChat}
            >
              <Plus />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Past chats"
              title="Past chats"
              aria-pressed={showHistory}
              onClick={() => setShowHistory((value) => !value)}
            >
              <History />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </SheetHeader>

          {showHistory ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {chats.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No past chats yet.
                </p>
              ) : (
                <ul className="grid gap-0.5">
                  {chats.map((chat) => (
                    <li key={chat.id} className="group flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void openChat(chat.id)}
                        className={cn(
                          "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                          chat.id === chatId && "bg-muted",
                        )}
                      >
                        <span className="truncate">{chat.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDate(chat.updatedAt)}
                        </span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${chat.title}`}
                        onClick={() => void deleteChat(chat.id)}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : chatId ? (
            <ChatThread
              key={chatId}
              chatId={chatId}
              initialMessages={initialMessages}
              draft={draft}
              onDraftConsumed={consumeDraft}
              onTurnComplete={() => void refreshChats()}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </AiAssistantContext.Provider>
  );
}
