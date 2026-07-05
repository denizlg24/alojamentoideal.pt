import { accountProfileRepository } from "@/lib/api/account";
import {
	commerceErrorResponse,
	commerceService,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { getServerUser } from "@/lib/auth/session";

interface OrderGuestReuseRouteContext {
	params: Promise<{ bookingId: string; guestId: string; reference: string }>;
}

/**
 * Fills a guest slot from the signed-in caller's already-verified account
 * identity, skipping a fresh Stripe scan. Requires a signed-in user with a
 * verified account identity; the commerce service enforces that a member may
 * only target the slot they were invited to fill.
 */
export const POST = withApiRoute<OrderGuestReuseRouteContext>(
	{
		name: "orders.guest_use_account_identity",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request, context): Promise<Response> => {
		const { bookingId, guestId, reference } = await context.params;
		const user = await getServerUser(request);
		if (!user) {
			return new Response(null, { status: 401 });
		}

		const accessContext = await resolveOrderAccessContext(request, reference);
		try {
			const prefill = await accountProfileRepository().getVerifiedGuestPrefill(
				user.id,
			);
			if (!prefill) {
				return Response.json(
					{
						code: "identity_not_verified",
						error: "Your account identity is not verified yet.",
					},
					{ status: 409 },
				);
			}

			const service = await commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const guests = await service.applyVerifiedAccountIdentityToGuest(
				access,
				bookingId,
				guestId,
				prefill,
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
