<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nextjs-agent-feedback -->

## Report Next.js feedback

The project owner enabled `experimental.agentFeedback`, authorizing this feedback pass. When enabled, `next dev` writes this block and restores it if removed. Commit `AGENTS.md` with your work to keep the tree clean.

During the current user request, retain anonymized facts as feedback candidates for meaningful or recurring Next.js issues:

- Crashes, hangs, OOMs, or unexpected slowness
- Incorrect behavior, output, errors, or diagnostics
- Missing, unclear, or conflicting documentation
- Unexpected CLI, codemod, Skill, or upgrade behavior and non-obvious workarounds

Continue the current user request without reporting immediately. Routine debugging is not feedback. Verify changes before retaining them as feedback candidates. Never retain code, logs, paths, URLs, secrets, personal information, or project-specific data.

Retain qualifying friction even if it is later fixed or worked around; record the final outcome during the reporting pass.

Before the final response, run one reporting pass. If candidates remain, from this file's directory run `npx --no-install next internal agent-feedback-instructions` once without piping or truncating its output. Follow its output or error guidance. If a network sandbox blocks it, retry with network access; if it still returns no output, continue normally.

<!-- END:nextjs-agent-feedback -->

# Apex Intake Desk

Lead-intake app for the fictional **Apex Lead Source** (coding assessment). Apex runs
MVA and Mass Tort campaigns and delivers qualified leads to partner law firms, replacing
their Lawmatics CRM.

## Stack
- Next.js 16 App Router (`cacheComponents`), TypeScript (strict), Tailwind v4, shadcn/ui
- Embedded SQLite via Drizzle ORM + better-sqlite3 (no external DB)
- Auth: email + shared demo password, hashed with Node `scrypt` (no native deps)
- AI: TanStack AI (`@tanstack/ai`) with the OpenRouter adapter; provider/model skills
  are copied into `.agents/skills/`
- MCP: `@modelcontextprotocol/server` (SDK v2) serving that same tool layer to external
  agents over Streamable HTTP at `POST|GET|DELETE /api/mcp`

## Domain rules
- Roles: `ADMIN` (all leads, any stage, assign, send, manage users) and `USER`
  (unassigned + own leads, up to `RETAINED`).
- Stages: `NEW → CONTACTED → QUALIFIED → RETAINED → SENT_TO_FIRM`; `DISQUALIFIED` closes.
  Enum values are stored as canonical codes (`MASS_TORT`, `SENT_TO_FIRM`, …);
  display labels live in `lib/labels.ts`.
- Only `MVA` leads are sent to partner firm Brightwater (form-urlencoded API),
  **at most once per lead**.
- Person data is split by role: `injured*` is always the injured person; `filler*` is
  the form submitter, populated only when `isFillingForSomeoneElse` is true (never
  duplicated). Brightwater receives the injured person's details.
- `case_type` is `MVA`, `MASS_TORT` or `OTHER` (canonical codes; labels in `lib/labels.ts`).
- Public intake: the form posts to `POST /api/public/leads` (unauthenticated, allow-listed
  in `proxy.ts`, validated by `lib/leads/intake.ts`); every other API route is protected
  by the session cookie — except `/api/mcp`, which authenticates itself with a bearer
  access token (see **MCP server**) and is allow-listed in `proxy.ts` for that reason.

## Data layer
- Schema: one file per table in `lib/db/schema/`, re-exported by `lib/db/schema/index.ts`.
- Boot: `instrumentation.ts` → `lib/db/bootstrap.ts` creates `data/apex.db`, applies
  migrations, and imports CSVs from `lib/db/seed-data/` **only if the DB file is absent**.
- Free-text fields are stored as `TEXT` (trimmed on import). The boolean columns
  (`is_at_fault`, `has_attorney`, `has_received_settlement`, `is_filling_for_someone_else`)
  are normalised to real booleans and stored as SQLite `0`/`1` (`null` = unknown).
- Date/timestamp columns (`created_at`, `date_of_accident`, `sent_to_firm_at`, and the
  session timestamps) are stored as **Unix timestamps in seconds** (Drizzle `timestamp` mode).
- Phone numbers are normalised to `(XXX) XXX-XXXX`.
- `relationship_to_injured` is a fixed set (`RELATIONSHIPS`), enforced by a CHECK.
- `state` (2-letter code) and `county` are validated against the fixed lists in
  `lib/us-states.ts` / `lib/us-counties.ts`; the seeder throws on anything unrecognised.
- Passwords are a single `scrypt$params$salt$hash` string (per-user salt).
- `api_tokens` (one row per personal access token for external agents) stores only the
  SHA-256 hash of the token plus a display `prefix`, its owner and `last_used_at`; the raw
  token is shown once and never persisted.

