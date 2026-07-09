import type {
	GuestSubmissionJobStatus,
	OrderRefundReason,
} from "@workspace/db";
import {
	conversation as conversationTable,
	getDb,
	guestSubmissionJob as guestSubmissionJobTable,
	orderRefund as orderRefundTable,
	order as orderTable,
	providerBooking as providerBookingTable,
} from "@workspace/db";
import {
	and,
	asc,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";

/**
 * Read-only views over every queue a reconciler cron drains. Each loader
 * mirrors its reconciler's selection predicate (minus any due-time gate, so
 * scheduled-but-not-yet-due work is visible too) and returns the true queue
 * size alongside the oldest rows.
 */

const QUEUE_ROW_LIMIT = 25;

export interface ReconciliationQueue<Row> {
	count: number;
	rows: Row[];
}

const countAll = sql<number>`count(*)`.mapWith(Number);

export interface ReservationHoldRow {
	attemptCount: number;
	lastErrorCode: string | null;
	needsRecovery: boolean;
	nextAttemptAt: Date | null;
	normalizedStatus: string;
	orderReference: string;
	orderStatus: string;
	provider: string;
	providerReservationId: string | null;
}

// Mirror of `reconcileReservations` pass A, without the `nextAttemptAt <= now`
// gate: paid pending orders awaiting confirm, unsettled holds still being
// nudged, and terminal orders whose provider hold release keeps retrying.
const reservationHoldPredicate = and(
	inArray(orderTable.status, ["pending", "cancelled", "failed"]),
	or(
		and(
			eq(orderTable.status, "pending"),
			gt(orderTable.amountPaidMinor, 0),
			eq(providerBookingTable.normalizedStatus, "confirmed"),
		),
		and(
			eq(providerBookingTable.normalizedStatus, "pending"),
			or(
				eq(providerBookingTable.needsRecovery, false),
				eq(providerBookingTable.lastErrorCode, "confirm_not_settled"),
			),
		),
		and(
			eq(providerBookingTable.normalizedStatus, "failed"),
			isNotNull(providerBookingTable.providerReservationId),
			or(
				eq(providerBookingTable.needsRecovery, false),
				and(
					eq(orderTable.status, "pending"),
					sql`${orderTable.failureCode} is distinct from 'manual_recovery'`,
				),
			),
		),
	),
);

export async function loadReservationHoldQueue(): Promise<
	ReconciliationQueue<ReservationHoldRow>
> {
	const db = getDb();
	const [rows, [totals]] = await Promise.all([
		db
			.select({
				attemptCount: providerBookingTable.attemptCount,
				lastErrorCode: providerBookingTable.lastErrorCode,
				needsRecovery: providerBookingTable.needsRecovery,
				nextAttemptAt: providerBookingTable.nextAttemptAt,
				normalizedStatus: providerBookingTable.normalizedStatus,
				orderReference: orderTable.publicReference,
				orderStatus: orderTable.status,
				provider: providerBookingTable.provider,
				providerReservationId: providerBookingTable.providerReservationId,
			})
			.from(providerBookingTable)
			.innerJoin(orderTable, eq(orderTable.id, providerBookingTable.orderId))
			.where(reservationHoldPredicate)
			.orderBy(asc(providerBookingTable.nextAttemptAt))
			.limit(QUEUE_ROW_LIMIT),
		db
			.select({ count: countAll })
			.from(providerBookingTable)
			.innerJoin(orderTable, eq(orderTable.id, providerBookingTable.orderId))
			.where(reservationHoldPredicate),
	]);
	return { count: totals?.count ?? 0, rows };
}

export interface PendingRefundRow {
	amountMinor: number;
	createdAt: Date;
	currency: string;
	lastErrorMessage: string | null;
	orderReference: string;
	reason: OrderRefundReason;
}

export async function loadPendingRefundQueue(): Promise<
	ReconciliationQueue<PendingRefundRow>
> {
	const db = getDb();
	const predicate = eq(orderRefundTable.status, "pending");
	const [rows, [totals]] = await Promise.all([
		db
			.select({
				amountMinor: orderRefundTable.amountMinor,
				createdAt: orderRefundTable.createdAt,
				currency: orderRefundTable.currency,
				lastErrorMessage: orderRefundTable.lastErrorMessage,
				orderReference: orderTable.publicReference,
				reason: orderRefundTable.reason,
			})
			.from(orderRefundTable)
			.innerJoin(orderTable, eq(orderTable.id, orderRefundTable.orderId))
			.where(predicate)
			.orderBy(asc(orderRefundTable.createdAt))
			.limit(QUEUE_ROW_LIMIT),
		db.select({ count: countAll }).from(orderRefundTable).where(predicate),
	]);
	return { count: totals?.count ?? 0, rows };
}

export interface OwedReversalRow {
	amountMinor: number;
	completedAt: Date | null;
	currency: string;
	lastErrorMessage: string | null;
	orderReference: string;
}

// Succeeded refunds whose Detours transfer reversal failed: the refund left
// the platform account but the activity share was never pulled back.
const owedReversalPredicate = and(
	eq(orderRefundTable.status, "succeeded"),
	isNull(orderRefundTable.stripeTransferReversalId),
	isNotNull(orderRefundTable.lastErrorMessage),
);

export async function loadOwedReversalQueue(): Promise<
	ReconciliationQueue<OwedReversalRow>
> {
	const db = getDb();
	const [rows, [totals]] = await Promise.all([
		db
			.select({
				amountMinor: orderRefundTable.amountMinor,
				completedAt: orderRefundTable.completedAt,
				currency: orderRefundTable.currency,
				lastErrorMessage: orderRefundTable.lastErrorMessage,
				orderReference: orderTable.publicReference,
			})
			.from(orderRefundTable)
			.innerJoin(orderTable, eq(orderTable.id, orderRefundTable.orderId))
			.where(owedReversalPredicate)
			.orderBy(asc(orderRefundTable.createdAt))
			.limit(QUEUE_ROW_LIMIT),
		db
			.select({ count: countAll })
			.from(orderRefundTable)
			.where(owedReversalPredicate),
	]);
	return { count: totals?.count ?? 0, rows };
}

export interface MissingConversationRow {
	orderCreatedAt: Date;
	orderReference: string;
	provider: string;
	providerReservationId: string | null;
}

// Confirmed Hostify bookings without a provisioned conversation. Hostify is
// the only provider with an inbox gateway; Bokun bookings intentionally chat
// through the order-level internal conversation instead.
const missingConversationPredicate = and(
	eq(orderTable.status, "confirmed"),
	eq(providerBookingTable.provider, "hostify"),
	eq(providerBookingTable.normalizedStatus, "confirmed"),
	isNotNull(providerBookingTable.providerReservationId),
	isNull(conversationTable.id),
);

export async function loadMissingConversationQueue(): Promise<
	ReconciliationQueue<MissingConversationRow>
> {
	const db = getDb();
	const [rows, [totals]] = await Promise.all([
		db
			.select({
				orderCreatedAt: orderTable.createdAt,
				orderReference: orderTable.publicReference,
				provider: providerBookingTable.provider,
				providerReservationId: providerBookingTable.providerReservationId,
			})
			.from(providerBookingTable)
			.innerJoin(orderTable, eq(orderTable.id, providerBookingTable.orderId))
			.leftJoin(
				conversationTable,
				eq(conversationTable.providerBookingId, providerBookingTable.id),
			)
			.where(missingConversationPredicate)
			.orderBy(asc(orderTable.createdAt))
			.limit(QUEUE_ROW_LIMIT),
		db
			.select({ count: countAll })
			.from(providerBookingTable)
			.innerJoin(orderTable, eq(orderTable.id, providerBookingTable.orderId))
			.leftJoin(
				conversationTable,
				eq(conversationTable.providerBookingId, providerBookingTable.id),
			)
			.where(missingConversationPredicate),
	]);
	return { count: totals?.count ?? 0, rows };
}

export interface GuestSubmissionJobRow {
	attemptCount: number;
	maxAttempts: number;
	nextRunAt: Date | null;
	orderReference: string;
	redactedErrorText: string | null;
	status: GuestSubmissionJobStatus;
}

// Active jobs the sweep will retry, plus exhausted failures awaiting operator
// resubmission from the order page.
const guestSubmissionPredicate = inArray(guestSubmissionJobTable.status, [
	"pending",
	"running",
	"retrying",
	"failed",
]);

export async function loadGuestSubmissionQueue(): Promise<
	ReconciliationQueue<GuestSubmissionJobRow>
> {
	const db = getDb();
	const [rows, [totals]] = await Promise.all([
		db
			.select({
				attemptCount: guestSubmissionJobTable.attemptCount,
				maxAttempts: guestSubmissionJobTable.maxAttempts,
				nextRunAt: guestSubmissionJobTable.nextRunAt,
				orderReference: orderTable.publicReference,
				redactedErrorText: guestSubmissionJobTable.redactedErrorText,
				status: guestSubmissionJobTable.status,
			})
			.from(guestSubmissionJobTable)
			.innerJoin(
				providerBookingTable,
				eq(providerBookingTable.id, guestSubmissionJobTable.providerBookingId),
			)
			.innerJoin(orderTable, eq(orderTable.id, providerBookingTable.orderId))
			.where(guestSubmissionPredicate)
			.orderBy(asc(guestSubmissionJobTable.createdAt))
			.limit(QUEUE_ROW_LIMIT),
		db
			.select({ count: countAll })
			.from(guestSubmissionJobTable)
			.where(guestSubmissionPredicate),
	]);
	return { count: totals?.count ?? 0, rows };
}
