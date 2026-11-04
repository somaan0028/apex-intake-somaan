/**
 * AI configuration — the model, the agent-loop budget, and the payload caps.
 *
 * OpenRouter is the single provider: one key (`OPENROUTER_API_KEY`) reaches many
 * models, and its usage block reports the USD cost of each call, which the
 * assistant stores per assistant message. The model id is overridable with
 * `AI_MODEL` so a test run can point somewhere cheaper without a code change.
 */
import { maxIterations } from "@tanstack/ai";
import { openRouterText } from "@tanstack/ai-openrouter";

/**
 * The adapter factory is typed against the models the installed package knows
 * about, so `Parameters<>[0]` is that literal union. A runtime override from
 * the environment is cast into it rather than widening the adapter call.
 */
type OpenRouterModel = Parameters<typeof openRouterText>[0];

/**
 * A free model with working tool calling, kept deliberately cheap: this is a
 * test app, and a stronger model can be dropped in later via `AI_MODEL`.
 *
 * Chosen after probing the free tier: several free models are unavailable,
 * harness-only, or rate-limited, and a paid flash-class model was not needed.
 * `north-mini-code` was the one that consistently called tools and answered.
 */
const DEFAULT_MODEL = "cohere/north-mini-code:free";

/** The OpenRouter model id used for every assistant call. */
export const AI_MODEL: OpenRouterModel = (process.env.AI_MODEL?.trim() ||
  DEFAULT_MODEL) as OpenRouterModel;

/** The chat adapter. Reads `OPENROUTER_API_KEY` from the environment. */
export function createChatAdapter() {
  return openRouterText(AI_MODEL);
}

/**
 * Upper bound on model turns per user message. Each turn may call tools, so this
 * caps how long a single reply can spin before it must answer.
 */
export const AGENT_LOOP_STRATEGY = maxIterations(8);

/** Hard cap on the number of prior messages rebuilt into a model request. */
export const MAX_HISTORY_MESSAGES = 60;

/** Hard cap on rows any single list tool may return, so a reply stays in budget. */
export const MAX_TOOL_ROWS = 25;

/** Longest a user message may be, in characters. */
export const MAX_MESSAGE_LENGTH = 4000;

/** Longest an auto-generated chat title may be, in characters. */
export const MAX_TITLE_LENGTH = 60;
