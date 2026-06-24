import {
	HostifyApiError,
	HostifyError,
} from "@workspace/core/integrations/hostify";

export type QuoteFailure = {
	code: "dates_unavailable" | "pricing_unavailable" | "too_many_guests";
	message: string;
	status: number;
};

export function quoteFailure(error: unknown): QuoteFailure | null {
	if (error instanceof HostifyApiError) {
		const message = (error.providerMessage ?? error.message).toLowerCase();

		if (isTooManyGuests(message)) {
			return {
				code: "too_many_guests",
				message: "This home cannot accommodate that many guests.",
				status: 422,
			};
		}

		if (isUnavailable(message)) {
			return {
				code: "dates_unavailable",
				message: "These dates are no longer available.",
				status: 409,
			};
		}

		return {
			code: "pricing_unavailable",
			message:
				error.status === 404
					? "Pricing is not available for this home right now."
					: "Pricing is temporarily unavailable. Please try again.",
			status: error.status === 404 ? 404 : 502,
		};
	}

	if (error instanceof HostifyError) {
		return {
			code: "pricing_unavailable",
			message: "Pricing is temporarily unavailable. Please try again.",
			status: 503,
		};
	}

	return null;
}

function isTooManyGuests(message: string): boolean {
	return (
		/\b(guest|guests|person|people|capacity|occupancy)\b/.test(message) &&
		/\b(too many|exceed|exceeds|maximum|max|capacity|accommodate)\b/.test(
			message,
		)
	);
}

function isUnavailable(message: string): boolean {
	return /\b(unavailable|not available|blocked|occupied|already booked|reserved)\b/.test(
		message,
	);
}
