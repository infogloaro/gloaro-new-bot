# GloAro WhatsApp Bot

WhatsApp bot for GloAro Mart and GloAro Digital Network — menu-based conversations,
lead capture, PostgreSQL storage, Google Sheets sync and admin WhatsApp notifications.

Backend and admin panel are both complete and running locally. WhatsApp and Google
Sheets are wired but switched off until GloAro supplies credentials. AWS deployment
comes later; Dockerfiles and env-driven config are already in place for it.

## Stack

| Layer | Choice |
|---|---|
| Backend | NestJS 11 (TypeScript, Node 22) |
| ORM | Prisma 6 |
| Database | PostgreSQL 16 |
| Queues | BullMQ + Redis (Sheets sync, admin notify) |
| WhatsApp | Meta WhatsApp Cloud API v23.0 |
| Sheets | Google Sheets API v4 (service account) |
| Auth | JWT access + refresh, bcrypt |
| Frontend | React 19 + Vite 6 + Tailwind 4 + TanStack Query v5 + Recharts |

## Running locally

Requires Node 22 and Docker Desktop.

```bash
npm install --workspace=@gloaro/backend
docker compose up -d              # Postgres on 5433, Redis on 6380
cp .env.example .env              # then set JWT_SECRET / JWT_REFRESH_SECRET

cd apps/backend
npx prisma migrate dev            # create the schema
npx ts-node prisma/seed.ts        # admin user, settings, 60 bot flow nodes
npm run dev                       # backend on http://localhost:3000
```

Then, in a second terminal:

```bash
cd apps/frontend
npm install
npm run dev                       # admin panel on http://localhost:5173
```

- Admin panel: http://localhost:5173
- API docs: http://localhost:3000/api/docs
- Health: http://localhost:3000/health
- Default login: `admin@gloaro.com` / `ChangeMe@123` — **change this before production**

## Admin panel screens

| Screen | What it does |
|---|---|
| **Dashboard** | Total / New / Follow-up / Closed / Today's leads, customers, active conversations, a 14-day trend chart and recent leads. Warns when a Sheets sync or notification has failed. |
| **Leads** | Search across name, phone, business, requirement and ref; filter by status, category and date range. Sheet/alert sync badges per row. |
| **Lead detail** | Every captured field, everything the bot collected, status change, notes, and a **Retry sync** button. |
| **Customers** | Searchable list; profile page with full conversation history and all their leads. |
| **Conversations** | Live threads, **Take over** to silence the bot and reply as an agent, **Hand back to bot**. |
| **Bot Menu** | Edit the welcome message, menus and questions. Structure is shown read-only; message text saves instantly, no redeploy. |
| **Simulator** | Chat with the live bot engine from the browser. Completed flows create real leads. |
| **Settings** | Company details, admin notification numbers, Google Sheet config with a **Test connection** button. |

## Testing the bot without WhatsApp

While `WHATSAPP_ENABLED=false`, outbound messages are logged rather than sent, so
every flow can be exercised end to end:

```bash
# log in, then:
POST /api/bot/simulate   { "from": "919876543210", "text": "hi" }
GET  /api/bot/outbox     # what the bot would have sent
```

`POST /api/bot/simulate` runs the real engine, real validation and real lead
creation — it is also the fastest way to reproduce a reported conversation bug.

## Conversation flow

All 60 nodes live in `apps/backend/src/bot/flow-definition.ts` and are seeded into
the `bot_flows` table. After seeding, message text is edited from the admin panel's
Bot Menu screen — re-running the seed refreshes structure but **preserves edited copy**.

Node types: `MENU` (waits for an option), `QUESTION` (waits for a validated answer),
`MESSAGE` (sends and continues), `ACTION` (`CREATE_LEAD` / `TRACK_ORDER` / `END`).

Customers can reply `0` for the main menu from anywhere. Three unrecognised replies
in a row return them to the welcome message. Sessions restart at the welcome message
after 30 minutes of inactivity (`BOT_SESSION_TIMEOUT_MINUTES`).

## Reliability

- **Webhook idempotency** — every Meta message id is claimed in `webhook_events`
  before processing. A redelivery hits the unique constraint and is dropped, so one
  customer message can never produce two replies or two leads. Verified by test.
- **Signature verification** — `X-Hub-Signature-256` is checked against the raw
  request body on every POST. The raw bytes are preserved in `main.ts`; parsing and
  re-stringifying would break every signature.
- **Queued side effects** — the Sheets append and admin notification run on BullMQ
  with exponential backoff, so neither can delay the webhook response or lose a lead.
- **Reconcile job** — every 10 minutes, leads whose sync never completed are
  re-queued. This holds even if Redis was down when the lead was created.

## Still to do

1. Switch on WhatsApp: Meta app config, then set `WHATSAPP_*` in `.env`.
2. Switch on Sheets: service account JSON + `GOOGLE_SHEET_ID`.
3. AWS deployment (ECR/ECS/RDS or single EC2 — decision deferred).

## What GloAro still needs to provide

| Item | Needed for |
|---|---|
| Dedicated WhatsApp number + Meta Business/WhatsApp Business account | Sending and receiving live messages |
| Meta App Secret, Access Token, Phone Number ID | `WHATSAPP_*` env vars |
| Admin notification WhatsApp number | New-lead alerts |
| Google account + Sheet + service account JSON | Lead sync to Sheets |
| Company details: logo, email, website, support phone | Bot message placeholders (Settings screen) |
| Order tracking API (if one exists) | Live order status; otherwise a support request is raised |
