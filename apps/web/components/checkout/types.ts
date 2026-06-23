import type { DraftOrderContactInput } from "@workspace/core/commerce";

/** Serializable listing facts the checkout shell renders (from the server). */
export interface InitialListing {
	coverPhotoUrl: string | null;
	currency: string;
	id: string;
	locationLabel: string | null;
	maxGuests: number | null;
	minNights: number;
	petsAllowed: boolean;
	reviewAverage: number | null;
	reviewCount: number;
	title: string;
}

/** Stay seed parsed from the booking route query params. */
export interface InitialStay {
	adults: number;
	checkIn: string | null;
	checkOut: string | null;
	children: number;
	guests: number;
	infants: number;
}

/** Mutable contact/billing form state. Mirrors the draft-order contact shape. */
export interface ContactDraft {
	city: string;
	companyName: string;
	country: string;
	email: string;
	isCompany: boolean;
	line1: string;
	line2: string;
	name: string;
	notes: string;
	phone: string;
	postalCode: string;
	region: string;
	taxNumber: string;
}

export type CheckoutStep = "pay-timing" | "payment-method" | "review";

export function emptyContactDraft(): ContactDraft {
	return {
		city: "",
		companyName: "",
		country: "",
		email: "",
		isCompany: false,
		line1: "",
		line2: "",
		name: "",
		notes: "",
		phone: "",
		postalCode: "",
		region: "",
		taxNumber: "",
	};
}

/** Maps a stored draft-order contact back into editable form state. */
export function contactDraftFromOrderContact(
	contact: DraftOrderContactInput,
): ContactDraft {
	const address = contact.billingAddress ?? {};
	return {
		city: address.city ?? "",
		companyName: contact.companyName ?? "",
		country: address.country ?? "",
		email: contact.email,
		isCompany: contact.isCompany,
		line1: address.line1 ?? "",
		line2: address.line2 ?? "",
		name: contact.name,
		notes: contact.notes ?? "",
		phone: contact.phoneE164,
		postalCode: address.postalCode ?? "",
		region: address.region ?? "",
		taxNumber: contact.taxNumber ?? "",
	};
}
