# Production Viability: Minimum Feature Set

What has to exist before `alojamentoideal.pt` can take real money from real
guests. This is the gap between "the software works end to end" (true today,
see `docs/roadmap.md`) and "the business can safely operate it in public".

Status date: 2026-07-10. Keep this honest: when an item ships, mark it and
move the detail into the roadmap.

## Where the product stands

The full purchase path is implemented and exercised: catalog browsing (homes +
activities), live quotes, a shared mixed cart, one Stripe payment with
per-provider money split, reserve-first provider holds (Hostify + Bokun),
durable confirmation/compensation sagas, the customer order hub (guests,
messages, activity tickets), transactional emails from durable state, and an
admin console covering orders, refunds, reservations, invoicing, compliance
jobs, reconciliations, sync health, and settlements.

None of the remaining work is a feature in the product sense. It is wiring,
legal surface, and operational safety.

## Launch blockers

Ordered roughly by "how bad it is to launch without it".

### 1. Register the crons (correctness blocker)

Nothing schedules the eight routes in `docs/sync-routes.md` yet; `vercel.json`
deliberately has no `crons` block. Without the external scheduler:

- Paid orders whose Stripe webhook is missed are never confirmed or refunded
  (`/api/cron/commerce/reservations` is the durability authority, ~5 min).
- A refund that crashes mid-flight stays stuck forever
  (`/api/cron/commerce/refunds`, 10 to 15 min).
- SIBA guest bulletins are never submitted; the sweep is the only trigger
  (`/api/cron/commerce/guest-submissions`, 15 to 30 min).
- The catalog, pricing, reviews, activities, and inbox projections go stale.

This is a hard blocker. Registering the routes plus an alert when a cron stops
returning 200 (a plain uptime check on each URL is enough) is the single
highest-leverage launch task.

### 2. Legal pages and consent (legal blocker)

The web app has no terms of service, privacy policy, cookie/consent handling,
or imprint/company identification. The site takes card payments, stores
encrypted identity documents (Stripe Identity + guest rosters), and sends
marketing-adjacent emails, so GDPR and Portuguese consumer law require, at
minimum:

- Terms and conditions of sale, including the cancellation policies the
  product already surfaces per stay/activity.
- Privacy policy covering guest identity data, Stripe, Hostify/Hostkit/Bokun
  processors, and analytics.
- Cookie consent if any non-essential storage/analytics runs client-side.
- Company identification (legal name, NIF, contact) and, for Portugal,
  Livro de Reclamações (complaints book) link in the footer.
- Checkout must reference and link the terms at the moment of purchase.

Portuguese consumer sales to Portuguese consumers should be available in
Portuguese; see localization under "Strongly recommended".

### 3. Fiscal and compliance sign-offs (legal blocker, business decision)

The machinery exists but is switched off; launching with it off means
operating an AL business without filing bulletins or issuing certified
invoices, which is not viable beyond a soft-launch window:

- **SIBA filing**: jobs stop after `validateSIBA`. Flipping
  `HOSTKIT_SIBA_SEND_ENABLED=true` starts filing with the authorities. Needs
  the business decision plus `HOSTKIT_API_KEYS` provisioned per property.
- **Certified invoicing**: `HOSTKIT_INVOICING_ENABLED=true`, after verifying
  the certified product ids against the production Hostkit account and
  deciding the issuance moment (manual via admin vs automatic
  post-confirmation). Invoices are a legal obligation for every sale.
- **Guest data retention**: `purge_after` is stored but nothing purges.
  Decide the retention window and implement the purge before the first real
  identity document ages out of its lawful basis.

### 4. Production environment checklist (operational blocker)

- Stripe live keys, live webhook endpoint + secret, and the Detours connected
  account verified in live mode (transfer split + reverse_transfer behave
  differently in test mode; do one real card end-to-end).
- Email domain authentication (SPF, DKIM, DMARC) for the transactional
  sender; confirmation and compliance reminder emails landing in spam is a
  de facto outage.
