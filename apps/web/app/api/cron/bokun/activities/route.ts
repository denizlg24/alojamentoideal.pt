import {
	createBokunActivityCacheSyncFromEnv,
	getActivityCacheConfigFromSettings,
} from "@workspace/core/activities/cache";
import { isAuthorizedCronRequest } from "@workspace/core/listing-cache";
import { revalidateTag } from "next/cache";
import {
	ACTIVITIES_LIST_TAG,
	activityDetailTag,
} from "@/lib/activities/constants";
import { withApiRoute } from "@/lib/api/route";

// `Authorization: Bearer $CRON_SECRET`.
export const GET = withApiRoute(
	{ name: "cron.bokun.activities", rateLimit: { bucket: "cron" } },
	async (request: Request): Promise<Response> => {
		const config = await getActivityCacheConfigFromSettings();

		if (!config.cronSecret) {
			return Response.json(
				{ error: "Cron secret is not configured" },
				{ status: 503 },
			);
		}

		if (!isAuthorizedCronRequest(request, config.cronSecret)) {
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		}

		const sync = await createBokunActivityCacheSyncFromEnv(config);
		const result = await sync.pollActivities("poll");

		const changedExternalIds = result.data?.changedExternalIds ?? [];
		if (changedExternalIds.length > 0) {
			revalidateTag(ACTIVITIES_LIST_TAG, "max");
			for (const externalId of changedExternalIds) {
				revalidateTag(activityDetailTag(externalId), "max");
			}
		}

		return Response.json({ data: result, success: true });
	},
);
