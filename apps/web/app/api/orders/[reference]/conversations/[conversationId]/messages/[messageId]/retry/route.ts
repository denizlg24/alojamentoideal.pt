import {
	commerceErrorResponse,
	commerceService,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

interface RetryConversationMessageRouteContext {
	params: Promise<{
		conversationId: string;
		messageId: string;
		reference: string;
	}>;
}

export const POST = withApiRoute<RetryConversationMessageRouteContext>(
	{
		name: "orders.conversation_messages_retry",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request, context): Promise<Response> => {
		const { conversationId, messageId, reference } = await context.params;
		const accessContext = await resolveOrderAccessContext(request, reference);

		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const message = await service.retryConversationMessage(
				access,
				conversationId,
				messageId,
			);
			return Response.json(
				{ message },
				{ status: message.deliveryStatus === "failed" ? 202 : 200 },
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
