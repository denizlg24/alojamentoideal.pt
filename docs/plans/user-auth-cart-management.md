# Cart Auth Wiring + Stripe Discounts + Auth Backend Completion

## Context

Another agent shipped the cart/checkout **backend foundation** (roadmap Milestone 3): DB-backed
`cart`/`order` schema (migration `0011_low_peter_quill.sql`), a `CommerceService`
(`packages/core/src/commerce/service.ts`) with idempotent cart mutations, quote revalidation, and a
draft-order flow, plus REST routes under `apps/web/app/api/cart/*` and `apps/web/app/api/checkout/*`.

The code is functionally solid (strict zod parsing, durable idempotency via `apiIdempotencyKey`,
Hostify error mapping, money in minor units) but has gaps. This pass closes all of them:

1. **Cart ownership / user accounts**: carts have no `userId` and no ownership check; anyone with a
   `cartId` can read/mutate (IDOR). Wire Better Auth identity in, hybrid guest+linked model.
2. **Auth backend completion**: Better Auth is fully wired except email delivery is a `console.log`
   placeholder and there is no password-reset flow. Wire Resend; add reset.
3. **Discounts through Stripe**: `cart.discountMinor`/`order.discountMinor` columns exist but are
   dead; `sumCartTotals` never subtracts them and `buildDraftOrderRows` hardcodes `discountMinor: 0`.
4. **Quote-revalidation race**, **`publicReference` insert race**, **client-suppliable cartId**: the
   three correctness items flagged in review, now fixed (not deferred).

### Decisions (confirmed with user)
- **Ownership: Hybrid.** Anonymous carts secured by the secret `cartToken` in an httpOnly cookie;
  optional `userId` link when authenticated; anonymous cart merged into the user on login. Preserves
  guest checkout, closes the IDOR hole, mirrors legacy localStorage-cart behavior.
- **Auth email: wire Resend** behind a pluggable seam, minimal HTML now; structured so brand HTML
  (built later with Maizzle) drops in without touching call sites.
- **Discounts: Stripe is the source of truth.** We do **not** own a discount-code table or redemption
  rules — Stripe owns the coupons/promotion codes. Our system resolves the coupon against Stripe
  (authoritative percentage or fixed amount), applies it to the **housing fee only (never tax)**,
  caps it at the housing-fee subtotal, recomputes totals, and registers it as applied on cart/order.
  Supports both percentage and fixed coupons.
- **Account scope: carts only (minimal).** `userId` on `cart` and `order` (order stamped at
  checkout). No `my carts`/`my orders` list endpoints this pass.

---

## Part A — Schema + migration (`packages/db/src/schema.ts`, generates `0012_*.sql`)

ID strategy is `text` PK, snake_case columns, `timestampWithTimezone`, money as `bigint` `*Minor`.
The `user` table is defined earlier in the same file.

- `cart.userId`: `text("user_id").references(() => user.id, { onDelete: "set null" })` (nullable) +
  `index("carts_user_id_idx")`.
- `order.userId`: same nullable FK + `index("orders_user_id_idx")`.
- `cart.appliedDiscount`: `jsonb("applied_discount").$type<AppliedDiscountSnapshot>()` (nullable) —
  provenance + resolved value of a Stripe coupon currently on the cart (see Part D). `discountMinor`
  already exists and holds the computed amount.
- `order.appliedDiscount`: same nullable jsonb — frozen at checkout.
- `accommodationQuoteSnapshot.housingFeeMinor`: `bigint` (nullable) — pre-tax housing/base-price
  amount derived at normalize time from the base-price (`isBasePrice`) fee lines. This is the
  discountable base; keeps totals computation off the jsonb hot path.

Canonical exported type in `@workspace/db`:
```ts
export type AppliedDiscountSnapshot =
  | {
      source: "stripe";
      couponId: string;
      promotionCode: string | null; // the code the customer entered
      type: "percentage";
      percentBasisPoints: number; // 1000 = 10%
      amountMinor: null;
      currency: null;
    }
  | {
      source: "stripe";
      couponId: string;
      promotionCode: string | null; // the code the customer entered
      type: "fixed";
      percentBasisPoints: null;
      amountMinor: number; // fixed coupons; in cart currency
      currency: string;
    };
```

