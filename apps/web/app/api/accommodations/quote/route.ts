import {
	AccommodationQuoteService,
	getAccommodationsConfig,
	parseQuoteBody,
} from "@workspace/core/accommodations";
import { createHostifyClientFromEnv } from "@workspace/core/integrations/hostify";
import { getRedis } from "@workspace/core/redis";
import { quoteFailure } from "@/lib/api/hostify-errors";
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
