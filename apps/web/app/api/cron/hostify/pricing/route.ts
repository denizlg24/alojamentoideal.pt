import {
	createNightlyPriceSyncFromEnv,
	getAccommodationsConfig,
} from "@workspace/core/accommodations";
import { isAuthorizedCronRequest } from "@workspace/core/listing-cache";
import { revalidateTag } from "next/cache";
import { withApiRoute } from "@/lib/api/route";
import { ADVISORY_PRICING_TAG } from "@/lib/catalog/pricing";

// `Authorization: Bearer $CRON_SECRET`.
export const GET = withApiRoute(
	{ name: "cron.hostify.pricing", rateLimit: { bucket: "cron" } },
	async (request: Request): Promise<Response> => {
		const config = getAccommodationsConfig();

		if (!config.cronSecret) {
			return Response.json(
				{ error: "Cron secret is not configured" },
				{ status: 503 },
			);
		}

		if (!isAuthorizedCronRequest(request, config.cronSecret)) {
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		}

		const sync = createNightlyPriceSyncFromEnv();
		const result = await sync.sync("cron");

		revalidateTag(ADVISORY_PRICING_TAG, "max");

		return Response.json({ data: result, success: true });
	},
);
