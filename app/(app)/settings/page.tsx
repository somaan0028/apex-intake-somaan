import type { Metadata } from "next";
import { headers } from "next/headers";
import { listApiTokens } from "@/lib/auth/api-token";
import { requireUser } from "@/lib/auth/session";
import { TokensCard } from "./tokens-card";

export const metadata: Metadata = {
  title: "Settings · Apex Intake Desk",
};

/**
 * Account settings. Today that means the access tokens for external AI
 * assistants; it is the only place a user can mint one for themselves.
 */
export default async function SettingsPage() {
  const user = await requireUser();
  const tokens = listApiTokens(user.id);

  // The absolute MCP URL, so the instructions can be copied verbatim rather than
  // assembled by hand. Taken from the request so it matches however the app was
  // reached — localhost, a LAN address, or a tunnel.
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0];
  const protocol =
    forwardedProto?.trim() || (host.startsWith("localhost") ? "http" : "https");
  const endpoint = `${protocol}://${host}/api/mcp`;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Your account, and the assistants connected to it.
        </p>
      </div>
      <TokensCard tokens={tokens} endpoint={endpoint} />
    </div>
  );
}
