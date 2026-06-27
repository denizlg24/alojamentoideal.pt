# Order Page & Completion Flow (Roadmap M6+)

## Context

M5 (the reserve-first reservation saga) is implemented and green. A guest can now
pay and have a durable Hostify hold confirmed. What is missing is everything that
happens *after* the booking exists: the guest has no place to manage their stay.

This plan covers two deliverables:

1. **Improve the post-payment status page** (`/booking/complete`, plus the
   `unavailable`/failed surface). This is the unfinished **Part G** of the saga
   plan (`provider-reservation-saga.md`).
2. **Build `/order/[reference]`** — the durable, guest-facing order hub that
   handles: live host chat (Hostify inbox), guest registration data (Stripe
   Identity, structured Hostkit-ready), and inviting other people to join the
   booking.

It is large, so it is split into **Backend (B0-B4)** and **Frontend (F0-F4)**
stages, each sub-chunked so multiple agents can work in parallel. Read the
**Parallelization** section last — it maps stages to agents and dependencies.

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

- **Order access today** (`service.ts` `readOrderStatus`/`getOrderContact`):
  authorized by `isOrderAccessGranted({ cartToken, userId }, owner)` where
  `owner: CartOwner = { cartToken, userId }`. Two grant paths exist (anonymous
  cart cookie, or matching signed-in `userId`). **We add a third: a validated
  member access token.**
- **Order read model**: `readOrderStatus(publicReference, owner)` returns
  `{ bookingStatus, amountPaidMinor, totalMinor, currency, orderId, stripePaymentIntentId, publicReference }`.
  A fuller `readOrderDetail` does not exist yet.
- **`order_contacts.email` is required** — every order has a contact email to send
  the owner magic-link to. `orderTable.userId` may be null (anonymous checkout).
- **`bookingGuest` table already exists** (`schema.ts:~1122`) with `userId?`,
  `userIdentityDocumentId?`, `stripeVerificationSessionId`,
  `stripeVerificationReportId`, `identityStatus`
  (`missing|provided|processing|requires_input|verified|canceled`), encrypted
  snapshot columns, `purgeAfter`. Guest-data persistence is mostly modelled.
- **Stripe Identity exists but is account-scoped**:
  `createIdentityVerificationSession({ userId, returnUrl })` in
  `integrations/stripe/identity.ts`; `POST /api/account/identity-session` requires
  `getServerUser`; the identity webhook attributes the report to an account
  identity document. **B3 needs an order/guest-scoped variant that does not
  require a signed-in user** (keyed to a `bookingGuest` + member token).
- **Encryption**: `packages/core/src/account/identity-encryption.ts`
  (`ACCOUNT_IDENTITY_ENCRYPTION_KEY`) is the reusable envelope-encryption helper.
- **Hostify inbox client** (`integrations/hostify/client.ts:162`): `inbox.list(query)
  -> threads`, `inbox.get(id) -> thread`, `inbox.reply(HostifyReplyInput) -> id`,
  `inbox.receiveReply(...)`, plus image variants. `acceptReservation`/`declineReservation`
  act on inquiry `thread_id`, **not** host-created reservation ids (already
  established in the saga plan). Webhooks: doc references `message_new`
  (`data-architecture.md` §3.1); exact signature/payload is **unconfirmed** with
  Hostify.
- **`conversations` / `messages` tables do NOT exist yet.** They are specified in
  `data-architecture.md` §6.7 and are created in B2.
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
        /order/[reference]                  (durable hub; NEW)
            ├─ Overview   (status, dates, property, price)
            ├─ Messages   (Hostify inbox, realtime)
            ├─ Guests     (identity capture + Stripe Identity)
            └─ People     (invite/manage members)
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

> **Status: backend done; live-DB verification + frontend (F1) remain.** The full
> access spine (schema, tokens, resolve/redeem, the detail aggregate, and both
> routes) is landed and typechecks; only integration-level verification against a
> live DB and the F1 UI are outstanding.
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
> - Web wiring in `apps/web/lib/api/commerce.ts`: `readMemberToken`,
>   `resolveOrderAccessContext`, `memberCookie` (httpOnly `ai_order_member`,
>   holds the raw token, re-hashed per request).
> - `POST /api/orders/[reference]/access` redeems `?token=`/body token, sets the
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
> **Left**
> - Integration-level verification of the access matrix against a live DB (the
>   resolve/redeem/detail paths are exercised only by typecheck + pure unit tests
>   so far): token redeem idempotency, revoked/expired → 404, owner auto-resolve,
>   member field hiding.
> - Conversation refs in `readOrderDetail` are deferred to B2 (the
>   `conversations` table does not exist yet); the provisioning sub-state is B4.
> - **Known limitation**: a single `ai_order_member` cookie binds one member at a
>   time; visiting a second order overwrites it. `resolveOrderAccess` filters the
>   token by `order_id`, so a mismatched cookie is ignored (falls through to the
>   owner grant), but a member of two orders re-redeems on switch. Revisit if
>   multi-order membership becomes common.

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
- `POST /api/orders/[reference]/access` -> redeem `?token`, set scoped cookie, flip
  `invited -> active`, bind `user_id` when signed in.

**Verify**: token redeem is idempotent; revoked/expired tokens 404; owner
auto-resolves from cart/user without a token; sensitive fields hidden from
`member`.

### B1 — Membership & invitations  *(depends B0; pairs with F4)*

