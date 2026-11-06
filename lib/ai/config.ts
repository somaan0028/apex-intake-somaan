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
 * The cheap tier's most dependable tool-caller. Larry needs several model turns
 * per reply and has to hold a plain-language voice, so instruction-following and
 * reliable tool calls matter more than the per-token price at this volume — a
 * three-turn conversation costs a fraction of a cent either way. Swap it with
 * `AI_MODEL` when trying something else.
 */
const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";

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
