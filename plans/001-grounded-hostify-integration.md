# Plan 001: Build Hostify around its documented PMS contract

> **Executor instructions**: This is the master Hostify roadmap, not one large
> implementation PR. Complete Phase 0 first, record its evidence, and then split
> each later phase into a separately reviewed implementation plan. Run every
> verification gate and confirm the expected result before moving on. If any
> STOP condition occurs, stop and report instead of improvising.
>
> **Drift check (run first)**:
> `git diff dcb678d..HEAD -- docs/data-architecture.md docs/hostify apps/api apps/web packages/* turbo.json`
> If these paths changed since the plan was written, compare the current state
> and capability evidence below against the live files before proceeding.

## Status

- **Priority**: P1
- **Effort**: L, delivered as multiple phases and PRs
- **Risk**: HIGH, because reservation, payment-adjacent, calendar, and listing
  mutations can affect live inventory and guests
- **Depends on**: none
- **Category**: direction / architecture
- **Planned at**: commit `dcb678d`, 2026-06-15

## Why this matters

The prior architecture correctly identified Hostify as the authority for
accommodation data, but it was written before the detailed API documentation
under `docs/hostify/` was available. It therefore understates what the API can
manage, leaves some legacy behavior unnecessarily in place, and treats several
unknowns as support questions rather than explicit implementation gates.

Hostify exposes a broad property-management surface, but the documentation is
not a complete guarantee of account behavior. It documents powerful mutations,
yet omits reservation idempotency and hold-expiry semantics, has limited webhook
event coverage, contains inconsistent field names and money shapes, and marks
some features as account-dependent or unavailable. The integration must use the
documented surface without making Hostify authoritative for Alojamento Ideal
orders, Stripe payments, or Portuguese fiscal compliance.

## Executive decisions

1. **Use Hostify as PMS authority, not commerce authority.**
   Hostify owns listing configuration, live calendar state, live quotes,
   reservations, provider inbox state, and Hostify-side transactions. PostgreSQL
   owns Alojamento Ideal orders, idempotency, workflow state, audit history,
   payment allocation, and compensation.
2. **Start with PostgreSQL plus Redis/Valkey, not PostgreSQL plus MongoDB plus
   Redis/Valkey.**
   Store the Hostify catalog projection in PostgreSQL using typed query fields
   plus sanitized `jsonb`. Add MongoDB later only if measured document/query or
   scaling needs justify another operational datastore.
3. **Keep public commerce, staff operations, and sensitive projections as
   separate surfaces.**
   A public quote flow must not imply permission to update calendars, listings,
   users, access codes, or guest documents.
4. **Treat documented write capability as opt-in.**
   Every Hostify mutation requires an internal command ID, audit record,
   explicit authorization, and a reconciliation path. Never blindly retry a
   mutation whose outcome is unknown.
5. **Use webhook plus reconciliation, not webhook-only or polling-only.**
   Hostify documents eight SNS notification types, but no events for calendar,
   transactions, invoices, reviews, guests, or online check-in.

## Current state

### Repository state

- `apps/web` is a Next.js application with Better Auth integration, Bokun and
  Hostify API clients, and a listing cache system.
- `packages/db` provides PostgreSQL access via Drizzle ORM with pg driver and
  typed schema migrations.
- `packages/core` contains Bokun and Hostify integration modules with typed
  clients, retry logic, and listing cache sync with OpenAI processing.
- Database migrations exist for listings, sync runs, amenities, and related
  tables.
- Redis/Valkey client and queue/worker implementation are not yet present.
- CI runs `bunx biome ci .`, `bun run typecheck`, `bun run test`, and
  `bun run build`.

### Previous architecture assumptions that need correction

- `docs/data-architecture.md:582-609` says detailed Hostify endpoint and
  webhook contracts still need to be obtained. The downloaded HTML now
  documents most endpoint shapes, global pagination/filtering, API-key scopes,
  and the available webhook event names.
