/**
 * `POST|GET|DELETE /api/mcp` — the MCP endpoint.
 *
 * This is the one route an external AI agent talks to. It is deliberately thin:
 * it authenticates the caller, then hands the request to the MCP handler built in
 * `lib/mcp/server.ts`. Nothing about what an agent may *do* lives here — that is
 * decided by the tool layer running as the authenticated user.
 *
 * Authentication is a personal access token (`lib/auth/api-token.ts`) presented as
 * `Authorization: Bearer <token>`. A cookie session would not work: the caller is
 * a desktop app or CLI, not a browser, and it must not be able to borrow the
 * browser's session. The token resolves to a fresh user row per request, so the
 * agent's permissions are always the owner's current ones.
 *
 * Because it authenticates itself, this path is allow-listed in `proxy.ts` — the
 * cookie guard there would otherwise reject every agent with a 401 before this
 * file ran.
 *
 * These handlers are always dynamic: they read the `Authorization` header and hit
 * the database, and `cacheComponents` (see `next.config.ts`) gives request-coupled
 * route handlers that behaviour without a segment-config opt-out.
 */
import { resolveApiToken } from "@/lib/auth/api-token";
import { apexMcpHandler, readBearerToken, unauthorizedResponse } from "@/lib/mcp/server";

async function serve(request: Request): Promise<Response> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) return unauthorizedResponse();

  const resolved = resolveApiToken(token);
  if (!resolved) return unauthorizedResponse("invalid_token");

  // `authInfo` is the SDK's pass-through slot: the handler never inspects or
  // verifies it, so this is the only place a caller is identified.
  return apexMcpHandler.fetch(request, {
    authInfo: {
      token,
      clientId: String(resolved.user.id),
      scopes: [],
    },
  });
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
