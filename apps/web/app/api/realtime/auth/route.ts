import {
	commerceErrorResponse,
	commerceService,
	readJson,
	resolveOrderAccessContext,
} from "@/lib/api/commerce";
import {
	parseConversationChannelName,
	requirePusherServerClient,
} from "@/lib/api/realtime";
import { withApiRoute } from "@/lib/api/route";

interface RealtimeAuthBody {
	channelName: string;
	reference: string;
	socketId: string;
}

function readRealtimeAuthBody(body: unknown): RealtimeAuthBody | null {
	if (!body || typeof body !== "object") {
		return null;
	}
	const record = body as Record<string, unknown>;
	const socketId = record.socket_id ?? record.socketId;
	const channelName = record.channel_name ?? record.channelName;
	const reference = record.reference;
	if (
		typeof socketId !== "string" ||
		typeof channelName !== "string" ||
		typeof reference !== "string"
	) {
		return null;
	}
	return { channelName, reference, socketId };
}

export const POST = withApiRoute(
	{ name: "realtime.auth", rateLimit: { bucket: "mutation" } },
	async (request: Request): Promise<Response> => {
		const body = readRealtimeAuthBody(await readJson(request));
		if (!body) {
			return Response.json(
				{ code: "invalid_request", error: "Invalid realtime auth request." },
				{ status: 400 },
			);
		}

		const parsedChannel = parseConversationChannelName(body.channelName);
		if (!parsedChannel) {
			return Response.json(
				{ code: "invalid_request", error: "Invalid realtime channel." },
				{ status: 400 },
			);
		}

		const accessContext = await resolveOrderAccessContext(request);
		try {
			const service = commerceService();
			const access = await service.resolveOrderAccess(
				body.reference,
				accessContext,
			);
			if (access.order.id !== parsedChannel.orderId) {
				return Response.json({ error: "Forbidden" }, { status: 403 });
			}
			const conversations = await service.readOrderConversations(access);
			if (
				!conversations.some(
					(conversation) => conversation.id === parsedChannel.conversationId,
				)
			) {
				return Response.json({ error: "Forbidden" }, { status: 403 });
			}

			const auth = requirePusherServerClient().authorizeChannel(
				body.socketId,
				body.channelName,
			);
			return Response.json(auth);
		} catch (error) {
			const handled = commerceErrorResponse(error);
			if (handled) {
				return handled;
			}
			if (
				error instanceof Error &&
				error.message === "Pusher is not configured."
			) {
				return Response.json(
					{ error: "Realtime is not configured" },
					{ status: 503 },
				);
			}
			throw error;
		}
	},
);
