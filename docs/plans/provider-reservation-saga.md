# Provider Reservation Saga (Roadmap M5)

## Context

Milestones 1–4 are shipped (the roadmap status table dated 2026-06-22 is stale;
`/homes/[id]/book`, `/api/checkout/payment-intent`, `/api/webhooks/stripe`,
`core/integrations/stripe`, `/booking/complete`, and `/account` all exist as of
2026-06-24). The next gap is M5: a durable workflow that turns a *paid* order
into a real Hostify reservation, with persistence, retry, compensation, and
operator-visible recovery.

### The correctness problem today

A guest pays and the order is immediately marked `confirmed` with a confirmation
email — but **no Hostify reservation is ever created**. The booking exists only
in our DB. This is the central bug M5 fixes.

- `markOrderPaid` (`packages/core/src/commerce/service.ts:459`) sets
  `order.status = "confirmed"` purely on Stripe `payment_intent.succeeded`, then
  the webhook (`apps/web/app/api/webhooks/stripe/route.ts:82`) sends the
  confirmation email. Nothing touches the provider.
- `createDraftOrder` already inserts one `provider_bookings` row per order item
  with `normalizedStatus: "pending"` (`service.ts:1297`), carrying `provider`,
  `externalAccountId`, `orderItemId`, `stayStartsAt/EndsAt`. These rows are never
  advanced past `pending`.

### Verified contracts (checked against current code)

- **`order` table** (`packages/db/src/schema.ts:843`): `status` check constraint
  allows `draft | pending | confirmed | cancelled | failed`; has
  `stripePaymentIntentId` (unique), `amountPaidMinor`, `amountRefundedMinor`,
  `failureCode`, `failureDetail`, `confirmedAt`, `cancelledAt`,
  `checkoutExpiresAt`, `publicReference` (unique). **No enum migration needed** —
  the five existing statuses cover the new state machine.
- **`provider_bookings` table** (`schema.ts:994`): `normalizedStatus`
  (`pending | confirmed | cancelled | failed | completed`), `providerReservationId`,
  `provider`, `externalAccountId`, `providerStatus`, `providerCreatedAt`,
  `providerUpdatedAt`, `rawOperationalPayload (jsonb)`, `stayStartsAt/EndsAt`.
  Unique on `order_item_id` (one booking per item) and a partial unique on
  `(provider, external_account_id, provider_reservation_id)`. **No attempt/backoff
  columns yet** — added in Part A.
- **`accommodation_item_details`** (`schema.ts:1147`, PK `order_item_id`):
  `hostifyListingId`, `checkIn`, `checkOut` (date strings), `guests`, `adults`,
  `children`, `infants`, `pets`, `externalAccountId`, `provider`,
  `propertyTimezone`, `nights`. Everything `reservations.create` needs.
- **`order_item_charges`** (`schema.ts:1175`): `kind`, `name`, `grossMinor`,
  `netMinor`, `taxMinor`, `taxRateBasisPoints`, `unitNetMinor`, `quantity`,
  `providerChargeId`, `rawPayload`. Source for fee/tax/base-price mapping.
- **`order_contacts`** (`schema.ts:907`): `email`, `name`, `phoneE164`,
  `billingAddress`, `companyName`, `taxNumber`, `notes`.
- **Hostify client** (`packages/core/src/integrations/hostify/client.ts`):
  `reservations.create(input)` → `POST /reservations` (`:624`),
  `reservations.get` (`:636`), `reservations.list` (`:655`, supports
  `listing_id` + `checkIn/checkOut/status/source` filters), `reservations.update`
  (`:682`), `acceptReservation`/`declineReservation` (`:163`/`:185`).
- **`HostifyCreateReservationInput`** (`types.ts:433`): requires `email`, `name`,
  `phone`, `listing_id`, `start_date`, `end_date`, `guests`, `pets`, `note`,
  `source`, `status ("accepted" | "pending")`, `skip_restrictions: false`;
  optional money: `base_price`, `fees[]`, `tax_amount`, `total_price`,
  `security_price`, `payout_price`.
