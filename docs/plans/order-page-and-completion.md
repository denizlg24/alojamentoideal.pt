# Order Page & Completion Flow (Roadmap M6+, implemented)

## Context

This document started as the M6+ implementation plan. As of **2026-07-01**, the
customer-facing reservation flow is implemented: `/booking/complete` handles
post-payment status, and `/order/[reference]` is the durable booking hub for
overview, stay details, owner messaging, guest registration, Stripe Identity and
guest-slot invitations.

The historical B0-B4/F0-F4 plan is kept below because it explains the contract
boundaries and implementation decisions. Treat the status snapshot in this
section as authoritative when it conflicts with older "left" notes lower in the
document.

## Current implementation status (2026-07-01)

**Done**

- `/booking/complete` polls the server-verified checkout order endpoint, separates
  `held-unpaid`, `paid-confirming`, `confirmed`, `refunded` and `cancelled`, and
  links paid or confirmed bookings into the order hub.
- `/order/[reference]` redeems owner/member magic links, sets the scoped member
  cookie, and renders an SSR hub shell with section navigation.
- Overview shows booking status, stay dates, payment method, owner-only pricing,
  contact details, price breakdown and management links.
- Stay details render the booked home's photos, amenities, house guide and map
  inside the private order context.
- Messages are owner-only, backed by Hostify conversation projection, Pusher
  private-channel auth, optimistic sends and retry for failed messages.
- Guest registration covers owner-managed slots, member-owned slots, guest invite,
  resend/revoke, manual identity entry, signed-in account identity reuse and
  guest-scoped Stripe Identity.
- Backend APIs exist for order detail, access redemption, conversations/messages,
  message retry, guest read/update, guest identity session, guest invite,
  residency save, account identity reuse, member resend and member revoke.
- Migrations through `0027_watery_gertrude_yorkes.sql` are present, including
  order payment-method display fields and pending-confirmation email retry fields.

**Still operational, not page-build blockers**

- Live Hostify validation remains needed for reservation-to-thread lookup,
  message sender classification, duplicate import behavior and far-future
  confirm-settle behavior.
- Live Pusher verification remains needed with production credentials and browser
  subscription checks.
- Live Stripe Identity verification remains needed for guest/order sessions and
  webhook delivery.
- No Hostkit SIBA submission connector exists yet. The app collects and verifies
  Hostkit-ready guest data only.

> A separate, already-shipped change (this same work session) added the
> `HOSTIFY_BOOKINGS_ENABLED` dev-safety flag (default on, opt-out) that runs the
> saga against a `StubReservationGateway` so no real bookings are placed. That is
> not part of this plan; it is noted because dry-run mode is how these stages get
> tested without touching the live Hostify account.

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| **A1** | Hostkit scope | **Collect + verify only.** Capture guest data + Stripe Identity, store encrypted in a Hostkit-ready shape. The Hostkit SIBA connector/cron is **deferred** to a follow-up plan. |
| **A2** | Live-chat realtime | **Managed realtime now** (recommend **Pusher Channels**; Ably/Upstash are drop-in alternatives behind the publisher seam). |
| **A3** | Order access model | **Reference + email magic-link.** No mandatory account. Invites are additional magic-links. An account, if present, may be *bound* to a member for convenience but is never required. |
| **A4** | Hostify flag | Shipped separately: default-on, opt-out dry-run. |

### Why these shape the architecture

- **A3** makes a **booking-access token** the spine of everything. `/order/[ref]`
  is not protected by the (guessable) `publicReference` alone — it is protected by
  a high-entropy, hashed-at-rest token delivered by email. Chat, invites, and
  guest-data routes all authorize through the same access context.
- **A2** splits chat into two latency layers. **Layer A** (Hostify -> our DB) is
  the freshness ceiling and is solved with a webhook + reconciler cron, mirroring
  M5. **Layer B** (our DB -> browser) is the managed-realtime publish/subscribe.
  Realtime never delivers faster than Layer A imports.
- **A1** keeps B3 to data capture + verification. We build the `bookingGuest`
  pipeline (which already exists in schema) up to `identityStatus = verified`, and
  leave a `guest_submission_jobs`-shaped seam without implementing the connector.

## Verified contracts (checked against current code)

- **Order access** (`service.ts` `readOrderStatus`/`readOrderDetail`):
  authorized by `isOrderAccessGranted({ cartToken, userId }, owner)` where
  `owner: CartOwner = { cartToken, userId }`. Two grant paths exist (anonymous
  cart cookie, or matching signed-in `userId`), plus the implemented third path:
  a validated member access token from the scoped order cookie.
