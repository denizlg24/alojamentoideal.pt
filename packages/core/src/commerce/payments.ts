import type { OrderBillingAddressSnapshot } from "@workspace/db";
import type {
	OrderConversationAvailability,
	OrderGuestProgress,
} from "./order-detail";

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

export type OrderProvisioningSubState =
	| "confirmed"
	| "held-unpaid"
	| "paid-confirming"
	| "refunded";

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

/** Successful provider hold created immediately before confirming payment. */
export interface HoldReservationResponse {
	/** ISO instant the checkout window closes, so the client can self-expire. */
	checkoutExpiresAt: string | null;
	orderId: string;
	publicReference: string;
	status: "held";
}

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
	conversationAvailability: OrderConversationAvailability;
	currency: string;
	guestProgress: OrderGuestProgress;
	orderId: string;
	provisioningSubState: OrderProvisioningSubState;
	publicReference: string;
	stripePaymentIntentId: string | null;
	totalMinor: number;
}

/** Server-verified order/payment status for the completion page. */
export interface OrderStatusResponse {
	amountMinor: number;
	amountPaidMinor: number;
	bookingStatus: OrderBookingStatus;
	conversationAvailability: OrderConversationAvailability;
	currency: string;
	guestProgress: OrderGuestProgress;
	orderId: string;
	orderUrl: string;
	paymentStatus: CheckoutPaymentStatus;
	provisioningSubState: OrderProvisioningSubState;
	publicReference: string;
}

export type OrderFinalizationEmailKind =
	| "confirmation"
	| "refund_amount_mismatch"
	| "refund_unconfirmed";

export type OrderCompensationEmailKind = Exclude<
	OrderFinalizationEmailKind,
	"confirmation"
>;

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
	orderId: string;
	publicReference: string;
}

/** A money amount in minor units paired with its ISO currency. */
export interface PaymentAmount {
	amountMinor: number;
	currency: string;
}

/**
 * Outcome of marking an order paid from a verified `payment_intent.succeeded`
 * webhook under the hold-before-confirm saga. `markOrderPaid` no longer jumps
 * to `confirmed`: it records the captured amount and moves the order to
 * `pending`, then the caller drives `confirmOrderReservations` to confirm the
 * provider hold or compensate when no hold can be confirmed. `marked` means the
 * paid amount was recorded (the order is `pending`, awaiting hold confirmation);
 * `already_finalized` means the order already reached a terminal state;
 * `not_found` means the metadata referenced an unknown order;
 * `amount_mismatch` means the captured amount/currency disagreed with the
 * persisted total, so the money was taken but must be refunded by compensation.
 */
export type MarkOrderPaidResult =
	| { outcome: "marked" }
	| {
			expected: PaymentAmount;
			outcome: "amount_mismatch";
			received: PaymentAmount;
	  }
	| { outcome: "already_finalized" }
	| { outcome: "not_found" };

/**
 * Outcome of placing every provider hold before payment confirmation. `held`
 * moves the order `draft -> pending` and lets the client confirm the already
 * created PaymentIntent; `unavailable` means a hold was rejected (dates gone)
 * so no money is taken; `transient_error` means a provider call failed retryably
 * (the route should ask the guest to retry); `not_holdable` means the order was
 * not in a holdable state.
 */
export type HoldOrderResult =
	| { outcome: "held" }
	| { message: string; outcome: "unavailable" }
	| { outcome: "transient_error" }
	| { outcome: "not_holdable" };

/**
 * Facts the caller needs to send the "refunded — we couldn't confirm" email and
 * raise a Sentry alert after an order is compensated. Assembled from durable
 * state only on the transition into `cancelled`, so a re-run never re-emails.
 */
export interface OrderCompensationFacts {
	amountRefundedMinor: number;
	currency: string;
	email: string;
	emailKind: OrderCompensationEmailKind;
	name: string;
	orderId: string;
	publicReference: string;
	reason: string;
}

/**
 * Outcome of confirming an order's provider holds after payment. `confirmed`
 * carries the one-shot confirmation email facts; `compensated` means a hold
 * confirm failed permanently and the order was refunded (facts for the customer
 * email); `manual_recovery` means auto-refund is disabled and the order is
 * flagged for an operator; `pending_retry` means a transient failure left the
 * order `pending` for the reconciler cron; `not_applicable` means the order was
 * not in a confirmable state (e.g. already confirmed, or never paid).
 */
export type ConfirmOrderReservationsResult =
	| { confirmation: OrderConfirmationFacts; outcome: "confirmed" }
	| { compensation: OrderCompensationFacts; outcome: "compensated" }
	| { outcome: "manual_recovery" }
	| { outcome: "pending_retry" }
	| { outcome: "not_applicable" };

/**
 * Outcome of releasing an order's provider holds (payment failed terminally or
 * an abandoned checkout expired). `cancelled` moved the order to `failed`;
 * `pending_retry` means a hold cancel failed transiently and the cron will retry;
 * `already_settled` means the order was already terminal; `not_found` is unknown.
 */
export type CancelOrderReservationsResult =
	| { outcome: "cancelled" }
	| { outcome: "pending_retry" }
	| { outcome: "already_settled" }
	| { outcome: "not_found" };

/**
 * Outcome of compensating a charged order whose booking could not be confirmed.
 * `compensated` issued a full refund and moved the order to `cancelled`;
 * `already_compensated` is the idempotent re-run; `manual_recovery` means
 * auto-refund is disabled so the order is flagged instead of refunded.
 */
export type CompensateOrderResult =
	| { compensation: OrderCompensationFacts; outcome: "compensated" }
	| { outcome: "already_compensated" }
	| { outcome: "manual_recovery" }
	| { outcome: "not_found" };

/** Live PaymentIntent facts the reconciler reads when a webhook never arrived. */
export interface PaymentIntentLiveStatus {
	amountMinor: number;
	currency: string;
	status: CheckoutPaymentStatus;
}

/** Aggregate counters returned by a reconciler cron pass. */
export interface ReconcileReservationsSummary {
	cancelled: number;
	compensated: number;
	confirmed: number;
	expired: number;
	rescheduled: number;
	scanned: number;
}

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

export function toOrderProvisioningSubState({
	amountPaidMinor,
	amountRefundedMinor,
	bookingStatus,
}: {
	amountPaidMinor: number;
	amountRefundedMinor: number;
	bookingStatus: OrderBookingStatus;
}): OrderProvisioningSubState {
	if (bookingStatus === "confirmed") {
		return "confirmed";
	}
	if (bookingStatus === "cancelled" || amountRefundedMinor > 0) {
		return "refunded";
	}
	if (amountPaidMinor > 0) {
		return "paid-confirming";
	}
	return "held-unpaid";
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
