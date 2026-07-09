import type { ActivityBookingSchema } from "@workspace/core/activities";
import type {
	CartMutationResponse,
	CartResponse,
	CartValidationResponse,
	CommerceActivityQuoteInput,
	DraftOrderActivityDetailInput,
	DraftOrderContactInput,
	DraftOrderResponse,
	HoldReservationResponse,
	OrderStatusResponse,
	PaymentIntentResponse,
} from "@workspace/core/commerce";
import { readCheckoutError, toCheckoutError } from "./errors";

/**
 * sessionStorage key holding the visitor's active cart id, shared by the
 * booking widget ("Add to cart") and the checkout controller so both converge
 * on one cart. The authoritative cart token stays in the httpOnly `ai_cart`
 * cookie; this only avoids spawning a fresh cart on reload.
 */
export const CHECKOUT_CART_STORAGE_KEY = "ai_checkout_cart_id";

/**
 * Typed client over the cart/checkout route handlers. Cookies (`ai_cart`,
 * session) ride along on these same-origin requests automatically. Every
 * non-2xx response is normalized into a `CheckoutError`; network failures are
 * caught and re-thrown the same way so callers only handle one error type.
 */

async function request<T>(input: string, init?: RequestInit): Promise<T> {
	let response: Response;
	try {
		response = await fetch(input, {
			...init,
			headers: {
				"content-type": "application/json",
				...init?.headers,
			},
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			throw error;
		}
		throw toCheckoutError(error);
	}

	if (!response.ok) {
		throw await readCheckoutError(response);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return (await response.json()) as T;
}

function jsonBody(body: unknown): RequestInit {
	return { body: JSON.stringify(body), method: "POST" };
}

export interface CreateCartInput {
	cartId?: string;
	idempotencyKey?: string;
}

const segment = (value: string) => encodeURIComponent(value);

export function createCart(body: CreateCartInput = {}): Promise<CartResponse> {
	return request<CartResponse>("/api/cart", jsonBody(body));
}

export function getCart(cartId: string): Promise<CartResponse> {
	return request<CartResponse>(`/api/cart/${segment(cartId)}`);
}

export interface AddAccommodationCartItemInput {
	adults?: number;
	checkIn: string;
	checkOut: string;
	children?: number;
	clientMutationId?: string;
	guests: number;
	idempotencyKey: string;
	infants?: number;
	listingId: string;
	pets?: number;
	type?: "accommodation";
}

export interface AddActivityCartItemInput
	extends Omit<CommerceActivityQuoteInput, "forceFresh"> {
	clientMutationId?: string;
	idempotencyKey: string;
	type: "activity";
}

export type AddCartItemInput =
	| AddAccommodationCartItemInput
	| AddActivityCartItemInput;

export function addCartItem(
	cartId: string,
	body: AddCartItemInput,
): Promise<CartMutationResponse> {
	return request<CartMutationResponse>(
		`/api/cart/${segment(cartId)}/items`,
		jsonBody(body),
	);
}

export interface UpdateCartItemInput {
	adults?: number;
	checkIn?: string;
	checkOut?: string;
	children?: number;
	guests?: number;
	idempotencyKey: string;
	infants?: number;
	pets?: number;
}

export function updateCartItem(
	cartId: string,
	itemId: string,
	body: UpdateCartItemInput,
): Promise<CartMutationResponse> {
	return request<CartMutationResponse>(
		`/api/cart/${segment(cartId)}/items/${segment(itemId)}`,
		{
			body: JSON.stringify(body),
			method: "PATCH",
		},
	);
}

export function removeCartItem(
	cartId: string,
	itemId: string,
	idempotencyKey?: string,
): Promise<CartResponse> {
	const query = idempotencyKey
		? `?idempotencyKey=${encodeURIComponent(idempotencyKey)}`
		: "";
	return request<CartResponse>(
		`/api/cart/${segment(cartId)}/items/${segment(itemId)}${query}`,
		{ method: "DELETE" },
	);
}

export function validateCart(cartId: string): Promise<CartValidationResponse> {
	return request<CartValidationResponse>(
		`/api/cart/${segment(cartId)}/validate`,
		jsonBody({}),
	);
}

export interface ApplyDiscountInput {
	code: string;
	idempotencyKey?: string;
}

export function applyDiscount(
	cartId: string,
	body: ApplyDiscountInput,
): Promise<CartResponse> {
	return request<CartResponse>(
		`/api/cart/${segment(cartId)}/discount`,
		jsonBody(body),
	);
}

export function removeDiscount(cartId: string): Promise<CartResponse> {
	return request<CartResponse>(`/api/cart/${segment(cartId)}/discount`, {
		method: "DELETE",
	});
}

export function claimCart(): Promise<CartResponse> {
	return request<CartResponse>("/api/cart/claim", jsonBody({}));
}

export interface CheckoutBillingAddress {
	city?: string;
	country?: string;
	line1?: string;
	line2?: string;
	postalCode?: string;
	region?: string;
}

export interface CheckoutContactInput {
	billingAddress?: CheckoutBillingAddress;
	companyName?: string;
	/** ISO YYYY-MM-DD; required by Bokun for activity main contacts. */
	dateOfBirth?: string;
	email: string;
	firstName?: string;
	isCompany?: boolean;
	/** Bokun language code, e.g. "en"; required for activity main contacts. */
	language?: string;
	lastName?: string;
	name: string;
	notes?: string;
	phone: string;
	taxNumber?: string;
}

export interface CreateDraftOrderInput {
	activityDetails?: DraftOrderActivityDetailInput[];
	cartId: string;
	contact: CheckoutContactInput;
	idempotencyKey?: string;
}

export function createDraftOrder(
	body: CreateDraftOrderInput,
): Promise<DraftOrderResponse> {
	return request<DraftOrderResponse>(
		"/api/checkout/draft-order",
		jsonBody(body),
	);
}

export interface ActivityBookingSchemaInput {
	activityDate: string;
	activityId: string;
	dropoffPlaceId?: string | null;
	participants: { count: number; pricingCategoryId: number }[];
	pickupPlaceId?: string | null;
	rateId: string | null;
	startTimeId: string | null;
}

/**
 * Fetches the Bokun booking-question schema for one activity selection so
 * checkout can collect the required questions and pickup/dropoff places before
 * the reservation hold. Read-only; the collected answers ride on the
 * draft-order body.
 */
export function fetchActivityBookingSchema(
	body: ActivityBookingSchemaInput,
): Promise<ActivityBookingSchema> {
	return request<ActivityBookingSchema>(
		"/api/checkout/activity-booking-schema",
		jsonBody(body),
	);
}

export interface CreatePaymentIntentInput {
	cartId: string;
	idempotencyKey?: string;
	/** Omit to resume the payable order a converted cart was turned into. */
	orderId?: string;
}

export function createPaymentIntent(
	body: CreatePaymentIntentInput,
): Promise<PaymentIntentResponse> {
	return request<PaymentIntentResponse>(
		"/api/checkout/payment-intent",
		jsonBody(body),
	);
}

/**
 * Happy-path checkout: creates the draft order and returns the PaymentIntent
 * (or a zero-total response) in one request, avoiding the extra draft-order /
 * payment-intent round trip. The slow provider reservation hold happens later,
 * immediately before the guest confirms payment.
 */
export function preparePayment(
	body: CreateDraftOrderInput,
): Promise<PaymentIntentResponse> {
	return request<PaymentIntentResponse>(
		"/api/checkout/prepare-payment",
		jsonBody(body),
	);
}

/**
 * Places the provider reservation hold immediately before Stripe confirmation.
 * If this fails, checkout aborts before the guest is charged.
 */
export function holdReservation(
	body: CreatePaymentIntentInput,
): Promise<HoldReservationResponse> {
	return request<HoldReservationResponse>(
		"/api/checkout/hold-reservation",
		jsonBody(body),
	);
}

export function getOrderStatus(
	publicReference: string,
): Promise<OrderStatusResponse> {
	return request<OrderStatusResponse>(
		`/api/checkout/order/${encodeURIComponent(publicReference)}`,
	);
}

export interface OrderContactResponse {
	contact: DraftOrderContactInput;
}

/** Reads the draft order's stored contact, to repaint the form after a reload. */
export function getOrderContact(
	publicReference: string,
): Promise<OrderContactResponse> {
	return request<OrderContactResponse>(
		`/api/checkout/order/${encodeURIComponent(publicReference)}/contact`,
	);
}

/** Updates the draft order's contact in place (does not affect the total). */
export function updateOrderContact(
	publicReference: string,
	body: CheckoutContactInput,
): Promise<OrderContactResponse> {
	return request<OrderContactResponse>(
		`/api/checkout/order/${encodeURIComponent(publicReference)}/contact`,
		{ body: JSON.stringify(body), method: "PUT" },
	);
}

/** Updates draft order activity answers in place before payment confirmation. */
export function updateOrderActivityDetails(
	publicReference: string,
	activityDetails: DraftOrderActivityDetailInput[],
): Promise<void> {
	return request<void>(
		`/api/checkout/order/${encodeURIComponent(publicReference)}/activity-details`,
		{
			body: JSON.stringify({ activityDetails }),
			method: "PUT",
		},
	);
}
