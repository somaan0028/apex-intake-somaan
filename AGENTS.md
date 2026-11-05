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

## Setup
- A clean clone runs with `./start.sh`: install, `npm run setup`, build, then serve on
  port 8080. Development stays on 3000.
- `scripts/setup.ts` writes `.env` with only the two required keys and seeds the
  database when it is absent. It keeps real values across reruns; optional settings
  (`DATABASE_PATH`, `AUTH_COOKIE_SECURE`, `AI_MODEL`) belong in `.env.local`.
- Placeholder credentials satisfy the boot check, but the AI assistant and Brightwater
  need real values. Pass them in the shell or edit `.env`.
- `npm run leads:dedupe` backfills `dup_match_string` and runs the one-time full
  duplicate grouping pass for an existing database; `npm run leads:check` verifies the
  similarity cases and threshold. A fresh seed runs the grouping pass automatically.

## Domain rules
- Roles: `ADMIN` (all leads, any stage, assign, send, manage users) and `USER`
  (unassigned + own leads, up to `RETAINED`).
- Stages: `NEW → CONTACTED → QUALIFIED → RETAINED → SENT_TO_FIRM`; `DISQUALIFIED` closes.
  Enum values are stored as canonical codes (`MASS_TORT`, `SENT_TO_FIRM`, …);
  display labels live in `lib/labels.ts`.
- Only `MVA` leads are sent to partner firm Brightwater (form-urlencoded API),
  **at most once per lead**. Brightwater also rejects a second submission for the
  same email, so the send guard additionally refuses when any other lead with
  the same case-insensitive, trimmed email already has a recorded send. A lead
  in a potential-duplicate group cannot be sent either, until the grouping is
  resolved (marked as not a duplicate, or an edit that dissolves the match).
- `SENT_TO_FIRM` records an actual submission: the service refuses to set that
  stage unless `sent_to_firm_at` or `brightwater_lead_id` is populated, so the
  stage cannot be chosen manually on an unsent lead. The dialog, inline select
  and Kanban drop all surface the refusal.
- Person data is split by role: `injured*` is always the injured person; `filler*` is
  the form submitter, populated only when `isFillingForSomeoneElse` is true (never
  duplicated). Brightwater receives the injured person's details.
- Brightwater's payload (`lib/brightwater/payload.ts`) sends the state's **full name**
  (`CO` → `Colorado`), the accident date split into `injury_year` (`YYYY`),
  `injury_month` (`MM`) and `date_of_accident` (the two-digit day only), and a fixed
  `source` of `www.apexleadsource.com` — the stored source is not the identifier
  Brightwater expects, so it is never sent. Emails are re-checked with `isValidEmail`
  at this boundary.
- `case_type` is normally `MVA`, `MASS_TORT` or `OTHER` (canonical codes; labels in
  `lib/labels.ts`), but an ad campaign we do not recognise is stored **verbatim** in this
  column, so read it through `caseTypeLabel()` rather than indexing `CASE_TYPE_LABELS`
  directly. The grid's `OTHER` filter is a bucket: it returns every stored case type that
  is not `MVA` or `MASS_TORT`, including those raw campaign values. Case type is
  **required**: the editor has no unset option, the CSV seeder refuses a missing
  campaign, and the Firm submission UI is rendered only for MVA.
- Public intake: the form posts to `POST /api/public/leads` (unauthenticated, allow-listed
  in `proxy.ts`, validated by `lib/leads/intake.ts`); every other API route is protected
  by the session cookie — except `/api/mcp`, which authenticates itself with a bearer
  access token (see **MCP server**) and is allow-listed in `proxy.ts` for that reason.
- Ad tracking: the form reads `utm_source`, `utm_campaign`, `utm_medium` and `utm_content`
  from the landing URL and posts them as `tracking`; `lib/leads/utm.ts` holds the mappings
  (`google` → `Google Ads`, `mva` → `MVA`, …) and is shared by the preselect and the
  server, so both agree. `utm_source` becomes `source` (unmapped values stored as-is;
  with no `utm_source` the source stays empty), `utm_campaign` preselects the case type
  on step 2 when recognised, and `utm_medium` / `utm_content` are stored verbatim in the
  `medium` / `content` columns for later analytics. Tracking is never fatal: junk or
  missing params cannot block a submission.

## Data layer
- Schema: one file per table in `lib/db/schema/`, re-exported by `lib/db/schema/index.ts`.
- Boot: `instrumentation.ts` validates the required server secrets through
  `lib/env.ts` (`OPENROUTER_API_KEY` and `CANDIDATE_TOKEN`), then
  `lib/db/bootstrap.ts` creates `data/apex.db`, applies
  migrations, and imports CSVs from `lib/db/seed-data/` **only if the DB file is absent**.