- `docs/data-architecture.md:1330-1339` assumes unknown webhook coverage.
  Coverage is now known to be limited to `message_new`, `move_reservation`,
  `new_reservation`, `update_reservation`, `create_listing`, `update_listing`,
  `create_update_listing`, and `listing_photo_processed`.
- `docs/data-architecture.md:145-150` records that the legacy Hostify webhook is
  a no-op, messages are imported by polling, and locally written messages are
  not sent to Hostify.
- `docs/data-architecture.md:203-241` records that legacy provider reservations
  and transactions are created before durable local order persistence.
- `docs/data-architecture.md:323-350` records that reservation acceptance and
  transaction completion can run in parallel, allowing Hostify financial state
  to say completed when reservation acceptance failed.
- `docs/data-architecture.md:48-56` records parallel provider-ID arrays and live
  provider reads during page rendering.

### Hostify contract facts

- All calls use HTTPS JSON and `x-api-key`; documented key templates include
  full access, full read-only, and dynamic pricing
  (`docs/hostify/hostify_api_webpage.htm:781-878`).
- Global list parameters include `page`, `per_page`, and a reusable filter
  object with comparison operators
  (`docs/hostify/hostify_api_webpage.htm:787-857`).
- The API documents normal failure codes but no rate-limit contract or `429`
  behavior (`docs/hostify/hostify_api_webpage.htm:12181-12221`).
- Reservation creation supports `accepted` and `pending`, but the docs conflict:
  they say omission creates `accepted` while also showing `pending` as a
  default. Always send an explicit status and prove behavior in Phase 0
  (`docs/hostify/hostify_api_webpage.htm:9594-9607`).
- Reservation creation exposes `skip_restrictions`; public checkout must always
  send or enforce `false` (`docs/hostify/hostify_api_webpage.htm:9680-9691`).
- Hostify documents Amazon SNS subscription confirmation and eight notification
  types, but the downloaded create-notification section omits the HTTP request
  method/URL and does not document notification payload schemas, retry policy,
  or ordering (`docs/hostify/hostify_api_webpage.htm:10187-10334`).
- Calendar advanced pricing features may be disabled per account
  (`docs/hostify/hostify_api_webpage.htm:1381-1383`).
- CTA/CTD updates replace all existing restrictions in one call, so they need a
  read-diff-write workflow (`docs/hostify/hostify_api_webpage.htm:2215-2220`).
- Seasonal promotions are explicitly marked beta and unavailable
  (`docs/hostify/hostify_api_webpage.htm:10622`).
- Hostify responses use floats for money and inconsistent field naming, for
  example `checkIn`/`checkOut` on reads versus `check_in`/`check_out` on writes,
  and `is_competed` in the transaction schema versus `is_completed` in the
  example. Use endpoint-specific runtime schemas and preserve sanitized raw
  payloads.

## What the API can realistically manage

The status column is a product/implementation decision, not merely whether an
endpoint exists.

