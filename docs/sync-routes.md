# Sync routes

These routes are operational endpoints that should be called by a scheduler to
keep provider-derived data fresh and commerce state durable in the web app.

Production base URL: `https://alojamentoideal.pt`

All routes use:

- Method: `GET`
- Auth header: `Authorization: Bearer $CRON_SECRET`
- Alternate auth header: `x-cron-secret: $CRON_SECRET`
- Secret source in code: `HOSTIFY_SYNC_CRON_SECRET` when set, otherwise
  `CRON_SECRET`
- Rate limit bucket: `cron`
- Success response shape: `{ "success": true, "data": ... }`

If the secret is missing, the route returns `503`. If the bearer token is
missing or invalid, it returns `401`.

Do not wire these with Vercel Cron Jobs for this project. Register them in the
external scheduler that already calls the Hostify syncs.

## Routes to ping

| Route | Purpose | Suggested cadence | Refresh effect |
| --- | --- | --- | --- |
| `/api/cron/hostify/listings` | Pulls Hostify listing changes into the local listing cache. | Every 15 minutes, or at least hourly. | Revalidates catalog list pages and each changed listing detail tag. |
| `/api/cron/hostify/reviews` | Pulls Hostify review changes and rating aggregates. | Every 30 minutes to 1 hour. | Revalidates catalog list pages and each listing whose review aggregate changed. |
| `/api/cron/hostify/pricing` | Advances the rolling nightly advisory price cache by one listing batch. | Every 15 minutes, or at least hourly. | Revalidates advisory pricing used by homes list filters and cards when nights changed. |
| `/api/cron/commerce/reservations` | Confirms paid provider holds, sends pending-confirmation nudges, retries finalization emails, compensates/refunds failed confirmations, and releases abandoned checkout holds. | Every 5 minutes. This is a release blocker for reserve-first checkout. | Sends confirmation, pending and compensation emails through the route's email handlers. Keep this on the same external scheduler as the Hostify crons. |
| `/api/cron/commerce/conversations` | Provisions order conversations for confirmed Hostify bookings and imports inbox messages into the local projection. | Every 1 to 5 minutes. | Publishes realtime updates when Pusher is configured; otherwise keeps the polling read model fresh. Keep this on the same external scheduler as the Hostify crons. |
| `/api/cron/commerce/guest-submissions` | Sweeps confirmed bookings with a complete guest roster into `guest_submission_jobs`, syncs each roster to Hostkit (removeAllGuests, addGuest per guest, validateSIBA; sendSIBA only when `HOSTKIT_SIBA_SEND_ENABLED=true`), and sends guest-info reminder emails for incomplete rosters. | Every 15 to 30 minutes. | Hostkit retries ride reservation-ingestion lag ("Unknown reservation code" retries on a 5m-6h ladder). Guest-info reminders use reverse backoff, halving the remaining time to check-in after each successful email with 4h and 14d bounds. Listings without a `HOSTKIT_API_KEYS` entry park their jobs on a 6h cadence without consuming attempts. |
| `/api/cron/commerce/refunds` | Reconciles the manual refund ledger: resumes `pending` refund rows left by a crash between the amount reservation, the Stripe call, and the ledger update, and retries Detours transfer reversals that failed after their refund succeeded. | Every 10 to 15 minutes. | Only touches `pending` rows older than 10 minutes, which keeps it clear of a normal in-flight admin refund; an unusually slow admin request can still overlap one run. Safe to rerun and safe under that overlap: every Stripe call reuses the row's stored idempotency key, and the reservation cancel path is guarded by a per-booking mutation lock. |
| `/api/cron/bokun/activities` | Polls the configured Bokun activity list into the local activities cache. | Ping hourly; the route self-gates to one real sync per `BOKUN_ACTIVITY_SYNC_INTERVAL_HOURS` (default 24h) and answers `skipped` in between. | Revalidates the activities list tag and each changed activity detail tag. A failed run schedules a retry within minutes instead of waiting a full interval; a sync lease (default 10 min) prevents overlapping runs. |

## Example pings

```bash
curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://alojamentoideal.pt/api/cron/hostify/listings

curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://alojamentoideal.pt/api/cron/hostify/reviews

curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://alojamentoideal.pt/api/cron/hostify/pricing

curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://alojamentoideal.pt/api/cron/commerce/reservations

curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://alojamentoideal.pt/api/cron/commerce/conversations

curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://alojamentoideal.pt/api/cron/commerce/guest-submissions

curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://alojamentoideal.pt/api/cron/commerce/refunds

curl -fsS \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://alojamentoideal.pt/api/cron/bokun/activities
```

## Notes

- Listing, review and pricing syncs are incremental and use provider sync state
  in the database.
- Commerce reservation reconciliation is the durability authority for reserve-first
  checkout. The Stripe webhook is only the low-latency path.
- Commerce conversation reconciliation is the durability authority for Hostify
  inbox projection until a Hostify message webhook contract is confirmed.
- Guest submission has no other trigger: the cron sweep alone enqueues and
  processes Hostkit/SIBA jobs (including re-enqueueing when a roster changes
  after a successful submission), so registering this route is what turns the
  M8 compliance half on.
- Refund reconciliation is likewise the only recovery path for a refund that
  crashed mid-flight or a transfer reversal that failed after its refund; the
  admin UI creates the ledger rows, the cron finishes stuck ones.
- The Bokun activities sync stores its own sync state and interval; the
  scheduler cadence only bounds how quickly a due sync is picked up, so an
  hourly ping is cheap and keeps failure retries prompt.
- Review and pricing syncs intentionally skip while the listing sync state is not
  `complete`. After a fresh database reset, keep pinging `/api/cron/hostify/listings`
  until it completes before expecting review or pricing data to fill in.
- Pricing sync stores a forward-looking nightly price window. Its window size is
  controlled by `ACCOMMODATION_NIGHTLY_PRICE_SYNC_DAYS`. Each request processes
  up to `ACCOMMODATION_NIGHTLY_PRICE_SYNC_BATCH_SIZE` listings, then advances the
  cursor until the pricing cycle completes and waits for
  `ACCOMMODATION_NIGHTLY_PRICE_SYNC_INTERVAL_HOURS`.
- Live availability and quote routes are user-facing request APIs, not scheduled
  sync routes:
  - `/api/accommodations/availability`
  - `/api/accommodations/quote`
  - `/api/accommodations/search`
