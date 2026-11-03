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

| Route        | Access    | Notes                                              |
| ------------ | --------- | -------------------------------------------------- |
| `/`          | Public    | Home                                               |
| `/login`     | Public    | Mock login (any non-empty credentials)             |
| `/dashboard` | Protected | Placeholder                                        |

Everything other than `/` and `/login` is protected by `proxy.ts`. Authentication is
currently **mocked** (a plain cookie); real DB-backed auth comes next.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` / `npm start` — production build / serve
- `npm run db:generate` — regenerate the Drizzle migration
- `npm run db:studio` — browse the database
