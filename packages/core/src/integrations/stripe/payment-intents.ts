import type Stripe from "stripe";

/**
 * Inputs for materializing the single PaymentIntent that backs a draft order.
 * The amount/currency are read authoritatively from the persisted order by the
 * caller, never from the client. `existingPaymentIntentId` is the id stored on
 * the order (if any) so repeat calls reuse the same intent instead of spawning
 * duplicates.
 */
export interface PaymentIntentParams {
	amountMinor: number;
	cartId: string;
	currency: string;
	environment: string;
	existingPaymentIntentId?: string | null;
	idempotencyKey: string;
	orderId: string;
	publicReference: string;
}

/** Normalized PaymentIntent fields the checkout boundary needs. */
export interface PaymentIntentSnapshot {
	amountMinor: number;
	clientSecret: string;
	currency: string;
	id: string;
	paymentMethod: StripePaymentMethodSummary | null;
	status: Stripe.PaymentIntent.Status;
}

/** Non-sensitive payment method display data from Stripe charge details. */
export interface StripePaymentMethodSummary {
	brand: string | null;
	last4: string | null;
	type: string;
}

/**
 * Statuses where Stripe still allows mutating the amount. Once a PaymentIntent
 * is processing/succeeded/canceled it is frozen; we return it untouched and let
 * the caller decide (a frozen intent on a still-draft order is a recoverable
 * mismatch handled upstream).
 */
const UPDATABLE_STATUSES: ReadonlySet<Stripe.PaymentIntent.Status> = new Set([
	"requires_action",
	"requires_confirmation",
	"requires_payment_method",
]);

function toSnapshot(intent: Stripe.PaymentIntent): PaymentIntentSnapshot {
	if (!intent.client_secret) {
		throw new Error("Stripe PaymentIntent is missing a client secret");
	}

	return {
		amountMinor: intent.amount,
		clientSecret: intent.client_secret,
		currency: intent.currency.toUpperCase(),
		id: intent.id,
		paymentMethod: paymentMethodSummaryFromIntent(intent),
		status: intent.status,
	};
}

function expandedCharge(
	charge: Stripe.PaymentIntent["latest_charge"],
): Stripe.Charge | null {
	return charge && typeof charge !== "string" ? charge : null;
}

function paymentMethodSummaryFromIntent(
	intent: Stripe.PaymentIntent,
): StripePaymentMethodSummary | null {
	const details = expandedCharge(intent.latest_charge)?.payment_method_details;
	if (!details?.type) {
		return null;
	}
	if (details.type === "card") {
		return {
			brand: details.card?.brand ?? null,
			last4: details.card?.last4 ?? null,
			type: details.type,
		};
	}
	return {
		brand: null,
		last4: null,
		type: details.type,
	};
}

/**
 * Creates (or reuses/refreshes) the PaymentIntent for a draft order. Stripe is
 * the source of truth for the intent; the injected client mirrors the testable
 * pattern in `resolvePromotionCode`. Idempotency keyed on the order means a
 * retried create returns the same intent rather than charging twice.
 */
export async function createOrUpdatePaymentIntent(
	stripe: Stripe,
	params: PaymentIntentParams,
): Promise<PaymentIntentSnapshot> {
	const currency = params.currency.toLowerCase();

	if (params.existingPaymentIntentId) {
		const existing = await stripe.paymentIntents.retrieve(
			params.existingPaymentIntentId,
		);

		if (existing.currency.toLowerCase() !== currency) {
			throw new Error(
				`Stripe PaymentIntent currency mismatch: expected ${params.currency}, got ${existing.currency}`,
			);
		}

		if (
			UPDATABLE_STATUSES.has(existing.status) &&
			existing.amount !== params.amountMinor
		) {
			const updated = await stripe.paymentIntents.update(existing.id, {
				amount: params.amountMinor,
			});
			return toSnapshot(updated);
		}

		return toSnapshot(existing);
	}

	const created = await stripe.paymentIntents.create(
		{
			amount: params.amountMinor,
			automatic_payment_methods: { enabled: true },
			currency,
			metadata: {
				cartId: params.cartId,
				environment: params.environment,
				orderId: params.orderId,
				publicReference: params.publicReference,
			},
		},
		{ idempotencyKey: params.idempotencyKey },
	);

	return toSnapshot(created);
}

/** Reads the current PaymentIntent state for server-side status verification. */
export async function retrievePaymentIntentSnapshot(
	stripe: Stripe,
	paymentIntentId: string,
	options: { includePaymentMethod?: boolean } = {},
): Promise<PaymentIntentSnapshot> {
	const intent = await stripe.paymentIntents.retrieve(
		paymentIntentId,
		options.includePaymentMethod ? { expand: ["latest_charge"] } : undefined,
	);
	return toSnapshot(intent);
}
