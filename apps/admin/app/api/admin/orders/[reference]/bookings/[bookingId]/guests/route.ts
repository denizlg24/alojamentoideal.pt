import {
	parseUpdateBookingGuestsBody,
	type UpdateBookingGuestsBody,
} from "@workspace/core/commerce";
import { logger } from "@workspace/core/observability";
import { readJson, withAdminRoute } from "@/lib/api/admin-route";
import {
	adminOrderAccess,
	commerceErrorResponse,
	commerceService,
	loadAdminOrder,
	validationResponse,
} from "@/lib/api/commerce";
import { guestComplianceService } from "@/lib/api/compliance";
import { describeError } from "@/lib/observability/events";

interface AdminBookingGuestsRouteContext {
	params: Promise<{ bookingId: string; reference: string }>;
}

/**
 * Operator edit of guest identity data. After the update, the compliance
 * sweep runs so a booking whose Hostkit submission already succeeded gets a
 * fresh submission job (a succeeded job older than the latest guest update
 * no longer covers the booking). A sweep failure never fails the edit; the
 * regular compliance cron re-runs the same sweep.
 */
export const PUT = withAdminRoute<AdminBookingGuestsRouteContext>(
	{
		name: "admin.orders.booking_guests_update",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request, context): Promise<Response> => {
		const { bookingId, reference } = await context.params;
		const parsed = parseUpdateBookingGuestsBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse<UpdateBookingGuestsBody>(
				parsed,
				"Invalid guest details",
			);
		}

		const row = await loadAdminOrder(reference);
		if (!row) {
			return Response.json({ error: "Order not found" }, { status: 404 });
		}

		try {
			const guests = await (await commerceService()).updateBookingGuests(
				adminOrderAccess(row),
				bookingId,
				parsed.data.guests,
			);

			try {
				await (await guestComplianceService()).sweepEligibleBookings();
			} catch (error) {
				logger.warn("post-edit compliance sweep failed", {
					bookingId,
					orderId: row.id,
					...describeError(error),
				});
			}

			return Response.json(guests);
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
