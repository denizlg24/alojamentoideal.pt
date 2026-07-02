import { z } from "zod";
import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

interface OrderGuestResidencyRouteContext {
	params: Promise<{ bookingId: string; guestId: string; reference: string }>;
}

const guestResidencySchema = z.object({
	nationality: z.string(),
	residenceCountry: z.string(),
});

/**
 * Confirms the two residency fields Stripe Identity never returns (nationality,
 * country of residence) without touching verification state, so completing them
 * after a verified scan or account reuse keeps the slot verified.
 */
export const POST = withApiRoute<OrderGuestResidencyRouteContext>(
	{ name: "orders.guest_residency", rateLimit: { bucket: "mutation" } },
	async (request: Request, context): Promise<Response> => {
		const { bookingId, guestId, reference } = await context.params;
		const body = await readJson(request);
		const parsed = guestResidencySchema.safeParse(body);
		if (!parsed.success) {
			return Response.json(
				{
					code: "invalid_request",
					error: "Nationality and residence country are required.",
				},
				{ status: 400 },
			);
		}
		const { nationality, residenceCountry } = parsed.data;

		const accessContext = await resolveOrderAccessContext(request, reference);
		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const guests = await service.patchGuestResidency(
				access,
				bookingId,
				guestId,
				{
					nationality,
					residenceCountry,
				},
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