- **Stripe core** (`integrations/stripe/index.ts`) exports only
  `createOrUpdatePaymentIntent` and `retrievePaymentIntentSnapshot`. **No refund
  helper exists** — added in Part D.
- **Cron pattern**: routes under `apps/web/app/api/cron/hostify/*` guard with
  `isAuthorizedCronRequest(request, config.cronSecret)` (`@workspace/core/listing-cache`),
  `Authorization: Bearer $CRON_SECRET`. No queue/worker infra; cron is the
  durability backbone in this codebase.
- Last migration is `0012_*` (per the cart-auth plan); this work generates the
  next sequential migration.

## Decisions (confirmed with user)

All five are locked. The model is **reserve-first**: place a Hostify hold before
charging, then let the payment outcome flip the hold. This is a deliberate change
from a pay-then-reserve saga — it resolves the quote→book availability race up
front (if the dates are gone we fail before taking any money) and narrows the
"charged but no booking" window to a single Hostify update call.

### D1 — Reserve-first state machine (confirmed)

Place a **pending Hostify reservation (a hold)** at PaymentIntent creation;
payment success confirms it, payment failure cancels it. Repurpose the existing
order enum (no constraint migration — all five values already exist):

| order status | meaning | provider_booking | Hostify hold |
|---|---|---|---|
| `draft` | checkout open, contact captured, no hold yet | `pending`, no `providerReservationId` | none |
| `pending` | hold placed, PaymentIntent open, awaiting payment | `pending`, `providerReservationId` set | `pending` |
| `confirmed` | payment succeeded, hold confirmed | `confirmed` | `accepted` |
| `failed` | payment failed (never charged) → hold released | `cancelled` | `cancelled` |
| `cancelled` | charged then refunded (post-charge confirm failure / amount mismatch) | `failed` | `cancelled` |

A `provider_booking` row distinguishes "no hold yet" from "held, unpaid" by
whether `providerReservationId` is null vs set (both are `normalizedStatus =
'pending'`). The confirmation email fires only on the `pending → confirmed`
transition, from durable state, in the saga — not from the webhook (matches M6).

**Why reserve-first beats pay-first here:** the hold is the availability commit.
If Hostify rejects the hold (dates taken), PaymentIntent creation fails and the
guest is never charged. Compensation/refund then only covers the rare case where
we *confirmed payment* but the *hold-confirm update* permanently fails.

**Where the hold is placed: PaymentIntent creation** (not draft creation). This
is the tightest commitment point, so abandoned-checkout holds are minimised. The
cost is a small availability window between draft and pay; acceptable because the
hold-create itself re-checks availability against Hostify. Gate: **no hold → no
PaymentIntent → no charge.**

### D2 — Durability via DB state machine + reconciler cron (confirmed)

No BullMQ/worker exists and Redis is rate-limit-only; cron is the established
durability pattern. Two triggers:

1. **Webhook (low latency, happy path):** `payment_intent.succeeded` confirms the
   hold inline (best-effort); `payment_intent.payment_failed` cancels it.
2. **Reconciler cron `/api/cron/commerce/reservations` (durability authority):**
   resolves any order stuck in `pending` and expires abandoned holds. It is the
   at-least-once backstop; the webhook is just an optimisation. Bounded retries +
   backoff tracked in columns (Part A).

The cron has **two responsibilities** (see Part F): (a) drive `pending` orders
whose live Stripe PaymentIntent has resolved but whose hold confirm/cancel did
not complete, and (b) cancel holds on orders past `checkoutExpiresAt` to release
Hostify inventory.

### D3 — Idempotency handled on our end (confirmed)

Hostify has no idempotency key, so we own dedupe across all three hold operations:

- **Create hold:** short-circuit if `provider_booking.providerReservationId` is
  already set. Embed a deterministic tag in `source` + `note` (order
  `publicReference` + `orderItemId`). On any retry, **reconcile-before-create**:
  `reservations.list` filtered by `listing_id` + `checkIn/checkOut`, adopt a
  matching tagged hold instead of creating a duplicate. Persist
  `providerReservationId` in the same transaction that records the hold, guarded
  by the existing partial unique index.
- **Confirm hold:** idempotent `reservations.update` (status → accepted) /
  `acceptReservation`; short-circuit if already `confirmed`.
