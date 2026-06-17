import {
	createHostifyListingCacheSyncFromEnv,
	getListingCacheConfig,
	isAuthorizedCronRequest,
} from "@workspace/core/listing-cache";

export const maxDuration = 300;

// Vercel Cron invokes this with a GET request carrying
// `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: Request): Promise<Response> {
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

	try {
		const sync = createHostifyListingCacheSyncFromEnv();
		const result = await sync.syncListings("cron");

		return Response.json({ data: result, success: true });
	} catch (error) {
		console.error("Hostify listing sync failed", error);
		return Response.json(
			{ error: "Hostify listing sync failed" },
			{ status: 500 },
		);
	}
}
