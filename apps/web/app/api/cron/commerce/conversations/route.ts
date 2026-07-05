import { getAccommodationsConfig } from "@workspace/core/accommodations";
import { isAuthorizedCronRequest } from "@workspace/core/listing-cache";
import { commerceService } from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

export const GET = withApiRoute(
	{ name: "cron.commerce.conversations", rateLimit: { bucket: "cron" } },
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

		const summary = await (await commerceService()).reconcileConversations();
		return Response.json({ data: summary, success: true });
	},
);
