import {
	parseUpdateBookingGuestsBody,
	type UpdateBookingGuestsBody,
} from "@workspace/core/commerce";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveOrderAccessContext,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

interface OrderBookingGuestsRouteContext {
	params: Promise<{ bookingId: string; reference: string }>;
}

export const GET = withApiRoute<OrderBookingGuestsRouteContext>(
	{ name: "orders.booking_guests_read", rateLimit: { bucket: "cart.read" } },
	async (request: Request, context): Promise<Response> => {
		const { bookingId, reference } = await context.params;
		const accessContext = await resolveOrderAccessContext(request);

		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const guests = await service.readBookingGuests(access, bookingId);
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

export const PUT = withApiRoute<OrderBookingGuestsRouteContext>(
	{ name: "orders.booking_guests_update", rateLimit: { bucket: "mutation" } },
	async (request: Request, context): Promise<Response> => {
		const { bookingId, reference } = await context.params;
		const parsed = parseUpdateBookingGuestsBody(await readJson(request));
		if (!parsed.success) {
			return validationResponse<UpdateBookingGuestsBody>(
				parsed,
				"Invalid guest details",
			);
		}

		const accessContext = await resolveOrderAccessContext(request);
		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const guests = await service.updateBookingGuests(
				access,
				bookingId,
				parsed.data.guests,
			);
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
