# Sync routes

These routes are operational endpoints that should be called by a scheduler to
keep Hostify-derived data fresh in the web app.

Production base URL: `https://alojamentoideal.pt`

All routes use:

- Method: `GET`
- Auth header: `Authorization: Bearer $CRON_SECRET`
- Secret source: `HOSTIFY_SYNC_CRON_SECRET` when set, otherwise `CRON_SECRET`
- Rate limit bucket: `cron`

If the secret is missing, the route returns `503`. If the bearer token is
missing or invalid, it returns `401`.

## Routes to ping

| Route | Purpose | Suggested cadence | Refresh effect |
| --- | --- | --- | --- |
| `/api/cron/hostify/listings` | Pulls Hostify listing changes into the local listing cache. | Every 15 minutes, or at least hourly. | Revalidates catalog list pages and each changed listing detail tag. |
| `/api/cron/hostify/reviews` | Pulls Hostify review changes and rating aggregates. | Every 30 minutes to 1 hour. | Revalidates catalog list pages and each listing whose review aggregate changed. |
| `/api/cron/hostify/pricing` | Advances the rolling nightly advisory price cache by one listing batch. | Every 15 minutes, or at least hourly. | Revalidates advisory pricing used by homes list filters and cards when nights changed. |
| `/api/cron/commerce/reservations` | Confirms paid provider holds, refunds failed confirmations, retries finalization emails, and releases abandoned checkout holds. | Every 5 minutes. This is a release blocker for reserve-first checkout. | Do not wire this with Vercel Cron Jobs. Register it in the same external scheduler as the Hostify crons with `Authorization: Bearer $CRON_SECRET`. |

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
```

## Notes

- Listing, review and pricing syncs are incremental and use provider sync state
  in the database.
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
