import type { z } from "zod";
import { signBokunRequest } from "./auth";
import {
	BokunApiError,
	BokunConfigurationError,
	BokunNetworkError,
	BokunRequestAbortedError,
	BokunResponseValidationError,
	BokunTimeoutError,
} from "./errors";
import { redactBokunText } from "./redaction";
import { bokunSchemas } from "./schemas";
import type * as T from "./types";

const DEFAULT_BASE_URL = "https://api.bokun.io/";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_READ_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

type HttpMethod = "DELETE" | "GET" | "POST" | "PUT";
type Query = object;
type ResponseType = "json" | "text";

interface RequestOptions<TSchema extends z.ZodType> {
	body?: unknown;
	context?: T.BokunRequestContext;
	method: HttpMethod;
	path: string;
	query?: Query;
	responseType?: ResponseType;
	schema: TSchema;
}

export class BokunClient {
	readonly v1 = {
		accommodation: {
			checkAvailability: (
				id: T.BokunId,
				body: T.BokunAccommodationQuery,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/accommodation.json/${segment(id)}/check-availability`,
					body,
					bokunSchemas.object,
					context,
					query,
				),
			checkRoomAvailability: (
				body: T.BokunRoomAvailabilityRequest,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/accommodation.json/check-room-availability",
					body,
					bokunSchemas.object,
					context,
				),
			findBySlug: (
				slug: string,
				query: T.BokunLangQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/accommodation.json/slug/${segment(slug)}`,
					bokunSchemas.accommodation,
					context,
					query,
				),
			get: (
				id: T.BokunId,
				query: T.BokunLangQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/accommodation.json/${segment(id)}`,
					bokunSchemas.accommodation,
					context,
					query,
				),
			getRooms: (id: T.BokunId, context?: T.BokunRequestContext) =>
				this.get(
					`/accommodation.json/${segment(id)}/rooms`,
					bokunSchemas.object,
					context,
				),
			listAvailabilities: (
				query: T.BokunAvailabilitiesQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					"/accommodation.json/availabilities",
					bokunSchemas.object,
					context,
					query,
				),
			search: (
				body: T.BokunAccommodationQuery,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/accommodation.json/search",
					body,
					bokunSchemas.searchResults,
					context,
					query,
				),
		},

		activity: {
			findBySlug: (
				slug: string,
				query: T.BokunLangQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/activity.json/slug/${segment(slug)}`,
					bokunSchemas.activity,
					context,
					query,
				),
			get: (
				id: T.BokunId,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/activity.json/${segment(id)}`,
					bokunSchemas.activity,
					context,
					query,
				),
			getActiveIds: (context?: T.BokunRequestContext) =>
				this.get("/activity.json/active-ids", bokunSchemas.object, context),
			getAvailabilities: (
				id: T.BokunId,
				query: T.BokunActivityAvailabilitiesQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/activity.json/${segment(id)}/availabilities`,
					bokunSchemas.objectArray,
					context,
					query,
				),
			getPickupPlaces: (
				id: T.BokunId,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/activity.json/${segment(id)}/pickup-places`,
					bokunSchemas.object,
					context,
					query,
				),
			getPriceList: (
				id: T.BokunId,
				query: T.BokunCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/activity.json/${segment(id)}/price-list`,
					bokunSchemas.object,
					context,
					query,
				),
			getUpcomingAvailabilities: (
				id: T.BokunId,
				max: number,
				query: T.BokunUpcomingAvailabilitiesQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/activity.json/${segment(id)}/upcoming-availabilities/${segment(max)}`,
					bokunSchemas.object,
					context,
					query,
				),
			getUpdated: (
				query: T.BokunUpdatedActivitiesQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					"/activity.json/list-updated",
					bokunSchemas.object,
					context,
					query,
				),
			listByIds: (
				query: T.BokunActivityListByIdsQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					"/activity.json/list-by-id",
					bokunSchemas.searchResults,
					context,
					query,
				),
			search: (
				body: T.BokunActivityQuery,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/activity.json/search",
					body,
					bokunSchemas.searchResults,
					context,
					query,
				),
		},

		cart: {
			addActivity: (
				sessionId: string,
				body: T.BokunActivityBookingRequest,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/cart.json/${segment(sessionId)}/activity`,
					body,
					bokunSchemas.shoppingCart,
					context,
				),
			applyGiftCard: (
				sessionId: string,
				giftCardCode: string,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/cart.json/${segment(sessionId)}/apply-gift-card/${segment(giftCardCode)}`,
					bokunSchemas.shoppingCart,
					context,
				),
			applyPromoCode: (
				sessionId: string,
				promoCode: string,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/cart.json/${segment(sessionId)}/apply-promo-code/${segment(promoCode)}`,
					bokunSchemas.shoppingCart,
					context,
				),
			get: (sessionId: string, context?: T.BokunRequestContext) =>
				this.get(
					`/cart.json/${segment(sessionId)}`,
					bokunSchemas.shoppingCart,
					context,
				),
			remove: (
				sessionId: string,
				productBookingConfirmationCode: string,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/cart.json/${segment(sessionId)}/remove/${segment(productBookingConfirmationCode)}`,
					bokunSchemas.shoppingCart,
					context,
				),
			removePromoCode: (sessionId: string, context?: T.BokunRequestContext) =>
				this.get(
					`/cart.json/${segment(sessionId)}/remove-promo-code`,
					bokunSchemas.shoppingCart,
					context,
				),
			trackAffiliate: (
				sessionId: string,
				affiliateCode: string,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/cart.json/${segment(sessionId)}/track-affiliate/${segment(affiliateCode)}`,
					bokunSchemas.shoppingCart,
					context,
				),
		},

		shoppingCart: {
			addAccommodation: (
				sessionId: string,
				body: T.BokunAccommodationBookingRequest,
				query: T.BokunCartScopeQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/shopping-cart.json/session/${segment(sessionId)}/accommodation`,
					body,
					bokunSchemas.shoppingCart,
					context,
					query,
				),
			addActivity: (
				sessionId: string,
				body: T.BokunActivityBookingRequest,
				query: T.BokunCartScopeQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/shopping-cart.json/session/${segment(sessionId)}/activity`,
					body,
					bokunSchemas.shoppingCart,
					context,
					query,
				),
			addRoute: (
				sessionId: string,
				body: T.BokunTransportBookingRequest,
				query: T.BokunCartScopeQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/shopping-cart.json/session/${segment(sessionId)}/route`,
					body,
					bokunSchemas.shoppingCart,
					context,
					query,
				),
			get: (
				sessionId: string,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/shopping-cart.json/session/${segment(sessionId)}`,
					bokunSchemas.shoppingCart,
					context,
					query,
				),
			removeAccommodation: (
				sessionId: string,
				accommodationBookingId: T.BokunId,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/shopping-cart.json/session/${segment(sessionId)}/remove-accommodation/${segment(accommodationBookingId)}`,
					bokunSchemas.shoppingCart,
					context,
					query,
				),
			removeActivity: (
				sessionId: string,
				activityBookingId: T.BokunId,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/shopping-cart.json/session/${segment(sessionId)}/remove-activity/${segment(activityBookingId)}`,
					bokunSchemas.shoppingCart,
					context,
					query,
				),
			removeExtra: (
				sessionId: string,
				bType: string,
				bId: T.BokunId,
				eId: T.BokunId,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/shopping-cart.json/session/${segment(sessionId)}/remove-extra/${segment(bType)}/${segment(bId)}/${segment(eId)}`,
					bokunSchemas.shoppingCart,
					context,
					query,
				),
			removeRoom: (
				sessionId: string,
				roomBookingId: T.BokunId,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/shopping-cart.json/session/${segment(sessionId)}/remove-room/${segment(roomBookingId)}`,
					bokunSchemas.shoppingCart,
					context,
					query,
				),
			removeRoute: (
				sessionId: string,
				routeBookingId: T.BokunId,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/shopping-cart.json/session/${segment(sessionId)}/remove-route/${segment(routeBookingId)}`,
					bokunSchemas.shoppingCart,
					context,
					query,
				),
		},

		checkout: {
			confirmReserved: (
				code: string,
				body: T.BokunBookingConfirmation,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/checkout.json/confirm-reserved/${segment(code)}`,
					body,
					bokunSchemas.checkoutResponse,
					context,
				),
			optionsForBookingRequest: (
				body: T.BokunBookingRequest,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/checkout.json/options/booking-request",
					body,
					bokunSchemas.checkout,
					context,
				),
			optionsForShoppingCart: (
				sessionId: string,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/checkout.json/options/shopping-cart/${segment(sessionId)}`,
					bokunSchemas.checkout,
					context,
				),
			submit: (
				body: T.BokunCheckoutRequest,
				query: T.BokunLangQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/checkout.json/submit",
					body,
					bokunSchemas.checkoutResponse,
					context,
					query,
				),
		},

		booking: {
			abortReserved: (
				confirmationCode: string,
				query: T.BokunAbortReservedQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/booking.json/${segment(confirmationCode)}/abort-reserved`,
					bokunSchemas.apiResponse,
					context,
					query,
				),
			cancel: (
				confirmationCode: string,
				body: T.BokunCancelBookingRequest,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/booking.json/cancel-booking/${segment(confirmationCode)}`,
					body,
					bokunSchemas.apiResponse,
					context,
				),
			cancelProductBooking: (
				productConfirmationCode: string,
				body: T.BokunCancelBookingRequest,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/booking.json/cancel-product-booking/${segment(productConfirmationCode)}`,
					body,
					bokunSchemas.apiResponse,
					context,
				),
			confirm: (
				confirmationCode: string,
				body: T.BokunBookingConfirmationDto,
				query: T.BokunConfirmBookingQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/booking.json/${segment(confirmationCode)}/confirm`,
					body,
					bokunSchemas.bookingDetails,
					context,
					query,
				),
			edit: (body: T.BokunBookingEditAction, context?: T.BokunRequestContext) =>
				this.mutate(
					"POST",
					"/booking.json/edit",
					body,
					bokunSchemas.object,
					context,
				),
			getAccommodationBooking: (
				id: T.BokunId,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/booking.json/accommodation-booking/${segment(id)}`,
					bokunSchemas.object,
					context,
				),
			getAccommodationTicket: (
				productConfirmationCode: string,
				context?: T.BokunRequestContext,
			) =>
				this.getText(
					`/booking.json/accommodation-booking/${segment(productConfirmationCode)}/ticket`,
					context,
				),
			getActivityBooking: (id: T.BokunId, context?: T.BokunRequestContext) =>
				this.get(
					`/booking.json/activity-booking/${segment(id)}`,
					bokunSchemas.object,
					context,
				),
			getActivityTicket: (
				productConfirmationCode: string,
				context?: T.BokunRequestContext,
			) =>
				this.getText(
					`/booking.json/activity-booking/${segment(productConfirmationCode)}/ticket`,
					context,
				),
			getByConfirmationCode: (
				confirmationCode: string,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/booking.json/booking/${segment(confirmationCode)}`,
					bokunSchemas.bookingDetails,
					context,
					query,
				),
			getRouteBooking: (id: T.BokunId, context?: T.BokunRequestContext) =>
				this.get(
					`/booking.json/route-booking/${segment(id)}`,
					bokunSchemas.object,
					context,
				),
			getSummary: (id: T.BokunId, context?: T.BokunRequestContext) =>
				this.getText(`/booking.json/${segment(id)}/summary`, context),
			getTransportTicket: (
				productConfirmationCode: string,
				context?: T.BokunRequestContext,
			) =>
				this.getText(
					`/booking.json/transport-booking/${segment(productConfirmationCode)}/ticket`,
					context,
				),
			guestGetReserved: (
				sessionId: string,
				query: T.BokunCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/booking.json/guest/${segment(sessionId)}/reserved`,
					bokunSchemas.bookingDetailsArray,
					context,
					query,
				),
			guestReserve: (
				sessionId: string,
				body: T.BokunBookingReservationRequest,
				query: T.BokunGuestReserveQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/booking.json/guest/${segment(sessionId)}/reserve`,
					body,
					bokunSchemas.bookingDetails,
					context,
					query,
				),
			moveBackToCart: (
				confirmationCode: string,
				sessionId: string,
				query: T.BokunLangCurrencyQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/booking.json/${segment(confirmationCode)}/move-back-to-cart/session/${segment(sessionId)}`,
					bokunSchemas.shoppingCart,
					context,
					query,
				),
			paymentError: (
				confirmationCode: string,
				body: T.BokunPaymentErrorRequest,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/booking.json/${segment(confirmationCode)}/payment-error`,
					body,
					bokunSchemas.apiResponse,
					context,
				),
			productBookingSearch: (
				body: T.BokunProductBookingQuery,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/booking.json/product-booking-search",
					body,
					bokunSchemas.objectArray,
					context,
				),
			reserveAndConfirmAccommodation: (
				body: T.BokunSingleAccommodationBookingRequest,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/booking.json/accommodation-booking/reserve-and-confirm",
					body,
					bokunSchemas.bookingDetails,
					context,
				),
			reserveAndConfirmActivity: (
				body: T.BokunSingleActivityBookingRequest,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/booking.json/activity-booking/reserve-and-confirm",
					body,
					bokunSchemas.bookingDetails,
					context,
				),
			reserveAndConfirmRoute: (
				body: T.BokunSingleTransportBookingRequest,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/booking.json/route-booking/reserve-and-confirm",
					body,
					bokunSchemas.bookingDetails,
					context,
				),
			search: (
				body: T.BokunItineraryBookingQuery,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/booking.json/booking-search",
					body,
					bokunSchemas.objectArray,
					context,
				),
			setAccommodationBookingCustomerStatus: (
				confirmationCode: string,
				status: string,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/booking.json/accommodation-booking/${segment(confirmationCode)}/customer-status/${segment(status)}`,
					bokunSchemas.object,
					context,
				),
			setActivityBookingCustomerStatus: (
				confirmationCode: string,
				status: string,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/booking.json/activity-booking/${segment(confirmationCode)}/customer-status/${segment(status)}`,
					bokunSchemas.object,
					context,
				),
			setRouteBookingCustomerStatus: (
				confirmationCode: string,
				status: string,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/booking.json/route-booking/${segment(confirmationCode)}/customer-status/${segment(status)}`,
					bokunSchemas.object,
					context,
				),
		},

		productList: {
			get: (
				id: T.BokunId,
				query: T.BokunProductListQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/product-list.json/${segment(id)}`,
					bokunSchemas.productList,
					context,
					query,
				),
			getBySlug: (
				slug: string,
				query: T.BokunProductListQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/product-list.json/slug/${segment(slug)}`,
					bokunSchemas.productList,
					context,
					query,
				),
			list: (query: T.BokunLangQuery = {}, context?: T.BokunRequestContext) =>
				this.get(
					"/product-list.json/list",
					bokunSchemas.productListDescriptions,
					context,
					query,
				),
		},
	};

