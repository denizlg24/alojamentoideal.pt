import type Stripe from "stripe";

/**
 * Inputs for reversing (part of) the destination-charge transfer behind a
 * PaymentIntent. The amount is computed by the commerce layer from the order's
 * activity share; the idempotency key must come from durable caller state.
 */
export interface TransferReversalRequest {
	amountMinor: number;
	idempotencyKey: string;
	paymentIntentId: string;
}

/** Normalized reversal facts recorded on the refund ledger. */
export interface TransferReversalResult {
	amountMinor: number;
	id: string;
	transferId: string;
}

/**
 * Reverses `amountMinor` of the transfer created by a destination charge, so
 * refunded activity money comes back from the connected (Detours) account.
 * Mirrors the legacy app's explicit `transfers.createReversal` (exact amount)
 * rather than the refund-level proportional `reverse_transfer` flag. Returns
 * null when the charge has no transfer (nothing to reverse).
 */
export async function reverseChargeTransfer(
	stripe: Stripe,
	request: TransferReversalRequest,
): Promise<TransferReversalResult | null> {
	if (!request.idempotencyKey) {
		throw new Error("Transfer reversal idempotency key must be provided");
	}
	if (!Number.isInteger(request.amountMinor) || request.amountMinor <= 0) {
		throw new RangeError("Transfer reversal amount must be a positive integer");
	}

	const intent = await stripe.paymentIntents.retrieve(request.paymentIntentId, {
		expand: ["latest_charge"],
	});
	const charge =
		intent.latest_charge && typeof intent.latest_charge !== "string"
			? intent.latest_charge
			: null;
	const transferId =
		typeof charge?.transfer === "string"
			? charge.transfer
			: (charge?.transfer?.id ?? null);
	if (!transferId) {
		return null;
	}

	const reversal = await stripe.transfers.createReversal(
		transferId,
		{ amount: request.amountMinor },
		{ idempotencyKey: request.idempotencyKey },
	);

	return {
		amountMinor: reversal.amount,
		id: reversal.id,
		transferId,
	};
}
