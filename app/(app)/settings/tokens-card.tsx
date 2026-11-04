"use client";

/**
 * Token management for the signed-in user, plus the connection details an MCP
 * client needs.
 *
 * The raw token is only ever present in the response to the create action, so it
 * is rendered from `useActionState` state rather than from anything the page
 * loaded — once the component re-renders without it, the value is gone for good.
 */
import { useActionState, useState } from "react";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import {
  createToken,
  revokeToken,
  type CreateTokenState,
} from "@/lib/auth/api-token-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";

/** A token as the page passes it in — dates arrive as real `Date`s. */
export interface TokenRow {
  id: number;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** Copy `value` to the clipboard, confirming briefly in place. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard access can be denied; the value is on screen either way.
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** A labelled, monospaced value with a copy affordance. */
function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md border bg-muted/50 px-2.5 py-1.5 font-mono text-xs">
          {value}
        </code>
        <CopyButton value={value} label="Copy" />
      </div>
    </div>
  );
}

/**
 * Instructions a coding agent can read and apply by itself.
 *
 * When a token was just created it is included once, so the whole handoff is a
 * single paste. Older tokens cannot be read back, so those instructions carry a
 * placeholder the person replaces with a fresh token.
 */
function instructionsFor(endpoint: string, token: string | null): string {
  const credential = token ?? "<your token>";
  return `Connect to the Apex Intake Desk MCP server.

Endpoint: ${endpoint}
Transport: Streamable HTTP
Authentication: send this header on every request:
Authorization: Bearer ${credential}

If your client reads a JSON config, add this server entry:
{
  "mcpServers": {
    "apex-intake-desk": {
      "type": "http",
      "url": "${endpoint}",
      "headers": { "Authorization": "Bearer ${credential}" }
    }
  }
}

The token acts as the signed-in Apex user, so the assistant can see and change exactly what that user can. Keep the token private and never commit it to a repository.`;
}

export function TokensCard({
  tokens,
  endpoint,
}: {
  tokens: TokenRow[];
  endpoint: string;
}) {
  const [state, formAction, pending] = useActionState<
    CreateTokenState,
    FormData
  >(createToken, {});

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Assistant access tokens</CardTitle>
          <CardDescription>
            Let an external AI assistant — Claude, Cursor, or anything that
            speaks the Model Context Protocol — work on your leads. It signs in
            as you, so it can do exactly what you can and nothing more, and it
            stops working the moment you revoke its token.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {state.token ? (
            <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Your new token</p>
                <p className="text-xs text-muted-foreground">
                  Copy it now — this is the only time it is shown. If you lose
                  it, revoke this one and create another.
                </p>
              </div>
              <CopyField label="Token" value={state.token} />
            </div>
          ) : null}

          <form action={formAction} className="space-y-2">
            <Label htmlFor="token-name">Name</Label>
            <div className="flex gap-2">
              <Input
                // Remounting on success clears the field without extra state.
                key={state.token ?? "new"}
                id="token-name"
                name="name"
                placeholder="Claude Desktop"
                maxLength={60}
                autoComplete="off"
                required
              />
              <Button type="submit" disabled={pending}>
                <KeyRound />
                {pending ? "Creating…" : "Create token"}
              </Button>
            </div>
            {state.error ? (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            ) : null}
          </form>

          {tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tokens yet. Create one to connect an assistant.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {tokens.map((token) => (
                <li
                  key={token.id}
                  className="flex flex-wrap items-center gap-2 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{token.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{token.prefix}…</span> ·
                      created {formatDate(token.createdAt)} ·{" "}
                      {token.lastUsedAt
                        ? `last used ${formatDate(token.lastUsedAt)}`
                        : "never used"}
                    </p>
                  </div>
                  <form action={revokeToken}>
                    <input type="hidden" name="id" value={token.id} />
                    <Button type="submit" variant="outline" size="sm">
                      <Trash2 />
                      Revoke
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connect an assistant</CardTitle>
          <CardDescription>
            Point the client at this endpoint and send a token in the
            <code className="mx-1 font-mono text-xs">Authorization</code>
            header. Most clients take a config entry like this one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyField label="Endpoint" value={endpoint} />
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Client config</Label>
            <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs">
              <code>{`{
  "mcpServers": {
    "apex-intake-desk": {
      "type": "http",
      "url": "${endpoint}",
      "headers": { "Authorization": "Bearer <your token>" }
    }
  }
}`}</code>
            </pre>
          </div>
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm text-muted-foreground">
              Paste these instructions into Claude Code, Cursor, or another
              coding agent and it can set up the connection for you.
            </p>
            <CopyButton
              value={instructionsFor(endpoint, state.token ?? null)}
              label="Copy Instructions for AI"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