## AI assistant
- The panel is a **non-modal** slide-over in the app shell (`components/ai/`), opened from
  the header button in `app/(app)/layout.tsx`. It has no backdrop, does not close on an
  outside click or a page change, and remembers the last conversation in `localStorage`,
  so it stays with the user. Replies stream through `POST /api/ai/chat` (TanStack AI +
  OpenRouter; the model is in `lib/ai/config.ts`, overridable with `AI_MODEL`).
- **`lib/ai/stream.ts` is load-bearing.** The OpenRouter adapter closes every model turn
  with a `RUN_FINISHED`, so a tool loop emits several terminal events for one run and the
  browser client finalises on the first — losing the later tool calls and the reply. The
  module strips the per-turn frames from the SSE response. Do not remove it, and do not
  try to do this in `chat()` middleware: middleware runs inside the agent loop, so
  swallowing the event there stops the loop instead.
- **The tool layer is the one capability surface** (`lib/ai/tools.ts`,
  `buildAiTools(actor)`). Each tool calls the same service the UI calls
  (`lib/leads/service.ts`), so the assistant can do exactly what the signed-in user can
  and nothing more. It takes only an `Actor`, and `lib/mcp/server.ts` exposes that same
  set to external agents unchanged — never add a second tool implementation.
- **The server owns the transcript.** `lib/ai/store.ts` persists turns to `chats` /
  `chat_messages` (schema `lib/db/schema/chats.ts`), and the chat route rebuilds the
  model input from storage instead of trusting the browser's message list, so a
  tampered body cannot inject a fake assistant turn. Assistant turns record the model
  plus prompt/completion/total tokens and the provider-reported USD cost, ready for an
  admin analytics view. (The MCP server keeps no transcript at all: an external agent
  owns its own conversation and calls one tool at a time.)
- `@`-mentions (`lib/ai/mentions.ts`) are resolved server-side: labels come from the
  database and references the viewer may not see are dropped. Leads reuse the grid's
  visibility query; users are scoped like the assignee lists (admins: everyone,
  agents: themselves). The compose box writes a chosen reference into the text as
  `lead:Jennifer Price` / `user:Dana Whitfield` and styles it in place — never the
  matter id, which is a leftover import field the assistant treats as noise. The
  styling uses a mirror layer behind the textarea (`components/ai/chat-thread.tsx`), so
  **a token's styling must not change metrics** (no padding, no font weight) or the text
  after it drifts; the message bubbles are real DOM and may style freely.
- Assistant replies are rendered as Markdown (`components/ai/markdown.tsx`), since the
  model writes `**bold**` and lists. Only assistant messages go through it — a user's own
  words are shown as typed.

## MCP server
- `POST|GET|DELETE /api/mcp` (App Router handler, `lib/mcp/server.ts`) serves the **same**
  tools to external agents — Claude, Cursor, the MCP Inspector — with no second
  implementation. The factory registered with `createMcpHandler` loops over
  `buildAiTools(actor)` and registers each tool as it is, so anything added there reaches
  both surfaces at once and the two can never drift. The only per-tool configuration is
  the annotation map (which tools are read-only).
- **Auth is a personal access token, not OAuth.** `api_tokens` (§ Data layer) stores only
  a SHA-256 hash; the route resolves the `Authorization: Bearer` value to a **fresh
  `users` row on every request**, so an agent's abilities are always its owner's current
  ones and a role change or revoked token applies on the very next call. Tokens are
  minted at `/settings` or with `npm run mcp:token -- <email> [label]`, and the raw value
  is shown once. Nothing OAuth-shaped is advertised, because this server issues its own
  tokens rather than running an authorization server — pointing a client at discovery
  would be a dead end.
- A token carries **no permissions of its own**. Every call runs through the same services
  and `lib/auth/authorize.ts` checks the UI uses, so an agent can do what its owner can
  and nothing more. A refusal returns `isError` with the policy's own sentence (e.g.
  "You can't send this lead to the firm.") rather than a generic failure.
- The handler trusts its caller by design: it validates no token, `Host`, or `Origin`
  header. Verification happens in the route; keep it that way, and keep `/api/mcp` in
  `proxy.ts`'s allow-list or the cookie guard will 401 every agent before the route runs.
- `McpServer` takes `(serverInfo, options)` as **two** arguments. Folding `instructions`
  into the first object type-checks and silently buries it inside `serverInfo` on the
  wire, where no client reads it — the option belongs in the second argument.

## Conventions
- **While the schema is still being built, do not stack migrations** — regenerate the single
  `drizzle/0000_*.sql` instead (delete `drizzle/` and run `npm run db:generate`). Add
  incremental migrations only once the schema is frozen.
- Keep modules small, commented, and consistent with the existing structure.
