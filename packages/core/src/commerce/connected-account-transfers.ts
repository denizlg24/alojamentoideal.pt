import {
	accommodationItemDetail,
	connectedAccountTransfer,
	type Database,
	order,
	orderItem,
} from "@workspace/db";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import type {
	ConnectedAccountTransferRequest,
	ConnectedAccountTransferResult,
} from "../integrations/stripe";
import { trackEvent } from "../observability";

const MAX_FAST_ATTEMPTS = 8;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 24 * 60 * 60 * 1000;

export interface ConnectedAccountTransferReconciliationSummary {
	created: number;
	failed: number;
	materialized: number;
	scanned: number;
}

interface ConnectedAccountTransferServiceOptions {
	createTransfer?: (
		request: ConnectedAccountTransferRequest,
	) => Promise<ConnectedAccountTransferResult>;
	db: Database;
	now?: () => Date;
}

/**
 * Durable outbox processor for per-listing Stripe Connect payouts. Confirmed
 * order items first become local ledger rows, then Stripe calls are retried
 * with the row's stable idempotency key until the result is recorded.
 */
export class ConnectedAccountTransferService {
	readonly #createTransfer: ConnectedAccountTransferServiceOptions["createTransfer"];
	readonly #db: Database;
	readonly #now: () => Date;

	constructor(options: ConnectedAccountTransferServiceOptions) {
		this.#createTransfer = options.createTransfer;
		this.#db = options.db;
		this.#now = options.now ?? (() => new Date());
	}

	async reconcile(
		limit = 50,
	): Promise<ConnectedAccountTransferReconciliationSummary> {
		const summary: ConnectedAccountTransferReconciliationSummary = {
			created: 0,
			failed: 0,
			materialized: 0,
			scanned: 0,
		};
		summary.materialized = await this.#materialize(limit);
		if (!this.#createTransfer) {
			return summary;
		}

		const now = this.#now();
		const rows = await this.#db
			.select({
				amountMinor: connectedAccountTransfer.amountMinor,
				attemptCount: connectedAccountTransfer.attemptCount,
				currency: connectedAccountTransfer.currency,
				destinationAccountId: connectedAccountTransfer.destinationAccountId,
				id: connectedAccountTransfer.id,
				idempotencyKey: connectedAccountTransfer.stripeIdempotencyKey,
				orderId: connectedAccountTransfer.orderId,
				orderItemId: connectedAccountTransfer.orderItemId,
				paymentIntentId: order.stripePaymentIntentId,
			})
			.from(connectedAccountTransfer)
			.innerJoin(order, eq(connectedAccountTransfer.orderId, order.id))
			.where(
				and(
					inArray(connectedAccountTransfer.status, ["pending", "failed"]),
					lte(connectedAccountTransfer.nextAttemptAt, now),
					eq(order.status, "confirmed"),
					gt(order.amountPaidMinor, 0),
					isNotNull(order.stripePaymentIntentId),
				),
			)
			.orderBy(asc(connectedAccountTransfer.createdAt))
			.limit(limit);

		for (const row of rows) {
			summary.scanned += 1;
			if (!row.paymentIntentId) continue;
			try {
				const result = await this.#createTransfer({
					amountMinor: row.amountMinor,
					currency: row.currency,
					destinationAccountId: row.destinationAccountId,
					idempotencyKey: row.idempotencyKey,
					orderId: row.orderId,
					orderItemId: row.orderItemId,
					paymentIntentId: row.paymentIntentId,
				});
				const completedAt = this.#now();
				await this.#db
					.update(connectedAccountTransfer)
					.set({
						attemptCount: row.attemptCount + 1,
						completedAt,
						lastErrorMessage: null,
						status: "succeeded",
						stripeSourceChargeId: result.sourceChargeId,
						stripeTransferId: result.id,
						updatedAt: completedAt,
					})
					.where(eq(connectedAccountTransfer.id, row.id));
				summary.created += 1;
				trackEvent({
					metadata: {
						amountMinor: row.amountMinor,
						orderId: row.orderId,
						orderItemId: row.orderItemId,
						transferId: result.id,
					},
					name: "listing_connected_account_transfer_succeeded",
					provider: "stripe",
					type: "integration",
				});
			} catch (error) {
				const attemptCount = row.attemptCount + 1;
				const failedAt = this.#now();
				await this.#db
					.update(connectedAccountTransfer)
					.set({
						attemptCount,
						lastErrorMessage: transferError(error),
						nextAttemptAt: new Date(
							failedAt.getTime() + retryDelay(attemptCount),
						),
						status: attemptCount >= MAX_FAST_ATTEMPTS ? "failed" : "pending",
						updatedAt: failedAt,
					})
					.where(eq(connectedAccountTransfer.id, row.id));
				summary.failed += 1;
			}
		}

		return summary;
	}

	async #materialize(limit: number): Promise<number> {
		const candidates = await this.#db
			.select({
				amountMinor: orderItem.totalMinor,
				currency: orderItem.currency,
				destinationAccountId: accommodationItemDetail.stripeConnectedAccountId,
				orderId: orderItem.orderId,
				orderItemId: orderItem.id,
			})
			.from(orderItem)
			.innerJoin(order, eq(orderItem.orderId, order.id))
			.innerJoin(
				accommodationItemDetail,
				eq(accommodationItemDetail.orderItemId, orderItem.id),
			)
			.leftJoin(
				connectedAccountTransfer,
				eq(connectedAccountTransfer.orderItemId, orderItem.id),
			)
			.where(
				and(
					eq(order.status, "confirmed"),
					eq(orderItem.type, "accommodation"),
					inArray(orderItem.status, ["draft", "pending", "confirmed"]),
					gt(orderItem.totalMinor, 0),
					isNotNull(accommodationItemDetail.stripeConnectedAccountId),
					isNull(connectedAccountTransfer.id),
				),
			)
			.limit(limit);

		let materialized = 0;
		for (const candidate of candidates) {
			if (!candidate.destinationAccountId) continue;
			const id = crypto.randomUUID();
			const inserted = await this.#db
				.insert(connectedAccountTransfer)
				.values({
					amountMinor: candidate.amountMinor,
					currency: candidate.currency,
					destinationAccountId: candidate.destinationAccountId,
					id,
					orderId: candidate.orderId,
					orderItemId: candidate.orderItemId,
					stripeIdempotencyKey: `listing-transfer:${candidate.orderItemId}`,
				})
				.onConflictDoNothing()
				.returning({ id: connectedAccountTransfer.id });
			if (inserted.length > 0) materialized += 1;
		}
		return materialized;
	}
}

function retryDelay(attemptCount: number): number {
	return Math.min(
		RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1),
		RETRY_MAX_MS,
	);
}

function transferError(error: unknown): string {
	const message =
		error instanceof Error ? error.message : "Stripe transfer failed";
	return message.slice(0, 500);
}
