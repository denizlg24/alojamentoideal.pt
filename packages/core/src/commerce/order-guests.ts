import type { BookingGuestIdentityStatus } from "@workspace/db";
import type { IdentityVerificationStatus } from "../account";

/**
 * Hostkit-ready guest identity fields stored encrypted on `booking_guests`.
 * These are plain strings at the service boundary; persistence encrypts each
 * scalar independently so future compliance workers can decrypt only what they
 * need.
 */
export interface BookingGuestIdentityFields {
	dateOfBirth: string | null;
	documentExpiresOn: string | null;
	documentIssuingCountry: string | null;
	documentNumber: string | null;
	documentType: string | null;
	firstName: string | null;
	lastName: string | null;
	nationality: string | null;
	residenceCountry: string | null;
}

export interface BookingGuestDetail {
	fields: BookingGuestIdentityFields;
	id: string;
	identityStatus: BookingGuestIdentityStatus;
	orderMemberId: string | null;
	position: number;
	purgeAfter: string | null;
	submittedAt: string | null;
}

export interface BookingGuestList {
	bookingId: string;
	guests: BookingGuestDetail[];
}

export interface BookingGuestUpdateInput {
	fields: BookingGuestIdentityFields;
	id?: string | null;
}

export interface BookingGuestIdentitySessionTarget {
	bookingGuestId: string;
	orderId: string;
	providerBookingId: string;
}

export type StripeBackedBookingGuestIdentityStatus = Extract<
	BookingGuestIdentityStatus,
	"processing" | "requires_input" | "verified" | "canceled"
>;

const GUEST_DATA_RETENTION_AFTER_STAY_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * TODO(Hostkit): replace this operational default once Portuguese legal/account
 * retention is approved. Until then, keep encrypted guest details only through
 * the stay plus a short support window.
 */
export function bookingGuestPurgeAfter(
	stayEndsAt: Date | null,
	now: Date = new Date(),
): Date {
	const base =
		stayEndsAt && !Number.isNaN(stayEndsAt.getTime())
			? Math.max(stayEndsAt.getTime(), now.getTime())
			: now.getTime();
	return new Date(base + GUEST_DATA_RETENTION_AFTER_STAY_MS);
}

export function identityStatusToBookingGuestStatus(
	status: Exclude<IdentityVerificationStatus, "unstarted">,
): StripeBackedBookingGuestIdentityStatus {
	switch (status) {
		case "verified":
			return "verified";
		case "requires_input":
			return "requires_input";
		case "canceled":
			return "canceled";
		default:
			return "processing";
	}
}