- Free-text fields are stored as `TEXT` (trimmed on import). The boolean columns
  (`is_at_fault`, `has_attorney`, `has_received_settlement`, `is_filling_for_someone_else`)
  are normalised to real booleans and stored as SQLite `0`/`1` (`null` = unknown).
- `notes` is free-form internal text; public intake never sets it and the Brightwater
  payload never reads it.
- Date/timestamp columns (`created_at`, `date_of_accident`, `sent_to_firm_at`, and the
  session timestamps) are stored as **Unix timestamps in seconds** (Drizzle `timestamp` mode).
- Phone numbers are normalised to `(XXX) XXX-XXXX`.
- `relationship_to_injured` is a fixed set (`RELATIONSHIPS`), enforced by a CHECK.
  `case_type` has **no** CHECK: it also carries raw campaign values (see Domain rules).
- `source`, `medium` and `content` are attribution fields (admin-only like the rest):
  `source` comes from `utm_source` via `lib/leads/utm.ts`, while `medium` and `content`
  are the raw `utm_medium` / `utm_content` values, stored only for later analytics.
- `ipaddress` is stamped by the public intake route from the request, never from the
  submitted body (`lib/leads/client-ip.ts`): the left-most `x-forwarded-for` hop
  (Next's server fills it from the connection when absent) with `x-real-ip` as the
  fallback. Locally that is `::1` or `127.0.0.1`; a visitor on the LAN appears as
  their private address. Only valid IPv4/IPv6 literals are stored (ports, brackets
  and IPv4-mapped IPv6 are normalised; junk becomes `null`).
- `matter_id` is the Lawmatics business key and is only meaningful on imported leads.
  Public form submissions store an empty string; the unique index is partial
  (`WHERE matter_id <> ''`) so any number of those can coexist.
- Potential-duplicate state lives on the lead: `dup_match_string` is the normalised
  `name|email|phone` of the injured person (internal; stripped from client rows) and
  `dup_group_id` is a random `dup_<uuid>`. A non-null group id always means a cluster
  of at least two; unique and dismissed leads keep it null. See **Potential duplicates**.
- `state` (2-letter code) and `county` are validated against the fixed lists in
  `lib/us-states.ts` / `lib/us-counties.ts`; the seeder throws on anything unrecognised.
- `postcode` is canonicalised by `normalizePostcode` (`12345` or `12345-6789`, with
  `123456789` expanded) at every write boundary: public intake, the public endpoint,
  the lead dialog / `saveLeadFields`, `updateLeadForActor`, and the CSV seeder. An
  invalid value is rejected (or, for the CSV, fails the import loudly); it never
  reaches SQLite. Validation is format-only — no bundled ZIP-to-state dataset.
- The same final guard in `applyLeadUpdate` also validates required injured names,
  email format, 10-digit phone, accident date, state/county, descriptions/notes, a
  required case type, stage and assignee. The dialog mirrors it inline, the intake
  endpoint validates its own payload, and the CSV seeder throws on any non-empty value
  it cannot canonicalise. An invalid email can therefore not reach `leads` or `users`.
- Passwords are a single `scrypt$params$salt$hash` string (per-user salt).
- Profile photos live in a private folder beside the database (`data/avatars/`), never
  in `public/`: `users.avatar_path` stores only the generated filename, and
  `GET /api/users/[id]/avatar` streams the WebP after validating the session. The route
  is therefore available to every signed-in user, but not to the public. Uploads go
  through a Server Action (`lib/users/avatar-actions.ts`) that accepts PNG, JPEG or WebP
  up to 5 MB, rotates by EXIF, crops to a 256×256 square and re-encodes as WebP with
  `sharp` — which also strips metadata. Each upload gets a fresh filename (used as the
  URL's cache-busting `v`) and deletes the previous file. A person may change their own
  photo; an admin may change anyone's (`users.manage`). Every surface that used to show
  initials uses `components/user-avatar.tsx`, falling back to them when no photo exists.
- `api_tokens` (one row per personal access token for external agents) stores only the
  SHA-256 hash of the token plus a display `prefix`, its owner and `last_used_at`; the raw
  token is shown once and never persisted.
- `lead_bookmarks` is the personal many-to-many bookmark table: `(user_id, lead_id)` is the
  primary key, both foreign keys cascade on delete, and `created_at` records when the
  bookmark was made. It is never shared: the grid's `filter.bookmarked=yes|no` always
  resolves against the signed-in actor, and bookmarking records no activity.
- `activities` is the append-only audit log. `type` is one of the canonical codes in
  `lib/db/schema/activities.ts` (`lead:stage_update`, `lead:claimed`, `lead:released`,
  `lead:assigned`, `lead:unassigned`, `lead:send_to_firm`,
  `lead:marked-not-duplicate`, `lead:deleted`, `user:added`, `user:deleted`); `doer_id` is
  always the person who acted (for AI work, the person it
  acted for), `is_ai` marks the AI/MCP tool path — every mutating tool sets it
  (stage, assignment, lead details, duplicate dismissal) so an unexpected change
  can be traced to an agent; sending to the firm and deleting have no AI path at
  all — and `lead_id` / `user_id` carry the
  affected records. Descriptions are generated by `lib/activities/record.ts` and never
  include names, because names change — except `lead:deleted`, which must carry the name
  the lead had when it was removed, since no `leads` row survives to supply it. The
  reference ids are plain integers rather than foreign keys so deleting a user neither
  erases nor blocks history; readers show "Deleted user" / "Deleted lead" when the join
  misses.

## Preferences & appearance
- `users.preferences` is a JSON object validated by `lib/preferences/schema.ts`. It holds
  `appearance.theme` and `appearance.mode`, and is deliberately a blob so future personal
  settings (for example which Overview stats to show) need no migration. Reads merge
  defaults; writes preserve unknown keys so an older code path cannot drop a newer
  preference.
- Theme presets live in `app/themes.css` as `[data-theme="id"]` blocks (light) and
  `[data-theme="id"].dark` blocks, imported after `globals.css` so they win the cascade.
  `lib/themes/registry.ts` holds the IDs, names and descriptions. The current set is
  Apex (Default), Sakura, WhatsApp, Retro, Zen, Claude, Bold Wikipedia and Burgundy.
  Add a theme by pasting only its variable block and adding one registry entry; do not
  copy TweakCN's `@theme inline`, base layer, font overrides, or `--spacing`.
- Appearance is **scoped to the authenticated shell**. `app/(app)/layout.tsx` reads the
  signed-in user's preferences from the database, then renders an inline boot script
  (`buildThemeBootScript` via `components/inline-script.tsx`) and
  `components/theme-scope.tsx`. Those set `data-theme`, `data-theme-mode`, the `dark`
  class and `color-scheme` on `<html>`. `InlineScript` renders a real
  `text/javascript` script in the server HTML and an inert `text/plain` one after
  hydration, so a soft navigation never makes React warn about a script tag it cannot
  execute; `ThemeScope` reapplies the theme in that case. Public pages (the
  intake form and login) render neither, so they always keep the default light palette.
  The scope also reapplies the theme on a soft navigation into the shell (login →
  dashboard) and removes the attributes when the shell unmounts (logout), because the
  root `<html>` element survives client-side navigation. There is no theme cookie.
  `<html>` carries `suppressHydrationWarning` for the pre-hydration change.
- The defaults are theme `default` and mode **`light`**; `system` is opt-in. Modes are
  `light`, `dark` and `system`, and system mode installs a `prefers-color-scheme`
  listener. `components/ui/sonner.tsx` follows the `dark` class rather than next-themes.
  Scrollbars are themed too: `app/globals.css` sets `scrollbar-color` from `--border` and
  a matching `::-webkit-scrollbar` thumb.
- The Preferences page's **Appearance** section (`app/(app)/settings/preferences/`) applies
  changes optimistically, then calls `updateAppearance` (`lib/preferences/actions.ts`) to
  save the JSON. The preview cards scope a theme to their own
  subtree with `data-theme`, so they never duplicate colour values in JavaScript.

## AI assistant
- The assistant is **Larry** — `ASSISTANT_NAME` in `lib/ai/identity.ts`, used by the UI
  copy and by the system prompt in `lib/ai/prompt.ts`. Keep the name in that module:
  client components import it, and `lib/ai/config.ts` pulls in the OpenRouter adapter,
  which must never reach the browser bundle.
- Larry's mascot is the Lottie animation in `public/lottie/`: `larry.lottie` is the
  designer's source file and `larry.json` is the animation extracted from it, which is
  what `components/ai/larry-mascot.tsx` imports. The player (`lottie-web`, loaded lazily
  because it touches `window`) loops the idle segment (frames 0–60) and recolours every
  fill, stroke and gradient stop from the live `--primary`, keeping each colour's
  brightness so the shading survives. It repaints when `data-theme`, `data-theme-mode`
  or the `dark` class changes; do not replace it with a canvas player, because canvas
  pixels cannot take their colour from CSS tokens. If the `.lottie` file is replaced,
  re-extract `larry.json` (`a/Main Scene.json` inside the archive).
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
  (`lib/leads/service.ts`), so the assistant can do what the signed-in user can
  and nothing more — with two deliberate exceptions: **sending a lead to the
  firm** and **deleting a lead** are human-only. They have no tool, and
  `sendLeadForActor` / `deleteLeadForActor` refuse any call carrying `isAi`.
  It takes only an `Actor`, and `lib/mcp/server.ts` exposes that same set to
  external agents unchanged — never add a second tool implementation. Every
  mutating tool passes `{ isAi: true }` so the activity log can mark it.
- **The prompt talks to a non-technical intake colleague, not a developer**
  (`lib/ai/prompt.ts`). It states the viewer's role and limits in plain words,
  forbids implementation vocabulary (records, fields, ids, groups, matchers,
  visibility, permissions, tool names), and requires a refusal to be restated as
  something the person can do next. Possible duplicates are always described as
  "may be the same person as another lead"; the tool outputs use the same
  vocabulary (`mayBeSamePersonAsAnotherLead`, `otherSimilarLeads`) so the model
  has no jargon to echo. A User can never look up the team, so the prompt forbids
  offering to find or name an administrator.
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
  minted at `/settings/ai` or with `npm run mcp:token -- <email> [label]`, and the raw value
  is shown once. Nothing OAuth-shaped is advertised, because this server issues its own
  tokens rather than running an authorization server — pointing a client at discovery
  would be a dead end.
- The copied endpoint comes from `lib/mcp/endpoint.ts`, which follows the request host
  (`x-forwarded-host` first) and `x-forwarded-proto`. When no proxy says otherwise,
  loopback and private/link-local addresses use HTTP and public hostnames use HTTPS.
- The Connect Your Agent card's **Copy Instructions for AI** button copies a ready-to-use prompt
  with the endpoint, the bearer header, and the JSON config. A token created in the same
  visit is included once; otherwise the prompt carries a placeholder.
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

## Potential duplicates
- Identity and matching (`lib/leads/dup-matcher.ts`): `dup_match_string` is the
  normalised injured `name|email|phone`. A pair matches when two segments are strongly
  similar (name + email, name + phone, or email + phone) or the whole string reaches
  `DUP_MATCH_THRESHOLD` (default 0.95, overridable with `DUP_MATCH_THRESHOLD`). A
  name-only match is refused when both sides have neither an email nor a phone.
- Grouping (`lib/leads/dup-groups.ts`): `rebuildDuplicateGroups` is the single full
  pass; `recheckLead` is the O(n) incremental check; `reconcileDupGroup` enforces the
  strict invariant that a group id exists only for a cluster of two or more. A member
  leaving a pair resets the survivor to `null`.
- Triggers: a full pass after the CSV import (and `npm run leads:dedupe`), a public
  intake lead, and an edit to the injured name/email/phone. Intake and edits enqueue
  through `lib/leads/dup-queue.ts`, which coalesces per lead and runs after the response.
  There is no boot or periodic sweep: a dismissed lead stays dismissed until a new or
  edited lead matches it.
- Dismissal: `leads.resolve_duplicates` is held by both roles, but **Mark as Not
  Duplicate** is refused when any lead in the group is outside the actor's
  visibility (`DUPLICATE_GROUP_HIDDEN_MESSAGE` in `lib/leads/constants.ts`, shown
  as a toast). It clears only that lead's `dup_group_id`, reconciles a pair, and
  records `lead:marked-not-duplicate`. **Check for Duplicates** re-runs
  `recheckLead` on demand and returns fresh counts. The full pass re-links
  dismissed pairs, so do not run `rebuildDuplicateGroups` routinely.
- UI: an amber warning icon in the table and Kanban cards; a dialog banner with **View
  similar** and **Mark as Not Duplicate**; **Check for Duplicates** beside Delete; the
  **Duplicates** filter (`filter.potentialDuplicate=yes|no`); View similar uses
  `filter.dupGroup=<id>` and ignores every other filter; the Overview shows the
  potential-duplicates callout.
- Send guard: `sendLeadForActor` refuses a grouped lead (until resolved) and refuses
  when another lead with the same case-insensitive, trimmed email already has a
  recorded send. See Domain rules.
- Verification: `npm run leads:check` asserts the seeded pairs and the negative cases
  against the threshold.

## Pages
- **Overview** (`app/(app)/dashboard/`) is the at-a-glance page: headline numbers, the
  pipeline, the newest intake, the assistant's invitation and a recent-activity feed.
  Every number comes from
  `lib/leads/metrics.ts`, which scopes its counts with the same
  `leadsVisibilityCondition` the grid uses, so an agent's totals never include leads they
  could not open. The headline **Active leads**, **Unassigned** and **Assigned to you**
  cards all exclude `DISQUALIFIED` (closed leads), and so does the pipeline: `PIPELINE_STAGES`
  filters that stage out of both the bar and its legend, and the card's total is the sum
  of the stages it draws. Each count links into the pre-filtered grid
  (`/leads?filter.<columnId>=<value>`), carrying **both** the card's own filter and a
  `filter.stage` for every open stage, so the grid total matches the number on the
  card (Disqualified never leaks in). "Active leads" uses that stage filter alone,
  "Unassigned" adds `filter.assignedTo=unassigned`, "Assigned to you" adds the
  viewer's id, and "New this week" uses `filter.addedWithin=7d`. The "ready for
  Brightwater" callout is shown
  only to a role that can actually send, and a potential-duplicates callout for every
  role links to the grid with `filter.potentialDuplicate=yes`. Both callouts are slim
  one-line bars (`AlertBar` in the page, shared with the leads header) rather than
  cards: the Brightwater queue is styled as good news (emerald), the duplicate queue as
  a warning (amber), and they share one flex row — each bar is content-sized and the
  pair wraps onto separate lines only when they no longer fit — so they never dominate
  the page. The duplicate bar carries no subtitle by design.
- The **recent activity** card under the assistant reads `recentActivities(actor, 5)` from
  `lib/activities/queries.ts`, which shares the Activity page's scope: admins see the
  whole log, everyone else only rows they performed. Each row is the doer, the recorded
  description, `Lead: <name>` when a lead is attached, and a relative time
  (`formatRelativeTime`). The Overview shows the newest intake with a full timestamp
  (`formatDateTime`) and seven rows, so the Latest intake panel and the Recent activity
  panel end within a few pixels of each other.
- The **pipeline** is one stacked bar rather than a bar per stage: the stages are a
  composition of a single total, so a shared bar compares them at a glance, and no label
  has to fit inside a 1%-wide segment. Each segment carries a `title` and an
  `aria-label`, and the legend below states every value and share. Segment colours are
  `--stage-*` variables in `app/globals.css`, derived from the active theme's chart
  tokens (with foreground mixes for contrast and a muted mix for Disqualified) rather than
  hard-coded, so switching themes changes the pipeline as well. Adding a stage means
  adding a variable there.
- The Overview's assistant card is a Client Component only because opening the panel is
  an interaction and the mascot is animated. It is **Larry's home on the page**: the
  right-hand column of the content grid, beside the Pipeline and Latest intake
  panels stacked on the left, with the Lottie mascot (160px), "Hi {first}
  — I'm Larry.", a one-line invite and a "Chat with Larry" button, all vertically
  centred. It sizes to its content instead of stretching to the left column's
  height (that left too much empty space). The mascot and the button both call `open()`. The mascot is decorative
  (`aria-hidden`) and the button carries the label. The panel's own empty state shows
  the same mascot at 128px above the starter prompts, and drops it as soon as the
  thread has a message so it never competes with the conversation.
  `AiAssistantProvider` (in the app shell) publishes `open(prompt)` through
  `components/ai/assistant-context.tsx`, so any page can still open the panel with a
  question waiting in the composer; `chat-thread.tsx` folds that prompt in during
  render, keyed by a counter, rather than in an effect. The header button and the
  Overview card call the same handle - never add a second way to open the panel.
- **Activity** (`app/(app)/activity/`) is the read-only audit trail, open to every role.
  Admins (holding `activities.view.all`) see every row; everyone else sees only rows where
  they are the doer. Search covers the description, and the filters run Date (shared
  presets/custom range), Performed by (a select), then Affected Lead (a debounced name
  search over the visibility-scoped lead query). It deliberately has no detail modal, no
  row click, and no column or filter-visibility menus.
- **Analytics** (`app/(app)/analytics/`) is admin-only: the sidebar hides it and the
  page redirects without `analytics.view`, so a hand-typed URL cannot reach attribution
  data. `lib/leads/analytics.ts` groups the same leads by campaign (`case_type`),
  source, medium, and content, and every grouped row carries the funnel counts so
  volume is read beside quality. Empty attribution collapses into a single "Not
  tracked" bucket, and campaign labels go through `caseTypeLabel()`. Drilldown links
  carry the active window/campaign and only target filters the grid actually accepts:
  canonical `caseType` codes and sources in `LEAD_SOURCES`, never raw campaign values.
  The toolbar reuses `components/date-range-filter.tsx` (the leads/activity presets and
  custom range) and adds a campaign selector (`all`, `MVA`, `MASS_TORT`, `OTHER`, where
  `OTHER` is the grid's bucket). Analytics opens on **Last 30 days** and campaign
  **MVA**; the date filter falls back to 30 days when the URL carries no preset. The
  trend is a multi-series line chart with dots
  (`app/(app)/analytics/trend-chart.tsx`) showing Leads, Qualified+, Retained+ and Sent.
  The legend labels toggle their line on and off; the axis rescales to the visible
  series and the tooltip lists only those.
  The **Campaign mix** card still shows the campaign composition, but reuses the
  Overview pipeline's design: one stacked bar with a two-column dot legend directly
  below it. Campaign totals also appear in the Campaigns table below.
- The **lead detail dialog** (`app/(app)/leads/lead-dialog.tsx`) auto-saves: every
  editable field writes through `saveLeadFields` (`lib/leads/actions.ts`) as it changes,
  so there is no Save button. Text fields debounce, selects and the date save
  immediately, and `use-lead-autosave.ts` queues writes so an older patch cannot land
  after a newer one; the footer reports "Saving…" / "Saved". The Lawmatics id,
  attribution, and Brightwater submission facts stay read-only by design. A
  **Notes** section above Attribution holds free-form internal notes; it is
  autosaved like the other text fields, never populated by public intake, and
  never sent to the firm. The **Case type** select is the first field in Case
  facts; it is required (there is no unset option), offers the canonical codes,
  and keeps a stored raw campaign value selectable until the user changes it.
  The CSV seeder now preserves an unrecognised campaign verbatim and refuses a
  missing one. The **Firm submission** section is shown only while the lead's case
  type is MVA. The dialog header carries a **bookmark** toggle (filled when the
  signed-in user has bookmarked the lead); it updates optimistically through
  `setLeadBookmark` and never records an activity. A potential-duplicate banner offers **View similar** and **Mark as Not
  Duplicate**, and **Check for Duplicates** sits beside Delete for an on-demand re-run;
  only admins can dismiss a grouping. On a
  lead filed for someone else, the filler's name, phone, email and relationship
  are editable under the same `leads.edit.*` permission as the injured person's
  fields. An agent
  claims or releases a lead with a button (they can only ever assign themselves);
  an admin keeps the full assignee selector. State is shown as "Colorado (CO)" via
  `stateLabel()`. The stage and assignee are also editable inline in the grid
  (`leads-table.tsx`): admins get both selects, agents get a stage select plus
  Claim/Release, and each cell saves through the same `saveLeadFields` action.
  The dialog also has two small history links: **View past changes (n)** under the stage
  control (`lead:stage_update`) and **View attempts (n)** beside the Firm submission heading
  (`lead:send_to_firm`), each carrying its row count. Both open a nested dialog of doer /
  description / timestamp rows
  from `lib/activities/actions.ts`; access follows lead visibility, not the Activity page's
  doer scoping, so anyone who can open the lead sees what happened to it. Admins also get a
  **Delete** button (bottom-left, behind an `AlertDialog` confirmation with a forced
  backdrop, because Base UI suppresses a nested dialog's backdrop) that permanently removes
  the lead and records `lead:deleted`. That description names the lead as it was at
  deletion; its older activity rows remain, labelled "Deleted lead".
- A failed firm submission records why: when Brightwater returns a JSON `code` other than
  `1` with a `response`, the activity reads
  `Failed to send lead to firm. Response: <text>`; network failures, non-200 responses and
  other unexpected outcomes read `Failed to send lead to firm. Unexpected error occurred.`
  The reason is normalized to one line.
- **Users** (`app/(app)/users/`) shows an **Assigned leads** count per person, loaded for the
  visible page in one grouped query. The underlined number links to the leads page filtered
  by `filter.assignedTo=<id>` with `filter.addedWithin=any`, so it matches the all-time
  count. `any` is a real leads date preset ("All Time"), not a hack; a bare `/leads`
  has no date window (the Added filter starts cleared).
- The leads page **view is a persisted preference**, not a filter. An explicit
  `view=table` or `view=kanban` in the URL wins; otherwise the `apex_leads_view`
  cookie decides, falling back to Kanban. Navigating from the dashboard or a stat
  card therefore keeps the last chosen view, while filters and search still come from
  the URL. A **Sort** control (newest/oldest by date added) sits in the toolbar in both
  views — in Table it mirrors the Date column's sort — and moves into the Options sheet
  below `xl`. The board is windowed **per stage**, not paged as a whole: the server
  returns the newest 10 cards of each column (expandable with "Show more", which
  writes `board.<STAGE>=<limit>`, 10 cards at a time up to a 200-card ceiling)
  plus a true grouped count per stage, so a column badge always describes the
  whole filtered backlog rather than the loaded slice. A card moved into a lane
  whose window does not contain it stays pinned in that lane until the board's
  filters, search or sort change. Cards drag between stage columns through the
  same `saveLeadFields`
  action, carry an eye button that opens the detail dialog, and reuse the inline
  assignee control. Touch has no native HTML drag, so every card also carries a
  grip handle that runs a pointer drag for mouse and touch: it hit-tests
  `[data-stage]`, auto-scrolls the board near its edges, and names the pending
  stage in a floating pill. Keep that path intact when changing the card layout.
  A Stages menu beside Filters hides and shows columns; hidden
  stages free their width, the columns flex to fill the space, and the page
  scrolls rather than each stage getting its own scrollbar. The Kanban toolbar hides
  the stage control (the board already groups by stage) and switching views clears it
  from the URL, but an explicit `filter.stage` arriving from a link is honoured in both
  views so a dashboard card always lands on the leads it counted. Grouped leads carry an
  amber warning icon in both views. The page header carries the same potential-duplicates
  callout as the Overview (shared `components/alert-bar.tsx`), with a **Show** button
  that applies `filter.potentialDuplicate=yes`; while that filter is on the button
  hides and the text reads "X potential duplicate leads being shown".
  The **Duplicates** filter
  (`filter.potentialDuplicate=yes|no`) drills into them, and **View similar** uses
  `filter.dupGroup=<id>`, which ignores every other filter. A **Bookmarked** filter
  (`filter.bookmarked=yes|no`) is visible by default and is always personal: "yes"
  means bookmarked by the signed-in user, never by anyone else. The filter is hosted
  by a hidden, non-hideable table column so it uses the same URL/saved-view plumbing
  as every other filter, and it works unchanged in Table, Kanban, and CSV export.
  **Case type**, **Stage**, and **Assigned to** are multi-select: their URL value is a
  comma-separated list (`filter.stage=NEW,CONTACTED`), parsed through
  `parseFilterValues` / `readFilterList`, so one filter can match several values.
  A `DataTableFilter` opts into this with `multiple: true`; the shared
  `MultiSelectFilter` renders a checkbox popover with **Select all** / **Clear**
  and keeps a local draft while the URL round-trip is in flight. The draft is used
  only while the popover is open; the closed trigger always reads the parent's
  current value, so a URL changed elsewhere (Clear Filters, a stat-card link,
  back/forward) shows immediately instead of after the next click.
- The leads grid and board have **no date window by default**: the Added filter
  starts cleared ("All Time"). It offers `24h`, `3d`, `7d`, `30d`, and a Custom option
  that uses `filter.addedFrom` (required, default seven days ago) and optional
  `filter.addedTo`; `listLeads` turns those into `created_at` bounds. The custom
  lower date has no clear control; the upper date can be cleared.
- **Export CSV** (`app/api/leads/export/route.ts`, download icon beside Clear
  Filters) downloads every lead under the current filters, search and sort — not
  the visible page or the loaded Kanban cards. `lib/leads/query-params.ts` applies
  the same date normalisation the page uses, and the route reuses
  `listLeadsForExport` (the `listLeads` query with no page window), so visibility,
  attribution, and duplicate-group scoping can never disagree with the grid.
  Attribution columns are included only for viewers with `leads.view.attribution`;
  `lib/leads/csv.ts` writes labels, ISO dates, and formula-injection safe cells.
- **Saved Views** (`lib/leads/saved-views.ts`) are browser-local, never sent to
  the server: `localStorage` holds the named views plus the last place the person
  left off (view, filter values, search, sort, filter/column visibility, hidden
  stages, page). Filter values are restored **only** when the URL asks for it with
  `preserveFilters=true`, which the sidebar's Leads item does (`/leads?preserveFilters=true`);
  a bare `/leads` visit (a shared link, the Overview's Active leads card) starts with
  cleared filters but still restores the view and the UI preferences.
  A URL with filters always keeps those filters and still applies the stored view when
  it does not name one. The heart opens the save dialog and
  stays red only while the page still matches that saved view. **Clear Filters**
  resets the filter values and search but never deletes a saved view. Stage
  visibility is browser-local too, so the Kanban board shows a skeleton until the
  mount effect has read it; without that, every stage would flash on refresh.
- Below `xl`, the leads toolbar collapses into one **Options** sheet: search stays
  inline, and view, sort, saved views, filters, columns, stages, and Clear all
  move into the sheet. `DataTable`'s `mobileControls` prop owns that switch, and
  the grid card scrolls horizontally so a wide table never widens the page.
  The **Options** and **Clear Filters** triggers both carry the same badge with the
  number of active filters (each filter counts once, the Added range included;
  "All Time" and the sort do not count).
- **Profile** (`app/(app)/profile/`) is self-service and open to every role: a user may
  change their own name and password, and an admin their own email and role as well. The
  rules live in `lib/auth/profile-actions.ts`, which **ignores** submitted fields the
  caller may not set instead of trusting the form — a hidden input is not a permission.
  A password change requires the current password for everyone, admins included, and the
  last-admin invariant still blocks a self-demotion.
  The profile header shows a clickable avatar (the photo is the upload control), the
  person's name, role and member-since date. The email is intentionally not repeated there;
  it appears in the details form below.
- The sidebar (`components/app-sidebar.tsx`) keeps Overview, Leads, and Analytics
  flat, then folds **Staff** (Users, Activity) and **Settings** (Connect Your Agent,
  Preferences) into collapsible groups. It uses the sidebar's `inset` variant, so the
  desktop shell shows the sidebar colour behind a main panel that floats with an 8px
  margin, rounded corners and a shadow. Nav and sub-item icons use
  `text-sidebar-accent-foreground`, which stays themed and legible in every preset. Both
  groups start open; clicking a group header while the sidebar is in its icon rail reopens
  the sidebar instead of toggling a hidden panel.
  **Connect Your Agent** (`app/(app)/settings/ai/`) holds the MCP token card, and the old
  `/settings` URL redirects there. **Preferences**
  (`app/(app)/settings/preferences/`) has the Appearance section: preset themes plus
  light/dark/system. **Profile and Log out live in the account menu**, opened by the
  bordered profile button at the bottom of the sidebar. The trigger *is* the profile
  row, so clicking your own name opens the menu rather than navigating on its own. The
  menu opens upward (`side="top"`) and contains only those two items — the repeated
  name/email/avatar header was deliberately removed.
- A name change revalidates the whole layout (`revalidatePath("/", "layout")`), because
  the shell renders the viewer's name in the sidebar.

## Conventions
- **Dates use `DatePicker`** (`components/ui/date-picker.tsx`), never a native
  `<input type="date">`: the trigger reads like an input, month/year are dropdowns, and
  day cells are sized for touch in `components/ui/calendar.tsx`. Every calendar in the
  app goes through that pair.
- **While the app is still in development, keep exactly one migration.** Do not stack
  incremental migrations: delete `drizzle/` and run `npm run db:generate` to regenerate
  the single `drizzle/0000_*.sql` from the current schema. Existing local databases must
  then be reset (`npm run db:reset`) or re-stamped, since their migration journal no
  longer matches.
- Keep modules small, commented, and consistent with the existing structure.
- Rendering `Button` as a link or any non-`<button>` needs `nativeButton={false}` (see
  `components/ui/pagination.tsx`); without it Base UI logs an accessibility warning and
  the rendered semantics are wrong. The inverse applies too: `DropdownMenuItem` and
  friends default to `nativeButton={false}`, so an item that renders a real `<button>`
  must pass `nativeButton`.
- Base UI menu items ship with `cursor-default`. The pointer rule in `app/globals.css` is
  deliberately **outside `@layer base`**, so it beats those utilities; keep it unlayered.
- Base UI menu parts must be grouped: a `DropdownMenuLabel` outside a
  `DropdownMenuGroup` throws `MenuGroupContext is missing` at runtime, not at build time,
  so it only shows up when the menu is first opened.
- **Restart `next dev` after editing server modules or the app shell, before trusting the
  browser.** Edited server code has more than once kept serving the old version, and a
  stale client bundle presents as a page that renders but does nothing — no console
  error, no server error, event handlers simply never attach. If the UI looks dead after
  an edit, restart the dev server first rather than debugging the component.
