import {
	accommodationItemDetail as accommodationItemDetailTable,
	connectedAccountTransfer as connectedAccountTransferTable,
	type Database,
	type OrderRefund,
	type OrderRefundReason,
	orderItem as orderItemTable,
	orderRefund as orderRefundTable,
	order as orderTable,
} from "@workspace/db";
import { and, asc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type {
	DirectTransferReversalRequest,
	RefundRequest,
	RefundResult,
	TransferReversalRequest,
	TransferReversalResult,
} from "../integrations/stripe";
import { trackEvent } from "../observability";
import { CommerceError } from "./errors";

export interface OrderRefundServiceOptions {
	/** Cancels an attributed provider reservation before money is moved. */
	cancelOrderItemReservation?: (
		orderId: string,
		orderItemId: string,
		reason: string,
	) => Promise<void>;
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
	/** Reverses a separately-created per-listing transfer. */
	reverseListingTransfer?: (
		request: DirectTransferReversalRequest,
	) => Promise<TransferReversalResult>;
}

export interface RefundOrderInput {
	amountMinor: number;
	/** Free-text operator note, retained on the ledger row. */
	note?: string | null;
	orderId: string;
	/** Optional reservation the refund is attributed to and cancels. */
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
	 * Set when the refund succeeded but a connected-account reversal failed;
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

/**
 * Whether a reservation-cancel failure is permanent for the refund ledger.
 * `CommerceService.cancelOrderItemReservation` maps transient provider
 * failures, gateway unavailability and mutation-lock contention to 503;
 * every other status (404/422/502) cannot succeed on a blind retry. Unknown
 * errors count as transient so the reconciler keeps retrying them.
 */
export function isPermanentReservationCancelError(error: unknown): boolean {
	return error instanceof CommerceError && error.status !== 503;
}

/** Outcome counts for one `reconcileRefunds` run, returned to the cron. */
export interface RefundReconciliationSummary {
	/** Pending rows whose cancel or Stripe refund failed permanently; reservation rolled back. */
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
 * cancel on saga failure): this path supports repeated partial refunds recorded
 * in the `order_refunds` ledger. Item-attributed refunds first cancel that one
 * provider reservation; whole-order refunds leave reservations unchanged.
 *
 * Over-refund safety: the order aggregate is reserved atomically (a guarded
 * `amount_refunded += n WHERE amount_refunded + n <= amount_paid`) before the
 * Stripe call, so two concurrent refunds can never exceed the captured amount.
 * Permanent failures roll the reservation back and park the ledger row failed;
 * transient cancel or Stripe failures leave the row pending for the
 * reconciler to resume.
 */
export class OrderRefundService {
	readonly #db: Database;
	readonly #cancelOrderItemReservation: OrderRefundServiceOptions["cancelOrderItemReservation"];
	readonly #now: () => Date;
	readonly #refundPayment: OrderRefundServiceOptions["refundPayment"];
	readonly #reverseActivityTransfer: OrderRefundServiceOptions["reverseActivityTransfer"];
	readonly #reverseListingTransfer: OrderRefundServiceOptions["reverseListingTransfer"];

	constructor(options: OrderRefundServiceOptions) {
		this.#cancelOrderItemReservation = options.cancelOrderItemReservation;
		this.#db = options.db;
		this.#now = options.now ?? (() => new Date());
		this.#refundPayment = options.refundPayment;
		this.#reverseActivityTransfer = options.reverseActivityTransfer;
		this.#reverseListingTransfer = options.reverseListingTransfer;
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
			if (attributedItemType === "accommodation") {
				await this.#assertListingTransferSettled(orderItemId);
			}
		} else {
			await this.#assertNoListingTransfersForUnattributedRefund(order.id);
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
		const initializedRecordId = recordId;

		if (orderItemId) {
			try {
				await this.#cancelAttributedItem(order.id, orderItemId);
			} catch (error) {
				if (isPermanentReservationCancelError(error)) {
					await this.#db.transaction(async (tx) => {
						await tx
							.update(orderTable)
							.set({
								amountRefundedMinor: sql`${orderTable.amountRefundedMinor} - ${input.amountMinor}`,
								updatedAt: this.#now(),
							})
							.where(eq(orderTable.id, order.id));
						await tx
							.update(orderRefundTable)
							.set({
								lastErrorMessage: describeRefundError(error),
								status: "failed",
								updatedAt: this.#now(),
							})
							.where(eq(orderRefundTable.id, initializedRecordId));
					});
				} else {
					// Transient cancel failure: keep the amount reserved and the row
					// pending so the reconciler retries the cancel and the refund.
					await this.#db
						.update(orderRefundTable)
						.set({
							lastErrorMessage: describeRefundError(error),
							updatedAt: this.#now(),
						})
						.where(eq(orderRefundTable.id, initializedRecordId));
				}
				if (error instanceof CommerceError) {
					throw error;
				}
				throw new CommerceError(
					"refund_precondition_failed",
					`The refund was not issued because its reservation update failed: ${describeRefundError(error)}`,
					503,
				);
			}
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
			if (orderItemId && !isPermanentStripeError(error)) {
				// The attributed reservation is already cancelled; keep the row
				// pending so the reconciler resumes the Stripe refund instead of
				// stranding a cancelled item with no refund.
				await this.#db
					.update(orderRefundTable)
					.set({
						lastErrorMessage: describeRefundError(error),
						updatedAt: this.#now(),
					})
					.where(eq(orderRefundTable.id, recordId));
			} else {
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
			}
			if (error instanceof CommerceError) {
				throw error;
			}
			throw new CommerceError(
				"refund_failed",
				`The Stripe refund could not be created: ${describeRefundError(error)}`,
				502,
			);
		}

		// Pull the attributed listing payout or the activity share of the refund
		// back with an explicit reversal amount. This runs after the refund; a
		// reversal failure never unwinds the guest refund and remains retryable.
		const { error: transferReversalError, reversal: transferReversal } =
			await this.#attemptOwedTransferReversal({
				activityTotalMinor,
				amountMinor: input.amountMinor,
				attributedItemType,
				idempotencyKey: `${idempotencyKey}:reversal`,
				orderId: order.id,
				orderItemId,
				orderTotalMinor: order.totalMinor,
				paymentIntentId: order.stripePaymentIntentId,
				persistedReversalAmountMinor: null,
				refundId: refund.id,
				refundRecordId: initializedRecordId,
			});

		const settledAt = this.#now();
		const [record] = await this.#db
			.update(orderRefundTable)
			.set({
				completedAt: settledAt,
				lastErrorMessage: transferReversalError ?? null,
				status: "succeeded",
				stripeRefundId: refund.id,
				updatedAt: settledAt,
				// On reversal failure, keep the pinned transferReversalAmountMinor
				// so the reconciler retries with the amount the idempotency key
				// was first issued with.
				...(transferReversal
					? {
							stripeTransferReversalId: transferReversal.id,
							transferReversalAmountMinor: transferReversal.amountMinor,
						}
					: {}),
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
	 * 2. `succeeded` rows whose connected-account reversal failed (error
	 *    recorded, no reversal id) — retry with the original key.
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
				transferReversalAmountMinor:
					orderRefundTable.transferReversalAmountMinor,
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
			if (row.orderItemId) {
				try {
					await this.#cancelAttributedItem(row.orderId, row.orderItemId);
				} catch (error) {
					if (!isPermanentReservationCancelError(error)) {
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

			const { error: reversalError, reversal } =
				await this.#attemptOwedTransferReversal({
					amountMinor: row.amountMinor,
					idempotencyKey: `${row.idempotencyKey}:reversal`,
					orderId: row.orderId,
					orderItemId: row.orderItemId,
					orderTotalMinor: row.orderTotalMinor,
					paymentIntentId: row.stripePaymentIntentId,
					persistedReversalAmountMinor: row.transferReversalAmountMinor,
					refundId: refund.id,
					refundRecordId: row.id,
				});
			const settledAt = this.#now();
			await this.#db
				.update(orderRefundTable)
				.set({
					completedAt: settledAt,
					lastErrorMessage: reversalError ?? null,
					status: "succeeded",
					stripeRefundId: refund.id,
					updatedAt: settledAt,
					...(reversal
						? {
								stripeTransferReversalId: reversal.id,
								transferReversalAmountMinor: reversal.amountMinor,
							}
						: {}),
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
				transferReversalAmountMinor:
					orderRefundTable.transferReversalAmountMinor,
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
			const attempt = await this.#attemptOwedTransferReversal({
				amountMinor: row.amountMinor,
				idempotencyKey: `${row.idempotencyKey}:reversal`,
				orderId: row.orderId,
				orderItemId: row.orderItemId,
				orderTotalMinor: row.orderTotalMinor,
				paymentIntentId: row.stripePaymentIntentId,
				persistedReversalAmountMinor: row.transferReversalAmountMinor,
				refundId: row.stripeRefundId,
				refundRecordId: row.id,
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
			const reversal = attempt.reversal;
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

	async #attemptOwedTransferReversal(input: {
		activityTotalMinor?: number;
		amountMinor: number;
		attributedItemType?: "accommodation" | "activity" | null;
		idempotencyKey: string;
		orderId: string;
		orderItemId: string | null;
		orderTotalMinor: number;
		paymentIntentId: string;
		persistedReversalAmountMinor: number | null;
		refundId: string | null;
		refundRecordId: string;
	}): Promise<{ error?: string; reversal: TransferReversalResult | null }> {
		const listingTarget = await this.#listingReversalTarget(
			input.orderItemId,
			input.amountMinor,
			input.persistedReversalAmountMinor,
		);
		if (listingTarget) {
			const reverseListingTransfer = this.#reverseListingTransfer;
			if (!reverseListingTransfer) {
				return {
					error:
						"Listing transfer reversals are unavailable: Stripe is not configured.",
					reversal: null,
				};
			}
			// Pin the computed amount on the ledger row before calling Stripe.
			// The reversal idempotency key is stable across retries, so every
			// retry must send the exact amount the key was first issued with,
			// even after sibling reversals change the remaining balance.
			if (input.persistedReversalAmountMinor === null) {
				await this.#db
					.update(orderRefundTable)
					.set({
						transferReversalAmountMinor: listingTarget.amountMinor,
						updatedAt: this.#now(),
					})
					.where(eq(orderRefundTable.id, input.refundRecordId));
			}
			try {
				return {
					reversal: await reverseListingTransfer({
						amountMinor: listingTarget.amountMinor,
						idempotencyKey: input.idempotencyKey,
						transferId: listingTarget.transferId,
					}),
				};
			} catch (error) {
				return { error: describeRefundError(error), reversal: null };
			}
		}

		const activityTotalMinor =
			input.activityTotalMinor ??
			(await this.#getActivityTotalMinor(input.orderId));
		let attributedItemType = input.attributedItemType;
		if (attributedItemType === undefined && input.orderItemId) {
			const [item] = await this.#db
				.select({ type: orderItemTable.type })
				.from(orderItemTable)
				.where(eq(orderItemTable.id, input.orderItemId))
				.limit(1);
			attributedItemType =
				item?.type === "activity" || item?.type === "accommodation"
					? item.type
					: null;
		}
		const amountMinor = activityReversalAmountMinor({
			activityTotalMinor,
			attributedItemType: attributedItemType ?? null,
			orderTotalMinor: input.orderTotalMinor,
			refundMinor: input.amountMinor,
		});
		return amountMinor > 0
			? this.#attemptActivityReversal({
					amountMinor,
					idempotencyKey: input.idempotencyKey,
					orderId: input.orderId,
					paymentIntentId: input.paymentIntentId,
					refundId: input.refundId,
				})
			: { reversal: null };
	}

	async #listingReversalTarget(
		orderItemId: string | null,
		refundMinor: number,
		pinnedAmountMinor: number | null = null,
	): Promise<{ amountMinor: number; transferId: string } | null> {
		if (!orderItemId) return null;
		const [transfer] = await this.#db
			.select({
				amountMinor: connectedAccountTransferTable.amountMinor,
				transferId: connectedAccountTransferTable.stripeTransferId,
			})
			.from(connectedAccountTransferTable)
			.where(
				and(
					eq(connectedAccountTransferTable.orderItemId, orderItemId),
					eq(connectedAccountTransferTable.status, "succeeded"),
					isNotNull(connectedAccountTransferTable.stripeTransferId),
				),
			)
			.limit(1);
		if (!transfer?.transferId) return null;
		// A pinned amount from an earlier attempt wins over the live remaining
		// balance: the retry must replay the original Stripe request exactly.
		if (pinnedAmountMinor !== null) {
			return pinnedAmountMinor > 0
				? { amountMinor: pinnedAmountMinor, transferId: transfer.transferId }
				: null;
		}
		const [reversed] = await this.#db
			.select({
				amountMinor:
					sql<number>`coalesce(sum(${orderRefundTable.transferReversalAmountMinor}), 0)`.mapWith(
						Number,
					),
			})
			.from(orderRefundTable)
			.where(
				and(
					eq(orderRefundTable.orderItemId, orderItemId),
					eq(orderRefundTable.status, "succeeded"),
					isNotNull(orderRefundTable.stripeTransferReversalId),
				),
			);
		const remaining = Math.max(
			0,
			transfer.amountMinor - (reversed?.amountMinor ?? 0),
		);
		return remaining > 0
			? {
					amountMinor: Math.min(refundMinor, remaining),
					transferId: transfer.transferId,
				}
			: null;
	}

	async #assertListingTransferSettled(orderItemId: string): Promise<void> {
		const [detail] = await this.#db
			.select({
				connectedAccountId:
					accommodationItemDetailTable.stripeConnectedAccountId,
			})
			.from(accommodationItemDetailTable)
			.where(eq(accommodationItemDetailTable.orderItemId, orderItemId))
			.limit(1);
		if (!detail?.connectedAccountId) return;

		const [transfer] = await this.#db
			.select({ status: connectedAccountTransferTable.status })
			.from(connectedAccountTransferTable)
			.where(eq(connectedAccountTransferTable.orderItemId, orderItemId))
			.limit(1);
		if (transfer?.status !== "succeeded") {
			throw new CommerceError(
				"refund_precondition_failed",
				"The listing payout is still reconciling. Retry the refund after the transfer settles.",
				409,
			);
		}
	}

	async #assertNoListingTransfersForUnattributedRefund(
		orderId: string,
	): Promise<void> {
		const [transfer] = await this.#db
			.select({ orderItemId: accommodationItemDetailTable.orderItemId })
			.from(accommodationItemDetailTable)
			.innerJoin(
				orderItemTable,
				eq(orderItemTable.id, accommodationItemDetailTable.orderItemId),
			)
			.where(
				and(
					eq(orderItemTable.orderId, orderId),
					isNotNull(accommodationItemDetailTable.stripeConnectedAccountId),
				),
			)
			.limit(1);
		if (transfer) {
			throw new CommerceError(
				"refund_precondition_failed",
				"Refunds for orders with listing payouts must be attributed to one reservation at a time.",
				422,
			);
		}
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

	async #cancelAttributedItem(
		orderId: string,
		orderItemId: string,
	): Promise<void> {
		if (!this.#cancelOrderItemReservation) {
			throw new CommerceError(
				"reservation_gateway_unavailable",
				"The attributed reservation cannot be cancelled right now.",
				503,
			);
		}
		await this.#cancelOrderItemReservation(
			orderId,
			orderItemId,
			"admin_item_refund",
		);
	}
}
