import {
	commerceErrorResponse,
	commerceService,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import { sendOrderInviteEmail } from "@/lib/email/order-invite";

interface OrderMemberRouteContext {
	params: Promise<{ memberId: string; reference: string }>;
}

/**
 * Resends an invite (owner only): rotates the token, resets the 24h window, and
 * re-emails the magic-link. Works for a pending or a previously revoked member;
 * an already accepted member or the owner cannot be resent.
 */
export const POST = withApiRoute<OrderMemberRouteContext>(
	{ name: "orders.members_resend", rateLimit: { bucket: "mutation" } },
	async (request: Request, context): Promise<Response> => {
		const { memberId, reference } = await context.params;
		const accessContext = await resolveOrderAccessContext(request, reference);
		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const detail = await service.readOrderDetail(access);
			const accommodationTitle = detail.items[0]?.title ?? "your stay";
			const invite = await service.resendMemberInvite(
				access,
				memberId,
				({ email: to, token }) =>
					sendOrderInviteEmail({
						accommodationTitle,
						publicReference: access.order.publicReference,
						to,
						token,
					}),
			);
			return Response.json({
				member: {
					email: invite.email,
					expiresAt: invite.expiresAt.toISOString(),
					id: invite.memberId,
					role: "member",
					status: "invited",
				},
			});
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
