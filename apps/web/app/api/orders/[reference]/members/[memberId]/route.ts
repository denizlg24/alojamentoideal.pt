import {
	commerceErrorResponse,
	commerceService,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

interface OrderMemberRouteContext {
	params: Promise<{ memberId: string; reference: string }>;
}

/**
 * Revokes a member's access (owner only). The token dies with the row, so the
 * revoked guest loses access on their next request. The owner cannot revoke
 * themselves; an unknown member reports 404 and an already-revoked one is a no-op.
 */
export const DELETE = withApiRoute<OrderMemberRouteContext>(
	{ name: "orders.members_revoke", rateLimit: { bucket: "mutation" } },
	async (request: Request, context): Promise<Response> => {
		const { memberId, reference } = await context.params;
		const accessContext = await resolveOrderAccessContext(request, reference);
		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			await service.revokeMember(access, memberId);
			return new Response(null, { status: 204 });
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
