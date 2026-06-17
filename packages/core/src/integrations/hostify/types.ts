export type HostifyId = number | string;
export type HostifyBoolean = 0 | 1;
export type HostifyDefaultableBoolean = -1 | HostifyBoolean;
export type HostifyDate = string;
export type HostifyDateTime = string;
export type HostifyMoney = number;

export type HostifyFilterOperator =
	| "="
	| "<>"
	| "<"
	| ">"
	| "<="
	| ">="
	| "in"
	| "not_in"
	| "between"
	| "not_between";

export interface HostifyFilter<TField extends string = string> {
	field: TField;
	operator: HostifyFilterOperator;
	value: boolean | number | string | readonly (boolean | number | string)[];
}

export interface HostifyPagination {
	include_related_objects?: HostifyBoolean;
	page?: number;
	per_page?: number;
}

export interface HostifyListQuery<TField extends string = string>
	extends HostifyPagination {
	filters?: readonly HostifyFilter<TField>[];
}

export interface HostifySuccessResponse {
	success: true | "true";
}

export type HostifyEntityResponse<
	TKey extends string,
	TValue,
> = HostifySuccessResponse & Record<TKey, TValue>;

export interface HostifyFailureResponse {
	error: string;
	success: false;
}

export type HostifyReservationStatus =
	| "accepted"
	| "pending"
	| "denied"
	| "cancelled_by_host"
	| "cancelled_by_guest"
	| "no_show";

export type HostifySendChannel = "channel" | "email" | "sms" | "whatsapp";
export type HostifyMessageSender = "guest" | "host";
export type HostifySearchType =
	| "guests"
	| "reservations"
	| "listings"
	| "integrations";

export type HostifyNotificationType =
	| "message_new"
	| "move_reservation"
	| "new_reservation"
	| "update_reservation"
	| "create_listing"
	| "update_listing"
	| "create_update_listing"
	| "listing_photo_processed";

export interface HostifyInvoiceListQuery
	extends HostifyListQuery<
		"company_id" | "counterparty_id" | "date" | "status" | "type"
	> {}

export interface HostifySetInvoiceExternalDataInput {
	external_details?: string;
	external_id: HostifyId;
	external_status?: string;
	id: HostifyId;
}

export interface HostifyCalendarListQuery
	extends HostifyListQuery<"currency" | "price" | "status"> {
	end_date?: HostifyDate;
	listing_id: HostifyId;
	start_date?: HostifyDate;
}

export interface HostifyCalendarRangeInput {
	bookingValue?: HostifyMoney | null;
	cta?: HostifyDefaultableBoolean;
	ctd?: HostifyDefaultableBoolean;
	end_date: HostifyDate;
	is_available?: HostifyDefaultableBoolean;
	los?: readonly HostifyLengthOfStayAdjustment[];
	min_stay?: number;
	note?: string;
	price?: HostifyMoney;
	start_date: HostifyDate;
}

export interface HostifyLengthOfStayAdjustment {
	adjustment: number;
	los: number;
}

export interface HostifyUpdateCalendarInput extends HostifyCalendarRangeInput {
	listing_id: HostifyId;
}

export interface HostifyBulkCalendarInput {
	calendar: readonly HostifyCalendarRangeInput[];
}

export interface HostifyBulkCalendarListingsInput {
	calendar: readonly HostifyCalendarRangeInput[];
	listing_id: HostifyId;
}

export interface HostifySeasonInput {
	color?: string;
	cta?: string | readonly number[];
	ctd?: string | readonly number[];
	end_date: HostifyDate;
	min_stay?: number;
	name?: string;
	price?: HostifyMoney;
	start_date: HostifyDate;
}

export interface HostifyBulkSeasonsInput {
	listing_id: HostifyId;
	seasons: readonly HostifySeasonInput[];
}

export interface HostifyCustomStayQuery {
	end_date?: HostifyDate;
	listing_id: HostifyId;
	start_date?: HostifyDate;
}

