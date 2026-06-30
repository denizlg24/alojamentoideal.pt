import {
	commerceErrorResponse,
	commerceService,
	readJson,
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

function readSocketId(body: unknown): string | null {
	if (body && typeof body === "object" && "socketId" in body) {
		const value = (body as { socketId?: unknown }).socketId;
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return null;
}

export const POST = withApiRoute<RetryConversationMessageRouteContext>(
	{
		name: "orders.conversation_messages_retry",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request, context): Promise<Response> => {
		const { conversationId, messageId, reference } = await context.params;
		const payload = await readJson(request);
		const accessContext = await resolveOrderAccessContext(request, reference);

		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const message = await service.retryConversationMessage(
				access,
				conversationId,
				messageId,
				{ excludeSocketId: readSocketId(payload) },
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
