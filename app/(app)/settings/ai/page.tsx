import type { Metadata } from "next";
import { headers } from "next/headers";
import { listApiTokens } from "@/lib/auth/api-token";
import { requireUser } from "@/lib/auth/session";
import { mcpEndpoint } from "@/lib/mcp/endpoint";
import { TokensCard } from "./tokens-card";

export const metadata: Metadata = {
  title: "Connect Your Agent · Apex Intake Desk",
};

/**
 * Agent connection settings. Today that means the access tokens for external
 * AI assistants; it is the only place a user can mint one for themselves.
 */
export default async function AiSettingsPage() {
  const user = await requireUser();
  const tokens = listApiTokens(user.id);

  // The absolute MCP URL, so the instructions can be copied verbatim rather than
  // assembled by hand. It follows the request so localhost, a LAN address, and a
  // reverse proxy each get their own working endpoint.
  const requestHeaders = await headers();
  const endpoint = mcpEndpoint(requestHeaders);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Connect Your Agent
        </h1>
        <p className="text-muted-foreground">
          Manage the assistants connected to your account.
        </p>
      </div>
      <TokensCard tokens={tokens} endpoint={endpoint} />
    </div>
  );
}