export interface HostifySetCustomStayInput {
	end_date: HostifyDate;
	listing_id: HostifyId;
	min_stay: number;
	start_date: HostifyDate;
}

export interface HostifyCtaCtdQuery {
	end_date?: HostifyDate;
	listing_id: HostifyId;
	start_date?: HostifyDate;
}

export interface HostifySetCtaCtdInput {
	listing_id: HostifyId;
	restrictions: readonly HostifyCtaCtdRestrictionInput[];
}

export interface HostifyCtaCtdRestrictionInput {
	cta?: readonly number[] | string;
	ctd?: readonly number[] | string;
	end_date: HostifyDate;
	start_date: HostifyDate;
}

export interface HostifyGuestListQuery
	extends HostifyListQuery<"email" | "first_name" | "last_name" | "phone"> {}

export interface HostifyThreadListQuery
	extends HostifyListQuery<
		| "answered"
		| "channel_unread"
		| "guest_id"
		| "integration_id"
		| "is_archived"
		| "listing_id"
		| "reservation_id"
	> {}

export interface HostifyAssignThreadInput {
	assignee_id?: HostifyId | null;
	thread_id: HostifyId;
}

export interface HostifyReplyInput {
	message: string;
	send_by?: HostifySendChannel;
	thread_id: HostifyId;
}

export interface HostifyImage {
	content_base64: string;
	filename: `${string}.${"jpeg" | "jpg" | "png"}`;
}

export interface HostifyReplyImageInput {
	image: HostifyImage;
	thread_id: HostifyId;
}

export interface HostifyReceiveReplyInput {
	channel_message_id: string;
	message: string;
	sent_by: HostifyMessageSender;
	thread_id: HostifyId;
}

export interface HostifyReceiveReplyImageInput {
	channel_message_id: string;
	image: HostifyImage;
	sent_by: HostifyMessageSender;
	thread_id: HostifyId;
}

export interface HostifyInquiryActionInput {
	thread_id: HostifyId;
}

export interface HostifySpecialOfferInput extends HostifyInquiryActionInput {
	check_in: HostifyDate;
	check_out: HostifyDate;
	price: HostifyMoney;
}

export interface HostifyIntegrationListQuery
	extends HostifyListQuery<"is_active" | "name" | "type"> {}

export interface HostifyGetListingQuery {
	guest_guide?: HostifyBoolean;
	include_owner_contract?: HostifyBoolean;
}

export interface HostifyListingListQuery
	extends HostifyListQuery<
		| "active"
		| "city"
		| "country"
		| "created_at"
		| "nickname"
		| "property_type"
		| "updated_at"
	> {}

export interface HostifyUpdateListingInput {
	active?: HostifyBoolean;
	address?: string;
	bathrooms?: number;
	bedrooms?: number;
	city?: string;
	country?: string;
	description?: string;
	id: HostifyId;
	latitude?: number;
	longitude?: number;
	name?: string;
	nickname?: string;
	person_capacity?: number;
	property_type?: string;
	state?: string;
	timezone?: string;
	zipcode?: string;
}

export interface HostifyAvailableListingsQuery {
	end_date: HostifyDate;
	guests: number;
	min_rating?: number;
	service_pms?: HostifyBoolean;
	start_date: HostifyDate;
}

export interface HostifyListingPriceQuery {
	end_date: HostifyDate;
	guests: number;
	include_fees?: HostifyBoolean;
	listing_id: HostifyId;
	pets: number;
	start_date: HostifyDate;
}

export interface HostifyCloneListingInput {
	listing_id: HostifyId;
	name?: string;
}

export interface HostifyChannelListInput {
	channel_id: HostifyId;
	is_listed: HostifyBoolean;
	listing_id: HostifyId;
}

export interface HostifyListingFeeInput {
	amount?: HostifyMoney;
	fee_id?: HostifyId;
	id?: HostifyId;
	is_percent?: HostifyBoolean;
	name?: string;
	type?: string;
}

