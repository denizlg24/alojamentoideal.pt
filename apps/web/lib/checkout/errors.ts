/**
 * Normalizes route-handler error responses into a single UI-facing error.
 * Commerce/checkout routes return `{ code, error, issues? }`; this maps known
 * codes to guest-friendly copy and degrades gracefully for unknown shapes.
 */

export interface CheckoutIssue {
	message: string;
	path: string;
}

interface RouteErrorBody {
	code?: string;
	error?: string;
	issues?: CheckoutIssue[];
	message?: string;
}

export class CheckoutError extends Error {
	readonly code: string;
	readonly issues: CheckoutIssue[];
	readonly status: number;

	constructor(options: {
		code: string;
		issues?: CheckoutIssue[];
		message: string;
		status: number;
	}) {
		super(options.message);
		this.name = "CheckoutError";
		this.code = options.code;
		this.issues = options.issues ?? [];
		this.status = options.status;
	}
}

const NETWORK_ERROR_MESSAGE =
	"We could not reach the server. Please check your connection and try again.";

const FRIENDLY_MESSAGES: Record<string, string> = {
	cart_changed: "Your stay was updated. Please review the new details.",
	cart_converted:
		"We are preparing your payment step. Please review your details to finish.",
	cart_expired: "This booking session expired. Please start again from Homes.",
	cart_not_found: "We could not find this booking session.",
	cart_not_mutable: "This booking can no longer be changed.",
	dates_unavailable:
		"These dates are no longer available. Please choose a different period.",
	discount_invalid: "This promo code is not valid.",
	discount_unavailable: "Promo codes are temporarily unavailable.",
	empty_cart: "Your booking is empty. Please add a stay to continue.",
	network_error: NETWORK_ERROR_MESSAGE,
	order_expired: "This checkout session expired. Please start again.",
	order_not_found: "We could not find this booking.",
	order_not_payable: "This booking can no longer be paid.",
	payment_unavailable:
		"Payments are temporarily unavailable. Please try again shortly.",
	pricing_unavailable: "Pricing is temporarily unavailable. Please try again.",
	quote_expired: "Your stay price was refreshed. Please review the new total.",
	quote_revalidation_failed:
		"We could not confirm the latest price. Please try again.",
	reservation_unavailable:
		"These dates are no longer available. Please choose a different period.",
	too_many_guests: "This home cannot accommodate that many guests.",
};

function fallbackCode(status: number): string {
	if (status === 0) return "network_error";
	if (status === 400) return "invalid_request";
	if (status === 401) return "unauthorized";
	if (status === 404) return "not_found";
	if (status === 409) return "conflict";
	if (status === 429) return "rate_limited";
	return "request_failed";
}

function genericMessage(status: number): string {
	if (status === 0) return NETWORK_ERROR_MESSAGE;
	if (status === 429)
		return "You are going too fast. Please wait a moment and try again.";
	if (status >= 500)
		return "Something went wrong on our side. Please try again shortly.";
	return "Something went wrong. Please try again.";
}

/** Reads an error `Response` into a `CheckoutError` with friendly copy. */
export async function readCheckoutError(
	response: Response,
): Promise<CheckoutError> {
	let body: RouteErrorBody | null = null;
	try {
		body = (await response.json()) as RouteErrorBody;
	} catch {
		body = null;
	}

	const code = body?.code ?? fallbackCode(response.status);
	const message =
		FRIENDLY_MESSAGES[code] ??
		body?.error ??
		body?.message ??
		genericMessage(response.status);

	return new CheckoutError({
		code,
		issues: body?.issues,
		message,
		status: response.status,
	});
}

/** Wraps a thrown value as a `CheckoutError`, preserving network failures. */
export function toCheckoutError(error: unknown): CheckoutError {
	if (error instanceof CheckoutError) {
		return error;
	}
	return new CheckoutError({
		code: "network_error",
		message: NETWORK_ERROR_MESSAGE,
		status: 0,
	});
}
