import type {
	BookingGuestIdentityStatus,
	ConversationStatus,
	OrderBillingAddressSnapshot,
	OrderMemberStatus,
	ProviderBookingStatus,
} from "@workspace/db";
import { INTERNAL_CONVERSATION_PROVIDER } from "./conversations";
import { type OrderRole, orderRoleCan } from "./order-access";
import type {
	OrderBookingStatus,
	OrderPaymentMethodSummary,
	OrderProvisioningSubState,
} from "./payments";

/**
 * Guest-registration progress for a booking (or the whole order). Counts only —
 * never the encrypted PII behind them — so it is safe to expose at any role.
 * `pending` folds every non-terminal state (provided/processing/requires_input/
 * canceled); `verified` and `missing` are the terminal extremes.
 */
export interface OrderGuestProgress {
	total: number;
	missing: number;
	pending: number;
	verified: number;
}

/** A single priced line on an order item. Owner-only (price breakdown). */
export interface OrderDetailCharge {
	grossMinor: number;
	kind: string;
	name: string;
	position: number;
	/** Decimal `numeric(12,2)`; kept as a string to preserve precision. */
	quantity: string;
	taxMinor: number;
}

/** Per-item money. Nested so it can be nulled wholesale for non-owners. */
export interface OrderItemPricing {
	currency: string;
	discountMinor: number;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
}

/**
 * Persisted activity booking facts an owner needs to render the activity
 * section and to key live provider (Bokun) reads: the product confirmation
 * code plus the pickup/dropoff and start-time selections captured at checkout.
 */
export interface OrderDetailItemActivity {
	bokunActivityId: string;
	dropoffPlaceId: string | null;
	externalAccountId: string;
	pickupPlaceId: string | null;
	/** Provider code of the product booking (e.g. Bokun `productConfirmationCode`). */
	productConfirmationCode: string | null;
	provider: string;
	rateId: string | null;
	roomNumber: string | null;
	startTimeId: string | null;
}

export interface OrderDetailItem {
	/** Owner-only activity facts. Null for non-activity items and member viewers. */
	activity: OrderDetailItemActivity | null;
	/** Local activity date, `YYYY-MM-DD`. Null for non-activity items. */
	activityDate: string | null;
	adults: number | null;
	charges: OrderDetailCharge[] | null;
	checkIn: string | null;
	checkOut: string | null;
	children: number | null;
	guestProgress: OrderGuestProgress;
	guests: number | null;
	id: string;
	imageUrl: string | null;
	infants: number | null;
	/** Provider (Hostify) listing id, for linking to the public catalog detail. Null for non-accommodation items. */
	listingExternalId: string | null;
	nights: number | null;
	pets: number | null;
	pricing: OrderItemPricing | null;
	propertyTimezone: string | null;
	providerBooking: {
		id: string;
		needsRecovery: boolean;
		status: ProviderBookingStatus;
	} | null;
	title: string;
	/** Booked participant count for an activity. Null for non-activity items. */
	totalParticipants: number | null;
	type: string;
}

/** Order-level money. Owner-only. */
export interface OrderDetailPricing {
	amountPaidMinor: number;
	amountRefundedMinor: number;
	currency: string;
	discountMinor: number;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
}

/** Tax/billing contact snapshot. Owner-only. */
export interface OrderContactSummary {
	billingAddress: OrderBillingAddressSnapshot;
	companyName: string | null;
	email: string;
	isCompany: boolean;
	name: string;
	notes: string | null;
	phoneE164: string;
	taxNumber: string | null;
}

/** A person on the order, as shown in the owner-only People tab. */
export interface OrderDetailMember {
	acceptedAt: string | null;
	email: string;
	id: string;
	invitedAt: string;
	isYou: boolean;
	role: OrderRole;
	status: OrderMemberStatus;
}