| Capability | Evidence | Realistic use | Status |
|---|---|---|---|
| Listing catalog, translations, photos, restrictions, fees, and status reads | `GET /listings`, `/listings/{id}`, translations, photos, fees, restrictions | Build a durable public catalog projection and staff detail views | Build early |
| Available listing search | `GET /listings/available` with dates and guests | Discovery aid; still revalidate listing-specific quote before checkout | Build early |
| Live price and availability | `GET /listings/price`, `GET /calendar` | Short-lived quote/availability cache; fail closed at checkout | Build early |
| Reservation reads and filtered reconciliation | `GET /reservations`, `GET /reservations/{id}` with date/status filters and optional fees | Booking projection, support, and repair jobs | Build early |
| Reservation create/update | `POST /reservations`, `PUT /reservations/{id}` | Direct booking after Phase 0 proves pending behavior; explicit status only | Blocked by Phase 0 |
| Reservation custom fields | Reservation custom-field read/update plus global custom-field management | Store an Alojamento Ideal public order reference after creation to improve reconciliation | Build with booking |
| Hostify transactions | Transaction read/create/update and tags; external transaction ID can reference Stripe | Project Hostify-side financial records; never treat them as Stripe payment truth | Build with booking |
| Inbox read, assign, reply, and image reply | `GET /inbox`, `GET /inbox/{id}`, `/inbox/assignee`, `/inbox/reply`, `/inbox/reply_image` | Replace local-only outgoing messages and broad polling | Build after events |
| Inquiry actions | Accept, decline, pre-approve, and special offer endpoints | Staff-only channel operations with audit and provider-specific validation | Later, staff-only |
| SNS notifications | Eight documented event names | Targeted refresh/invalidation plus durable event intake | Build early |
| Calendar pricing and availability writes | Single and bulk calendar updates; min stay, CTA/CTD, LOS and minimum booking value where enabled | Staff revenue/operations tools with preview, diff, audit, and rollback data | Later, staff-only |
| Custom stay and CTA/CTD rules | Read/write rule endpoints | Staff restriction management; CTA/CTD requires full-replacement safety | Later, staff-only |
| Listing content/fees/photos/translations writes | Multiple listing mutation endpoints | Optional PMS administration after authorization and audit are mature | Later, staff-only |
| Listing creation, clone, channel list/unlist, deletion | Multi-step create, clone jobs, channel status, delete-with-children | Separate high-risk operations product; never part of initial rewrite | Defer |
| Access codes, guest guide, lock pin | Listing/reservation mutation/read endpoints | Sensitive staff workflows only; do not cache in general projections | Defer/separate design |
| Reviews | Read-only get/list | Public review projection or staff reporting | Optional |
| Guests | Read-only get/list | Support lookup only; no guest editing capability is documented | Optional/read-only |
| Online check-in | Read-only existing check-in, agreement, guest, and attachment data | Import minimal completion metadata; fetch documents only for authorized, explicit workflows | Optional/sensitive |
| Accounting invoices, companies, counterparties | Invoice/company/counterparty reads and invoice external metadata update | Reconciliation/reporting only; does not replace fiscal issuance/credit-note workflows | Optional/read-only |
| Users and roles | User activation, role assignment, listing assignment | Hostify account administration, outside the initial product scope | Defer |
| Payment data/payment request | Attach Stripe customer and request Hostify-side charges/authorizations | Potentially conflicts with the app-owned Stripe flow; do not use without a separate payment decision | Defer |
| Seasonal promotions | Endpoints under a section marked unavailable | None until Hostify enables and supports the feature | Do not build |

## What remains unknown or unsupported

These are hard boundaries, not assumptions to fill in during implementation:

- No documented reservation idempotency key or external-reference field exists
  on reservation creation.
- The docs do not state whether `pending` reserves inventory, how long it holds,
  or how it expires.
- No API rate limits, timeout guidance, sandbox guarantees, or mutation retry
  semantics are documented.
- Webhook payload schemas, delivery retries, ordering, and account-specific
  topic behavior are not documented.
- The create-notification method/URL is missing from the downloaded page.
- No webhooks are documented for calendar, prices, transactions, invoices,
  reviews, guests, or online check-in.
- Guest records and online check-in submissions are read-only in the documented
  API.
- Hostify accounting does not document invoice or credit-note creation, so it
  does not replace Hostkit or another Portuguese-compliant fiscal provider.
- Seasonal promotions are unavailable.
- Advanced calendar pricing is account-dependent.
- Listing creation is a multi-step API and is not proven safe or complete for
  this account.

## Improvements over the legacy and previous plan

### Simplify the data architecture

Use PostgreSQL for both commerce records and the first Hostify catalog
projection:

- typed columns for fields used in filtering, joining, state machines, and
  public responses;