- `CRON_SECRET`, `HOSTKIT_API_KEYS`, Bokun credentials, Pusher, Redis, Sentry
  DSN, and the root admin seed present in the deploy environment (the build
  already runs migrations and admin seeding).
- Database backups with a tested restore, and Sentry alerting actually
  routed to a human (email/Slack), not just collected.

### 5. Minimum public content (credibility blocker)

The IA promises Homes, Activities, About Us, FAQ, Help, and an owner CTA.
Today only Homes and Activities exist. The bare minimum to look like a real
operator and satisfy support obligations:

- A contact/help page (email + phone), linked from the footer and order
  emails.
- An About Us page (short; the brand copy already exists in the legacy app).
- FAQ can launch with the five questions support will actually get (check-in,
  cancellation, invoices, guest registration, parking).
- The `/owner` acquisition funnel is not launch-blocking; a mailto CTA is
  acceptable at first.

## Strongly recommended before real traffic

Not strictly blocking, but each one is a known incident or lost revenue
waiting to happen:

- **Portuguese localization.** The rewrite is English-only; the customer base
  is booking stays in Portugal and the legacy site served pt/es. Portuguese
  first, Spanish later. Also a consumer-law consideration for PT customers.
- **Hostify reservation webhook or tighter availability refresh.** Today an
  OTA booking on another channel is only reflected after the nightly sync, so
  guests can select dates that will fail at the hold. The saga prevents
  double-charging (availability is re-checked at the hold), so this is a
  conversion/UX problem, not a correctness one, but it will generate support
  load. The planned webhook -> `resyncAccommodationListing` is the fix; a
  near-term (~90 day) refresh every few hours is the cheap interim.
- **Saga DB-integration tests.** The hold/confirm/compensate flow is the
  highest-consequence code in the product and only its seams are unit-tested.
  The integration-test pattern now exists
  (`packages/core/src/commerce/cart-items.integration.test.ts`); extend it to
  the saga happy path, payment-fail, compensation, and reconciler paths.
- **Funnel analytics completion.** Durable booking events exist; the
  search -> view -> quote -> checkout funnel is partial. Without it there is
  no way to see where launch traffic dies.
- **A staging smoke script.** One scripted end-to-end purchase (stay +
  activity, then refund) against staging after each deploy would have caught
  every recent cart/checkout regression.

## Explicitly fine to defer

- Spanish locale, the full `/owner` funnel, post-stay reconciliation beyond
  refunds/settlements, marketing pages beyond the minimum above, advanced
  admin (bulk actions, exports), and performance work beyond what Next
  caching already provides.

## Checklist

| # | Item | Type | Owner | Status |
|---|---|---|---|---|
| 1 | Register 8 crons + uptime alerts | Ops | Engineering | ⬜ |
| 2 | Terms, privacy, cookies, company id, complaints book | Legal | Business + Engineering | ⬜ |
| 3 | Terms linked in checkout | Legal | Engineering | ⬜ |
| 4 | SIBA send sign-off + `HOSTKIT_API_KEYS` | Compliance | Business | ⬜ |
| 5 | Invoicing enablement + issuance moment | Fiscal | Business + Engineering | ⬜ |
| 6 | Guest data retention/purge | Compliance | Engineering | ⬜ |
| 7 | Live Stripe + Detours verification, one real purchase | Ops | Engineering | ⬜ |
| 8 | Email domain auth (SPF/DKIM/DMARC) | Ops | Engineering | ⬜ |
| 9 | Backups with tested restore, alert routing | Ops | Engineering | ⬜ |
| 10 | Contact/Help, About, minimal FAQ pages | Content | Business + Engineering | ⬜ |
| 11 | Portuguese localization | Product | Engineering | Recommended |
| 12 | Hostify webhook or interim availability refresh | Product | Engineering | Recommended |
| 13 | Saga DB-integration tests | Quality | Engineering | Recommended |
| 14 | Funnel analytics completion | Product | Engineering | Recommended |
| 15 | Staging end-to-end smoke script | Quality | Engineering | Recommended |

When items 1 through 10 are checked, the product is viable for production.