export interface OrderConversationSummary {
	externalThreadId: string | null;
	id: string;
	lastMessageAt: string | null;
	lastMessagePreview: string | null;
	provider: string;
	providerBookingId: string | null;
	status: ConversationStatus;
	unreadCount: number;
}

export type OrderConversationAvailability =
	| "available"
	| "pending"
	| "unavailable";

/**
 * The durable order hub read model behind `GET /api/orders/[reference]`. Built
 * from a {@link ResolvedOrderAccess}, so sensitive sections (`pricing`,
 * `contact`, `members`, payment method, per-item money/charges) are `null` for
 * a `member` and populated only for the `owner`.
 */
export interface OrderDetail {
	bookingStatus: OrderBookingStatus;
	contact: OrderContactSummary | null;
	conversationAvailability: OrderConversationAvailability;
	conversations: OrderConversationSummary[];
	createdAt: string;
	currency: string;
	guestProgress: OrderGuestProgress;
	items: OrderDetailItem[];
	members: OrderDetailMember[] | null;
	paymentMethod: OrderPaymentMethodSummary | null;
	pricing: OrderDetailPricing | null;
	provisioningSubState: OrderProvisioningSubState;
	reference: string;
	role: OrderRole;
}

/** Rolls a set of guest identity statuses into a progress summary. Pure. */
export function summarizeGuestProgress(
	statuses: BookingGuestIdentityStatus[],
): OrderGuestProgress {
	let missing = 0;
	let verified = 0;
	for (const status of statuses) {
		if (status === "missing") {
			missing += 1;
		} else if (status === "verified") {
			verified += 1;
		}
	}
	return {
		missing,
		pending: statuses.length - missing - verified,
		total: statuses.length,
		verified,
	};
}

/**
 * Narrows an order's guest slots to the ones a viewer may count. The owner
 * (`manage_all_guests`) counts every slot in the order; an invited member only
 * ever counts the slots bound to their own membership, so the hub's progress
 * numbers mirror exactly what the guests section lets them read and edit. A
 * viewer with neither grant counts nothing. Pure.
 */
export function scopeGuestRowsToViewer<
	T extends { orderMemberId: string | null },
>(rows: readonly T[], role: OrderRole, viewerMemberId: string | null): T[] {
	if (orderRoleCan(role, "manage_all_guests")) {
		return [...rows];
	}
	if (!viewerMemberId) {
		return [];
	}
	return rows.filter((row) => row.orderMemberId === viewerMemberId);
}

/**
 * Narrows an order's items to the ones a viewer may see. The owner sees every
 * item; an invited member only sees the stays whose booking holds a guest slot
 * bound to their membership — one stay in the common case, several when the
 * same email was invited to more than one booking, never the whole order.
 * Items without a provider booking (e.g. activities) are owner-only. Keyed on
 * the same grant as {@link scopeGuestRowsToViewer} so the stays a member sees
 * always match the guest slots they can read. Pure.
 */
export function scopeOrderItemsToViewer<T extends { bookingId: string | null }>(
	items: readonly T[],
	role: OrderRole,
	viewerBookingIds: ReadonlySet<string>,
): T[] {
	if (orderRoleCan(role, "manage_all_guests")) {
		return [...items];
	}
	return items.filter(
		(item) => item.bookingId !== null && viewerBookingIds.has(item.bookingId),
	);
}

export function summarizeConversationAvailability(
	conversations: ReadonlyArray<{
		externalThreadId: string | null;
		provider: string;
		status: ConversationStatus;
	}>,
): OrderConversationAvailability {
	// An internal conversation never links an external thread: it is chat-ready
	// the moment it is active. Provider-backed ones need the linked thread.
	if (
		conversations.some(
			(conversation) =>
				conversation.status === "active" &&
				(conversation.externalThreadId !== null ||
					conversation.provider === INTERNAL_CONVERSATION_PROVIDER),
		)
	) {
		return "available";
	}
	if (conversations.length > 0) {
		return "pending";
	}
	return "unavailable";
}
