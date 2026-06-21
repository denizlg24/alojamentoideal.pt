# App Build Roadmap

This is the recommended build order for Alojamento Ideal as an end-to-end app.
The goal is to move from backend foundations to a usable customer booking flow,
then into operations, automation, and polish.

## Status (as of 2026-06-21)

Legend: ✅ done · 🟡 in progress / partial · ⬜ not started

| # | Milestone | Status | Notes |
|---|---|---|---|
| 0 | Foundations (cache, sync, platform) | ✅ | Hostify incremental sync cron, content processing, and the `accommodation_listing` projection with FTS + trigram + geo search index. Rate limiting (Redis) and observability (Sentry errors + PostgreSQL analytics) wired through `withApiRoute`. |
| 1 | Catalog Browsing | 🟡 | Catalog read API done: `GET /api/catalog/listings` (filter/sort/paginate) and `/api/catalog/listings/[externalId]` (localized detail), with Next.js `use cache` + cron-driven `revalidateTag` invalidation. Frontend: `/homes` grid, filter bar (dates/guests/rooms/rating/amenities), and Leaflet map shipped. Detail page and broader polish still pending. |
| 2 | Live Availability and Quote | 🟡 | Browsing half done: homes availability filtering and the "from X for Y nights" base-price estimate are served from the synced nightly calendar in Postgres (`AccommodationPricingRepository.availabilityForStay`), so no Hostify call sits on the grid. Remaining: live Hostify price/availability revalidation at checkout and short-lived quote storage (see Debt: always re-validate before booking). |
| 3 | Cart and Checkout Shell | ⬜ | Draft order from quote; no provider side effects yet. |
| 4 | Payment Foundation | ⬜ | Stripe PaymentIntent from server-side order total; payment attempts + idempotency. |
| 5 | Provider Reservation Saga | ⬜ | Durable Hostify reservation confirm/compensate workflow. |
| 6 | Customer Order Experience | ⬜ | Confirmation page + email from durable state. |
| 7 | Admin Operations | ⬜ | Order/recovery dashboard, sync health. |
| 8 | Guest Registration and Compliance | ⬜ | Encrypted guest data + Hostkit/SIBA submission. |
| 9 | Activities and Mixed Cart | ⬜ | Bokun browse/quote/reserve + mixed-cart allocation. |
| 10 | Fiscal Documents, Messaging, Post-Stay | ⬜ | Invoices/credit notes, messaging, reconciliation. |
| 11 | Analytics and Optimization | 🟡 | Per-request analytics events persisted to PostgreSQL and errors to Sentry. Commercial funnel events (search → view → quote → checkout → payment → confirm) **not built**. |

Current focus: finish milestone 1 by building the catalog browsing frontend on
top of the stable catalog read API.

## Technical Notes and Debt

Running list of known shortcuts and follow-ups noticed during implementation.
Keep this honest: when a debt item is paid, move the detail into the relevant
milestone and delete it here.

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

- ⬜ **Always fetch live Hostify price + availability before booking.** The grid
  estimate excludes cleaning/extra-person fees and taxes and can be stale.
  Checkout (and ideally the detail page) must re-quote and re-validate
  availability against Hostify before payment, and fail gracefully if the stay
  is no longer bookable. Non-negotiable before milestone 4/5.
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

If you want the next concrete tasks, do this:

1. Catalog API and accommodation listing/detail frontend.
2. Live quote endpoint and date/guest selector frontend.
3. Cart and checkout form using quote IDs.
4. Draft order creation.
5. Stripe PaymentIntent creation and webhook handling.
6. Hostify reservation confirmation workflow.
7. Customer confirmation page and email.
8. Admin order/recovery dashboard.

Keep the first production milestone narrow: accommodation-only booking from
cached catalog -> live quote -> checkout -> payment -> Hostify confirmation.
Add Bokun, mixed carts, invoices, guest compliance, and advanced admin tools
after that path is stable.
