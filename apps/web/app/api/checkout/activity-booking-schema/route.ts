import { parseActivityBookingSchemaRequest } from "@workspace/core/commerce";
import { resolveActivityBookingSchema } from "@/lib/activities/booking-schema";
import {
	commerceErrorResponse,
	readJson,
	validationResponse,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

/**
 * Returns the live Bokun booking-question schema for one activity selection so
 * the checkout page can collect exactly the required questions and pickup/dropoff
 * places before freezing the draft order. Read-only (no cart mutation); the
 * answers are submitted later on the draft-order body.
 */
export const maxDuration = 30;

export const POST = withApiRoute(
	{
		name: "checkout.activity_booking_schema",
		rateLimit: { bucket: "cart.read" },
	},
	async (request: Request): Promise<Response> => {
		const parsed = parseActivityBookingSchemaRequest(await readJson(request));
		if (!parsed.success) {
			return validationResponse(parsed, "Invalid activity booking request");
		}

		try {
			return Response.json(await resolveActivityBookingSchema(parsed.data));
		} catch (error) {
			const response = commerceErrorResponse(error);
			if (response) {
				return response;
			}
			throw error;
		}
	},
);
