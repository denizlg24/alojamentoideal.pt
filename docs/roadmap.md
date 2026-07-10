# App Build Roadmap

This is the recommended build order for Alojamento Ideal as an end-to-end app.
The goal is to move from backend foundations to a usable customer booking flow,
then into operations, automation, and polish.

## Status (as of 2026-07-10)

Legend: ✅ done · 🟡 in progress / partial · ⬜ not started

| # | Milestone | Status | Notes |
|---|---|---|---|
| 0 | Foundations (cache, sync, platform) | ✅ | Hostify incremental sync cron, content processing, and the `accommodation_listing` projection with FTS + trigram + geo search index. Rate limiting (Redis) and observability (Sentry errors + PostgreSQL analytics) wired through `withApiRoute`. LLM localization backfill + one-run sync script and env-driven listing sync version landed post-M6. |
| 1 | Catalog Browsing | ✅ | Catalog read API done: `GET /api/catalog/listings` (filter/sort/paginate) and `/api/catalog/listings/[externalId]` (localized detail), with Next.js `use cache` + cron-driven `revalidateTag` invalidation. Frontend: `/homes` grid, filter bar (dates/guests/rooms/rating/amenities), and Leaflet map. Detail page (`/homes/[id]`) shipped with gallery + full-screen gallery route, amenities dialog, reviews (synced via cron), location map, share button, room/sleeping layout, and skeleton fallbacks. |
| 2 | Live Availability and Quote | ✅ | Detail-page booking widget runs live Hostify quotes via `POST /api/accommodations/quote` (`AccommodationQuoteService`, Redis short-lived quote cache w/ `forceFresh` bypass), debounced + stale-abort. Availability calendar from `/api/accommodations/calendar`, date/guest pickers, guest-type/tax overhaul, min-stay + capacity enforcement, price breakdown (fees + VAT), and clear unavailable/provider-error states. |
| 3 | Cart and Checkout Shell | ✅ | Backend (DB-backed multi-item cart/order schema, `CommerceService`, idempotent cart mutations, cart validation, draft-order conversion over N items) plus the multi-booking cart frontend (this branch): one persistent shared cart per browser, a live header cart badge, the `/cart` page with per-item date/guest edits and removal, add-to-cart from the booking widget, and a cart-driven `/checkout` that purchases several stays in one payment ("Reserve" seeds its stay into the same cart). Emails, completion page and the order hub render every stay on the order. Activities later joined the same cart in M9 (mixed stay and activity checkout). |
| 4 | Payment Foundation | ✅ | Stripe PaymentIntent created from the server-side order total (never client-submitted), one idempotent intent per draft order, retry-safe card failures, `payment_intent.succeeded` / `payment_failed` webhook handling, a Stripe refund helper, and reconciliation from live PaymentIntent state when a webhook never arrives. One-round-trip payment prep (`/api/checkout/prepare-payment`) with the provider hold placed immediately before Stripe confirmation. |
| 5 | Provider Reservation Saga | ✅ | Reserve-first saga shipped: a Hostify hold is placed before any charge, confirmed on payment success (with a re-read verifying the accept actually settled — an accepted echo on a still-pending reservation no longer confirms), compensated (auto full refund) on permanent confirm failure / amount mismatch, reconciler cron (`/api/cron/commerce/reservations`) as durability authority, bounded retry/backoff, provider-keyed gateway, idempotent reconciliation email. Remaining debt: DB-integration saga tests and registering the cron in the external scheduler (see Open debt). |
| 6 | Customer Order Experience | ✅ | Order hub at `/order/[reference]` (overview, stay details, guests, messages) with role-scoped access (owner vs member), booking-access tokens, member invites/revoke/resend, and realtime updates. Completion page surfaces held → pending → confirmed → refunded states. Confirmation, pending-confirmation, "could not confirm / refunded", amount-mismatch, and invite emails fire from durable saga state via Maizzle-branded templates. |
| 7 | Admin Operations | ✅ | `apps/admin` (own Better Auth mount, root-admin seed at build, admin/owner role access): orders list + order detail with saga accept/cancel, per-reservation Hostify management, manual partial refunds with attribution (incl. Detours transfer reversals), semi-manual invoicing + credit notes, guest roster edits, and admin live chat (Hostify-bridged + internal conversations). Reconciliations overview (stuck orders, refunds, guest-submission jobs with resubmission), sync status table + manual resync, runtime settings, observability page, users page, and the Detours settlement report. |
| 8 | Guest Registration and Compliance | 🟡 | Per-booking guest roster with encrypted identity data, Stripe Identity verification (or account-identity reuse), residency capture, and guest invite flows shipped as part of the order hub. Hostkit/SIBA submission shipped (2026-07-03): typed Hostkit client, durable `guest_submission_jobs` processed by `/api/cron/commerce/guest-submissions` (validateSIBA always; sendSIBA behind `HOSTKIT_SIBA_SEND_ENABLED`). Failed jobs are visible and resubmittable from the admin reconciliations page. Remaining: retention/purge rules and the `sendSIBA` business sign-off. |
| 9 | Activities and Mixed Cart | ✅ | `/activities` browse + detail + gallery from the Bokun cache (daily self-gated sync via `/api/cron/bokun/activities`, `revalidateTag` on change), single-day booking widget with live pricing, add-to-cart and single-activity checkout (pickup/dropoff + Bokun booking questions collected before payment, `RESERVE_FOR_EXTERNAL_PAYMENT` hold), mixed stay+activity carts with Stripe `transfer_data.amount` money split and `reverse_transfer` refunds, order-hub activity page (live Bokun reads, question edits, PDF tickets), and cancellation policies surfaced on home + activity pages. |
| 10 | Fiscal Documents, Messaging, Post-Stay | 🟡 | Guest↔host messaging shipped: per-booking conversations bridged to Hostify inbox (send/retry/reconcile cron + realtime UI in the order hub), plus provider-`internal` conversations and the admin live-chat counterpart. Invoice/credit-note issuance via Hostkit now has its admin UI (semi-manual issuance, product combobox, credit notes) recorded in `order_invoices`, still gated behind `HOSTKIT_INVOICING_ENABLED`. Post-stay: refund reconciler cron (`/api/cron/commerce/refunds`) and the Detours settlement report shipped; broader post-stay reconciliation not started. |
| 11 | Analytics and Optimization | 🟡 | Per-request analytics events persisted to PostgreSQL and errors to Sentry. Durable-state booking events (`reservation_provisioned`, `order_confirmed`, `order_compensated`) emitted from the saga; the broader commercial funnel (search → view → quote → checkout → payment) is still partial. |

