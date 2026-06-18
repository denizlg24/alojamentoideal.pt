# Plan 003: Add a live accommodation quote API backed by Hostify and Redis

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. If a STOP condition occurs, stop and
> report instead of improvising.
>
> **Drift check (run first)**:
> `git diff --stat f16379d..HEAD -- packages/core/src/integrations packages/core/src/redis packages/core/src/rate-limit apps/web/app/api apps/web/lib/api.ts docs/data-architecture.md`
> If an in-scope file changed since this plan was written, compare the current
> code against the excerpts below before proceeding.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/002-public-accommodation-catalog-api.md
- **Category**: direction
- **Planned at**: commit `f16379d`, 2026-06-18

## User Story

As a guest selecting accommodation dates and party size, I can request a live
backend quote that revalidates Hostify availability and price, so checkout starts
from current provider truth instead of stale catalog cache data.

## Why this matters

The listing cache should power discovery, but `docs/data-architecture.md:25`
states that cached data is advisory at checkout. The next backend step after
catalog reads is a quote boundary that calls Hostify live endpoints, normalizes
provider errors, stores a short-lived quote in Redis, and returns a signed quote
ID the frontend can carry into checkout.

## Current state

- `packages/core/src/integrations/hostify/client.ts:425` exposes
  `listings.listAvailable`.
- `packages/core/src/integrations/hostify/client.ts:430` exposes
  `listings.price`.
- `packages/core/src/redis` exists and health checks call `pingRedis`.
- `apps/web/lib/api.ts` already applies rate limiting, request IDs, and
  observability.
- `docs/data-architecture.md:680` recommends Redis short TTL only for Hostify
  live availability.
- There is no quote domain module or quote API route yet.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Core tests | `bun run --filter @workspace/core test` | exit 0 |
| Web typecheck | `bun run --filter web typecheck` | exit 0 |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `packages/core/src/quotes/*` or `packages/core/src/accommodation-quotes/*`
- `packages/core/src/index.ts`
- `packages/core/package.json` exports if a subpath export is added
- `apps/web/app/api/accommodations/[id]/quote/route.ts` or
  `apps/web/app/api/quotes/accommodation/route.ts`
- Focused tests under `packages/core/src/**`

**Out of scope**:
- Creating Hostify reservations.
- Creating Stripe payment intents.
- Persisting orders in PostgreSQL.
- Activity/Bokun quotes unless the executor chooses shared types that do not
  pull Bokun implementation into this plan.
- Frontend checkout UI.

## Steps

### Step 1: Define the quote request and response contract

Create a core quote module with zod schemas or equivalent typed validation for:

- listing external ID;
- check-in date;
- check-out date;
- adults/children/infants or the current Hostify-supported party fields;
- currency if Hostify supports it in the current type definitions;
- locale if needed for display copy.

Reject invalid date ranges before calling Hostify:

- check-out must be after check-in;
- stay length must have a sane maximum;
- party counts must be non-negative and at least one guest overall.

Response should include:

- `quoteId`;
- `expiresAt`;
- `listingId`;
- normalized amount in integer minor units where possible;
- currency;
- provider snapshot needed for later checkout;
- warnings/failure reason when unavailable.

**Verify**: `bun run --filter @workspace/core test` -> exit 0.

### Step 2: Implement Hostify quote service

Implement a service that:

- checks the listing exists in the local catalog using Plan 002 repository
  methods;
- calls Hostify live availability/price methods;
- normalizes provider errors into stable reason codes such as `unavailable`,
  `provider_timeout`, `provider_rejected`, and `validation_error`;
- never returns raw provider error text to the client;
- records one observability custom/integration event for quote success/failure
  if the existing event API is appropriate.

Use dependency injection for the Hostify client, Redis client, clock, and UUID
generator so tests can run without network or Redis.

**Verify**: `bun run --filter @workspace/core test` -> new unit tests pass.

### Step 3: Store quotes in Redis with a short TTL

Use the existing Redis package instead of adding another cache dependency. Store
only the checkout-safe snapshot, not full raw provider payloads. Suggested key:

```text
quote:accommodation:<quoteId>
```

Set TTL to a small configurable value, for example 10-15 minutes. Add config via
environment helper functions already used elsewhere in core.

If Redis is unavailable:

- For quote creation, fail closed with a stable `quote_unavailable` response;
  checkout needs a retrievable quote.
- Do not silently continue with an in-memory quote.

**Verify**: `bun run --filter @workspace/core test` -> quote TTL and Redis-error
tests pass with a fake store.

### Step 4: Add the quote API route

Create a POST route using `withApiRoute`. Recommended endpoint:

```text
POST /api/accommodations/:id/quote
```

The route should:

- parse JSON body safely;
- pass request data to the quote service;
- return `400` for validation errors;
- return `404` for unknown inactive listings;
- return `409` for unavailable dates;
- return `503` for provider/cache outage;
- return `200` with quote payload on success;
- apply rate limiting with a bucket suitable for live provider calls.

Before writing route code, honor `AGENTS.md`: read local Next route-handler docs
if available. If `node_modules/next/dist/docs/` is absent, match existing route
files.

**Verify**: `bun run --filter web typecheck` -> exit 0.

## Test plan

- Unit tests for date validation and party validation.
- Unit tests for Hostify success -> normalized quote.
- Unit tests for Hostify unavailable/provider failures -> stable responses.
- Unit tests that Redis write failure prevents quote creation.
- Route tests only if the app already has a pattern; otherwise rely on core
  tests plus app typecheck.

## Done criteria

- [ ] A frontend can call one POST endpoint to obtain a live accommodation quote.
- [ ] Quotes are retrievable later by `quoteId` from Redis within TTL.
- [ ] Provider failures are normalized and redacted.
- [ ] No Hostify reservation or Stripe payment is created.
- [ ] `bun run --filter @workspace/core test` exits 0.
- [ ] `bun run --filter web typecheck` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- Hostify type definitions do not clearly identify the required price query
  fields and docs/sandbox confirmation is unavailable.
- Redis primitives in `packages/core/src/redis` cannot support TTL writes
  without changing its public shape substantially.
- The implementation starts needing order tables or Stripe.
- The route would need to trust cached listing price instead of live Hostify.

## Maintenance notes

This quote is not an order and not a reservation. Reviewers should check TTL,
redaction, status codes, and whether the returned snapshot is sufficient for
Plan 004 checkout without exposing provider raw payloads.
