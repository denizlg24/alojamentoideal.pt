import type { AccountProfile } from "@workspace/core/account";
import type { DraftOrderContactInput } from "@workspace/core/commerce";

/**
 * Stay seed parsed from the booking route query params ("Reserve" entry).
 * The controller ensures this stay is in the shared cart before checkout;
 * the cart-first `/checkout` route passes no seed.
 */
export interface CheckoutSeed {
	adults: number;
	checkIn: string | null;
	checkOut: string | null;
	children: number;
	guests: number;
	infants: number;
	listingId: string;
	pets: number;
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

/** Minimal contact data required before checkout can create a draft order. */
export function isContactComplete(value: ContactDraft): boolean {
	return (
		value.name.trim().length > 0 &&
		/.+@.+\..+/.test(value.email.trim()) &&
		value.phone.trim().length >= 3
	);
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

/**
 * Overlays a saved account profile onto the current contact draft, filling only
 * empty fields so anything the guest already typed wins. Used to prefill
 * checkout from the signed-in user's saved phone/billing details.
 */
export function applyProfileToContactDraft(
	current: ContactDraft,
	profile: AccountProfile,
): ContactDraft {
	const fill = (value: string, fallback: string | null) =>
		value ? value : (fallback ?? "");
	return {
		...current,
		city: fill(current.city, profile.billingCity),
		companyName: fill(current.companyName, profile.companyName),
		country: fill(current.country, profile.billingCountry),
		isCompany: current.isCompany || profile.isCompany,
		line1: fill(current.line1, profile.billingLine1),
		line2: fill(current.line2, profile.billingLine2),
		phone: fill(current.phone, profile.phoneE164),
		postalCode: fill(current.postalCode, profile.billingPostalCode),
		region: fill(current.region, profile.billingRegion),
		taxNumber: fill(current.taxNumber, profile.taxNumber),
	};
}

/** True when the draft carries any billing address detail worth saving. */
export function hasBillingDetails(draft: ContactDraft): boolean {
	return Boolean(
		draft.line1 ||
			draft.line2 ||
			draft.city ||
			draft.region ||
			draft.postalCode ||
			draft.country,
	);
}

/** The profile-update payload the account API accepts. */
export interface ProfileContactPayload {
	phoneE164: string | null;
	isCompany: boolean;
	companyName: string | null;
	taxNumber: string | null;
	billingLine1: string | null;
	billingLine2: string | null;
	billingCity: string | null;
	billingRegion: string | null;
	billingPostalCode: string | null;
	billingCountry: string | null;
	residenceCountry: string | null;
	nationality: string | null;
}

/**
 * Builds a full profile-update payload from the contact draft for "save to my
 * account". Residence and nationality are preserved from the current profile
 * (`base`) because the profile PUT is a full replace and the checkout form does
 * not collect them; without this they would be wiped.
 */
export function profileInputFromContactDraft(
	draft: ContactDraft,
	base: AccountProfile | null,
): ProfileContactPayload {
	const text = (value: string) => {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	};
	const country = text(draft.country);
	const companyName = draft.isCompany ? text(draft.companyName) : null;
	const taxNumber = draft.isCompany ? text(draft.taxNumber) : null;
	return {
		billingCity: text(draft.city),
		billingCountry: country ? country.toUpperCase() : null,
		billingLine1: text(draft.line1),
		billingLine2: text(draft.line2),
		billingPostalCode: text(draft.postalCode),
		billingRegion: text(draft.region),
		companyName,
		isCompany: draft.isCompany,
		nationality: base?.nationality ?? null,
		phoneE164: text(draft.phone),
		residenceCountry: base?.residenceCountry ?? null,
		taxNumber,
	};
}
