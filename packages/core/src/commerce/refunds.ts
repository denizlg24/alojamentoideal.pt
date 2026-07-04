import {
	type Database,
	type OrderRefund,
	type OrderRefundReason,
	orderItem as orderItemTable,
	orderRefund as orderRefundTable,
	order as orderTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type { RefundRequest, RefundResult } from "../integrations/stripe";
import { trackEvent } from "../observability";
import { CommerceError } from "./errors";

export interface OrderRefundServiceOptions {
	db: Database;
	now?: () => Date;
	/** Issues the Stripe refund; absent when Stripe is not configured. */
	refundPayment?: (request: RefundRequest) => Promise<RefundResult>;
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
}

/** Preset refund fractions surfaced in the operator UI. */
export const REFUND_PRESET_PERCENTS = [25, 50, 100] as const;

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

	constructor(options: OrderRefundServiceOptions) {
		this.#db = options.db;
		this.#now = options.now ?? (() => new Date());
		this.#refundPayment = options.refundPayment;
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

		const refundableBefore = order.amountPaidMinor - order.amountRefundedMinor;
		if (input.amountMinor > refundableBefore) {
			throw new CommerceError(
				"refund_amount_exceeds_refundable",
				`Refund of ${input.amountMinor} exceeds the ${refundableBefore} still refundable on this order.`,
				422,
			);
		}

		const orderItemId = input.orderItemId ?? null;
		if (orderItemId) {
			const [item] = await this.#db
				.select({ id: orderItemTable.id })
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
		}

		// Reserve the amount on the order aggregate before hitting Stripe. The
		// guard mirrors the orders_amount_refunded_lte_paid check so concurrent
		// refunds can never over-refund.
		const now = this.#now();
		const [reservedRow] = await this.#db
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
		const refundedTotalMinor = reservedRow.amountRefundedMinor;

		const idempotencyKey = `manual_refund:${order.id}:${crypto.randomUUID()}`;
		const recordId = crypto.randomUUID();
		await this.#db.insert(orderRefundTable).values({
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

		const settledAt = this.#now();
		const [record] = await this.#db
			.update(orderRefundTable)
			.set({
				completedAt: settledAt,
				stripeRefundId: refund.id,
				status: "succeeded",
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
		};
	}
}
