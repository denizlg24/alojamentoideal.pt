import {
	getDb,
	order,
	orderContact,
	orderItem,
	providerBooking,
} from "@workspace/db";
import { and, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";

export const ORDER_STATUSES = [
	"draft",
	"pending",
	"confirmed",
	"cancelled",
	"failed",
] as const;

export type OrderStatusFilter = (typeof ORDER_STATUSES)[number];

export function isOrderStatusFilter(value: string): value is OrderStatusFilter {
	return (ORDER_STATUSES as readonly string[]).includes(value);
}

export interface AdminOrderListRow {
	amountPaidMinor: number;
	activityItemCount: number;
	accommodationItemCount: number;
	contactEmail: string | null;
	contactName: string | null;
	createdAt: Date;
	currency: string;
	needsRecovery: boolean;
	publicReference: string;
	status: string;
	totalMinor: number;
}

export interface AdminOrderListResult {
	hasNext: boolean;
	rows: AdminOrderListRow[];
}

export const ORDERS_PAGE_SIZE = 25;

export async function listAdminOrders(filter: {
	page: number;
	query: string | null;
	status: OrderStatusFilter | null;
}): Promise<AdminOrderListResult> {
	const conditions: SQL[] = [];
	if (filter.status) {
		conditions.push(eq(order.status, filter.status));
	}
	if (filter.query) {
		const pattern = `%${filter.query.trim()}%`;
		const match = or(
			ilike(order.publicReference, pattern),
			ilike(orderContact.email, pattern),
			ilike(orderContact.name, pattern),
		);
		if (match) {
			conditions.push(match);
		}
	}

	const rows = await getDb()
		.select({
			accommodationItemCount: sql<number>`coalesce((
				select count(*)::int from ${orderItem}
				where ${orderItem.orderId} = ${order.id}
				and ${orderItem.type} = 'accommodation'
			), 0)`,
			activityItemCount: sql<number>`coalesce((
				select count(*)::int from ${orderItem}
				where ${orderItem.orderId} = ${order.id}
				and ${orderItem.type} = 'activity'
			), 0)`,
			amountPaidMinor: order.amountPaidMinor,
			contactEmail: orderContact.email,
			contactName: orderContact.name,
			createdAt: order.createdAt,
			currency: order.currency,
			needsRecovery: sql<boolean>`exists (
				select 1 from ${providerBooking}
				where ${providerBooking.orderId} = ${order.id}
				and ${providerBooking.needsRecovery}
			)`,
			publicReference: order.publicReference,
			status: order.status,
			totalMinor: order.totalMinor,
		})
		.from(order)
		.leftJoin(orderContact, eq(orderContact.orderId, order.id))
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(desc(order.createdAt), desc(order.id))
		.limit(ORDERS_PAGE_SIZE + 1)
		.offset(filter.page * ORDERS_PAGE_SIZE);

	return {
		hasNext: rows.length > ORDERS_PAGE_SIZE,
		rows: rows.slice(0, ORDERS_PAGE_SIZE),
	};
}