export interface HostifyUpdateListingFeesInput {
	fees: readonly HostifyListingFeeInput[];
}

export interface HostifyPhotoUploadInput {
	photos: readonly string[];
}

export interface HostifyDeletePhotosInput {
	photo_ids: readonly HostifyId[];
}

export interface HostifySortPhotosInput {
	photos: readonly {
		id: HostifyId;
		sort_order: number;
	}[];
}

export interface HostifyTranslationInput {
	description?: string;
	language: string;
	name?: string;
	notes?: string;
}

export interface HostifyTranslationsInput {
	translations: readonly HostifyTranslationInput[];
}

export interface HostifyDeleteTranslationsInput {
	languages: readonly string[];
}

export interface HostifyAccessCodeInput {
	access_code?: string | null;
	lock_pin?: string | null;
}

export interface HostifyGuestGuideInput {
	check_in_instructions?: string | null;
	checkout_tasks?: readonly string[];
	directions?: string | null;
	emergency_info?: string | null;
	house_manual?: string | null;
}

export interface HostifyListingStatusInput {
	active: HostifyBoolean;
}

export interface HostifyBcomChildMarkupInput {
	markup: number;
}

export interface HostifyProcessLocationInput {
	address: string;
	city: string;
	country: string;
	latitude?: number;
	longitude?: number;
	state?: string;
	zipcode?: string;
}

export interface HostifyProcessLayoutInput {
	bathrooms: number;
	bedrooms: number;
	person_capacity: number;
	property_type?: string;
}

export interface HostifyProcessAmenitiesInput {
	amenity_ids: readonly HostifyId[];
	listing_id: HostifyId;
}

export interface HostifyProcessTranslationsInput
	extends HostifyTranslationsInput {
	listing_id: HostifyId;
}

export interface HostifyProcessBookingRestrictionsInput {
	listing_id: HostifyId;
	max_stay?: number;
	min_stay?: number;
}

export interface HostifyProcessPhotosInput extends HostifyPhotoUploadInput {
	listing_id: HostifyId;
}

export interface HostifyGetReservationQuery {
	fees?: HostifyBoolean;
	fees_costs?: HostifyBoolean;
}

export interface HostifyReservationListQuery
	extends HostifyListQuery<
		| "advance_days"
		| "checkIn"
		| "checkOut"
		| "confirmation_code"
		| "guest_id"
		| "guests"
		| "hostify_checkin_form_completed"
		| "nights"
		| "payout_price"
		| "source"
		| "status"
	> {
	listing_id?: HostifyId;
}

export interface HostifyReservationFeeInput {
	fee_id: HostifyId;
	total: HostifyMoney;
}

export interface HostifyCreateReservationInput {
	base_price?: HostifyMoney;
	channel_commission?: HostifyMoney;
	email: string;
	end_date: HostifyDate;
	fees?: readonly HostifyReservationFeeInput[];
	guests: number;
	listing_id: HostifyId;
	name: string;
	note: string;
	payout_price?: HostifyMoney;
	pets: number;
	phone: string;
	security_price?: HostifyMoney;
	skip_restrictions: false;
	source: string;
	start_date: HostifyDate;
	status: Extract<HostifyReservationStatus, "accepted" | "pending">;
	tax_amount?: HostifyMoney;
	total_price: HostifyMoney;
}

export interface HostifyUpdateReservationInput {
	check_in?: HostifyDate;
	check_out?: HostifyDate;
	cleaning_notes?: string | null;
	listing_id?: HostifyId;
	notes?: string | null;
	planned_arrival?: string | null;
	planned_departure?: string | null;
	status?: Exclude<HostifyReservationStatus, "pending">;
}

export interface HostifyCustomFieldValueInput {
	custom_field_id: HostifyId;
	reservation_id: HostifyId;
	value: string;
}

