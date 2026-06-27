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
 * link (`?token=<raw>`) or request body; on success the member is flipped to
 * `active`, bound to the signed-in account when present, and the browser gets a
 * scoped httpOnly cookie so subsequent order-scoped requests authorize without
 * re-presenting the token. Invalid, revoked, or expired tokens report 404 so the
 * order stays unenumerable.
 */
export const POST = withApiRoute<OrderAccessRouteContext>(
	{ name: "orders.access_redeem", rateLimit: { bucket: "checkout.write" } },
	async (request: Request, context): Promise<Response> => {
		const { reference } = await context.params;

		const url = new URL(request.url);
		const queryToken = url.searchParams.get("token");
		const body = queryToken ? null : await readJson(request);
		const bodyToken =
			body && typeof body === "object" && "token" in body
				? (body as { token?: unknown }).token
				: null;
		const token =
			queryToken ?? (typeof bodyToken === "string" ? bodyToken : null);

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
			response.headers.append("Set-Cookie", memberCookie(token));
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
