import { getAccommodationsConfig } from "@workspace/core/accommodations";
import { isAuthorizedCronRequest } from "@workspace/core/listing-cache";
import { guestComplianceService } from "@/lib/api/compliance";
import { withApiRoute } from "@/lib/api/route";

export const GET = withApiRoute(
	{ name: "cron.commerce.guest_submissions", rateLimit: { bucket: "cron" } },
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

		const summary = await guestComplianceService().run();
		return Response.json({ data: summary, success: true });
	},
);
