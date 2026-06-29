import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { sendOrderInviteEmail } from "@/lib/email/order-invite";

interface OrderMembersRouteContext {
	params: Promise<{ reference: string }>;
}

function readEmail(body: unknown): string | null {
	if (body && typeof body === "object" && "email" in body) {
		const value = (body as { email?: unknown }).email;
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
}

/**
 * Invites a guest to an order (owner only). The owner is resolved through the
 * access spine (cart/user grant or the redeemed owner cookie); `inviteMember`
 * re-checks the `invite_members` permission and mints a 24h magic-link token,
 * which is emailed and never returned to the browser. Capacity is enforced when
 * the invite is accepted, not here, so the property's headcount is never leaked.
 */
export const POST = withApiRoute<OrderMembersRouteContext>(
	{ name: "orders.members_invite", rateLimit: { bucket: "mutation" } },
	async (request: Request, context): Promise<Response> => {
		const { reference } = await context.params;
		const email = readEmail(await readJson(request));
		if (!email) {
			return Response.json(
				{ code: "invalid_request", error: "An email address is required." },
				{ status: 400 },
			);
		}

		const accessContext = await resolveOrderAccessContext(request);
		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const detail = await service.readOrderDetail(access);
			const accommodationTitle = detail.items[0]?.title ?? "your stay";
			const invite = await service.inviteMember(
				access,
				{ email },
				({ email: to, token }) =>
					sendOrderInviteEmail({
						accommodationTitle,
						publicReference: access.order.publicReference,
						to,
						token,
					}),
			);
			return Response.json(
				{
					member: {
						email: invite.email,
						expiresAt: invite.expiresAt.toISOString(),
						id: invite.memberId,
						role: "member",
						status: "invited",
					},
				},
				{ status: 201 },
			);
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
