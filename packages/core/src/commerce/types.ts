import type {
	AccommodationQuoteFeeSnapshot,
	ActivityBookingAnswerSnapshot,
	ActivityParticipantSnapshot,
	AppliedDiscountSnapshot,
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
	/**
	 * When set, bypasses the read-through quote cache and re-prices live. Left
	 * unset (cached) for cart pricing, which reuses the entry the booking widget
	 * already warmed; availability is re-checked at the reservation hold, so a
	 * cache hit never commits a charge against stale availability.
	 */
	forceFresh?: boolean;
	guests: number;
	infants: number;
	listingId: string;
	pets: number;
}

/** One requested pricing category (adults/children/…) with its headcount. */
export interface ActivityParticipantSelection {
	count: number;
	pricingCategoryId: number;
}

export interface CommerceActivityQuoteInput {
	activityId: string;
	/** Local activity date, `YYYY-MM-DD`. Activities are single-day. */
	activityDate: string;
	answers: ActivityBookingAnswerSnapshot[];
	/** See {@link CommerceQuoteInput.forceFresh}. */
	forceFresh?: boolean;
	participants: ActivityParticipantSelection[];
	/** Bokun departure/start-time id when the date has multiple slots. */
	startTimeId?: string | null;
	/** Bokun rate id when the activity exposes multiple rates. */
	rateId?: string | null;
}

export interface NormalizedActivityQuoteSnapshot {
	activityDate: string;
	answers: ActivityBookingAnswerSnapshot[];
	bokunActivityId: string;
	currency: string;
	expiresAt: Date;
	externalAccountId: string;
	fetchedAt: Date;
	id: string;
	participants: ActivityParticipantSnapshot[];
	provider: string;
	providerPayload: Record<string, unknown>;
	rateId: string | null;
	startTimeId: string | null;
	subtotalMinor: number;
	taxMinor: number;
	totalMinor: number;
	totalParticipants: number;
	validationStatus: QuoteValidationStatus;
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
	/** Pre-tax base-price (housing) net, in minor units. The discountable base. */
	housingFeeMinor: number;
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

interface CartItemBaseDto {
	currency: string;
	id: string;
	imageUrl: string | null;
	position: number;
	quote: CommerceQuoteDto;
	status: CartItemStatus;
	subtotalMinor: number;
	taxMinor: number;
	title: string;
	totalMinor: number;
	updatedAt: string;
}

export interface AccommodationCartItemDto extends CartItemBaseDto {
	adults: number;
	checkIn: string;
	checkOut: string;
	children: number;
	guests: number;
	infants: number;
	listingId: string;
	nights: number;
	pets: number;
	type: "accommodation";
}

export interface ActivityCartItemDto extends CartItemBaseDto {
	activityDate: string;
	activityId: string;
	participants: ActivityParticipantSnapshot[];
	/** Bokun rate the departure was priced against; drives the booking schema. */
	rateId: string | null;
	/** Bokun start-time id for the chosen departure; drives the booking schema. */
	startTimeId: string | null;
	totalParticipants: number;
	type: "activity";
}

export type CartItemDto = AccommodationCartItemDto | ActivityCartItemDto;

export interface CartDto {
	appliedDiscount: AppliedDiscountSnapshot | null;
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
	dateOfBirth: string | null;
	email: string;
	firstName: string | null;
	isCompany: boolean;
	language: string | null;
	lastName: string | null;
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
