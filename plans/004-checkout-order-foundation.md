# Plan 004: Add PostgreSQL checkout and order foundation without provider mutation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. If a STOP condition occurs, stop and
> report instead of improvising.
>
> **Drift check (run first)**:
> `git diff --stat f16379d..HEAD -- packages/db packages/core/src apps/web/app/api docs/data-architecture.md`
> If an in-scope file changed since this plan was written, compare the current
> code against the excerpts below before proceeding.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/003-live-accommodation-quote-api.md
- **Category**: direction
- **Planned at**: commit `f16379d`, 2026-06-18

## User Story

As the backend owner, I can create a normalized draft order from an accepted
quote without yet mutating Hostify, Bokun, or Stripe, so the checkout domain has
a durable PostgreSQL shape before payment and provider-reservation side effects
are introduced.

## Why this matters

Jumping from quote directly into provider reservations and Stripe would recreate
the legacy partial-failure problem. `docs/data-architecture.md` repeatedly points
to normalized orders, order items, provider bookings, payment attempts, inboxes,
and worker-driven side effects as the target. This plan deliberately stops at
the durable order foundation and idempotent API contract.

## Current state

- `packages/db/src/schema.ts` currently contains Better Auth tables,
  `providerSyncRun`, `providerSyncState`, `accommodationListing`, and
  `observabilityEvent`.
- There are no `orders`, `order_items`, `provider_bookings`, or
  `payment_attempts` tables yet.
- `docs/data-architecture.md:776` starts the target orders/items section.
- `docs/data-architecture.md:876` starts the provider bookings section.
- `docs/data-architecture.md:1471` names `POST /v1/orders` and
  `GET /v1/orders/:publicReference` as target API endpoints.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Generate migration | `bun run db:generate` | new Drizzle migration generated |
| DB package typecheck | `bun run --filter @workspace/db typecheck` | exit 0 |
| Core tests | `bun run --filter @workspace/core test` | exit 0 |
| Web typecheck | `bun run --filter web typecheck` | exit 0 |
| Full typecheck | `bun run typecheck` | exit 0 |

## Scope

**In scope**:
- `packages/db/src/schema.ts`
- generated Drizzle migration under `packages/db/drizzle`
- `packages/core/src/orders/*`
- `packages/core/src/index.ts`
- `apps/web/app/api/orders/route.ts`
- `apps/web/app/api/orders/[publicReference]/route.ts`
- focused tests

**Out of scope**:
- Stripe PaymentIntents.
- Hostify reservation creation.
- Bokun checkout submission.
- Webhook handlers.
- Admin dashboards.
- Guest registration, messaging, fiscal documents, refunds, or migration from
  the legacy app.

## Steps

### Step 1: Add minimal normalized order schema

Add the smallest useful set of tables, matching the naming style already in
`packages/db/src/schema.ts`.

Minimum tables:

- `orders`
  - `id`
  - `publicReference`
  - `status` such as `draft`, `awaiting_payment`, `cancelled`
  - `currency`
  - `totalAmountCents`
  - `customerEmailHash` or nullable contact pointer; do not store rich PII in
    this plan unless the target privacy model is already decided
  - `quoteId`
  - `idempotencyKey`
  - timestamps
- `order_items`
  - `id`
  - `orderId`
  - `itemType`
  - `provider`
  - `externalListingId`
  - date range/party snapshot
  - `amountCents`
  - `currency`
  - sanitized `quoteSnapshot`
  - timestamps
- `payment_attempts`
  - skeleton rows only if needed for forward compatibility; no Stripe calls
    in this plan.

Use unique indexes for `publicReference` and `idempotencyKey`.

**Verify**: `bun run --filter @workspace/db typecheck` -> exit 0.

### Step 2: Generate and inspect the Drizzle migration

Run `bun run db:generate`. Inspect the generated SQL. Confirm:

- tables use snake_case;
- unique indexes exist;
- foreign keys point from item/payment tables to `orders`;
- no existing listing/auth tables are dropped or rewritten.

**Verify**: `bun run db:generate` -> migration generated, then
`bun run --filter @workspace/db typecheck` -> exit 0.

### Step 3: Add an order service with idempotent draft creation

Create `packages/core/src/orders` with:

- input validation for `quoteId`, customer contact minimum, and idempotency key;
- quote lookup through the quote store from Plan 003;
- draft order creation in a database transaction;
- idempotent return of the existing order when the same idempotency key is
  reused;
- public reference generation, for example `AI-YYYY-XXXXXX`.

Do not create provider reservations or payment attempts that imply money
movement. The output should be suitable for a later Stripe plan:

```ts
{
  orderId: "...",
  publicReference: "AI-2026-000001",
  status: "draft",
  totalAmountCents: 12345,
  currency: "EUR"
}
```

**Verify**: `bun run --filter @workspace/core test` -> order service unit tests
pass.

### Step 4: Add order API routes

Create:

- `POST /api/orders`
- `GET /api/orders/[publicReference]`

Use `withApiRoute`. The POST route should require an idempotency key header, for
example `Idempotency-Key`. Return:

- `201` for new draft order;
- `200` for idempotent replay;
- `400` for invalid input;
- `404` or `410` for missing/expired quote;
- `409` for quote/order state conflict.

The GET route should return only safe status/summary fields. It must not expose
PII or full quote/provider snapshots.

Before writing route code, honor `AGENTS.md`: read local Next route-handler docs
if available. If `node_modules/next/dist/docs/` is absent, match existing route
files.

**Verify**: `bun run --filter web typecheck` -> exit 0.

## Test plan

- Unit test idempotent order creation.
- Unit test expired/missing quote rejection.
- Unit test total/currency copied from quote snapshot.
- Unit test duplicate idempotency key returns the existing order.
- If live DB tests are not established, keep database interaction behind a
  small repository interface and test the service with a fake repository.

## Done criteria

- [ ] Drizzle schema and migration define minimal order tables.
- [ ] A draft order can be created from a valid quote without provider or Stripe
  mutation.
- [ ] Idempotency key behavior is implemented and tested.
- [ ] `GET /api/orders/[publicReference]` returns a safe order summary.
- [ ] `bun run --filter @workspace/db typecheck` exits 0.
- [ ] `bun run --filter @workspace/core test` exits 0.
- [ ] `bun run --filter web typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The quote store from Plan 003 does not exist or does not expose a retrievable
  quote snapshot.
- The order schema would require unresolved decisions about customer accounts,
  guest PII encryption, or fiscal document retention.
- Implementing this plan requires calling Stripe, Hostify reservation creation,
  or Bokun checkout submission.
- Drizzle migration generation attempts to drop or rewrite existing tables.

## Maintenance notes

This is intentionally a foundation, not complete checkout. Reviewers should
check transaction boundaries, idempotency, PII minimization, and whether future
provider/payment workers can attach to the schema without reshaping it
immediately.