- **Order read model**: `readOrderStatus(publicReference, owner)` returns the
  checkout status shape with `paymentStatus`, `bookingStatus`,
  `provisioningSubState`, totals and `orderUrl`. `readOrderDetail(access)` returns
  the full hub aggregate with role-filtered pricing, contact, members,
  conversations and guest-progress data.
- **`order_contacts.email` is required** — every order has a contact email to send
  the owner magic-link to. `orderTable.userId` may be null (anonymous checkout).
- **`bookingGuest` table already exists** (`schema.ts:~1122`) with `userId?`,
  `userIdentityDocumentId?`, `stripeVerificationSessionId`,
  `stripeVerificationReportId`, `identityStatus`
  (`missing|provided|processing|requires_input|verified|canceled`), encrypted
  snapshot columns, `purgeAfter`. Guest-data persistence is mostly modelled.
- **Stripe Identity supports account and booking-guest scopes**: account identity
  sessions still require a signed-in user; order guest sessions are keyed to a
  `bookingGuest` and authorized by order access, so invited guests do not need an
  account.
- **Encryption**: `packages/core/src/account/identity-encryption.ts`
  (`ACCOUNT_IDENTITY_ENCRYPTION_KEY`) is the reusable envelope-encryption helper.
- **Hostify inbox client** (`integrations/hostify/client.ts:162`): `inbox.list(query)
  -> threads`, `inbox.get(id) -> thread`, `inbox.reply(HostifyReplyInput) -> id`,
  `inbox.receiveReply(...)`, plus image variants. `acceptReservation`/`declineReservation`
  act on inquiry `thread_id`, **not** host-created reservation ids (already
  established in the saga plan). Webhooks: doc references `message_new`
  (`data-architecture.md` §3.1); exact signature/payload is **unconfirmed** with
  Hostify.
- **`conversations` / `messages` tables now exist.** B2 landed them in
  migration `0022_faulty_power_man.sql`, with order-scoping hardening in
  `0023_adorable_wendell_rand.sql`, following `data-architecture.md` §6.7.
- **Email**: `apps/web/lib/email/{order-confirmation,order-could-not-confirm}.ts`
  send via Resend (`@workspace/emails`, `RESEND_API_KEY`/`EMAIL_FROM`). Invite and
  owner-link emails are net-new templates here.
- **Crons** run from an external scheduler via `Authorization: Bearer $CRON_SECRET`
  (`isAuthorizedCronRequest`). `vercel.json` has **no** `crons` block by design.
  Register new crons in `docs/sync-routes.md`.
- **Completion page**: `app/booking/complete/page.tsx` renders
  `components/checkout/booking-complete-view.tsx`; `use-pending-messages.ts` is an
  existing optimistic-message pattern to reuse for chat.

---

## Page relationship & access model (read before any stage)

```
pay -> /booking/complete?ref=AI-...        (transient, polls status; existing)
            |  confirmation email contains
            v  /order/AI-...?token=<owner-token>
        /order/[reference]                  (durable hub)
            ├─ Overview   (status, dates, property, price)
            ├─ Messages   (owner-only Hostify inbox, realtime)
            ├─ Stay       (photos, amenities, guide, map)
            └─ Guests     (identity capture, Stripe Identity, guest invites)
```

**Access token model (the spine — B0):**

- `/order/[reference]` is reachable only with a valid **booking-access token**,
  not the `publicReference` alone (which is low-entropy and appears in emails).
- A token is delivered by email and redeemed at
  `/order/[reference]?token=<raw>`. Redemption validates the **hash** of the
  token against an `order_members` row, then sets a scoped, httpOnly cookie
  binding the browser to that member (and binds `member.user_id` if the visitor is
  signed in). Subsequent requests authorize from the cookie/session.
- Existing grant paths still work: the original cart cookie and a matching
  signed-in `userId` resolve to the **owner** member without a token.
- **Roles**: `owner` (booker — full: chat, invite, manage all guests, view price)
  and `member` (invited — view booking, chat, fill *their own* guest identity).
  Define the permission matrix once in core and reuse it in every route.

---

## Backend

### B0 — Order access spine + detail read model  *(blocks B1, B2, B3, F1)*

