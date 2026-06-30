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

const MAX_MESSAGE_LIMIT = 200;
const LIMIT_PATTERN = /^[1-9]\d*$/;

function readMessageBody(body: unknown): string | null {
	if (body && typeof body === "object" && "body" in body) {
		const value = (body as { body?: unknown }).body;
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
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

function readLimit(request: Request): number | null | undefined {
	const raw = new URL(request.url).searchParams.get("limit");
	if (!raw) {
		return undefined;
	}
	if (!LIMIT_PATTERN.test(raw)) {
		return null;
	}
	return Math.min(Number.parseInt(raw, 10), MAX_MESSAGE_LIMIT);
}

export const GET = withApiRoute<ConversationMessagesRouteContext>(
	{
		name: "orders.conversation_messages_read",
		rateLimit: { bucket: "cart.read" },
	},
	async (request: Request, context): Promise<Response> => {
		const { conversationId, reference } = await context.params;
		const accessContext = await resolveOrderAccessContext(request, reference);

		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const limit = readLimit(request);
			if (limit === null) {
				return Response.json(
					{
						code: "invalid_request",
						error: "Limit must be a positive integer.",
					},
					{ status: 400 },
				);
			}
			const messages = await service.readConversationMessages(
				access,
				conversationId,
				{ limit },
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
		const payload = await readJson(request);
		const body = readMessageBody(payload);
		if (body === null) {
			return Response.json(
				{ code: "invalid_request", error: "Message body is required." },
				{ status: 400 },
			);
		}

		const accessContext = await resolveOrderAccessContext(request, reference);
		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(reference, accessContext);
			const message = await service.sendConversationMessage(
				access,
				conversationId,
				{ body },
				{ excludeSocketId: readSocketId(payload) },
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
