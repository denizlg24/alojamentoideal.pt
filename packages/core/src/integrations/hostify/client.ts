import type { z } from "zod";
import {
	HostifyApiError,
	HostifyConfigurationError,
	HostifyNetworkError,
	HostifyRequestAbortedError,
	HostifyResponseValidationError,
	HostifyTimeoutError,
} from "./errors";
import { redactHostifyText } from "./redaction";
import { hostifySchemas, hostifySuccessSchema } from "./schemas";
import type * as T from "./types";

const DEFAULT_BASE_URL = "https://api-rms.hostify.com/";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_READ_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

type HttpMethod = "DELETE" | "GET" | "POST" | "PUT";
type Query = object;

interface RequestOptions<TSchema extends z.ZodType> {
	body?: unknown;
	context?: T.HostifyRequestContext;
	method: HttpMethod;
	path: string;
	query?: Query;
	schema: TSchema;
}

export class HostifyClient {
	readonly accounting = {
		getCompany: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(`/companies/${segment(id)}`, hostifySchemas.company, context),
		getCounterparty: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/counterparties/${segment(id)}`,
				hostifySchemas.counterparty,
				context,
			),
		getInvoice: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(`/invoices/${segment(id)}`, hostifySchemas.invoice, context),
		listCompanies: (
			query: T.HostifyPagination = {},
			context?: T.HostifyRequestContext,
		) => this.get("/companies", hostifySchemas.companies, context, query),
		listCounterparties: (
			query: T.HostifyPagination = {},
			context?: T.HostifyRequestContext,
		) =>
			this.get(
				"/counterparties",
				hostifySchemas.counterparties,
				context,
				query,
			),
		listInvoices: (
			query: T.HostifyInvoiceListQuery = {},
			context?: T.HostifyRequestContext,
		) => this.get("/invoices", hostifySchemas.invoices, context, query),
		setInvoiceExternalData: (
			input: T.HostifySetInvoiceExternalDataInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/invoices/set_external_data",
				input,
				hostifySuccessSchema,
				context,
			),
	};

	readonly calendar = {
		addSeasons: (
			input: T.HostifyBulkSeasonsInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/calendar/bulk_listing_seasons",
				input,
				hostifySuccessSchema,
				context,
			),
		bulkUpdateListing: (
			listingId: T.HostifyId,
			input: T.HostifyBulkCalendarInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				`/calendar/bulk_listings/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		bulkUpdateListings: (
			input: readonly T.HostifyBulkCalendarListingsInput[],
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				"/calendar/bulk_listings",
				input,
				hostifySuccessSchema,
				context,
			),
		get: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/calendar/${segment(id)}`,
				hostifySchemas.calendarEntry,
				context,
			),
		list: (
			query: T.HostifyCalendarListQuery,
			context?: T.HostifyRequestContext,
		) => this.get("/calendar", hostifySchemas.calendar, context, query),
		update: (
			input: T.HostifyUpdateCalendarInput,
			context?: T.HostifyRequestContext,
		) => this.mutate("PUT", "/calendar", input, hostifySuccessSchema, context),
		updateSeasons: (
			input: T.HostifyBulkSeasonsInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				"/calendar/bulk_listing_seasons_update",
				input,
				hostifySuccessSchema,
				context,
			),
	};

	readonly customStay = {
		get: (query: T.HostifyCustomStayQuery, context?: T.HostifyRequestContext) =>
			this.get("/custom_stay", hostifySchemas.customStay, context, query),
		set: (
			input: T.HostifySetCustomStayInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate("POST", "/custom_stay", input, hostifySuccessSchema, context),
	};

	readonly ctaCtd = {
		get: (query: T.HostifyCtaCtdQuery, context?: T.HostifyRequestContext) =>
			this.get("/cta_ctd", hostifySchemas.ctaCtd, context, query),
		set: (input: T.HostifySetCtaCtdInput, context?: T.HostifyRequestContext) =>
			this.mutate("POST", "/cta_ctd", input, hostifySuccessSchema, context),
	};

	readonly guests = {
		get: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(`/guests/${segment(id)}`, hostifySchemas.guest, context),
		list: (
			query: T.HostifyGuestListQuery = {},
			context?: T.HostifyRequestContext,
		) => this.get("/guests", hostifySchemas.guests, context, query),
	};

	readonly inbox = {
		acceptReservation: (
			input: T.HostifyApproveReservationInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				`/reservations/accept`,
				input,
				hostifySuccessSchema,
				context,
			),
		assign: (
			input: T.HostifyAssignThreadInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/inbox/assignee",
				input,
				hostifySchemas.thread,
				context,
			),
		declineReservation: (
			input: T.HostifyDeclineReservationInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				`/reservations/decline`,
				input,
				hostifySuccessSchema,
				context,
			),
		get: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(`/inbox/${segment(id)}`, hostifySchemas.thread, context),
		list: (
			query: T.HostifyThreadListQuery = {},
			context?: T.HostifyRequestContext,
		) => this.get("/inbox", hostifySchemas.threads, context, query),
		preApproveReservation: (
			input: T.HostifyInquiryActionInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/reservations/pre_approve",
				input,
				hostifySuccessSchema,
				context,
			),
		receiveImageReply: (
			input: T.HostifyReceiveReplyImageInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/inbox/receive_reply_image",
				input,
				hostifySchemas.id,
				context,
			),
		receiveReply: (
			input: T.HostifyReceiveReplyInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/inbox/receive_reply",
				input,
				hostifySchemas.id,
				context,
			),
		reply: (input: T.HostifyReplyInput, context?: T.HostifyRequestContext) =>
			this.mutate("POST", "/inbox/reply", input, hostifySchemas.id, context),
		replyWithImage: (
			input: T.HostifyReplyImageInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/inbox/reply_image",
				input,
				hostifySuccessSchema,
				context,
			),
		specialOffer: (
			input: T.HostifySpecialOfferInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/reservations/special_offer",
				input,
				hostifySuccessSchema,
				context,
			),
	};

	readonly integrations = {
		get: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/integrations/${segment(id)}`,
				hostifySchemas.integration,
				context,
			),
		list: (
			query: T.HostifyIntegrationListQuery = {},
			context?: T.HostifyRequestContext,
		) => this.get("/integrations", hostifySchemas.integrations, context, query),
	};

	readonly listings = {
		channelList: (
			input: T.HostifyChannelListInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/listings/channel_list",
				input,
				hostifySuccessSchema,
				context,
			),
		clone: (
			input: T.HostifyCloneListingInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/listings/clone",
				input,
				hostifySuccessSchema,
				context,
			),
		cloneState: (jobId: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/listings/clone/${segment(jobId)}`,
				hostifySuccessSchema,
				context,
			),
		createTranslations: (
			listingId: T.HostifyId,
			input: T.HostifyTranslationsInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				`/listings/translations/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		deletePhotos: (
			listingId: T.HostifyId,
			input: T.HostifyDeletePhotosInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"DELETE",
				`/listings/photos/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		deleteTranslations: (
			listingId: T.HostifyId,
			input: T.HostifyDeleteTranslationsInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"DELETE",
				`/listings/translations/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		deleteWithChildren: (
			listingId: T.HostifyId,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"DELETE",
				`/listings/delete_with_children/${segment(listingId)}`,
				undefined,
				hostifySuccessSchema,
				context,
			),
		get: (
			id: T.HostifyId,
			query: T.HostifyGetListingQuery = {},
			context?: T.HostifyRequestContext,
		) =>
			this.get(
				`/listings/${segment(id)}`,
				hostifySchemas.listing,
				context,
				query,
			),
		getAccessCodes: (
			listingId: T.HostifyId,
			context?: T.HostifyRequestContext,
		) =>
			this.get(
				`/listings/access_codes/${segment(listingId)}`,
				hostifySchemas.accessCodes,
				context,
			),
		getBookingRestriction: (
			listingId: T.HostifyId,
			context?: T.HostifyRequestContext,
		) =>
			this.get(
				`/listings/booking_restriction/${segment(listingId)}`,
				hostifySchemas.bookingRestriction,
				context,
			),
		getChildren: (listingId: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/listings/children/${segment(listingId)}`,
				hostifySchemas.listings,
				context,
			),
		getFees: (listingId: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/listings/listing_fees/${segment(listingId)}`,
				hostifySchemas.listingFees,
				context,
			),
		getGuestGuide: (
			listingId: T.HostifyId,
			context?: T.HostifyRequestContext,
		) =>
			this.get(
				`/listings/guest_guide/${segment(listingId)}`,
				hostifySuccessSchema,
				context,
			),
		getPhotos: (listingId: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/listings/photos/${segment(listingId)}`,
				hostifySchemas.listingPhotos,
				context,
			),
		getStatus: (listingId: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/listings/listing_status/${segment(listingId)}`,
				hostifySchemas.listingStatus,
				context,
			),
		getTranslations: (
			listingId: T.HostifyId,
			context?: T.HostifyRequestContext,
		) =>
			this.get(
				`/listings/translations/${segment(listingId)}`,
				hostifySchemas.listingTranslations,
				context,
			),
		list: (
			query: T.HostifyListingListQuery = {},
			context?: T.HostifyRequestContext,
		) => this.get("/listings", hostifySchemas.listings, context, query),
		listAvailable: (
			query: T.HostifyAvailableListingsQuery,
			context?: T.HostifyRequestContext,
		) =>
			this.get("/listings/available", hostifySchemas.listings, context, query),
		price: (
			query: T.HostifyListingPriceQuery,
			context?: T.HostifyRequestContext,
		) =>
			this.get("/listings/price", hostifySchemas.listingPrice, context, query),
		processAmenities: (
			input: T.HostifyProcessAmenitiesInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/listings/process_amenities",
				input,
				hostifySuccessSchema,
				context,
			),
		processBookingRestrictions: (
			input: T.HostifyProcessBookingRestrictionsInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/listings/process_booking_restrictions",
				input,
				hostifySuccessSchema,
				context,
			),
		processLayout: (
			input: T.HostifyProcessLayoutInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/listings/process_layout",
				input,
				hostifySuccessSchema,
				context,
			),
		processLocation: (
			input: T.HostifyProcessLocationInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/listings/process_location",
				input,
				hostifySuccessSchema,
				context,
			),
		processPhotos: (
			input: T.HostifyProcessPhotosInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/listings/process_photos",
				input,
				hostifySuccessSchema,
				context,
			),
		processTranslations: (
			input: T.HostifyProcessTranslationsInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/listings/process_translations",
				input,
				hostifySuccessSchema,
				context,
			),
		reorderPhotos: (
			listingId: T.HostifyId,
			input: T.HostifySortPhotosInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				`/listings/photos_sort/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		update: (
			input: T.HostifyUpdateListingInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/listings/update",
				input,
				hostifySuccessSchema,
				context,
			),
		updateAccessCodes: (
			listingId: T.HostifyId,
			input: T.HostifyAccessCodeInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				`/listings/access_codes/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		updateBcomChildMarkup: (
			listingId: T.HostifyId,
			input: T.HostifyBcomChildMarkupInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				`/listings/bcom_child_markup/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		updateFees: (
			listingId: T.HostifyId,
			input: T.HostifyUpdateListingFeesInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				`/listings/listing_fees_update/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		updateGuestGuide: (
			listingId: T.HostifyId,
			input: T.HostifyGuestGuideInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				`/listings/guest_guide/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		updateStatus: (
			listingId: T.HostifyId,
			input: T.HostifyListingStatusInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				`/listings/listing_status/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		updateTranslations: (
			listingId: T.HostifyId,
			input: T.HostifyTranslationsInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				`/listings/translations/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		uploadPhotos: (
			listingId: T.HostifyId,
			input: T.HostifyPhotoUploadInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				`/listings/photos_upload/${segment(listingId)}`,
				input,
				hostifySchemas.listingPhotos,
				context,
			),
		uploadPhotosAsync: (
			listingId: T.HostifyId,
			input: T.HostifyPhotoUploadInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				`/listings/photos_upload_async/${segment(listingId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
	};

	readonly reservations = {
		create: (
			input: T.HostifyCreateReservationInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/reservations",
				input,
				hostifySchemas.reservation,
				context,
			),
		get: (
			id: T.HostifyId,
			query: T.HostifyGetReservationQuery = {},
			context?: T.HostifyRequestContext,
		) =>
			this.get(
				`/reservations/${segment(id)}`,
				hostifySchemas.reservation,
				context,
				query,
			),
		getCustomFields: (
			reservationId: T.HostifyId,
			context?: T.HostifyRequestContext,
		) =>
			this.get(
				`/reservations/custom_fields/${segment(reservationId)}`,
				hostifySchemas.reservationCustomFields,
				context,
			),
		list: (
			query: T.HostifyReservationListQuery = {},
			context?: T.HostifyRequestContext,
		) => this.get("/reservations", hostifySchemas.reservations, context, query),
		paymentData: (
			input: T.HostifyReservationPaymentDataInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/reservations/payment_data",
				input,
				hostifySuccessSchema,
				context,
			),
		paymentRequest: (
			input: T.HostifyPaymentRequestInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/reservations/payment_request",
				input,
				hostifySuccessSchema,
				context,
			),
		update: (
			id: T.HostifyId,
			input: T.HostifyUpdateReservationInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				`/reservations/${segment(id)}`,
				input,
				hostifySchemas.reservationUpdate,
				context,
			),
		updateCustomField: (
			input: T.HostifyCustomFieldValueInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/reservations/custom_field_update",
				input,
				hostifySuccessSchema,
				context,
			),
		updateRemoteLockPin: (
			reservationId: T.HostifyId,
			input: T.HostifyRemoteLockPinInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				`/reservations/update_remotelock_pin/${segment(reservationId)}`,
				input,
				hostifySuccessSchema,
				context,
			),
	};

	readonly notifications = {
		get: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(`/webhooks_v2/${segment(id)}`, hostifySchemas.webhook, context),
		list: (context?: T.HostifyRequestContext) =>
			this.get("/webhooks_v2", hostifySchemas.webhooks, context),
		remove: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.mutate(
				"DELETE",
				`/webhooks_v2/${segment(id)}`,
				undefined,
				hostifySuccessSchema,
				context,
			),
	};

	readonly customFields = {
		create: (
			input: T.HostifyCreateCustomFieldInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/custom_fields",
				input,
				hostifySuccessSchema,
				context,
			),
		get: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/custom_fields/${segment(id)}`,
				hostifySchemas.customField,
				context,
			),
		list: (context?: T.HostifyRequestContext) =>
			this.get("/custom_fields", hostifySchemas.customFields, context),
		remove: (
			input: T.HostifyDeleteCustomFieldInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"DELETE",
				"/custom_fields",
				input,
				hostifySuccessSchema,
				context,
			),
		setValues: (
			input: T.HostifySetCustomFieldValuesInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/custom_fields/set_values",
				input,
				hostifySuccessSchema,
				context,
			),
		update: (
			input: T.HostifyUpdateCustomFieldInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/custom_fields/update",
				input,
				hostifySuccessSchema,
				context,
			),
	};

	readonly promotions = {
		addListing: (
			input: T.HostifyPromotionListingInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/seasonal_promotions/listings",
				input,
				hostifySuccessSchema,
				context,
			),
		create: (
			input: T.HostifyPromotionInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/seasonal_promotions",
				input,
				hostifySuccessSchema,
				context,
			),
		get: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/seasonal_promotions/${segment(id)}`,
				hostifySchemas.promotion,
				context,
			),
		getListings: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/seasonal_promotions/listings/${segment(id)}`,
				hostifySchemas.listings,
				context,
			),
		list: (context?: T.HostifyRequestContext) =>
			this.get("/seasonal_promotions", hostifySchemas.promotions, context),
		remove: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.mutate(
				"DELETE",
				`/seasonal_promotions/${segment(id)}`,
				undefined,
				hostifySuccessSchema,
				context,
			),
		removeListing: (
			listingId: T.HostifyId,
			promotionId: T.HostifyId,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"DELETE",
				`/seasonal_promotions/listings/${segment(listingId)}/${segment(promotionId)}`,
				undefined,
				hostifySuccessSchema,
				context,
			),
		update: (
			id: T.HostifyId,
			input: T.HostifyPromotionInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				`/seasonal_promotions/${segment(id)}`,
				input,
				hostifySuccessSchema,
				context,
			),
	};

	readonly reviews = {
		get: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(`/reviews/${segment(id)}`, hostifySchemas.review, context),
		list: (
			query: T.HostifyReviewListQuery = {},
			context?: T.HostifyRequestContext,
		) => this.get("/reviews", hostifySchemas.reviews, context, query),
	};

	readonly search = (
		query: T.HostifySearchQuery,
		context?: T.HostifyRequestContext,
	) => this.get("/search", hostifySchemas.search, context, query);

	readonly transactions = {
		create: (
			input: T.HostifyCreateTransactionInput,
			context?: T.HostifyRequestContext,
		) =>
			// The create response carries the new transaction (`{ success, transaction
			// }`); parse it so callers can persist `transaction.id`.
			this.mutate(
				"POST",
				"/transactions",
				input,
				hostifySchemas.transaction,
				context,
			),
		createTag: (
			input: T.HostifyTransactionTagInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/transactions/tags",
				input,
				hostifySuccessSchema,
				context,
			),
		get: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/transactions/${segment(id)}`,
				hostifySchemas.transaction,
				context,
			),
		getTags: (transactionId: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/transactions/tags/${segment(transactionId)}`,
				hostifySchemas.transactionTags,
				context,
			),
		list: (
			query: T.HostifyTransactionListQuery = {},
			context?: T.HostifyRequestContext,
		) => this.get("/transactions", hostifySchemas.transactions, context, query),
		removeTag: (
			tagId: T.HostifyId,
			transactionId: T.HostifyId,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"DELETE",
				`/transactions/tags/${segment(tagId)}/${segment(transactionId)}`,
				undefined,
				hostifySuccessSchema,
				context,
			),
		update: (
			id: T.HostifyId,
			input: T.HostifyUpdateTransactionInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				`/transactions/${segment(id)}`,
				input,
				hostifySuccessSchema,
				context,
			),
		updateTag: (
			input: T.HostifyUpdateTransactionTagInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/transactions/tags",
				input,
				hostifySuccessSchema,
				context,
			),
	};

	readonly users = {
		addListing: (
			input: T.HostifyUserListingInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/users/add_listing",
				input,
				hostifySuccessSchema,
				context,
			),
		assignRole: (
			input: T.HostifyUserRoleInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"POST",
				"/users/assign_role",
				input,
				hostifySuccessSchema,
				context,
			),
		get: (id: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(`/users/${segment(id)}`, hostifySchemas.user, context),
		list: (
			query: T.HostifyUserListQuery = {},
			context?: T.HostifyRequestContext,
		) => this.get("/users", hostifySchemas.users, context, query),
		removeListing: (
			input: T.HostifyUserListingInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"DELETE",
				"/users/remove_listing",
				input,
				hostifySuccessSchema,
				context,
			),
		unassignRole: (
			input: T.HostifyUserRoleInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"DELETE",
				"/users/unassign_role",
				input,
				hostifySuccessSchema,
				context,
			),
		update: (
			id: T.HostifyId,
			input: T.HostifyUpdateUserInput,
			context?: T.HostifyRequestContext,
		) =>
			this.mutate(
				"PUT",
				`/users/${segment(id)}`,
				input,
				hostifySchemas.user,
				context,
			),
	};

	readonly checkin = {
		getData: (reservationId: T.HostifyId, context?: T.HostifyRequestContext) =>
			this.get(
				`/checkin/data/${segment(reservationId)}`,
				hostifySchemas.checkin,
				context,
			),
	};

	readonly #apiKey: string;
	readonly #baseUrl: URL;
	readonly #fetch: T.HostifyFetch;
	readonly #maxReadRetries: number;
	readonly #retryDelayMs: number;
	readonly #timeoutMs: number;

	constructor(options: T.HostifyClientOptions) {
		const apiKey = options.apiKey.trim();
		if (!apiKey) {
			throw new HostifyConfigurationError("Hostify API key is required");
		}

		this.#apiKey = apiKey;
		this.#baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
		if (this.#baseUrl.protocol !== "https:") {
			throw new HostifyConfigurationError("Hostify base URL must use HTTPS");
		}
		this.#fetch = options.fetch ?? globalThis.fetch;
		this.#maxReadRetries = options.maxReadRetries ?? DEFAULT_MAX_READ_RETRIES;
		this.#retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
		this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

		if (
			!Number.isInteger(this.#maxReadRetries) ||
			this.#maxReadRetries < 0 ||
			this.#maxReadRetries > 5 ||
			!Number.isFinite(this.#retryDelayMs) ||
			this.#retryDelayMs < 0 ||
			this.#retryDelayMs > 30_000 ||
			!Number.isFinite(this.#timeoutMs) ||
			this.#timeoutMs <= 0 ||
			this.#timeoutMs > 120_000
		) {
			throw new HostifyConfigurationError(
				"Hostify retry and timeout options must be valid positive values",
			);
		}
	}

	private get<TSchema extends z.ZodType>(
		path: string,
		schema: TSchema,
		context?: T.HostifyRequestContext,
		query?: Query,
	): Promise<z.output<TSchema>> {
		return this.request({ context, method: "GET", path, query, schema });
	}

	private mutate<TSchema extends z.ZodType>(
		method: Exclude<HttpMethod, "GET">,
		path: string,
		body: unknown,
		schema: TSchema,
		context?: T.HostifyRequestContext,
	): Promise<z.output<TSchema>> {
		return this.request({ body, context, method, path, schema });
	}

	private async request<TSchema extends z.ZodType>({
		body,
		context,
		method,
		path,
		query,
		schema,
	}: RequestOptions<TSchema>): Promise<z.output<TSchema>> {
		const requestId = crypto.randomUUID();
		const maxAttempts = method === "GET" ? this.#maxReadRetries + 1 : 1;
		let attempt = 0;

		while (attempt < maxAttempts) {
			attempt += 1;

			try {
				return await this.performRequest({
					body,
					context,
					method,
					path,
					query,
					requestId,
					schema,
				});
			} catch (error) {
				if (context?.signal?.aborted) {
					throw new HostifyRequestAbortedError("Hostify request was aborted", {
						cause: error,
						requestId,
					});
				}

				if (!shouldRetry(error, method, attempt, maxAttempts)) {
					throw error;
				}

				await sleep(this.#retryDelayMs * 2 ** (attempt - 1));
			}
		}

		throw new HostifyNetworkError("Hostify request exhausted retries", {
			requestId,
		});
	}

	private async performRequest<TSchema extends z.ZodType>({
		body,
		context,
		method,
		path,
		query,
		requestId,
		schema,
	}: RequestOptions<TSchema> & { requestId: string }): Promise<
		z.output<TSchema>
	> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
		const abort = () => controller.abort(context?.signal?.reason);
		context?.signal?.addEventListener("abort", abort, { once: true });
		if (context?.signal?.aborted) {
			abort();
		}

		try {
			const url = buildUrl(this.#baseUrl, path, query);
			const response = await this.#fetch(url, {
				body: body === undefined ? undefined : JSON.stringify(body),
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
					"x-api-key": this.#apiKey,
				},
				method,
				signal: controller.signal,
			});
			const payload = await readPayload(response);

			if (!response.ok) {
				throw new HostifyApiError(
					`Hostify request failed with status ${response.status}`,
					response.status,
					{
						providerMessage: providerError(payload, this.#apiKey),
						requestId,
					},
				);
			}

			if (isFailureResponse(payload)) {
				throw new HostifyApiError(
					"Hostify rejected the request",
					response.status,
					{
						providerMessage: redactHostifyText(payload.error, [this.#apiKey]),
						requestId,
					},
				);
			}

			const result = schema.safeParse(payload);
			if (!result.success) {
				throw new HostifyResponseValidationError(
					"Hostify returned an unexpected response shape",
					{
						cause: result.error,
						issues: result.error.issues.map((issue) => ({
							code: issue.code,
							message: issue.message,
							path: issue.path.map(String).join(".") || "(root)",
						})),
						requestId,
						responseShape: describeShape(payload),
					},
				);
			}

			return result.data;
		} catch (error) {
			if (
				error instanceof HostifyApiError ||
				error instanceof HostifyResponseValidationError
			) {
				throw error;
			}

			if (controller.signal.aborted) {
				throw new HostifyTimeoutError(
					"Hostify request timed out or was aborted",
					{
						cause: error,
						requestId,
					},
				);
			}

			throw new HostifyNetworkError(
				"Hostify request failed before a response",
				{
					cause: error,
					requestId,
				},
			);
		} finally {
			clearTimeout(timeout);
			context?.signal?.removeEventListener("abort", abort);
		}
	}
}

function buildUrl(baseUrl: URL, path: string, query?: Query): URL {
	const url = new URL(path.replace(/^\//, ""), baseUrl);

	for (const [key, value] of Object.entries(query ?? {})) {
		if (value === undefined || value === null) {
			continue;
		}

		url.searchParams.set(key, serializeQueryValue(value));
	}

	return url;
}

function serializeQueryValue(value: unknown): string {
	if (typeof value === "object") {
		return JSON.stringify(value);
	}

	return String(value);
}

function isFailureResponse(value: unknown): value is T.HostifyFailureResponse {
	return (
		isRecord(value) &&
		value.success === false &&
		typeof value.error === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Renders a PII-safe skeleton of a value: object keys mapped to their value
 * types, recursively, with all leaf values replaced by their type name. Depth is
 * bounded and arrays collapse to their first element's shape so a large or
 * sensitive payload never enters logs verbatim. Used to capture the real Hostify
 * response shape when it fails schema validation.
 */
function describeShape(value: unknown, depth = 2): string {
	return JSON.stringify(shapeOf(value, depth));
}

function shapeOf(value: unknown, depth: number): unknown {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return value.length === 0 || depth <= 0
			? "array"
			: [shapeOf(value[0], depth - 1)];
	}
	if (typeof value === "object") {
		if (depth <= 0) {
			return "object";
		}
		const shape: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>)) {
			shape[key] = shapeOf((value as Record<string, unknown>)[key], depth - 1);
		}
		return shape;
	}
	return typeof value;
}

function providerError(value: unknown, apiKey: string): string | undefined {
	return isRecord(value) && typeof value.error === "string"
		? redactHostifyText(value.error, [apiKey])
		: undefined;
}

async function readPayload(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return response.ok ? { success: true } : undefined;
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

function segment(value: T.HostifyId): string {
	return encodeURIComponent(String(value));
}

function shouldRetry(
	error: unknown,
	method: HttpMethod,
	attempt: number,
	maxAttempts: number,
): boolean {
	if (method !== "GET" || attempt >= maxAttempts) {
		return false;
	}

	return (
		(error instanceof HostifyApiError ||
			error instanceof HostifyNetworkError ||
			error instanceof HostifyTimeoutError) &&
		error.retryable
	);
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
