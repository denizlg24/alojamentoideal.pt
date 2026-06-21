import {
	AccommodationAvailabilityService,
	getAccommodationsConfig,
	parseAvailabilitySearchParams,
} from "@workspace/core/accommodations";
import { createHostifyClientFromEnv } from "@workspace/core/integrations/hostify";
import { getRedis } from "@workspace/core/redis";
import { withApiRoute } from "@/lib/api/route";

export const GET = withApiRoute(
	{ name: "accommodations.availability", rateLimit: { bucket: "default" } },
	async (request: Request): Promise<Response> => {
		const parsed = parseAvailabilitySearchParams(
			new URL(request.url).searchParams,
		);

		if (!parsed.success) {
			return Response.json(
				{
					error: "Invalid availability parameters",
					issues: parsed.error.issues.map((issue) => ({
						message: issue.message,
						path: issue.path.join("."),
					})),
				},
				{ status: 400 },
			);
		}

		const config = getAccommodationsConfig();
		const service = new AccommodationAvailabilityService({
			client: createHostifyClientFromEnv(),
			redis: getRedis(),
			ttlSeconds: config.availabilityCacheTtlSeconds,
		});
		const result = await service.check(parsed.data);

		return Response.json({ data: result });
	},
);
