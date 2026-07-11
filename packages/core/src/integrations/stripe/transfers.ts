import type Stripe from "stripe";

export interface ConnectedAccountTransferRequest {
	amountMinor: number;
	currency: string;
	destinationAccountId: string;
	idempotencyKey: string;
	orderId: string;
	orderItemId: string;
	paymentIntentId: string;
}

export interface ConnectedAccountTransferResult {
	amountMinor: number;
	id: string;
	sourceChargeId: string;
}

/**
 * Creates a separate charge-and-transfer payout for one stay item. Linking the
 * transfer to the captured charge avoids platform-balance timing races, while
 * the caller's durable idempotency key makes retries safe after a crash.
 */
export async function createConnectedAccountTransfer(
	stripe: Stripe,
	request: ConnectedAccountTransferRequest,
): Promise<ConnectedAccountTransferResult> {
	if (!Number.isInteger(request.amountMinor) || request.amountMinor <= 0) {
		throw new RangeError("Connected account transfer amount must be positive");
	}
	if (!request.idempotencyKey) {
		throw new Error("Connected account transfer idempotency key is required");
	}

	const intent = await stripe.paymentIntents.retrieve(request.paymentIntentId, {
		expand: ["latest_charge"],
	});
	if (intent.status !== "succeeded") {
		throw new Error("PaymentIntent has not succeeded");
	}
	const sourceChargeId =
		typeof intent.latest_charge === "string"
			? intent.latest_charge
			: intent.latest_charge?.id;
	if (!sourceChargeId) {
		throw new Error("PaymentIntent is missing its captured charge");
	}

	const transfer = await stripe.transfers.create(
		{
			amount: request.amountMinor,
			currency: request.currency.toLowerCase(),
			destination: request.destinationAccountId,
			metadata: {
				orderId: request.orderId,
				orderItemId: request.orderItemId,
			},
			source_transaction: sourceChargeId,
			transfer_group: `order:${request.orderId}`,
		},
		{ idempotencyKey: request.idempotencyKey },
	);

	return { amountMinor: transfer.amount, id: transfer.id, sourceChargeId };
}

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

export interface DirectTransferReversalRequest {
	amountMinor: number;
	idempotencyKey: string;
	transferId: string;
}

/** Reverses a separately-created listing payout transfer. */
export async function reverseConnectedAccountTransfer(
	stripe: Stripe,
	request: DirectTransferReversalRequest,
): Promise<TransferReversalResult> {
	if (!request.idempotencyKey) {
		throw new Error("Transfer reversal idempotency key must be provided");
	}
	if (!Number.isInteger(request.amountMinor) || request.amountMinor <= 0) {
		throw new RangeError("Transfer reversal amount must be a positive integer");
	}
	const reversal = await stripe.transfers.createReversal(
		request.transferId,
		{ amount: request.amountMinor },
		{ idempotencyKey: request.idempotencyKey },
	);
	return {
		amountMinor: reversal.amount,
		id: reversal.id,
		transferId: request.transferId,
	};
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
