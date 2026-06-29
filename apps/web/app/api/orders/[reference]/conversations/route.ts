import {
	commerceErrorResponse,
	commerceService,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

interface OrderConversationsRouteContext {
	params: Promise<{ reference: string }>;
}

export const GET = withApiRoute<OrderConversationsRouteContext>(
	{ name: "orders.conversations_list", rateLimit: { bucket: "cart.read" } },
	async (request: Request, context): Promise<Response> => {
		const { reference } = await context.params;
		const accessContext = await resolveOrderAccessContext(request);

		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const conversations = await service.readOrderConversations(access);
			return Response.json({ conversations });
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);