Current focus: with M7 (admin operations) and M9 (activities + mixed cart)
merged, the remaining work is release readiness, not features. The launch
blockers and the minimum production feature set are tracked in
`docs/production-viability.md`; the headline items are external cron
registration (all eight routes in `docs/sync-routes.md`), the missing legal
and content pages, SIBA send sign-off, and the invoicing enablement decision.
In-flight branch `fix/admin-refunds-cart-responsiveness` hardens admin refunds
(reservation cancel on refund) and the cart's local-first rendering.

## Technical Notes and Debt

Running list of known shortcuts and follow-ups noticed during implementation.
Keep this honest: when a debt item is paid, move the detail into the relevant
milestone and delete it here.

### Done in the activities + admin-operations iterations (2026-07-03 → 2026-07-10)

- ✅ **M9 Bokun activities.** `/activities` list, detail and gallery pages served
  from a DB-backed Bokun cache (PR #41): configured activity id list, daily
  self-gated sync behind `/api/cron/bokun/activities` (interval/lease/staleness
  env-tunable, `revalidateTag` per changed activity), and a single-day booking
  widget with live pricing.
- ✅ **M9 activity checkout.** Single-activity checkout (PR #44): pickup/dropoff
  places and Bokun booking questions collected before payment, activity holds
  via `RESERVE_FOR_EXTERNAL_PAYMENT`, and the order hub gained a live activity
  page (Bokun re-reads, question edits, PDF ticket downloads).
- ✅ **M9 mixed carts.** Stay + activity carts purchase in one payment (PR #45):
  Stripe `transfer_data.amount` splits activity money to the connected account,
  refunds use `reverse_transfer`, and cancellation policies render on home and
  activity pages.
- ✅ **M7 admin app.** `apps/admin` (port 3001) with its own Better Auth mount
  and root-admin seeding: orders list/detail with saga accept/cancel,
  per-reservation Hostify management, manual partial refunds with attribution
  and Detours transfer reversals, semi-manual invoicing + credit notes UI over
  the previously dark endpoints, guest roster edits, admin live chat (Hostify +
  internal conversations), reconciliations overview (stuck orders, refunds,
  guest-submission jobs with resubmission), sync status table with manual
  resync, runtime settings, observability, and users pages, plus the Detours
  settlement report.
- ✅ **Refund durability.** Manual refunds ride a ledger (`order_refunds`) with
  reserved amounts and stored Stripe idempotency keys; the new
  `/api/cron/commerce/refunds` reconciler resumes crashed `pending` rows and
  retries owed transfer reversals.
- ✅ **Optimistic cart + availability fixes.** Optimistic `/cart` and checkout
  edits with race guards (PR #42), Hostify calendar v2 stay rules, and the
  local-first cart snapshot work now in review on
  `fix/admin-refunds-cart-responsiveness` (including the idempotency-key fix
  that made re-adding a removed item work, with the repo's first DB-backed
  integration test pinning the add → remove → re-add contract).

### Done in the Hostkit guest-verification + invoicing iteration (2026-07-03)

- ✅ **Hostkit integration** (`packages/core/src/integrations/hostkit`). Typed
  GET client for the Hostkit REST API mirroring the Hostify integration:
  zod-validated responses, retries only on documented reads (every Hostkit
  call is a GET, most mutate), timeouts, and APIKEY redaction on every error
  path (the key travels in the query string). Hostkit keys are
  property-scoped, so per-listing keys resolve from the `HOSTKIT_API_KEYS`
  JSON env map (`{"<hostifyListingId>":"<key>"}`); a missing key means "not
  onboarded", not an error.
- ✅ **M8 back half: SIBA guest verification.** `GuestComplianceService`
  (`packages/core/src/compliance`) drives the previously unused
  `guest_submission_jobs` table. The cron sweep is the only trigger: it
  enqueues confirmed Hostify bookings whose roster is complete (all identity
  fields present, decrypted only inside the job) and re-enqueues when guests
  change after a terminal job. Each job runs removeAllGuests → addGuest per
  guest → validateSIBA; `sendSIBA` (filing with the authorities) stays behind
  `HOSTKIT_SIBA_SEND_ENABLED=false` until the business signs off. Country
  codes convert alpha-2 → alpha-3 via a static table; document types map
  Stripe Identity vocabulary → Hostkit P/ID/O; job error text is PII-safe.
- ✅ **Hostkit availability lag handled as a first-class state.** Reservations
  reach Hostkit asynchronously, so "Unknown reservation code" classifies as
  `awaiting_provider` and retries on a front-loaded ladder (5m/15m/45m/2h/6h,
  12 attempts ≈ 2 days) instead of failing; unprovisioned listings park jobs
  on a 6h cadence without consuming attempts. The reservation code (`rcode`)
  is the Hostify `confirmation_code` from the hold's operational payload,
  with a live Hostify re-read fallback for older holds.
- ✅ **M10 invoicing (implemented, deliberately unwired).** `InvoicingService`
  (`packages/core/src/invoicing`) issues Hostkit invoices from our own
  `order_item_charges` rows (what the customer actually paid), not the legacy
  approach of re-reading Hostify fee feeds. New `order_invoices` table
  (migration 0028) records every document; the draft row is inserted before
  any provider call and a partial unique index (one live invoice per order
  item) makes double-issuance fail fast. Flow: getProperty → addInvoice
  (billing contact, VAT number or 999999990 final consumer, alpha-3 country
  required) → addInvoiceLine per charge (certified products AL/TMT/CF/SAL/
  EXTRAS, VAT percent from stored basis points, M99 exemption at 0%,
  discounts as negative lines) → closeInvoice → document URL. Credit notes
  reference the issued invoice and record a negative-total row. Admin routes
  (`GET/POST /api/admin/orders/[reference]/...`) require the Better Auth
  admin role **and** `HOSTKIT_INVOICING_ENABLED=true`; nothing in the UI or
  payment flow calls them.
- ✅ **New cron route** `GET /api/cron/commerce/guest-submissions` (sweep +
  process in one tick); `docs/sync-routes.md` updated with cadence and the
  note that registering it is what turns the compliance half on.
- ✅ Validation: `bun test ./packages/core` (364 pass, including new hostkit
  client/config/redaction, compliance mapper, and invoicing mapper suites),
  `@workspace/db` / `@workspace/core` / `web` typecheck green.

### Done in the multi-booking cart iteration (2026-07-02)

- ✅ **One shared cart per browser.** The cart id persists in localStorage (the
  secret token stays in the httpOnly `ai_cart` cookie); a `cart-changed` event
  plus a cached count feed the new header cart badge. Anonymous carts claim to
  the account on sign-in as before.
- ✅ **`/cart` page.** Lists every stay with per-item date/guest edits (reusing
  the checkout dialogs; listing constraints fetched from the catalog detail
  API), removal, load-time revalidation with inline stale-stay flags that block
  checkout, and the cart-level price roll-up.
- ✅ **Cart-driven `/checkout`.** One checkout pays for every stay in the cart.
  The "Reserve" entry (`/homes/[id]/book`) seeds its stay into the same shared
  cart instead of discarding other items into a throwaway cart. Resume metadata
  is keyed by cart id (not a single stay); an expired order or rejected hold
  rebuilds a mutable cart from the frozen one (dropping stays that no longer
  quote) and recovers to `/cart`. Summary, review step, and price breakdown
  render all stays; add-to-cart on the booking widget feeds the shared cart.
- ✅ **Multi-stay emails.** `OrderConfirmationFacts` carries `stays[]` built
  from all saga bookings; the Maizzle confirmation and pending-confirmation
  templates gained a repeatable stay block (`__STAYS_START__`/`__STAYS_END__`
  markers survive both HTML and plaintext builds) expanded per stay by the
  builders, with payment moved to the order-level table and pluralized
  subjects/intros. Old baked templates fall back to first-stay placeholders.
- ✅ **Order surfaces.** Completion page clears the spent cart/resume metadata
  once money settles and uses stay-count-neutral copy; the order hub header
  summarizes a multi-stay order (count + date envelope); order-level invite
  emails title themselves after every stay.
- ✅ Validation: `bun test ./packages/core` (306 pass), `bun test ./apps/web`
  (26 pass), full turbo typecheck green on every commit.

### Done in the order-hub + messaging + guest-identity iteration (2026-06-26 → 2026-07-01)

- ✅ **M6 order hub.** `/order/[reference]` shell + overview + stay details,
  role-scoped `OrderDetail` read model (owner vs member; money/contact nulled
  for members), booking-access spine (`order_members`, hashed access tokens,
  owner activation on the confirmation email), invite / revoke / resend member
  management, and completion-page held → pending → confirmed → refunded states.
- ✅ **M5 hardening.** The confirm step re-reads the reservation after the
  accept PUT and only treats it as confirmed when the status actually settled
  (an accepted echo on a still-pending reservation no longer confirms, and is
  never refunded as `not_settled`); idempotent reconciliation-needed email; the
  checkout UI now surfaces `reservation_unavailable` (409) by rebuilding the
  cart and prompting new dates.
- ✅ **M8 guest registration (customer half).** Per-booking guest roster with
  encrypted identity fields, Stripe Identity verification sessions, account
  identity reuse, residency capture, and per-guest invite emails.
- ✅ **M10 messaging (customer half).** Per-booking conversations bridged to the
  Hostify inbox: send/retry with durable message state, a reconcile cron
  (`/api/cron/commerce/conversations`), and a realtime (Pusher) chat UI in the
  order hub.
- ✅ **Emails.** Maizzle-branded confirmation, pending-confirmation,
  could-not-confirm, amount-mismatch-refund, and order-invite templates
  (`apps/emails`), baked into `@workspace/auth` builders at build time.
- ✅ **Listing localization.** LLM localization backfill with shared sync parity
  and Hostify write-back, a one-run localization sync script, and env-driven
  listing sync versioning.

### Done in the reservation-saga + payment + checkout-latency iteration (2026-06-25)

- ✅ **M4 payment foundation.** Server-side Stripe PaymentIntent per draft order
  (idempotency key `pi:{orderId}`), retry-safe card failures, `succeeded` /
  `payment_failed` webhook handling, a `createRefund` helper
  (`integrations/stripe/refunds.ts`), and live-PaymentIntent reconciliation for
  webhook-missed orders.
- ✅ **M5 reserve-first saga (backend).** `holdOrderReservations` /
  `confirmOrderReservations` / `cancelOrderReservations` / `compensateOrder` /
  `reconcileReservations` on `CommerceService`; a provider-keyed
  `ProviderReservationGateway` + `HostifyReservationGateway` with pure mappers in
  `reservations.ts`; Hostify hold + best-effort transaction wiring; bounded
  retry/backoff + `needsRecovery` columns; migrations `0017`–`0019`; reconciler
  cron `GET /api/cron/commerce/reservations`. Full decisions and deviations are in
  `docs/plans/provider-reservation-saga.md` (status section, 2026-06-25).
- ✅ **M6 emails from durable state.** Confirmation, "could not confirm /
  refunded", and amount-mismatch templates fire from the saga (webhook/cron) with
  a durable finalization-email retry signal; `readOrderStatus` exposes the new
  booking status.
- ✅ **Checkout latency.** Cart add / edit / conversion reuse the short-TTL quote
  the booking widget already warmed instead of always re-pricing live (`forceFresh`
  is now opt-in via `CommerceQuoteInput`); availability is still re-checked at the
  hold, so no charge commits against stale availability. The `/homes/[id]/book`
  route is prefetched once a stay is stable and bookable (`router.prefetch`),
  warming the route outside the viewport (e.g. the mobile reserve drawer).
- ✅ Validation: `bun test ./packages/core` (253 pass) plus the commerce/schemas
  suites, `@workspace/core` / `@workspace/db` / `web` typecheck, and targeted
  `biome check` on touched files.

### Done in the cart API hardening iteration (2026-06-22)

- ✅ Cart and draft-order parser coverage expanded for valid create-cart,
  add-item, update-item, billing address, company, and notes scenarios.
- ✅ Cart validation and draft-order revalidation now fetch quote snapshots in
  parallel with `Promise.allSettled`, while preserving structured
  `CommerceError` handling and validation failure reporting.
- ✅ Draft-order charge rows now preserve negative discount `netMinor` values,
  with regression coverage for discounts, pure tax lines, inclusive tax
  precedence, and quantity formatting.
- ✅ API error handling tightened: validation responses no longer need route
  `as Response` casts, JSON parse failures are logged, duplicate error message
  fields were removed, and missing `issues` arrays are guarded.
- ✅ Commerce domain cleanup: cart validation failures no longer carry HTTP
  status, draft-order contact parsing uses `safeParse` on both paths, and
  unique order reference exhaustion now throws a `CommerceError`.
- ✅ Validation run after the fixes:
  `bun test ./packages/core/src/commerce`,
  `bun run --filter @workspace/core typecheck`,
  `bun run --filter @workspace/db typecheck`,
  `bun run --filter web typecheck`, and targeted `biome check` all passed.
- Skipped review findings: Next async route params are valid on the installed
  Next `16.2.9`; changing monetary Drizzle columns to `mode: "bigint"` is a
  coordinated serialization/type migration, not a minimal nit fix; and
  `assertMutableCart` does not return `invalid_request`, so tests were added for
  the real `cart_not_found` and expired-cart behavior instead.

### Done in the detail-page + live-booking iteration (2026-06-22)

- ✅ Listing detail page (`/homes/[id]`) with gallery, full-screen gallery route
  (`/homes/[id]/gallery`), clickable amenities dialog (grouped, deduped),
  reviews + per-category averages, location map, share dialog, sleeping-room
  layout, and SEO/OpenGraph metadata.
- ✅ Detail-page booking widget with live Hostify quoting
  (`useListingQuote` → `POST /api/accommodations/quote`), debounced and
  stale-aborted, plus availability calendar (`useBookingAvailability` →
  `/api/accommodations/calendar`) that preselects the soonest valid stay.
- ✅ Guest-type/tax overhaul in `packages/core/src/accommodations/quote.ts`
  (adults/children/infants → capacity, VAT-included breakdown, per-fee charge
  labels) with refreshed `quote.test.ts` / `params.test.ts`.
- ✅ Mobile booking UX: always-on inline stay editor + reserve drawer with
  collapsible dates/guests; desktop sticky card with popover inputs.
- ✅ Reviews sync cron (`/api/cron/hostify/reviews`) with batched polling and
  rerun-on-version-hash-change.

### Done in the DB-backed homes search iteration (2026-06-21)

- ✅ Homes grid no longer calls Hostify. Date-aware availability and the base
  price estimate come from the synced `accommodation_listing_night` calendar via
  `AccommodationPricingRepository.availabilityForStay`. The live Hostify
  availability and quote services remain only on their own routes
  (`/api/accommodations/availability`, `/api/accommodations/quote`).
- ✅ Listing cards show "from {total} for {nights} nights" (base-price estimate),
  falling back to the advisory "from {nightly}" rate when a stay is not fully
  priced.
- ✅ Single-listing resync hook in place: `NightlyPriceSync.syncListing` and the
  from-env `resyncAccommodationListing(listingId)` so a future webhook can
  refresh one listing without a full nightly run.
- ✅ Filter UX: `useTransition`-based pending (previous results stay visible and
  dim instead of a skeleton swap); guests commit-on-close; dates only commit a
  real multi-night range; mobile search collapses to a Filters button with
  collapsible When/Who sections.

### Open debt

- ⬜ **Cron registration.** `vercel.json` intentionally has no `crons` block;
  all eight routes in `docs/sync-routes.md` must be registered in the external
  scheduler before release. The hard blockers are
  `/api/cron/commerce/reservations` (~5-minute cadence, alert on `pending`
  older than `checkoutExpiresAt + grace`), `/api/cron/commerce/refunds`
  (10-15 min; resumes crashed refunds and owed transfer reversals), and
  `/api/cron/commerce/guest-submissions` (15-30 min; the sweep is the only
  trigger for SIBA submission). `/api/cron/bokun/activities` keeps the
  activities catalog alive (hourly ping, self-gated to a daily sync).
- ⬜ **SIBA auto-filing sign-off.** Jobs stop after `validateSIBA`; flipping
  `HOSTKIT_SIBA_SEND_ENABLED=true` makes them file the bulletin (`sendSIBA`).
  Needs an explicit business decision, plus `HOSTKIT_API_KEYS` provisioned per
  property in production.
- ⬜ **Invoicing enablement decision.** The admin UI over the invoicing
  endpoints shipped with M7, but issuance stays gated by
  `HOSTKIT_INVOICING_ENABLED`. Before enabling: verify the certified product
  ids (AL/TMT/CF/SAL/EXTRAS) match the production Hostkit invoicing account,
  confirm Hostkit accepts negative discount lines, and decide the issuance
  moment (manual via the dashboard vs automatic post-confirmation). Guest data
  retention/purge rules still pending (`purge_after` is stored but nothing
  purges yet).
- ⬜ **DB-integration saga tests.** Only the gateway / mapper / refund seams are
  unit-tested. The hold→confirm happy path, payment-fail, compensation,
  abandoned-hold expiry, webhook-missed cron resolve, idempotent re-delivery, and
  double-book guard still need coverage. A working pattern now exists:
  `packages/core/src/commerce/cart-items.integration.test.ts` runs the real
  `CommerceService` against the migrated dev/CI Postgres with injected quote
  mocks and skips itself when the database is unreachable.
- ⬜ **Saga minor gaps.** Zero-total orders place no hold; `fees[]` /
  `security_price` are not mapped (no persisted Hostify `fee_id`); no distinct
  `order_paid` funnel event.
- ⬜ **Hostify reservation webhook → cache invalidation.** Build the webhook
  endpoint that calls `resyncAccommodationListing(listingId)` so out-of-band
  bookings (other channels/OTAs) correct our availability without waiting for
  the nightly sync. Confirm Hostify's webhook payload covers OTA bookings, not
  just direct ones.
- ⬜ **Availability freshness cadence.** Now that availability is fully
  DB-driven, revisit the nightly horizon/frequency. Consider a more frequent
  near-term refresh (e.g. next ~90 days every few hours) since bookings cluster
  there and staleness hurts most; the webhook is the primary freshness signal
  once it lands.
- ⬜ **Estimate accuracy / min-stay.** `availabilityForStay` checks only the
  arrival-night `min_stay` and treats a stay as priced only when every night has
  a price; revisit if Hostify expresses min-stay or gap rules differently.
- ⬜ **Search API response shape.** `GET /api/accommodations/search` dropped
  `page.availabilityCache` and no longer honors `quoteVisible`/`forceFresh`
  (grid is DB-backed). Update any external consumers if they exist.

## 1. Catalog Browsing

Build this first because it turns the existing listing cache into something the
site can actually use.

- As a visitor, I can view available accommodations from the cached Hostify
  catalog.
- As a visitor, I can filter accommodations by location, guest count, and basic
  property attributes.
- As a visitor, I can open an accommodation detail page with photos, title,
  description, amenities, location, capacity, and freshness/status metadata.
- As the system, I never expose raw Hostify payloads to the browser.
- As the system, I can show cached listings even when Hostify is slow or down.

Outcome: the frontend can be built around stable local catalog APIs.

## 2. Live Availability and Quote

Build this after catalog browsing. Cached listings are enough for discovery, but
not enough for checkout.

- As a visitor, I can choose dates and party size for an accommodation.
- As a visitor, I can request a live quote before adding the stay to checkout.
- As the system, I revalidate price and availability with Hostify.
- As the system, I return clear unavailable/provider-error states without
  leaking provider internals.
- As the system, I store a short-lived quote so checkout does not trust
  client-submitted totals.

Outcome: the app has a trustworthy boundary between browsing and buying.

## 3. Cart and Checkout Shell

Build this before payment. The user should be able to assemble intent without
creating provider reservations yet.

- As a visitor, I can add a quoted accommodation to my cart.
- As a visitor, I can review dates, guests, price, fees, and cancellation-relevant
  information.
- As a visitor, I can enter contact and billing details.
- As the system, I validate that the quote is still valid before checkout can
  continue.
- As the system, I create a draft order from the quote and checkout details.

Outcome: checkout has a durable app-owned order before payment/provider side
effects start.

## 4. Payment Foundation

Build this once draft orders exist.

- As a visitor, I can start payment for a draft order.
- As the system, I create a Stripe PaymentIntent from the server-side order
  total.
- As the system, I record payment attempts and idempotency keys.
- As the system, I handle payment success, failure, cancellation, and retries
  without duplicating orders.
- As the system, I can reconcile Stripe state back to local payment records.

Outcome: money movement is attached to durable local state.

## 5. Provider Reservation Saga

Build this after payment plumbing is understood. This is where the app becomes
commercially real and the failure cases matter.

- As the system, I create or confirm Hostify reservations only through a durable
  workflow.
- As the system, I persist every provider booking attempt and response.
- As the system, I can retry safe steps without duplicating provider bookings.
- As the system, I compensate failed steps where possible, such as refunding or
  cancelling provider holds.
- As an operator, I can see when an order needs manual recovery.

Outcome: booking confirmation is reliable enough for production traffic.

## 6. Customer Order Experience

Build once the core booking flow works end to end.

- As a customer, I can see my order confirmation page.
- As a customer, I receive confirmation email after payment and provider
  confirmation.
- As a customer, I can view booking status, dates, guests, and payment summary.
- As a customer, I can access next steps for guest registration or property
  arrival requirements.
- As the system, emails are sent from durable state, not optimistic frontend
  actions.

Outcome: customers get a coherent post-purchase experience.

## 7. Admin Operations

Build after the customer path works, because admin needs should be grounded in
real order states.

- As an admin, I can view orders by status.
- As an admin, I can inspect payment, provider booking, quote, and sync history.
- As an admin, I can identify failed or stuck orders.
- As an admin, I can trigger safe retry/recovery actions.
- As an admin, I can view listing sync health and stale catalog records.

Outcome: the business can operate the system without reading logs or database
rows directly.

## 8. Guest Registration and Compliance

Build after bookings exist, because guest data should attach to confirmed or
recoverable provider bookings.

- As a customer, I can submit guest details required for accommodation stays.
- As the system, I store sensitive guest data with appropriate encryption and
  retention rules.
- As the system, I sync required guest data to the selected compliance provider
  only when the booking context is valid.
- As an admin, I can see whether guest submission succeeded, failed, or needs
  correction.
- As the system, I avoid sending guest PII to analytics or general logs.

Outcome: operational compliance is built on top of confirmed booking state.

## 9. Activities and Mixed Cart

Build this after the accommodation flow works. Bokun adds a second provider and
mixed-cart complexity, so it should not be the first production checkout path.

- As a visitor, I can browse activities.
- As a visitor, I can check live activity availability and prices.
- As a visitor, I can add activities to the cart.
- As the system, I can quote and reserve Bokun activity bookings.
- As the system, I can handle mixed accommodation/activity payment allocation.

Outcome: the product expands without destabilizing the first booking flow.

## 10. Fiscal Documents, Messaging, and Post-Stay Workflows

Build after orders, bookings, payments, and admin recovery are stable.

- As the system, I can issue accommodation invoices at the correct business
  moment.
- As the system, I can record invoice/credit-note state against order items.
- As a customer, I can receive booking-related messages.
- As an admin, I can view provider and customer communication history.
- As the system, I can reconcile post-stay operational state against providers.

Outcome: the app covers the back-office workflows needed after the booking.

## 11. Analytics and Optimization

Build this throughout, but expand it after the funnel exists.

- As the business, I can measure search, listing view, quote, checkout, payment,
  and confirmation funnels.
- As the system, I emit server-side commercial events from durable state.
- As the system, I keep analytics separate from operational truth.
- As the business, I can see where users abandon the funnel.
- As the business, I can compare provider failures, conversion, and revenue.

Outcome: product decisions are based on measured behavior, not guesses.

## Recommended Immediate Sequence

The full purchase path (catalog -> live quote -> mixed stay/activity cart ->
one payment -> provider confirmation -> order hub) and the admin operations
console are live end to end. What remains is release readiness, tracked in
detail in `docs/production-viability.md`:

1. Launch blockers: register all eight crons in the external scheduler, ship
   the legal/content pages (terms, privacy, cookie consent, contact/help),
   provision production env (`HOSTKIT_API_KEYS`, Stripe live keys, email
   domain auth), and land the SIBA send + invoicing enablement decisions.
2. Hostify reservation webhook -> targeted cache invalidation for out-of-band
   (OTA) bookings, or a tighter near-term availability refresh cadence.
3. DB-integration saga tests on the new integration-test pattern.
4. Localization (pt first) and the remaining IA pages (About, FAQ, /owner).
