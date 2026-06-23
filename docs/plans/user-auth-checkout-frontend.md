# Frontend Airbnb-Style Booking + Auth + Stripe Elements

## Context

The cart/auth backend foundation is already present or planned in
`docs/plans/user-auth-cart-management.md`: DB-backed carts, anonymous cart ownership through the
`ai_cart` httpOnly cookie, optional user linking, cart claim on login, Stripe-backed discounts, and
draft-order creation through `POST /api/checkout/draft-order`.

This pass builds the **frontend booking process** around that foundation. The target experience is an
Airbnb-style "Confirm and pay" flow using the reference screenshots:

1. A focused checkout page with a compact brand header, back button, left-side step cards, and a
   sticky reservation summary on desktop.
2. Three visible steps: choose when to pay, add a payment method, review your reservation.
3. In-page dialogs for price breakdown, date changes, guest changes, and currency selection.
4. Login and registration pages that can be used standalone or from checkout without losing the cart.
5. Stripe Elements for embedded payment collection. The visitor should not be sent to Stripe Checkout.

Business constraints still apply: Alojamento Ideal is a single operator with its own apartments and
activities. Checkout copy must not imply third-party hosts, marketplace listings, or "book with hosts".
Use "home", "apartment", "stay", "Alojamento Ideal team", and "guest" language.

### Current frontend seams

- `apps/web/components/listings/detail/booking-widget.tsx` already builds a reserve URL:
  `/homes/[id]/book?checkIn=...&checkOut=...&adults=...`.
- `apps/web/app/homes/[id]/page.tsx` is a Server Component detail page that passes serializable
  listing props into the client booking widget.
- `apps/web/lib/auth/client.ts` already re-exports Better Auth client helpers.
- `apps/web/lib/auth/session.ts` and `/api/me` already provide server-readable session state.
- `apps/web/app/api/cart/*` already exposes create, read, add item, update item, validate, discount,
  and claim routes.
- `POST /api/checkout/draft-order` currently returns `{ orderId, publicReference, status: "draft",
  checkoutExpiresAt }` (verified: `DraftOrderResponse` in `packages/core/src/commerce/types.ts`). It
  does **not** return a Stripe `clientSecret`, nor the order **amount/currency**. The payable amount
  lives only on the persisted order, so the new payment-intent route must re-read it server-side.

### Next.js constraints checked locally

The installed Next docs live under `apps/web/node_modules/next/dist/docs/`.

- Use App Router `page.tsx` and route-handler files.
- In Next 16, `params` and `searchParams` are Promise props in pages.
- Pages and layouts are Server Components by default; interactive checkout, auth forms, dialogs, and
  Stripe Elements must be client components behind narrow `"use client"` boundaries.
- With `cacheComponents: true`, request-specific cart/session work must be dynamic and wrapped in
  `Suspense` where it is read by Server Components.
- Route handlers are not cached by default for non-GET methods. Treat all checkout/auth mutations as
  public API endpoints and re-check ownership or session server-side.

### Verified contracts (checked against current code)

These were read from the codebase and constrain the implementation. Do not re-derive them.

- **Cart create** (`POST /api/cart`, `parseCreateCartBody`): body `{ cartId?: uuid, idempotencyKey? }`,
  both optional. Returns `{ cart: CartDto }` and sets the `ai_cart` cookie. Does **not** seed an item.
- **Add item** (`POST /api/cart/[cartId]/items`, `parseAddCartItemBody`): `idempotencyKey` is
  **required** (8-160 chars, regex `^[A-Za-z0-9._:-]+$`); also `listingId, checkIn, checkOut, guests`
  required, `adults/children/infants/pets` optional, `clientMutationId` optional. The server forces a
  fresh quote (`forceFresh: true`). Returns `CartMutationResponse { cart, item, quote }`.
- **Update item** (`PATCH /api/cart/[cartId]/items/[itemId]`): `idempotencyKey` **required**; all stay
  fields optional.
- **Discount** (`POST /api/cart/[cartId]/discount`): `{ code (regex ^[A-Za-z0-9-]+$, ≤64),
  idempotencyKey? }`.
