/**
 * The assistant's public identity.
 *
 * Kept in its own module (rather than `lib/ai/config.ts`) because the name is
 * read by client components too, and `config.ts` pulls in the OpenRouter
 * adapter, which must never reach the browser bundle.
 */

/** What the assistant is called in the UI and in its own system prompt. */
export const ASSISTANT_NAME = "Larry";