Generate with `npm run db:generate`; do not hand-author the SQL. All columns nullable → non-breaking.

---

## Part B — Cart ownership (the core security fix)

New owner-context type (`packages/core/src/commerce/types.ts`):
```ts
export interface CartOwner { userId: string | null; cartToken: string | null; }
```

A private `#assertCartAccess(tx, cartId, owner)` guard, called at the top of every cart-scoped
operation. Access is granted iff:
- `owner.userId` set and `cart.userId === owner.userId` (authenticated owner), or
- `cart.userId` is null, `owner.cartToken` set, and a constant-time compare matches `cart.cartToken`.

On failure throw `CommerceError("cart_not_found", 404)` (404 not 403 → existence not enumerable).

`CommerceService` changes (`service.ts`):
- Add `owner: CartOwner` parameter to `createCart`, `getCart`, `addItem`, `updateItem`, `removeItem`,
  `validateCart`, `createDraftOrder` (kept separate from zod bodies; owner derives from cookie/session).
- `createCart`: stamp `userId: owner.userId ?? null`. The "return existing cart by client id" branch
  (`service.ts:306`) must run `#assertCartAccess` first so a supplied id cannot hijack a cart.
- `createDraftOrder`: stamp `order.userId = owner.userId ?? null`.
- New `claimCart(owner, cartToken)`: `UPDATE cart SET user_id = :userId WHERE cart_token = :token AND
  user_id IS NULL AND status = 'draft'`. Idempotent. Returns `CartResponse`.

### Client-suppliable cartId → UUID (fixes IDOR surface + idempotency colon ambiguity)
`createCartSchema.cartId` is currently `idString` (any chars, ≤128). Constrain to `z.string().uuid()`.
This removes the colon-collision risk in idempotency scopes (`cart:${cartId}:items:create`) and keeps
ids unguessable. Item ids are already server-generated UUIDs.

---

## Part C — Routes, cookie, session helper, merge

- New `apps/web/lib/auth/session.ts`: `getServerUser(request)` wrapping
  `getAuth().api.getSession({ headers })` (DRYs the inline pattern in `app/api/me/route.ts`).
- In `apps/web/lib/api/commerce.ts`: `readCartToken(request)` (reads `ai_cart` httpOnly cookie) and a
  `resolveCartOwner(request)` building `CartOwner` from `getServerUser` + `readCartToken`.
- Every cart/checkout route resolves `CartOwner` and passes it to the service. `POST /api/cart`
  appends `Set-Cookie: ai_cart=<cartToken>` (httpOnly, secure, `sameSite=lax`, path `/`, ~14d to
  match `CART_TTL_MS`). `withApiRoute` only `.set()`s its own headers, so the appended `Set-Cookie`
  survives. `cartToken` is already in `CartDto`, so no shape change.
- New `apps/web/app/api/cart/claim/route.ts` — `POST`, authed: merges the cookie's anonymous cart into
  the user via `claimCart`. Bucket `cart.write`.
- **Auto-merge on login**: in `packages/auth/src/runtime.ts`, add a Better Auth
  `databaseHooks.session.create.after` hook that reads the request `ai_cart` cookie and runs the same
  claim SQL inline (keeps `packages/auth` off a `core/commerce` dependency; it already imports
  `@workspace/db`). The `/api/cart/claim` endpoint remains the resilient/testable path; both converge
  on identical SQL. If the installed Better Auth version cannot read request cookies in the hook,
  drop the hook and rely on the endpoint (noted as a fallback).

---

## Part D — Discounts via Stripe (housing fee only)

### Stripe integration (new)
- Add `stripe` dependency to `packages/core` (`bun add stripe`); env `STRIPE_SECRET_KEY`.
- New `packages/core/src/integrations/stripe/client.ts`: `createStripeClientFromEnv()` and
  `resolvePromotionCode(code): Promise<AppliedDiscountSnapshot | null>` — looks up the active
  promotion code, expands its coupon, and maps `percent_off`→`percentBasisPoints` /
  `amount_off`→`amountMinor`. Returns null/throws `CommerceError("discount_invalid", 422)` for
  unknown/inactive/expired codes. **Authoritative server-side resolution — never trust a client-sent
  percentage/amount.**

