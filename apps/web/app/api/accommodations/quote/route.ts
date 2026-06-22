import {
	AccommodationQuoteService,
	getAccommodationsConfig,
	parseQuoteBody,
} from "@workspace/core/accommodations";
import {
	createHostifyClientFromEnv,
	HostifyApiError,
	HostifyError,
} from "@workspace/core/integrations/hostify";
import { getRedis } from "@workspace/core/redis";
import { withApiRoute } from "@/lib/api/route";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";

export const POST = withApiRoute(
	{ name: "accommodations.quote", rateLimit: { bucket: "default" } },
	async (request: Request): Promise<Response> => {
		const body = await request.json().catch(() => null);
		const parsed = parseQuoteBody(body);

		if (!parsed.success) {
			return Response.json(
				{
					code: "invalid_request",
					error: "Invalid quote request",
					issues: parsed.error.issues.map((issue) => ({
						message: issue.message,
						path: issue.path.join("."),
					})),
				},
				{ status: 400 },
			);
		}

		const config = getAccommodationsConfig();
		const service = new AccommodationQuoteService({
			client: createHostifyClientFromEnv(),
			currency: config.currency,
			redis: getRedis(),
			ttlSeconds: parsed.data.forceFresh ? 0 : config.quoteCacheTtlSeconds,
		});
		try {
			const result = await service.quote({
				...parsed.data,
				accountId: config.hostifyAccountId,
				providerId: HOSTIFY_PROVIDER,
			});
			return Response.json({ data: result });
		} catch (error) {
			const failure = quoteFailure(error);
			if (failure === null) {
				throw error;
			}

			return Response.json(
				{
					code: failure.code,
					error: failure.message,
					message: failure.message,
				},
				{ status: failure.status },
			);
		}
	},
);

type QuoteFailure = {
	code: "dates_unavailable" | "pricing_unavailable" | "too_many_guests";
	message: string;
	status: number;
};

function quoteFailure(error: unknown): QuoteFailure | null {
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