- **Draft order** (`POST /api/checkout/draft-order`): accepts a nested `contact {…}` object (preferred)
  or legacy flat fields. Contact **requires only `name`, `email`, and a phone** (`phone` or
  `phoneE164`). `billingAddress` and all its lines, `companyName`, `taxNumber`, `notes`, `isCompany`
  are optional; `isCompany` defaults `false`. There is **no real E.164 normalization** server-side
  (`phone` is stored as-is into `phoneE164`), so the client must send a correctly formatted number.
- **Money**: `CartDto`/`CartItemDto`/`CommerceQuoteDto` expose amounts in **minor units** (`*Minor`).
  Core `money.ts` only converts *to* minor units (`toMinorUnits`, `minorUnitFactor`); there is **no**
  minor-unit display formatter. `formatListingMoney` (used by the booking widget) takes *major* units,
  so checkout needs its own `formatMinor(amountMinor, currency)` built on `minorUnitFactor` + `Intl`.
- **Auth** (`packages/auth/src/runtime.ts`): `emailAndPassword.requireEmailVerification: true`,
  `emailVerification.sendOnSignUp: true`, `autoSignInAfterVerification: true`. Sign-up therefore does
  **not** create a session. Google is enabled **only** when `GOOGLE_CLIENT_ID/SECRET` are set
  (`socialProviders` is `{}` otherwise). A `session.create.after` hook already merges the anonymous
  `ai_cart` cookie into the user on every login/verification; `/api/cart/claim` is the idempotent
  backup path, not the only one.
- **Stripe server** (`packages/core/src/integrations/stripe/client.ts`): `createStripeClientFromEnv()`
  exists (SDK `stripe@22`, `apiVersion` pinned to `2026-05-27.dahlia`). `resolvePromotionCode(stripe,
  code)` shows the house pattern: helpers receive an injected `Stripe` instance for testability.

---

## Decisions

### Route model

- **Primary checkout route:** `apps/web/app/homes/[id]/book/page.tsx`.
  - This is the route already linked from the listing booking widget.
  - It reads listing detail server-side for the summary shell, then lets the client checkout controller
    create or load the cart.
  - Query parameters seed the first cart item: `checkIn`, `checkOut`, `adults`, `children`, `infants`,
    `guests`.
- **Optional cart route:** `apps/web/app/cart/page.tsx`.
  - A simple review page for visitors who used "Add to cart".
  - It can be deferred if the first milestone is single-home booking only.
- **Auth routes:** `apps/web/app/login/page.tsx`, `apps/web/app/register/page.tsx`,
  `apps/web/app/forgot-password/page.tsx`, and `apps/web/app/reset-password/page.tsx`.
  - All accept `next` as a return path.
  - Checkout uses `next=/homes/[id]/book?...` so login/register returns to the same booking.
- **Completion route:** `apps/web/app/booking/complete/page.tsx`.
  - Reads Stripe return params and our `orderId`/`publicReference` query params.
  - Shows pending, succeeded, failed, or action-required states based on server verification, not only
    client state.

### Checkout step behavior

- Step 1, **Choose when to pay**
  - Show `Pay EUR X now` as selected.
  - Do not show a working installments option unless it is backed by a Stripe-supported method and an
    approved business rule. If shown later, it must come from server capability data.
  - After confirmation, collapse to a compact card with a `Change` button.
- Step 2, **Add a payment method**
  - If checkout does not already have contact details from the signed-in user or saved draft state,
    collect guest contact and billing/tax fields before mounting Stripe Elements. The current
    draft-order API requires this contact snapshot before a payable order can be created.
  - Embed Stripe Payment Element inside the page.
  - Use Stripe's rendered payment-method UI for cards, wallets, MB WAY, PayPal, and Google Pay where
    enabled and supported. Do not build fake card fields or collect PAN/CVC in app code.
  - Surround the Payment Element with the Airbnb-style card, step title, state summary, and `Next`
    button.
  - Optionally add `ExpressCheckoutElement` above the Payment Element if wallet buttons are enabled.
- Step 3, **Review your reservation**
  - Show the final stay summary, contact summary, payment-method summary, booking terms checkbox,
    cancellation/refund summary, and final `Confirm and pay` button.
  - The button validates cart freshness, refreshes the PaymentIntent if needed, then calls
    `stripe.confirmPayment`.

### Payment flow

Use Stripe Payment Element with the Payment Intents API, not Stripe Checkout. Stripe currently
recommends Checkout Sessions with Elements for many custom checkout integrations, but this app already
owns cart totals, discount provenance, draft orders, provider workflows, and post-payment booking
state. Payment Intents keep that existing commerce boundary intact.

