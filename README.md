# Alojamento Ideal

A full rebuild of [alojamentoideal.pt](https://alojamentoideal.pt), the booking platform for a short-term rental operator managing its own collection of apartments along Portugal's North Coast (Porto, Póvoa de Varzim, Leça da Palmeira and Canidelo), plus local tours and activities.

This is not a marketplace clone. It is a production system for a real business: guests browse homes and activities, book and pay online, and manage their trips, while the operator runs reservations, payouts, guest messaging and support from a dedicated admin panel. Everything stays synchronized with the property management systems the business already relies on.

## What the platform does

**For guests**

- Browse and search apartments with live availability, pricing and interactive maps
- Discover and book local activities and tours
- A single cart and checkout that can mix stays and activities in one payment
- Accounts with booking history, bookmarks, reviews and identity verification
- Direct messaging with the operator, help center and contact forms
- Order pages with live booking details, editable trip information and downloadable tickets

**For the operator**

- Admin panel for reservations, orders, refunds and payout accounts
- Unified inbox that merges guest conversations across channels
- Owner-facing views for property performance
- Content management for help articles and guest support

## How it works under the hood

The platform sits on top of several external systems and keeps them consistent:

- **Hostify** (property management) is the source of truth for calendars and reservations. Bookings use a reserve-first flow: inventory is held before payment, then confirmed or released depending on the outcome, so double bookings cannot occur even under failure.
- **Stripe** handles payments, including split payouts to property owners via Stripe Connect, partial refunds and webhook-driven order reconciliation.
- **Bokun** powers the activities catalog and ticketing, with real-time availability and post-purchase booking edits.
- **Hostkit** supplies fiscal and reservation data required for Portuguese compliance.

Booking a stay is a multi-step distributed transaction across these providers. The system is designed so that any step can fail without leaving money or inventory in an inconsistent state: holds are verified before capture, refunds are reconciled by background jobs, and webhooks are processed idempotently.

## Technology

| Area | Choice |
|------|--------|
| Framework | Next.js 16 (App Router, Partial Prerendering / cache components) |
| Language | TypeScript, strictly typed throughout |
| Runtime & tooling | Bun, Turborepo, Biome |
| Database | PostgreSQL with Drizzle ORM (full-text search, geo queries) |
| Auth | better-auth with email flows via Resend |
| Payments | Stripe + Stripe Connect |
| Caching & rate limiting | Redis |
| Realtime | Pusher (live chat and updates) |
| Observability | Sentry for errors, Postgres-backed analytics |
| Email | Maizzle-built transactional templates |
| UI | shadcn/ui, Radix, Tailwind CSS |

## Repository structure

```
apps/
  web/      Guest-facing site: homes, activities, cart, checkout, account
  admin/    Operator panel: reservations, payouts, inbox, support content
  emails/   Transactional email templates
packages/
  core/     Business logic: payments, rate limiting, provider integrations
  db/       Database schema and migrations
  auth/     Authentication, sessions, email delivery
  ui/       Shared component library
docs/       Architecture notes, integration research, roadmap
```

## Running locally

Requires Bun 1.3+, Node 20+ and Docker.

```bash
bun install
bun run services:up   # Postgres + Redis
bun run db:migrate
bun run dev
```

The web app runs on port 3000 and the admin panel on port 3001. External integrations (Stripe, Hostify, Bokun, Hostkit) require API credentials configured in a root `.env` file.

## Docker

Each app has its own image (`apps/web/Dockerfile`, `apps/admin/Dockerfile`), built from the repository root as a standalone Next.js server and deployed on Forge. Forge picks the Dockerfile up when a target's framework is set to Dockerfile with no install, build or runtime overrides, and it hands the deployment environment to the build as the `forge-env` secret.

To build one outside Forge, pass a file of shell-safe `KEY='value'` assignments under the same secret id:

```bash
docker buildx build -f apps/web/Dockerfile --secret id=forge-env,src=build.env -t alojamentoideal-web .
docker run --env-file .env -p 3000:3000 alojamentoideal-web
```

The secret is only mounted while building. Like the previous build commands, the builds run database migrations (and, for admin, the root-admin and help-article seeds), and the web build prerenders the catalog, so the `DATABASE_URL` in that file must be reachable from the build. On Docker Desktop use `host.docker.internal` instead of `localhost`.

## Status

Actively developed. The `docs/` directory tracks the migration roadmap from the legacy application and the design decisions behind each subsystem.