> **Status: backend done; live-DB verification + frontend (F4) remain.** No
> migration was needed (B0's `order_members` already carries `expires_at`,
> `invited_by_member_id`, and the status/role checks). Deviations from the bullets
> below, all deliberate:
>
> - **Owner provisioning is bound to the confirmation-email send, not the status
>   UPDATE.** `CommerceService.issueOwnerAccessToken(orderId, email)` (idempotent
>   ensure-or-rotate, persists only the hash) is called from
>   `sendOrderConfirmationEmail` — the one guarded, once-per-order action both the
>   webhook and the reconciler cron funnel through. That is the only place the raw
>   token can reach the email in *either* send path. The confirmation email's
>   "Manage reservation" CTA now points at `/order/[ref]?token=` (folded in, per
>   the A3 decision) via the shared `apps/web/lib/email/order-url.ts` helper.
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
>
> **Left**: live-DB verification of capacity races, the new unique index, revoke-
> kills-access mid-session, resend rotation, and owner auto-resolve; the F4 invites
> UI.

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

Schema:

- `conversations`: `id`, `order_id`, `provider_booking_id?`, `provider`,
  `external_thread_id?`, `status`, `last_message_at?`, `last_message_preview?`,
  `unread_count`, `last_synced_at?`, timestamps.
- `messages`: `id`, `conversation_id`, `external_message_id?`, `sender_type`
  (`guest|host|system`), `sender_member_id?` (app-origin author), `body`,
  `sent_at`, `read_at?`, `is_automatic`, `delivery_status`
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

- `RealtimePublisher` seam in core (`publishMessageCreated(conversationId, msg)`);
  Pusher implementation in the web app. Private channel per conversation
  (`private-order-<orderId>-conv-<convId>`). Webhook, cron and outbound all
  publish.
- `POST /api/realtime/auth` — Pusher channel-auth endpoint that **gates on
  `resolveOrderAccess`** before authorizing the subscription.
- Env (add to `turbo.json` passthrough + `.env.example`): `PUSHER_APP_ID`,
  `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`, `NEXT_PUBLIC_PUSHER_KEY`,
  `NEXT_PUBLIC_PUSHER_CLUSTER`.

**Verify**: webhook + cron converge idempotently (no dup messages); channel-auth
rejects non-members; outbound failure is retryable; preview/unread update.

### B3 — Guest registration + Stripe Identity (collect + verify; Hostkit deferred)  *(depends B0; pairs with F3)*

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

- Extend `readOrderStatus`/`readOrderDetail` to surface the provisioning sub-state
  (`held-unpaid | paid-confirming | confirmed | refunded`), guest-registration
  progress, conversation availability, and the owner `/order/[ref]` link. This is
  mostly shaping data the saga already persists; no new writes.

---

## Frontend

> Visual baseline is the legacy order page in
> `E:\Ocean Informatix\AlojamentoIdeal.pt\alojamentoideal`. Copy style per
> `AGENTS.md` (no host/marketplace language, no em dashes).

### F0 — Completion page + unavailable/failed surface  *(independent; can start now; finishes the M5 Part G gap)*

- `booking-complete-view.tsx`: distinct copy for `held-unpaid`/`paid-confirming`
  ("Payment received, finalizing your booking"), `confirmed` ("Booking
  confirmed") with a CTA into `/order/[ref]`, and `cancelled` ("Refunded — we
  couldn't confirm"). Keep polling/revalidate so the few-second provisioning delay
  resolves without a manual refresh.
- Handle the saga's `reservation_unavailable` (409) / transient (503) responses
  from the payment-intent route in the checkout UI (the other open Part G item):
  surface "these dates are no longer available" before any charge.
- Decide `/booking/failed`: recommend it stays a **state** of the complete view,
  with a thin `/booking/failed` alias only if the pre-charge `unavailable` case
  needs its own URL.

### F1 — `/order/[reference]` shell + overview + auth  *(depends B0)*

- Server component; resolve access via cookie or redeem `?token`; forbidden/expired
  states. Section nav: Overview / Messages / Guests / People (People only for
  owner). Overview renders status, dates, property, price (price owner-only).

### F2 — Live chat UI  *(depends B2)*

- Thread view + composer; subscribe to the Pusher private channel via a
  `use-realtime` hook; optimistic send reusing the `use-pending-messages.ts`
  pattern; unread markers; failed-send retry.

### F3 — Guest-data / identity UI  *(depends B3)*

- Per-guest identity form; launch Stripe Identity modal (reuse the account identity
  client); status badges from `identityStatus`; role-gated ("your details" for a
  member, "all guests" for the owner).

### F4 — Invite / members UI  *(depends B1)*

- Invite-by-email form (owner); members list with pending/active; resend/revoke.

---

## Cross-cutting

- **Migrations** (sequential after `0019`): `order_members` (**done** —
  `0020_married_prism.sql`); `order_members` partial-unique `(order_id, user_id)`
  (**done** — `0021_wandering_the_call.sql`, B1 review hardening); `conversations` +
  `messages` (B2). Do **not** create `guest_submission_jobs` yet (A1 — unused table).
- **Security/privacy**: access tokens are high-entropy and stored hashed; the
  `publicReference` is never sufficient for access on its own. Token expiry +
  rotation on resend. Guest PII stays encrypted and is never logged. Realtime
  channel-auth gates on order access. Invite/revoke + guest mutations go to
  `audit_log`. Redact Hostify webhook headers.
- **Observability**: events `order_member_invited`, `order_member_joined`,
  `conversation_message_sent`/`_received`, `guest_identity_verified`. Sentry on
  webhook signature failures and on Pusher publish failures (degrade to poll).
- **Env additions**: Pusher keys (B2). Both must land in `turbo.json`
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