1. Checkout controller validates or creates the cart from the listing route params.
2. Visitor completes contact and billing details if they are not already available.
3. `POST /api/checkout/draft-order` creates the draft order after quote revalidation.
4. New backend route `POST /api/checkout/payment-intent` creates or updates a PaymentIntent for that
   draft order and returns `{ clientSecret, paymentIntentId, orderId, publicReference }`.
5. Client mounts Stripe Elements with the returned `clientSecret`.
6. Visitor enters payment details inside the Payment Element.
7. Review step shows the collapsed contact and payment summaries.
8. On final submit, call `stripe.confirmPayment({ elements, confirmParams: { return_url },
   redirect: "if_required" })`.
9. For non-redirect methods, handle the resolved `paymentIntent` in-page and navigate to
   `/booking/complete?order=...`.
10. For redirect-required methods or SCA, the visitor returns to `/booking/complete`; the page verifies
   status server-side before showing success.

Stripe docs support this shape: the Payment Element collects details in the site, and
`redirect: "if_required"` avoids redirecting for normal card payments while still supporting methods
that require customer authorization.

### State model

Keep state local to checkout for the first pass. Do not add a global store unless cart state must be
shared across many unrelated pages later.

- `CheckoutController` client component owns:
  - active step;
  - cart DTO;
  - selected item id;
  - contact/billing form draft;
  - applied discount code and mutation status;
  - draft order response;
  - Stripe client secret;
  - submission and error state.
- `apps/web/lib/checkout/` contains API clients and small pure helpers:
  - `api-client.ts` for cart, checkout, discount, and payment-intent fetches;
  - `idempotency.ts` for stable per-action keys;
  - `format.ts` for checkout-specific labels, including the `formatMinor(amountMinor, currency)`
    helper checkout needs (core has no minor-unit display formatter; build on `minorUnitFactor`);
  - `errors.ts` for normalizing route-handler errors into UI messages.
- Keep server-only commerce helpers in `apps/web/lib/api/`. Do not import them into client components.

### Visual direction

The checkout should feel familiar to Airbnb users but remain Alojamento Ideal branded.

- Desktop: centered max-width shell, two-column layout, left step flow around 520-620px, right summary
  around 360-420px, sticky summary below header.
- Mobile: one-column flow, summary collapsed near top, bottom `Confirm and pay` action only when final
  step is valid.
- Cards: use 16-24px radius only for checkout step cards and dialogs, matching the reference.
- Typography: reuse the app fonts from `app/layout.tsx` (`Hanken Grotesk` and `Bricolage Grotesque`).
- Color: use Alojamento Ideal's brand accent instead of Airbnb red. Avoid copying the Airbnb logo,
  brand marks, or exact palette.
- Copy: no em dashes and no marketplace/host wording.

---

## Part A - Checkout Route Shell

Create `apps/web/app/homes/[id]/book/page.tsx`.

- Parse `params` and `searchParams` as Promises per Next 16.
- Load listing detail with `getCachedCatalogDetail(id, getListingCatalogScope(), "en")`.
- Use `notFound()` for missing listing.
- Build serializable `initialStay` props:
  - listing id, title, cover photo, location label;
  - check-in/check-out;
  - adults, children, infants, guest capacity;
  - max guests, min nights, currency.
- Render a checkout-specific header:
  - brand/logo back to home;
  - circular back button to the listing detail;
  - no full marketing nav during checkout.
- Render `<CheckoutController initialListing={...} initialStay={...} />`.
- Add `metadata` title such as `Confirm and pay`.

Create route-level loading/error UI:

- `apps/web/app/homes/[id]/book/loading.tsx`: skeleton for step cards and summary.
- `apps/web/app/homes/[id]/book/error.tsx`: recoverable error with "Return to home" and "Try again".

---

## Part B - Cart Bootstrap From Listing

Build a client-side bootstrap path that converts the listing route params into the cart backend.

Flow:

1. On mount, call `POST /api/cart`. `idempotencyKey` is optional here; the response sets the `ai_cart`
   cookie and returns `{ cart: CartDto }`. Reuse an existing cart id from `sessionStorage` first to
   avoid spawning a new cart on reload.
