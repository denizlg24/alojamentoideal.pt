import {
	type Database,
	type OrderRefund,
	type OrderRefundReason,
	orderItem as orderItemTable,
	orderRefund as orderRefundTable,
	order as orderTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type {
	RefundRequest,
	RefundResult,
	TransferReversalRequest,
	TransferReversalResult,
} from "../integrations/stripe";
import { trackEvent } from "../observability";
import { CommerceError } from "./errors";

export interface OrderRefundServiceOptions {
	db: Database;
	now?: () => Date;
	/** Issues the Stripe refund; absent when Stripe is not configured. */
	refundPayment?: (request: RefundRequest) => Promise<RefundResult>;
	/**
	 * Reverses the Detours share of a destination charge alongside the refund
	 * (legacy parity: explicit `transfers.createReversal`, not the proportional
	 * `reverse_transfer` flag). Absent when Stripe is not configured.
	 */
	reverseActivityTransfer?: (
		request: TransferReversalRequest,
	) => Promise<TransferReversalResult | null>;
}

export interface RefundOrderInput {
	amountMinor: number;
	/** Free-text operator note, retained on the ledger row. */
	note?: string | null;
	orderId: string;
	/** Optional reservation the refund is attributed to (reporting only). */
	orderItemId?: string | null;
	reason: OrderRefundReason;
	/** Better Auth user id of the operator issuing the refund. */
	actorUserId?: string | null;
}

export interface RefundOrderResult {
	/** The persisted, succeeded ledger row. */
	refund: OrderRefund;
	/** Order-level refunded total after this refund. */
	refundedTotalMinor: number;
	/** Amount still refundable after this refund. */
	refundableMinor: number;
	/**
	 * Set when the refund succeeded but the Detours transfer reversal failed;
	 * the reversal must then be completed manually in the Stripe dashboard.
	 */
	transferReversalError?: string;
}

/** Preset refund fractions surfaced in the operator UI. */
export const REFUND_PRESET_PERCENTS = [25, 50, 100] as const;

/**
 * How much of a refund must be pulled back from the Detours connected account.
 * Pure so the attribution rules stay testable:
 * - activity-only order: the whole refund came from transferred money
 * - mixed order, refund attributed to an activity item: the whole refund
 * - mixed order, refund attributed to a stay item: nothing
 * - mixed order, unattributed: prorated by the activity share of the total
 * Always capped at the activity total, since no more than that was transferred.
 */
export function activityReversalAmountMinor(input: {
	activityTotalMinor: number;
	attributedItemType: "accommodation" | "activity" | null;
	orderTotalMinor: number;
	refundMinor: number;
}): number {
	if (input.activityTotalMinor <= 0 || input.refundMinor <= 0) {
		return 0;
	}
	if (input.attributedItemType === "accommodation") {
		return 0;
	}
	const cap = Math.min(input.refundMinor, input.activityTotalMinor);
	if (
		input.attributedItemType === "activity" ||
		input.activityTotalMinor >= input.orderTotalMinor
	) {
		return cap;
	}
	return Math.min(
		cap,
		Math.round(
			(input.refundMinor * input.activityTotalMinor) / input.orderTotalMinor,
		),
	);
}

/**
 * Minor-unit amount for a preset percentage of the still-refundable total. 100%
 * returns the exact remainder (no rounding drift); other percents round to the
 * nearest cent and never exceed the refundable amount.
 */
export function refundPresetAmountMinor(
	refundableMinor: number,
	percent: number,
): number {
	if (refundableMinor <= 0) {
		return 0;
	}
	if (percent >= 100) {
		return refundableMinor;
	}
	if (percent <= 0) {
		return 0;
	}
	return Math.min(
		refundableMinor,
		Math.round((refundableMinor * percent) / 100),
	);
}

/**
 * Stripe only accepts its three enumerated reasons; our `other` maps to an
 * omitted reason (the operator note carries the real detail).
 */
export function stripeRefundReason(
	reason: OrderRefundReason,
): RefundRequest["reason"] {
	return reason === "other" ? undefined : reason;
}

function describeRefundError(error: unknown): string {
	if (error instanceof Error) {
		return `${error.name}: ${error.message}`.slice(0, 500);
	}
	return "unknown error";
}

/**
 * Operator-issued manual refunds against an order's Stripe PaymentIntent.
 * Distinct from `CommerceService.compensateOrder` (the automatic full refund +
 * cancel on saga failure): this path moves money only, never touching order
 * status or provider holds, and supports repeated partial refunds recorded in
 * the `order_refunds` ledger.
 *
 * Over-refund safety: the order aggregate is reserved atomically (a guarded
 * `amount_refunded += n WHERE amount_refunded + n <= amount_paid`) before the
 * Stripe call, so two concurrent refunds can never exceed the captured amount.
 * A Stripe failure rolls the reservation back and parks the ledger row failed.
 */
export class OrderRefundService {
	readonly #db: Database;
	readonly #now: () => Date;
	readonly #refundPayment: OrderRefundServiceOptions["refundPayment"];
	readonly #reverseActivityTransfer: OrderRefundServiceOptions["reverseActivityTransfer"];

	constructor(options: OrderRefundServiceOptions) {
		this.#db = options.db;
		this.#now = options.now ?? (() => new Date());
		this.#refundPayment = options.refundPayment;
		this.#reverseActivityTransfer = options.reverseActivityTransfer;
	}

	async listOrderRefunds(orderId: string): Promise<OrderRefund[]> {
		return this.#db
			.select()
			.from(orderRefundTable)
			.where(eq(orderRefundTable.orderId, orderId))
			.orderBy(asc(orderRefundTable.createdAt));
	}

	async refundOrder(input: RefundOrderInput): Promise<RefundOrderResult> {
		const refundPayment = this.#refundPayment;
		if (!refundPayment) {
			throw new CommerceError(
				"refund_unavailable",
				"Refunds are unavailable: Stripe is not configured.",
				503,
			);
		}
		if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
			throw new CommerceError(
				"refund_amount_invalid",
				"Refund amount must be a positive integer of minor units.",
				422,
			);
		}

		const [order] = await this.#db
			.select({
				amountPaidMinor: orderTable.amountPaidMinor,
				amountRefundedMinor: orderTable.amountRefundedMinor,
				currency: orderTable.currency,
				id: orderTable.id,
				stripePaymentIntentId: orderTable.stripePaymentIntentId,
				totalMinor: orderTable.totalMinor,
			})
			.from(orderTable)
			.where(eq(orderTable.id, input.orderId))
			.limit(1);
		if (!order) {
			throw new CommerceError("order_not_found", "Order not found.", 404);
		}
		if (!order.stripePaymentIntentId) {
			throw new CommerceError(
				"order_not_charged",
				"Order has no captured payment to refund.",
				422,
			);
		}

		const [activityTotals] = await this.#db
			.select({
				totalMinor:
					sql<number>`coalesce(sum(${orderItemTable.totalMinor}), 0)`.mapWith(
						Number,
					),
			})
			.from(orderItemTable)
			.where(
				and(
					eq(orderItemTable.orderId, order.id),
					eq(orderItemTable.type, "activity"),
				),
			);
		const activityTotalMinor = activityTotals?.totalMinor ?? 0;

		const refundableBefore = order.amountPaidMinor - order.amountRefundedMinor;
		if (input.amountMinor > refundableBefore) {
			throw new CommerceError(
				"refund_amount_exceeds_refundable",
				`Refund of ${input.amountMinor} exceeds the ${refundableBefore} still refundable on this order.`,
				422,
			);
		}

		const orderItemId = input.orderItemId ?? null;
		let attributedItemType: "accommodation" | "activity" | null = null;
		if (orderItemId) {
			const [item] = await this.#db
				.select({ id: orderItemTable.id, type: orderItemTable.type })
				.from(orderItemTable)
				.where(
					and(
						eq(orderItemTable.id, orderItemId),
						eq(orderItemTable.orderId, order.id),
					),
				)
				.limit(1);
			if (!item) {
				throw new CommerceError(
					"item_not_found",
					"The attributed reservation is not part of this order.",
					422,
				);
			}
			attributedItemType =
				item.type === "activity" || item.type === "accommodation"
					? item.type
					: null;
		}

		// Reserve the amount on the order aggregate before hitting Stripe. The
		// guard mirrors the orders_amount_refunded_lte_paid check so concurrent
		// refunds can never over-refund.
		const now = this.#now();
		let refundedTotalMinor: number = -1;
		let idempotencyKey: string | null = null;
		let recordId: string | null = null;
		await this.#db.transaction(async (tx) => {
			const [reservedRow] = await tx
				.update(orderTable)
				.set({
					amountRefundedMinor: sql`${orderTable.amountRefundedMinor} + ${input.amountMinor}`,
					updatedAt: now,
				})
				.where(
					and(
						eq(orderTable.id, order.id),
						sql`${orderTable.amountRefundedMinor} + ${input.amountMinor} <= ${orderTable.amountPaidMinor}`,
					),
				)
				.returning({ amountRefundedMinor: orderTable.amountRefundedMinor });
			if (!reservedRow) {
				throw new CommerceError(
					"refund_amount_exceeds_refundable",
					"Refund exceeds the amount still refundable on this order.",
					422,
				);
			}

			refundedTotalMinor = reservedRow.amountRefundedMinor;

			idempotencyKey = `manual_refund:${order.id}:${refundedTotalMinor}`;
			recordId = crypto.randomUUID();
			await tx.insert(orderRefundTable).values({
				amountMinor: input.amountMinor,
				createdByUserId: input.actorUserId ?? null,
				currency: order.currency,
				id: recordId,
				note: input.note?.trim() || null,
				orderId: order.id,
				orderItemId,
				reason: input.reason,
				status: "pending",
				stripeRefundIdempotencyKey: idempotencyKey,
			});
		});

		if (!idempotencyKey || !recordId) {
			throw new CommerceError(
				"refund_failed",
				"Failed to initialize the refund process.",
				500,
			);
		}

		let refund: RefundResult;
		try {
			refund = await refundPayment({
				amountMinor: input.amountMinor,
				idempotencyKey,
				paymentIntentId: order.stripePaymentIntentId,
				reason: stripeRefundReason(input.reason),
			});
		} catch (error) {
			await this.#db
				.update(orderTable)
				.set({
					amountRefundedMinor: sql`${orderTable.amountRefundedMinor} - ${input.amountMinor}`,
					updatedAt: this.#now(),
				})
				.where(eq(orderTable.id, order.id));
			await this.#db
				.update(orderRefundTable)
				.set({
					lastErrorMessage: describeRefundError(error),
					status: "failed",
					updatedAt: this.#now(),
				})
				.where(eq(orderRefundTable.id, recordId));
			if (error instanceof CommerceError) {
				throw error;
			}
			throw new CommerceError(
				"refund_failed",
				`The Stripe refund could not be created: ${describeRefundError(error)}`,
				502,
			);
		}

		// Legacy-parity transfer reversal: pull the activity share of the refund
		// back from Detours with an explicit reversal amount. Runs after the
		// refund like the legacy app did; a reversal failure never unwinds the
		// refund, it is surfaced for manual follow-up in the Stripe dashboard.
		const reversalAmountMinor = activityReversalAmountMinor({
			activityTotalMinor,
			attributedItemType,
			orderTotalMinor: order.totalMinor,
			refundMinor: input.amountMinor,
		});
		let transferReversal: TransferReversalResult | null = null;
		let transferReversalError: string | undefined;
		if (reversalAmountMinor > 0) {
			const reverseActivityTransfer = this.#reverseActivityTransfer;
			if (!reverseActivityTransfer) {
				transferReversalError =
					"Transfer reversals are unavailable: Stripe is not configured.";
			} else {
				try {
					transferReversal = await reverseActivityTransfer({
						amountMinor: reversalAmountMinor,
						idempotencyKey: `${idempotencyKey}:reversal`,
						paymentIntentId: order.stripePaymentIntentId,
					});
				} catch (error) {
					transferReversalError = describeRefundError(error);
				}
			}
			if (transferReversalError) {
				trackEvent({
					metadata: {
						amountMinor: reversalAmountMinor,
						error: transferReversalError,
						orderId: order.id,
						refundId: refund.id,
					},
					name: "order_refund_transfer_reversal_failed",
					provider: "stripe",
					severity: "error",
					type: "integration",
				});
			}
		}

		const settledAt = this.#now();
		const [record] = await this.#db
			.update(orderRefundTable)
			.set({
				completedAt: settledAt,
				lastErrorMessage: transferReversalError ?? null,
				status: "succeeded",
				stripeRefundId: refund.id,
				stripeTransferReversalId: transferReversal?.id ?? null,
				transferReversalAmountMinor: transferReversal?.amountMinor ?? null,
				updatedAt: settledAt,
			})
			.where(eq(orderRefundTable.id, recordId))
			.returning();
		if (!record) {
			throw new CommerceError(
				"refund_failed",
				"The refund succeeded at Stripe but its ledger record could not be reloaded.",
				500,
			);
		}

		trackEvent({
			metadata: {
				amountMinor: input.amountMinor,
				orderId: order.id,
				orderItemId,
				reason: input.reason,
				refundId: refund.id,
			},
			name: "order_refunded",
			provider: "stripe",
			severity: "info",
			type: "integration",
		});

		return {
			refund: record,
			refundableMinor: order.amountPaidMinor - refundedTotalMinor,
			refundedTotalMinor,
			...(transferReversalError ? { transferReversalError } : {}),
		};
	}
}