- sanitized `jsonb` for the provider-shaped remainder;
- a `sync_run_id`/seen marker so a failed paginated full sync cannot deactivate
  listings incorrectly;
- Redis/Valkey only for short-lived quotes, availability, rate-limit state, and
  locks.

This keeps order, booking, event, command, and catalog reconciliation in one
transactional datastore. Do not add MongoDB until a measured requirement
outweighs the operational and consistency cost.

### Replace direct provider reads

- Serve public listing search/detail from the PostgreSQL projection.
- Call Hostify live only for availability, quote, checkout validation, explicit
  staff refresh, and operational commands.
- Cache calendar and quote responses for 30-60 seconds, keyed by all inputs and
  an explicit expiry. Never use stale values to create a reservation.

### Replace polling-only and no-op webhooks

- Validate Amazon SNS signatures and the optional Hostify `auth` value before
  durable event insertion.
- Allow subscription confirmation only for validated SNS messages and an
  allowlisted AWS SNS `SubscribeURL`; never make an arbitrary URL request.
- Deduplicate on SNS `MessageId`.
- Route the eight documented event types to targeted refresh jobs.
- Retain scheduled reconciliation for everything without webhook coverage.

### Fix messaging

- Inbound: consume `message_new`, fetch the affected thread, and upsert messages
  by Hostify message ID.
- Outbound: send staff/guest messages through `POST /inbox/reply`; store local
  delivery state and Hostify's returned ID.
- Do not use `receive_reply` as the normal inbound path. It imports a message
  into Hostify and requires a caller-supplied unique channel/system message ID.
- Keep a low-frequency repair poll for open conversations because webhook
  delivery semantics are incomplete.

### Make checkout durable before provider mutation

- Persist the internal order and item records before creating a Hostify
  reservation.
- Revalidate live price and availability immediately before the command.
- Always send `status: "pending"` and `skip_restrictions: false`; stop if Phase
  0 cannot prove that pending safely reserves inventory.
- Serialize reservation confirmation and Hostify transaction completion.
  Transaction completion must not happen when reservation acceptance fails.
- Link each Hostify reservation and transaction directly to its internal order
  item. Never map by array position.
- After successful reservation creation, set a dedicated reservation custom
  field containing the non-sensitive Alojamento Ideal public order reference.
- Use a local uniqueness lock and post-failure reconciliation because Hostify
  reservation idempotency is undocumented. Never automatically retry a timed-out
  create call.

### Harden the connector boundary

- Use a full read-only key for synchronization and read projections, a dynamic
  pricing key if it satisfies quote/calendar reads, and a separately stored
  full-access key only for approved mutations.
- Define endpoint-specific request/response schemas. Do not share one loose
  `HostifyReservation` type across list, detail, create, and update endpoints.
- Convert provider monetary values to integer minor units only with a known
  ISO currency and explicit decimal conversion; preserve the sanitized raw
  value for reconciliation.
- Retry idempotent reads on bounded transport/`503` failures with jitter. Do not
  retry writes unless a specific endpoint is proven idempotent.
- Redact API keys, access codes, lock pins, guest document data, and signed
  asset URLs from logs and general raw payloads.

### Isolate high-risk PMS operations

Calendar, restriction, listing, fee, photo, user, access-code, and listing
deletion operations must use staff-only commands with:

- role-based authorization;
- a before snapshot and human-readable diff;
- dry-run/preview when practical;
- an explicit command idempotency key;
- durable audit and result records;
- targeted reconciliation after success or uncertain outcome;
- separate approval for destructive operations.

## Target data model adjustments

Keep the normalized commerce model proposed in `docs/data-architecture.md`, with
these Hostify-specific adjustments:

| Record | Required Hostify-specific fields/behavior |
|---|---|
| `provider_connections` | Secret references per scope/purpose, account ID, enabled capabilities proven by Phase 0, rate-limit configuration, and last successful probe |
| `hostify_listings` or generic catalog projection | Typed public/query fields, sanitized `raw_payload jsonb`, content hash, projection version, active flag, last seen sync run, last provider refresh |
| `provider_bookings` | Hostify reservation ID, confirmation code, inbox/thread ID, exact provider status, normalized status, check-in/out dates, listing ID, public order reference custom-field state, last synced timestamp |
| `provider_financial_records` | Hostify transaction ID, linked booking, external transaction ID, exact completion state, amount/currency, and reconciliation status |
| `integration_events` | SNS `MessageId` as external event ID, `TopicArn`, event type, signature validation result, optional-auth validation result, redacted headers/body, processing state |
| `outbox_events` | One durable command per Hostify mutation with a stable internal idempotency key and uncertain-outcome state |
| `conversations` / `messages` | Hostify thread/message IDs, send channel, local delivery state, provider delivery result, and dedupe constraints |
| `sync_runs` | Sync family, page progress, started/completed state, counts, and a safe activation/deactivation generation |
| sensitive check-in storage | Completion metadata by default; guest documents/attachments only in a separately authorized, encrypted, short-retention store |

Do not persist access codes, lock pins, full check-in attachments, private owner
details, or unrestricted raw provider payloads in the general catalog
projection.

## Public, staff, and internal API boundaries

### Public API

- `GET /v1/accommodations`
- `GET /v1/accommodations/:id`
- `POST /v1/accommodations/:id/quote`
- `POST /v1/orders`
- `GET /v1/orders/:publicReference`
- `POST /v1/orders/:id/cancel`
- guest-detail endpoints only after the Hostify/Hostkit ownership decision

Public routes never expose Hostify IDs as authorization boundaries and never
proxy arbitrary Hostify operations.

### Staff API

- provider refresh and reconciliation requests;
- conversation/thread views and replies;
- reservation support actions;
- later, previewed/audited calendar and listing operations;
- optional reviews, invoices, and check-in completion views.

Every staff mutation is authorized and audited. Access-code, user-role, listing
delete, clone, channel-list, and payment-request operations require separate
design approval.

### Internal API

- Hostify SNS webhook intake;
- worker command handlers;
- scheduled full/recent reconciliation;
- health/capability probes that never expose credentials or sensitive payloads.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exits 0 without changing `bun.lock` |
| Lint/format check | `bunx biome ci .` | exits 0 |
| Typecheck | `bun run typecheck` | exits 0, no TypeScript errors |
| Tests | `bun run test` | exits 0, all tests pass |
| Build | `bun run build` | exits 0 |
| Plan/document check | `git diff --check` | exits 0, no whitespace errors |

Before writing any Next.js code, read the relevant guide under
`node_modules/next/dist/docs/` as required by `AGENTS.md`. If that path is not
present after `bun install --frozen-lockfile`, stop and resolve the dependency
layout instead of relying on remembered Next.js behavior.

## Suggested executor toolkit

- Use the `backend-patterns`, `elysiajs`, `security-review`, and `typescript`
  skills when creating the API connector and routes.
- Use the `postgres-patterns` skill when selecting the initial PostgreSQL schema
  and indexes.
- Use the `bullmq-specialist` skill only if BullMQ is deliberately selected
  after comparing it with a PostgreSQL outbox worker. Do not add it by default.
- Treat `docs/hostify/hostify_api_webpage.htm` as the primary local Hostify
  contract reference and preserve account-probe fixtures separately.

## Scope

### In scope for this roadmap

- Hostify contract validation and capability recording.
- Hostify API client and runtime schemas in `apps/api`.
- PostgreSQL catalog/booking/event/command projections and Redis live caches.
- Public read/quote flow, booking workflow, webhooks, reconciliation, messaging,
  and carefully gated staff operations.