	readonly v2 = {
		booking: {
			getAuditTrail: (bookingId: T.BokunId, context?: T.BokunRequestContext) =>
				this.get(
					`/restapi/v2.0/booking/${segment(bookingId)}/audit-records`,
					bokunSchemas.objectArray,
					context,
				),
			getCustomer: (customerId: T.BokunId, context?: T.BokunRequestContext) =>
				this.get(
					`/restapi/v2.0/customer/${segment(customerId)}`,
					bokunSchemas.customer,
					context,
				),
			getInvoices: (
				bookingId: T.BokunId,
				query: T.BokunBookingInvoicesQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/restapi/v2.0/booking/${segment(bookingId)}/invoices`,
					bokunSchemas.object,
					context,
					query,
				),
			getPayments: (bookingId: T.BokunId, context?: T.BokunRequestContext) =>
				this.get(
					`/restapi/v2.0/booking/${segment(bookingId)}/payments`,
					bokunSchemas.objectArray,
					context,
				),
		},

		pricing: {
			createPriceSchedule: (
				body: T.BokunPriceScheduleInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/restapi/v2.0/pricing/schedule",
					body,
					bokunSchemas.priceSchedule,
					context,
				),
			createPricingCategory: (
				body: T.BokunPricingCategoryInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/restapi/v2.0/pricing/category",
					body,
					bokunSchemas.pricingCategory,
					context,
				),
			createPromoCode: (
				body: T.BokunPromoCodeInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/restapi/v2.0/promo/code",
					body,
					bokunSchemas.promoCode,
					context,
				),
			deletePriceSchedule: (
				priceScheduleId: T.BokunId,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"DELETE",
					`/restapi/v2.0/pricing/schedule/${segment(priceScheduleId)}`,
					undefined,
					bokunSchemas.void,
					context,
				),
			deletePricingCategory: (
				pricingCategoryId: T.BokunId,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"DELETE",
					`/restapi/v2.0/pricing/category/${segment(pricingCategoryId)}`,
					undefined,
					bokunSchemas.void,
					context,
				),
			deletePromoCodes: (
				promoCodeId: T.BokunId,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"DELETE",
					"/restapi/v2.0/promo/codes",
					undefined,
					bokunSchemas.void,
					context,
					{ promoCodeId },
				),
			getCancellationPolicies: (
				query: T.BokunPageQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					"/restapi/v2.0/cancellation/policies",
					bokunSchemas.cancellationPolicies,
					context,
					query,
				),
			getPriceCatalogs: (
				query: T.BokunPageQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					"/restapi/v2.0/price/catalogs",
					bokunSchemas.priceCatalogs,
					context,
					query,
				),
			getPriceSchedule: (
				priceScheduleId: T.BokunId,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/restapi/v2.0/pricing/schedule/${segment(priceScheduleId)}`,
					bokunSchemas.priceSchedule,
					context,
				),
			getPriceSchedules: (
				query: T.BokunPageQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					"/restapi/v2.0/pricing/schedules",
					bokunSchemas.priceSchedules,
					context,
					query,
				),
			getPricingCategories: (
				query: T.BokunPageQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					"/restapi/v2.0/pricing/categories",
					bokunSchemas.pricingCategories,
					context,
					query,
				),
			getPricingCategory: (
				pricingCategoryId: T.BokunId,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/restapi/v2.0/pricing/category/${segment(pricingCategoryId)}`,
					bokunSchemas.pricingCategory,
					context,
				),
			getPromoCode: (promoCodeId: T.BokunId, context?: T.BokunRequestContext) =>
				this.get(
					`/restapi/v2.0/promo/code/${segment(promoCodeId)}`,
					bokunSchemas.promoCode,
					context,
				),
			getPromoCodes: (
				query: T.BokunPageQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					"/restapi/v2.0/promo/codes",
					bokunSchemas.promoCodes,
					context,
					query,
				),
			getTax: (taxId: T.BokunId, context?: T.BokunRequestContext) =>
				this.get(
					`/restapi/v2.0/tax/${segment(taxId)}`,
					bokunSchemas.tax,
					context,
				),
			listTaxes: (query: T.BokunPageQuery, context?: T.BokunRequestContext) =>
				this.get("/restapi/v2.0/taxes", bokunSchemas.taxes, context, query),
			reorderPriceSchedules: (
				body: T.BokunPriceSchedulesReorderInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/restapi/v2.0/pricing/schedules/reorder",
					body,
					bokunSchemas.void,
					context,
				),
			updatePriceSchedule: (
				priceScheduleId: T.BokunId,
				body: T.BokunPriceScheduleInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"PUT",
					`/restapi/v2.0/pricing/schedule/${segment(priceScheduleId)}`,
					body,
					bokunSchemas.priceSchedule,
					context,
				),
			updatePricingCategory: (
				pricingCategoryId: T.BokunId,
				body: T.BokunPricingCategoryInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"PUT",
					`/restapi/v2.0/pricing/category/${segment(pricingCategoryId)}`,
					body,
					bokunSchemas.pricingCategory,
					context,
				),
			updatePromoCode: (
				promoCodeId: T.BokunId,
				body: T.BokunPromoCodeInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"PUT",
					`/restapi/v2.0/promo/code/${segment(promoCodeId)}`,
					body,
					bokunSchemas.promoCode,
					context,
				),
		},

		experience: {
			create: (
				body: T.BokunExperienceComponentsInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/restapi/v2.0/experience",
					body,
					bokunSchemas.experienceComponents,
					context,
				),
			delete: (experienceId: T.BokunId, context?: T.BokunRequestContext) =>
				this.mutate(
					"DELETE",
					`/restapi/v2.0/experience/${segment(experienceId)}`,
					undefined,
					bokunSchemas.void,
					context,
				),
			getComponents: (
				experienceId: T.BokunId,
				query: T.BokunComponentsQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/restapi/v2.0/experience/${segment(experienceId)}/components`,
					bokunSchemas.experienceComponents,
					context,
					query,
				),
			listIds: (
				query: T.BokunExperienceIdsQuery = {},
				context?: T.BokunRequestContext,
			) =>
				this.get(
					"/restapi/v2.0/experiences/ids",
					bokunSchemas.idArray,
					context,
					query,
				),
			setComponents: (
				experienceId: T.BokunId,
				body: T.BokunExperienceComponentsInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"PUT",
					`/restapi/v2.0/experience/${segment(experienceId)}/components`,
					body,
					bokunSchemas.experienceComponents,
					context,
				),
			uploadExtraPhoto: (
				extraId: T.BokunId,
				body: T.BokunJsonBody,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/restapi/v2.0/extra/${segment(extraId)}/photo`,
					body,
					bokunSchemas.object,
					context,
				),
			uploadPhoto: (
				experienceId: T.BokunId,
				body: T.BokunJsonBody,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/restapi/v2.0/experience/${segment(experienceId)}/photo`,
					body,
					bokunSchemas.object,
					context,
				),
		},

		experienceBooking: {
			createNote: (
				experienceBookingId: T.BokunId,
				body: T.BokunExperienceBookingNoteInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/restapi/v2.0/experienceBooking/${segment(experienceBookingId)}/notes`,
					body,
					bokunSchemas.experienceBookingNote,
					context,
				),
			deleteNote: (
				experienceBookingId: T.BokunId,
				noteId: T.BokunId,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"DELETE",
					`/restapi/v2.0/experienceBooking/${segment(experienceBookingId)}/notes/${segment(noteId)}`,
					undefined,
					bokunSchemas.void,
					context,
				),
			getNotes: (
				experienceBookingId: T.BokunId,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/restapi/v2.0/experienceBooking/${segment(experienceBookingId)}/notes`,
					bokunSchemas.experienceBookingNotes,
					context,
				),
			updateNote: (
				experienceBookingId: T.BokunId,
				noteId: T.BokunId,
				body: T.BokunUpdateExperienceBookingNoteInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"PUT",
					`/restapi/v2.0/experienceBooking/${segment(experienceBookingId)}/notes/${segment(noteId)}`,
					body,
					bokunSchemas.experienceBookingNote,
					context,
				),
		},

		availability: {
			createAllocation: (
				body: T.BokunExperienceAllocationInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					"/restapi/v2.0/allocation",
					body,
					bokunSchemas.experienceAllocation,
					context,
				),
			createCloseouts: (
				experienceId: T.BokunId,
				query: T.BokunCloseoutQuery,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/restapi/v2.0/availability/${segment(experienceId)}/closeouts`,
					undefined,
					bokunSchemas.void,
					context,
					query,
				),
			deleteAllocation: (
				allocationId: T.BokunId,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"DELETE",
					`/restapi/v2.0/allocation/${segment(allocationId)}`,
					undefined,
					bokunSchemas.void,
					context,
				),
			deleteCloseouts: (
				experienceId: T.BokunId,
				query: T.BokunCloseoutQuery,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"DELETE",
					`/restapi/v2.0/availability/${segment(experienceId)}/closeouts`,
					undefined,
					bokunSchemas.void,
					context,
					query,
				),
			getAllocation: (
				allocationId: T.BokunId,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/restapi/v2.0/allocation/${segment(allocationId)}`,
					bokunSchemas.experienceAllocation,
					context,
				),
			getAllocations: (
				query: T.BokunAllocationsQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					"/restapi/v2.0/allocations",
					bokunSchemas.experienceAllocations,
					context,
					query,
				),
			getAllocationsByStartTime: (
				startTimeId: T.BokunId,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/restapi/v2.0/startTime/${segment(startTimeId)}/allocations`,
					bokunSchemas.idArray,
					context,
				),
			getAvailability: (
				experienceId: T.BokunId,
				query: T.BokunAvailabilityRangeQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/restapi/v2.0/availability/${segment(experienceId)}`,
					bokunSchemas.experienceAvailability,
					context,
					query,
				),
			getAvailabilityStatistics: (
				experienceId: T.BokunId,
				query: T.BokunAvailabilityRangeQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/restapi/v2.0/availability/${segment(experienceId)}/statistics`,
					bokunSchemas.objectArray,
					context,
					query,
				),
			getCloseouts: (
				experienceId: T.BokunId,
				query: T.BokunCloseoutQuery,
				context?: T.BokunRequestContext,
			) =>
				this.get(
					`/restapi/v2.0/availability/${segment(experienceId)}/closeouts`,
					bokunSchemas.objectArray,
					context,
					query,
				),
			productAvailabilityChanged: (
				bokunProductId: T.BokunId,
				query: T.BokunAvailabilityChangedQuery,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"POST",
					`/restapi/v2.0/experience/${segment(bokunProductId)}/availability/changed`,
					undefined,
					bokunSchemas.void,
					context,
					query,
				),
			setAllocationsByStartTime: (
				startTimeId: T.BokunId,
				allocationIds: readonly number[],
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"PUT",
					`/restapi/v2.0/startTime/${segment(startTimeId)}/allocations`,
					allocationIds,
					bokunSchemas.idArray,
					context,
				),
			setAllocationsForExperience: (
				experienceId: T.BokunId,
				allocationIds: readonly number[],
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"PUT",
					`/restapi/v2.0/experience/${segment(experienceId)}/allocations`,
					allocationIds,
					bokunSchemas.idArray,
					context,
				),
			updateAllocation: (
				allocationId: T.BokunId,
				body: T.BokunExperienceAllocationInput,
				context?: T.BokunRequestContext,
			) =>
				this.mutate(
					"PUT",
					`/restapi/v2.0/allocation/${segment(allocationId)}`,
					body,
					bokunSchemas.experienceAllocation,
					context,
				),
		},
	};

	readonly #accessKey: string;
	readonly #baseUrl: URL;
	readonly #fetch: T.BokunFetch;
	readonly #maxReadRetries: number;
	readonly #now: () => Date;
	readonly #retryDelayMs: number;
	readonly #secretKey: string;
	readonly #timeoutMs: number;

	constructor(options: T.BokunClientOptions) {
		const accessKey = options.accessKey.trim();
		const secretKey = options.secretKey.trim();
		if (!accessKey || !secretKey) {
			throw new BokunConfigurationError(
				"Bokun access key and secret key are required",
			);
		}

		this.#accessKey = accessKey;
		this.#secretKey = secretKey;
		this.#baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
		if (this.#baseUrl.protocol !== "https:") {
			throw new BokunConfigurationError("Bokun base URL must use HTTPS");
		}
		this.#fetch = options.fetch ?? globalThis.fetch;
		this.#now = options.now ?? (() => new Date());
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
			throw new BokunConfigurationError(
				"Bokun retry and timeout options must be valid positive values",
			);
		}
	}

	private get<TSchema extends z.ZodType>(
		path: string,
		schema: TSchema,
		context?: T.BokunRequestContext,
		query?: Query,
	): Promise<z.output<TSchema>> {
		return this.request({ context, method: "GET", path, query, schema });
	}

	private getText(
		path: string,
		context?: T.BokunRequestContext,
		query?: Query,
	): Promise<string> {
		return this.request({
			context,
			method: "GET",
			path,
			query,
			responseType: "text",
			schema: bokunSchemas.text,
		});
	}

	private mutate<TSchema extends z.ZodType>(
		method: Exclude<HttpMethod, "GET">,
		path: string,
		body: unknown,
		schema: TSchema,
		context?: T.BokunRequestContext,
		query?: Query,
	): Promise<z.output<TSchema>> {
		return this.request({ body, context, method, path, query, schema });
	}

	private async request<TSchema extends z.ZodType>({
		body,
		context,
		method,
		path,
		query,
		responseType = "json",
		schema,
	}: RequestOptions<TSchema>): Promise<z.output<TSchema>> {
		const requestId = crypto.randomUUID();

		if (context?.signal?.aborted) {
			throw new BokunRequestAbortedError("Bokun request was aborted", {
				requestId,
			});
		}

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
					responseType,
					schema,
				});
			} catch (error) {
				if (context?.signal?.aborted) {
					throw new BokunRequestAbortedError("Bokun request was aborted", {
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

		throw new BokunNetworkError("Bokun request exhausted retries", {
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
		responseType,
		schema,
	}: RequestOptions<TSchema> & {
		requestId: string;
		responseType: ResponseType;
	}): Promise<z.output<TSchema>> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
		const abort = () => controller.abort(context?.signal?.reason);
		context?.signal?.addEventListener("abort", abort, { once: true });
		if (context?.signal?.aborted) {
			abort();
		}

		try {
			const url = buildUrl(this.#baseUrl, path, query);
			const signaturePath = `${url.pathname}${url.search}`;
			const signedHeaders = signBokunRequest({
				accessKey: this.#accessKey,
				date: this.#now(),
				method,
				path: signaturePath,
				secretKey: this.#secretKey,
			});

			const response = await this.#fetch(url, {
				body: body === undefined ? undefined : JSON.stringify(body),
				headers: {
					Accept: responseType === "text" ? "*/*" : "application/json",
					"Content-Type": "application/json;charset=UTF-8",
					...signedHeaders,
				},
				method,
				signal: controller.signal,
			});

			if (responseType === "text") {
				const text = await response.text();
				if (!response.ok) {
					throw new BokunApiError(
						`Bokun request failed with status ${response.status}`,
						response.status,
						{
							providerMessage: redactBokunText(text, [this.#secretKey]),
							requestId,
						},
					);
				}
				return schema.parse(text);
			}

			const payload = await readPayload(response);

			if (!response.ok) {
				throw new BokunApiError(
					`Bokun request failed with status ${response.status}`,
					response.status,
					{
						providerMessage: providerError(payload, this.#secretKey),
						requestId,
					},
				);
			}

			const result = schema.safeParse(payload);
			if (!result.success) {
				throw new BokunResponseValidationError(
					"Bokun returned an unexpected response shape",
					{ cause: result.error, requestId },
				);
			}

			return result.data;
		} catch (error) {
			if (
				error instanceof BokunApiError ||
				error instanceof BokunResponseValidationError
			) {
				throw error;
			}

			if (controller.signal.aborted) {
				throw new BokunTimeoutError("Bokun request timed out or was aborted", {
					cause: error,
					requestId,
				});
			}

			throw new BokunNetworkError("Bokun request failed before a response", {
				cause: error,
				requestId,
			});
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
	if (Array.isArray(value)) {
		return value.map(String).join(",");
	}

	if (typeof value === "object") {
		return JSON.stringify(value);
	}

	return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function providerError(value: unknown, secretKey: string): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const message =
		typeof value.error === "string"
			? value.error
			: typeof value.message === "string"
				? value.message
				: undefined;

	return message === undefined
		? undefined
		: redactBokunText(message, [secretKey]);
}

async function readPayload(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return undefined;
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

function segment(value: T.BokunId): string {
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
		(error instanceof BokunApiError ||
			error instanceof BokunNetworkError ||
			error instanceof BokunTimeoutError) &&
		error.retryable
	);
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