> **Status: implemented.** The access spine, detail aggregate, access routes and
> F1 overview UI are landed. Live-DB verification of edge cases remains an
> operational hardening item.
>
> **Done**
> - `order_members` table + migration `0020_married_prism.sql` (partial-unique
>   owner index, unique `access_token_hash`, role/status checks, self-FK for
>   `invited_by_member_id`). Exported from `@workspace/db`
>   (`orderMember`, `OrderMember`, `OrderMemberRole`, `OrderMemberStatus`).
> - `packages/core/src/commerce/order-access.ts`: `OrderRole`, the
>   `ORDER_PERMISSIONS` matrix + `orderRoleCan()`, token primitives
>   (`generateMemberToken` 256-bit base64url, `hashMemberToken` sha-256,
>   `isMemberTokenExpired`), and the `OrderAccessContext` / `ResolvedOrder` /
>   `ResolvedOrderAccess` types.
> - `CommerceService.resolveOrderAccess(reference, ctx)` (token path → owner
>   cart/user grant → `order_not_found`), a token-minting primitive (since
>   superseded in B1 by `issueOwnerAccessToken` and the inline send-first invite
>   path, and removed), and `redeemMemberToken(reference, rawToken, opts)`
>   (idempotent `invited → active`, binds `user_id`, stamps `last_seen_at`).
> - Web wiring in `apps/web/lib/api/commerce.ts`: `readMemberToken(reference)`,
>   `resolveOrderAccessContext(request, reference)`, `memberCookie(reference,
>   token)` (httpOnly order-scoped `ai_order_member.<ref>` cookie, holds the raw
>   token, re-hashed per request; legacy `ai_order_member` is read as a fallback).
> - `POST /api/orders/[reference]/access` redeems a body token only, sets the
>   scoped cookie, returns `{ reference, role }`; invalid/revoked/expired → 404.
> - `packages/core/src/commerce/order-detail.ts`: the `OrderDetail` read-model
>   types (items + `accommodation_item_details` + provider-booking status +
>   per-item charges + order pricing + contact + members + guest progress) and
>   the pure `summarizeGuestProgress` rollup (counts only, no PII).
> - `CommerceService.readOrderDetail(access)` builds the aggregate from a
>   `ResolvedOrderAccess` and role-filters sensitive sections: an `owner` sees
>   pricing, the tax/billing contact, the member roster, and per-item
>   money/charges; a `member` sees only the non-sensitive booking shape. (Note:
>   filtering is by `role` directly here; the `orderRoleCan` matrix is the reuse
>   point for the per-mutation routes in B1/B2/B3.)
> - `GET /api/orders/[reference]` → `resolveOrderAccess` + `readOrderDetail`,
>   authorized via `resolveOrderAccessContext`; unknown/unauthorized → 404.
> - Unit tests for the permission matrix, token helpers, and guest-progress
>   rollup (`order-access.test.ts`, `order-detail.test.ts`); db/core/web
>   typecheck clean.
>
> **Operational verification left**
> - Integration-level verification of the access matrix against a live DB (the
>   resolve/redeem/detail paths are exercised only by typecheck + pure unit tests
>   so far): token redeem idempotency, revoked/expired → 404, owner auto-resolve,
>   member field hiding.
> - **Review hardening:** member cookies are scoped by order reference so redeeming
>   a second order no longer overwrites the first; the access API no longer accepts
>   raw tokens in the query string.

Schema (`packages/db/src/schema.ts` + next migration after `0019`):

- New `order_members`: `id`, `order_id` (FK), `role` (`owner|member` check),
  `email` (lowercased), `user_id?` (FK, bound on sign-in), `access_token_hash`
  (unique, sha-256 of the raw token), `status` (`invited|active|revoked`),
  `invited_by_member_id?`, `expires_at?`, `created_at`, `accepted_at?`,
  `last_seen_at?`. Index `(order_id)`, partial unique `(order_id, role='owner')`.

Core (`packages/core/src/commerce/`):

- `OrderAccessContext` = `CartOwner` ∪ `{ memberToken?: string }` (resolved to a
  member row + role). One `resolveOrderAccess(reference, ctx)` that returns
  `{ order, member, role }` or throws `order_not_found` — used by **every**
  order-scoped route below. Extend/replace `isOrderAccessGranted` to include the
  token path.
- `issueMemberToken(orderId, role, email)` -> raw token (returned once) + persisted
  hash. Crypto-random (≥256-bit), single-use-redeem then cookie, with `expires_at`.
