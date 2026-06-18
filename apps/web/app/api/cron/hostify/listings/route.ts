import {
	createHostifyListingCacheSyncFromEnv,
	getListingCacheConfig,
	isAuthorizedCronRequest,
} from "@workspace/core/listing-cache";
import { withApiRoute } from "@/lib/api";

// `Authorization: Bearer $CRON_SECRET`.
export const GET = withApiRoute(
	{ name: "cron.hostify.listings", rateLimit: { bucket: "cron" } },
	async (request: Request): Promise<Response> => {
		const config = getListingCacheConfig();

		if (!config.cronSecret) {
			return Response.json(
				{ error: "Cron secret is not configured" },
				{ status: 503 },
			);
		}

		if (!isAuthorizedCronRequest(request, config.cronSecret)) {
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		}

		const sync = createHostifyListingCacheSyncFromEnv();
		const result = await sync.pollListings("poll");

		return Response.json({ data: result, success: true });
	},
);
