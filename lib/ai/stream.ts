/**
 * Transport-level stream normalisation for the assistant route.
 *
 * The OpenRouter text adapter closes each *model turn* with a `RUN_FINISHED`
 * (carrying that turn's finish reason) while emitting a single `RUN_STARTED` for
 * the whole run. In a tool loop that produces several `RUN_FINISHED` events for
 * one run.
 *
 * AG-UI allows exactly one terminal `RUN_FINISHED` per run, and the browser
 * client finalises the run on the first one it reads — so the second tool call
 * and the final reply that arrive afterwards are dropped. That is why a question
 * needing two tool calls ended with no answer and no error.
 *
 * The normalisation has to happen on the serialised SSE response, not in
 * `chat()` middleware: middleware runs inside the agent loop, so swallowing the
 * turn-finish event there also stops the loop. Here the engine has already
 * finished its work; only what the browser receives is adjusted. The engine
 * still emits the run's real terminal event when the loop ends, and that one is
 * kept.
 */

/** The finish reason a model turn reports when it wants a tool call next. */
const INTERMEDIATE_FINISH_REASON = "tool_calls";

/** Pull the finish reason out of an SSE frame's JSON payload, if it is a turn end. */
function isIntermediateRunFinish(frame: string): boolean {
  const dataLine = frame
    .split("\n")
    .find((line) => line.startsWith("data:"));
  if (!dataLine) return false;

  try {
    const payload = JSON.parse(dataLine.slice("data:".length).trim()) as {
      type?: unknown;
      finishReason?: unknown;
      metadata?: { tanstack?: { finishReason?: unknown } };
    };
    if (payload.type !== "RUN_FINISHED") return false;
    const reason =
      payload.finishReason ?? payload.metadata?.tanstack?.finishReason;
    return reason === INTERMEDIATE_FINISH_REASON;
  } catch {
    // A frame we cannot parse is never dropped.
    return false;
  }
}

/**
 * Rewrite an SSE response so it carries only the run's terminal `RUN_FINISHED`,
 * dropping the per-turn ones a tool loop emits. Everything else, including the
 * status and headers, is passed through untouched.
 */
export function stripIntermediateRunFinishes(response: Response): Response {
  if (!response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Frames are separated by a blank line; `\r` only ever appears as a line
      // ending here, because the payload is a single JSON line.
      buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );

      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        if (!isIntermediateRunFinish(frame)) {
          controller.enqueue(encoder.encode(`${frame}\n\n`));
        }
        separator = buffer.indexOf("\n\n");
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer && !isIntermediateRunFinish(buffer)) {
        controller.enqueue(encoder.encode(buffer));
      }
    },
  });

  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
