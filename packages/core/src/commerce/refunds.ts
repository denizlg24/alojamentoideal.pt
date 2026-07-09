import {
	type Database,
	type OrderRefund,
	type OrderRefundReason,
	orderItem as orderItemTable,
	orderRefund as orderRefundTable,
	order as orderTable,
} from "@workspace/db";
import { and, asc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
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
 * Whether a Stripe failure is permanent (retrying the same request can never
 * succeed) or transient (network, rate limit, Stripe 5xx). Drives the
 * reconciler: permanent failures release the reserved refund amount and park
 * the ledger row failed; transient ones stay pending for the next run. Stripe
 * replays error responses for reused idempotency keys only for 4xx results it
 * stored, which matches this split.
 */
export function isPermanentStripeError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	const type = (error as { type?: unknown }).type;
	return (
		type === "StripeInvalidRequestError" ||
		type === "StripeCardError" ||
		type === "StripeAuthenticationError" ||
		type === "StripePermissionError" ||
		type === "StripeIdempotencyError"
	);
}

/** Outcome counts for one `reconcileRefunds` run, returned to the cron. */
export interface RefundReconciliationSummary {
	/** Pending rows whose Stripe refund failed permanently; reservation rolled back. */
	failedRefunds: number;
	/** Pending rows completed end to end (refund and, when owed, reversal). */
	resumedRefunds: number;
	/** Succeeded rows whose owed transfer reversal was completed on retry. */
	retriedReversals: number;
	/** Reversal retries that failed again and stay flagged. */
	reversalRetryFailures: number;
	/** Pending rows left pending (transient failure or Stripe unavailable). */
	stillPending: number;
}

export interface ReconcileRefundsOptions {
	/** Max rows examined per category per run. */
	batchSize?: number;
	/**
	 * Pending rows younger than this are skipped: the operator request that
	 * created them may still be in flight.
	 */
	pendingMinAgeMs?: number;
}

