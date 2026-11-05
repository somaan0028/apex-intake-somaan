# Apex Intake Desk

Lead intake and pipeline app for **Apex Lead Source**. It captures MVA and Mass Tort
leads from a public form, gives the desk a permission-aware pipeline, and sends
qualified MVA leads to the partner firm Brightwater.

## Requirements

- Node.js 20 or newer
- npm
- A POSIX shell for `./start.sh`. On Windows, run it from Git Bash or WSL.

SQLite is embedded through `better-sqlite3`, so there is no database server to
install.

## One-command setup

```bash
./start.sh
```

From a clean clone this:

1. installs the dependencies
2. creates `.env` with the two required keys
3. creates and seeds `data/apex.db` when the file is missing
4. builds the app
5. serves it at <http://localhost:8080>

The generated `.env` contains only the required values:

```dotenv
OPENROUTER_API_KEY=...
CANDIDATE_TOKEN=...
```

The placeholders are non-empty so the app can boot, but the AI assistant and
Brightwater sends need real credentials. Edit `.env`, or pass them once:

```bash
OPENROUTER_API_KEY=... CANDIDATE_TOKEN=... ./start.sh
```

Existing real values are kept when setup runs again. Optional settings such as
`DATABASE_PATH`, `AUTH_COOKIE_SECURE`, and `AI_MODEL` belong in `.env.local`,
which Next.js loads and Git ignores.

## Manual setup

```bash
npm install
npm run setup
npm run build
npm start
```

`npm start` serves the production build at <http://localhost:8080>.
`npm run setup` is safe to rerun: it preserves real credentials and only creates
the database when it does not exist yet.

## Development

```bash
npm run dev
```

The dev server runs at <http://localhost:3000>. The database is created and
seeded on the first server boot if `data/apex.db` is absent.

## Demo accounts

Every seeded account uses the password `apex-demo-2026`.

| Role  | Email                            |
| ----- | -------------------------------- |
| Admin | `dana.whitfield@apex-leads.test` |
| Admin | `marcus.bell@apex-leads.test`    |
| Agent | `maria.delgado@apex-leads.test`  |
| Agent | `derek.lawson@apex-leads.test`   |

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

## Routes

| Route                 | Access    | Purpose                                       |
| --------------------- | --------- | --------------------------------------------- |
| `/`                   | Public    | Lead intake form                              |
| `/login`              | Public    | Email and password sign-in                    |
| `/dashboard`          | Protected | Overview and pipeline summary                 |
| `/leads`              | Protected | Leads board/table; the last view is remembered, and `?view=table` or `?view=kanban` overrides it for that page |
| `/analytics`          | Admin     | Attribution and funnel reporting              |
| `/users`              | Admin     | User management                               |
| `/settings`           | Protected | MCP access tokens                             |
| `/profile`            | Protected | Name, password, and account details           |
| `/api/public/leads`   | Public    | Intake submission endpoint                    |
| `/api/ai/chat`        | Protected | Streaming assistant replies                   |
| `/api/mcp`            | Token     | MCP server for external agents                |

## Scripts

| Command               | What it does                                      |
| --------------------- | ------------------------------------------------- |
| `./start.sh`          | Full clean-clone setup, build, and production run |
| `npm run setup`       | Write `.env` and prepare the database             |
| `npm run dev`         | Development server on port 3000                   |
| `npm run build`       | Production build                                  |
| `npm start`           | Serve the build on port 8080                      |
| `npm run db:reset`    | Delete, recreate, and reseed the database         |
| `npm run db:generate` | Regenerate the Drizzle migration                  |
| `npm run db:studio`   | Browse the database with Drizzle Studio           |
| `npm run mcp:token`   | Mint an MCP token for an email address            |
| `npm run lint`        | Run ESLint                                        |

Stop the server before running `npm run db:reset` so the SQLite file is not
locked. The reset deletes the file and imports the bundled CSV seed data again.

## Data

- `data/apex.db` holds the SQLite database. `data/` and `.env` are ignored by
  Git.
- Seed data lives in `lib/db/seed-data/`. It is imported only when the database
  file is absent.
- Passwords are stored as per-user `scrypt` hashes.
- Dates and timestamps are stored as Unix seconds. Phone numbers are stored as
  `(XXX) XXX-XXXX`.
- Brightwater receives only MVA leads, and only once. A lead cannot be moved to
  Sent to Firm until a submission actually succeeded.
