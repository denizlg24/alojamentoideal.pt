import { getAccommodationsConfig } from "@workspace/core/accommodations";
import { isAuthorizedCronRequest } from "@workspace/core/listing-cache";
import { commerceService } from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { sendOrderConfirmationEmail } from "@/lib/email/order-confirmation";
import { sendOrderCompensationEmail } from "@/lib/email/order-could-not-confirm";
import { sendOrderPendingConfirmationEmail } from "@/lib/email/order-pending";

/**
 * Reconciler cron for the reservation saga (durability authority; the webhook is
 * just an optimisation). Resolves `pending` orders whose holds are due — reading
 * the live PaymentIntent when a webhook never arrived — and releases holds on
 * abandoned checkouts past their window. Emails for orders it finalises are sent
 * here (the transport seam the service delegates back to). Guarded with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export const GET = withApiRoute(
	{ name: "cron.commerce.reservations", rateLimit: { bucket: "cron" } },
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

		const summary = await commerceService().reconcileReservations({
			onCompensated: sendOrderCompensationEmail,
			onConfirmed: sendOrderConfirmationEmail,
			onPendingNotice: sendOrderPendingConfirmationEmail,
		});

		return Response.json({ data: summary, success: true });
	},
);
