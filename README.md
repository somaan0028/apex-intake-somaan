# Apex Intake Desk

Lead-intake app for **Apex Lead Source** (coding assessment). Apex runs MVA and Mass
Tort campaigns and delivers qualified leads to partner law firms, replacing their
Lawmatics CRM.

## Stack

- Next.js 16 (App Router, `cacheComponents`) · TypeScript · Tailwind v4 · shadcn/ui (Base UI)
- Embedded SQLite via Drizzle ORM + better-sqlite3
- Node `scrypt` password hashing

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. On first boot the app creates `data/apex.db` and imports the
seed CSVs; later boots reuse it. Delete `data/` to force a fresh import.

## Routes

| Route        | Access    | Notes                                          |
| ------------ | --------- | ---------------------------------------------- |
| `/`          | Public    | Home                                           |
| `/login`     | Public    | Email + password (shared demo password)        |
| `/dashboard` | Protected | Overview tab                                   |
| `/leads`     | Protected | Lead list (placeholder)                        |
| `/users`     | Protected | User management (placeholder)                  |

Everything other than `/` and `/login` is protected by `proxy.ts`, and each page under
the `(app)` route group re-checks the session server-side. Sessions are opaque,
DB-backed tokens (`sessions` table); passwords are scrypt-hashed. Every seeded account
uses the demo password `apex-demo-2026`.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` / `npm start` — production build / serve
- `npm run db:generate` — regenerate the Drizzle migration
- `npm run db:studio` — browse the database
