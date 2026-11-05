/**
 * The Apex Intake Desk MCP server — the app's capability surface for external
 * AI agents (Claude, Cursor, the MCP Inspector, …).
 *
 * The important property is that this module adds **no capabilities of its own**.
 * It registers whatever `buildAiTools(actor)` returns — the same tools the in-app
 * assistant runs — so the two surfaces cannot drift apart and a new tool becomes
 * available to both at once. Every tool already calls the shared lead/user
 * services, which re-check permissions against freshly loaded rows, so an agent
 * connected here can do exactly what its owner can do in the UI and nothing more.
 *
 * The caller is identified by the bearer token the route verified (see
 * `app/api/mcp/route.ts`). `authInfo` is pass-through by design: the SDK never
 * reads or validates it, so the route is the only place authentication happens.
 */
import {
  createMcpHandler,
  McpServer,
  type CallToolResult,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import type { AnyServerTool } from "@tanstack/ai";
import { eq } from "drizzle-orm";
import { buildAiTools } from "@/lib/ai/tools";
import { getDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { LEAD_STAGE_LABELS, USER_ROLE_LABELS } from "@/lib/labels";
import type { Actor } from "@/lib/rbac";
import type { AuthUser } from "@/lib/auth/session";

/** Advertised server identity; `name` is what a host shows in its server list. */
const SERVER_INFO = { name: "apex-intake-desk", version: "1.0.0" };

/**
 * Safety hints per tool, so a host can decide what to confirm before running it.
 *
 * The SDK's defaults are the conservative ones (`readOnlyHint: false`,
 * `destructiveHint: true`), so only the reads need declaring — and a new tool
 * added to `buildAiTools` is treated as destructive until it is listed here,
 * which is the safe way round.
 */
const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  search_leads: { readOnlyHint: true },
  get_lead: { readOnlyHint: true },
  list_users: { readOnlyHint: true },
  update_lead_stage: { destructiveHint: true, idempotentHint: true },
  assign_lead: { destructiveHint: true, idempotentHint: true },
  send_lead_to_firm: { destructiveHint: true, idempotentHint: false },
};

/**
 * The guidance a host shows the model at connect time. It states who the agent
 * is acting as, because "which permissions do I have?" is the first question an
 * agent asks and the answer differs per caller.
 */
function instructions(user: AuthUser): string {
  const stages = Object.values(LEAD_STAGE_LABELS).join(" → ");

  return [
    "Apex Intake Desk — the lead-intake system for Apex Lead Source, which passes qualified MVA and mass-tort leads to partner law firms.",
    `You are connected as ${user.name} (${user.email}), role ${USER_ROLE_LABELS[user.role]}. Every tool runs with that person's own permissions, so you can do exactly what they could do in the app and nothing more. A refused action comes back as an error naming the rule that blocked it: report that to the user instead of looking for another route to the same change.`,
    `Leads move through ${stages}, and only MVA leads are sent to the partner firm (Brightwater), only once they have reached Retained, and at most once each.`,
    "Refer to a lead by the injured person's name. The numeric ids in tool results are handles for your own calls — never show one to the user, and never the matter id.",
  ].join("\n\n");
}

/** Load the person a request is acting as, straight from the database. */
function loadUser(userId: number): AuthUser | null {
  if (!Number.isInteger(userId) || userId <= 0) return null;

  return (
    getDb()
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        avatarPath: users.avatarPath,
      })
      .from(users)
      .where(eq(users.id, userId))
      .get() ?? null
  );
}

/**
 * Register every tool the actor currently has.
 *
 * `AnyServerTool` is the SDK's own heterogeneous shape, so the cast is about
 * erasing the per-tool generics of `buildAiTools`'s tuple, not about inventing a
 * contract: the `name`, `description`, `inputSchema` and `execute` read here are
 * the fields each tool already carries.
 */
function registerTools(server: McpServer, actor: Actor): void {
  for (const tool of buildAiTools(
    actor,
  ) as unknown as readonly AnyServerTool[]) {
    const execute = tool.execute;
    if (!execute) continue;

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // The tool's Zod input schema is a Standard Schema, which is exactly what
        // `registerTool` expects, so the SDK validates arguments before we run.
        inputSchema: tool.inputSchema as StandardSchemaWithJSON,
        annotations: TOOL_ANNOTATIONS[tool.name] ?? {},
      },
      // The model sees JSON, and a refusal is flagged as a tool error so a host
      // renders it as a failure rather than as data to reason over.
      async (args) => toToolResult(await execute(args)),
    );
  }
}

/**
 * A refused tool call is returned as `{ error }` rather than thrown (see
 * `lib/ai/tools.ts`), which the in-app assistant reads as text. MCP has a real
 * error channel, so mark it.
 */
function toToolResult(value: unknown): CallToolResult {
  const message =
    value && typeof value === "object" && "error" in value
      ? (value as { error?: unknown }).error
      : undefined;

  if (typeof message === "string") {
    return { content: [{ type: "text", text: message }], isError: true };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) ?? "null" }],
  };
}

/**
 * The HTTP face of the server.
 *
 * `createMcpHandler` calls the factory once per request and holds nothing
 * between them, so each caller gets a server built for their own actor and no
 * state can leak from one connection to the next. The handler verifies no token
 * itself — the route does that and passes the result through `authInfo`.
 */
export const apexMcpHandler = createMcpHandler(({ authInfo }) => {
  const actor = loadUser(Number(authInfo?.clientId ?? NaN));
  // `McpServer` takes the server identity and its options as *two* arguments
  // (`(serverInfo, options)`); folding them into one object silently buries
  // `instructions` inside `serverInfo` on the wire, where no client reads it.
  const server = new McpServer(
    SERVER_INFO,
    actor ? { instructions: instructions(actor) } : {},
  );

  // An unresolvable caller gets a server with no tools. The route rejects those
  // requests before they get here, so this is belt-and-braces.
  if (actor) registerTools(server, actor);

  return server;
});

/** Pull the token out of an `Authorization: Bearer …` header. */
export function readBearerToken(header: string | null): string | null {
  const match = /^Bearer[ \t]+(.+)$/i.exec(header?.trim() ?? "");
  return match?.[1]?.trim() || null;
}

/**
 * The 401 a client without a usable token receives.
 *
 * A `resource_metadata` pointer is deliberately omitted: this server issues its
 * own tokens from the app rather than running an OAuth authorization server, so
 * sending a client off to discover one would be a dead end. `error` is added
 * only when a token *was* presented and rejected, per RFC 6750.
 */
export function unauthorizedResponse(error?: "invalid_token"): Response {
  const challenge = [
    'Bearer realm="apex-intake-desk"',
    ...(error
      ? [
          `error="${error}"`,
          'error_description="That access token is not valid."',
        ]
      : []),
  ].join(", ");

  return new Response(
    JSON.stringify({
      error: error
        ? "That access token is not valid."
        : "Authentication required. Create an access token under Settings and send it as `Authorization: Bearer <token>`.",
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": challenge,
      },
    },
  );
}
