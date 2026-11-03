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

## Domain rules
- Roles: `admin` (all leads, any stage, assign, send, manage users) and `user`
  (unassigned + own leads, up to `Retained`).
- Stages: `New → Contacted → Qualified → Retained → Sent to Firm`; `Disqualified` closes.
- Only `MVA` leads are sent to partner firm Brightwater (form-urlencoded API),
  **at most once per lead**.
- "On behalf of" leads: the injured person's name/phone/email replace the submitter's in
  what's sent; the submitter stays as the contact of record.

## Data layer
- Schema: one file per table in `lib/db/schema/`, re-exported by `lib/db/schema/index.ts`.
- Boot: `instrumentation.ts` → `lib/db/bootstrap.ts` creates `data/apex.db`, applies
  migrations, and imports CSVs from `lib/db/seed-data/` **only if the DB file is absent**.
- Free-text fields (including the boolean-looking ones) are stored as `TEXT`, never coerced.
- Passwords are a single `scrypt$params$salt$hash` string (per-user salt).

## Conventions
- **While the schema is still being built, do not stack migrations** — regenerate the single
  `drizzle/0000_*.sql` instead (delete `drizzle/` and run `npm run db:generate`). Add
  incremental migrations only once the schema is frozen.
- Keep modules small, commented, and consistent with the existing structure.
