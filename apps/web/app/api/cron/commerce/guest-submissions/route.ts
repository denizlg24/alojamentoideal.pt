import { getAccommodationsConfig } from "@workspace/core/accommodations";
import { isAuthorizedCronRequest } from "@workspace/core/listing-cache";
import { guestComplianceService } from "@/lib/api/compliance";
import { withApiRoute } from "@/lib/api/route";
import { sendGuestInfoReminderEmail } from "@/lib/email/guest-reminder";

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

		const summary = await (await guestComplianceService()).run(20, {
			onGuestInfoReminder: sendGuestInfoReminderEmail,
		});
		return Response.json({ data: summary, success: true });
	},
);
