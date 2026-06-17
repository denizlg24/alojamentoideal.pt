export type BokunId = number | string;

export type BokunFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface BokunRequestContext {
	signal?: AbortSignal;
}

export interface BokunClientOptions {
	accessKey: string;
	baseUrl?: string;
	fetch?: BokunFetch;
	maxReadRetries?: number;
	/** Override the clock used to sign requests. Primarily for tests. */
	now?: () => Date;
	retryDelayMs?: number;
	secretKey: string;
	timeoutMs?: number;
}

/**
 * Request bodies map to Bokun's documented DTOs, which are large and deeply
 * nested. They are passed through as JSON rather than transcribed into types;
 * callers build objects matching the relevant DTO from the Bokun spec.
 */
export type BokunJsonBody = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Shared query parameters                                            */
/* ------------------------------------------------------------------ */

export interface BokunLangQuery {
	lang?: string;
}

export interface BokunLangCurrencyQuery {
	currency?: string;
	lang?: string;
}

export interface BokunCartScopeQuery {
	currency?: string;
	harbourId?: BokunId;
	lang?: string;
	trackingCode?: string;
	vesselId?: BokunId;
}

/* ------------------------------------------------------------------ */
/* v1 query parameters                                                */
/* ------------------------------------------------------------------ */

export interface BokunAvailabilitiesQuery extends BokunLangCurrencyQuery {
	end: string;
	ids: string;
	start: string;
}

export interface BokunActivityAvailabilitiesQuery
	extends BokunLangCurrencyQuery {
	end: string;
	includeSoldOut?: boolean;
	start: string;
}

export interface BokunUpcomingAvailabilitiesQuery extends BokunLangQuery {
	includeSoldOut?: boolean;
}

export interface BokunUpdatedActivitiesQuery {
	fromDate: string;
	toDate?: string;
}

export interface BokunActivityListByIdsQuery extends BokunLangCurrencyQuery {
	ids: string;
}

export interface BokunGuestReserveQuery {
	currency?: string;
	paymentParameters?: string;
}

export interface BokunConfirmBookingQuery extends BokunLangCurrencyQuery {
	sendCustomerNotification?: boolean;
}

export interface BokunProductListQuery extends BokunLangCurrencyQuery {
	flags?: string;
}

export interface BokunCurrencyQuery {
	currency?: string;
}

export interface BokunAbortReservedQuery {
	timeout?: number;
}

/* v1 request bodies (see Bokun rest-v1 spec DTOs) */
export type BokunAccommodationQuery = BokunJsonBody;
export type BokunActivityQuery = BokunJsonBody;
export type BokunRoomAvailabilityRequest = BokunJsonBody;
export type BokunActivityBookingRequest = BokunJsonBody;
export type BokunAccommodationBookingRequest = BokunJsonBody;
export type BokunTransportBookingRequest = BokunJsonBody;
export type BokunBookingRequest = BokunJsonBody;
export type BokunCheckoutRequest = BokunJsonBody;
export type BokunBookingConfirmation = BokunJsonBody;
export type BokunBookingConfirmationDto = BokunJsonBody;
export type BokunBookingReservationRequest = BokunJsonBody;
export type BokunCancelBookingRequest = BokunJsonBody;
export type BokunPaymentErrorRequest = BokunJsonBody;
export type BokunBookingEditAction = BokunJsonBody;
export type BokunProductBookingQuery = BokunJsonBody;
export type BokunItineraryBookingQuery = BokunJsonBody;
export type BokunSingleActivityBookingRequest = BokunJsonBody;
export type BokunSingleTransportBookingRequest = BokunJsonBody;
export type BokunSingleAccommodationBookingRequest = BokunJsonBody;

/* ------------------------------------------------------------------ */
/* v2 query parameters                                                */
/* ------------------------------------------------------------------ */

export interface BokunPageQuery {
	pageNo: number;
	pageSize: number;
}

export interface BokunAllocationsQuery extends BokunPageQuery {
	startTimeId?: BokunId;
}

export interface BokunBookingInvoicesQuery {
	includeHistoric?: boolean;
	invoiceType: string;
}

export interface BokunComponentsQuery {
	componentType: string;
}

export interface BokunExperienceIdsQuery {
	activated?: boolean;
}

export interface BokunAvailabilityRangeQuery {
	from: string;
	showId?: BokunId;
	to: string;
}

export interface BokunCloseoutQuery {
	from: string;
	startTimeId?: BokunId;
	to: string;
}

export interface BokunAvailabilityChangedQuery {
	dateFrom: string;
	dateTo: string;
}

/* v2 request bodies (see Bokun rest-v2 spec DTOs) */
export type BokunPricingCategoryInput = BokunJsonBody;
export type BokunPromoCodeInput = BokunJsonBody;
export type BokunPriceScheduleInput = BokunJsonBody;
export type BokunPriceSchedulesReorderInput = BokunJsonBody;
export type BokunExperienceComponentsInput = BokunJsonBody;
export type BokunExperienceAllocationInput = BokunJsonBody;
export type BokunExperienceBookingNoteInput = BokunJsonBody;
export type BokunUpdateExperienceBookingNoteInput = BokunJsonBody;
