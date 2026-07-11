import {
	accommodationItemDetail,
	activityItemDetail,
	type Database,
	order,
	orderItem,
} from "@workspace/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

export interface UserOrderItemSummary {
	/** Local activity date, `YYYY-MM-DD`. Null for accommodation items. */
	activityDate: string | null;
	/** Stay dates, `YYYY-MM-DD`. Null for activity items. */
	checkIn: string | null;
	checkOut: string | null;
	id: string;
	imageUrl: string | null;
	title: string;
	type: string;
}

export interface UserOrderSummary {
	createdAt: Date;
	currency: string;
	items: UserOrderItemSummary[];
	publicReference: string;
	status: string;
	totalMinor: number;
}

/**
 * Draft and failed orders are checkout leftovers the guest never completed;
 * the account order list only shows orders that reached payment.
 */
const ACCOUNT_VISIBLE_STATUSES = ["pending", "confirmed", "cancelled"];

const ACCOUNT_ORDERS_LIMIT = 100;

/**
 * Orders the signed-in user placed (order owner), newest first, with the item
 * snapshots the account list needs to render titles, images and dates. Members
 * invited into someone else's order are not included; the order hub covers
 * those via their invite links.
 */
export async function listOrdersForUser(
	db: Database,
	userId: string,
): Promise<UserOrderSummary[]> {
	const orders = await db
		.select({
			createdAt: order.createdAt,
			currency: order.currency,
			id: order.id,
			publicReference: order.publicReference,
			status: order.status,
			totalMinor: order.totalMinor,
		})
		.from(order)
		.where(
			and(
				eq(order.userId, userId),
				inArray(order.status, ACCOUNT_VISIBLE_STATUSES),
			),
		)
		.orderBy(desc(order.createdAt))
		.limit(ACCOUNT_ORDERS_LIMIT);

	if (orders.length === 0) {
		return [];
	}

	const itemRows = await db
		.select({
			activityDate: activityItemDetail.activityDate,
			checkIn: accommodationItemDetail.checkIn,
			checkOut: accommodationItemDetail.checkOut,
			id: orderItem.id,
			imageUrl: orderItem.imageUrlSnapshot,
			orderId: orderItem.orderId,
			title: orderItem.titleSnapshot,
			type: orderItem.type,
		})
		.from(orderItem)
		.leftJoin(
			accommodationItemDetail,
			eq(accommodationItemDetail.orderItemId, orderItem.id),
		)
		.leftJoin(
			activityItemDetail,
			eq(activityItemDetail.orderItemId, orderItem.id),
		)
		.where(
			inArray(
				orderItem.orderId,
				orders.map((row) => row.id),
			),
		)
		.orderBy(asc(orderItem.position));

	const itemsByOrder = new Map<string, UserOrderItemSummary[]>();
	for (const row of itemRows) {
		const items = itemsByOrder.get(row.orderId) ?? [];
		items.push({
			activityDate: row.activityDate,
			checkIn: row.checkIn,
			checkOut: row.checkOut,
			id: row.id,
			imageUrl: row.imageUrl,
			title: row.title,
			type: row.type,
		});
		itemsByOrder.set(row.orderId, items);
	}

	return orders.map((row) => ({
		createdAt: row.createdAt,
		currency: row.currency,
		items: itemsByOrder.get(row.id) ?? [],
		publicReference: row.publicReference,
		status: row.status,
		totalMinor: row.totalMinor,
	}));
}
