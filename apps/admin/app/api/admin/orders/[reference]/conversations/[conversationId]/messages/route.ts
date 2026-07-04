import { z } from "zod";
import { readJson, withAdminRoute } from "@/lib/api/admin-route";
import {
	adminOrderAccess,
	commerceErrorResponse,
	commerceService,
	loadAdminOrder,
} from "@/lib/api/commerce";

interface AdminConversationMessagesRouteContext {
	params: Promise<{ conversationId: string; reference: string }>;
}

const MAX_MESSAGE_LIMIT = 200;
const MAX_MESSAGE_BODY_LENGTH = 4000;
const LIMIT_PATTERN = /^[1-9]\d*$/;

const messageBodySchema = z.object({
	body: z.string().trim().min(1).max(MAX_MESSAGE_BODY_LENGTH),
});

const socketIdSchema = z.object({
	socketId: z.string().min(1),
});

function readMessageBody(body: unknown): string | null {
	const parsed = messageBodySchema.safeParse(body);
	return parsed.success ? parsed.data.body : null;
}

function readSocketId(body: unknown): string | null {
	const parsed = socketIdSchema.safeParse(body);
	return parsed.success ? parsed.data.socketId : null;
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

export const GET = withAdminRoute<AdminConversationMessagesRouteContext>(
	{
		name: "admin.orders.conversation_messages_read",
		rateLimit: { bucket: "cart.read" },
	},
	async (request: Request, context): Promise<Response> => {
		const { conversationId, reference } = await context.params;
		const row = await loadAdminOrder(reference);
		if (!row) {
			return Response.json({ error: "Order not found" }, { status: 404 });
		}

		try {
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

			const messages = await commerceService().readConversationMessages(
				adminOrderAccess(row),
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

export const POST = withAdminRoute<AdminConversationMessagesRouteContext>(
	{
		name: "admin.orders.conversation_messages_send",
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

		const row = await loadAdminOrder(reference);
		if (!row) {
			return Response.json({ error: "Order not found" }, { status: 404 });
		}

		try {
			const message = await commerceService().sendHostConversationMessage(
				adminOrderAccess(row),
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