2. Call `POST /api/cart/[cartId]/items` using the route params. `idempotencyKey` is **required** and
   must match `^[A-Za-z0-9._:-]+$` (8-160 chars) — generate it from listing id + dates + guests so it
   is stable across reloads. Pass a matching deterministic `clientMutationId`.
3. If the same booking route reloads, avoid duplicate items by either:
   - relying on the deterministic `idempotencyKey`/`clientMutationId` above, or
   - detecting an equivalent active cart item (`CartItemDto`) and `PATCH`ing it instead of adding.
4. Call `POST /api/cart/[cartId]/validate` before enabling payment.
5. Persist only non-secret convenience state in `sessionStorage`, such as the last cart id and draft
   form values. Never persist `cartToken`, card details, or Stripe client secrets.

UX states:

- Loading: show the three checkout cards with skeleton body.
- Quote changed: show inline notice "Your stay price was refreshed" and update totals.
- Unavailable: keep the visitor on the page, open the dates dialog, and explain that those dates are
  no longer available.
- Cart ownership failure: show a generic "We could not find this booking session" message and offer
  to restart from the listing.

---

## Part C - Airbnb-Style Checkout Components

Create `apps/web/components/checkout/`.

Core components:

- `checkout-controller.tsx`
  - Client boundary.
  - Owns step reducer, API mutations, cart state, and Stripe state.
- `checkout-layout.tsx`
  - Two-column desktop layout and mobile stack.
- `checkout-header.tsx`
  - Compact brand header and back button.
- `checkout-step-card.tsx`
  - Shared card shell for expanded/collapsed steps.
- `pay-timing-step.tsx`
  - "Pay now" selection and future installments placeholder if enabled by server capabilities.
- `payment-method-step.tsx`
  - Stripe Elements mount, payment status, and next-step validation.
- `review-reservation-step.tsx`
  - Contact summary, terms agreement, final CTA.
- `contact-billing-form.tsx`
  - Guest contact, billing address, company/tax fields, and checkout notes.
  - The draft-order schema only **requires** `name`, `email`, and a valid phone; billing address,
    `taxNumber`, `companyName`, and `notes` are optional. Decide as a product choice whether to enforce
    a full billing address / tax number client-side (e.g. for invoicing). Default to the schema's
    minimum unless the business wants stricter invoicing data. Show tax/company fields only when
    `isCompany` is checked.
- `reservation-summary.tsx`
  - Sticky summary card with listing image, title, review data if available, dates, guests, price lines.
- `price-breakdown-dialog.tsx`
  - Modal matching the reference breakdown.
- `change-dates-dialog.tsx`
  - Two-month desktop calendar, one-month mobile calendar, clear/save actions.
- `change-guests-dialog.tsx`
  - Adults, children, infants controls, capacity guard, pets disabled unless the listing supports pets.
- `currency-dialog.tsx`
  - Currency selection UI. First pass can be display-only with EUR selected unless multi-currency is
    actually implemented server-side.
- `discount-code-form.tsx`
  - Applies/removes Stripe promotion codes through `/api/cart/[cartId]/discount`.
- `checkout-alert.tsx`
  - Normalized errors and quote refresh notices.

Use existing `@workspace/ui` primitives: `Button`, `Dialog`, `Drawer`, `RadioGroup`, `Input`,
`Label`, `Separator`, `Skeleton`, `Accordion`, `Popover`, and `Calendar`/`react-day-picker`.

---

## Part D - Dates, Guests, Price Breakdown, Currency

### Dates dialog

- Reuse `ListingCalendar` and `useBookingAvailability` patterns where possible.
- On save:
  - call `PATCH /api/cart/[cartId]/items/[itemId]` with new dates and idempotency key;
  - revalidate cart;
  - clear any stale draft order or PaymentIntent;
  - refresh Elements by requesting a new client secret after the updated draft order.
- Keep the selected range highlighted like the reference: dark endpoints and a light range fill.

### Guests dialog

- Use the existing guest count semantics from `apps/web/lib/catalog/guests.ts`.
- Adults minimum 1.
- Children count toward capacity.
- Infants do not count toward capacity, matching current booking widget logic.
- Pets stay disabled unless provider/listing data confirms they are allowed.
- Copy should say "This home has a maximum of X guests" and avoid host phrasing.

