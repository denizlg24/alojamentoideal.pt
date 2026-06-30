import {
	commerceErrorResponse,
	commerceService,
	memberCookie,
	readJson,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { getServerUser } from "@/lib/auth/session";

interface OrderAccessRouteContext {
	params: Promise<{ reference: string }>;
}

/**
 * Redeems a booking-access token for an order. The raw token arrives by email
 * link and is posted in the request body; on success the member is flipped to
 * `active`, bound to the signed-in account when present, and the browser gets
 * an order-scoped httpOnly cookie. Invalid, revoked, or expired tokens report
 * 404 so the order stays unenumerable.
 */
export const POST = withApiRoute<OrderAccessRouteContext>(
	{ name: "orders.access_redeem", rateLimit: { bucket: "checkout.write" } },
	async (request: Request, context): Promise<Response> => {
		const { reference } = await context.params;

		const body = await readJson(request);
		const bodyToken =
			body && typeof body === "object" && "token" in body
				? (body as { token?: unknown }).token
				: null;
		const token = typeof bodyToken === "string" ? bodyToken : null;

		if (!token) {
			return Response.json(
				{
					code: "invalid_request",
					error: "A booking-access token is required.",
				},
				{ status: 400 },
			);
		}

		const user = await getServerUser(request);

		try {
			const access = await commerceService().redeemMemberToken(
				reference,
				token,
				{
					userId: user?.id ?? null,
				},
			);
			const response = Response.json({
				reference: access.order.publicReference,
				role: access.role,
			});
			response.headers.append("Set-Cookie", memberCookie(reference, token));
			return response;
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
