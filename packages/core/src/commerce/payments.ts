import type { OrderBillingAddressSnapshot } from "@workspace/db";

/**
 * Checkout payment types shared between the PaymentIntent route, the order
 * status route and the frontend checkout controller. Stripe-specific call
 * shapes live in `integrations/stripe/payment-intents.ts`; this module only
 * models the boundary contract and the normalized status vocabulary so the
 * frontend never has to reason about raw Stripe enums.
 */

/** Order lifecycle as persisted on `orders.status`. */
export type OrderBookingStatus =
	| "cancelled"
	| "confirmed"
	| "draft"
	| "failed"
	| "pending";

/**
 * Normalized payment status surfaced to the client. Maps the subset of Stripe
 * PaymentIntent statuses we care about plus an `unknown` fallback for orders
 * that never reached Stripe (e.g. zero-total) or whose intent is missing.
 */
export type CheckoutPaymentStatus =
	| "canceled"
	| "processing"
	| "requires_action"
	| "requires_payment_method"
	| "succeeded"
	| "unknown";

/** Successful PaymentIntent creation/refresh for a payable draft order. */
export interface CreatePaymentIntentResponse {
	amountMinor: number;
	/** ISO instant the checkout window closes, so the client can self-expire. */
	checkoutExpiresAt: string | null;
	clientSecret: string;
	currency: string;
	kind: "payment_intent";
	orderId: string;
	paymentIntentId: string;
	publicReference: string;
}

/**
 * A zero-total order needs no Stripe confirmation. The route returns this so
 * checkout can skip mounting Elements and move straight to completion.
 */
export interface ZeroTotalPaymentIntentResponse {
	amountMinor: 0;
	checkoutExpiresAt: string | null;
	currency: string;
	kind: "zero_total";
	orderId: string;
	publicReference: string;
}

export type PaymentIntentResponse =
	| CreatePaymentIntentResponse
	| ZeroTotalPaymentIntentResponse;

/**
 * Authoritative draft-order facts needed to materialize a PaymentIntent.
 * Returned by `CommerceService.getPayableOrder`; `DraftOrderResponse` omits the
 * amount on purpose, so this is the only trustworthy source.
 */
export interface PayableOrder {
	cartId: string | null;
	/** ISO instant the checkout window closes; null when no deadline is set. */
	checkoutExpiresAt: string | null;
	currency: string;
	orderId: string;
	publicReference: string;
	status: OrderBookingStatus;
	stripePaymentIntentId: string | null;
	totalMinor: number;
}

/** Persisted order facts for the completion page (pre Stripe enrichment). */
export interface OrderStatusRecord {
	amountPaidMinor: number;
	bookingStatus: OrderBookingStatus;
	currency: string;
	orderId: string;
	publicReference: string;
	stripePaymentIntentId: string | null;
	totalMinor: number;
}

/** Server-verified order/payment status for the completion page. */
export interface OrderStatusResponse {
	amountMinor: number;
	amountPaidMinor: number;
	bookingStatus: OrderBookingStatus;
	currency: string;
	orderId: string;
	paymentStatus: CheckoutPaymentStatus;
	publicReference: string;
}

/**
 * Contact + amount facts needed to send a single order-confirmation email.
 * Returned only on the first draft -> confirmed transition so re-delivered
 * webhooks never trigger a duplicate email.
 */
export interface OrderConfirmationFacts {
	accommodationImage: string | null;
	accommodationTitle: string;
	amountPaidMinor: number;
	billingAddress: OrderBillingAddressSnapshot;
	checkIn: string;
	checkOut: string;
	contactPhone: string;
	currency: string;
	email: string;
	guests: number;
	name: string;
	publicReference: string;
}

/** A money amount in minor units paired with its ISO currency. */
export interface PaymentAmount {
	amountMinor: number;
	currency: string;
}

/**
 * Outcome of marking an order paid from a verified `payment_intent.succeeded`
 * webhook. `confirmed` carries the email facts; `already_finalized` means a
 * prior delivery (or another worker) already settled the order; `not_found`
 * means the metadata referenced an order we do not have; `amount_mismatch`
 * means the captured amount/currency disagreed with the persisted order total,
 * so the order is deliberately left unconfirmed for manual reconciliation.
 */
export type MarkOrderPaidResult =
	| { confirmation: OrderConfirmationFacts; outcome: "confirmed" }
	| {
			expected: PaymentAmount;
			outcome: "amount_mismatch";
			received: PaymentAmount;
	  }
	| { outcome: "already_finalized" }
	| { outcome: "not_found" };

/** Stripe failure details recorded on a draft order after a failed attempt. */
export interface OrderPaymentFailureInput {
	failureCode: string | null;
	failureDetail: string | null;
}

/**
 * Outcome of recording a `payment_intent.payment_failed` attempt. A declined or
 * unauthenticated card returns the PaymentIntent to `requires_payment_method`,
 * so the order keeps its draft/pending status and stays retryable; only the
 * failure code/detail is persisted. `recorded` reflects that non-terminal write;
 * `already_finalized` means the order was already confirmed/cancelled;
 * `not_found` means the referenced order is unknown.
 */
export type RecordOrderPaymentFailureResult =
	| { outcome: "already_finalized" }
	| { outcome: "not_found" }
	| { outcome: "recorded" };

const ORDER_BOOKING_STATUSES: ReadonlySet<OrderBookingStatus> = new Set([
	"cancelled",
	"confirmed",
	"draft",
	"failed",
	"pending",
]);

/** Narrows the free-text `orders.status` column to the known lifecycle set. */
export function toOrderBookingStatus(value: string): OrderBookingStatus {
	return ORDER_BOOKING_STATUSES.has(value as OrderBookingStatus)
		? (value as OrderBookingStatus)
		: "draft";
}

/**
 * Maps a raw Stripe PaymentIntent status into the normalized checkout
 * vocabulary. `requires_capture` is treated as `processing` because the app
 * does not use manual capture; any unrecognized value degrades to `unknown`.
 */
export function mapStripePaymentStatus(status: string): CheckoutPaymentStatus {
	switch (status) {
		case "succeeded":
			return "succeeded";
		case "processing":
		case "requires_capture":
			return "processing";
		case "requires_action":
		case "requires_confirmation":
			return "requires_action";
		case "requires_payment_method":
			return "requires_payment_method";
		case "canceled":
			return "canceled";
		default:
			return "unknown";
	}
}
