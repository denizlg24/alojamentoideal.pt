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

function readCode(body: unknown, key: string): string | null {
	if (body && typeof body === "object" && key in body) {
		const value = (body as Record<string, unknown>)[key];
		if (typeof value === "string") {
			return value;
		}
	}
	return null;
}

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
		const nationality = readCode(body, "nationality");
		const residenceCountry = readCode(body, "residenceCountry");
		if (nationality === null || residenceCountry === null) {
			return Response.json(
				{
					code: "invalid_request",
					error: "Nationality and residence country are required.",
				},
				{ status: 400 },
			);
		}

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