### Price breakdown dialog

- Source all amounts from `CartDto` and `CartItemDto.quote`.
- Show base/night line, taxes, discount, and total.
- If the current quote was lower than a previous quote in the same session, it is acceptable to show
  "Price refreshed for these dates". Do not claim "below the 60-day average" unless backend data
  actually supports that comparison.

### Currency dialog

- First pass: list currencies visually if desired, but keep EUR selected and disable save for other
  currencies unless server-side pricing and payment currency conversion are implemented.
- Later pass: add `apps/web/lib/site/currency.ts` plus a real server-supported display currency model.

---

## Part E - Login, Registration, Password Recovery

Create `apps/web/components/auth/` and the auth pages.

Pages:

- `/login`
  - Email/password form.
  - Optional Google button. The auth config enables Google **only** when server env vars are set, and
    the client cannot read that config. Surface a `googleEnabled` boolean from the page Server Component
    (read the auth config server-side and pass it as a prop) rather than guessing client-side.
  - "Continue to checkout" behavior through `next`.
  - The `session.create.after` hook already merges the anonymous cart on login. Still call
    `POST /api/cart/claim` (idempotent) as the resilient path, then route to `next`.
- `/register`
  - Name, email, password, confirm password, marketing opt-in if approved later.
  - **Sign-up does not create a session** (`requireEmailVerification: true`, `sendOnSignUp: true`).
    After sign-up, show a "verify your email" state and do **not** assume an authenticated user.
  - Do **not** call `/api/cart/claim` here — there is no session yet. The cart is merged automatically
    by the `session.create.after` hook when the verification link is opened
    (`autoSignInAfterVerification: true`) or on the next login. `/api/cart/claim` is the idempotent
    backup for whenever a session next exists.
  - The verification link may be opened in a different tab/device, so the original checkout tab must
    tolerate completing as a guest or re-checking session state on focus.
- `/forgot-password`
  - Email form using Better Auth reset-password API.
- `/reset-password`
  - Token-aware reset form. Exact token param should follow Better Auth's installed API.

Components:

- `auth-card.tsx`
- `login-form.tsx`
- `register-form.tsx`
- `forgot-password-form.tsx`
- `reset-password-form.tsx`
- `auth-return-link.tsx`

Security and UX:

- Never reveal whether an email exists in forgot-password responses.
- Use native input types and autocomplete attributes.
- Surface verification requirements clearly.
- Keep checkout guest-first: login is helpful, not mandatory, unless a future business rule requires
  accounts.

---

## Part F - Stripe Elements Frontend

Add **frontend** dependencies to `apps/web` (the server SDK `stripe@22` is already installed in
`packages/core`; do not re-add it):

- `@stripe/stripe-js`
- `@stripe/react-stripe-js`

Create:

- `apps/web/lib/checkout/stripe.ts`
  - exports `getStripe()` using `loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)`;
  - validates the publishable key at runtime with a clear UI error in development.
- `apps/web/components/checkout/stripe-payment-form.tsx`
  - wraps `<Elements stripe={stripePromise} options={{ clientSecret, appearance }}>`.
- `apps/web/components/checkout/payment-element.tsx`
  - renders `PaymentElement`.
  - validates through `stripe.confirmPayment` in this plan's PaymentIntent-first path.
  - Do not use Stripe's deferred-intent pattern in the first pass unless preserving the exact
    reference step order becomes more important than keeping order creation before payment collection.

Appearance:

- Use Stripe Elements `appearance` variables to align border radius, font family, and brand accent
  with Alojamento Ideal.
- Do not use iframes or custom inputs outside Stripe for sensitive card fields.
- Do not log `clientSecret`, card details, or Stripe element error payloads with sensitive data.

Payment method notes:

- Cards and wallets can stay fully embedded for the normal path.
- MB WAY is a Portugal wallet method and can be presented through Elements when enabled in Stripe.
- Some methods require customer authorization or redirect. Use `redirect: "if_required"` and handle
  both in-page and return-url completions.

---

## Part G - PaymentIntent Backend Addition Required

The existing draft-order route is not enough for Stripe Elements because the client needs a
PaymentIntent `client_secret`.

Create route:

- `apps/web/app/api/checkout/payment-intent/route.ts`

Request:

```ts
interface CreatePaymentIntentBody {
  cartId: string;
  orderId: string;
  idempotencyKey?: string;
}
```

