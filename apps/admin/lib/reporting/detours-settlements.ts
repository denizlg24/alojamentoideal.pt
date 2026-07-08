import {
	createStripeClientFromEnv,
	type PaymentIntentSettlementSnapshot,
	retrievePaymentIntentSettlementSnapshot,
	StripeConfigurationError,
} from "@workspace/core/integrations/stripe";
import {
	activityItemDetail,
	getDb,
	order,
	orderItem,
	providerBooking,
} from "@workspace/db";
import { and, asc, eq, gt, gte, lt, sql } from "drizzle-orm";
import {
	buildDetoursSettlementReport,
	type DetoursSettlementPeriod,
	type DetoursSettlementReport,
	type DetoursSettlementSourceRow,
} from "./detours-settlements-core";

export type PaymentSettlementRetriever = (
	paymentIntentId: string,
) => Promise<PaymentIntentSettlementSnapshot | null>;

function createStripeSettlementRetriever(): PaymentSettlementRetriever | null {
	try {
		const stripe = createStripeClientFromEnv();
		return (paymentIntentId) =>
			retrievePaymentIntentSettlementSnapshot(stripe, paymentIntentId);
	} catch (error) {
		if (error instanceof StripeConfigurationError) {
			return null;
		}
		throw error;
	}
}

async function listDetoursActivityRows(
	period: DetoursSettlementPeriod,
): Promise<DetoursSettlementSourceRow[]> {
	const settlementRecordedAt = sql<Date>`coalesce(${order.confirmedAt}, ${order.createdAt})`;
	const rows = await getDb()
		.select({
			activityDate: activityItemDetail.activityDate,
			activityTitle: orderItem.titleSnapshot,
			currency: orderItem.currency,
			itemId: orderItem.id,
			orderId: order.id,
			orderReference: order.publicReference,
			orderStatus: order.status,
			orderTotalMinor: order.totalMinor,
			providerBookingStatus: providerBooking.normalizedStatus,
			settlementRecordedAt,
			stripePaymentIntentId: order.stripePaymentIntentId,
			transferredGrossMinor: orderItem.totalMinor,
		})
		.from(orderItem)
		.innerJoin(order, eq(order.id, orderItem.orderId))
		.innerJoin(
			activityItemDetail,
			eq(activityItemDetail.orderItemId, orderItem.id),
		)
		.leftJoin(providerBooking, eq(providerBooking.orderItemId, orderItem.id))
		.where(
			and(
				eq(orderItem.type, "activity"),
				gt(order.amountPaidMinor, 0),
				gte(settlementRecordedAt, period.fromDate),
				lt(settlementRecordedAt, period.toExclusiveDate),
			),
		)
		.orderBy(
			asc(settlementRecordedAt),
			asc(order.publicReference),
			asc(orderItem.position),
		);

	return rows;
}

async function loadStripeSettlements(
	paymentIntentIds: readonly string[],
	retriever: PaymentSettlementRetriever | null,
): Promise<{
	failedPaymentIntentIds: Set<string>;
	settlementsByPaymentIntent: Map<
		string,
		PaymentIntentSettlementSnapshot | null
	>;
	stripeAvailable: boolean;
}> {
	if (!retriever) {
		return {
			failedPaymentIntentIds: new Set(),
			settlementsByPaymentIntent: new Map(),
			stripeAvailable: false,
		};
	}

	const settlementsByPaymentIntent = new Map<
		string,
		PaymentIntentSettlementSnapshot | null
	>();
	const failedPaymentIntentIds = new Set<string>();
	await Promise.all(
		paymentIntentIds.map(async (paymentIntentId) => {
			try {
				settlementsByPaymentIntent.set(
					paymentIntentId,
					await retriever(paymentIntentId),
				);
			} catch (error) {
				console.error("Failed to load Stripe settlement data", {
					error: error instanceof Error ? error.message : String(error),
					paymentIntentId,
				});
				failedPaymentIntentIds.add(paymentIntentId);
			}
		}),
	);

	return {
		failedPaymentIntentIds,
		settlementsByPaymentIntent,
		stripeAvailable: true,
	};
}

export async function getDetoursSettlementReport(
	period: DetoursSettlementPeriod,
	options: { retriever?: PaymentSettlementRetriever | null } = {},
): Promise<DetoursSettlementReport> {
	const rows = await listDetoursActivityRows(period);
	const paymentIntentIds = [
		...new Set(
			rows
				.map((row) => row.stripePaymentIntentId)
				.filter((id): id is string => Boolean(id)),
		),
	];
	const stripe = await loadStripeSettlements(
		paymentIntentIds,
		options.retriever === undefined
			? createStripeSettlementRetriever()
			: options.retriever,
	);

	return buildDetoursSettlementReport(rows, {
		failedPaymentIntentIds: stripe.failedPaymentIntentIds,
		period,
		settlementsByPaymentIntent: stripe.settlementsByPaymentIntent,
		stripeAvailable: stripe.stripeAvailable,
	});
}