### Housing-fee derivation
Add `housingFeeMinor(feeLines)` helper (in `totals.ts`/`money.ts`), summing the net of base-price
(`isBasePrice`) lines, reusing the same net logic as `toDraftChargeRow` (extract a shared helper so
charge rows and housing base agree). Store the result in `accommodationQuoteSnapshot.housingFeeMinor`
at normalize time (`normalizeAccommodationQuoteSnapshot`).

### Applying + recompute
- New service methods `applyDiscount(cartId, code, owner)` and `removeDiscount(cartId, owner)`.
  `applyDiscount` resolves the code via Stripe, stores the `AppliedDiscountSnapshot` on
  `cart.appliedDiscount`, then recomputes.
- Extend `#recalculateCartTotals`: also aggregate `housingFeeMinor` across active valid items
  (housing base). If `cart.appliedDiscount` is set, compute
  `discount = type==='percentage' ? round(housingBase * bp / 10000) : amountMinor`, then
  `discount = min(discount, housingBase)` (cap; never touches tax). Persist
  `cart.discountMinor = discount` and `cart.totalMinor = subtotal + tax - discount`. With no discount,
  behaviour is unchanged (discount 0). Because recompute runs on every mutation, the discount
  auto-re-caps as the cart's housing base changes.
- `sumCartTotals` gains a `housingBaseMinor` aggregate in its return (pure, unit-tested).

### New routes
- `POST /api/cart/[cartId]/discount` — body `{ code, idempotencyKey }`, applies; bucket `cart.write`.
- `DELETE /api/cart/[cartId]/discount` — removes; bucket `cart.write`. Both ownership-guarded.

### Checkout (draft-order) propagation
- `createDraftOrder` re-resolves the applied coupon against Stripe (like quote revalidation) so an
  expired/deactivated code cannot be charged → `CommerceError("discount_invalid", 409)` if no longer
  valid. Recompute the discount against the freshly revalidated housing base.
- Allocate the order-level discount across items **proportional to each item's housing base**
  (remainder to the last item so sums stay exact). For each order item set `orderItem.discountMinor`
  and insert a negative `orderItemCharge` (`kind: "discount"`, `grossMinor` negative) referencing the
  coupon (`providerChargeId = couponId`). Set `order.appliedDiscount` and `order.discountMinor`;
  `order.totalMinor = subtotal + tax - discount`.
- **Stripe charges `order.totalMinor`** — discount flows through automatically. Actual Stripe-side
  redemption recording happens when the PaymentIntent/Checkout is created (Milestone 4); the order
  carries the coupon reference forward. "Register as applied" on our side = the order provenance +
  discount charge rows written here.
- Zero-total handling: change the `#createDraftOrder` guard at `service.ts:457` from
  `validItemCount === 0 || totalMinor <= 0` to `validItemCount === 0` (a fully-discounted housing
  cart can legitimately reach total 0). Skipping the PaymentIntent for `totalMinor === 0` is a
  Milestone-4 concern; note it.

---

## Part E — Quote-revalidation race + publicReference race

- **Revalidation read consistency** (`validateCart`, `createDraftOrder`): items are read *outside* the
  transaction (`#readActiveItemInputs`), revalidated via external Stripe/Hostify calls, then the tx
  opens. Concurrent add/remove between the outside read and the tx can drift the cart. Fix: give
  `#ensureMutableCart` a `forUpdate` option that issues `SELECT ... FOR UPDATE` on the cart row, and
  inside the validate/draft-order tx re-read the active item id set and reconcile against the
  revalidated snapshots by `itemId`. If the set drifted, throw `CommerceError("cart_changed", 409)`
  so the client retries. Mutation paths (add/update/remove) keep the unlocked read to avoid contention.
- **`publicReference` insert race**: `#uniquePublicReference` already retries with a pre-check select
  (8 attempts), but check-then-insert is not atomic. Move the uniqueness guarantee to the insert:
  catch the Postgres unique-violation (`23505` on `orders_public_reference_uidx`) and retry the order
  insert with a fresh reference (bounded). Widen the suffix from 6 to 8 hex chars for headroom.

---

## Part F — Auth backend completion

- `packages/auth/src/email.ts`: introduce an `EmailSender` seam. Use Resend when `RESEND_API_KEY` is
  set, else fall back to the existing console log (frictionless dev). Template builders return
  `{ subject, html, text }` so Maizzle-built HTML can replace inline bodies later without touching
  callers. Add `sendResetPasswordEmail` beside `sendVerificationEmail`.