Response:

```ts
interface CreatePaymentIntentResponse {
  amountMinor: number;
  clientSecret: string;
  currency: string;
  orderId: string;
  paymentIntentId: string;
  publicReference: string;
}
```

Server behavior:

- Resolve `CartOwner` via `resolveCartOwner(request)` (same helper the existing routes use) and
  re-check cart/order ownership. Wrap in `withApiRoute` with a `checkout.write` rate-limit bucket to
  match the draft-order route.
- Re-read the draft order from the database and verify it is still payable. `DraftOrderResponse` does
  not carry the amount, so the persisted order is the only authoritative source.
- Create or update one Stripe PaymentIntent per draft order, using `createStripeClientFromEnv()` and a
  helper that **receives the `Stripe` instance** (mirror `resolvePromotionCode(stripe, …)`) for
  testability. The SDK already pins `apiVersion` centrally; do not set it per-call.
- Amount is `order.totalMinor`, currency is the order currency.
- Metadata includes `orderId`, `publicReference`, `cartId`, and environment.
- Use idempotency key based on `orderId` and attempt number.
- Return only the `client_secret`, never the Stripe secret key.
- If amount is zero, return a typed `zero_total` response and let checkout skip Stripe confirmation.

Core package additions:

- `packages/core/src/commerce/payments.ts` or similar narrowly scoped file.
- `packages/core/src/integrations/stripe/payment-intents.ts`.
- Types exported from `@workspace/core/commerce`.

This route belongs in the backend implementation slice, but the frontend cannot complete without it.

**Also missing for `/booking/complete`:** the completion page is specified to verify payment/booking
status server-side, but no read endpoint exists for that yet. Add a server-verified status read (e.g.
`GET /api/checkout/order/[publicReference]` resolving `CartOwner` and returning a typed
`{ paymentStatus, bookingStatus }`), or have the page's Server Component read the order via the
existing commerce service. Do not derive "confirmed" from the client `paymentIntent.status` alone.

---

## Part H - Review And Confirm Flow

Final submit sequence:

1. Disable all final-submit controls.
2. Validate terms locally for fast feedback.
3. `POST /api/cart/[cartId]/validate`.
4. If invalid, update UI with item-level failures, clear the draft order and PaymentIntent, and return
   to the affected edit step.
5. If the cart total, discount, dates, guests, or contact snapshot changed since the PaymentIntent was
   created, recreate the draft order and PaymentIntent, remount Stripe Elements, and return to step 2.
6. Call `stripe.confirmPayment`.
7. On immediate success, navigate to `/booking/complete?order=...`.
8. On `requires_action` or redirect return, let `/booking/complete` verify status.
9. On payment failure, keep the visitor on step 2 and show the Stripe error in a concise alert.

Important: provider reservation confirmation remains server/webhook territory. The frontend should not
mark a booking confirmed just because `stripe.confirmPayment` returned success. The completion page
should distinguish payment received, booking confirmation pending, and booking confirmed once backend
workflow state exists.

---

## Part I - Analytics And Observability

Use the taxonomy in `docs/data-architecture.md`.

Emit only consent-safe frontend events:

- `checkout_started`
- `checkout_step_viewed`
- `checkout_validation_failed`
- `payment_started`
- `payment_failed`

Server-side route handlers remain the source for:

- `order_created`
- `payment_succeeded`
- `booking_confirmed`
- `order_confirmed`

Do not include names, email, phone, tax numbers, exact addresses, card details, Stripe client secrets,
or free-text notes in browser analytics.

Also add Sentry breadcrumbs around:

- cart bootstrap;
- cart validation;
- draft order creation;
- PaymentIntent creation;
- Stripe confirmation result category.

---

## Files

**Create:**

- `apps/web/app/homes/[id]/book/page.tsx`
- `apps/web/app/homes/[id]/book/loading.tsx`
- `apps/web/app/homes/[id]/book/error.tsx`
- `apps/web/app/booking/complete/page.tsx`
- `apps/web/app/login/page.tsx`
- `apps/web/app/register/page.tsx`
- `apps/web/app/forgot-password/page.tsx`
- `apps/web/app/reset-password/page.tsx`
- `apps/web/app/api/checkout/payment-intent/route.ts`
- `apps/web/app/api/checkout/order/[publicReference]/route.ts` (backend: server-verified status read for
  `/booking/complete`)
