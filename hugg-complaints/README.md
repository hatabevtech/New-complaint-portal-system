# Hugg Complaints — Operator Console

Standalone Next.js 14 app for the complaint & NDR operator workflow.
Reads the `complaints` schema in Supabase and writes via the state-machine API routes.

## Deploy on Vercel

1. Push this folder to a new GitHub repo.
2. Import the repo in Vercel (Framework preset: **Next.js**, auto-detected).
3. Set three Environment Variables in the Vercel project:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. In Supabase → **Settings → API → Exposed schemas**, add `complaints`
   (without this, the `.schema('complaints')` reads/writes fail).
5. Deploy.

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in the three Supabase keys
npm run dev                  # http://localhost:3000
```

## What it does

- **List + queue** with status counters and a "Mine (to action)" filter
  (human-owned, non-closed tickets).
- **Ticket panel** (3 parts): who/what/timeline · type-specific detail ·
  stage-driven actions.
- **Wired actions** (write to Supabase via `/api/complaints/[id]/*`):
  - stage advance (with data gates), assign/handoff, escalate↔respond,
    close (resolve), and generic action logging.
- **Stubbed externals** (log an action now, integrate later):
  Razorpay payment link, SMS sends, courier email, 2nd-level refund approval.

## Structure

- `lib/pipelines.ts` — the five pipelines as config
- `lib/state-machine.ts` — assign / advance / close / escalate / respond / record
- `lib/data.ts` — reads `complaints.*`, joins `public.orders` for display
- `lib/complaints-db.ts` — `.schema('complaints')` accessor
- `app/api/complaints/[id]/*` — the six write routes
- `components/Console.tsx` — the client UI