- `packages/auth/package.json`: add `resend` (`bun add`).
- `packages/auth/src/runtime.ts`: wire `emailAndPassword.sendResetPassword` to the new sender
  (verification is already wired).
- `packages/auth/src/config.ts` + root `.env.example`: add `RESEND_API_KEY`, `EMAIL_FROM`,
  `STRIPE_SECRET_KEY`.

---

## Files

**Modify:** `packages/db/src/schema.ts` · `packages/db/src/index.ts` (export `AppliedDiscountSnapshot`)
· `packages/core/src/commerce/{service,types,totals,orders,schemas,money}.ts` ·
`packages/core/src/index.ts` (export new commerce symbols) · `apps/web/app/api/cart/route.ts` ·
`apps/web/app/api/cart/[cartId]/route.ts` · `apps/web/app/api/cart/[cartId]/items/route.ts` ·
`apps/web/app/api/cart/[cartId]/items/[itemId]/route.ts` · `apps/web/app/api/cart/[cartId]/validate/route.ts`
· `apps/web/app/api/checkout/draft-order/route.ts` · `apps/web/lib/api/commerce.ts` ·
`packages/auth/src/{email,runtime,config}.ts` · `packages/auth/package.json` ·
`packages/core/package.json` · `.env.example`

**Create:** `apps/web/lib/auth/session.ts` · `apps/web/app/api/cart/claim/route.ts` ·
`apps/web/app/api/cart/[cartId]/discount/route.ts` · `packages/core/src/integrations/stripe/client.ts`
· generated `packages/db/drizzle/0012_*.sql` (+ snapshot/journal)

**Reuse:** `getAuth().api.getSession` (`app/api/me/route.ts`) · `withApiRoute` (`lib/api/route.ts`) ·
`commerceService()`/`commerceErrorResponse` (`lib/api/commerce.ts`) · `CommerceError` ·
`#ensureMutableCart` · `#uniquePublicReference` · `sumCartTotals` · `buildDraftOrderRows` ·
`generatePublicOrderReference` · `CartDto.cartToken` · existing `integrations/hostify` as the client
pattern for the new Stripe client.

---

## Verification

1. **Types/build:** `bun run` typecheck + build for `packages/core`, `packages/auth`, `apps/web`
   (strict; no `any`/`unknown` casts — fix to types).
2. **Migration:** `npm run db:generate` then `npm run db:migrate`; confirm new columns/indexes via
   `npm run db:studio`.
3. **Unit tests** (extend `packages/core/src/commerce/*.test.ts`):
   - `#assertCartAccess` matrix (authed-owner / anon-token-match / mismatch / cross-user) → 404 on deny.
   - `claimCart` idempotency; `createCart` stamps `userId`; `createDraftOrder` stamps `order.userId`.
   - Discounts: percentage and fixed applied to housing only (tax unchanged); cap at housing base;
     recompute on add/remove; proportional per-item allocation sums exactly to `order.discountMinor`;
     `order.totalMinor == subtotal + tax - discount`; invalid/expired code → 422/409.
   - `sumCartTotals` returns correct `housingBaseMinor`.
   - publicReference insert retries on simulated 23505.
4. **Manual flow:** create cart unauthenticated → `ai_cart` cookie set, `userId` null; replay same
   `cartId` without cookie → 404; apply a real Stripe test promotion code → housing discounted, tax
   unchanged, `totalMinor` reduced; sign up, verify, log in → anonymous cart claimed; draft-order
   stamps `order.userId`, writes discount charge rows, `order.totalMinor` net of discount.
5. **Auth email:** with `RESEND_API_KEY`, sign-up sends a real verification email and forgot-password
   sends a reset; without it, both log to console.

## Open risks / notes
- One active anonymous cart per browser (single `ai_cart` cookie). Acceptable.
- Stripe coupon redemption is recorded Stripe-side at PaymentIntent/Checkout creation (Milestone 4);
  this pass records provenance on the order and charges the discounted total. Zero-total orders skip
  payment in M4.
- Better Auth hook cookie access varies by version — fall back to the `/api/cart/claim` endpoint if
  the hook cannot read cookies.