- `apps/web/components/checkout/*`
- `apps/web/components/auth/*`
- `apps/web/lib/checkout/{api-client,errors,format,idempotency,stripe}.ts`
- `packages/core/src/commerce/payments.ts`
- `packages/core/src/integrations/stripe/payment-intents.ts`

**Modify:**

- `apps/web/components/listings/detail/booking-widget.tsx`
  - Wire "Add to cart" to real cart APIs.
  - Keep "Reserve" pointing to `/homes/[id]/book`.
- `apps/web/package.json`
  - Add Stripe frontend packages.
- `packages/core/src/commerce/types.ts`
  - Add payment-intent response types if shared with frontend.
- `packages/core/src/index.ts`
  - Export new payment helpers if they live in core.
- `.env.example`
  - Add `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` if missing.
  - Confirm `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are documented.

**Reuse:**

- `apps/web/lib/auth/client.ts`
- `apps/web/lib/auth/session.ts`
- `apps/web/lib/api/commerce.ts`
- `apps/web/app/api/cart/*`
- `apps/web/app/api/checkout/draft-order/route.ts`
- `apps/web/components/listings/detail/listing-calendar.tsx`
- `apps/web/components/listings/detail/use-booking-availability.ts`
- `apps/web/lib/catalog/{dates,guests,pricing-display}.ts`
- `@workspace/ui` components.

---

## Verification

1. **Types/build**
   - `bun --cwd apps/web run typecheck`
   - `bun --cwd apps/web run build`
2. **Unit tests**
   - Checkout API client success/error normalization.
   - Idempotency-key helper stability.
   - Price-breakdown formatting with base, taxes, discounts, and zero-total.
   - Guest capacity rules.
3. **Route-handler tests**
   - `/api/checkout/payment-intent` rejects missing session/cart ownership.
   - PaymentIntent amount equals draft order total.
   - Same idempotency key does not create duplicate PaymentIntents.
   - Zero-total order skips PaymentIntent cleanly.
4. **Manual desktop flow**
   - Open a listing, select dates/guests, click Reserve.
   - Checkout creates a cart item and shows the summary.
   - Change dates and guests from dialogs; totals refresh.
   - Apply and remove a Stripe test promotion code.
   - Complete card payment in-page with Stripe test card.
   - Land on booking completion page with verified payment status.
5. **Manual auth flow**
   - Start checkout as guest.
   - Register from checkout.
   - Verify email if required.
   - Return to checkout and confirm cart is claimed.
   - Login with an existing account and confirm `/api/cart/claim` is idempotent.
6. **Responsive checks**
   - Desktop 1440px.
   - Laptop 1280px.
   - Tablet 768px.
   - Mobile 390px and 360px.
   - No clipped dialogs, hidden buttons, or overlapping sticky summary.
7. **Payment method checks**
   - Card with no redirect.
   - Card requiring 3DS.
   - Wallet buttons where available.
   - MB WAY in Stripe test/sandbox once enabled for the account.

---

## Open Risks / Notes

- Stripe Elements still may redirect or show external authorization for SCA and redirect-based payment
  methods. The app controls collection and confirmation, but banks and wallets can require extra steps.
- MB WAY availability depends on Stripe account/payment-method configuration and current Stripe support.
- The frontend cannot honestly show "price below 60-day average" without backend comparison data.
- The reference screenshots contain host/marketplace copy. Do not port that wording.
- The first pass can be accommodation-only. Activities and mixed carts should reuse the same checkout
  shell once activity cart items and Bokun question forms are ready.
- Completion UX depends on backend payment/webhook/order state. Until the full confirmation workflow is
  implemented, show "Payment received" separately from "Booking confirmed".

## References

- Stripe Payment Element: <https://docs.stripe.com/payments/payment-element>
- Stripe Payment Intents with Elements: <https://docs.stripe.com/payments/accept-a-payment?api-integration=paymentintents&payment-ui=elements>
- Stripe `confirmPayment` redirect behavior: <https://docs.stripe.com/js/payment_intents/confirm_payment>
- Stripe React SDK: <https://docs.stripe.com/sdks/stripejs-react>
- Stripe MB WAY: <https://docs.stripe.com/payments/mb-way>
