# Plan 002: Expose cached Hostify accommodations through public backend APIs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. If a STOP condition occurs, stop and
> report instead of improvising.
>
> **Drift check (run first)**:
> `git diff --stat f16379d..HEAD -- packages/core/src/listing-cache packages/db/src/schema.ts apps/web/app/api apps/web/lib/api.ts`
> If an in-scope file changed since this plan was written, compare the current
> code against the excerpts below before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-grounded-hostify-integration.md
- **Category**: direction
- **Planned at**: commit `f16379d`, 2026-06-18

## User Story

As a frontend developer, I can fetch searchable accommodation summaries and
individual accommodation details from this application's backend, so the web UI
can be built against stable Alojamento Ideal contracts instead of reading
Hostify-shaped cache rows or provider APIs directly.

## Why this matters

The listing cache exists, but it is not yet a product API. The next backend-first
task should convert `accommodation_listing` into stable read endpoints with
pagination, filtering, freshness metadata, and a frontend-safe response shape.
This unlocks real frontend work while keeping provider details behind the
backend boundary required by `docs/data-architecture.md`.

## Current state

- `packages/db/src/schema.ts` defines `accommodationListing` at line 187 with
  provider IDs, normalized content, processed content, raw content, freshness,
  location, capacity, and status columns.
- `packages/core/src/listing-cache/repository.ts` defines
  `ListingCacheRepository` at line 126, but it only exposes sync/write helpers
  plus `findListingState` and `upsertListing`.
- `apps/web/lib/api.ts` defines `withApiRoute` at line 42. New route handlers
  should use it for rate limiting, request IDs, Sentry capture, structured logs,
  and observability events.
- `apps/web/app/api/cron/hostify/listings/route.ts` is the existing route
  pattern for importing core logic into a Next route.
- `docs/data-architecture.md:22` says the browser must only call the backend,
  not Hostify or Bokun directly.

Relevant excerpts:

```ts
// packages/db/src/schema.ts:187
export const accommodationListing = pgTable(
  "accommodation_listing",
  {
    id: text("id").primaryKey(),
    active: boolean("active").notNull().default(true),
    city: text("city"),
    country: text("country"),
    externalId: text("external_id").notNull(),
    normalized: jsonb("normalized").$type<AccommodationListingNormalizedContent>().notNull(),
    processed: jsonb("processed").$type<AccommodationListingProcessedContent>().notNull(),
    raw: jsonb("raw").$type<AccommodationListingRawContent>().notNull(),
    staleAfter: timestampWithTimezone("stale_after").notNull(),
  }
);
```

```ts
// apps/web/lib/api.ts:42
export function withApiRoute<Ctx = unknown>(
  options: ApiRouteOptions,
  handler: RouteHandler<Ctx>,
): (request: Request, context: Ctx) => Promise<Response>
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Tests | `bun run --filter @workspace/core test` | exit 0 |
| App tests | `bun run --filter web test` | exit 0 |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `packages/core/src/listing-cache/repository.ts`
- `packages/core/src/listing-cache/index.ts`
- `packages/core/src/listing-cache/*.test.ts`
- `apps/web/app/api/accommodations/route.ts`
- `apps/web/app/api/accommodations/[id]/route.ts`
- `apps/web/app/api/accommodations/search/route.ts` only if a separate search
  endpoint is cleaner than query params on `/api/accommodations`

**Out of scope**:
- Mutating Hostify data.
- Calling Hostify from these read endpoints.
- Building frontend pages/components.
- Changing the listing sync pipeline except for adding read methods.
- Adding checkout, reservations, or Stripe behavior.

## Steps

### Step 1: Add catalog read models and repository methods

Add frontend-safe TypeScript interfaces in `packages/core/src/listing-cache`
for:

- `AccommodationSummary`
- `AccommodationDetail`
- `AccommodationSearchInput`
- `AccommodationListResult`

Add repository methods:

- `listActiveAccommodations(input)` with filters for `city`, `country`,
  `minGuests`, `page`, `pageSize`, and optional `includeStale`.
- `getActiveAccommodationByExternalId(externalId, options)`.
- Optional `searchActiveAccommodations(input)` if full-text-like matching is
  needed initially; keep it simple with `ilike` over `name`, `nickname`, `city`,
  and `country`.

Response rules:

- Never return `raw`.
- Return `processed` and selected normalized/public scalar columns.
- Include `isStale` and `staleAfter`.
- Cap `pageSize` to a small maximum, for example 50.

**Verify**: `bun run --filter @workspace/core test` -> existing tests still pass.

### Step 2: Add repository tests with a fake DB or focused mapper tests

Follow the existing Bun test style in
`packages/core/src/listing-cache/hostify-sync.test.ts`. If testing Drizzle SQL
directly would require a live database, split pure mapping and input validation
into small functions and test those. Cover:

- inactive listings are excluded by default;
- stale listings are excluded unless `includeStale` is true;
- page/pageSize are clamped;
- raw provider payload is not present in returned DTOs.

**Verify**: `bun run --filter @workspace/core test` -> all tests pass.

### Step 3: Add public API routes

Create route handlers using `withApiRoute`:

- `GET /api/accommodations`
- `GET /api/accommodations/[id]`

Use query params for search filters and pagination. Use `Response.json` with a
consistent envelope:

```ts
{ data: ..., meta: { page, pageSize, hasMore } }
```

For detail:

- Return `404` when no active listing is found.
- Include freshness metadata so the UI can show unavailable/stale states later.
- Use `rateLimit: { bucket: "default" }` unless a more specific existing bucket
  exists.

Before writing route code, honor `AGENTS.md`: read the relevant local Next docs
if `node_modules/next/dist/docs/` exists. If it does not exist, STOP only if the
route-handler API in this repository is unclear; otherwise match the existing
route files.

**Verify**: `bun run --filter web typecheck` -> exit 0.

### Step 4: Emit useful observability names

Name routes clearly in `withApiRoute`, for example:

- `accommodations.list`
- `accommodations.detail`

Do not manually write observability rows unless there is a specific business
event. The wrapper already emits request/rate-limit/error events.

**Verify**: `bun run typecheck` -> exit 0.

## Test plan

- Add core tests for DTO mapping, stale filtering, and pagination clamping.
- Add route-level tests only if the app already has a route test pattern; if not,
  keep this plan to core tests plus `web` typecheck.

## Done criteria

- [ ] `GET /api/accommodations` returns paginated active cached listings without
  provider raw payloads.
- [ ] `GET /api/accommodations/[id]` returns one active cached listing or `404`.
- [ ] DTOs expose stable frontend fields and freshness metadata.
- [ ] `bun run --filter @workspace/core test` exits 0.
- [ ] `bun run --filter web typecheck` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- The live schema no longer has `accommodationListing` or its JSON columns.
- Implementing search requires a new database extension or migration.
- A route needs to call Hostify to satisfy this plan.
- The frontend response shape would require exposing `raw`.

## Maintenance notes

This API becomes the frontend contract. Reviewers should scrutinize response
shape stability, pagination behavior, and accidental leakage of provider raw
payloads. Live price and availability do not belong here; they are covered by
Plan 003.
