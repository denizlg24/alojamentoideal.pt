import type Stripe from "stripe";

/**
 * Inputs for a full (or, later, partial) refund against the PaymentIntent that
 * backs an order. The amount is read authoritatively from the persisted order by
 * the caller; omitting it refunds the full captured amount. The idempotency key
 * must come from durable caller state, not from this Stripe boundary.
 */
export interface RefundRequest {
	amountMinor?: number;
	idempotencyKey: string;
	paymentIntentId: string;
	reason?: "duplicate" | "fraudulent" | "requested_by_customer";
	/**
	 * Pull the refunded share back from the connected account. Required for
	 * charges with `transfer_data` (activity orders) or the transferred funds
	 * stay on Detours; must remain unset for plain platform charges, where
	 * Stripe rejects the flag. Partial refunds reverse proportionally.
	 */
	reverseTransfer?: boolean;
}

/** Normalized refund facts the compensation path records on the order. */
export interface RefundResult {
	amountMinor: number;
	id: string;
	status: Stripe.Refund["status"];
}

/**
 * Issues a refund for a PaymentIntent. Stripe idempotency is only a provider
 * safety net here: callers must persist a refund-attempt guard before invoking
 * this helper and must pass the persisted key explicitly.
 */
export async function createRefund(
	stripe: Stripe,
	request: RefundRequest,
): Promise<RefundResult> {
	if (!request.idempotencyKey) {
		throw new Error("Refund idempotency key must be provided");
	}
	if (
		request.amountMinor !== undefined &&
		(!Number.isInteger(request.amountMinor) || request.amountMinor <= 0)
	) {
		throw new RangeError("Refund amount must be a positive integer");
	}

	const refund = await stripe.refunds.create(
		{
			payment_intent: request.paymentIntentId,
			...(request.amountMinor !== undefined
				? { amount: request.amountMinor }
				: {}),
			...(request.reason ? { reason: request.reason } : {}),
			...(request.reverseTransfer ? { reverse_transfer: true } : {}),
		},
		{
			idempotencyKey: request.idempotencyKey,
		},
	);

	return { amountMinor: refund.amount, id: refund.id, status: refund.status };
}
