import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import { withApiRoute } from "@/lib/api/route";

interface ConversationMessagesRouteContext {
	params: Promise<{ conversationId: string; reference: string }>;
}

function readMessageBody(body: unknown): string | null {
	if (body && typeof body === "object" && "body" in body) {
		const value = (body as { body?: unknown }).body;
		if (typeof value === "string") {
			return value;
		}
	}
	return null;
}

function readLimit(request: Request): number | undefined {
	const raw = new URL(request.url).searchParams.get("limit");
	if (!raw) {
		return undefined;
	}
	const value = Number.parseInt(raw, 10);
	return Number.isInteger(value) ? value : undefined;
}

export const GET = withApiRoute<ConversationMessagesRouteContext>(
	{
		name: "orders.conversation_messages_read",
		rateLimit: { bucket: "cart.read" },
	},
	async (request: Request, context): Promise<Response> => {
		const { conversationId, reference } = await context.params;
		const accessContext = await resolveOrderAccessContext(request);

		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const messages = await service.readConversationMessages(
				access,
				conversationId,
				{ limit: readLimit(request) },
			);
			return Response.json({ messages });
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			throw error;
		}
	},
);

export const POST = withApiRoute<ConversationMessagesRouteContext>(
	{
		name: "orders.conversation_messages_send",
		rateLimit: { bucket: "mutation" },
	},
	async (request: Request, context): Promise<Response> => {
		const { conversationId, reference } = await context.params;
		const body = readMessageBody(await readJson(request));
		if (body === null) {
			return Response.json(
				{ code: "invalid_request", error: "Message body is required." },
				{ status: 400 },
			);
		}

		const accessContext = await resolveOrderAccessContext(request);
		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const message = await service.sendConversationMessage(
				access,
				conversationId,
				{
					body,
				},
			);
			return Response.json(
				{ message },
				{ status: message.deliveryStatus === "failed" ? 202 : 201 },
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
