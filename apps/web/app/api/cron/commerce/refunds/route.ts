import { getAccommodationsConfig } from "@workspace/core/accommodations";
import { isAuthorizedCronRequest } from "@workspace/core/listing-cache";
import { orderRefundService } from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

/**
 * Reconciler cron for the manual refund ledger. Resumes `pending` rows left by
 * a crash between the amount reservation and the Stripe call (or between
 * Stripe and the ledger update) and retries Detours transfer reversals that
 * failed after their refund succeeded. Safe to rerun: every Stripe call reuses
 * the row's stored idempotency key. Guarded with
 * `Authorization: Bearer $CRON_SECRET`.
 */
export const GET = withApiRoute(
	{ name: "cron.commerce.refunds", rateLimit: { bucket: "cron" } },
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

		const summary = await orderRefundService().reconcileRefunds();

		return Response.json({ data: summary, success: true });
	},
);