- `readOrderDetail(reference, access)` -> aggregate: order + items +
  `accommodation_item_details` + `order_item_charges` + provider-booking statuses +
  contact (owner only for tax/billing) + members summary + conversation refs +
  guest-registration progress. Role-filters sensitive fields.

Routes (`apps/web/app/api/orders/[reference]/`):

- `GET /api/orders/[reference]` -> `readOrderDetail`.
- `POST /api/orders/[reference]/access` -> redeem body token, set scoped cookie,
  flip `invited -> active`, bind `user_id` when signed in.

**Verify**: token redeem is idempotent; revoked/expired tokens 404; owner
auto-resolves from cart/user without a token; sensitive fields hidden from
`member`.

### B1 — Membership & invitations  *(depends B0; pairs with F4)*

> **Status: implemented.** Backend membership routes are landed, and the frontend
> invitation/resend/revoke workflow now lives in the Guests section instead of a
> separate People page. The existing B0 `order_members` table already carries
> `expires_at`,
> `invited_by_member_id`, and the status/role checks). Deviations from the bullets
> below, all deliberate:
>
> - **Owner provisioning is bound to the confirmation-email send, not the status
>   UPDATE.** `CommerceService.activateOwnerAccessToken(orderId, email, token)`
>   (idempotent ensure-or-rotate, persists only the hash) is called from
>   `sendOrderConfirmationEmail` before delivery — the one guarded,
>   once-per-order action both the webhook and the reconciler cron funnel through.
>   That is the only place the raw token can reach the email in *either* send path.
>   The confirmation email's "Manage reservation" CTA points at
>   `/order/[ref]?token=` (folded in, per the A3 decision) via the shared
>   `apps/web/lib/email/order-url.ts` helper.
> - **The member cap moved from invitation to acceptance.** Invites are unbounded
>   but short-lived (`INVITE_TOKEN_TTL_MS` = 24h); `redeemMemberToken` gates the
>   `invited -> active` flip on `canAcceptMember(activeCount, capacity)` where
>   `capacity = Σ(guests − infants)` over the order's accommodation items and the
>   owner counts as an active slot. The check runs under a `SELECT … FOR UPDATE`
>   on the order row so concurrent redemptions of the last slot serialize. New
>   error code `order_full` (409).
> - **"audit_log" is `trackEvent`** (Postgres analytics; no such table exists):
>   `order_member_invited`, `order_member_revoked`, `order_member_invite_resent`.
>   Raw tokens are never logged.
> - Routes: `POST /api/orders/[reference]/members` (invite),
>   `DELETE …/members/[id]` (revoke), `POST …/members/[id]/resend` (rotate+resend),
>   all `mutation`-bucket rate-limited and authorized through `resolveOrderAccess`
>   + the `ORDER_PERMISSIONS` matrix (`#assertOrderPermission`). Invite/resend send
>   `order-invite` emails (new `buildOrderInviteEmail` builder in `@workspace/auth`,
>   plain fallback, template-ready). Pure helpers unit-tested in
>   `order-access.test.ts`; core/auth/web typecheck + `bun test` clean.
> - **Review hardening (CodeRabbit pass):** owner provisioning locks the order
>   row and 404s a missing order (no first-insert race); redemption rejects a
>   duplicate active member by email *or* account under the lock, backed by a new
>   partial-unique `(order_id, user_id)` index (migration `0021_wandering_the_call`,
>   excluding revoked rows); resend re-arms from scratch (clears
>   `accepted_at`/`last_seen_at`/`user_id`); `order-url` fails closed when the
>   public origin is unset/invalid; invite + resend **deliver the email before
>   persisting** (a send failure leaves no dangling/rotated token — clean retry),
>   and invite reuses a still-pending row per recipient instead of piling up. A
>   durable invite-email **outbox is deliberately out of B1 scope** (the send-first
>   ordering is the proportionate guarantee until B2's delivery-status pattern).
> - **Post-B4 review hardening:** accepted members now clear `expires_at`; owner
>   rows are protected by a DB check requiring `expires_at is null`; the
>   order-member inviter relationship is order-scoped; fallback invite HTML emits
>   a real clickable link.
>
> **Operational verification left**: live-DB verification of capacity races, the
> unique index, revoke-kills-access mid-session, resend rotation and owner
> auto-resolve.

- **Owner provisioning**: on the `pending -> confirmed` transition (in the saga
  success path / webhook), create the `owner` member from `order_contacts.email`
  and issue its token; add the `/order/[ref]?token=` link to the existing
  confirmation email.
- `POST /api/orders/[reference]/members` (owner only): create `member` row
  (`invited`) + send invite email with token link. Rate-limit; cap member count.
- `DELETE /api/orders/[reference]/members/[id]` (owner only): revoke (token dies).
- `POST .../members/[id]/resend`: rotate token + resend.
- Optional account binding: redeeming while signed in sets `member.user_id`, so the
  order later appears under `/account`.
- Emails: `order-owner-link` (or fold into confirmation), `order-invite`.
- `audit_log` entries for invite/revoke; never log raw tokens.

**Verify**: only owner can invite/revoke; revoked member loses access mid-session;
re-invite rotates the token; member cap enforced.

### B2 — Conversations + messages + realtime  *(depends B0; pairs with F2)*

> **Status: implemented.** The durable conversation projection, outbound message
> route, reconciliation cron, Pusher auth/publisher seam and owner chat UI are
> landed. Hostify webhook ingestion is still intentionally deferred until Hostify
> confirms the signature and payload contract.
> Backend commits: `4565850 feat: add order conversation backend core` and
> `5fbc89f feat: wire order conversation routes`.
>
> **Done**
> - `conversations` + `messages` tables and migration
>   `0022_faulty_power_man.sql` with provider-booking/thread uniqueness,
>   idempotent external-message uniqueness, sender/delivery/status checks, and
>   exports from `@workspace/db`.
> - Review hardening in `0023_adorable_wendell_rand.sql`: denormalized
>   `provider_bookings.order_id` / `messages.order_id`, composite order-scoped
>   FKs across bookings, conversations, messages and sender members, plus one
>   live `order_members` row per normalized email.
> - `packages/core/src/commerce/conversations.ts`: provider conversation gateway
>   contract, Hostify inbox implementation (`inbox.list`, `inbox.get`,
>   `inbox.reply`), DTOs, realtime publisher seam, channel-name helper, and
>   normalization tests.
> - `CommerceService` conversation methods: list conversations, read messages,
>   send optimistic guest messages (`pending -> sent|failed`), retry failed
>   messages, provision confirmed-booking conversations, and reconcile Hostify
>   threads/messages idempotently. `readOrderDetail` now surfaces conversation
>   refs.
> - Web wiring: Hostify conversation gateway + Pusher publisher in
>   `apps/web/lib/api/commerce.ts`, Pusher server helper in
>   `apps/web/lib/api/realtime.ts`, and API routes:
>   - `GET /api/orders/[reference]/conversations`
>   - `GET|POST /api/orders/[reference]/conversations/[conversationId]/messages`
>   - `POST /api/orders/[reference]/conversations/[conversationId]/messages/[messageId]/retry`
>   - `GET /api/cron/commerce/conversations`
>   - `POST /api/realtime/auth`
> - Env/docs: `pusher` dependency, Pusher vars in `.env.example` and `turbo.json`,
>   and the conversation cron registered in `docs/sync-routes.md`.
> - **Post-B4 review hardening:** `messages.delivery_status` now defaults to
>   `pending`; provider messages with missing/invalid timestamps are skipped
>   instead of stamped with reconciliation time; message reads fetch the latest
>   page and return it chronologically; retry sends are guarded by an atomic
>   `failed -> pending` transition; provider message imports use atomic upsert;
>   composite nullable FKs use `SET NULL` semantics aligned with the
>   single-column FKs; the Pusher server helper is marked `server-only`.
> - Verification passed:
>   - `bun run --filter @workspace/db typecheck`
>   - `bun run --filter @workspace/core typecheck`
>   - `bun run --filter @workspace/core test`
>   - `bun run --filter web typecheck`
>   - `bun run --filter web test`
>   Commit hooks also ran full `turbo typecheck` and `turbo test`.
>
> **Left**
> - Live Hostify verification of reservation-to-thread lookup, message sender
>   classification, and duplicate import behavior.
> - Realtime integration verification with real Pusher app credentials and browser
>   subscription flow.
> - Hostify `message_new` webhook route once the signature, event id, and payload
>   shape are confirmed.
> - Browser/Pusher subscription verification with real credentials.

Schema:

- `conversations`: `id`, `order_id`, `provider_booking_id?`, `provider`,
  `external_thread_id?`, `status`, `last_message_at?`, `last_message_preview?`,
  `unread_count`, `last_synced_at?`, timestamps.
- `messages`: `id`, `order_id`, `conversation_id`, `external_message_id?`,
  `sender_type` (`guest|host|system`), `sender_member_id?` (app-origin author),
  `body`, `sent_at`, `read_at?`, `is_automatic`, `delivery_status`
  (`pending|sent|failed`), `raw_payload?`, timestamps. Unique
  `(conversation_id, external_message_id)` where not null.
- Thread linkage: on `pending -> confirmed`, resolve the reservation's Hostify
  thread (`inbox.list` filtered by reservation / `inbox.get`) and create the
  conversation with its `external_thread_id`.

**Layer A — inbound (Hostify -> DB):**

- `POST /api/webhooks/hostify` — verify signature (**Hostify contract TBD**),
  record in `integration_events` (dedupe), upsert the `messages` row, then publish
  realtime. **Blocked on Hostify webhook docs**; ship the cron first.
- `GET /api/cron/commerce/conversations` (bearer `CRON_SECRET`) — reconciler
  backstop: for active conversations, pull recent thread messages via `inbox.get`,
  dedupe by `external_message_id`, update unread/preview. Register in
  `docs/sync-routes.md`. This is the durability authority; the webhook is the
  latency optimisation (same split as the M5 reservation cron).

**Outbound (guest -> Hostify):**

- `POST /api/orders/[reference]/conversations/[id]/messages` (member authz):
  persist optimistic (`delivery_status: pending`) -> `inbox.reply` -> reconcile
  `external_message_id`/`sent`; on failure mark `failed` for retry.

**Layer B — realtime (DB -> browser):**

- `RealtimePublisher` seam in core (`publishConversationUpdated(orderId,
  conversation)`, `publishMessageCreated(orderId, conversationId, msg)`);
  Pusher implementation in the web app. Private channel per conversation uses
  encoded parts:
  `private-order.<base64url(orderId)>.conv.<base64url(conversationId)>`. Cron
  and outbound publish now; webhook publishing is deferred with the webhook
  route.
- `POST /api/realtime/auth` — Pusher channel-auth endpoint that **gates on
  `resolveOrderAccess`** before authorizing the subscription.
- Env (add to `turbo.json` passthrough + `.env.example`): `PUSHER_APP_ID`,
  `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`, `NEXT_PUBLIC_PUSHER_KEY`,
  `NEXT_PUBLIC_PUSHER_CLUSTER`.

**Verify**: webhook + cron converge idempotently (no dup messages); channel-auth
rejects non-members; outbound failure is retryable; preview/unread update.

### B3 — Guest registration + Stripe Identity (collect + verify; Hostkit deferred)  *(depends B0; pairs with F3)*

> **Status: implemented.** The order/guest-scoped identity capture backend and
> guest registration UI are landed. Live Stripe/API verification remains.
>
> **Done**
> - `booking_guests.order_member_id` landed in migration
>   `0024_little_mathemanic.sql` so a member can own exactly one slot per booking.
> - Review hardening added `booking_guests.order_id` plus order-scoped composite
>   FKs for `(provider_booking_id, order_id)` and `(order_member_id, order_id)` in
>   `0025_unknown_jocasta.sql`, preventing cross-order guest/member assignment.
> - `packages/core/src/commerce/order-guests.ts`: guest identity DTOs, purge
>   support-window helper, and Stripe Identity-to-guest-status mapping.
> - `parseUpdateBookingGuestsBody` validates guest identity payloads, including
>   ISO `documentExpiresOn` and uppercase ISO country codes.
> - `CommerceService.readBookingGuests` and `updateBookingGuests`: owner can
>   manage all slots; a member can claim/update only their own slot; identity
>   fields are encrypted and guest mutations emit `guest_identity_provided`.
> - Manual identity edits now invalidate stale Stripe verification/session fields
>   and reset `identityStatus` to `provided`.
> - `POST .../guests/[guestId]/identity-session`: creates guest-scoped Stripe
>   Identity sessions without requiring a signed-in account.
> - Stripe Identity webhook now handles account-scoped and booking-guest sessions;
>   guest reconciliation first matches by session id and falls back to Stripe
>   metadata `bookingGuestId` for unlinked session cleanup failures.
> - Routes landed:
>   - `GET|PUT /api/orders/[reference]/bookings/[bookingId]/guests`
>   - `POST /api/orders/[reference]/bookings/[bookingId]/guests/[guestId]/identity-session`
> - Tests cover guest purge/status helpers, request parsing, and Stripe webhook
>   metadata normalization.
>
> **Left**
> - Live Stripe Identity verification using a guest/order session and webhook
>   delivery.
> - Live DB verification of member-owned guest slot claiming and cross-order FK
>   enforcement.
> - Hostkit SIBA connector/cron remains deferred by A1.

- Guest service + routes scoped to a `provider_booking` within an order, authorized
  via `OrderAccessContext`: a `member` fills *their own* guest slot; the `owner`
  manages all slots.
  - `GET/PUT /api/orders/[reference]/bookings/[bookingId]/guests` — capture
    identity fields, encrypt with `identity-encryption`, set
    `identityStatus = provided`.
- **Order/guest-scoped Stripe Identity** (the gap): add a session creator keyed to
  `bookingGuest` (not `getServerUser`):
  - `POST .../guests/[guestId]/identity-session` -> create Stripe verification
    session with metadata linking to `bookingGuest.id`, store
    `stripeVerificationSessionId`, return client secret.
  - Extend the existing Stripe Identity webhook to attribute reports to a
    `bookingGuest` (by metadata) as well as account documents: flip
    `identityStatus -> verified`, store `stripeVerificationReportId`, populate the
    encrypted snapshot from verified data.
- **Hostkit-ready, not Hostkit-wired (A1)**: store data and statuses in the shape a
  future `guest_submission_jobs` worker needs (per `data-architecture.md` §6.6/2.7),
  but **do not** build the Hostkit connector, credentials, or
  `removeAllGuests/addGuest/validateSIBA` cron. Leave a clearly-marked TODO seam.

**Verify**: a guest with no account completes Stripe Identity via token access;
webhook flips status without a session; encrypted columns never logged; `purgeAfter`
set per retention policy.

### B4 — Completion status read enhancements  *(depends B0; small; feeds F0/F1)*

> **Status: implemented.**
>
> **Done**
> - `readOrderStatus` and `readOrderDetail` now surface
>   `conversationAvailability`, `guestProgress`, `provisioningSubState`, and
>   relative `orderUrl`.
> - `provisioningSubState` distinguishes `held-unpaid`, `paid-confirming`,
>   `confirmed`, `refunded`, and review-added `cancelled` so unpaid cancellations
>   are not mislabeled as refunds.
> - Conversation availability is derived from linked/active conversation rows.
> - Tests cover provisioning sub-state mapping and conversation availability.
>
> **Left**
> - No known page-build items. Continue to verify the rare provider-confirmation
>   delay states against live Hostify data.

- Extend `readOrderStatus`/`readOrderDetail` to surface the provisioning sub-state
  (`held-unpaid | paid-confirming | confirmed | refunded | cancelled`),
  guest-registration progress, conversation availability, and the owner
  `/order/[ref]` link. This is mostly shaping data the saga already persists; no
  new writes.

---

## Frontend

> Visual baseline is an AirBnB style order page. UI should be intuitive, clear, clean and minimalistic.
> Avoid heavy cards and borders, for popovers, dialogs, always think of UX on mobile first. Copy style per
> `AGENTS.md` (no host/marketplace language, no em dashes).

### F0 — Completion page + unavailable/failed surface  *(done)*

- `booking-complete-view.tsx`: distinct copy for `held-unpaid`/`paid-confirming`
  ("Payment received, finalizing your booking"), `confirmed` ("Booking
  confirmed") with a CTA into `/order/[ref]`, and `cancelled` ("Refunded — we
  couldn't confirm"). Keep polling/revalidate so the few-second provisioning delay
  resolves without a manual refresh.
- Handle the saga's `reservation_unavailable` (409) / transient (503) responses
  from the hold-reservation route in the checkout UI:
  surface "these dates are no longer available" before any charge.
- Decide `/booking/failed`: recommend it stays a **state** of the complete view,
  with a thin `/booking/failed` alias only if the pre-charge `unavailable` case
  needs its own URL.

### F1 — `/order/[reference]` shell + overview + auth  *(done)*

- Server component; resolve access via cookie or redeem `?token`; forbidden/expired
  states. Section nav: Overview / Messages / Stay / Guests, with Messages
  owner-only. Overview renders status, dates, property, payment method, contact,
  price breakdown and owner-only pricing.

### F2 — Live chat UI  *(done)*

- Thread view + composer; subscribe to the Pusher private channel via a
  `use-realtime` hook; optimistic send reusing the `use-pending-messages.ts`
  pattern; unread markers; failed-send retry.

### F3 — Guest-data / identity UI  *(done)*

- Per-guest identity form; launch Stripe Identity modal (reuse the account identity
  client); status badges from `identityStatus`; role-gated ("your details" for a
  member, "all guests" for the owner).

### F4 — Invite / members UI  *(done inside Guests)*

- Invite-by-email form is attached to each guest slot in the Guests section. Owner
  can invite a guest to fill their own details, resend pending invites, cancel
  invites and remove assigned guests. There is no separate People page.

---

## Cross-cutting

- **Migrations** (sequential after `0019`): `order_members` (**done** —
  `0020_married_prism.sql`); `order_members` partial-unique `(order_id, user_id)`
  (**done** — `0021_wandering_the_call.sql`, B1 review hardening); `conversations` +
  `messages` (**done** — `0022_faulty_power_man.sql`, B2); order-scoped
  conversation/member integrity hardening (**done** —
  `0023_adorable_wendell_rand.sql`); `booking_guests.order_member_id` (**done** —
  `0024_little_mathemanic.sql`, B3); review hardening for guest/order scope,
  owner-token expiry, message defaults, and nullable composite FKs (**done** —
  `0025_unknown_jocasta.sql`). Do **not** create `guest_submission_jobs` yet (A1 —
  unused table).
- **Security/privacy**: access tokens are high-entropy and stored hashed; the
  `publicReference` is never sufficient for access on its own. Token expiry +
  rotation on resend. Guest PII stays encrypted and is never logged. Realtime
  channel-auth gates on order access. Invite/revoke + guest mutations go to
  `audit_log`. Redact Hostify webhook headers.
- **Observability**: events `order_member_invited`, `order_member_joined`,
  `conversation_message_sent`/`_received`, `guest_identity_verified`. Sentry on
  webhook signature failures and on Pusher publish failures (degrade to poll).
- **Env additions**: Pusher keys (B2) are landed in `turbo.json`
  `globalPassThroughEnv` (server) / `globalEnv` (the `NEXT_PUBLIC_*` pair) and
  `.env.example`.

## Parallelization (agent map)

```
B0 (spine) ──┬─> B1 ──> F4
             ├─> B2 ──> F2
             ├─> B3 ──> F3
             └─> B4 ──> F1 overview
F0 ── independent (start immediately)
```

- **Must be first / alone**: B0 (every order route depends on `resolveOrderAccess`
  and the migration). Land it before fanning out.
- **Then fully parallel backend**: B1, B2, B3 touch disjoint tables/routes; one
  agent each. B4 is small and can ride with B0 or B1.
- **Frontend** pairs with its backend stage; F0 and F1-overview can begin against
  mocked reads while B-stages finish. Suggested pairing per domain: chat =
  B2+F2, guests = B3+F3, invites = B1+F4.

## Open risks / must-confirm

- **Hostify webhook contract** (signature, `message_new` payload, dedupe key) is
  unconfirmed. Build B2's cron backstop first; treat the webhook as an
  optimisation that ships once Hostify confirms the contract.
- **Thread ↔ reservation mapping** reliability (`inbox.list` filters) — same
  uncertainty M5 flagged for reconcile-before-create. Validate against a real
  Hostify response.
- **Stripe Identity without a logged-in user** — confirm a verification session
  can be created standalone and attributed purely by metadata (expected, but
  verify against the live API before B3).
- **Magic-link exposure** via forwarded emails — mitigate with short `expires_at`,
  single-redeem-to-cookie, and rotation on resend.
- **Pusher cost/limits & channel-auth correctness** — the auth endpoint is the only
  thing standing between a guessed channel name and another guest's chat; test it
  hard.

## References

- `provider-reservation-saga.md` (M5; Part G is finished here).
- `data-architecture.md` §6.7 (conversations/messages), §6.6/2.7 (guest data +
  Hostkit), §2.10 (legacy messaging), §3.1 (Hostify `message_new`).
- Existing seams: `apps/web/lib/api/commerce.ts` (`resolveReservationGateway`,
  `StubReservationGateway`), `integrations/stripe/identity.ts`,
  `account/identity-encryption.ts`, `integrations/hostify/client.ts` `inbox.*`,
  `components/checkout/use-pending-messages.ts`.
