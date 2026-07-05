import {
	createHostifyListingCacheSyncFromEnv,
	getListingCacheConfig,
	isAuthorizedCronRequest,
} from "@workspace/core/listing-cache";
import { revalidateTag } from "next/cache";
import { withApiRoute } from "@/lib/api/route";
import { CATALOG_LISTINGS_TAG, catalogListingTag } from "@/lib/catalog/cache";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";

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

		const sync = await createHostifyListingCacheSyncFromEnv();
		const result = await sync.pollListings("poll");

		const changedExternalIds = result.data?.changedExternalIds ?? [];
		if (changedExternalIds.length > 0) {
			const scope = {
				accountId: config.hostifyAccountId,
				provider: HOSTIFY_PROVIDER,
			};
			// Drop all list pages: a created or newly-qualifying listing is not
			// referenced by any existing list cache entry, so per-listing tags
			// alone cannot catch it.
			revalidateTag(CATALOG_LISTINGS_TAG, "max");
			for (const externalId of changedExternalIds) {
				revalidateTag(catalogListingTag(scope, externalId), "max");
			}
		}

		return Response.json({ data: result, success: true });
	},
);
