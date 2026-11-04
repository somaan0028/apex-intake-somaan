"use client";

/**
 * How any page opens the assistant.
 *
 * The panel lives in the app shell so it survives navigation (see
 * `components/ai/ai-assistant.tsx`). Pages are rendered *inside* that shell, so
 * they can't receive it as a prop — the shell publishes this handle through
 * context instead, and a page can ask for the panel to open with a question
 * already in the composer.
 */
import { createContext, useContext } from "react";

export interface AiAssistantHandle {
  /** Open the panel. A `prompt` is placed in the composer, ready to send. */
  open: (prompt?: string) => void;
}

/**
 * A do-nothing handle, so a page rendered outside the app shell (a preview, a
 * test) doesn't crash when it offers the assistant. Callers never need to check
 * for null.
 */
const INERT: AiAssistantHandle = { open: () => {} };

export const AiAssistantContext = createContext<AiAssistantHandle | null>(null);

/** The assistant handle, or a no-op stub when there is no shell. */
export function useAiAssistant(): AiAssistantHandle {
  return useContext(AiAssistantContext) ?? INERT;
}
