import { z } from "zod";
import { readJson, withAdminRoute } from "@/lib/api/admin-route";
import {
	commerceErrorResponse,
	loadAdminOrder,
	reservationAdminService,
} from "@/lib/api/commerce";

interface AdminReservationRouteContext {
	params: Promise<{ bookingId: string; reference: string }>;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const reservationSchema = z
	.object({
		checkIn: isoDate.optional(),
		checkOut: isoDate.optional(),
		guests: z.number().int().positive().max(99).optional(),
		status: z
			.enum([
				"accepted",
				"denied",
				"cancelled_by_host",
				"cancelled_by_guest",
				"no_show",
			])
			.optional(),
	})
	.refine(
		(v) =>
			v.status !== undefined ||
			v.checkIn !== undefined ||
			v.checkOut !== undefined ||
			v.guests !== undefined,
		{ message: "At least one field must be provided." },
	);

/**
 * Admin-only: manage one Hostify reservation. A `status` transitions the
 * reservation (money-neutral — any refund is issued separately); otherwise the
 * `checkIn`/`checkOut`/`guests` fields edit the reservation details. Either way
 * the local `provider_bookings` row is synced.
 */
export const PUT = withAdminRoute<AdminReservationRouteContext>(
	{
		name: "admin.orders.reservation_update",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request, context): Promise<Response> => {
		const { bookingId, reference } = await context.params;
		const parsed = reservationSchema.safeParse((await readJson(request)) ?? {});
		if (!parsed.success) {
			return Response.json(
				{
					code: "invalid_request",
					error: "Invalid reservation update.",
					issues: parsed.error.issues.map((issue) => ({
						message: issue.message,
						path: issue.path.join("."),
					})),
				},
				{ status: 400 },
			);
		}

		const row = await loadAdminOrder(reference);
		if (!row) {
			return Response.json({ error: "Order not found" }, { status: 404 });
		}

		const { checkIn, checkOut, guests, status } = parsed.data;
		try {
			const service = reservationAdminService();
			if (status && (checkIn || checkOut || guests)) {
				return Response.json(
					{
						code: "invalid_request",
						error: "Provide either `status` or detail fields, not both.",
					},
					{ status: 400 },
				);
			}
			const result = status
				? await service.updateReservationStatus({
						bookingId,
						orderId: row.id,
						status,
					})
				: await service.updateReservationDetails({
						bookingId,
						checkIn,
						checkOut,
						guests,
						orderId: row.id,
					});
			return Response.json({ data: result, success: true });
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