- Tests and operational observability for every implemented capability.
- Updating `docs/data-architecture.md` after Phase 0 with proven facts and the
  approved PostgreSQL-first decision.

### Out of scope

- Bokun, Stripe, and Hostkit implementation except where defining their
  ownership boundary is required.
- Replacing Stripe with Hostify payment requests.
- Replacing Portuguese fiscal/guest-reporting workflows with Hostify without
  separate legal and provider confirmation.
- Seasonal promotions.
- Initial support for Hostify users/roles, access codes, lock pins, listing
  delete/clone/channel-list operations, or full listing creation.
- Persisting sensitive check-in documents by default.
- Adding MongoDB without a measured and approved need.

## Git workflow

- Create one branch and reviewed PR per phase or smaller coherent slice; do not
  implement this roadmap in one branch.
- Branch names: `feat/hostify-<phase-or-capability>`.
- Match the repository's conventional commit style, for example
  `feat: add API and shared UI system`.
- Do not push or open a PR unless the operator instructs it.

## Delivery phases

### Phase 0: Prove the account-specific contract

Create a non-production contract probe and record a capability matrix under
`docs/hostify/`. Use read-only keys and safe GET requests first. Run mutation
probes only against a Hostify-approved sandbox or explicitly designated test
listing/reservation.

The matrix must record for each planned endpoint:

- required scope/key;
- actual request and response fixture with secrets/PII removed;
- pagination and filtering behavior;
- timeout/error behavior;
- account capability enabled/disabled;
- whether the endpoint is safe for production use;
- owner and reconciliation strategy.

Explicitly resolve:

1. Whether `pending` holds inventory, for how long, and how it expires.
2. Reservation create idempotency/external-reference support.
3. Whether a reservation custom field can reliably store the app public order
   reference after creation.
4. The missing create-notification method/URL, actual SNS payloads, signature
   verification, retries, ordering, topic behavior, and optional `auth` field.
5. API rate limits and `429` behavior per key/scope.
6. Stable pagination/full-sync behavior and available incremental filters.
7. Money units, rounding, and currency on listing price, reservation fees, and
   transactions.
8. Which advanced calendar fields are enabled.
9. Whether online check-in and Hostify invoices have any role beyond read-only
   projections for this account.

**Verify**:
Each of the following searches must find a redacted, account-specific conclusion
in `docs/hostify`:
- `rg -n "pending" docs/hostify`
- `rg -n "idempot" docs/hostify`
- `rg -n "rate limit" docs/hostify`
- `rg -n "webhook" docs/hostify`
- `rg -n "SNS" docs/hostify`
- `rg -n "currency" docs/hostify`
- `rg -n "calendar" docs/hostify`
- `rg -n "check-in" docs/hostify`
- `rg -n "invoice" docs/hostify`

**Gate**: Do not begin production reservation creation until items 1-3 are
resolved. Do not expose webhook-driven state as reliable until item 4 is
resolved.

### Phase 1: Establish the connector and data foundation

Select the PostgreSQL access/migration library, Redis client/service, and worker
runtime in a separate decision record. Then create a Hostify integration module
in `apps/api` with:

- scoped credential configuration using secret references;
- endpoint-specific request/response schemas;
- bounded timeouts and read-only retry policy;
- normalized errors and redacted structured logs;
- request correlation IDs and metrics;
- a raw-response fixture test for every implemented endpoint;
- PostgreSQL migrations for provider connections, listing projections,
  bookings, financial records, events, outbox commands, conversations/messages,
  and sync runs.

Do not expose generic `request(method, path, body)` behavior outside the
integration module. Callers must use named, typed operations.

**Verify**: full CI passes, connector fixture tests cover success, documented
error, malformed response, timeout, and redaction behavior, and no test contacts
the live Hostify API.

### Phase 2: Build the read model and live quote path

Implement:

- paginated full listing sync with safe seen-generation handling;
- listing detail, translations, photos, fees, and restriction projection;
- public listing search/detail from PostgreSQL;
- live `listings/available`, calendar, and listing-price calls behind a
  short-lived Redis cache;
- explicit quote expiry and input hashing;
- a reconciliation job that detects projection drift without deactivating data
  after a partial sync failure.

Because no listing-updated filter is documented, do not claim that the sync is
incremental solely from pagination. Use listing webhooks for targeted refresh
and periodic full reconciliation.

**Verify**: a provider outage fixture still serves the last safe catalog
projection; expired or unavailable live quotes fail closed; a failed paginated
sync does not deactivate unseen listings.

### Phase 3: Implement durable direct booking

Implement a saga that:

1. Creates the internal order/item and command records idempotently.
2. Revalidates Hostify availability and quote.
3. Creates a Hostify reservation with explicit `pending` and
   `skip_restrictions: false`.
4. Immediately records the response against the order item.
5. Sets the app public order reference custom field when proven supported.
6. Creates/updates the Hostify transaction only through a durable worker.
7. Confirms reservation and transaction state after Stripe success in an
   ordered, observable workflow.
8. Reconciles uncertain outcomes instead of retrying reservation creation.
9. Compensates or escalates partial failures.

**Verify**: tests cover duplicate order requests, timeout after unknown Hostify
create outcome, quote expiry, unavailable inventory, reservation acceptance
failure, transaction update failure, Stripe success replay, and compensation.
No test permits transaction completion after failed reservation acceptance.

### Phase 4: Implement SNS intake and reconciliation

Implement a Hostify-specific SNS webhook endpoint that:

- reads the raw body;
- validates SNS signature and Hostify optional auth;
- validates/allowlists subscription confirmation URLs;
- stores an `integration_events` row deduplicated by SNS `MessageId`;
- acknowledges quickly after durable storage;
- asynchronously routes the eight documented event names;
- records unknown event types without executing them.

Route listing events to targeted listing refresh, reservation events to booking
refresh and availability invalidation, and `message_new` to thread refresh.
Schedule periodic reconciliation for reservations, listings, messages, and all
domains without webhook coverage.

**Verify**: fixture tests cover valid/invalid SNS signatures, duplicate
`MessageId`, malicious `SubscribeURL`, invalid optional auth, every documented
event type, unknown event type, and worker retry/dead-letter behavior.

### Phase 5: Replace legacy messaging behavior

Implement thread/message projections and staff reply commands:

- fetch/upsert thread history on `message_new`;
- deduplicate messages by Hostify message ID;
- send outbound text through `/inbox/reply`;
- support image reply only after file type/size validation and explicit need;
- persist pending/sent/failed delivery state;
- retain a repair poll for open conversations;
- add staff assignment only after Hostify user mapping is defined.

Do not route normal inbound messages through `/inbox/receive_reply`.

**Verify**: tests prove duplicate webhooks/messages do not duplicate local
messages, successful replies store the returned Hostify ID, failed/uncertain
replies remain retryable only through an explicit staff action, and unsupported
image payloads are rejected before Hostify is called.

### Phase 6: Add selected staff PMS operations

Start only with operations that have a real product owner and rollback/recovery
story. Recommended first candidates:

1. calendar price/availability/min-stay changes;
2. CTA/CTD restrictions with mandatory read-diff-confirm-write;
3. listing translations and guest guide;
4. listing fee updates.

Each command requires RBAC, preview, audit, internal idempotency, before/after
snapshots, and reconciliation. Keep listing delete, clone, channel list/unlist,
user/role, access code, lock pin, and payment-request operations out of scope.

**Verify**: authorization tests, audit tests, stale-before-snapshot rejection,
CTA/CTD full-replacement safety tests, uncertain-outcome handling, and a
post-command reconciliation test all pass.

### Phase 7: Add optional read-only projections

Only after the booking and messaging paths are stable, evaluate:

