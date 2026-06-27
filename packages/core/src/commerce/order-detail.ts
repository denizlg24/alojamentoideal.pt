import type {
	BookingGuestIdentityStatus,
	OrderBillingAddressSnapshot,
	OrderMemberStatus,
	ProviderBookingStatus,
} from "@workspace/db";
import type { OrderRole } from "./order-access";
import type { OrderBookingStatus } from "./payments";

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

export interface OrderDetailItem {
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
	nights: number | null;
	pets: number | null;
	pricing: OrderItemPricing | null;
	propertyTimezone: string | null;
	providerBooking: {
		needsRecovery: boolean;
		status: ProviderBookingStatus;
	} | null;
	title: string;
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

/**
 * The durable order hub read model behind `GET /api/orders/[reference]`. Built
 * from a {@link ResolvedOrderAccess}, so sensitive sections (`pricing`,
 * `contact`, `members`, per-item money/charges) are `null` for a `member` and
 * populated only for the `owner`. Conversation refs are deferred to B2.
 */
export interface OrderDetail {
	bookingStatus: OrderBookingStatus;
	contact: OrderContactSummary | null;
	createdAt: string;
	currency: string;
	guestProgress: OrderGuestProgress;
	items: OrderDetailItem[];
	members: OrderDetailMember[] | null;
	pricing: OrderDetailPricing | null;
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
