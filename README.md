# Apex Intake Desk

Lead intake and pipeline app for **Apex Lead Source**. It captures MVA and Mass Tort
leads from a public form, gives the desk a permission-aware pipeline, and sends
qualified MVA leads to the partner firm Brightwater.

## Requirements

- Node.js 20 or newer
- npm

## Setup

1. Clone the repo
2. Move into the folder and run `npm run setup` (this installs dependencies, creates a SQLite database, and seeds it with the CSVs)
3. Replace `OPENROUTER_API_KEY` and `CANDIDATE_TOKEN` in the `.env` file
4. Run `npm start`

The app runs at <http://localhost:8080>.

## Development

To run the development server, run `npm run dev`.

The dev server runs at <http://localhost:3000>. The database is created and
seeded on the first server boot if no database is present.

## Demo accounts

Every seeded account uses the password `apex-demo-2026`.

| Role  | Email                            |
| ----- | -------------------------------- |
| Admin | `dana.whitfield@apex-leads.test` |
| User | `derek.lawson@apex-leads.test`   |

The seed file contains 15 users in total. Admins can see and edit every lead,
assign work, send leads to Brightwater, manage users, and open Campaign
Analytics. Agents see unassigned leads plus their own, and can move a lead up to
Retained.

## What is included

- **Public intake** at `/`. The mobile-first form reads UTM parameters, validates
  the submission on the server, and posts to `POST /api/public/leads`.
- **Lead pipeline** with a Kanban board and a table view, filters, search, saved
  views, inline stage and assignee editing, and a detail dialog that saves as you
  type.
- **Roles and permissions** enforced in the data layer for every page, action,
  AI tool, and MCP call.
- **Brightwater submission** for MVA leads, at most once per lead, with the
  firm's own rejection message surfaced to the operator.
- **AI assistant** in a non-modal panel, backed by OpenRouter and a tool layer
  scoped to the signed-in user.
- **MCP server** at `POST|GET|DELETE /api/mcp`, authenticated with a personal
  access token and sharing the same tools as the assistant.
- **Analytics** for admins, grouped by campaign, source, medium, and content,
  with the shared date-range filter and a campaign selector.

## Architecture

```text
.
├── app/
│   ├── (app)/                 signed-in shell
│   │   ├── dashboard/         overview, pipeline, Larry's card
│   │   ├── leads/             board, table, detail dialog
│   │   ├── activity/          audit trail
│   │   ├── analytics/         admin attribution reporting
│   │   ├── users/             admin user management
│   │   ├── settings/          MCP tokens, preferences
│   │   └── profile/           own account
│   ├── api/                   public intake, AI chat, MCP, avatars, CSV export
│   ├── login/                 public sign-in
│   └── layout.tsx             root shell and theme boot
├── components/
│   ├── ai/                    Larry panel, transcript, mascot
│   ├── data-table/            shared grid: filters, columns, paging
│   ├── intake/                public lead form
│   └── ui/                    shadcn/ui primitives
├── hooks/                     small client hooks
├── lib/
│   ├── db/                    Drizzle schema (one file per table), bootstrap, seed
│   ├── leads/                 service, queries, validation, duplicates, analytics
│   ├── ai/                    prompt, chat store, tool layer
│   ├── mcp/                   MCP handler over the same tool layer
│   ├── auth/                  session, scrypt passwords, profile actions
│   ├── rbac/                  permission checks
│   ├── brightwater/           payload, client, attempt logging
│   ├── activities/            audit log queries and descriptions
│   ├── users/                 avatars, user service
│   ├── preferences/           appearance JSON schema
│   └── themes/                preset registry
├── scripts/                   setup, seeding, token minting, checks
├── drizzle/                   generated migration
├── public/                    static assets, Larry's Lottie animation
└── data/                      SQLite database, Brightwater logs, avatars (gitignored)
```

- **Next.js 16 App Router** with Server Components for pages, Server Actions for
  mutations, and a thin route-handler layer under `app/api/`.
- **SQLite via Drizzle ORM** (`lib/db/`), one schema file per table. `instrumentation.ts`
  creates and seeds `data/apex.db` from the bundled CSVs only when the file is absent.
- **One service layer** (`lib/leads/service.ts`, `lib/users/`, `lib/auth/`) holds every
  read and write. Pages, Server Actions, the AI assistant, and the MCP server all call
  it, so permissions (`lib/rbac/`) are enforced once rather than per surface.
- **One tool layer** (`lib/ai/tools.ts`) is shared by the assistant and the MCP server;
  both act with the signed-in person's permissions. Sending to the firm and deleting a
  lead are human-only and have no tool.
- **Brightwater** (`lib/brightwater/`) builds a form-urlencoded payload and writes one
  JSON log per attempt to `data/brightwater-logs/`, beside the database.
- **Auth** is a session cookie backed by scrypt password hashes; MCP calls use a
  bearer personal access token stored as a SHA-256 hash.

## Routes

| Route                    | Access    | Purpose                                             |
| ------------------------ | --------- | --------------------------------------------------- |
| `/`                      | Public    | Lead intake form                                    |
| `/login`                 | Public    | Email and password sign-in                          |
| `/dashboard`             | Protected | Overview and pipeline summary                       |
| `/leads`                 | Protected | Board/table; `?view=` overrides the remembered view |
| `/analytics`             | Admin     | Attribution and funnel reporting                    |
| `/activity`              | Protected | Audit trail (own actions, or all for admins)        |
| `/users`                 | Admin     | User management                                     |
| `/settings`              | Protected | Redirects to `/settings/ai`                         |
| `/settings/ai`           | Protected | MCP access tokens                                   |
| `/settings/preferences`  | Protected | Theme and colour mode                               |
| `/profile`               | Protected | Name, password, and account details                 |
| `/api/public/leads`      | Public    | Intake submission endpoint                          |
| `/api/leads/export`      | Protected | CSV export of every lead under the current filters  |
| `/api/ai/chat`           | Protected | Streaming assistant replies                         |
| `/api/mcp`               | Token     | MCP server for external agents                      |
| `/api/users/[id]/avatar` | Protected | Profile photo stream                                |

## Scripts

| Command                | What it does                                             |
| ---------------------- | -------------------------------------------------------- |
| `npm run setup`        | Full clean-clone setup: install, `.env`, database, build |
| `npm run dev`          | Development server on port 3000                          |
| `npm run build`        | Production build                                         |
| `npm start`            | Serve the build on port 8080                             |
| `npm run db:reset`     | Delete, recreate, and reseed the database                |
| `npm run db:generate`  | Regenerate the Drizzle migration                         |
| `npm run db:studio`    | Browse the database with Drizzle Studio                  |