export interface HostifyReservationPaymentDataInput {
	reservation_id: HostifyId;
	stripe_customer_id?: string;
	stripe_payment_method_id?: string;
}

export interface HostifyRemoteLockPinInput {
	pin: string;
}

export interface HostifyPaymentRequestInput {
	amount: HostifyMoney;
	currency: string;
	reservation_id: HostifyId;
}

export interface HostifyCreateNotificationInput {
	auth?: string;
	notification_type: HostifyNotificationType;
	url: string;
}

export type HostifyCustomFieldReference = "listing" | "reservation";

export interface HostifyCreateCustomFieldInput {
	name: string;
	ref: HostifyCustomFieldReference;
	type: string;
}

export interface HostifyUpdateCustomFieldInput
	extends Partial<HostifyCreateCustomFieldInput> {
	id: HostifyId;
}

export interface HostifyDeleteCustomFieldInput {
	id: HostifyId;
}

export interface HostifySetCustomFieldValuesInput {
	custom_field_id: HostifyId;
	listing_ids?: readonly HostifyId[];
	reservation_ids?: readonly HostifyId[];
	value: string;
}

export type HostifyPromotionType =
	| "basic"
	| "early_bird"
	| "last_minute"
	| "los"
	| "new_listing";

export interface HostifyPromotionInput {
	checkin_from: HostifyDate;
	checkin_till: HostifyDate;
	discount: number;
	discount_type: "absolute" | "percent";
	is_active: HostifyBoolean;
	name: string;
	threshold_days: number;
	type: HostifyPromotionType;
}

export interface HostifyPromotionListingInput {
	listingId: HostifyId;
	promotionId: HostifyId;
}

export interface HostifyReviewListQuery extends HostifyPagination {
	city?: string;
	created_from?: HostifyDate;
	created_to?: HostifyDate;
}

export interface HostifySearchQuery {
	q: string;
	type?: HostifySearchType;
}

export interface HostifyTransactionListQuery
	extends HostifyListQuery<"arrival_date" | "release_date"> {
	listing_id?: HostifyId;
	reservation_id?: HostifyId;
}

export type HostifyTransactionType =
	| "accommodation"
	| "deposit"
	| "extra"
	| "other"
	| "resolution adjustment";

export interface HostifyCreateTransactionInput {
	amount: HostifyMoney;
	arrival_date: HostifyDate;
	channel_transaction_id?: string;
	charge_date: HostifyDate;
	currency: string;
	details?: string;
	is_completed: HostifyBoolean;
	payment_processor_id?: HostifyId;
	reservation_id: HostifyId;
	type?: HostifyTransactionType;
}

export interface HostifyUpdateTransactionInput {
	amount?: HostifyMoney;
	arrival_date?: HostifyDate;
	charge_date?: HostifyDate;
	details?: string | null;
	is_completed?: HostifyBoolean;
	notes?: string | null;
}

export interface HostifyTransactionTagInput {
	tag: string;
	transaction_id: HostifyId;
}

export interface HostifyUpdateTransactionTagInput
	extends HostifyTransactionTagInput {
	id: HostifyId;
}

export interface HostifyUserListQuery
	extends HostifyListQuery<"active" | "email" | "first_name" | "last_name"> {}

export interface HostifyUpdateUserInput {
	active?: HostifyBoolean;
	email?: string;
	first_name?: string;
	last_name?: string;
}

export interface HostifyUserRoleInput {
	role_id: HostifyId;
	user_id: HostifyId;
}

export interface HostifyUserListingInput {
	listing_id: HostifyId;
	user_id: HostifyId;
}

export interface HostifyRequestContext {
	signal?: AbortSignal;
}

export type HostifyFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface HostifyClientOptions {
	apiKey: string;
	baseUrl?: string;
	fetch?: HostifyFetch;
	maxReadRetries?: number;
	retryDelayMs?: number;
	timeoutMs?: number;
}
