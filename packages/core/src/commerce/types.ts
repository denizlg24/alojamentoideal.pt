import type {
	AccommodationQuoteFeeSnapshot,
	CommerceCatalogSnapshot,
	OrderBillingAddressSnapshot,
} from "@workspace/db";
import type { StayDates } from "../accommodations";

export type CartStatus = "converted" | "draft" | "expired";
export type CartItemStatus = "active" | "removed";

/**
 * Identity used to authorize cart-scoped operations. Resolved per request from
 * the session (when authenticated) and the secret `ai_cart` cookie. Either or
 * both may be present; access rules live in `CommerceService`.
 */
export interface CartOwner {
	userId: string | null;
	cartToken: string | null;
}
export type QuoteValidationStatus =
	| "expired"
	| "provider_error"
	| "unavailable"
	| "valid";

export interface CommerceQuoteInput {
	adults: number;
	children: number;
	dates: StayDates;
	guests: number;
	infants: number;
	listingId: string;
	pets: number;
}

export interface NormalizedAccommodationQuoteSnapshot {
	adults: number;
	checkIn: string;
	checkOut: string;
	children: number;
	cleaningFeeMinor: number | null;
	currency: string;
	expiresAt: Date;
	externalAccountId: string;
	feeLines: AccommodationQuoteFeeSnapshot[];
	fetchedAt: Date;
	guests: number;
	id: string;
	infants: number;
	listingExternalId: string;
	nightlyAverageMinor: number | null;
	nights: number;
	pets: number;
	provider: string;
	providerPayload: Record<string, unknown>;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
	validationStatus: QuoteValidationStatus;
}

export interface CommerceQuoteDto {
	currency: string;
	expiresAt: string;
	feeLines: AccommodationQuoteFeeSnapshot[];
	fetchedAt: string;
	id: string;
	status: QuoteValidationStatus;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
}

export interface CartItemDto {
	adults: number;
	checkIn: string;
	checkOut: string;
	children: number;
	currency: string;
	guests: number;
	id: string;
	imageUrl: string | null;
	infants: number;
	listingId: string;
	nights: number;
	pets: number;
	position: number;
	quote: CommerceQuoteDto;
	status: CartItemStatus;
	subtotalMinor: number;
	taxMinor: number;
	title: string;
	totalMinor: number;
	type: "accommodation";
	updatedAt: string;
}

export interface CartDto {
	cartToken: string;
	createdAt: string;
	currency: string;
	discountMinor: number;
	expiresAt: string;
	id: string;
	itemCount: number;
	items: CartItemDto[];
	status: CartStatus;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
	updatedAt: string;
}

export interface CartMutationResponse {
	cart: CartDto;
	item: CartItemDto;
	quote: CommerceQuoteDto;
}

export interface CartResponse {
	cart: CartDto;
}

export interface CartValidationFailure {
	code: string;
	itemId: string;
	message: string;
}

export interface CartValidationResponse {
	cart: CartDto;
	failures: CartValidationFailure[];
	valid: boolean;
}

export interface DraftOrderContactInput {
	billingAddress: OrderBillingAddressSnapshot;
	companyName: string | null;
	email: string;
	isCompany: boolean;
	name: string;
	notes: string | null;
	phoneE164: string;
	taxNumber: string | null;
}

export interface DraftOrderResponse {
	checkoutExpiresAt: string;
	orderId: string;
	publicReference: string;
	status: "draft";
}

export interface ListingDisplaySnapshot extends CommerceCatalogSnapshot {
	propertyTimezone: string;
}
