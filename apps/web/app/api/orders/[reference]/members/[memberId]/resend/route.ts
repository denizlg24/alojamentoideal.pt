import type { OrderRole } from "@workspace/core/commerce";
import type { OrderMemberStatus } from "@workspace/db";
import {
	commerceErrorResponse,
	commerceService,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";
import {
	orderInviteTitle,
	sendOrderInviteEmail,
} from "@/lib/email/order-invite";

interface OrderMemberRouteContext {
	params: Promise<{ memberId: string; reference: string }>;
}

/**
 * Resends an invite (owner only): rotates the token, resets the 24h window, and
 * re-emails the magic-link. Works for a pending or a previously revoked member;
 * an already accepted member or the owner cannot be resent.
 */
export const POST = withApiRoute<OrderMemberRouteContext>(
	{
		name: "orders.members_resend",
		rateLimit: { bucket: "orders.members_resend" },
	},
	async (request: Request, context): Promise<Response> => {
		const { memberId, reference } = await context.params;
		const accessContext = await resolveOrderAccessContext(request, reference);
		try {
			const service = await commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const detail = await service.readOrderDetail(access);
			const accommodationTitle = orderInviteTitle(detail.items);
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
					role: "member" as OrderRole,
					status: "invited" as OrderMemberStatus,
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
