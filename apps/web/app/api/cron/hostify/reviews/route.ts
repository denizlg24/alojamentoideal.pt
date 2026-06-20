import { isAuthorizedCronRequest } from "@workspace/core/listing-cache";
import {
	createHostifyListingReviewSyncFromEnv,
	getListingReviewSyncConfig,
} from "@workspace/core/listing-reviews";
import { revalidateTag } from "next/cache";
import { withApiRoute } from "@/lib/api/route";
import { CATALOG_LISTINGS_TAG, catalogListingTag } from "@/lib/catalog/cache";
import { HOSTIFY_PROVIDER } from "@/lib/catalog/constants";

// `Authorization: Bearer $CRON_SECRET`.
export const GET = withApiRoute(
	{ name: "cron.hostify.reviews", rateLimit: { bucket: "cron" } },
	async (request: Request): Promise<Response> => {
		const config = getListingReviewSyncConfig();

		if (!config.cronSecret) {
			return Response.json(
				{ error: "Cron secret is not configured" },
				{ status: 503 },
			);
		}

		if (!isAuthorizedCronRequest(request, config.cronSecret)) {
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		}

		const sync = createHostifyListingReviewSyncFromEnv();
		const result = await sync.pollReviews("poll");

		const changedListingExternalIds =
			result.data?.changedListingExternalIds ?? [];
		if (changedListingExternalIds.length > 0) {
			const scope = {
				accountId: config.hostifyAccountId,
				provider: HOSTIFY_PROVIDER,
			};
			// A changed aggregate alters the rating badge on list cards and detail
			// pages, so drop the shared list tag plus each affected listing tag.
			revalidateTag(CATALOG_LISTINGS_TAG, "max");
			for (const externalId of changedListingExternalIds) {
				revalidateTag(catalogListingTag(scope, externalId), "max");
			}
		}

		return Response.json({ data: result, success: true });
	},
);
