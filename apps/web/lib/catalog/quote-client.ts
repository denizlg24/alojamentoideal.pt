import type { AccommodationQuoteResult } from "@workspace/core/accommodations";

export interface QuoteRequestParams {
	adults: number;
	checkIn: string;
	checkOut: string;
	children: number;
	guests: number;
	listingId: string;
	signal?: AbortSignal;
}

export type QuoteFailureCode =
	| "dates_unavailable"
	| "invalid_request"
	| "network_error"
	| "pricing_unavailable"
	| "too_many_guests";

export type QuoteResponse =
	| { ok: true; quote: AccommodationQuoteResult }
	| {
			code: QuoteFailureCode;
			message: string;
			ok: false;
			status: number;
	  };

interface QuoteErrorBody {
	code?: QuoteFailureCode;
	error?: string;
	message?: string;
}

/**
 * Client wrapper over the live quote endpoint. Returns the Hostify-backed price
 * and `available` flag for the selected stay; a non-2xx status surfaces as
 * `ok: false` so callers can show a generic error rather than a price.
 */
export async function fetchListingQuote({
	signal,
	...body
}: QuoteRequestParams): Promise<QuoteResponse> {
	let response: Response;
	try {
		response = await fetch("/api/accommodations/quote", {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
			method: "POST",
			signal,
		});
	} catch (error) {
		// Aborts are caller-driven cancellations; let them propagate so the caller
		// can ignore them rather than render a network error.
		if (error instanceof DOMException && error.name === "AbortError") {
			throw error;
		}
		return {
			code: "network_error",
			message: "Could not reach the pricing service. Please try again.",
			ok: false,
			status: 0,
		};
	}

	if (!response.ok) {
		const error = await readQuoteError(response);
		return {
			code: error.code,
			message: error.message,
			ok: false,
			status: response.status,
		};
	}

	const json = (await response.json()) as { data: AccommodationQuoteResult };
	return { ok: true, quote: json.data };
}

async function readQuoteError(
	response: Response,
): Promise<{ code: QuoteFailureCode; message: string }> {
	const fallback = fallbackError(response.status);

	try {
		const body = (await response.json()) as QuoteErrorBody;
		return {
			code: body.code ?? fallback.code,
			message: body.message ?? body.error ?? fallback.message,
		};
	} catch {
		return fallback;
	}
}

function fallbackError(status: number): {
	code: QuoteFailureCode;
	message: string;
} {
	if (status === 400) {
		return {
			code: "invalid_request",
			message: "Please check your dates and guests.",
		};
	}

	if (status === 409) {
		return {
			code: "dates_unavailable",
			message: "These dates are no longer available.",
		};
	}

	if (status === 422) {
		return {
			code: "too_many_guests",
			message: "This home cannot accommodate that many guests.",
		};
	}

	return {
		code: "pricing_unavailable",
		message: "Pricing is temporarily unavailable. Please try again.",
	};
}