- public/staff reviews;
- Hostify invoice/company/counterparty reconciliation;
- guest support lookup;
- online check-in completion metadata.

Do not fetch or store guest document attachments or signatures by default.
Do not claim that Hostify invoices replace Portuguese fiscal workflows.

**Verify**: privacy review is recorded, least-privilege authorization tests
pass, sensitive fields are absent from general logs/projections, and retention
jobs are tested before any sensitive data is persisted.

## Test plan

Every implementation phase must add:

- unit tests for endpoint-specific schemas, normalization, money/date handling,
  error mapping, and redaction;
- connector fixture tests using sanitized Hostify responses;
- integration tests for PostgreSQL idempotency, event dedupe, outbox commands,
  and reconciliation;
- failure-path tests for timeouts and uncertain mutation outcomes;
- authorization and audit tests for every staff mutation;
- no live-provider tests in the normal CI suite.

Create a separately invoked, non-production contract test suite for Phase 0 and
ongoing provider drift detection. It must require explicit environment
configuration and default to read-only behavior.

## Done criteria

This roadmap is fully delivered only when all are true:

- [ ] Phase 0 capability matrix exists with every unknown resolved or explicitly
  marked as a blocker/unsupported.
- [ ] Public catalog reads use the local PostgreSQL projection.
- [ ] Live quotes/availability expire and fail closed.
- [ ] Orders persist before Hostify reservation creation.
- [ ] Reservation creation uses explicit `pending` and never skips restrictions.
- [ ] Unknown reservation-create outcomes reconcile without blind retry.
- [ ] Hostify transaction completion cannot race ahead of reservation
  acceptance.
- [ ] SNS intake validates signatures/auth, deduplicates `MessageId`, and routes
  all eight documented events.
- [ ] Reconciliation covers domains without webhooks.
- [ ] Outbound messages are actually sent through Hostify and have delivery
  state.
- [ ] Staff PMS mutations are authorized, previewed, audited, and reconciled.
- [ ] Sensitive access/check-in data is excluded from general projections/logs.
- [ ] `bunx biome ci .`, `bun run typecheck`, `bun run test`, and
  `bun run build` all exit 0.
- [ ] `docs/data-architecture.md` reflects the proven Hostify contract and
  approved datastore decisions.

## STOP conditions

Stop and report instead of improvising if:

- Hostify cannot confirm or prove that `pending` safely reserves inventory for
  the intended checkout duration.
- A safe method to reconcile unknown reservation-create outcomes cannot be
  established.
- Production Hostify mutation testing is the only available way to discover
  account behavior.
- SNS signature verification or safe subscription confirmation cannot be
  implemented from verified AWS/Hostify behavior.
- A planned endpoint is unavailable for the account or requires a broader API
  key than approved.
- Correct money normalization cannot be proven from an ISO currency and account
  fixtures.
- A phase requires persisting access codes, lock pins, guest identity
  documents, signatures, or unrestricted raw payloads without a separate
  privacy/security design.
- A step requires adding MongoDB without measured evidence and an approved
  decision record.
- Implementation requires touching an out-of-scope provider integration.
- A verification gate fails twice after a reasonable fix attempt.

## Maintenance notes

- Re-run the contract suite when Hostify documentation, account scopes, or
  enabled modules change.
- Reviewers should scrutinize every new write endpoint for unknown-outcome
  behavior, authorization, audit, and reconciliation before business logic.
- Keep endpoint schemas separate even when payloads look similar; the downloaded
  documentation already demonstrates naming and shape drift.
- Treat new Hostify webhook types as untrusted/ignored until fixtures and
  handlers are explicitly added.
- Reconsider MongoDB only with measured PostgreSQL limitations, not because the
  provider payload is JSON.
- Any proposal to use Hostify payment requests, invoices, check-in attachments,
  users/roles, access codes, listing deletion, or listing cloning requires a
  separate plan and risk review.