const RECONCILE_PENDING_MIN_AGE_MS = 10 * 60 * 1000;
const RECONCILE_BATCH_SIZE = 25;

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

		const activityTotalMinor = await this.#getActivityTotalMinor(order.id);

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
			({ error: transferReversalError, reversal: transferReversal } =
				await this.#attemptActivityReversal({
					amountMinor: reversalAmountMinor,
					idempotencyKey: `${idempotencyKey}:reversal`,
					orderId: order.id,
					paymentIntentId: order.stripePaymentIntentId,
					refundId: refund.id,
				}));
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

	/**
	 * Cron-driven repair pass over the refund ledger. Two categories:
	 *
	 * 1. `pending` rows older than the min age — a crash between the reservation
	 *    and the Stripe call, or between Stripe and the ledger update. The stored
	 *    idempotency key makes the retry safe: Stripe replays an already-created
	 *    refund instead of issuing a second one. Permanent failures release the
	 *    reserved amount and park the row failed; transient ones stay pending.
	 * 2. `succeeded` rows whose Detours transfer reversal failed (error recorded,
	 *    no reversal id) — the reversal is retried with its original key.
	 */
	async reconcileRefunds(
		options: ReconcileRefundsOptions = {},
	): Promise<RefundReconciliationSummary> {
		const summary: RefundReconciliationSummary = {
			failedRefunds: 0,
			resumedRefunds: 0,
			retriedReversals: 0,
			reversalRetryFailures: 0,
			stillPending: 0,
		};
		const batchSize = options.batchSize ?? RECONCILE_BATCH_SIZE;
		const cutoff = new Date(
			this.#now().getTime() -
				(options.pendingMinAgeMs ?? RECONCILE_PENDING_MIN_AGE_MS),
		);

		const pendingRows = await this.#db
			.select({
				amountMinor: orderRefundTable.amountMinor,
				id: orderRefundTable.id,
				idempotencyKey: orderRefundTable.stripeRefundIdempotencyKey,
				orderId: orderRefundTable.orderId,
				orderItemId: orderRefundTable.orderItemId,
				orderTotalMinor: orderTable.totalMinor,
				reason: orderRefundTable.reason,
				stripePaymentIntentId: orderTable.stripePaymentIntentId,
			})
			.from(orderRefundTable)
			.innerJoin(orderTable, eq(orderRefundTable.orderId, orderTable.id))
			.where(
				and(
					eq(orderRefundTable.status, "pending"),
					lte(orderRefundTable.createdAt, cutoff),
				),
			)
			.orderBy(asc(orderRefundTable.createdAt))
			.limit(batchSize);

		const refundPayment = this.#refundPayment;
		for (const row of pendingRows) {
			if (!refundPayment || !row.stripePaymentIntentId) {
				summary.stillPending += 1;
				continue;
			}
			let refund: RefundResult;
			try {
				refund = await refundPayment({
					amountMinor: row.amountMinor,
					idempotencyKey: row.idempotencyKey,
					paymentIntentId: row.stripePaymentIntentId,
					reason: stripeRefundReason(row.reason),
				});
			} catch (error) {
				if (!isPermanentStripeError(error)) {
					summary.stillPending += 1;
					continue;
				}
				const failedAt = this.#now();
				await this.#db.transaction(async (tx) => {
					await tx
						.update(orderTable)
						.set({
							amountRefundedMinor: sql`${orderTable.amountRefundedMinor} - ${row.amountMinor}`,
							updatedAt: failedAt,
						})
						.where(eq(orderTable.id, row.orderId));
					await tx
						.update(orderRefundTable)
						.set({
							lastErrorMessage: describeRefundError(error),
							status: "failed",
							updatedAt: failedAt,
						})
						.where(eq(orderRefundTable.id, row.id));
				});
				trackEvent({
					metadata: {
						amountMinor: row.amountMinor,
						error: describeRefundError(error),
						orderId: row.orderId,
						refundRecordId: row.id,
					},
					name: "order_refund_reconcile_failed",
					provider: "stripe",
					severity: "error",
					type: "integration",
				});
				summary.failedRefunds += 1;
				continue;
			}

			const reversalAmountMinor = await this.#owedReversalAmountMinor(row);
			let reversal: TransferReversalResult | null = null;
			let reversalError: string | undefined;
			if (reversalAmountMinor > 0) {
				({ error: reversalError, reversal } =
					await this.#attemptActivityReversal({
						amountMinor: reversalAmountMinor,
						idempotencyKey: `${row.idempotencyKey}:reversal`,
						orderId: row.orderId,
						paymentIntentId: row.stripePaymentIntentId,
						refundId: refund.id,
					}));
			}
			const settledAt = this.#now();
			await this.#db
				.update(orderRefundTable)
				.set({
					completedAt: settledAt,
					lastErrorMessage: reversalError ?? null,
					status: "succeeded",
					stripeRefundId: refund.id,
					stripeTransferReversalId: reversal?.id ?? null,
					transferReversalAmountMinor: reversal?.amountMinor ?? null,
					updatedAt: settledAt,
				})
				.where(eq(orderRefundTable.id, row.id));
			trackEvent({
				metadata: {
					amountMinor: row.amountMinor,
					orderId: row.orderId,
					refundId: refund.id,
				},
				name: "order_refund_reconciled",
				provider: "stripe",
				severity: "info",
				type: "integration",
			});
			summary.resumedRefunds += 1;
		}

		const owedReversalRows = await this.#db
			.select({
				amountMinor: orderRefundTable.amountMinor,
				id: orderRefundTable.id,
				idempotencyKey: orderRefundTable.stripeRefundIdempotencyKey,
				orderId: orderRefundTable.orderId,
				orderItemId: orderRefundTable.orderItemId,
				orderTotalMinor: orderTable.totalMinor,
				stripePaymentIntentId: orderTable.stripePaymentIntentId,
				stripeRefundId: orderRefundTable.stripeRefundId,
			})
			.from(orderRefundTable)
			.innerJoin(orderTable, eq(orderRefundTable.orderId, orderTable.id))
			.where(
				and(
					eq(orderRefundTable.status, "succeeded"),
					isNull(orderRefundTable.stripeTransferReversalId),
					isNotNull(orderRefundTable.lastErrorMessage),
				),
			)
			.orderBy(asc(orderRefundTable.createdAt))
			.limit(batchSize);

		for (const row of owedReversalRows) {
			if (!row.stripePaymentIntentId) {
				summary.reversalRetryFailures += 1;
				continue;
			}
			const reversalAmountMinor = await this.#owedReversalAmountMinor(row);
			let reversal: TransferReversalResult | null = null;
			if (reversalAmountMinor > 0) {
				const attempt = await this.#attemptActivityReversal({
					amountMinor: reversalAmountMinor,
					idempotencyKey: `${row.idempotencyKey}:reversal`,
					orderId: row.orderId,
					paymentIntentId: row.stripePaymentIntentId,
					refundId: row.stripeRefundId,
				});
				if (attempt.error) {
					await this.#db
						.update(orderRefundTable)
						.set({
							lastErrorMessage: attempt.error,
							updatedAt: this.#now(),
						})
						.where(eq(orderRefundTable.id, row.id));
					summary.reversalRetryFailures += 1;
					continue;
				}
				reversal = attempt.reversal;
			}
			// A null reversal with no error means the charge carries no transfer
			// (or nothing is owed after all); clear the flag so the row stops
			// resurfacing.
			await this.#db
				.update(orderRefundTable)
				.set({
					lastErrorMessage: null,
					stripeTransferReversalId: reversal?.id ?? null,
					transferReversalAmountMinor: reversal?.amountMinor ?? null,
					updatedAt: this.#now(),
				})
				.where(eq(orderRefundTable.id, row.id));
			summary.retriedReversals += 1;
		}

		return summary;
	}

	/**
	 * Recomputes how much of a ledger row's refund must be pulled back from
	 * Detours, from the order's current item mix (same attribution rules as
	 * `refundOrder`).
	 */
	/** Sum of activity item totals on an order, for reversal attribution. */
	async #getActivityTotalMinor(orderId: string): Promise<number> {
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
					eq(orderItemTable.orderId, orderId),
					eq(orderItemTable.type, "activity"),
				),
			);
		return activityTotals?.totalMinor ?? 0;
	}

	async #owedReversalAmountMinor(row: {
		amountMinor: number;
		orderId: string;
		orderItemId: string | null;
		orderTotalMinor: number;
	}): Promise<number> {
		const activityTotalMinor = await this.#getActivityTotalMinor(row.orderId);
		let attributedItemType: "accommodation" | "activity" | null = null;
		if (row.orderItemId) {
			const [item] = await this.#db
				.select({ type: orderItemTable.type })
				.from(orderItemTable)
				.where(eq(orderItemTable.id, row.orderItemId))
				.limit(1);
			attributedItemType =
				item?.type === "activity" || item?.type === "accommodation"
					? item.type
					: null;
		}
		return activityReversalAmountMinor({
			activityTotalMinor,
			attributedItemType,
			orderTotalMinor: row.orderTotalMinor,
			refundMinor: row.amountMinor,
		});
	}

	async #attemptActivityReversal(input: {
		amountMinor: number;
		idempotencyKey: string;
		orderId: string;
		paymentIntentId: string;
		refundId: string | null;
	}): Promise<{ error?: string; reversal: TransferReversalResult | null }> {
		const reverseActivityTransfer = this.#reverseActivityTransfer;
		let reversal: TransferReversalResult | null = null;
		let error: string | undefined;
		if (!reverseActivityTransfer) {
			error = "Transfer reversals are unavailable: Stripe is not configured.";
		} else {
			try {
				reversal = await reverseActivityTransfer({
					amountMinor: input.amountMinor,
					idempotencyKey: input.idempotencyKey,
					paymentIntentId: input.paymentIntentId,
				});
			} catch (caught) {
				error = describeRefundError(caught);
			}
		}
		if (error) {
			trackEvent({
				metadata: {
					amountMinor: input.amountMinor,
					error,
					orderId: input.orderId,
					refundId: input.refundId,
				},
				name: "order_refund_transfer_reversal_failed",
				provider: "stripe",
				severity: "error",
				type: "integration",
			});
		}
		return { reversal, ...(error ? { error } : {}) };
	}
}
