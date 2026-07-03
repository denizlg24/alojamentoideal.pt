# Sync routes

These routes are operational endpoints that should be called by a scheduler to
keep Hostify-derived data fresh in the web app.

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
| `/api/cron/commerce/guest-submissions` | Sweeps confirmed bookings with a complete guest roster into `guest_submission_jobs`, then syncs each roster to Hostkit (removeAllGuests, addGuest per guest, validateSIBA; sendSIBA only when `HOSTKIT_SIBA_SEND_ENABLED=true`). | Every 15 to 30 minutes. | Retries ride Hostkit's reservation-ingestion lag ("Unknown reservation code" retries on a 5m-6h ladder). Listings without a `HOSTKIT_API_KEYS` entry park their jobs on a 6h cadence without consuming attempts. |

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