- **Cancel hold:** idempotent `declineReservation` / update → cancelled;
  short-circuit if already `cancelled`.

### D4 — Auto full refund on post-charge failure (confirmed)

Implement a Stripe refund helper (none exists today) and auto-refund. Triggers:
payment succeeded but hold confirm permanently fails, or `amount_mismatch`. Action:
full refund via `stripePaymentIntentId`, set `amountRefundedMinor`, order →
`cancelled`, provider_booking → `failed`, cancel any sibling holds, customer
"refunded — couldn't confirm" email + Sentry alert. Idempotent (a re-run finds
the order already `cancelled`). Gate behind a config flag so Finance can switch to
manual-hold later, but the default is automatic.

### D5 — All-or-nothing now, mixed-cart-scalable structure (confirmed)

Defer mixed-cart/partial-refund allocation (that lands with M9/Bokun), but build
the structure to scale to it. The saga loops over **all** `provider_bookings` of
an order regardless of `provider`, dispatching the actual hold/confirm/cancel
through a provider-keyed gateway (Hostify today; Bokun slots in later without
touching the orchestrator). For M5 the order is atomic: any item's hold that
permanently fails compensates the whole order. Per-item refund allocation is the
only piece explicitly deferred.

## Part A — Schema + migration

`packages/db/src/schema.ts` (+ generated next migration):

Add retry/backoff/diagnostic columns to `provider_bookings` (each hold operation
— create/confirm/cancel — is a retryable step the cron schedules):

- `attemptCount integer not null default 0`
- `lastAttemptAt timestamptz`
- `nextAttemptAt timestamptz` (reconciler scheduling; default `now()`)
- `lastErrorCode text`, `lastErrorMessage text`
- `needsRecovery boolean not null default false` (set when attempts exhausted;
  the operator-visible "stuck" signal until the M7 dashboard exists)

Index for the reconciler: `(normalized_status, next_attempt_at)` partial where
`normalized_status = 'pending'`.

Export a `ProviderBooking` row type if not already exported for service use.

## Part B — Provider booking gateway (`packages/core/src/commerce/reservations.ts`)

A pure mapper + a provider-dispatched gateway with three idempotent operations.
The gateway is keyed by `provider` so Bokun can be added later without touching the
orchestrator (D5).

- `buildCreateReservationInput(row)` — maps `order_contact` +
  `accommodation_item_detail` + `order_item_charges` → `HostifyCreateReservationInput`
  with **`status: "pending"`** (the hold), `skip_restrictions: false`, deterministic
  `source`/`note` tag (D3), and `base_price`/`fees[]`/`tax_amount`/`total_price`/
  `security_price` derived from charge rows in minor units → `HostifyMoney`.
- `createHold(providerBookingId)` — short-circuit if `providerReservationId` set;
  reconcile-before-create on retry (D3); `reservations.create`; persist
  `providerReservationId`, `providerStatus`, `providerCreatedAt`,
  `rawOperationalPayload` transactionally (`normalizedStatus` stays `pending`).
  Returns `created | adopted | unavailable | transient_error`.
- `confirmHold(providerBookingId)` — short-circuit if already `confirmed`;
  `reservations.update` status → `accepted` (or `acceptReservation`); flip
  `normalizedStatus` → `confirmed`.
- `cancelHold(providerBookingId, reason)` — short-circuit if already `cancelled`;
  `declineReservation` / update → cancelled; flip `normalizedStatus` → `cancelled`.
- Error classification: transient (network/5xx/rate-limit → retry w/ backoff) vs
  permanent (validation/unavailable/4xx). Reuse Hostify `errors.ts`.

## Part C — Saga orchestrator (`CommerceService`)

Three order-level methods, each looping over the order's `provider_bookings`
(provider-agnostic, D5), all using guarded `UPDATE … WHERE status IN (…)` so
webhook + cron converge without double side-effects:

- `holdOrderReservations(orderId)` — called from PaymentIntent creation (Part E).
  `createHold` every item. If **any** returns `unavailable`, cancel any siblings
  already held and **fail without charging** (caller surfaces "no longer
  available", returns no PaymentIntent). Order stays `draft`; on full success →
  `pending`.
- `confirmOrderReservations(orderId)` — called on payment success. `confirmHold`
  every item:
  - all `confirmed` → order `confirmed` + `confirmedAt`, fire confirmation email.
  - permanent confirm failure → `compensateOrder` (Part D).
  - transient → bump `attemptCount`/`nextAttemptAt`, leave `pending` for the cron.
- `cancelOrderReservations(orderId, reason)` — called on payment failure or hold
  expiry. `cancelHold` every item, order → `failed`.

`markOrderPaid` is reworked: it no longer jumps to `confirmed`. On a verified
`payment_intent.succeeded` it sets `pending` (recording `amountPaidMinor`) and
hands off to `confirmOrderReservations`; the email payload assembly moves to the
saga success path. `amount_mismatch` routes to `compensateOrder`.

## Part D — Compensation

- New `packages/core/src/integrations/stripe/refunds.ts`: `createRefund({
  paymentIntentId, amountMinor?, reason })` + export from `stripe/index.ts`.
- `compensateOrder(orderId, reason)` in `CommerceService`: full refund via the
  order's `stripePaymentIntentId`, set `amountRefundedMinor`, order → `cancelled`;
  `cancelHold` every item (provider_booking → `cancelled`); the failed item →
  `failed`; Sentry alert + customer refund email.
- Config-gated (default on, D4); idempotent — a re-run finds the order already
  `cancelled` and no-ops.

## Part E — Triggers

- **PaymentIntent route** (`apps/web/app/api/checkout/payment-intent`): before
  creating/returning the PaymentIntent, call `holdOrderReservations`. No hold →
  no PaymentIntent (return an `unavailable` response the checkout UI handles).
  Order moves `draft → pending` only once held.
- **Stripe webhook** (`apps/web/app/api/webhooks/stripe/route.ts`):
  `handlePaymentSucceeded` → `markOrderPaid` (→ `pending`) →
  `confirmOrderReservations` (best-effort; failures logged, never 5xx). The inline
  email send is removed (now in the saga). `handlePaymentFailed` →
  `cancelOrderReservations` (release the hold), order → `failed`.

## Part F — Reconciler cron

`apps/web/app/api/cron/commerce/reservations/route.ts`, guarded with
`isAuthorizedCronRequest(request, config.cronSecret)` like the Hostify crons. Two
responsibilities:

1. **Resolve stuck `pending` orders.** For orders `pending` with
   `next_attempt_at <= now`, read the live PaymentIntent via
   `retrievePaymentIntentSnapshot` (the webhook may never have arrived):
   - PI `succeeded` → `confirmOrderReservations`.
   - PI `canceled`/failed → `cancelOrderReservations` (order → `failed`).
   - still processing → re-schedule with backoff. Mark `needsRecovery` once
     `attemptCount` exceeds the cap.
2. **Expire abandoned holds.** For orders past `checkoutExpiresAt` that never
   reached a succeeded payment, `cancelOrderReservations` to release Hostify
   inventory (order → `failed`/expired). This is the cleanup for reserve-first
   holds on abandoned checkouts.

Register in the deploy scheduler alongside the existing crons.

## Part G — Completion page / order status read

- `apps/web/app/booking/complete/page.tsx` + `readOrderStatus`
  (`service.ts:614`): surface the new intermediate state. "Payment received,
  finalizing your booking" while `pending`; "Booking confirmed" only on
  `confirmed`; "Refunded — we couldn't confirm" on `cancelled`. Poll or
  revalidate so a few-seconds provisioning delay resolves without a manual
  refresh.

## Part H — Observability

- Server-side funnel events (M11 alignment) from durable state: `order_paid`,
  `reservation_provisioned`, `order_confirmed`, `order_compensated`. Use the
  existing analytics/observability path, never logging guest PII.
- Sentry alerts on permanent failure and on `needsRecovery` set.

## Files

Create:
- `packages/core/src/integrations/stripe/refunds.ts` (+ test)
- `packages/core/src/commerce/reservations.ts` — gateway/mapper +
  `createHold`/`confirmHold`/`cancelHold` (+ test)
- `apps/web/app/api/cron/commerce/reservations/route.ts`
- Next migration SQL under `packages/db` (generated)

Modify:
- `packages/db/src/schema.ts` — provider_bookings columns + index
- `packages/core/src/commerce/service.ts` — `markOrderPaid` rework,
  `holdOrderReservations` / `confirmOrderReservations` / `cancelOrderReservations`,
  `compensateOrder`, confirmation-email assembly
- `packages/core/src/commerce/index.ts` / `types.ts` — exported result types
- `packages/core/src/integrations/stripe/index.ts` — export refund helper
- `apps/web/app/api/checkout/payment-intent/route.ts` — place hold before charge;
  surface `unavailable` and refuse the PaymentIntent when no hold
- `apps/web/app/api/webhooks/stripe/route.ts` — confirm/cancel hold, drop inline email
- `apps/web/lib/email/order-confirmation.ts` (+ a new "could not confirm / refunded" template)
- `apps/web/app/booking/complete/page.tsx` — held/confirmed/refunded states
- checkout UI (book flow) — handle the `unavailable` PaymentIntent response
- `docs/roadmap.md` — refresh M3/M4 to ✅, mark M5 in progress, retire stale notes

## Verification

- `bun test ./packages/core/src/commerce` and `./packages/core/src/integrations/stripe`
- New tests: hold-then-confirm happy path (single + multi item); hold
  `unavailable` → no PaymentIntent / no charge; payment-fail → hold cancelled;
  post-charge confirm failure → compensation/refund; abandoned-hold expiry via
  cron; webhook-missed → cron resolves from live PI; idempotent re-delivery
  (webhook + cron racing); double-book guard (id short-circuit + reconcile-adopt).
- `bun run --filter @workspace/core typecheck`,
  `bun run --filter @workspace/db typecheck`,
  `bun run --filter web typecheck`
- Targeted `biome check` on changed files.

## Open risks / notes

- **Hold blocks the calendar: confirmed.** A host-created `status:"pending"`
  Hostify reservation does block availability (confirmed with the user), so
  reserve-first is sound as designed. Remaining detail to settle during Part B:
  which endpoint confirms a host-created hold —
  `reservations.update status=accepted` vs `acceptReservation` — and which cancels
  it (`declineReservation` vs `update status=cancelled`). Decide against a real
  Hostify response, not from types alone.
- **Abandoned-hold leakage.** Reserve-first holds inventory during checkout; the
  cron's expiry job (Part F.2) is the only thing that releases holds on abandoned
  payments. If the cron lags, real dates stay blocked — keep its cadence tight and
  alert on `pending` orders older than `checkoutExpiresAt + grace`.
- **Hostify dedupe is best-effort** (D3). If `reservations.list` filters prove
  unreliable, the `source`/`note` tag is the fallback matcher — validate against a
  real Hostify response shape early.
- **Refund-on-failure is real money movement.** Config-gated (D4); default on.
- **Operator recovery is query-only** for M5 (`needsRecovery` flag + Sentry). The
  full retry/recovery dashboard is M7.
- **Webhook out-of-band cancellation** (roadmap Open debt: Hostify reservation
  webhook → `resyncAccommodationListing`) is adjacent but separate; not in scope
  here beyond storing `providerReservationId` so a future webhook can correlate.

## Implementation status: M5 backend (2026-06-25)

The backend (Parts A–F, H) is implemented and green: `bun test ./packages/core`
(253 pass), `typecheck` for `@workspace/db` / `@workspace/core` / `web`, and a
targeted `biome check` on the files touched for this backend pass. Frontend
(Part G) and a real-Hostify validation pass remain.

### What shipped

- **Schema/migrations.** Retry/diagnostic columns + partial index on
  `provider_bookings` (`0017_provider_booking_retry.sql`) and a
  `provider_transaction_id` column (`0018_provider_booking_transaction_id.sql`).
  `0019_chilly_wonder_man.sql` adds refund tracking, durable finalization-email
  retry state, the refunded-lte-paid check, and null-account-safe provider
  booking unique indexes. Last applied migration was `0016`, not `0012` as the
  plan stated, so this backend ships `0017`/`0018`/`0019`. `ProviderBooking` row
  type exported from `@workspace/db`.
- **Gateway + mapper** (`packages/core/src/commerce/reservations.ts`):
  `buildCreateReservationInput` / `buildTransactionInput` / `buildHoldRequest`
  pure mappers, a provider-keyed `ProviderReservationGateway` interface, and
  `HostifyReservationGateway`. Unit-tested (`reservations.test.ts`).
- **Saga** on `CommerceService`: `holdOrderReservations`,
  `confirmOrderReservations`, `cancelOrderReservations`, `compensateOrder`,
  `reconcileReservations`, plus reworked `markOrderPaid`. New result types in
  `commerce/payments.ts`.
- **Refunds** (`integrations/stripe/refunds.ts`, exported; tested).
- **Triggers**: payment-intent route places the hold before charging and
  surfaces `reservation_unavailable` (409) / transient (503); the webhook
  confirms (or compensates) and keeps failed payments retryable.
- **Cron**: `GET /api/cron/commerce/reservations`, registered in the external
  scheduler runbook at `docs/sync-routes.md` with a 5-minute release-blocking
  cadence. Do not use Vercel Cron Jobs for this project.
- **Wiring**: `commerceService()` injects the Hostify gateway, the Stripe refund
  helper, and a live-PaymentIntent reader; `COMMERCE_AUTO_REFUND=false` switches
  D4 to manual-hold.
- **Email/observability**: confirmation + refund emails fire from the webhook and
  the cron. The order transition stores a durable finalization-email signal and
  transport success clears it; failures record retry state for the cron. The
  amount-mismatch path uses neutral payment-discrepancy copy, while provider
  confirmation failure uses the "could-not-confirm / refunded" copy. `trackEvent`
  for `reservation_provisioned` / `order_confirmed` / `order_compensated`.

### Decisions taken (deviations from the plan above)

1. **Hostify transaction is wired** (the legacy "incomplete accommodation
   transaction" the plan omitted). At hold we `POST /transactions`
   (`is_completed: 0`, `type: "accommodation"`) and persist its id; on confirm we
   `PUT` it to `is_completed: 1` with the Stripe payment ref; on cancel we set it
   back to `is_completed: 0` with an audit note. The client's `transactions.create`
   schema was changed from success-only to `hostifySchemas.transaction` so the id
   is no longer stripped. Transaction writes are **best-effort** (the reservation
   write is the authoritative inventory action; a transaction failure never fails
   the hold/confirm/cancel and is reconciled separately).
2. **Confirm = `reservations.update status=accepted`; cancel = `update
   status=cancelled_by_host`.** The inbox `acceptReservation`/`declineReservation`
   endpoints are NOT used: their input is `{ thread_id }` (inquiry threads), not a
   host-created reservation id. Chosen from the type contract; still wants a
   real-response check (see open items).
3. **`payment_failed` does NOT release the hold.** Per commit 310d246 (failed
   payments stay retryable on the same intent) and the user's note, the webhook
   only records the failure. Hold release on an **abandoned** checkout is solely
   the reconciler cron's expiry job. This is what cancels a Hostify reservation
   created for a cart the guest then abandons.
4. **Gateway is provider-call-only; DB-aware hold ops live on `CommerceService`.**
   The plan put `createHold/confirmHold/cancelHold(providerBookingId)` in
   `reservations.ts`; instead those DB steps are private service methods and the
   gateway exposes pure provider calls, so the gateway is testable without a DB
   and the service keeps sole ownership of persistence.
5. **`pending` is split by `amountPaidMinor`**: `0` = held-unpaid (PaymentIntent
   open), `> 0` = paid-awaiting-confirm. `getPayableOrder` now also accepts a
   held-unpaid `pending` order so checkout resume / PI refresh still works.
6. **Unavailable/permanent create failure fails the order** (sets `failed` and
   releases sibling holds) rather than leaving it `draft`; a draft order carrying
   cancelled bookings would be inconsistent and un-resumable.
7. **Bounded retries**: a transient confirm/cancel escalates to permanent
   (→ compensation / `needsRecovery`) once `attemptCount` hits the cap
   (`maxReservationAttempts`, default 6); backoff 60s→30min.
8. **Compensation refunds `amountPaidMinor`** from Postgres (our source of truth),
   not the Hostify transaction amount the legacy read back.

## Confirm-settle hardening (2026-06-30)

Hostify can return `accepted` on the confirm PUT while silently leaving a
reservation `pending` (observed for accepts far in the future). The old
`confirmHold` trusted the PUT echo and reported `ok`, so the order was marked
`confirmed` and the confirmation email fired while the real hold stayed `pending`
(and could later auto-deny) — a silent false confirm. Fixed:

- **Gateway `confirmHold` re-reads after the PUT and classifies against the live
  status, never the echo** (`reservations.ts`): `accepted` → `ok`;
  `denied`/`cancelled_*`/`no_show` → `permanent` (dead hold → compensation, the
  correct refund case); anything still `pending` → a new **`not_settled`** result.
  The same re-read runs in the `catch` path, so a PUT that throws but whose hold
  is alive returns `not_settled`, never a `transient` that could escalate to a
  refund. A PII-safe `logger.warn` fires on every PUT-said-accepted-but-still-pending
  read (the far-future diagnostic). `not_settled` is a confirm-only member of a new
  `MutateHoldResult`; cancel keeps the narrower `SettledMutateResult`.
- **Service never refunds a `not_settled` hold** (`service.ts`):
  `#recordConfirmNotSettled` keeps the booking `pending`, retries on the standard
  backoff, then drops to a daily nudge and sets `needsRecovery` past
  `CONFIRM_SETTLE_GRACE_ATTEMPTS` (6) with a one-time `reservation_confirm_stuck`
  Sentry warning. `confirmOrderReservations` folds `not_settled` into
  `pending_retry`, never `compensateOrder`. The reconciler's `pending` selection is
  widened to keep nudging holds flagged `needsRecovery` when
  `lastErrorCode = 'confirm_not_settled'`, so the daily retry survives the operator
  flag. No migration — the existing `provider_bookings` columns carry the state.

Remaining: validate the far-future-accept behavior against a live Hostify response
(the `logger.warn` quantifies how often it actually happens) and decide whether the
daily-nudge cadence/grace needs tuning once real data lands.

### Open / remaining

- **Part G (frontend).** `readOrderStatus` already returns the new
  `bookingStatus`, but the completion page copy ("payment received, finalizing" on
  `pending`, "refunded: we couldn't confirm" on `cancelled`) and the checkout
  UI handling of the `reservation_unavailable` (409) / 503 responses are not done.
- **Real-Hostify validation.** Confirm against a live response: the
  accept/cancel status verbs, that a host `pending` reservation truly blocks the
  calendar, the `transactions.create` response shape (`{ success, transaction:{id} }`
  assumed from the legacy), and that `reservations.list` filters reliably back the
  reconcile-before-create dedupe.
- **External scheduler release gate.** `vercel.json` intentionally has no `crons`
  block. The existing Hostify crons run from an external scheduler via
  `Authorization: Bearer $CRON_SECRET`; `/api/cron/commerce/reservations` must be
  registered there before release (5-minute cadence; alert on `pending` older
  than `checkoutExpiresAt + grace`). See `docs/sync-routes.md`.
- **DB-integration saga tests** (hold→confirm happy path, payment-fail, compensation,
  abandoned-hold expiry, webhook-missed cron resolve, idempotent re-delivery,
  double-book guard). No DB test harness exists in the repo yet; only the gateway /
  mapper / refund seams are unit-tested so far.
- **Minor gaps**: zero-total orders place no hold (out of scope);
  `fees[]`/`security_price` are not mapped (no persisted Hostify `fee_id`); no
  distinct `order_paid` funnel event.

## References

- Roadmap M5 (`docs/roadmap.md:187`), M6 email-from-durable-state (`:202`).
- `docs/data-architecture.md` provider-booking mapping; legacy reservation +
  transaction flow in `app/actions/createReservation.ts`,
  `app/api/webhook/stripe/route.ts`, `app/actions/cancelReservation.ts`.
- Existing crons: `apps/web/app/api/cron/hostify/*/route.ts`.
